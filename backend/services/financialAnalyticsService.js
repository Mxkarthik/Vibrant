const mongoose = require("mongoose");
const Registration = require("../models/Registration");
const Team = require("../models/Team");
const Event = require("../models/Event");

/**
 * Converts a rupee amount to minor units (paise) safely to avoid floating point inaccuracies.
 */
const toPaise = (amount) => {
    if (typeof amount !== "number" || !Number.isFinite(amount)) return 0;
    return Math.round(amount * 100);
};

/**
 * Converts paise back to rupees.
 */
const toRupees = (paise) => {
    return Math.round(paise) / 100;
};

/**
 * Financial analytics service
 * Provides MongoDB-aggregated financial summaries across individual registrations and teams.
 */
class FinancialAnalyticsService {
    /**
     * Compute financial summary and breakdowns
     * @param {Object} options
     * @param {string|mongoose.Types.ObjectId} [options.eventId] - Specific event filter
     * @param {Array<string|mongoose.Types.ObjectId>} [options.allowedEventIds] - Restricted event list (for future organiser scopes)
     */
    async getFinancialAnalytics({ eventId = null, allowedEventIds = null } = {}) {
        let eventObjectId = null;
        if (eventId) {
            if (!mongoose.Types.ObjectId.isValid(eventId)) {
                const err = new Error("Invalid event ID");
                err.statusCode = 400;
                throw err;
            }
            eventObjectId = new mongoose.Types.ObjectId(eventId.toString());
        }

        let scopedEventIds = null;
        if (Array.isArray(allowedEventIds)) {
            scopedEventIds = allowedEventIds
                .filter(id => mongoose.Types.ObjectId.isValid(id))
                .map(id => new mongoose.Types.ObjectId(id.toString()));
        }

        // Base match criteria:
        // Individual: team is null (canonical individual), status is REGISTERED (not cancelled)
        const individualMatch = {
            team: null,
            status: "REGISTERED"
        };

        // Team: canonical team record, status is REGISTERED (not cancelled)
        const teamMatch = {
            status: "REGISTERED"
        };

        if (eventObjectId) {
            individualMatch.event = eventObjectId;
            teamMatch.event = eventObjectId;
        } else if (scopedEventIds && scopedEventIds.length > 0) {
            individualMatch.event = { $in: scopedEventIds };
            teamMatch.event = { $in: scopedEventIds };
        }

        // Fetch selected event info if filtered
        let targetEvent = null;
        if (eventObjectId) {
            targetEvent = await Event.findById(eventObjectId).select("name category startDate registration.registrationFee status").lean();
            if (!targetEvent) {
                const err = new Error("Event not found");
                err.statusCode = 404;
                throw err;
            }
        }

        // Run aggregations for individual registrations and teams
        const [
            individualSummary,
            teamSummary,
            individualCashRecords,
            teamCashRecords,
            allEventsList
        ] = await Promise.all([
            this._aggregateCollectionSummary(Registration, individualMatch),
            this._aggregateCollectionSummary(Team, teamMatch),
            this._fetchCashPayments(Registration, individualMatch),
            this._fetchCashPayments(Team, teamMatch),
            eventObjectId
                ? [targetEvent]
                : Event.find(scopedEventIds ? { _id: { $in: scopedEventIds } } : {})
                    .select("name category startDate registration.registrationFee status")
                    .lean()
        ]);

        // Merge individual and team totals using paise arithmetic
        const totalVerifiedPaise = individualSummary.verifiedPaise + teamSummary.verifiedPaise;
        const cashVerifiedPaise = individualSummary.cashVerifiedPaise + teamSummary.cashVerifiedPaise;
        const upiVerifiedPaise = individualSummary.upiVerifiedPaise + teamSummary.upiVerifiedPaise;
        const otherVerifiedPaise = individualSummary.otherVerifiedPaise + teamSummary.otherVerifiedPaise;
        const pendingExpectedPaise = individualSummary.pendingExpectedPaise + teamSummary.pendingExpectedPaise;
        const rejectedExpectedPaise = individualSummary.rejectedExpectedPaise + teamSummary.rejectedExpectedPaise;

        const verifiedCount = individualSummary.verifiedCount + teamSummary.verifiedCount;
        const pendingCount = individualSummary.pendingCount + teamSummary.pendingCount;
        const rejectedCount = individualSummary.rejectedCount + teamSummary.rejectedCount;
        const unknownAmountCount = individualSummary.unknownAmountCount + teamSummary.unknownAmountCount;

        const totalVerifiedAmount = toRupees(totalVerifiedPaise);
        const cashVerifiedAmount = toRupees(cashVerifiedPaise);
        const upiVerifiedAmount = toRupees(upiVerifiedPaise);
        const otherVerifiedAmount = toRupees(otherVerifiedPaise);
        const pendingExpectedAmount = toRupees(pendingExpectedPaise);
        const rejectedExpectedAmount = toRupees(rejectedExpectedPaise);

        // Collection percentage: verified / (verified + pending) * 100
        const actionablePaise = totalVerifiedPaise + pendingExpectedPaise;
        let collectionPercentage = null;
        if (actionablePaise > 0) {
            collectionPercentage = Number(((totalVerifiedPaise / actionablePaise) * 100).toFixed(1));
        } else if (verifiedCount + pendingCount === 0) {
            collectionPercentage = 0;
        }

        // Payment method breakdown
        const methodBreakdown = [];
        if (cashVerifiedAmount > 0 || upiVerifiedAmount > 0 || otherVerifiedAmount > 0 || verifiedCount > 0) {
            const cashCount = individualSummary.cashVerifiedCount + teamSummary.cashVerifiedCount;
            const upiCount = individualSummary.upiVerifiedCount + teamSummary.upiVerifiedCount;
            const otherCount = individualSummary.otherVerifiedCount + teamSummary.otherVerifiedCount;

            if (cashCount > 0 || cashVerifiedAmount > 0) {
                methodBreakdown.push({
                    method: "CASH",
                    amount: cashVerifiedAmount,
                    count: cashCount,
                    percentage: totalVerifiedPaise > 0 ? Number(((cashVerifiedPaise / totalVerifiedPaise) * 100).toFixed(1)) : 0
                });
            }
            if (upiCount > 0 || upiVerifiedAmount > 0) {
                methodBreakdown.push({
                    method: "UPI",
                    amount: upiVerifiedAmount,
                    count: upiCount,
                    percentage: totalVerifiedPaise > 0 ? Number(((upiVerifiedPaise / totalVerifiedPaise) * 100).toFixed(1)) : 0
                });
            }
            if (otherCount > 0 || otherVerifiedAmount > 0) {
                methodBreakdown.push({
                    method: "OTHER",
                    amount: otherVerifiedAmount,
                    count: otherCount,
                    percentage: totalVerifiedPaise > 0 ? Number(((otherVerifiedPaise / totalVerifiedPaise) * 100).toFixed(1)) : 0
                });
            }
        }

        // Cash receivers breakdown
        const cashReceivers = this._groupCashReceivers(
            [...individualCashRecords, ...teamCashRecords]
        );

        // Event-wise financial breakdown
        const eventBreakdown = await this._buildEventBreakdown(
            allEventsList,
            individualMatch,
            teamMatch,
            eventObjectId
        );

        return {
            success: true,
            summary: {
                totalVerifiedAmount,
                cashVerifiedAmount,
                upiVerifiedAmount,
                otherVerifiedAmount,
                pendingExpectedAmount,
                rejectedExpectedAmount,
                verifiedCount,
                pendingCount,
                rejectedCount,
                individualCount: individualSummary.totalCount,
                teamCount: teamSummary.totalCount,
                collectionPercentage,
                unknownAmountCount,
                isComplete: unknownAmountCount === 0,
                currency: "INR",
                calculatedAt: new Date().toISOString()
            },
            methodBreakdown,
            cashReceivers,
            eventBreakdown,
            event: targetEvent
                ? {
                    _id: targetEvent._id,
                    name: targetEvent.name,
                    category: targetEvent.category,
                    startDate: targetEvent.startDate,
                    registrationFee: targetEvent.registration?.registrationFee ?? 0
                }
                : null
        };
    }

    /**
     * Aggregates collection amounts and counts from a model (Registration or Team)
     */
    async _aggregateCollectionSummary(model, matchQuery) {
        const results = await model.aggregate([
            { $match: matchQuery },
            {
                $lookup: {
                    from: "events",
                    localField: "event",
                    foreignField: "_id",
                    as: "_eventDoc"
                }
            },
            {
                $addFields: {
                    _eventFee: {
                        $ifNull: [
                            { $arrayElemAt: ["$_eventDoc.registration.registrationFee", 0] },
                            0
                        ]
                    }
                }
            },
            {
                $addFields: {
                    // For CASH payments, cash received is the price of the event they registered for if not explicitly recorded
                    _resolvedReceivedAmount: {
                        $cond: [
                            { $ne: ["$payment.receivedAmount", null] },
                            "$payment.receivedAmount",
                            {
                                $cond: [
                                    { $eq: ["$payment.method", "CASH"] },
                                    { $ifNull: ["$payment.expectedAmount", "$_eventFee"] },
                                    null
                                ]
                            }
                        ]
                    },
                    _resolvedExpectedAmount: {
                        $cond: [
                            { $ne: ["$payment.expectedAmount", null] },
                            "$payment.expectedAmount",
                            {
                                $cond: [
                                    { $eq: ["$payment.method", "CASH"] },
                                    "$_eventFee",
                                    null
                                ]
                            }
                        ]
                    }
                }
            },
            {
                $group: {
                    _id: null,
                    totalCount: { $sum: 1 },

                    // Counts by status
                    verifiedCount: {
                        $sum: { $cond: [{ $eq: ["$payment.status", "VERIFIED"] }, 1, 0] }
                    },
                    pendingCount: {
                        $sum: { $cond: [{ $eq: ["$payment.status", "PENDING"] }, 1, 0] }
                    },
                    rejectedCount: {
                        $sum: { $cond: [{ $eq: ["$payment.status", "REJECTED"] }, 1, 0] }
                    },
                    notRequiredCount: {
                        $sum: { $cond: [{ $eq: ["$payment.status", "NOT_REQUIRED"] }, 1, 0] }
                    },

                    // Method counts for verified
                    cashVerifiedCount: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $eq: ["$payment.status", "VERIFIED"] },
                                        { $eq: ["$payment.method", "CASH"] }
                                    ]
                                },
                                1,
                                0
                            ]
                        }
                    },
                    upiVerifiedCount: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $eq: ["$payment.status", "VERIFIED"] },
                                        { $eq: ["$payment.method", "UPI"] }
                                    ]
                                },
                                1,
                                0
                            ]
                        }
                    },
                    otherVerifiedCount: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $eq: ["$payment.status", "VERIFIED"] },
                                        { $not: { $in: ["$payment.method", ["CASH", "UPI", "NONE"]] } }
                                    ]
                                },
                                1,
                                0
                            ]
                        }
                    },

                    // Amounts: cash received is the price of the event they registered for
                    verifiedAmount: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $eq: ["$payment.status", "VERIFIED"] },
                                        { $ne: ["$_resolvedReceivedAmount", null] }
                                    ]
                                },
                                "$_resolvedReceivedAmount",
                                0
                            ]
                        }
                    },
                    cashVerifiedAmount: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $eq: ["$payment.status", "VERIFIED"] },
                                        { $eq: ["$payment.method", "CASH"] },
                                        { $ne: ["$_resolvedReceivedAmount", null] }
                                    ]
                                },
                                "$_resolvedReceivedAmount",
                                0
                            ]
                        }
                    },
                    upiVerifiedAmount: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $eq: ["$payment.status", "VERIFIED"] },
                                        { $eq: ["$payment.method", "UPI"] },
                                        { $ne: ["$_resolvedReceivedAmount", null] }
                                    ]
                                },
                                "$_resolvedReceivedAmount",
                                0
                            ]
                        }
                    },
                    otherVerifiedAmount: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $eq: ["$payment.status", "VERIFIED"] },
                                        { $not: { $in: ["$payment.method", ["CASH", "UPI", "NONE"]] } },
                                        { $ne: ["$_resolvedReceivedAmount", null] }
                                    ]
                                },
                                "$_resolvedReceivedAmount",
                                0
                            ]
                        }
                    },
                    pendingExpectedAmount: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $eq: ["$payment.status", "PENDING"] },
                                        { $ne: ["$_resolvedExpectedAmount", null] }
                                    ]
                                },
                                "$_resolvedExpectedAmount",
                                0
                            ]
                        }
                    },
                    rejectedExpectedAmount: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $eq: ["$payment.status", "REJECTED"] },
                                        { $ne: ["$_resolvedExpectedAmount", null] }
                                    ]
                                },
                                "$_resolvedExpectedAmount",
                                0
                            ]
                        }
                    },

                    // Unknown amount tracking:
                    // VERIFIED without resolved receivedAmount, or PENDING/REJECTED without resolved expectedAmount
                    unknownAmountCount: {
                        $sum: {
                            $cond: [
                                {
                                    $or: [
                                        {
                                            $and: [
                                                { $eq: ["$payment.status", "VERIFIED"] },
                                                { $eq: [{ $ifNull: ["$_resolvedReceivedAmount", null] }, null] }
                                            ]
                                        },
                                        {
                                            $and: [
                                                { $in: ["$payment.status", ["PENDING", "REJECTED"]] },
                                                { $eq: [{ $ifNull: ["$_resolvedExpectedAmount", null] }, null] }
                                            ]
                                        }
                                    ]
                                },
                                1,
                                0
                            ]
                        }
                    }
                }
            }
        ]);

        const raw = results[0] || {};
        return {
            totalCount: Number(raw.totalCount) || 0,
            verifiedCount: Number(raw.verifiedCount) || 0,
            pendingCount: Number(raw.pendingCount) || 0,
            rejectedCount: Number(raw.rejectedCount) || 0,
            notRequiredCount: Number(raw.notRequiredCount) || 0,
            cashVerifiedCount: Number(raw.cashVerifiedCount) || 0,
            upiVerifiedCount: Number(raw.upiVerifiedCount) || 0,
            otherVerifiedCount: Number(raw.otherVerifiedCount) || 0,
            verifiedPaise: toPaise(raw.verifiedAmount),
            cashVerifiedPaise: toPaise(raw.cashVerifiedAmount),
            upiVerifiedPaise: toPaise(raw.upiVerifiedAmount),
            otherVerifiedPaise: toPaise(raw.otherVerifiedAmount),
            pendingExpectedPaise: toPaise(raw.pendingExpectedAmount),
            rejectedExpectedPaise: toPaise(raw.rejectedExpectedAmount),
            unknownAmountCount: Number(raw.unknownAmountCount) || 0
        };
    }

    /**
     * Fetches cash payment records with event info for receiver breakdown
     */
    async _fetchCashPayments(model, baseMatch) {
        const match = {
            ...baseMatch,
            "payment.method": "CASH"
        };

        const records = await model.find(match)
            .select("event payment.status payment.cashReceiverName payment.expectedAmount payment.receivedAmount")
            .populate("event", "name registration.registrationFee")
            .lean();

        return records;
    }

    /**
     * Groups cash records by cashReceiverName
     */
    _groupCashReceivers(cashRecords) {
        const receiverMap = new Map();

        for (const record of cashRecords) {
            const rawName = record.payment?.cashReceiverName;
            const isUnrecorded = !rawName || typeof rawName !== "string" || !rawName.trim();
            const trimmedName = isUnrecorded ? "Not recorded" : rawName.trim();
            const groupKey = isUnrecorded ? "__unrecorded__" : trimmedName.toLowerCase();

            if (!receiverMap.has(groupKey)) {
                receiverMap.set(groupKey, {
                    receiverName: trimmedName,
                    isUnrecorded,
                    verifiedPaise: 0,
                    pendingPaise: 0,
                    verifiedCount: 0,
                    pendingCount: 0,
                    unknownAmountCount: 0,
                    eventsMap: new Map()
                });
            }

            const receiver = receiverMap.get(groupKey);
            const status = record.payment?.status;
            const eventFee = record.event?.registration?.registrationFee ?? 0;
            // Cash received is the price of the event they registered for if not explicitly recorded
            const receivedAmount = typeof record.payment?.receivedAmount === "number" && Number.isFinite(record.payment.receivedAmount)
                ? record.payment.receivedAmount
                : (status === "VERIFIED" ? (typeof record.payment?.expectedAmount === "number" ? record.payment.expectedAmount : eventFee) : null);
            const expectedAmount = typeof record.payment?.expectedAmount === "number" && Number.isFinite(record.payment.expectedAmount)
                ? record.payment.expectedAmount
                : eventFee;

            const eventId = record.event?._id?.toString() || "unknown";
            const eventName = record.event?.name || "Event unavailable";

            if (!receiver.eventsMap.has(eventId)) {
                receiver.eventsMap.set(eventId, {
                    eventId,
                    eventName,
                    verifiedPaise: 0,
                    verifiedCount: 0
                });
            }
            const eventEntry = receiver.eventsMap.get(eventId);

            if (status === "VERIFIED") {
                receiver.verifiedCount += 1;
                eventEntry.verifiedCount += 1;
                if (typeof receivedAmount === "number" && Number.isFinite(receivedAmount)) {
                    const paise = toPaise(receivedAmount);
                    receiver.verifiedPaise += paise;
                    eventEntry.verifiedPaise += paise;
                } else {
                    receiver.unknownAmountCount += 1;
                }
            } else if (status === "PENDING") {
                receiver.pendingCount += 1;
                if (typeof expectedAmount === "number" && Number.isFinite(expectedAmount)) {
                    receiver.pendingPaise += toPaise(expectedAmount);
                } else {
                    receiver.unknownAmountCount += 1;
                }
            }
        }

        const list = Array.from(receiverMap.values()).map(r => ({
            receiverName: r.receiverName,
            isUnrecorded: r.isUnrecorded,
            verifiedAmount: toRupees(r.verifiedPaise),
            pendingAmount: toRupees(r.pendingPaise),
            verifiedCount: r.verifiedCount,
            pendingCount: r.pendingCount,
            unknownAmountCount: r.unknownAmountCount,
            events: Array.from(r.eventsMap.values()).map(e => ({
                eventId: e.eventId,
                eventName: e.eventName,
                verifiedAmount: toRupees(e.verifiedPaise),
                verifiedCount: e.verifiedCount
            }))
        }));

        // Sort descending by verifiedAmount, but keep "Not recorded" at the end if 0 verified
        list.sort((a, b) => {
            if (b.verifiedAmount !== a.verifiedAmount) {
                return b.verifiedAmount - a.verifiedAmount;
            }
            if (a.isUnrecorded && !b.isUnrecorded) return 1;
            if (!a.isUnrecorded && b.isUnrecorded) return -1;
            return a.receiverName.localeCompare(b.receiverName);
        });

        return list;
    }

    /**
     * Builds event-wise financial summary
     */
    async _buildEventBreakdown(events, individualMatch, teamMatch, singleEventId) {
        if (!events || events.length === 0) return [];

        const targetEventIds = events.map(e => new mongoose.Types.ObjectId(e._id.toString()));

        // Run per-event aggregation on Registration
        const [regByEvent, teamByEvent] = await Promise.all([
            Registration.aggregate([
                {
                    $match: {
                        team: null,
                        status: "REGISTERED",
                        event: { $in: targetEventIds }
                    }
                },
                {
                    $lookup: {
                        from: "events",
                        localField: "event",
                        foreignField: "_id",
                        as: "_eventDoc"
                    }
                },
                {
                    $addFields: {
                        _eventFee: {
                            $ifNull: [
                                { $arrayElemAt: ["$_eventDoc.registration.registrationFee", 0] },
                                0
                            ]
                        }
                    }
                },
                {
                    $addFields: {
                        _resolvedReceivedAmount: {
                            $cond: [
                                { $ne: ["$payment.receivedAmount", null] },
                                "$payment.receivedAmount",
                                {
                                    $cond: [
                                        { $eq: ["$payment.method", "CASH"] },
                                        { $ifNull: ["$payment.expectedAmount", "$_eventFee"] },
                                        null
                                    ]
                                }
                            ]
                        },
                        _resolvedExpectedAmount: {
                            $cond: [
                                { $ne: ["$payment.expectedAmount", null] },
                                "$payment.expectedAmount",
                                {
                                    $cond: [
                                        { $eq: ["$payment.method", "CASH"] },
                                        "$_eventFee",
                                        null
                                    ]
                                }
                            ]
                        }
                    }
                },
                {
                    $group: {
                        _id: "$event",
                        verifiedAmount: {
                            $sum: {
                                $cond: [
                                    {
                                        $and: [
                                            { $eq: ["$payment.status", "VERIFIED"] },
                                            { $ne: ["$_resolvedReceivedAmount", null] }
                                        ]
                                    },
                                    "$_resolvedReceivedAmount",
                                    0
                                ]
                            }
                        },
                        cashAmount: {
                            $sum: {
                                $cond: [
                                    {
                                        $and: [
                                            { $eq: ["$payment.status", "VERIFIED"] },
                                            { $eq: ["$payment.method", "CASH"] },
                                            { $ne: ["$_resolvedReceivedAmount", null] }
                                        ]
                                    },
                                    "$_resolvedReceivedAmount",
                                    0
                                ]
                            }
                        },
                        upiAmount: {
                            $sum: {
                                $cond: [
                                    {
                                        $and: [
                                            { $eq: ["$payment.status", "VERIFIED"] },
                                            { $eq: ["$payment.method", "UPI"] },
                                            { $ne: ["$_resolvedReceivedAmount", null] }
                                        ]
                                    },
                                    "$_resolvedReceivedAmount",
                                    0
                                ]
                            }
                        },
                        pendingAmount: {
                            $sum: {
                                $cond: [
                                    {
                                        $and: [
                                            { $eq: ["$payment.status", "PENDING"] },
                                            { $ne: ["$_resolvedExpectedAmount", null] }
                                        ]
                                    },
                                    "$_resolvedExpectedAmount",
                                    0
                                ]
                            }
                        },
                        verifiedCount: {
                            $sum: { $cond: [{ $eq: ["$payment.status", "VERIFIED"] }, 1, 0] }
                        },
                        pendingCount: {
                            $sum: { $cond: [{ $eq: ["$payment.status", "PENDING"] }, 1, 0] }
                        },
                        unknownAmountCount: {
                            $sum: {
                                $cond: [
                                    {
                                        $or: [
                                            {
                                                $and: [
                                                    { $eq: ["$payment.status", "VERIFIED"] },
                                                    { $eq: [{ $ifNull: ["$_resolvedReceivedAmount", null] }, null] }
                                                ]
                                            },
                                            {
                                                $and: [
                                                    { $in: ["$payment.status", ["PENDING", "REJECTED"]] },
                                                    { $eq: [{ $ifNull: ["$_resolvedExpectedAmount", null] }, null] }
                                                ]
                                            }
                                        ]
                                    },
                                    1,
                                    0
                                ]
                            }
                        }
                    }
                }
            ]),
            Team.aggregate([
                {
                    $match: {
                        status: "REGISTERED",
                        event: { $in: targetEventIds }
                    }
                },
                {
                    $lookup: {
                        from: "events",
                        localField: "event",
                        foreignField: "_id",
                        as: "_eventDoc"
                    }
                },
                {
                    $addFields: {
                        _eventFee: {
                            $ifNull: [
                                { $arrayElemAt: ["$_eventDoc.registration.registrationFee", 0] },
                                0
                            ]
                        }
                    }
                },
                {
                    $addFields: {
                        _resolvedReceivedAmount: {
                            $cond: [
                                { $ne: ["$payment.receivedAmount", null] },
                                "$payment.receivedAmount",
                                {
                                    $cond: [
                                        { $eq: ["$payment.method", "CASH"] },
                                        { $ifNull: ["$payment.expectedAmount", "$_eventFee"] },
                                        null
                                    ]
                                }
                            ]
                        },
                        _resolvedExpectedAmount: {
                            $cond: [
                                { $ne: ["$payment.expectedAmount", null] },
                                "$payment.expectedAmount",
                                {
                                    $cond: [
                                        { $eq: ["$payment.method", "CASH"] },
                                        "$_eventFee",
                                        null
                                    ]
                                }
                            ]
                        }
                    }
                },
                {
                    $group: {
                        _id: "$event",
                        verifiedAmount: {
                            $sum: {
                                $cond: [
                                    {
                                        $and: [
                                            { $eq: ["$payment.status", "VERIFIED"] },
                                            { $ne: ["$_resolvedReceivedAmount", null] }
                                        ]
                                    },
                                    "$_resolvedReceivedAmount",
                                    0
                                ]
                            }
                        },
                        cashAmount: {
                            $sum: {
                                $cond: [
                                    {
                                        $and: [
                                            { $eq: ["$payment.status", "VERIFIED"] },
                                            { $eq: ["$payment.method", "CASH"] },
                                            { $ne: ["$_resolvedReceivedAmount", null] }
                                        ]
                                    },
                                    "$_resolvedReceivedAmount",
                                    0
                                ]
                            }
                        },
                        upiAmount: {
                            $sum: {
                                $cond: [
                                    {
                                        $and: [
                                            { $eq: ["$payment.status", "VERIFIED"] },
                                            { $eq: ["$payment.method", "UPI"] },
                                            { $ne: ["$_resolvedReceivedAmount", null] }
                                        ]
                                    },
                                    "$_resolvedReceivedAmount",
                                    0
                                ]
                            }
                        },
                        pendingAmount: {
                            $sum: {
                                $cond: [
                                    {
                                        $and: [
                                            { $eq: ["$payment.status", "PENDING"] },
                                            { $ne: ["$_resolvedExpectedAmount", null] }
                                        ]
                                    },
                                    "$_resolvedExpectedAmount",
                                    0
                                ]
                            }
                        },
                        verifiedCount: {
                            $sum: { $cond: [{ $eq: ["$payment.status", "VERIFIED"] }, 1, 0] }
                        },
                        pendingCount: {
                            $sum: { $cond: [{ $eq: ["$payment.status", "PENDING"] }, 1, 0] }
                        },
                        unknownAmountCount: {
                            $sum: {
                                $cond: [
                                    {
                                        $or: [
                                            {
                                                $and: [
                                                    { $eq: ["$payment.status", "VERIFIED"] },
                                                    { $eq: [{ $ifNull: ["$_resolvedReceivedAmount", null] }, null] }
                                                ]
                                            },
                                            {
                                                $and: [
                                                    { $in: ["$payment.status", ["PENDING", "REJECTED"]] },
                                                    { $eq: [{ $ifNull: ["$_resolvedExpectedAmount", null] }, null] }
                                                ]
                                            }
                                        ]
                                    },
                                    1,
                                    0
                                ]
                            }
                        }
                    }
                }
            ])
        ]);

        const regMap = new Map(regByEvent.map(r => [r._id.toString(), r]));
        const teamMap = new Map(teamByEvent.map(t => [t._id.toString(), t]));

        const list = events.map(evt => {
            const eId = evt._id.toString();
            const r = regMap.get(eId) || {};
            const t = teamMap.get(eId) || {};

            const verifiedPaise = toPaise(r.verifiedAmount) + toPaise(t.verifiedAmount);
            const cashPaise = toPaise(r.cashAmount) + toPaise(t.cashAmount);
            const upiPaise = toPaise(r.upiAmount) + toPaise(t.upiAmount);
            const pendingPaise = toPaise(r.pendingAmount) + toPaise(t.pendingAmount);

            const verifiedAmount = toRupees(verifiedPaise);
            const cashAmount = toRupees(cashPaise);
            const upiAmount = toRupees(upiPaise);
            const pendingAmount = toRupees(pendingPaise);

            const verifiedCount = (Number(r.verifiedCount) || 0) + (Number(t.verifiedCount) || 0);
            const pendingCount = (Number(r.pendingCount) || 0) + (Number(t.pendingCount) || 0);
            const unknownAmountCount = (Number(r.unknownAmountCount) || 0) + (Number(t.unknownAmountCount) || 0);

            const actionablePaise = verifiedPaise + pendingPaise;
            let collectionPercentage = null;
            if (actionablePaise > 0) {
                collectionPercentage = Number(((verifiedPaise / actionablePaise) * 100).toFixed(1));
            } else if (verifiedCount + pendingCount === 0) {
                collectionPercentage = 0;
            }

            return {
                eventId: evt._id,
                eventName: evt.name,
                category: evt.category,
                verifiedAmount,
                cashAmount,
                upiAmount,
                pendingAmount,
                verifiedCount,
                pendingCount,
                unknownAmountCount,
                collectionPercentage
            };
        });

        list.sort((a, b) => {
            if (b.verifiedAmount !== a.verifiedAmount) {
                return b.verifiedAmount - a.verifiedAmount;
            }
            return a.eventName.localeCompare(b.eventName);
        });

        return list;
    }
}

const financialAnalyticsService = new FinancialAnalyticsService();
module.exports = financialAnalyticsService;
