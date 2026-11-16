
const mongoose = require("mongoose");
const User = require("../models/User");
const Event = require("../models/Event");
const Registration = require("../models/Registration");
const Team = require("../models/Team");
const { getCertificateEligibility } = require("../utils/certificateEligibility");

const validatePaymentQueueQuery = (query) => {
    const page = Number(query.page ?? 1);
    const limit = Number(query.limit ?? 20);
    const status = query.status ?? "PENDING";
    const search = query.search ?? "";
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
        return { error: "Invalid pagination parameters" };
    }
    if (typeof status !== "string" || !["PENDING", "VERIFIED", "REJECTED", "NOT_REQUIRED", "ALL"].includes(status)) {
        return { error: "Invalid payment status" };
    }
    if (typeof search !== "string") return { error: "Invalid search query" };
    return { page, limit, status, search: search.trim() };
};

const escapedSearch = (search) => search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getIndividualPayments = async (req, res) => {
    try {
        const query = validatePaymentQueueQuery(req.query);
        if (query.error) return res.status(400).json({ success: false, message: query.error });

        const filter = { team: null, status: "REGISTERED" };
        if (query.status !== "ALL") filter["payment.status"] = query.status;
        if (query.search) {
            const pattern = { $regex: escapedSearch(query.search), $options: "i" };
            const [users, events] = await Promise.all([
                User.find({ $or: [{ name: pattern }, { email: pattern }] }).distinct("_id"),
                Event.find({ name: pattern }).distinct("_id")
            ]);
            const clauses = [
                { "participantDetails.fullName": pattern },
                { "participantDetails.mobileNumber": pattern },
                { "participantDetails.collegeName": pattern },
                { "participantDetails.department": pattern }
            ];
            if (users.length) clauses.push({ user: { $in: users } });
            if (events.length) clauses.push({ event: { $in: events } });
            filter.$or = clauses;
        }

        const [records, total] = await Promise.all([
            Registration.find(filter)
                .select("participantDetails.fullName participantDetails.mobileNumber participantDetails.collegeName participantDetails.department payment.method payment.status payment.proofUrl payment.verifiedAt createdAt user event")
                .populate("user", "name email -_id")
                .populate("event", "name category startDate -_id")
                .sort({ createdAt: -1, _id: -1 })
                .skip((query.page - 1) * query.limit)
                .limit(query.limit)
                .lean(),
            Registration.countDocuments(filter)
        ]);

        return res.status(200).json({
            success: true,
            payments: records,
            pagination: { total, page: query.page, limit: query.limit, totalPages: Math.ceil(total / query.limit) }
        });
    } catch (error) {
        console.error("Get individual payments error:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch individual payments" });
    }
};

const getTeamPayments = async (req, res) => {
    try {
        const query = validatePaymentQueueQuery(req.query);
        if (query.error) return res.status(400).json({ success: false, message: query.error });

        const filter = { status: "REGISTERED" };
        if (query.status !== "ALL") filter["payment.status"] = query.status;
        if (query.search) {
            const pattern = { $regex: escapedSearch(query.search), $options: "i" };
            const [leaders, events] = await Promise.all([
                User.find({ $or: [{ name: pattern }, { email: pattern }] }).distinct("_id"),
                Event.find({ name: pattern }).distinct("_id")
            ]);
            const clauses = [{ teamName: pattern }];
            if (leaders.length) clauses.push({ leader: { $in: leaders } });
            if (events.length) clauses.push({ event: { $in: events } });
            filter.$or = clauses;
        }

        const [records, total] = await Promise.all([
            Team.find(filter)
                .select("teamName memberCount leader payment.method payment.status payment.proofUrl payment.verifiedAt createdAt status event")
                .populate("leader", "name email -_id")
                .populate("event", "name category startDate -_id")
                .sort({ createdAt: -1, _id: -1 })
                .skip((query.page - 1) * query.limit)
                .limit(query.limit)
                .lean(),
            Team.countDocuments(filter)
        ]);

        return res.status(200).json({
            success: true,
            payments: records,
            pagination: { total, page: query.page, limit: query.limit, totalPages: Math.ceil(total / query.limit) }
        });
    } catch (error) {
        console.error("Get team payments error:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch team payments" });
    }
};

const getAdminEventAttendance = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid event ID" });
        }
        const pageValue = req.query.page ?? "1";
        const limitValue = req.query.limit ?? "20";
        const page = typeof pageValue === "string" && /^\d+$/.test(pageValue) ? Number(pageValue) : NaN;
        const limit = typeof limitValue === "string" && /^\d+$/.test(limitValue) ? Number(limitValue) : NaN;
        const search = req.query.search ?? "";
        const attendance = req.query.attendance ?? "ALL";
        if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
            return res.status(400).json({ success: false, message: "Invalid pagination parameters" });
        }
        if (typeof search !== "string" || typeof attendance !== "string" || !["ALL", "PRESENT", "ABSENT"].includes(attendance)) {
            return res.status(400).json({ success: false, message: "Invalid attendance filters" });
        }

        const event = await Event.findById(id).select("name startDate endDate status").lean();
        if (!event) return res.status(404).json({ success: false, message: "Event not found" });

        const registeredFilter = { event: event._id, status: "REGISTERED" };
        const filter = { ...registeredFilter };
        if (attendance === "PRESENT") filter["attendance.isPresent"] = true;
        if (attendance === "ABSENT") filter["attendance.isPresent"] = { $ne: true };
        if (search.trim()) {
            const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const pattern = { $regex: escaped, $options: "i" };
            const users = await User.find({ $or: [{ name: pattern }, { email: pattern }] }).distinct("_id");
            const searchClauses = [{ "participantDetails.fullName": pattern }];
            if (users.length) searchClauses.push({ user: { $in: users } });
            filter.$or = searchClauses;
        }

        const [summaryRows, registrations, total] = await Promise.all([
            Registration.aggregate([
                { $match: registeredFilter },
                { $group: {
                    _id: null,
                    total: { $sum: 1 },
                    present: { $sum: { $cond: [{ $eq: [{ $ifNull: ["$attendance.isPresent", false] }, true] }, 1, 0] } },
                    individualTotal: { $sum: { $cond: [{ $eq: [{ $ifNull: ["$team", null] }, null] }, 1, 0] } },
                    individualPresent: { $sum: { $cond: [{ $and: [{ $eq: [{ $ifNull: ["$team", null] }, null] }, { $eq: [{ $ifNull: ["$attendance.isPresent", false] }, true] }] }, 1, 0] } },
                    teamPresent: { $sum: { $cond: [{ $and: [{ $ne: [{ $ifNull: ["$team", null] }, null] }, { $eq: [{ $ifNull: ["$attendance.isPresent", false] }, true] }] }, 1, 0] } }
                } },
                { $project: { _id: 0 } }
            ]),
            Registration.find(filter)
                .select("participantDetails.fullName isTeamLeader user team attendance")
                .populate("user", "name email -_id")
                .populate("team", "teamName -_id")
                .sort({ createdAt: -1, _id: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
            Registration.countDocuments(filter)
        ]);

        const summary = summaryRows[0] || {};
        const totalParticipants = Number(summary.total) || 0;
        const present = Number(summary.present) || 0;
        const individualTotal = Number(summary.individualTotal) || 0;
        const individualPresent = Number(summary.individualPresent) || 0;
        const teamTotal = Math.max(0, totalParticipants - individualTotal);
        const teamPresent = Number(summary.teamPresent) || 0;
        return res.status(200).json({
            success: true,
            event,
            statistics: {
                totalParticipants,
                present,
                absent: Math.max(0, totalParticipants - present),
                attendancePercentage: totalParticipants ? Number(((present / totalParticipants) * 100).toFixed(2)) : 0,
                individual: { total: individualTotal, present: individualPresent, absent: Math.max(0, individualTotal - individualPresent) },
                team: { total: teamTotal, present: teamPresent, absent: Math.max(0, teamTotal - teamPresent) }
            },
            pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
            participants: registrations.map(registration => ({
                registrationId: registration._id,
                name: registration.participantDetails?.fullName || registration.user?.name || "Participant",
                email: registration.user?.email || null,
                teamName: registration.team?.teamName || null,
                isTeamLeader: Boolean(registration.isTeamLeader),
                registrationType: registration.team ? "TEAM" : "INDIVIDUAL",
                attendance: registration.attendance?.isPresent ? "PRESENT" : "ABSENT",
                checkedInAt: registration.attendance?.checkedInAt || null
            }))
        });
    } catch (error) {
        console.error("Get admin event attendance error:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch event attendance" });
    }
};

const getEventCertificates = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid event ID" });
        }
        const pageValue = req.query.page ?? "1";
        const limitValue = req.query.limit ?? "20";
        const page = typeof pageValue === "string" && /^\d+$/.test(pageValue) ? Number(pageValue) : NaN;
        const limit = typeof limitValue === "string" && /^\d+$/.test(limitValue) ? Number(limitValue) : NaN;
        const search = req.query.search ?? "";
        const status = req.query.status ?? "ALL";
        if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
            return res.status(400).json({ success: false, message: "Invalid pagination parameters" });
        }
        if (typeof search !== "string" || typeof status !== "string" || !["ALL", "ISSUED", "PENDING", "INELIGIBLE"].includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid certificate filters" });
        }

        const event = await Event.findById(id).select("name startDate endDate status").lean();
        if (!event) return res.status(404).json({ success: false, message: "Event not found" });

        const [summaryRows, eligibleTeams] = await Promise.all([
            Registration.aggregate([
                { $match: { event: new mongoose.Types.ObjectId(id) } },
                { $lookup: { from: Team.collection.name, localField: "team", foreignField: "_id", as: "teamRecord" } },
                { $addFields: {
                    resolvedPaymentStatus: {
                        $cond: [
                            { $eq: [{ $ifNull: ["$team", null] }, null] },
                            { $ifNull: ["$payment.status", null] },
                            { $ifNull: [{ $arrayElemAt: ["$teamRecord.payment.status", 0] }, null] }
                        ]
                    }
                } },
                { $addFields: {
                    certificateEligible: { $and: [
                        { $eq: [event.status, "COMPLETED"] },
                        { $eq: ["$status", "REGISTERED"] },
                        { $eq: [{ $ifNull: ["$attendance.isPresent", false] }, true] },
                        { $in: ["$resolvedPaymentStatus", ["VERIFIED", "NOT_REQUIRED"]] }
                    ] },
                    certificateIssued: { $eq: [{ $ifNull: ["$certificate.isIssued", false] }, true] }
                } },
                { $group: {
                    _id: null,
                    totalRegistrations: { $sum: 1 },
                    eligible: { $sum: { $cond: ["$certificateEligible", 1, 0] } },
                    issued: { $sum: { $cond: ["$certificateIssued", 1, 0] } },
                    eligibleIssued: { $sum: { $cond: [{ $and: ["$certificateEligible", "$certificateIssued"] }, 1, 0] } }
                } },
                { $project: { _id: 0 } }
            ]),
            event.status === "COMPLETED"
                ? Team.find({ event: id, "payment.status": { $in: ["VERIFIED", "NOT_REQUIRED"] } }).distinct("_id")
                : Promise.resolve([])
        ]);

        const filters = [{ event: new mongoose.Types.ObjectId(id) }];
        if (status === "ISSUED") filters.push({ "certificate.isIssued": true });
        if (status === "PENDING") {
            filters.push(event.status === "COMPLETED"
                ? {
                    status: "REGISTERED",
                    "attendance.isPresent": true,
                    "certificate.isIssued": { $ne: true },
                    $or: [
                        { team: null, "payment.status": { $in: ["VERIFIED", "NOT_REQUIRED"] } },
                        ...(eligibleTeams.length ? [{ team: { $in: eligibleTeams } }] : [])
                    ]
                }
                : { _id: { $exists: false } });
        }
        if (status === "INELIGIBLE") {
            const eligibleFilter = event.status === "COMPLETED" ? {
                status: "REGISTERED",
                "attendance.isPresent": true,
                $or: [
                    { team: null, "payment.status": { $in: ["VERIFIED", "NOT_REQUIRED"] } },
                    ...(eligibleTeams.length ? [{ team: { $in: eligibleTeams } }] : [])
                ]
            } : { _id: { $exists: false } };
            filters.push({ $nor: [eligibleFilter] });
        }
        if (search.trim()) {
            const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const pattern = { $regex: escaped, $options: "i" };
            const users = await User.find({ $or: [{ name: pattern }, { email: pattern }] }).distinct("_id");
            filters.push({ $or: [
                { "participantDetails.fullName": pattern },
                { "certificate.certificateId": pattern },
                ...(users.length ? [{ user: { $in: users } }] : [])
            ] });
        }
        const filter = { $and: filters };
        const [registrations, total] = await Promise.all([
            Registration.find(filter)
                .select("participantDetails.fullName user team isTeamLeader attendance status certificate createdAt")
                .populate("user", "name email -_id")
                .populate("team", "teamName payment.status")
                .sort({ createdAt: -1, _id: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
            Registration.countDocuments(filter)
        ]);
        const summary = summaryRows[0] || {};
        const eligible = Number(summary.eligible) || 0;
        const eligibleIssued = Number(summary.eligibleIssued) || 0;

        return res.status(200).json({
            success: true,
            event,
            summary: {
                totalRegistrations: Number(summary.totalRegistrations) || 0,
                eligible,
                issued: Number(summary.issued) || 0,
                pending: Math.max(0, eligible - eligibleIssued),
                issuancePercentage: eligible ? Number(((eligibleIssued / eligible) * 100).toFixed(2)) : 0
            },
            pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
            certificates: registrations.map(registration => {
                const eligibility = getCertificateEligibility(event, registration);
                const isIssued = Boolean(registration.certificate?.isIssued);
                return {
                    registrationId: registration._id,
                    participantName: registration.participantDetails?.fullName || registration.user?.name || "Participant",
                    email: registration.user?.email || null,
                    teamName: registration.team?.teamName || null,
                    isTeamLeader: Boolean(registration.isTeamLeader),
                    registrationStatus: registration.status,
                    attendance: Boolean(registration.attendance?.isPresent),
                    isEligible: eligibility.eligible,
                    eligibilityReason: eligibility.reason,
                    certificateId: registration.certificate?.certificateId || null,
                    isIssued,
                    issuedAt: registration.certificate?.issuedAt || null
                };
            })
        });
    } catch (error) {
        console.error("Get event certificates error:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch event certificates" });
    }
};

const getAllAdminEvents = async (req, res) => {
    try {
        const {
            search = "",
            status = "",
            category = "",
            page = "1",
            limit = "10",
            sortBy = "createdAt",
            sortOrder = "desc"
        } = req.query;
        const pageNumber = Number(page);
        const limitNumber = Number(limit);

        if (!Number.isInteger(pageNumber) || pageNumber < 1 || !Number.isInteger(limitNumber) || limitNumber < 1 || limitNumber > 50) {
            return res.status(400).json({ success: false, message: "Invalid pagination parameters" });
        }
        if (status && !["PUBLISHED", "CANCELLED", "COMPLETED"].includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid event status" });
        }
        if (category && !["TECHNICAL", "CULTURAL", "SPORTS", "WORKSHOP", "COMPETITION"].includes(category)) {
            return res.status(400).json({ success: false, message: "Invalid event category" });
        }
        if (!["createdAt", "startDate"].includes(sortBy) || !["asc", "desc"].includes(sortOrder)) {
            return res.status(400).json({ success: false, message: "Invalid sort parameters" });
        }

        const filter = {};
        if (status) filter.status = status;
        if (category) filter.category = category;
        if (typeof search === "string" && search.trim()) {
            const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            filter.name = { $regex: escaped, $options: "i" };
        }

        const skip = (pageNumber - 1) * limitNumber;
        const direction = sortOrder === "asc" ? 1 : -1;
        const [events, totalEvents] = await Promise.all([
            Event.find(filter)
                .sort({ [sortBy]: direction, _id: direction })
                .skip(skip)
                .limit(limitNumber)
                .select("name description category poster venue startDate endDate registration registrationFields status createdAt updatedAt")
                .lean(),
            Event.countDocuments(filter)
        ]);

        return res.status(200).json({
            success: true,
            events,
            pagination: {
                totalEvents,
                currentPage: pageNumber,
                totalPages: Math.ceil(totalEvents / limitNumber),
                limit: limitNumber,
                hasNextPage: skip + events.length < totalEvents,
                hasPreviousPage: pageNumber > 1
            }
        });
    } catch (error) {
        console.error("Get admin events error:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch events" });
    }
};

const deleteAdminEvent = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid event ID" });
        }

        const event = await Event.findById(id).select("status registration.registeredParticipants");
        if (!event) {
            return res.status(404).json({ success: false, message: "Event not found" });
        }
        if (event.status === "PUBLISHED") {
            return res.status(409).json({
                success: false,
                message: "Cancel or complete this event before deleting it."
            });
        }

        const [registrationCount, teamCount] = await Promise.all([
            Registration.countDocuments({ event: event._id }),
            Team.countDocuments({ event: event._id })
        ]);
        if (registrationCount > 0 || teamCount > 0 || (event.registration?.registeredParticipants ?? 0) > 0) {
            return res.status(409).json({
                success: false,
                message: "This event has registration or team history and cannot be deleted. Keep it cancelled or completed to preserve those records."
            });
        }

        await Event.deleteOne({ _id: event._id });
        return res.status(200).json({ success: true, message: "Event deleted successfully" });
    } catch (error) {
        console.error("Delete admin event error:", error);
        return res.status(500).json({ success: false, message: "Failed to delete event" });
    }
};

const getDashboard = async (req, res) => {
    try {
        const [eventSummary, registrationSummary, individualPayments, teamPayments, organiserCount, recentEvents] = await Promise.all([
            Event.aggregate([
                {
                    $group: {
                        _id: null,
                        totalEvents: { $sum: 1 },
                        publishedEvents: { $sum: { $cond: [{ $eq: ["$status", "PUBLISHED"] }, 1, 0] } },
                        completedEvents: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } },
                        cancelledEvents: { $sum: { $cond: [{ $eq: ["$status", "CANCELLED"] }, 1, 0] } }
                    }
                },
                { $project: { _id: 0 } }
            ]),
            Registration.aggregate([
                {
                    $group: {
                        _id: null,
                        totalRegistrations: { $sum: 1 },
                        totalRegistered: {
                            $sum: { $cond: [{ $eq: [{ $ifNull: ["$status", "REGISTERED"] }, "REGISTERED"] }, 1, 0] }
                        },
                        totalCheckedIn: {
                            $sum: {
                                $cond: [
                                    {
                                        $and: [
                                            { $eq: [{ $ifNull: ["$status", "REGISTERED"] }, "REGISTERED"] },
                                            { $eq: [{ $ifNull: ["$attendance.isPresent", false] }, true] }
                                        ]
                                    },
                                    1,
                                    0
                                ]
                            }
                        }
                    }
                },
                { $project: { _id: 0 } }
            ]),
            Registration.aggregate([
                { $match: { team: null, status: "REGISTERED" } },
                {
                    $group: {
                        _id: null,
                        pendingIndividual: { $sum: { $cond: [{ $eq: ["$payment.status", "PENDING"] }, 1, 0] } },
                        verifiedIndividual: { $sum: { $cond: [{ $eq: ["$payment.status", "VERIFIED"] }, 1, 0] } }
                    }
                },
                { $project: { _id: 0 } }
            ]),
            Team.aggregate([
                { $match: { status: "REGISTERED" } },
                {
                    $group: {
                        _id: null,
                        pendingTeams: { $sum: { $cond: [{ $eq: ["$payment.status", "PENDING"] }, 1, 0] } },
                        verifiedTeams: { $sum: { $cond: [{ $eq: ["$payment.status", "VERIFIED"] }, 1, 0] } }
                    }
                },
                { $project: { _id: 0 } }
            ]),
            User.countDocuments({ role: "ORGANISER", isActive: true }),
            Event.find({})
                .sort({ createdAt: -1, _id: -1 })
                .limit(5)
                .select("name category startDate venue status createdAt")
                .lean()
        ]);

        const events = eventSummary[0] || {};
        const registrations = registrationSummary[0] || {};
        const individual = individualPayments[0] || {};
        const teams = teamPayments[0] || {};
        const totalRegistered = Number(registrations.totalRegistered) || 0;
        const totalCheckedIn = Number(registrations.totalCheckedIn) || 0;

        return res.status(200).json({
            success: true,
            overview: {
                totalEvents: Number(events.totalEvents) || 0,
                publishedEvents: Number(events.publishedEvents) || 0,
                completedEvents: Number(events.completedEvents) || 0,
                cancelledEvents: Number(events.cancelledEvents) || 0,
                totalRegistrations: Number(registrations.totalRegistrations) || 0,
                totalOrganisers: Number(organiserCount) || 0
            },
            payments: {
                pendingIndividual: Number(individual.pendingIndividual) || 0,
                pendingTeams: Number(teams.pendingTeams) || 0,
                verifiedIndividual: Number(individual.verifiedIndividual) || 0,
                verifiedTeams: Number(teams.verifiedTeams) || 0
            },
            attendance: {
                totalCheckedIn,
                totalRegistered,
                attendancePercentage: totalRegistered
                    ? Number(((totalCheckedIn / totalRegistered) * 100).toFixed(2))
                    : 0
            },
            recentEvents: recentEvents.map(event => ({
                name: event.name,
                category: event.category,
                startDate: event.startDate,
                venue: event.venue,
                status: event.status,
                createdAt: event.createdAt
            }))
        });
    } catch (error) {
        console.error("Get admin dashboard error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch dashboard data"
        });
    }
};

// @desc Get all registered organisers
// @route GET /api/admin/organisers
// @access ADMIN

const getAllOrganisers = async (req, res) => {
    try {
        const organisers = await User.find({
            role: "ORGANISER"
        })
            .select("name email profilePicture role isActive createdAt")
            .sort({ createdAt: -1 })
            .lean();

        return res.status(200).json({
            success: true,
            count: organisers.length,
            organisers
        });

    } catch (error) {
        console.error("Get organisers error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch organisers"
        });
    }
};

const getAdminUsers = async (req, res) => {
    try {
        const page = Number(req.query.page ?? 1);
        const limit = Number(req.query.limit ?? 20);
        const role = req.query.role ?? "ALL";
        const search = req.query.search ?? "";
        if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
            return res.status(400).json({ success: false, message: "Invalid pagination parameters" });
        }
        if (typeof role !== "string" || !["ALL", "PARTICIPANT", "ORGANISER", "ADMIN"].includes(role)) {
            return res.status(400).json({ success: false, message: "Invalid role filter" });
        }
        if (typeof search !== "string") {
            return res.status(400).json({ success: false, message: "Invalid search query" });
        }

        const filter = {};
        if (role !== "ALL") filter.role = role;
        if (search.trim()) {
            const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            filter.$or = [
                { name: { $regex: escaped, $options: "i" } },
                { email: { $regex: escaped, $options: "i" } }
            ];
        }

        const [users, total] = await Promise.all([
            User.find(filter)
                .select("name email profilePicture role isActive createdAt")
                .sort({ name: 1, _id: 1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
            User.countDocuments(filter)
        ]);
        return res.status(200).json({
            success: true,
            users,
            pagination: { total, page, limit, totalPages: Math.ceil(total / limit) }
        });
    } catch (error) {
        console.error("Get admin users error:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch users" });
    }
};


// @desc Assign or update a user's role using Gmail
// @route PATCH /api/admin/users/role
// @access ADMIN

const updateUserRole = async (req, res) => {
    try {
        const { email, role } = req.body || {};

        if (
            typeof email !== "string" ||
            !email.trim() ||
            typeof role !== "string"
        ) {
            return res.status(400).json({
                success: false,
                message: "Email and role are required"
            });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const normalizedRole = role.trim().toUpperCase();

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
            return res.status(400).json({ success: false, message: "Enter a valid email address" });
        }

        // Only allow these two role changes.
        // ADMIN accounts cannot be modified through this API.
        const allowedRoles = ["PARTICIPANT", "ORGANISER"];

        if (!allowedRoles.includes(normalizedRole)) {
            return res.status(400).json({
                success: false,
                message: "Role must be PARTICIPANT or ORGANISER"
            });
        }

        if (normalizedEmail === req.user.email.toLowerCase() && normalizedRole !== req.user.role) {
            return res.status(403).json({ success: false, message: "You cannot change your own administrator role" });
        }

        // Find the existing Google-authenticated account
        const user = await User.findOne({
            email: normalizedEmail
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "No registered user found with this Gmail address"
            });
        }

        if (user.role === "ADMIN") {
            return res.status(403).json({
                success: false,
                message: "Admin accounts cannot be modified through this API"
            });
        }

        if (!user.isActive) {
            return res.status(403).json({
                success: false,
                message: "This user account is inactive"
            });
        }

        if (user.role === normalizedRole) {
            return res.status(200).json({
                success: true,
                message: `User already has the ${normalizedRole} role`,
                user: {
                    name: user.name,
                    email: user.email,
                    role: user.role
                }
            });
        }

        user.role = normalizedRole;
        await user.save();

        return res.status(200).json({
            success: true,
            message: `User role updated to ${normalizedRole} successfully`,
            user: {
                _id: user._id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });

    } catch (error) {
        console.error("Update user role error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to update user role"
        });
    }
};

module.exports = {
    getAllAdminEvents,
    deleteAdminEvent,
    getDashboard,
    getIndividualPayments,
    getTeamPayments,
    getAllOrganisers,
    getAdminUsers,
    getAdminEventAttendance,
    getEventCertificates,
    updateUserRole
};
