
const mongoose = require("mongoose");
const Event = require("../models/Event");
const Registration = require("../models/Registration");

// Validate and normalize event-specific answers
const validateCustomResponses = (fields, responses) => {
    if (!Array.isArray(responses)) {
        throw new Error("Custom responses must be an array");
    }

    const fieldMap = new Map(
        fields.map(field => [field.fieldKey, field])
    );

    const responseMap = new Map();

    for (const response of responses) {
        if (
            !response ||
            typeof response !== "object" ||
            Array.isArray(response) ||
            typeof response.fieldKey !== "string" ||
            response.value === undefined
        ) {
            throw new Error("Invalid custom response");
        }

        const field = fieldMap.get(response.fieldKey);

        if (!field) {
            throw new Error(
                `Unknown registration field: ${response.fieldKey}`
            );
        }

        if (responseMap.has(response.fieldKey)) {
            throw new Error(
                `Duplicate response: ${response.fieldKey}`
            );
        }

        let value = response.value;

        switch (field.fieldType) {
            case "TEXT":
            case "TEXTAREA":
                if (typeof value !== "string") {
                    throw new Error(`${field.label} must be text`);
                }
                value = value.trim();
                break;

            case "NUMBER":
                value = Number(value);

                if (!Number.isFinite(value)) {
                    throw new Error(`${field.label} must be a valid number`);
                }
                break;

            case "URL":
                if (typeof value !== "string") {
                    throw new Error(`${field.label} must be a URL`);
                }

                try {
                    const parsedUrl = new URL(value);

                    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
                        throw new Error();
                    }
                } catch {
                    throw new Error(`${field.label} must be a valid HTTP or HTTPS URL`);
                }

                value = value.trim();
                break;

            case "DATE":
                if (
                    typeof value !== "string" ||
                    Number.isNaN(Date.parse(value))
                ) {
                    throw new Error(`${field.label} must be a valid date`);
                }
                break;

            case "DROPDOWN":
            case "RADIO":
                if (
                    typeof value !== "string" ||
                    !field.options.includes(value)
                ) {
                    throw new Error(`Invalid selection for ${field.label}`);
                }
                break;

            case "CHECKBOX":
                if (
                    !Array.isArray(value) ||
                    value.length === 0 ||
                    value.some(option =>
                        typeof option !== "string" ||
                        !field.options.includes(option)
                    )
                ) {
                    throw new Error(`Invalid selection for ${field.label}`);
                }

                if (new Set(value).size !== value.length) {
                    throw new Error(`Duplicate selections for ${field.label}`);
                }
                break;

            default:
                throw new Error(`Unsupported field type: ${field.fieldType}`);
        }

        if (
            typeof value === "string" &&
            field.required &&
            !value
        ) {
            throw new Error(`${field.label} is required`);
        }

        responseMap.set(response.fieldKey, value);
    }

    // Check all required fields
    for (const field of fields) {
        if (
            field.required &&
            (
                !responseMap.has(field.fieldKey) ||
                responseMap.get(field.fieldKey) === "" ||
                (
                    Array.isArray(responseMap.get(field.fieldKey)) &&
                    responseMap.get(field.fieldKey).length === 0
                )
            )
        ) {
            throw new Error(`${field.label} is required`);
        }
    }

    return Array.from(responseMap, ([fieldKey, value]) => ({
        fieldKey,
        value
    }));
};


// @desc    Register participant for an event
// @route   POST /api/events/:id/register
// @access  Authenticated participants

const registerForEvent = async (req, res) => {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({
            success: false,
            message: "Invalid event ID"
        });
    }

    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
        return res.status(400).json({
            success: false,
            message: "Invalid request body"
        });
    }

    const {
        participantDetails,
        customResponses = [],
        paymentMethod
    } = req.body;

    if (
        !participantDetails ||
        typeof participantDetails !== "object" ||
        Array.isArray(participantDetails)
    ) {
        return res.status(400).json({
            success: false,
            message: "Participant details are required"
        });
    }

    const {
        fullName,
        mobileNumber,
        collegeName,
        department,
        yearOfStudy,
        section,
        rollNumber
    } = participantDetails;

    const details = {
        fullName,
        mobileNumber,
        collegeName,
        department,
        yearOfStudy,
        section,
        rollNumber
    };

    for (const [key, value] of Object.entries(details)) {
        if (typeof value !== "string" || !value.trim()) {
            return res.status(400).json({
                success: false,
                message: `${key} is required`
            });
        }
    }

    const cleanMobile = mobileNumber.trim();

    if (!/^\+?[0-9]{10,15}$/.test(cleanMobile)) {
        return res.status(400).json({
            success: false,
            message: "Enter a valid mobile number"
        });
    }

    if (!Array.isArray(customResponses)) {
        return res.status(400).json({
            success: false,
            message: "Custom responses must be an array"
        });
    }

    const session = await mongoose.startSession();

    try {
        let createdRegistration;

        await session.withTransaction(async () => {
            const event = await Event.findById(id).session(session);

            if (!event) {
                const error = new Error("Event not found");
                error.statusCode = 404;
                throw error;
            }

            if (event.status !== "PUBLISHED") {
                const error = new Error("This event is not available for registration");
                error.statusCode = 400;
                throw error;
            }

            if (event.registration.mode !== "INDIVIDUAL") {
                const error = new Error("This event requires team registration");
                error.statusCode = 400;
                throw error;
            }

            if (new Date(event.registration.deadline) <= new Date()) {
                const error = new Error("Registration deadline has passed");
                error.statusCode = 400;
                throw error;
            }

            const normalizedResponses = validateCustomResponses(
                event.registrationFields || [],
                customResponses
            );

            const fee = event.registration.registrationFee || 0;

            let payment;

            if (fee === 0) {
                payment = {
                    method: "NONE",
                    status: "NOT_REQUIRED"
                };
            } else {
                if (!["UPI", "CASH"].includes(paymentMethod)) {
                    const error = new Error("Select UPI or CASH payment method");
                    error.statusCode = 400;
                    throw error;
                }

                payment = {
                    method: paymentMethod,
                    status: "PENDING"
                };
            }

            // Atomically reserve one participant slot.
            const updatedEvent = await Event.findOneAndUpdate(
                {
                    _id: id,
                    status: "PUBLISHED",
                    "registration.mode": "INDIVIDUAL",
                    "registration.deadline": { $gt: new Date() },
                    $expr: {
                        $lt: [
                            "$registration.registeredParticipants",
                            "$registration.capacity"
                        ]
                    }
                },
                {
                    $inc: {
                        "registration.registeredParticipants": 1
                    }
                },
                {
                    new: true,
                    session
                }
            );

            if (!updatedEvent) {
                const error = new Error("Event is full or registration is closed");
                error.statusCode = 409;
                throw error;
            }

            const [registration] = await Registration.create(
                [
                    {
                        event: event._id,
                        user: req.user._id,

                        participantDetails: {
                            ...details,
                            mobileNumber: cleanMobile,
                            fullName: fullName.trim(),
                            collegeName: collegeName.trim(),
                            department: department.trim(),
                            yearOfStudy: yearOfStudy.trim(),
                            section: section.trim(),
                            rollNumber: rollNumber.trim()
                        },

                        customResponses: normalizedResponses,
                        payment
                    }
                ],
                { session }
            );

            createdRegistration = registration;
        });

        return res.status(201).json({
            success: true,
            message: "Registration successful",
            registration: createdRegistration
        });

    } catch (error) {
        console.error("Registration error:", error);

        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: "You have already registered for this event"
            });
        }

        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.statusCode
                ? error.message
                : "Failed to register for event"
        });

    } finally {
        await session.endSession();
    }
};





module.exports = {
    registerForEvent
};
