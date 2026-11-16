
const mongoose = require("mongoose");
const Event = require("../models/Event");
const Team = require("../models/Team");
const Registration = require("../models/Registration");

const registerTeam = async (req, res) => {
    const session = await mongoose.startSession();

    try {
        const { teamName, members, paymentMethod } = req.body;

        // Basic validation
        if (
            typeof teamName !== "string" ||
            !teamName.trim() ||
            !Array.isArray(members)
        ) {
            return res.status(400).json({
                success: false,
                message: "Team name and members are required."
            });
        }

        if (!["UPI", "CASH", "NONE"].includes(paymentMethod)) {
            return res.status(400).json({
                success: false,
                message: "Invalid payment method."
            });
        }

        if (members.length < 1) {
            return res.status(400).json({
                success: false,
                message: "At least one team member is required."
            });
        }

        const requiredFields = [
            "fullName",
            "mobileNumber",
            "collegeName",
            "department",
            "yearOfStudy",
            "section",
            "rollNumber"
        ];

        // Validate participant details
        for (let i = 0; i < members.length; i++) {
            const details = members[i]?.participantDetails;

            if (!details || typeof details !== "object") {
                return res.status(400).json({
                    success: false,
                    message: `Participant details missing for member ${i + 1}.`
                });
            }

            for (const field of requiredFields) {
                if (
                    typeof details[field] !== "string" ||
                    !details[field].trim()
                ) {
                    return res.status(400).json({
                        success: false,
                        message: `${field} is required for member ${i + 1}.`
                    });
                }
            }

            if (!/^\+?[0-9]{10,15}$/.test(details.mobileNumber.trim())) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid mobile number for member ${i + 1}.`
                });
            }
        }

        const leaderId = req.user._id;

        await session.withTransaction(async () => {
            const event = await Event.findById(req.params.id).session(session);

            if (!event) {
                const error = new Error("Event not found.");
                error.statusCode = 404;
                throw error;
            }

            if (event.status !== "PUBLISHED") {
                const error = new Error("This event is not open for registration.");
                error.statusCode = 400;
                throw error;
            }

            if (event.registration.mode !== "TEAM") {
                const error = new Error("This event does not support team registration.");
                error.statusCode = 400;
                throw error;
            }

            if (new Date() > new Date(event.registration.deadline)) {
                const error = new Error("Registration deadline has passed.");
                error.statusCode = 400;
                throw error;
            }

            const memberCount = members.length;

            if (
                memberCount < event.registration.minTeamSize ||
                memberCount > event.registration.maxTeamSize
            ) {
                const error = new Error(
                    `Team size must be between ${event.registration.minTeamSize} and ${event.registration.maxTeamSize}.`
                );
                error.statusCode = 400;
                throw error;
            }

            if (
                event.registration.registrationFee > 0 &&
                !["UPI", "CASH"].includes(paymentMethod)
            ) {
                const error = new Error("Choose UPI or CASH for team payment.");
                error.statusCode = 400;
                throw error;
            }

            if (
                event.registration.registrationFee === 0 &&
                paymentMethod !== "NONE"
            ) {
                const error = new Error("This event does not require payment.");
                error.statusCode = 400;
                throw error;
            }

            // Validate event-specific fields for every member
            const configuredFields = event.registrationFields || [];

            for (let i = 0; i < members.length; i++) {
                const responses = members[i].customResponses || [];

                if (!Array.isArray(responses)) {
                    const error = new Error(
                        `Invalid custom responses for member ${i + 1}.`
                    );
                    error.statusCode = 400;
                    throw error;
                }

                const seen = new Set();

                for (const response of responses) {
                    const field = configuredFields.find(
                        item => item.fieldKey === response.fieldKey
                    );

                    if (!field || seen.has(response.fieldKey)) {
                        const error = new Error(
                            `Invalid or duplicate custom field for member ${i + 1}.`
                        );
                        error.statusCode = 400;
                        throw error;
                    }

                    seen.add(response.fieldKey);

                    const value = response.value;

                    if (
                        field.required &&
                        (
                            value === undefined ||
                            value === null ||
                            value === ""
                        )
                    ) {
                        const error = new Error(
                            `${field.label} is required for member ${i + 1}.`
                        );
                        error.statusCode = 400;
                        throw error;
                    }

                    if (value !== undefined && value !== null) {
                        if (
                            ["TEXT", "TEXTAREA"].includes(field.fieldType) &&
                            typeof value !== "string"
                        ) {
                            throw new Error(`${field.label} must be text.`);
                        }

                        if (
                            field.fieldType === "NUMBER" &&
                            (typeof value !== "number" || !Number.isFinite(value))
                        ) {
                            throw new Error(`${field.label} must be a valid number.`);
                        }

                        if (
                            ["DROPDOWN", "RADIO"].includes(field.fieldType) &&
                            !field.options.includes(value)
                        ) {
                            throw new Error(`Invalid option for ${field.label}.`);
                        }

                        if (
                            field.fieldType === "CHECKBOX" &&
                            (
                                !Array.isArray(value) ||
                                value.some(option => !field.options.includes(option)) ||
                                new Set(value).size !== value.length
                            )
                        ) {
                            throw new Error(`Invalid selection for ${field.label}.`);
                        }

                        if (
                            field.fieldType === "URL" &&
                            (
                                typeof value !== "string" ||
                                !/^https?:\/\/.+/i.test(value)
                            )
                        ) {
                            throw new Error(`${field.label} must be a valid URL.`);
                        }

                        if (
                            field.fieldType === "DATE" &&
                            (
                                typeof value !== "string" ||
                                Number.isNaN(Date.parse(value))
                            )
                        ) {
                            throw new Error(`${field.label} must be a valid date.`);
                        }
                    }
                }

                for (const field of configuredFields) {
                    if (
                        field.required &&
                        !seen.has(field.fieldKey)
                    ) {
                        const error = new Error(
                            `${field.label} is required for member ${i + 1}.`
                        );
                        error.statusCode = 400;
                        throw error;
                    }
                }
            }

            // Reserve capacity by participant count, not team count
            const updatedEvent = await Event.findOneAndUpdate(
                {
                    _id: event._id,
                    status: "PUBLISHED",
                    "registration.mode": "TEAM",
                    "registration.deadline": { $gte: new Date() },
                    $expr: {
                        $lte: [
                            {
                                $add: [
                                    "$registration.registeredParticipants",
                                    memberCount
                                ]
                            },
                            "$registration.capacity"
                        ]
                    }
                },
                {
                    $inc: {
                        "registration.registeredParticipants": memberCount
                    }
                },
                {
                    new: true,
                    session
                }
            );

            if (!updatedEvent) {
                const error = new Error(
                    "Not enough participant slots are available."
                );
                error.statusCode = 409;
                throw error;
            }

            // Create one Team with shared payment
            const paymentStatus =
                event.registration.registrationFee === 0
                    ? "NOT_REQUIRED"
                    : "PENDING";

            const [team] = await Team.create(
                [
                    {
                        event: event._id,
                        teamName: teamName.trim(),
                        leader: leaderId,
                        memberCount,
                        payment: {
                            method: paymentMethod,
                            status: paymentStatus
                        }
                    }
                ],
                { session }
            );

            // Create one Registration and QR token per participant
            const registrationDocuments = members.map((member, index) => ({
                event: event._id,
                user: index === 0 ? leaderId : null,
                team: team._id,
                isTeamLeader: index === 0,
                participantDetails: Object.fromEntries(
                    requiredFields.map(field => [
                        field,
                        member.participantDetails[field].trim()
                    ])
                ),
                customResponses: member.customResponses || [],

                // Team payment is tracked on the Team document.
                payment: {
                    method: "NONE",
                    status: "NOT_REQUIRED"
                }
            }));

            await Registration.insertMany(registrationDocuments, {
                session
            });
        });

        const createdTeam = await Team.findOne({
            event: req.params.id,
            leader: leaderId,
            teamName: teamName.trim()
        }).sort({ createdAt: -1 });

        const registrations = await Registration.find({
            team: createdTeam._id
        }).select(
            "participantDetails isTeamLeader qrToken status attendance"
        );

        return res.status(201).json({
            success: true,
            message: "Team registered successfully.",
            team: {
                id: createdTeam._id,
                teamName: createdTeam.teamName,
                memberCount: createdTeam.memberCount,
                payment: createdTeam.payment
            },
            registrations
        });

    } catch (error) {
        console.error("Team registration error:", error);

        return res.status(error.statusCode || (
            error.code === 11000 ? 409 : 500
        )).json({
            success: false,
            message: error.code === 11000
                ? "A team with this name already exists for this event."
                : error.message || "Team registration failed."
        });

    } finally {
        await session.endSession();
    }
};

// Admin: verify or reject shared team payment
const updateTeamPaymentStatus = async (req, res) => {
    try {
        const { status } = req.body;

        if (!["VERIFIED", "REJECTED"].includes(status)) {
            return res.status(400).json({
                success: false,
                message: "Payment status must be VERIFIED or REJECTED."
            });
        }

        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid team ID."
            });
        }

        const team = await Team.findById(req.params.id);

        if (!team) {
            return res.status(404).json({
                success: false,
                message: "Team not found."
            });
        }

        if (team.status !== "REGISTERED") {
            return res.status(400).json({
                success: false,
                message: "Cannot update payment for a cancelled team."
            });
        }

        if (team.payment.status !== "PENDING") {
            return res.status(400).json({
                success: false,
                message: `Payment is already ${team.payment.status}.`
            });
        }

        team.payment.status = status;
        team.payment.verifiedBy =
            status === "VERIFIED" ? req.user._id : null;
        team.payment.verifiedAt =
            status === "VERIFIED" ? new Date() : null;

        await team.save();

        return res.status(200).json({
            success: true,
            message: `Team payment ${status.toLowerCase()} successfully.`,
            team: {
                id: team._id,
                teamName: team.teamName,
                memberCount: team.memberCount,
                payment: team.payment
            }
        });

    } catch (error) {
        console.error("Team payment verification error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to update team payment."
        });
    }
};

module.exports = {
    registerTeam,
    updateTeamPaymentStatus
};
