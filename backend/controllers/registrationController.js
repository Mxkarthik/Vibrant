
const mongoose = require("mongoose");
const Event = require("../models/Event");
const Registration = require("../models/Registration");
const Team = require("../models/Team");
const User = require("../models/User");
const { getCertificateEligibility, issueCertificateRecord } = require("../utils/certificateEligibility");
const { drawCertificate } = require("../utils/certificatePdf");
const PDFDocument = require("pdfkit");
const uploadToCloudinary = require("../utils/uploadToCloudinary");
const deleteCloudinaryImage = require("../utils/deleteCloudinaryImage");
const isValidImageFile = require("../utils/validateImageBuffer");
const { buildRegistrationAccessSnapshot, resolveEffectiveAccess } = require("../utils/registrationEntitlement");
const { resolveRegistrationAdmissionEligibility } = require("../utils/admissionEligibility");
const {
    sanitizeForExcel,
    buildEventCohortFilter,
    buildAttendanceMatchCondition,
    resolveEventSpecificAttendance,
    calculateEventAttendanceStats
} = require("../utils/eventAttendanceReportService");
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
    let uploadedProof = null;
    let registrationCommitted = false;

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

    let participantDetails;
    let customResponses = [];
    let paymentMethod;
    let cashReceiverName;
    try {
        participantDetails = typeof req.body.participantDetails === "string" ? JSON.parse(req.body.participantDetails) : req.body.participantDetails;
        customResponses = typeof req.body.customResponses === "string" ? JSON.parse(req.body.customResponses) : (req.body.customResponses || []);
        paymentMethod = req.body.paymentMethod;
        cashReceiverName = req.body.cashReceiverName;
    } catch {
        return res.status(400).json({ success: false, message: "Registration details are invalid." });
    }

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

            let normalizedResponses;
            try {
                normalizedResponses = validateCustomResponses(
                    event.registrationFields || [],
                    customResponses
                );
            } catch (validationError) {
                validationError.statusCode = 400;
                throw validationError;
            }

            const fee = event.registration.registrationFee || 0;

            let payment;

            if (fee === 0) {
                if (req.file) {
                    const error = new Error("Payment proof is not accepted for a free event.");
                    error.statusCode = 400;
                    throw error;
                }
                payment = {
                    method: "NONE",
                    status: "NOT_REQUIRED",
                    expectedAmount: 0,
                    receivedAmount: 0,
                    currency: "INR"
                };
            } else {
                if (!["UPI", "CASH"].includes(paymentMethod)) {
                    const error = new Error("Select UPI or CASH payment method");
                    error.statusCode = 400;
                    throw error;
                }

                let paymentDetails = {};
                if (paymentMethod === "UPI") {
                    if (!event.paymentQrUrl) {
                        const error = new Error("UPI payment is unavailable because the administrator has not configured an event payment QR.");
                        error.statusCode = 400;
                        throw error;
                    }
                    if (!req.file || !isValidImageFile(req.file)) {
                        const error = new Error("Upload a valid JPG, PNG or WEBP payment screenshot before submitting.");
                        error.statusCode = 400;
                        throw error;
                    }
                    if (!uploadedProof) {
                        try { uploadedProof = await uploadToCloudinary(req.file.buffer, "vibrant/payment-proofs"); }
                        catch { const error = new Error("Payment proof could not be uploaded. No registration was created."); error.statusCode = 502; throw error; }
                    }
                    paymentDetails.proofUrl = uploadedProof.secureUrl;
                } else {
                    if (req.file) {
                        const error = new Error("A payment screenshot is only accepted for UPI payments.");
                        error.statusCode = 400;
                        throw error;
                    }
                    if (typeof cashReceiverName !== "string" || !cashReceiverName.trim() || cashReceiverName.trim().length > 120) {
                        const error = new Error("Enter the name of the person who received the cash (maximum 120 characters).");
                        error.statusCode = 400;
                        throw error;
                    }
                    paymentDetails.cashReceiverName = cashReceiverName.trim();
                }

                payment = {
                    method: paymentMethod,
                    status: "PENDING",
                    expectedAmount: fee,
                    receivedAmount: null,
                    currency: "INR",
                    ...paymentDetails
                };
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
                    if (child.registration?.mode !== "INDIVIDUAL") {
                        const error = new Error(`Cannot register for combo: included event "${child.name || child._id}" requires ${child.registration?.mode || "TEAM"} registration`);
                        error.statusCode = 400;
                        throw error;
                    }
                }
            }

            // Build immutable entitlement snapshot (SINGLE_EVENT for standard, MULTI_EVENT for combo)
            const accessSnapshot = buildRegistrationAccessSnapshot({ event });

            // Atomically reserve one participant slot on the parent event.
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
                        payment,
                        access: accessSnapshot
                    }
                ],
                { session }
            );

            createdRegistration = registration;
        });
        registrationCommitted = true;

        return res.status(201).json({
            success: true,
            message: "Registration successful",
            registration: {
                _id: createdRegistration._id,
                status: createdRegistration.status,
                payment: {
                    method: createdRegistration.payment.method,
                    status: createdRegistration.payment.status,
                    proofUrl: createdRegistration.payment.proofUrl || null,
                    cashReceiverName: createdRegistration.payment.cashReceiverName || null
                }
            }
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
        if (!registrationCommitted && uploadedProof?.publicId) {
            try { await deleteCloudinaryImage(uploadedProof.publicId); }
            catch (cleanupError) { console.error("Unable to remove abandoned registration proof upload:", cleanupError.message); }
        }
    }
};


// @desc    Get registrations of logged-in participant
// @route   GET /api/registrations/my
// @access  PARTICIPANT only; records are scoped to the verified session user

const getMyRegistrations = async (req, res) => {
    try {
        const registrations = await Registration.find({
            user: req.user._id
        })
            .select("event team isTeamLeader status createdAt participantDetails.fullName payment.method payment.status attendance.isPresent attendance.checkedInAt certificate.certificateId certificate.issuedAt certificate.isIssued")
            .populate("event", "name category poster venue startDate endDate status registration.registrationFee")
            .populate("team", "teamName memberCount status payment.status")
            .sort({ createdAt: -1 })
            .lean();

        return res.status(200).json({
            success: true,
            count: registrations.length,
            registrations: registrations.map(registration => ({
                id: registration._id,
                createdAt: registration.createdAt,
                status: registration.status,
                attendance: {
                    isPresent: registration.attendance?.isPresent === true,
                    checkedInAt: registration.attendance?.checkedInAt || null
                },
                participantName: registration.participantDetails?.fullName || null,
                certificate: {
                    isIssued: registration.certificate?.isIssued === true,
                    certificateId: registration.certificate?.isIssued === true ? registration.certificate.certificateId || null : null,
                    issuedAt: registration.certificate?.isIssued === true ? registration.certificate.issuedAt || null : null
                },
                isTeam: Boolean(registration.team),
                isTeamLeader: Boolean(registration.isTeamLeader),
                teamId: registration.isTeamLeader && registration.team ? registration.team._id : null,
                teamStatus: registration.team?.status || null,
                team: registration.team ? {
                    name: registration.team.teamName,
                    memberCount: registration.team.memberCount,
                    paymentStatus: registration.team.payment?.status || "NOT_REQUIRED"
                } : null,
                payment: registration.team
                    ? { method: "SHARED", status: registration.team.payment?.status || "NOT_REQUIRED" }
                    : { method: registration.payment?.method || "NONE", status: registration.payment?.status || "NOT_REQUIRED" },
                amount: registration.team
                    ? null
                    : typeof registration.event?.registration?.registrationFee === "number"
                        ? registration.event.registration.registrationFee
                        : null,
                event: registration.event ? {
                    id: registration.event._id,
                    name: registration.event.name,
                    category: registration.event.category,
                    poster: registration.event.poster || null,
                    venue: registration.event.venue,
                    startDate: registration.event.startDate,
                    endDate: registration.event.endDate,
                    status: registration.event.status
                } : null
            }))
        });

    } catch (error) {
        console.error("Get my registrations error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch your registrations"
        });
    }
};

const getMyRegistrationTicket = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({ success: false, code: "INVALID_REGISTRATION", message: "Invalid registration reference." });
        }

        const registration = await Registration.findOne({
            _id: id,
            user: req.user._id,
            team: null
        })
            .select("qrToken status participantDetails.fullName payment.status event access createdAt")
            .populate("event", "name category venue startDate endDate status")
            .lean();

        if (!registration || !registration.event) {
            return res.status(404).json({ success: false, code: "TICKET_NOT_FOUND", message: "Ticket not found for this account." });
        }
        if (registration.status !== "REGISTERED") {
            return res.status(409).json({ success: false, code: "REGISTRATION_CANCELLED", message: "This registration is cancelled and has no valid ticket." });
        }
        if (registration.event.status === "CANCELLED") {
            return res.status(409).json({ success: false, code: "EVENT_CANCELLED", message: "This event was cancelled. Its ticket is not valid." });
        }
        if (!registration.qrToken || !/^[a-f0-9]{64}$/i.test(registration.qrToken)) {
            return res.status(409).json({ success: false, code: "QR_UNAVAILABLE", message: "A valid ticket QR is not available for this registration." });
        }
        const paymentStatus = registration.payment?.status || "NOT_REQUIRED";
        if (!["VERIFIED", "NOT_REQUIRED"].includes(paymentStatus)) {
            return res.status(409).json({ success: false, code: "PAYMENT_NOT_ELIGIBLE", message: "A ticket is available after payment is verified." });
        }

        const effectiveAccess = resolveEffectiveAccess(registration);

        return res.status(200).json({
            success: true,
            ticket: {
                registrationId: registration._id,
                registrationType: "INDIVIDUAL",
                attendeeName: registration.participantDetails?.fullName || "Participant",
                qrToken: registration.qrToken,
                registrationStatus: registration.status,
                paymentStatus,
                ticketStatus: registration.event.status === "COMPLETED" ? "HISTORICAL" : "VALID",
                event: {
                    name: registration.event.name,
                    category: registration.event.category,
                    venue: registration.event.venue,
                    startDate: registration.event.startDate,
                    endDate: registration.event.endDate,
                    status: registration.event.status
                },
                access: {
                    type: effectiveAccess.type,
                    eligibleEventIds: effectiveAccess.eligibleEventIds,
                    grantedAt: effectiveAccess.grantedAt
                }
            }
        });
    } catch (error) {
        console.error("Get participant ticket error:", error);
        return res.status(500).json({ success: false, message: "Failed to load ticket." });
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
            .select("name organizers");

        if (!event) {
            return res.status(404).json({
                success: false,
                message: "Event not found"
            });
        }

        const isAdmin = req.user.role === "ADMIN";
        const isOrganiser = req.user.role === "ORGANISER";

        if (!isAdmin && !isOrganiser) {
            return res.status(403).json({
                success: false,
                code: "FORBIDDEN",
                message: "You are not authorized to view these participants"
            });
        }

        if (isOrganiser && Array.isArray(event.organizers) && event.organizers.length > 0) {
            const isAssigned = event.organizers.some(
                orgId => orgId.toString() === req.user._id.toString()
            );
            if (!isAssigned) {
                return res.status(403).json({
                    success: false,
                    code: "ORGANISER_NOT_ASSIGNED",
                    message: "You are not authorized to view these participants"
                });
            }
        }

        const page = Number.parseInt(req.query.page, 10) || 1;
        const limit = Number.parseInt(req.query.limit, 10) || 20;
        const { search = "", type = "", paymentStatus = "", attendance = "", status = "REGISTERED" } = req.query;

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

        if (typeof search !== "string" || typeof type !== "string" || typeof paymentStatus !== "string" || typeof attendance !== "string" || typeof status !== "string") {
            return res.status(400).json({ success: false, message: "Invalid participant filters" });
        }
        if (type && !["INDIVIDUAL", "TEAM"].includes(type)) {
            return res.status(400).json({ success: false, message: "Invalid registration type" });
        }
        if (paymentStatus && !["NOT_REQUIRED", "PENDING", "VERIFIED", "REJECTED"].includes(paymentStatus)) {
            return res.status(400).json({ success: false, message: "Invalid payment status" });
        }
        if (attendance && !["PRESENT", "ABSENT"].includes(attendance)) {
            return res.status(400).json({ success: false, message: "Invalid attendance status" });
        }
        if (!["REGISTERED", "CANCELLED", "ALL"].includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid registration status" });
        }

        const targetObjectId = new mongoose.Types.ObjectId(id);
        const filter = buildEventCohortFilter(targetObjectId, status);

        if (type === "INDIVIDUAL") filter.team = null;
        if (type === "TEAM") filter.team = { $ne: null };

        const attendanceMatch = buildAttendanceMatchCondition(targetObjectId, attendance);
        if (attendanceMatch) {
            filter.$and = [...(filter.$and || []), attendanceMatch];
        }

        if (paymentStatus) {
            const paymentClauses = [];
            if (type !== "TEAM") paymentClauses.push({ team: null, "payment.status": paymentStatus });
            if (type !== "INDIVIDUAL") {
                const matchingTeams = await Team.find({ "payment.status": paymentStatus }).distinct("_id");
                if (matchingTeams.length) paymentClauses.push({ team: { $in: matchingTeams } });
            }
            if (!paymentClauses.length) {
                filter._id = { $exists: false };
            } else if (paymentClauses.length === 1) {
                Object.assign(filter, paymentClauses[0]);
            } else {
                filter.$or = paymentClauses;
            }
        }

        if (search.trim()) {
            const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const searchPattern = { $regex: escaped, $options: "i" };
            const [matchingUsers, matchingTeams] = await Promise.all([
                User.find({ $or: [{ name: searchPattern }, { email: searchPattern }] }).distinct("_id"),
                Team.find({ teamName: searchPattern }).distinct("_id")
            ]);
            const searchClauses = [
                { "participantDetails.fullName": searchPattern },
                { "participantDetails.mobileNumber": searchPattern },
                { "participantDetails.collegeName": searchPattern },
                { "participantDetails.department": searchPattern },
                { "participantDetails.section": searchPattern },
                { "participantDetails.yearOfStudy": searchPattern },
                { "participantDetails.rollNumber": searchPattern }
            ];
            if (matchingUsers.length) searchClauses.push({ user: { $in: matchingUsers } });
            if (matchingTeams.length) searchClauses.push({ team: { $in: matchingTeams } });
            filter.$and = [...(filter.$and || []), { $or: searchClauses }];
        }

        const [rawRegistrations, total] = await Promise.all([
            Registration.find(filter)
                .select("-qrToken")
                .populate("user", "name email")
                .populate({ path: "team", select: "teamName memberCount leader payment.status", populate: { path: "leader", select: "name email" } })
                .populate("event", "name")
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),

            Registration.countDocuments(filter)
        ]);

        const registrations = rawRegistrations.map(r => {
            const att = resolveEventSpecificAttendance(r, targetObjectId);
            return {
                ...r,
                attendance: {
                    isPresent: att.isPresent,
                    checkedInAt: att.checkedInAt
                },
                cohortType: att.cohortType,
                parentEvent: att.cohortType === "COMBO" ? r.event : null
            };
        });

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
// @access  Owner, ADMIN or global ORGANISER

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
            .select("-qrToken")
            .populate("user", "name email")
            .populate("event", "name category venue startDate endDate status paymentQrUrl registration.registrationFee")
            .populate({ path: "team", select: "teamName memberCount leader payment.status", populate: { path: "leader", select: "name email" } });

        if (!registration) {
            return res.status(404).json({
                success: false,
                message: "Registration not found"
            });
        }

        const isOwner =
            registration.user?._id?.toString() === req.user._id.toString();

        const isAdmin = req.user.role === "ADMIN";

        const isOrganiser = req.user.role === "ORGANISER";

        if (!isOwner && !isAdmin && !isOrganiser) {
            return res.status(403).json({
                success: false,
                message: "You are not authorized to view this registration"
            });
        }

        let teamMembers;
        if (registration.team && (isAdmin || isOrganiser)) {
            const members = await Registration.find({ team: registration.team._id, status: "REGISTERED" })
                .select("participantDetails.fullName user isTeamLeader")
                .populate("user", "name email")
                .lean();
            teamMembers = members.map(member => ({
                name: member.participantDetails?.fullName || member.user?.name || "Participant",
                email: member.user?.email || null,
                isTeamLeader: Boolean(member.isTeamLeader)
            }));
        }

        return res.status(200).json({
            success: true,
            registration,
            ...(teamMembers ? { teamMembers } : {})
        });

    } catch (error) {
        console.error("Get registration error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch registration"
        });
    }
};


// @desc    Update individual payment status (reversible)
// @route   PATCH /api/registrations/:id/payment
// @access  ADMIN only
//
// Supported transitions (all six directions):
//   PENDING  → VERIFIED | REJECTED
//   VERIFIED → PENDING  | REJECTED
//   REJECTED → PENDING  | VERIFIED
// NOT_REQUIRED payments cannot be changed.
// A reason is required when setting status to REJECTED.
// Capacity (Event.registration.registeredParticipants) is adjusted:
//   * → REJECTED : decrement by 1
//   REJECTED → * : increment by 1 (guards against exceeding capacity)

const updatePaymentStatus = async (req, res) => {
    const session = await mongoose.startSession();
    try {
        const { id } = req.params;
        const { status: requestedStatus, reason } = req.body || {};

        // --- Input validation ---
        if (!mongoose.isValidObjectId(id)) {
            await session.endSession();
            return res.status(400).json({ success: false, message: "Invalid registration ID" });
        }

        const validTargetStatuses = ["PENDING", "VERIFIED", "REJECTED"];
        if (!validTargetStatuses.includes(requestedStatus)) {
            await session.endSession();
            return res.status(400).json({
                success: false,
                message: "Payment status must be PENDING, VERIFIED, or REJECTED"
            });
        }

        // Reason is required only for REJECTED; validate early so we fail fast.
        const trimmedReason = typeof reason === "string" ? reason.trim() : "";
        if (requestedStatus === "REJECTED" && !trimmedReason) {
            await session.endSession();
            return res.status(400).json({
                success: false,
                message: "A reason is required when rejecting a payment"
            });
        }

        let result;
        await session.withTransaction(async () => {
            const registration = await Registration.findById(id).session(session);

            if (!registration) {
                const error = new Error("Registration not found");
                error.statusCode = 404;
                throw error;
            }

            if (registration.status !== "REGISTERED") {
                const error = new Error("Payments for cancelled registrations cannot be updated");
                error.statusCode = 409;
                throw error;
            }

            const currentStatus = registration.payment.status;

            if (currentStatus === "NOT_REQUIRED") {
                const error = new Error("Payments marked as not required cannot be changed");
                error.statusCode = 409;
                throw error;
            }

            // No-op: requested status equals current status
            if (currentStatus === requestedStatus) {
                result = { noOp: true, registration };
                return;
            }

            // --- Capacity adjustment ---
            const releasingCapacity = requestedStatus === "REJECTED";
            const reclaimingCapacity = currentStatus === "REJECTED";

            if (releasingCapacity) {
                // Decrement by 1. The counter must be > 0; if the event is not
                // found or the guard fails, abort — do not mutate payment state.
                const decremented = await Event.findOneAndUpdate(
                    {
                        _id: registration.event,
                        "registration.registeredParticipants": { $gt: 0 }
                    },
                    { $inc: { "registration.registeredParticipants": -1 } },
                    { new: true, session }
                );

                if (!decremented) {
                    const error = new Error(
                        "Payment cannot be rejected: the event capacity counter is inconsistent or the event was not found"
                    );
                    error.statusCode = 409;
                    throw error;
                }
            } else if (reclaimingCapacity) {
                // Increment by 1; fail if at capacity
                const updatedEvent = await Event.findOneAndUpdate(
                    {
                        _id: registration.event,
                        $expr: {
                            $lt: [
                                "$registration.registeredParticipants",
                                "$registration.capacity"
                            ]
                        }
                    },
                    { $inc: { "registration.registeredParticipants": 1 } },
                    { new: true, session }
                );

                if (!updatedEvent) {
                    const error = new Error(
                        "Cannot re-activate this registration: the event is at capacity"
                    );
                    error.statusCode = 409;
                    throw error;
                }
            }

            // --- Mutation ---
            const changedAt = new Date();

            registration.payment.status = requestedStatus;

            if (requestedStatus === "VERIFIED") {
                registration.payment.verifiedBy = req.user._id;
                registration.payment.verifiedAt = changedAt;

                if (typeof req.body?.receivedAmount === "number" && Number.isFinite(req.body.receivedAmount) && req.body.receivedAmount >= 0) {
                    registration.payment.receivedAmount = req.body.receivedAmount;
                } else if (registration.payment.receivedAmount == null && registration.payment.expectedAmount != null) {
                    registration.payment.receivedAmount = registration.payment.expectedAmount;
                }
            } else {
                registration.payment.verifiedBy = null;
                registration.payment.verifiedAt = null;
                registration.payment.receivedAmount = null;
            }

            // Append audit entry
            if (!Array.isArray(registration.payment.history)) {
                registration.payment.history = [];
            }
            registration.payment.history.push({
                fromStatus: currentStatus,
                toStatus: requestedStatus,
                changedBy: req.user._id,
                changedAt,
                reason: trimmedReason || null
            });

            await registration.save({ session });
            result = { noOp: false, registration };
        });

        if (result.noOp) {
            return res.status(200).json({
                success: true,
                message: `Payment is already ${requestedStatus.toLowerCase()}. No change made.`,
                registration: {
                    id: result.registration._id,
                    status: result.registration.status,
                    payment: {
                        method: result.registration.payment.method,
                        status: result.registration.payment.status,
                        verifiedAt: result.registration.payment.verifiedAt
                    }
                }
            });
        }

        return res.status(200).json({
            success: true,
            message: `Payment ${requestedStatus.toLowerCase()} successfully`,
            registration: {
                id: result.registration._id,
                status: result.registration.status,
                payment: {
                    method: result.registration.payment.method,
                    status: result.registration.payment.status,
                    verifiedAt: result.registration.payment.verifiedAt
                }
            }
        });

    } catch (error) {
        console.error("Update payment status error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.statusCode
                ? error.message
                : "Failed to update payment status"
        });
    } finally {
        await session.endSession();
    }
};


const markAttendance = async (req, res) => {
    try {
        const { qrToken, eventId } = req.body || {};

        if (!qrToken || typeof qrToken !== "string") {
            return res.status(400).json({
                success: false,
                message: "QR token is required."
            });
        }

        if (eventId !== undefined && !mongoose.isValidObjectId(eventId)) {
            return res.status(400).json({
                success: false,
                code: "INVALID_EVENT_ID",
                message: "Invalid event ID."
            });
        }

        const registration = await Registration.findOne({ qrToken })
            .populate("event", "name status organizers")
            .populate({
                path: "team",
                select: "status payment event",
                populate: { path: "event", select: "name status organizers" }
            });

        if (!registration) {
            return res.status(404).json({
                success: false,
                code: "REGISTRATION_NOT_FOUND",
                message: "Invalid QR code. Registration not found."
            });
        }

        let effectiveAccess;
        try {
            effectiveAccess = resolveEffectiveAccess(registration);
        } catch (accessErr) {
            return res.status(400).json({
                success: false,
                code: "INVALID_ACCESS_SNAPSHOT",
                message: accessErr.message || "Invalid registration access snapshot."
            });
        }

        const isCombo = effectiveAccess.type === "MULTI_EVENT";

        let targetEventId;
        if (isCombo) {
            if (!eventId) {
                return res.status(400).json({
                    success: false,
                    code: "EVENT_ID_REQUIRED_FOR_COMBO",
                    message: "An eventId is required to scan attendance for a multi-event combo registration."
                });
            }
            targetEventId = new mongoose.Types.ObjectId(eventId);
            const isEntitled = effectiveAccess.eligibleEventIds.some(
                eligibleId => eligibleId.toString() === targetEventId.toString()
            );
            if (!isEntitled) {
                return res.status(403).json({
                    success: false,
                    code: "EVENT_NOT_ENTITLED",
                    message: "Ticket is not valid for this event."
                });
            }
        } else {
            if (eventId) {
                targetEventId = new mongoose.Types.ObjectId(eventId);
                const isEntitled = effectiveAccess.eligibleEventIds.some(
                    eligibleId => eligibleId.toString() === targetEventId.toString()
                );
                if (!isEntitled) {
                    return res.status(403).json({
                        success: false,
                        code: "EVENT_NOT_ENTITLED",
                        message: "Ticket is not valid for this event."
                    });
                }
            } else {
                targetEventId = effectiveAccess.eligibleEventIds[0];
            }
        }

        // Resolve target event document
        let targetEvent;
        const targetEventIdStr = targetEventId.toString();
        if (registration.event && registration.event._id.toString() === targetEventIdStr) {
            targetEvent = registration.event;
        } else {
            targetEvent = await Event.findById(targetEventId).select("name status organizers");
        }

        if (!targetEvent) {
            return res.status(404).json({
                success: false,
                code: "EVENT_NOT_FOUND",
                message: "Target event not found."
            });
        }

        // Organiser event-scoping check
        if (req.user && req.user.role === "ORGANISER") {
            if (Array.isArray(targetEvent.organizers) && targetEvent.organizers.length > 0) {
                const isAssigned = targetEvent.organizers.some(
                    orgId => orgId.toString() === req.user._id.toString()
                );
                if (!isAssigned) {
                    return res.status(403).json({
                        success: false,
                        code: "ORGANISER_NOT_ASSIGNED",
                        message: "You are not authorized to record attendance for this event."
                    });
                }
            }
        }

        // Ensure parent combo event is populated for verification
        const parentEvent = registration.event || (registration.team && registration.team.event);

        // Admission eligibility check
        const eligibility = resolveRegistrationAdmissionEligibility({
            registration,
            team: registration.team,
            targetEvent,
            parentEvent
        });

        if (!eligibility.isEligible) {
            const statusCode = eligibility.reasonCode === "EVENT_NOT_ENTITLED"
                ? 403
                : (eligibility.reasonCode === "ALREADY_CHECKED_IN" ? 409 : 400);

            return res.status(statusCode).json({
                success: false,
                code: eligibility.reasonCode,
                message: eligibility.message
            });
        }

        // Check if already checked in for this event
        const existingAttendance = Array.isArray(registration.eventAttendance)
            ? registration.eventAttendance.find(e => e.eventId.toString() === targetEventIdStr)
            : null;

        if (existingAttendance) {
            return res.status(409).json({
                success: false,
                code: "ALREADY_CHECKED_IN",
                message: "Participant has already checked in for this event.",
                participant: registration.participantDetails?.fullName,
                checkedInAt: existingAttendance.checkedInAt
            });
        }

        // Legacy already-present check for single event
        if (!isCombo && registration.attendance && registration.attendance.isPresent) {
            return res.status(409).json({
                success: false,
                code: "ALREADY_CHECKED_IN",
                message: "Participant has already checked in.",
                participant: registration.participantDetails?.fullName,
                checkedInAt: registration.attendance.checkedInAt
            });
        }

        const now = new Date();
        const isSingleEvent = !isCombo;

        // Check combo completion
        const existingAttendedIds = new Set(
            (registration.eventAttendance || []).map(e => e.eventId.toString())
        );
        existingAttendedIds.add(targetEventIdStr);
        const isComboComplete = isCombo && effectiveAccess.eligibleEventIds.every(
            id => existingAttendedIds.has(id.toString())
        );

        // Atomic update: condition prevents duplicate check-in
        const updateQuery = {
            _id: registration._id,
            status: "REGISTERED",
            "eventAttendance.eventId": { $ne: targetEventId }
        };
        if (isSingleEvent) {
            updateQuery["attendance.isPresent"] = false;
        }
        if (!registration.team) {
            updateQuery["payment.status"] = { $in: ["VERIFIED", "NOT_REQUIRED"] };
        }

        const updateOp = {
            $push: {
                eventAttendance: {
                    eventId: targetEventId,
                    checkedInAt: now,
                    checkedInBy: req.user?._id || null
                }
            }
        };

        if ((isSingleEvent || isComboComplete) && !registration.attendance?.isPresent) {
            updateOp.$set = {
                "attendance.isPresent": true,
                "attendance.checkedInAt": now
            };
        }

        const updatedRegistration = await Registration.findOneAndUpdate(
            updateQuery,
            updateOp,
            { new: true }
        );

        if (!updatedRegistration) {
            try {
                if (typeof Registration.findById === "function") {
                    const query = Registration.findById(registration._id);
                    const freshReg = query && typeof query.select === "function"
                        ? await query.select("status payment.status")
                        : (query && typeof query.then === "function" ? await query : null);
                    if (freshReg) {
                        if (freshReg.status !== "REGISTERED") {
                            return res.status(400).json({
                                success: false,
                                code: "REGISTRATION_CANCELLED",
                                message: "Registration is cancelled or inactive."
                            });
                        }
                        if (!registration.team && !["VERIFIED", "NOT_REQUIRED"].includes(freshReg.payment?.status)) {
                            return res.status(400).json({
                                success: false,
                                code: "PAYMENT_REJECTED",
                                message: "Payment is not verified."
                            });
                        }
                    }
                }
            } catch (lookupErr) {
                // Ignore fallback error
            }
            return res.status(409).json({
                success: false,
                code: "ALREADY_CHECKED_IN",
                message: "Participant has already checked in for this event."
            });
        }

        // Post-update verification and atomic reconciliation for combo completion
        let isComplete = false;
        if (isSingleEvent) {
            isComplete = true;
        } else if (isCombo) {
            const postAttendedIds = new Set(
                (updatedRegistration.eventAttendance || []).map(e => e.eventId.toString())
            );
            const isNowComplete = effectiveAccess.eligibleEventIds.every(
                id => postAttendedIds.has(id.toString())
            );

            if (isNowComplete) {
                isComplete = true;
                if (!updatedRegistration.attendance?.isPresent) {
                    const reconciled = await Registration.findOneAndUpdate(
                        {
                            _id: updatedRegistration._id,
                            status: "REGISTERED",
                            "attendance.isPresent": false
                        },
                        {
                            $set: {
                                "attendance.isPresent": true,
                                "attendance.checkedInAt": now
                            }
                        },
                        { new: true }
                    );
                    if (reconciled) {
                        updatedRegistration.attendance = reconciled.attendance;
                    }
                }
            }
        }

        const attendedCount = (updatedRegistration.eventAttendance || []).length;
        const totalEligible = effectiveAccess.eligibleEventIds.length;

        return res.status(200).json({
            success: true,
            message: "Attendance marked successfully.",
            participant: {
                fullName: updatedRegistration.participantDetails?.fullName || "Participant",
                registrationId: updatedRegistration._id
            },
            event: {
                id: targetEventId,
                name: targetEvent.name
            },
            checkedInAt: now,
            accessType: effectiveAccess.type,
            ...(isCombo ? {
                comboProgress: {
                    attendedCount,
                    totalEligible,
                    isComplete
                }
            } : {})
        });

    } catch (error) {
        console.error("Attendance error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to mark attendance."
        });
    }
};

const getEventAttendanceReport = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid event ID."
            });
        }

        const event = await Event.findById(id).select("name organizers");

        if (!event) {
            return res.status(404).json({
                success: false,
                message: "Event not found."
            });
        }

        const isAdmin = req.user.role === "ADMIN";
        const isOrganiser = req.user.role === "ORGANISER";

        if (!isAdmin && !isOrganiser) {
            return res.status(403).json({
                success: false,
                code: "FORBIDDEN",
                message: "You are not authorized to view this report."
            });
        }

        if (isOrganiser && Array.isArray(event.organizers) && event.organizers.length > 0) {
            const isAssigned = event.organizers.some(
                orgId => orgId.toString() === req.user._id.toString()
            );
            if (!isAssigned) {
                return res.status(403).json({
                    success: false,
                    code: "ORGANISER_NOT_ASSIGNED",
                    message: "You are not authorized to view this report."
                });
            }
        }

        const targetObjectId = new mongoose.Types.ObjectId(id);
        const cohortFilter = buildEventCohortFilter(targetObjectId, "REGISTERED");

        const registrations = await Registration.find(cohortFilter)
            .populate("team", "teamName payment status")
            .populate("event", "name")
            .select("participantDetails team attendance eventAttendance access event isTeamLeader payment status");

        const statistics = calculateEventAttendanceStats(targetObjectId, registrations);

        return res.status(200).json({
            success: true,
            event: event.name,
            statistics,
            participants: registrations.map(r => {
                const att = resolveEventSpecificAttendance(r, targetObjectId);
                return {
                    name: r.participantDetails?.fullName || "Participant",
                    mobileNumber: r.participantDetails?.mobileNumber || "",
                    collegeName: r.participantDetails?.collegeName || "",
                    department: r.participantDetails?.department || "",
                    rollNumber: r.participantDetails?.rollNumber || "",
                    teamName: r.team?.teamName || null,
                    isTeamLeader: Boolean(r.isTeamLeader),
                    attendance: att.isPresent ? "PRESENT" : "ABSENT",
                    checkedInAt: att.checkedInAt,
                    registrationType: r.team ? "TEAM" : "INDIVIDUAL",
                    cohortType: att.cohortType,
                    parentEventName: att.cohortType === "COMBO" ? (r.event?.name || null) : null
                };
            })
        });

    } catch (error) {
        console.error("Attendance report error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to generate attendance report."
        });
    }
};



const ExcelJS = require("exceljs");

const exportEventParticipants = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid event ID."
            });
        }

        const event = await Event.findById(id).select("name organizers");

        if (!event) {
            return res.status(404).json({
                success: false,
                message: "Event not found."
            });
        }

        const isAdmin = req.user.role === "ADMIN";
        const isOrganiser = req.user.role === "ORGANISER";

        if (!isAdmin && !isOrganiser) {
            return res.status(403).json({
                success: false,
                code: "FORBIDDEN",
                message: "You are not authorized to export participants."
            });
        }

        if (isOrganiser && Array.isArray(event.organizers) && event.organizers.length > 0) {
            const isAssigned = event.organizers.some(
                orgId => orgId.toString() === req.user._id.toString()
            );
            if (!isAssigned) {
                return res.status(403).json({
                    success: false,
                    code: "ORGANISER_NOT_ASSIGNED",
                    message: "You are not authorized to export participants."
                });
            }
        }

        const targetObjectId = new mongoose.Types.ObjectId(id);
        const cohortFilter = buildEventCohortFilter(targetObjectId, "REGISTERED");

        // Fetch all active registrations in unified cohort
        const registrations = await Registration.find(cohortFilter)
            .populate("user", "name email")
            .populate("team", "teamName payment")
            .populate("event", "name")
            .sort({ createdAt: 1 });

        const workbook = new ExcelJS.Workbook();

        workbook.creator = "VIBRANT";
        workbook.created = new Date();

        const worksheet = workbook.addWorksheet("Participants");

        worksheet.columns = [
            { header: "S.No", key: "serialNumber", width: 10 },
            { header: "Participant Name", key: "name", width: 25 },
            { header: "Email", key: "email", width: 30 },
            { header: "Mobile Number", key: "mobile", width: 18 },
            { header: "College", key: "college", width: 35 },
            { header: "Department", key: "department", width: 22 },
            { header: "Year", key: "year", width: 15 },
            { header: "Section", key: "section", width: 12 },
            { header: "Roll Number", key: "rollNumber", width: 18 },
            { header: "Event Name", key: "event", width: 30 },
            { header: "Team Name", key: "teamName", width: 22 },
            { header: "Registration Type", key: "type", width: 20 },
            { header: "Payment Status", key: "payment", width: 18 },
            { header: "Attendance", key: "attendance", width: 15 },
            { header: "Check-in Time", key: "checkIn", width: 25 },
            { header: "Cohort Type", key: "cohortType", width: 18 },
            { header: "Parent Event Name", key: "parentEventName", width: 25 }
        ];

        registrations.forEach((registration, index) => {
            const details = registration.participantDetails || {};
            const isTeamRegistration = Boolean(registration.team);

            const paymentStatus = isTeamRegistration
                ? (registration.team?.payment?.status || "NOT_REQUIRED")
                : (registration.payment?.status || "NOT_REQUIRED");

            const att = resolveEventSpecificAttendance(registration, targetObjectId);
            const parentName = att.cohortType === "COMBO" ? (registration.event?.name || "Combo Pass") : "N/A";

            worksheet.addRow({
                serialNumber: index + 1,
                name: sanitizeForExcel(details.fullName || ""),
                email: sanitizeForExcel(registration.user?.email || "Not provided"),
                mobile: sanitizeForExcel(details.mobileNumber || ""),
                college: sanitizeForExcel(details.collegeName || ""),
                department: sanitizeForExcel(details.department || ""),
                year: sanitizeForExcel(details.yearOfStudy || ""),
                section: sanitizeForExcel(details.section || ""),
                rollNumber: sanitizeForExcel(details.rollNumber || ""),
                event: sanitizeForExcel(event.name || ""),
                teamName: sanitizeForExcel(registration.team?.teamName || "Individual"),
                type: isTeamRegistration ? "TEAM" : "INDIVIDUAL",
                payment: paymentStatus,
                attendance: att.isPresent ? "PRESENT" : "ABSENT",
                checkIn: att.checkedInAt || "Not checked in",
                cohortType: att.cohortType,
                parentEventName: sanitizeForExcel(parentName)
            });
        });

        // Format header
        const headerRow = worksheet.getRow(1);

        headerRow.font = {
            bold: true,
            color: { argb: "FFFFFFFF" }
        };

        headerRow.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF172B3A" }
        };

        headerRow.alignment = {
            vertical: "middle",
            horizontal: "center"
        };

        headerRow.height = 25;

        worksheet.views = [
            { state: "frozen", ySplit: 1 }
        ];

        worksheet.autoFilter = {
            from: "A1",
            to: "Q1"
        };

        // Generate downloadable Excel file
        const fileName = `VIBRANT_${event.name.replace(/[^a-z0-9]/gi, "_")}_Participants.xlsx`;

        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );

        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${fileName}"`
        );

        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error("Excel export error:", error);

        if (!res.headersSent) {
            return res.status(500).json({
                success: false,
                message: "Failed to export event participants."
            });
        }
    }
};


const issueEventCertificates = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid event ID."
            });
        }

        const event = await Event.findById(id);

        if (!event) {
            return res.status(404).json({
                success: false,
                message: "Event not found."
            });
        }

        // Only ADMIN can issue certificates
        if (req.user.role !== "ADMIN") {
            return res.status(403).json({
                success: false,
                message: "Only administrators can issue certificates."
            });
        }

        if (event.status !== "COMPLETED") {
            return res.status(400).json({ success: false, message: "Certificates can only be issued after event completion." });
        }

        const registrations = await Registration.find({ event: id, "certificate.isIssued": { $ne: true } })
            .populate("team", "payment");
        const issuedCertificates = [];
        const skippedCertificates = [];
        let totalEligible = 0;

        for (const registration of registrations) {
            const participant = registration.participantDetails?.fullName || "Participant";
            const eligibility = getCertificateEligibility(event, registration);
            if (!eligibility.eligible) {
                skippedCertificates.push({ registrationId: registration._id, participant, reason: eligibility.reason });
                continue;
            }
            totalEligible += 1;
            try {
                const updated = await issueCertificateRecord(registration._id);
                if (!updated) {
                    skippedCertificates.push({ registrationId: registration._id, participant, reason: "Certificate was already issued or the registration is no longer eligible." });
                    continue;
                }
                issuedCertificates.push({ registrationId: updated._id, participant, certificateId: updated.certificate.certificateId });
            } catch (issueError) {
                console.error("Issue certificate record error:", issueError);
                skippedCertificates.push({ registrationId: registration._id, participant, reason: "Certificate could not be issued. Retry this participant individually." });
            }
        }

        return res.status(200).json({
            success: true,
            message: "Certificate issuance process completed.",
            event: event.name,
            totalEligible,
            totalCandidates: registrations.length,
            issuedCount: issuedCertificates.length,
            skippedCount: skippedCertificates.length,
            certificates: issuedCertificates,
            skipped: skippedCertificates
        });

    } catch (error) {
        console.error("Certificate issuance error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to issue certificates."
        });
    }
};

const issueIndividualCertificate = async (req, res) => {
    try {
        const { registrationId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(registrationId)) {
            return res.status(400).json({ success: false, message: "Invalid registration ID." });
        }
        const registration = await Registration.findById(registrationId)
            .populate("event", "name startDate endDate status")
            .populate("team", "payment");
        if (!registration) return res.status(404).json({ success: false, message: "Registration not found." });
        if (!registration.event) return res.status(404).json({ success: false, message: "Associated event not found." });
        if (registration.certificate?.isIssued) {
            return res.status(409).json({ success: false, message: "A certificate has already been issued for this participant.", certificateId: registration.certificate.certificateId });
        }
        const eligibility = getCertificateEligibility(registration.event, registration);
        if (!eligibility.eligible) return res.status(400).json({ success: false, message: eligibility.reason });

        const updated = await issueCertificateRecord(registration._id);
        if (!updated) return res.status(409).json({ success: false, message: "Certificate was already issued or the registration is no longer eligible." });
        return res.status(200).json({
            success: true,
            message: "Certificate issued successfully.",
            certificate: {
                registrationId: updated._id,
                participantName: updated.participantDetails.fullName,
                certificateId: updated.certificate.certificateId,
                issuedAt: updated.certificate.issuedAt
            }
        });
    } catch (error) {
        console.error("Individual certificate issuance error:", error);
        return res.status(500).json({ success: false, message: "Failed to issue certificate." });
    }
};


const downloadCertificate = async (req, res) => {
    try {
        const { certificateId } = req.params;

        if (!certificateId) {
            return res.status(400).json({
                success: false,
                message: "Certificate ID is required."
            });
        }

        const registration = await Registration.findOne({
            "certificate.certificateId": certificateId,
            "certificate.isIssued": true,
            status: "REGISTERED"
        }).populate("event", "name startDate endDate status");

        if (!registration) {
            return res.status(404).json({
                success: false,
                message: "Certificate not found or not issued."
            });
        }

        const event = registration.event;

        if (!event) {
            return res.status(404).json({
                success: false,
                message: "Associated event not found."
            });
        }

        // Keep public certificate-ID downloads for verification; the ID is a random bearer identifier.
        const doc = new PDFDocument({
            size: "A4",
            layout: "landscape",
            margin: 45
        });

        const fileName = `${certificateId}.pdf`;

        res.setHeader(
            "Content-Type",
            "application/pdf"
        );

        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${fileName}"`
        );

        doc.pipe(res);

        drawCertificate(doc, {
            participantName: registration.participantDetails.fullName,
            eventName: event.name,
            eventStartDate: event.startDate,
            certificateId,
            issuedAt: registration.certificate.issuedAt
        });
        doc.end();

    } catch (error) {
        console.error("Certificate download error:", error);

        if (!res.headersSent) {
            return res.status(500).json({
                success: false,
                message: "Failed to generate certificate."
            });
        }

        res.end();
    }
};


const uploadRegistrationPaymentProof = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid registration ID"
            });
        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "Payment screenshot is required"
            });
        }

        const registration = await Registration.findById(id);

        if (!registration) {
            return res.status(404).json({
                success: false,
                message: "Registration not found"
            });
        }

        // Only the registered participant can upload
        if (
            !registration.user ||
            registration.user.toString() !== req.user._id.toString()
        ) {
            return res.status(403).json({
                success: false,
                message: "You can only upload proof for your own registration"
            });
        }

        if (registration.status !== "REGISTERED") {
            return res.status(400).json({
                success: false,
                message: "Invalid registration status"
            });
        }

        if (registration.payment.method !== "UPI") {
            return res.status(400).json({
                success: false,
                message: "Payment proof upload is only available for UPI payments"
            });
        }

        if (registration.payment.status !== "PENDING") {
            return res.status(400).json({
                success: false,
                message: "Payment is not in PENDING status"
            });
        }

        if (registration.payment.proofUrl) {
            return res.status(409).json({
                success: false,
                message: "Payment proof has already been uploaded"
            });
        }

        const uploadedImage = await uploadToCloudinary(req.file.buffer);

        registration.payment.proofUrl = uploadedImage.url;

        await registration.save();

        return res.status(200).json({
            success: true,
            message: "Payment proof uploaded successfully",
            proofUrl: uploadedImage.url
        });

    } catch (error) {
        console.error("Individual payment proof upload error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to upload payment proof"
        });
    }
};


module.exports = {
    registerForEvent,
    getMyRegistrations,
    getMyRegistrationTicket,
    getEventParticipants,
    getRegistrationById,
    updatePaymentStatus,
    markAttendance,
    getEventAttendanceReport,
    exportEventParticipants,
    issueEventCertificates,
    issueIndividualCertificate,
    downloadCertificate,
    uploadRegistrationPaymentProof
};
