
const mongoose = require("mongoose");
const User = require("../models/User");
const Event = require("../models/Event");
const Registration = require("../models/Registration");
const Team = require("../models/Team");
const financialAnalyticsService = require("../services/financialAnalyticsService");
const { getCertificateEligibility } = require("../utils/certificateEligibility");
const { attachEventParticipantCounts } = require("../utils/eventParticipantCounts");
const { executeWithGraphCoordination } = require("../utils/eventGraphCoordinator");
const {
    buildEventCohortFilter,
    buildAttendanceMatchCondition,
    resolveEventSpecificAttendance
} = require("../utils/eventAttendanceReportService");

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
        if (req.query.eventId) {
            if (!mongoose.Types.ObjectId.isValid(req.query.eventId)) {
                return res.status(400).json({ success: false, message: "Invalid event ID" });
            }
            filter.event = new mongoose.Types.ObjectId(req.query.eventId);
        }
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
                { "participantDetails.department": pattern },
                { "payment.cashReceiverName": pattern }
            ];
            if (users.length) clauses.push({ user: { $in: users } });
            if (events.length) clauses.push({ event: { $in: events } });
            filter.$or = clauses;
        }

        const [records, total] = await Promise.all([
            Registration.find(filter)
                .select("participantDetails.fullName participantDetails.mobileNumber participantDetails.collegeName participantDetails.department payment.method payment.status payment.proofUrl payment.cashReceiverName payment.expectedAmount payment.receivedAmount payment.currency payment.verifiedBy payment.verifiedAt payment.history createdAt user event")
                .populate("user", "name email -_id")
                .populate("event", "name category startDate registration.registrationFee")
                .populate("payment.verifiedBy", "name email")
                .populate("payment.history.changedBy", "name email")
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
        if (req.query.eventId) {
            if (!mongoose.Types.ObjectId.isValid(req.query.eventId)) {
                return res.status(400).json({ success: false, message: "Invalid event ID" });
            }
            filter.event = new mongoose.Types.ObjectId(req.query.eventId);
        }
        if (query.search) {
            const pattern = { $regex: escapedSearch(query.search), $options: "i" };
            const [leaders, events] = await Promise.all([
                User.find({ $or: [{ name: pattern }, { email: pattern }] }).distinct("_id"),
                Event.find({ name: pattern }).distinct("_id")
            ]);
            const clauses = [
                { teamName: pattern },
                { "payment.cashReceiverName": pattern }
            ];
            if (leaders.length) clauses.push({ leader: { $in: leaders } });
            if (events.length) clauses.push({ event: { $in: events } });
            filter.$or = clauses;
        }

        const [records, total] = await Promise.all([
            Team.find(filter)
                .select("teamName memberCount leader payment.method payment.status payment.proofUrl payment.cashReceiverName payment.expectedAmount payment.receivedAmount payment.currency payment.verifiedBy payment.verifiedAt payment.history createdAt status event")
                .populate("leader", "name email -_id")
                .populate("event", "name category startDate registration.registrationFee")
                .populate("payment.verifiedBy", "name email")
                .populate("payment.history.changedBy", "name email")
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

const getFinancialSummary = async (req, res) => {
    try {
        const { eventId } = req.query;
        if (eventId && !mongoose.Types.ObjectId.isValid(eventId)) {
            return res.status(400).json({ success: false, message: "Invalid event ID" });
        }

        const data = await financialAnalyticsService.getFinancialAnalytics({ eventId });
        return res.status(200).json(data);
    } catch (error) {
        console.error("Get financial summary error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Failed to fetch financial summary"
        });
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

        const targetObjectId = new mongoose.Types.ObjectId(id);
        const registeredFilter = buildEventCohortFilter(targetObjectId, "REGISTERED");
        const filter = { ...registeredFilter };

        const attendanceMatch = buildAttendanceMatchCondition(targetObjectId, attendance);
        if (attendanceMatch) {
            filter.$and = [...(filter.$and || []), attendanceMatch];
        }

        if (search.trim()) {
            const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const pattern = { $regex: escaped, $options: "i" };
            const users = await User.find({ $or: [{ name: pattern }, { email: pattern }] }).distinct("_id");
            const searchClauses = [{ "participantDetails.fullName": pattern }];
            if (users.length) searchClauses.push({ user: { $in: users } });
            filter.$and = [...(filter.$and || []), { $or: searchClauses }];
        }

        const isPresentCondition = {
            $or: [
                { $in: [targetObjectId, { $ifNull: ["$eventAttendance.eventId", []] }] },
                {
                    $and: [
                        { $eq: ["$event", targetObjectId] },
                        { $eq: [{ $ifNull: ["$attendance.isPresent", false] }, true] }
                    ]
                }
            ]
        };

        const isDirectCondition = { $eq: ["$event", targetObjectId] };

        const [summaryRows, registrations, total] = await Promise.all([
            Registration.aggregate([
                { $match: registeredFilter },
                { $group: {
                    _id: null,
                    total: { $sum: 1 },
                    present: { $sum: { $cond: [isPresentCondition, 1, 0] } },
                    individualTotal: { $sum: { $cond: [{ $eq: [{ $ifNull: ["$team", null] }, null] }, 1, 0] } },
                    individualPresent: { $sum: { $cond: [{ $and: [{ $eq: [{ $ifNull: ["$team", null] }, null] }, isPresentCondition] }, 1, 0] } },
                    teamPresent: { $sum: { $cond: [{ $and: [{ $ne: [{ $ifNull: ["$team", null] }, null] }, isPresentCondition] }, 1, 0] } },
                    directTotal: { $sum: { $cond: [isDirectCondition, 1, 0] } },
                    directPresent: { $sum: { $cond: [{ $and: [isDirectCondition, isPresentCondition] }, 1, 0] } },
                    comboTotal: { $sum: { $cond: [{ $not: [isDirectCondition] }, 1, 0] } },
                    comboPresent: { $sum: { $cond: [{ $and: [{ $not: [isDirectCondition] }, isPresentCondition] }, 1, 0] } }
                } },
                { $project: { _id: 0 } }
            ]),
            Registration.find(filter)
                .select("participantDetails.fullName isTeamLeader user team attendance eventAttendance access event")
                .populate("user", "name email -_id")
                .populate("team", "teamName -_id")
                .populate("event", "name -_id")
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
        const directTotal = Number(summary.directTotal) || 0;
        const directPresent = Number(summary.directPresent) || 0;
        const comboTotal = Number(summary.comboTotal) || 0;
        const comboPresent = Number(summary.comboPresent) || 0;

        return res.status(200).json({
            success: true,
            event,
            statistics: {
                totalParticipants,
                present,
                absent: Math.max(0, totalParticipants - present),
                attendancePercentage: totalParticipants ? Number(((present / totalParticipants) * 100).toFixed(2)) : 0,
                individual: { total: individualTotal, present: individualPresent, absent: Math.max(0, individualTotal - individualPresent) },
                team: { total: teamTotal, present: teamPresent, absent: Math.max(0, teamTotal - teamPresent) },
                direct: { total: directTotal, present: directPresent, absent: Math.max(0, directTotal - directPresent) },
                combo: { total: comboTotal, present: comboPresent, absent: Math.max(0, comboTotal - comboPresent) }
            },
            pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
            participants: registrations.map(registration => {
                const att = resolveEventSpecificAttendance(registration, targetObjectId);
                return {
                    registrationId: registration._id,
                    name: registration.participantDetails?.fullName || registration.user?.name || "Participant",
                    email: registration.user?.email || null,
                    teamName: registration.team?.teamName || null,
                    isTeamLeader: Boolean(registration.isTeamLeader),
                    registrationType: registration.team ? "TEAM" : "INDIVIDUAL",
                    attendance: att.isPresent ? "PRESENT" : "ABSENT",
                    checkedInAt: att.checkedInAt || null,
                    cohortType: att.cohortType,
                    parentEventName: att.cohortType === "COMBO" ? (registration.event?.name || null) : null
                };
            })
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
                .select("name description category poster venue startDate endDate registration registrationFields multiEventAccess status createdAt updatedAt")
                .lean(),
            Event.countDocuments(filter)
        ]);
        const eventsWithParticipantCounts = await attachEventParticipantCounts(events);
        const normalizedEvents = eventsWithParticipantCounts.map(ev => ({
            ...ev,
            multiEventAccess: ev.multiEventAccess ? {
                enabled: Boolean(ev.multiEventAccess.enabled),
                includedEvents: (ev.multiEventAccess.includedEvents || []).map(id => id._id ? id._id.toString() : id.toString())
            } : {
                enabled: false,
                includedEvents: []
            }
        }));

        return res.status(200).json({
            success: true,
            events: normalizedEvents,
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

        await executeWithGraphCoordination(async (session) => {
            const evtQuery = Event.findById(id).select("status registration.registeredParticipants");
            if (session && typeof evtQuery.session === "function") evtQuery.session(session);
            const event = await evtQuery;

            if (!event) {
                const err = new Error("Event not found");
                err.statusCode = 404;
                throw err;
            }
            if (event.status === "PUBLISHED") {
                const err = new Error("Cancel or complete this event before deleting it.");
                err.statusCode = 409;
                throw err;
            }

            // Child deletion protection: prevent deletion if referenced by an active combo parent
            const comboQuery = Event.findOne({
                "multiEventAccess.enabled": true,
                "multiEventAccess.includedEvents": event._id
            }).select("name");
            if (session && typeof comboQuery.session === "function") comboQuery.session(session);
            const referencingCombo = await comboQuery;

            if (referencingCombo) {
                const err = new Error(`This event is included in the active combo event "${referencingCombo.name}" and cannot be deleted.`);
                err.statusCode = 409;
                err.code = "REFERENCED_BY_PARENT_COMBO";
                throw err;
            }

            const regCountQuery = Registration.countDocuments({ event: event._id });
            const teamCountQuery = Team.countDocuments({ event: event._id });
            if (session && typeof regCountQuery.session === "function") {
                regCountQuery.session(session);
            }
            if (session && typeof teamCountQuery.session === "function") {
                teamCountQuery.session(session);
            }
            const [registrationCount, teamCount] = await Promise.all([regCountQuery, teamCountQuery]);

            if (registrationCount > 0 || teamCount > 0 || (event.registration?.registeredParticipants ?? 0) > 0) {
                const err = new Error("This event has registration or team history and cannot be deleted. Keep it cancelled or completed to preserve those records.");
                err.statusCode = 409;
                throw err;
            }

            const delQuery = Event.deleteOne({ _id: event._id });
            if (session && typeof delQuery.session === "function") delQuery.session(session);
            await delQuery;
        });

        return res.status(200).json({ success: true, message: "Event deleted successfully" });
    } catch (error) {
        console.error("Delete admin event error:", error);
        if (error.statusCode) {
            return res.status(error.statusCode).json({
                success: false,
                code: error.code,
                message: error.message
            });
        }
        return res.status(500).json({ success: false, message: "Failed to delete event" });
    }
};

const buildRegistrationSummaryPipeline = () => [
    {
        $lookup: {
            from: Team.collection.name,
            localField: "team",
            foreignField: "_id",
            as: "teamRecord"
        }
    },
    {
        $addFields: {
            teamDoc: { $arrayElemAt: ["$teamRecord", 0] }
        }
    },
    {
        $addFields: {
            isRegistrationActive: {
                $eq: [{ $ifNull: ["$status", "REGISTERED"] }, "REGISTERED"]
            },
            resolvedPaymentStatus: {
                $cond: [
                    { $eq: [{ $ifNull: ["$team", null] }, null] },
                    { $ifNull: ["$payment.status", "PENDING"] },
                    { $ifNull: ["$teamDoc.payment.status", "PENDING"] }
                ]
            },
            isTeamActive: {
                $cond: [
                    { $eq: [{ $ifNull: ["$team", null] }, null] },
                    true,
                    {
                        $and: [
                            { $ne: ["$teamDoc", null] },
                            { $eq: [{ $ifNull: ["$teamDoc.status", "REGISTERED"] }, "REGISTERED"] }
                        ]
                    }
                ]
            }
        }
    },
    {
        $group: {
            _id: null,
            totalRegistrations: {
                $sum: {
                    $cond: [
                        {
                            $and: [
                                "$isRegistrationActive",
                                "$isTeamActive",
                                { $in: ["$resolvedPaymentStatus", ["PENDING", "VERIFIED", "NOT_REQUIRED"]] }
                            ]
                        },
                        1,
                        0
                    ]
                }
            },
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
];

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
            Registration.aggregate(buildRegistrationSummaryPipeline()),
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

const getEligibleMultiAccessEvents = async (req, res) => {
    try {
        const { parentId, parentMode } = req.query;

        if (parentId !== undefined && parentId !== null && String(parentId).trim() !== "") {
            if (!mongoose.Types.ObjectId.isValid(String(parentId).trim())) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid parent event ID"
                });
            }
        }

        const events = await Event.find({})
            .select("name category venue startDate endDate status registration multiEventAccess")
            .sort({ name: 1 })
            .lean();

        const parentIdStr = parentId ? String(parentId).trim() : null;
        const normalizedParentMode = parentMode ? String(parentMode).toUpperCase() : null;

        // Check if parent itself is an included child of another combo parent
        let parentIsChildOfAnotherCombo = null;
        if (parentIdStr && mongoose.Types.ObjectId.isValid(parentIdStr)) {
            const parentObjId = new mongoose.Types.ObjectId(parentIdStr);
            parentIsChildOfAnotherCombo = await Event.findOne({
                _id: { $ne: parentObjId },
                "multiEventAccess.enabled": true,
                "multiEventAccess.includedEvents": parentObjId
            }).select("name").lean();
        }

        const currentParent = parentIdStr ? events.find(e => e._id.toString() === parentIdStr) : null;
        const alreadyIncludedIds = new Set(
            (currentParent?.multiEventAccess?.includedEvents || []).map(id => id._id ? id._id.toString() : id.toString())
        );

        const evaluatedEvents = events.map(ev => {
            const evIdStr = ev._id.toString();
            let isEligible = true;
            let ineligibilityReason = null;
            const isAlreadyIncluded = alreadyIncludedIds.has(evIdStr);

            if (parentIsChildOfAnotherCombo) {
                isEligible = false;
                ineligibilityReason = `Parent event is already an included child of combo "${parentIsChildOfAnotherCombo.name}" and cannot become a multi-event parent`;
            } else if (parentIdStr && evIdStr === parentIdStr) {
                isEligible = false;
                ineligibilityReason = "An event cannot include itself in multi-event access";
            } else if (ev.status === "CANCELLED" || ev.status === "COMPLETED") {
                isEligible = false;
                ineligibilityReason = `Event is ${ev.status.toLowerCase()}`;
            } else if (ev.multiEventAccess?.enabled === true) {
                isEligible = false;
                ineligibilityReason = "Event is already a multi-event combo parent (nested combos are prohibited)";
            } else if (normalizedParentMode && ev.registration?.mode && ev.registration.mode !== normalizedParentMode) {
                isEligible = false;
                ineligibilityReason = `Registration mode mismatch: event is ${ev.registration.mode}, parent is ${normalizedParentMode}`;
            }

            return {
                _id: ev._id,
                name: ev.name,
                category: ev.category,
                venue: ev.venue,
                startDate: ev.startDate,
                endDate: ev.endDate,
                status: ev.status,
                registrationMode: ev.registration?.mode || "INDIVIDUAL",
                capacity: ev.registration?.capacity || 0,
                registrationFee: ev.registration?.registrationFee || 0,
                allowDirectRegistration: ev.registration?.allowDirectRegistration ?? true,
                isEligible,
                ineligibilityReason,
                isAlreadyIncluded
            };
        });

        const eligibleCount = evaluatedEvents.filter(e => e.isEligible).length;

        return res.status(200).json({
            success: true,
            total: evaluatedEvents.length,
            eligibleCount,
            isParentEligibleAsCombo: !parentIsChildOfAnotherCombo,
            parentIneligibilityReason: parentIsChildOfAnotherCombo
                ? `Parent event is already an included child of combo "${parentIsChildOfAnotherCombo.name}" and cannot become a multi-event parent`
                : null,
            events: evaluatedEvents
        });
    } catch (error) {
        console.error("Get eligible multi-access events error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch eligible events"
        });
    }
};

module.exports = {
    getAllAdminEvents,
    deleteAdminEvent,
    getDashboard,
    buildRegistrationSummaryPipeline,
    getIndividualPayments,
    getTeamPayments,
    getFinancialSummary,
    getAllOrganisers,
    getAdminUsers,
    getAdminEventAttendance,
    getEventCertificates,
    updateUserRole,
    getEligibleMultiAccessEvents
};
