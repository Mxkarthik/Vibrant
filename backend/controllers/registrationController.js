
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


// @desc    Get registrations of logged-in participant
// @route   GET /api/registrations/my
// @access  Authenticated users

const getMyRegistrations = async (req, res) => {
    try {
        const registrations = await Registration.find({
            user: req.user._id,
            status: "REGISTERED"
        })
            .populate("event", "name category poster venue startDate endDate status")
            .sort({ createdAt: -1 })
            .lean();

        return res.status(200).json({
            success: true,
            count: registrations.length,
            registrations
        });

    } catch (error) {
        console.error("Get my registrations error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch your registrations"
        });
    }
};


// @desc    Get all participants registered for an event
// @route   GET /api/events/:id/participants
// @access  ADMIN or assigned ORGANISER

const getEventParticipants = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid event ID"
            });
        }

        const event = await Event.findById(id)
            .select("name organizers createdBy");

        if (!event) {
            return res.status(404).json({
                success: false,
                message: "Event not found"
            });
        }

        const isAdmin = req.user.role === "ADMIN";

        const isAssignedOrganiser = event.organizers.some(
            organiserId => organiserId.toString() === req.user._id.toString()
        );

        if (!isAdmin && !isAssignedOrganiser) {
            return res.status(403).json({
                success: false,
                message: "You are not authorized to view these participants"
            });
        }

        const page = Number.parseInt(req.query.page, 10) || 1;
        const limit = Number.parseInt(req.query.limit, 10) || 20;

        if (
            !Number.isInteger(page) ||
            !Number.isInteger(limit) ||
            page < 1 ||
            limit < 1 ||
            limit > 100
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid pagination parameters"
            });
        }

        const filter = {
            event: id,
            status: "REGISTERED"
        };

        const [registrations, total] = await Promise.all([
            Registration.find(filter)
                .populate("user", "name email")
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),

            Registration.countDocuments(filter)
        ]);

        return res.status(200).json({
            success: true,
            event: {
                id: event._id,
                name: event.name
            },
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            },
            registrations
        });

    } catch (error) {
        console.error("Get event participants error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch event participants"
        });
    }
};


// @desc    Get one registration
// @route   GET /api/registrations/:id
// @access  Owner, ADMIN or assigned ORGANISER

const getRegistrationById = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid registration ID"
            });
        }

        const registration = await Registration.findById(id)
            .populate("user", "name email")
            .populate("event", "name category venue startDate endDate organizers");

        if (!registration) {
            return res.status(404).json({
                success: false,
                message: "Registration not found"
            });
        }

        const isOwner =
            registration.user._id.toString() === req.user._id.toString();

        const isAdmin = req.user.role === "ADMIN";

        const isAssignedOrganiser =
            registration.event.organizers.some(
                organiserId =>
                    organiserId.toString() === req.user._id.toString()
            );

        if (!isOwner && !isAdmin && !isAssignedOrganiser) {
            return res.status(403).json({
                success: false,
                message: "You are not authorized to view this registration"
            });
        }

        return res.status(200).json({
            success: true,
            registration
        });

    } catch (error) {
        console.error("Get registration error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch registration"
        });
    }
};


// @desc    Verify or reject participant payment
// @route   PATCH /api/registrations/:id/payment
// @access  ADMIN only

const updatePaymentStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body || {};

        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid registration ID"
            });
        }

        if (!["VERIFIED", "REJECTED"].includes(status)) {
            return res.status(400).json({
                success: false,
                message: "Payment status must be VERIFIED or REJECTED"
            });
        }

        const registration = await Registration.findById(id);

        if (!registration) {
            return res.status(404).json({
                success: false,
                message: "Registration not found"
            });
        }

        if (registration.payment.status !== "PENDING") {
            return res.status(409).json({
                success: false,
                message: "Only pending payments can be updated"
            });
        }

        registration.payment.status = status;

        if (status === "VERIFIED") {
            registration.payment.verifiedBy = req.user._id;
            registration.payment.verifiedAt = new Date();
        } else {
            registration.payment.verifiedBy = null;
            registration.payment.verifiedAt = null;
        }

        await registration.save();

        return res.status(200).json({
            success: true,
            message: `Payment ${status.toLowerCase()} successfully`,
            registration
        });

    } catch (error) {
        console.error("Update payment status error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to update payment status"
        });
    }
};


const markAttendance = async (req, res) => {
    try {
        const { qrToken } = req.body;

        if (!qrToken || typeof qrToken !== "string") {
            return res.status(400).json({
                success: false,
                message: "QR token is required."
            });
        }

        const registration = await Registration.findOne({ qrToken })
            .populate("event", "name status")
            .populate("team", "payment");

        if (!registration) {
            return res.status(404).json({
                success: false,
                message: "Invalid QR code. Registration not found."
            });
        }

        if (registration.status !== "REGISTERED") {
            return res.status(400).json({
                success: false,
                message: "This registration has been cancelled."
            });
        }

        if (registration.event.status !== "PUBLISHED") {
            return res.status(400).json({
                success: false,
                message: "Attendance is unavailable for this event."
            });
        }

        // Check shared team payment or individual payment
        const paymentStatus = registration.team
            ? registration.team.payment.status
            : registration.payment.status;

        if (!["VERIFIED", "NOT_REQUIRED"].includes(paymentStatus)) {
            return res.status(400).json({
                success: false,
                message: "Payment must be verified before attendance."
            });
        }

        if (registration.attendance.isPresent) {
            return res.status(409).json({
                success: false,
                message: "Participant has already checked in.",
                participant: registration.participantDetails.fullName,
                checkedInAt: registration.attendance.checkedInAt
            });
        }

        // Atomic update prevents simultaneous duplicate scans
        const updatedRegistration = await Registration.findOneAndUpdate(
            {
                _id: registration._id,
                status: "REGISTERED",
                "attendance.isPresent": false
            },
            {
                $set: {
                    "attendance.isPresent": true,
                    "attendance.checkedInAt": new Date()
                }
            },
            { new: true }
        );

        if (!updatedRegistration) {
            return res.status(409).json({
                success: false,
                message: "Participant has already checked in."
            });
        }

        return res.status(200).json({
            success: true,
            message: "Attendance marked successfully.",
            participant: updatedRegistration.participantDetails,
            event: registration.event.name,
            checkedInAt: updatedRegistration.attendance.checkedInAt
        });

    } catch (error) {
        console.error("Attendance error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to mark attendance."
        });
    }
};


module.exports = {
    registerForEvent,
    getMyRegistrations,
    getEventParticipants,
    getRegistrationById,
    updatePaymentStatus,
    markAttendance
};
