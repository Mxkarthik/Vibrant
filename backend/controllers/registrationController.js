
const mongoose = require("mongoose");
const Event = require("../models/Event");
const Registration = require("../models/Registration");
const Team = require("../models/Team");
const User = require("../models/User");
const { getCertificateEligibility, issueCertificateRecord } = require("../utils/certificateEligibility");
const { drawCertificate } = require("../utils/certificatePdf");
const PDFDocument = require("pdfkit");
const uploadToCloudinary = require("../utils/uploadToCloudinary");
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

        const filter = {
            event: id
        };
        if (status !== "ALL") filter.status = status;
        if (type === "INDIVIDUAL") filter.team = null;
        if (type === "TEAM") filter.team = { $ne: null };
        if (attendance === "PRESENT") filter["attendance.isPresent"] = true;
        if (attendance === "ABSENT") filter["attendance.isPresent"] = { $ne: true };

        if (paymentStatus) {
            const paymentClauses = [];
            if (type !== "TEAM") paymentClauses.push({ team: null, "payment.status": paymentStatus });
            if (type !== "INDIVIDUAL") {
                const matchingTeams = await Team.find({ event: id, "payment.status": paymentStatus }).distinct("_id");
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
                Team.find({ event: id, teamName: searchPattern }).distinct("_id")
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

        const [registrations, total] = await Promise.all([
            Registration.find(filter)
                .populate("user", "name email")
                .populate({ path: "team", select: "teamName memberCount leader payment.status", populate: { path: "leader", select: "name email" } })
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
            .populate("event", "name category venue startDate endDate organizers")
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

        let teamMembers;
        if (registration.team && (isAdmin || isAssignedOrganiser)) {
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

const getEventAttendanceReport = async (req, res) => {
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

        // Only admin or assigned organiser can access the report
        const isAdmin = req.user.role === "ADMIN";
        const isAssignedOrganiser = event.organizers.some(
            organiser => organiser.toString() === req.user._id.toString()
        );

        if (!isAdmin && !isAssignedOrganiser) {
            return res.status(403).json({
                success: false,
                message: "You are not authorized to view this report."
            });
        }

        const registrations = await Registration.find({
            event: id,
            status: "REGISTERED"
        })
            .populate("team", "teamName")
            .select("participantDetails team attendance isTeamLeader");

        const total = registrations.length;
        const present = registrations.filter(
            r => r.attendance.isPresent
        ).length;
        const absent = total - present;

        return res.status(200).json({
            success: true,
            event: event.name,
            statistics: {
                totalParticipants: total,
                present,
                absent,
                attendancePercentage: total
                    ? Number(((present / total) * 100).toFixed(2))
                    : 0
            },
            participants: registrations.map(r => ({
                name: r.participantDetails.fullName,
                mobileNumber: r.participantDetails.mobileNumber,
                collegeName: r.participantDetails.collegeName,
                department: r.participantDetails.department,
                rollNumber: r.participantDetails.rollNumber,
                teamName: r.team?.teamName || null,
                isTeamLeader: r.isTeamLeader,
                attendance: r.attendance.isPresent ? "PRESENT" : "ABSENT",
                checkedInAt: r.attendance.checkedInAt
            }))
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

        const event = await Event.findById(id);

        if (!event) {
            return res.status(404).json({
                success: false,
                message: "Event not found."
            });
        }

        // Authorization: Admin or assigned organiser
        const isAdmin = req.user.role === "ADMIN";

        const isAssignedOrganiser = (event.organizers || []).some(
            organiser => organiser.toString() === req.user._id.toString()
        );

        if (!isAdmin && !isAssignedOrganiser) {
            return res.status(403).json({
                success: false,
                message: "You are not authorized to export participants."
            });
        }

        // Fetch all active registrations
        const registrations = await Registration.find({
            event: id,
            status: "REGISTERED"
        })
            .populate("user", "name email")
            .populate("team", "teamName payment")
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
            { header: "Check-in Time", key: "checkIn", width: 25 }
        ];

        registrations.forEach((registration, index) => {
            const details = registration.participantDetails;
            const isTeamRegistration = Boolean(registration.team);

            const paymentStatus = isTeamRegistration
                ? registration.team.payment.status
                : registration.payment.status;

            worksheet.addRow({
                serialNumber: index + 1,
                name: details.fullName,
                email: registration.user?.email || "Not provided",
                mobile: details.mobileNumber,
                college: details.collegeName,
                department: details.department,
                year: details.yearOfStudy,
                section: details.section,
                rollNumber: details.rollNumber,
                event: event.name,
                teamName: registration.team?.teamName || "Individual",
                type: isTeamRegistration ? "TEAM" : "INDIVIDUAL",
                payment: paymentStatus,
                attendance: registration.attendance.isPresent
                    ? "PRESENT"
                    : "ABSENT",
                checkIn: registration.attendance.checkedInAt || "Not checked in"
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
            to: "O1"
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
