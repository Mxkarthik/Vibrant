const Registration = require("../models/Registration");
const Team = require("../models/Team");
const Event = require("../models/Event");

const getParticipantDashboard = async (req, res) => {
    try {
        const userId = req.user._id;
        const now = new Date();
        const activeRegistrationMatch = { user: userId, status: "REGISTERED" };

        const eventJoin = [
            { $match: activeRegistrationMatch },
            {
                $lookup: {
                    from: Event.collection.name,
                    localField: "event",
                    foreignField: "_id",
                    as: "event"
                }
            },
            { $unwind: "$event" }
        ];

        const upcomingMatch = {
            "event.endDate": { $gte: now },
            "event.status": { $nin: ["CANCELLED", "COMPLETED"] }
        };

        const [
            totalRegistrations,
            upcomingCountRows,
            completedCountRows,
            individualPendingPayments,
            activeTeamIds,
            upcomingEvents,
            recentRegistrations
        ] = await Promise.all([
            Registration.countDocuments(activeRegistrationMatch),
            Registration.aggregate([
                ...eventJoin,
                { $match: upcomingMatch },
                { $count: "count" }
            ]),
            Registration.aggregate([
                ...eventJoin,
                { $match: { "event.status": "COMPLETED" } },
                { $count: "count" }
            ]),
            Registration.countDocuments({
                ...activeRegistrationMatch,
                team: null,
                "payment.status": "PENDING"
            }),
            Registration.distinct("team", {
                ...activeRegistrationMatch,
                team: { $ne: null }
            }),
            Registration.aggregate([
                ...eventJoin,
                { $match: upcomingMatch },
                { $sort: { "event.startDate": 1, createdAt: -1 } },
                { $limit: 5 },
                {
                    $lookup: {
                        from: Team.collection.name,
                        localField: "team",
                        foreignField: "_id",
                        as: "team"
                    }
                },
                { $unwind: { path: "$team", preserveNullAndEmptyArrays: true } },
                {
                    $project: {
                        _id: 0,
                        registrationId: "$_id",
                        eventId: "$event._id",
                        name: "$event.name",
                        category: "$event.category",
                        poster: "$event.poster",
                        venue: "$event.venue",
                        startDate: "$event.startDate",
                        endDate: "$event.endDate",
                        registrationStatus: "$status",
                        registrationType: { $cond: [{ $ne: ["$team", null] }, "TEAM", "INDIVIDUAL"] },
                        paymentStatus: {
                            $cond: [
                                { $ne: ["$team", null] },
                                { $ifNull: ["$team.payment.status", "NOT_REQUIRED"] },
                                { $ifNull: ["$payment.status", "NOT_REQUIRED"] }
                            ]
                        },
                        teamName: "$team.teamName",
                        teamId: "$team._id"
                    }
                }
            ]),
            Registration.aggregate([
                { $match: { user: userId } },
                { $sort: { createdAt: -1 } },
                { $limit: 5 },
                {
                    $lookup: {
                        from: Event.collection.name,
                        localField: "event",
                        foreignField: "_id",
                        as: "event"
                    }
                },
                { $unwind: { path: "$event", preserveNullAndEmptyArrays: true } },
                {
                    $lookup: {
                        from: Team.collection.name,
                        localField: "team",
                        foreignField: "_id",
                        as: "team"
                    }
                },
                { $unwind: { path: "$team", preserveNullAndEmptyArrays: true } },
                {
                    $project: {
                        _id: 0,
                        id: "$_id",
                        eventId: "$event._id",
                        eventName: "$event.name",
                        category: "$event.category",
                        poster: "$event.poster",
                        venue: "$event.venue",
                        startDate: "$event.startDate",
                        registeredAt: "$createdAt",
                        registrationType: { $cond: [{ $ne: ["$team", null] }, "TEAM", "INDIVIDUAL"] },
                        registrationStatus: "$status",
                        paymentStatus: {
                            $cond: [
                                { $ne: ["$team", null] },
                                { $ifNull: ["$team.payment.status", "NOT_REQUIRED"] },
                                { $ifNull: ["$payment.status", "NOT_REQUIRED"] }
                            ]
                        },
                        teamName: "$team.teamName",
                        teamId: "$team._id"
                    }
                }
            ])
        ]);

        // Team payments live on Team, so count each associated team document once.
        const pendingTeamPayments = activeTeamIds.length
            ? await Team.countDocuments({
                _id: { $in: activeTeamIds },
                status: "REGISTERED",
                "payment.status": "PENDING"
            })
            : 0;

        return res.status(200).json({
            success: true,
            profile: {
                name: req.user.name,
                email: req.user.email,
                profilePicture: req.user.profilePicture || null
            },
            stats: {
                totalRegistrations,
                upcomingEvents: upcomingCountRows[0]?.count || 0,
                pendingPayments: individualPendingPayments + pendingTeamPayments,
                completedEvents: completedCountRows[0]?.count || 0
            },
            upcomingEvents,
            recentRegistrations
        });
    } catch (error) {
        console.error("Get participant dashboard error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to load participant dashboard"
        });
    }
};

module.exports = { getParticipantDashboard };
