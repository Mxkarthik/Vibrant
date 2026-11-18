"use strict";

const Registration = require("../models/Registration");
const Team = require("../models/Team");

const countablePaymentStatuses = ["PENDING", "VERIFIED", "NOT_REQUIRED"];

const buildEventParticipantCountPipeline = (eventIds) => [
    {
        $match: {
            event: { $in: eventIds },
            status: "REGISTERED"
        }
    },
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
                    { $ne: [{ $ifNull: ["$user", null] }, null] },
                    {
                        $and: [
                            { $ne: ["$teamDoc", null] },
                            { $eq: ["$teamDoc.event", "$event"] },
                            { $eq: [{ $ifNull: ["$teamDoc.status", "REGISTERED"] }, "REGISTERED"] }
                        ]
                    }
                ]
            }
        }
    },
    {
        $match: {
            $expr: {
                $and: [
                    "$isTeamActive",
                    { $in: ["$resolvedPaymentStatus", countablePaymentStatuses] }
                ]
            }
        }
    },
    {
        $group: {
            _id: "$event",
            registeredParticipants: { $sum: 1 }
        }
    }
];

async function attachEventParticipantCounts(events) {
    if (!events.length) return events;

    const counts = await Registration.aggregate(
        buildEventParticipantCountPipeline(events.map(event => event._id))
    );
    const countByEventId = new Map(
        counts.map(row => [String(row._id), row.registeredParticipants])
    );

    return events.map(event => {
        const eventData = typeof event.toObject === "function" ? event.toObject() : event;
        return {
            ...eventData,
            registration: {
                ...eventData.registration,
                registeredParticipants: countByEventId.get(String(eventData._id)) ?? 0
            }
        };
    });
}

module.exports = {
    attachEventParticipantCounts,
    buildEventParticipantCountPipeline
};
