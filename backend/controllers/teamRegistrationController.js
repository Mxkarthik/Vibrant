
const mongoose = require("mongoose");
const Event = require("../models/Event");
const Team = require("../models/Team");
const Registration = require("../models/Registration");
const uploadToCloudinary = require("../utils/uploadToCloudinary");
const deleteCloudinaryImage = require("../utils/deleteCloudinaryImage");
const isValidImageFile = require("../utils/validateImageBuffer");
const { buildRegistrationAccessSnapshot, resolveEffectiveAccess } = require("../utils/registrationEntitlement");
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normalizeObjectId = value => {
    const id = value && typeof value === "object" && value._id ? value._id : value;
    return mongoose.isValidObjectId(id) ? new mongoose.Types.ObjectId(id.toString()) : null;
};
const sameObjectId = (left, right) => {
    const leftId = normalizeObjectId(left);
    const rightId = normalizeObjectId(right);
    return Boolean(leftId && rightId && leftId.equals(rightId));
};

const registerTeam = async (req, res) => {
    let session;
    let uploadedProof = null;
    let registrationCommitted = false;
    let paymentDetails = {};
    try {
        if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
            return res.status(400).json({ success: false, message: "Invalid request body." });
        }

        let { teamName, members, paymentMethod, cashReceiverName } = req.body;
        try {
            if (typeof members === "string") members = JSON.parse(members);
        } catch {
            return res.status(400).json({ success: false, message: "Team member details are invalid." });
        }

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

            if (!details || typeof details !== "object" || Array.isArray(details)) {
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

        const normalizedMobiles = members.map(member => member.participantDetails.mobileNumber.trim().replace(/\D/g, ""));
        if (new Set(normalizedMobiles).size !== normalizedMobiles.length) {
            return res.status(400).json({
                success: false,
                message: "Each team member must have a distinct mobile number."
            });
        }

        const rollCollegeKeys = members.map(member => `${member.participantDetails.collegeName.trim().toLocaleLowerCase()}\u0000${member.participantDetails.rollNumber.trim().toLocaleLowerCase()}`);
        if (new Set(rollCollegeKeys).size !== rollCollegeKeys.length) {
            return res.status(400).json({
                success: false,
                message: "A student can only be listed once on the team."
            });
        }

        const leaderId = req.user._id;
        session = await mongoose.startSession();

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

            const existingLeaderTeam = await Team.findOne({
                event: event._id,
                leader: leaderId,
                status: "REGISTERED"
            }).select("_id").session(session);
            if (existingLeaderTeam) {
                const error = new Error("You already lead a team registered for this event.");
                error.statusCode = 409;
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

            if (event.registration.registrationFee > 0 && paymentMethod === "UPI") {
                if (!event.paymentQrUrl) {
                    const error = new Error("UPI payment is unavailable because the administrator has not configured an event payment QR.");
                    error.statusCode = 400;
                    throw error;
                }
                if (!req.file || !isValidImageFile(req.file)) {
                    const error = new Error("Upload one valid JPG, PNG or WEBP payment screenshot for the shared team payment.");
                    error.statusCode = 400;
                    throw error;
                }
                if (!uploadedProof) {
                    try { uploadedProof = await uploadToCloudinary(req.file.buffer, "vibrant/payment-proofs"); }
                    catch { const error = new Error("Payment proof could not be uploaded. No team registration was created."); error.statusCode = 502; throw error; }
                }
                paymentDetails = { proofUrl: uploadedProof.secureUrl };
            } else if (event.registration.registrationFee > 0 && paymentMethod === "CASH") {
                if (req.file) {
                    const error = new Error("A shared payment screenshot is only accepted for UPI payments.");
                    error.statusCode = 400;
                    throw error;
                }
                if (typeof cashReceiverName !== "string" || !cashReceiverName.trim() || cashReceiverName.trim().length > 120) {
                    const error = new Error("Enter the name of the person who received the shared cash payment (maximum 120 characters).");
                    error.statusCode = 400;
                    throw error;
                }
                paymentDetails = { cashReceiverName: cashReceiverName.trim() };
            } else if (req.file) {
                const error = new Error("Payment proof is not accepted for this registration.");
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

            const registrationIdentities = members.map(member => ({
                "participantDetails.collegeName": { $regex: `^${escapeRegex(member.participantDetails.collegeName.trim())}$`, $options: "i" },
                "participantDetails.rollNumber": { $regex: `^${escapeRegex(member.participantDetails.rollNumber.trim())}$`, $options: "i" }
            }));
            const membershipConflict = await Registration.findOne({
                event: event._id,
                status: "REGISTERED",
                $or: [
                    { "participantDetails.mobileNumber": { $in: members.map(member => member.participantDetails.mobileNumber.trim()) } },
                    ...registrationIdentities
                ]
            }).select("_id").session(session);
            if (membershipConflict) {
                const error = new Error("One or more members already have an active registration for this event.");
                error.statusCode = 409;
                throw error;
            }

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

                try {
                for (const response of responses) {
                    if (!response || typeof response !== "object" || Array.isArray(response) || typeof response.fieldKey !== "string") {
                        throw new Error(`Invalid custom field for member ${i + 1}.`);
                    }
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

                    let value = response.value;

                    if (
                        field.required &&
                        (
                            value === undefined ||
                            value === null ||
                            value === "" ||
                            (Array.isArray(value) && value.length === 0) ||
                            (typeof value === "string" && !value.trim())
                        )
                    ) {
                        const error = new Error(
                            `${field.label} is required for member ${i + 1}.`
                        );
                        error.statusCode = 400;
                        throw error;
                    }

                    if (value !== undefined && value !== null) {
                        if (["TEXT", "TEXTAREA"].includes(field.fieldType)) {
                            if (typeof value !== "string") throw new Error(`${field.label} must be text.`);
                            value = value.trim();
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
                            typeof value !== "string"
                        ) {
                            throw new Error(`${field.label} must be a valid URL.`);
                        }

                        if (field.fieldType === "URL") {
                            try {
                                const parsedUrl = new URL(value);
                                if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error();
                                value = value.trim();
                            } catch {
                                throw new Error(`${field.label} must be a valid HTTP or HTTPS URL.`);
                            }
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
                } catch (validationError) {
                    if (!validationError.statusCode) validationError.statusCode = 400;
                    throw validationError;
                }
            }

            // If Multi-Event Access combo is enabled, validate included events lifecycle and compatibility
            if (event.multiEventAccess && event.multiEventAccess.enabled === true) {
                const included = event.multiEventAccess.includedEvents;
                if (!Array.isArray(included) || included.length === 0) {
                    const error = new Error("This combo event is not properly configured with included events");
                    error.statusCode = 400;
                    throw error;
                }

                // Check self-inclusion and duplicate entries
                const parentIdStr = event._id.toString();
                const seenChildIds = new Set();
                for (const rawChildId of included) {
                    const childIdStr = (rawChildId && rawChildId._id ? rawChildId._id : rawChildId).toString();
                    if (childIdStr === parentIdStr) {
                        const error = new Error("A combo event cannot include itself in multi-event access");
                        error.statusCode = 400;
                        throw error;
                    }
                    if (seenChildIds.has(childIdStr)) {
                        const error = new Error(`Duplicate event ID found in includedEvents: "${childIdStr}"`);
                        error.statusCode = 400;
                        throw error;
                    }
                    seenChildIds.add(childIdStr);
                }

                const childQuery = Event.find({
                    _id: { $in: included }
                }).select("name status registration.mode multiEventAccess");
                if (session && typeof childQuery.session === "function") {
                    childQuery.session(session);
                }
                const childEvents = await childQuery.lean();

                if (childEvents.length !== included.length) {
                    const error = new Error("One or more included events do not exist");
                    error.statusCode = 400;
                    throw error;
                }

                for (const child of childEvents) {
                    if (child.status !== "PUBLISHED") {
                        const error = new Error(`Cannot register for combo: included event "${child.name || child._id}" is not published (status: ${child.status})`);
                        error.statusCode = 400;
                        throw error;
                    }
                    if (child.multiEventAccess?.enabled === true) {
                        const error = new Error(`Cannot register for combo: included event "${child.name || child._id}" is already a multi-event parent (nested combos are prohibited)`);
                        error.statusCode = 400;
                        throw error;
                    }
                    if (child.registration?.mode !== "TEAM") {
                        const error = new Error(`Cannot register for combo: included event "${child.name || child._id}" requires ${child.registration?.mode || "INDIVIDUAL"} registration`);
                        error.statusCode = 400;
                        throw error;
                    }
                }
            }

            // Build base entitlement snapshot (SINGLE_EVENT for standard, MULTI_EVENT for combo)
            const baseAccess = buildRegistrationAccessSnapshot({ event });

            // Reserve capacity by participant count on parent event only
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
            const fee = event.registration.registrationFee || 0;
            const paymentStatus =
                fee === 0
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
                            status: paymentStatus,
                            expectedAmount: fee,
                            receivedAmount: fee === 0 ? 0 : null,
                            currency: "INR",
                            ...paymentDetails
                        }
                    }
                ],
                { session }
            );

            // Create one Registration and QR token per participant with independent access snapshots
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
                    status: "NOT_REQUIRED",
                    expectedAmount: null,
                    receivedAmount: null,
                    currency: "INR"
                },

                // Each member receives an independent snapshot object
                access: {
                    type: baseAccess.type,
                    eligibleEventIds: [...baseAccess.eligibleEventIds],
                    grantedAt: new Date(baseAccess.grantedAt)
                }
            }));

            await Registration.insertMany(registrationDocuments, {
                session
            });
        });
        registrationCommitted = true;

        const createdTeam = await Team.findOne({
            event: req.params.id,
            leader: leaderId,
            teamName: teamName.trim()
        }).sort({ createdAt: -1 });

        const registrations = await Registration.find({
            team: createdTeam._id
        }).select("participantDetails isTeamLeader status");

        return res.status(201).json({
            success: true,
            message: "Team registered successfully.",
            team: {
                id: createdTeam._id,
                teamName: createdTeam.teamName,
                memberCount: createdTeam.memberCount,
                payment: createdTeam.payment
            },
            registrations: registrations.map(registration => ({
                id: registration._id,
                participantDetails: registration.participantDetails,
                isTeamLeader: registration.isTeamLeader,
                status: registration.status
            }))
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
        if (session) await session.endSession();
        if (!registrationCommitted && uploadedProof?.publicId) {
            try { await deleteCloudinaryImage(uploadedProof.publicId); }
            catch (cleanupError) { console.error("Unable to remove abandoned team proof upload:", cleanupError.message); }
        }
    }
};

// Team leaders may view only teams they created. QR tokens and payment proof metadata are not selected.
const getLeaderTeamById = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({ success: false, message: "Invalid team ID." });
        }

        const team = await Team.findOne({ _id: id, leader: req.user._id })
            .select("event teamName leader memberCount status payment.method payment.status payment.proofUrl payment.cashReceiverName createdAt")
            .populate("event", "name category poster venue startDate endDate status paymentQrUrl registration.registrationFee")
            .lean();
        if (!team) {
            return res.status(404).json({ success: false, message: "Team not found." });
        }

        const registrations = await Registration.find({ team: team._id })
            .select("participantDetails isTeamLeader status createdAt")
            .sort({ isTeamLeader: -1, createdAt: 1 })
            .lean();

        return res.status(200).json({
            success: true,
            team: {
                id: team._id,
                teamName: team.teamName,
                memberCount: team.memberCount,
                status: team.status,
                createdAt: team.createdAt,
                payment: team.payment,
                event: team.event,
                members: registrations.map(registration => ({
                    registrationId: registration._id,
                    participantDetails: registration.participantDetails,
                    isTeamLeader: registration.isTeamLeader,
                    status: registration.status,
                    registeredAt: registration.createdAt
                }))
            }
        });
    } catch (error) {
        console.error("Get leader team error:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch team details." });
    }
};

const getLeaderTeamTickets = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({ success: false, code: "INVALID_TEAM", message: "Invalid team reference." });
        }

        const team = await Team.findById(id)
            .select("leader event teamName memberCount status payment.status")
            .populate("event", "name category venue startDate endDate status")
            .lean();
        if (!team) {
            return res.status(404).json({ success: false, code: "TEAM_NOT_FOUND", message: "Team not found." });
        }
        if (!sameObjectId(team.leader, req.user?._id)) {
            return res.status(403).json({ success: false, code: "TEAM_LEADER_REQUIRED", message: "Only this team's leader can access its tickets." });
        }
        if (!team.event) {
            return res.status(404).json({ success: false, code: "TEAM_EVENT_NOT_FOUND", message: "The event for this team could not be found." });
        }
        if (team.status !== "REGISTERED") {
            return res.status(409).json({ success: false, code: "TEAM_CANCELLED", message: "This team registration is cancelled and has no valid tickets." });
        }
        if (team.event.status === "CANCELLED") {
            return res.status(409).json({ success: false, code: "EVENT_CANCELLED", message: "This event was cancelled. Its tickets are not valid." });
        }

        const paymentStatus = team.payment?.status || "NOT_REQUIRED";
        if (!["VERIFIED", "NOT_REQUIRED"].includes(paymentStatus)) {
            return res.status(409).json({ success: false, code: "PAYMENT_NOT_ELIGIBLE", message: "Team tickets are available after the shared payment is verified." });
        }

        const registrations = await Registration.find({ team: team._id, status: "REGISTERED" })
            .select("qrToken participantDetails.fullName status isTeamLeader access event createdAt")
            .sort({ isTeamLeader: -1, createdAt: 1 })
            .lean();
        const tickets = registrations
            .filter(registration => typeof registration.qrToken === "string" && /^[a-f0-9]{64}$/i.test(registration.qrToken))
            .map(registration => {
                const effectiveAccess = resolveEffectiveAccess(registration);
                return {
                    registrationId: registration._id,
                    attendeeName: registration.participantDetails?.fullName || "Participant",
                    isTeamLeader: Boolean(registration.isTeamLeader),
                    registrationStatus: registration.status,
                    qrToken: registration.qrToken,
                    access: {
                        type: effectiveAccess.type,
                        eligibleEventIds: effectiveAccess.eligibleEventIds,
                        grantedAt: effectiveAccess.grantedAt
                    }
                };
            });

        if (!tickets.length) {
            return res.status(409).json({ success: false, code: "QR_UNAVAILABLE", message: "No valid ticket QR codes are available for this team." });
        }

        return res.status(200).json({
            success: true,
            team: {
                name: team.teamName,
                memberCount: team.memberCount,
                paymentStatus,
                ticketStatus: team.event.status === "COMPLETED" ? "HISTORICAL" : "VALID",
                event: {
                    name: team.event.name,
                    category: team.event.category,
                    venue: team.event.venue,
                    startDate: team.event.startDate,
                    endDate: team.event.endDate,
                    status: team.event.status
                }
            },
            tickets,
            unavailableCount: Math.max(0, registrations.length - tickets.length)
        });
    } catch (error) {
        console.error("Get team tickets error:", error);
        return res.status(500).json({ success: false, message: "Failed to load team tickets." });
    }
};

// Admin: update shared team payment status (reversible)
// @route   PATCH /api/teams/:id/payment
// @access  ADMIN only
//
// Supported transitions (all six directions):
//   PENDING  → VERIFIED | REJECTED
//   VERIFIED → PENDING  | REJECTED
//   REJECTED → PENDING  | VERIFIED
// NOT_REQUIRED payments cannot be changed.
// A reason is required when setting status to REJECTED.
// Capacity (Event.registration.registeredParticipants) is adjusted by team.memberCount:
//   * → REJECTED : decrement by memberCount
//   REJECTED → * : increment by memberCount (guards against exceeding capacity)

const updateTeamPaymentStatus = async (req, res) => {
    const session = await mongoose.startSession();
    try {
        const { status: requestedStatus, reason } = req.body || {};

        // --- Input validation ---
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            await session.endSession();
            return res.status(400).json({ success: false, message: "Invalid team ID." });
        }

        const validTargetStatuses = ["PENDING", "VERIFIED", "REJECTED"];
        if (!validTargetStatuses.includes(requestedStatus)) {
            await session.endSession();
            return res.status(400).json({
                success: false,
                message: "Payment status must be PENDING, VERIFIED, or REJECTED."
            });
        }

        const trimmedReason = typeof reason === "string" ? reason.trim() : "";
        if (requestedStatus === "REJECTED" && !trimmedReason) {
            await session.endSession();
            return res.status(400).json({
                success: false,
                message: "A reason is required when rejecting a team payment."
            });
        }

        let result;
        await session.withTransaction(async () => {
            const team = await Team.findById(req.params.id).session(session);

            if (!team) {
                const error = new Error("Team not found.");
                error.statusCode = 404;
                throw error;
            }

            if (team.status !== "REGISTERED") {
                const error = new Error("Cannot update payment for a cancelled team.");
                error.statusCode = 409;
                throw error;
            }

            const currentStatus = team.payment.status;

            if (currentStatus === "NOT_REQUIRED") {
                const error = new Error("Payments marked as not required cannot be changed.");
                error.statusCode = 409;
                throw error;
            }

            // No-op: requested status equals current status
            if (currentStatus === requestedStatus) {
                result = { noOp: true, team };
                return;
            }

            const memberCount = team.memberCount;

            // --- Capacity adjustment ---
            const releasingCapacity = requestedStatus === "REJECTED";
            const reclaimingCapacity = currentStatus === "REJECTED";

            if (releasingCapacity) {
                // Decrement by memberCount. The counter must be >= memberCount;
                // if the event is not found or the guard fails, abort — do not
                // mutate payment state.
                const decremented = await Event.findOneAndUpdate(
                    {
                        _id: team.event,
                        "registration.registeredParticipants": { $gte: memberCount }
                    },
                    { $inc: { "registration.registeredParticipants": -memberCount } },
                    { new: true, session }
                );

                if (!decremented) {
                    const error = new Error(
                        "Team payment cannot be rejected: the event capacity counter is inconsistent or the event was not found"
                    );
                    error.statusCode = 409;
                    throw error;
                }
            } else if (reclaimingCapacity) {
                // Increment by memberCount; fail if would exceed capacity
                const updatedEvent = await Event.findOneAndUpdate(
                    {
                        _id: team.event,
                        $expr: {
                            $lte: [
                                { $add: ["$registration.registeredParticipants", memberCount] },
                                "$registration.capacity"
                            ]
                        }
                    },
                    { $inc: { "registration.registeredParticipants": memberCount } },
                    { new: true, session }
                );

                if (!updatedEvent) {
                    const error = new Error(
                        "Cannot re-activate this team: the event does not have enough remaining capacity"
                    );
                    error.statusCode = 409;
                    throw error;
                }
            }

            // --- Mutation ---
            const changedAt = new Date();

            team.payment.status = requestedStatus;

            if (requestedStatus === "VERIFIED") {
                team.payment.verifiedBy = req.user._id;
                team.payment.verifiedAt = changedAt;

                if (typeof req.body?.receivedAmount === "number" && Number.isFinite(req.body.receivedAmount) && req.body.receivedAmount >= 0) {
                    team.payment.receivedAmount = req.body.receivedAmount;
                } else if (team.payment.receivedAmount == null && team.payment.expectedAmount != null) {
                    team.payment.receivedAmount = team.payment.expectedAmount;
                }
            } else {
                team.payment.verifiedBy = null;
                team.payment.verifiedAt = null;
                team.payment.receivedAmount = null;
            }

            // Append audit entry
            if (!Array.isArray(team.payment.history)) {
                team.payment.history = [];
            }
            team.payment.history.push({
                fromStatus: currentStatus,
                toStatus: requestedStatus,
                changedBy: req.user._id,
                changedAt,
                reason: trimmedReason || null
            });

            await team.save({ session });
            result = { noOp: false, team };
        });

        if (result.noOp) {
            return res.status(200).json({
                success: true,
                message: `Team payment is already ${requestedStatus.toLowerCase()}. No change made.`,
                team: {
                    id: result.team._id,
                    teamName: result.team.teamName,
                    memberCount: result.team.memberCount,
                    status: result.team.status,
                    payment: {
                        method: result.team.payment.method,
                        status: result.team.payment.status,
                        verifiedAt: result.team.payment.verifiedAt
                    }
                }
            });
        }

        return res.status(200).json({
            success: true,
            message: `Team payment ${requestedStatus.toLowerCase()} successfully.`,
            team: {
                id: result.team._id,
                teamName: result.team.teamName,
                memberCount: result.team.memberCount,
                status: result.team.status,
                payment: {
                    method: result.team.payment.method,
                    status: result.team.payment.status,
                    verifiedAt: result.team.payment.verifiedAt
                }
            }
        });

    } catch (error) {
        console.error("Team payment update error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.statusCode
                ? error.message
                : "Failed to update team payment."
        });
    } finally {
        await session.endSession();
    }
};


const uploadTeamPaymentProof = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid team ID"
            });
        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "Payment screenshot is required"
            });
        }

        const team = await Team.findById(id);

        if (!team) {
            return res.status(404).json({
                success: false,
                message: "Team not found"
            });
        }

        // Only the team leader can upload shared payment proof
        if (team.leader.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: "Only the team leader can upload payment proof"
            });
        }

        if (team.status !== "REGISTERED") {
            return res.status(400).json({
                success: false,
                message: "Invalid team status"
            });
        }

        if (team.payment.method !== "UPI") {
            return res.status(400).json({
                success: false,
                message: "Payment proof upload is only available for UPI payments"
            });
        }

        if (team.payment.status !== "PENDING") {
            return res.status(400).json({
                success: false,
                message: "Team payment is not in PENDING status"
            });
        }

        if (team.payment.proofUrl) {
            return res.status(409).json({
                success: false,
                message: "Team payment proof has already been uploaded"
            });
        }

        const uploadedImage = await uploadToCloudinary(req.file.buffer);

        team.payment.proofUrl = uploadedImage.url;

        await team.save();

        return res.status(200).json({
            success: true,
            message: "Team payment proof uploaded successfully",
            proofUrl: uploadedImage.url
        });

    } catch (error) {
        console.error("Team payment proof upload error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to upload team payment proof"
        });
    }
};


module.exports = {
    registerTeam,
    getLeaderTeamById,
    getLeaderTeamTickets,
    updateTeamPaymentStatus,
    uploadTeamPaymentProof
};
