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
 * Builds the amount-resolution $addFields stages.
 *
 * Resolution rules (applicable for all payment methods):
 *
 * For VERIFIED payments:
 *   _resolvedReceivedAmount =
 *     receivedAmount        if explicitly recorded (not null)
 *     otherwise expectedAmount if explicitly recorded (not null)
 *     otherwise _eventFee   (current event registration fee — fee-derived, labelled accordingly)
 *
 * For PENDING / REJECTED payments:
 *   _resolvedExpectedAmount =
 *     expectedAmount        if explicitly recorded (not null)
 *     otherwise _eventFee   (current event registration fee)
 *
 * NOT_REQUIRED payments: no monetary amount applies.
 *
 * unknownAmountCount: payments where the amount cannot be resolved even via event fee.
 *   This only occurs when the event record is missing or the event fee itself is unavailable.
 *   A payment that resolves to 0 via a zero event fee is NOT counted as unknown.
 *
 * feeSource: "recorded" if receivedAmount/expectedAmount was used, "event_fee" if derived from current event fee.
 */
const buildAmountResolutionStages = () => [
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
            _eventFeeRaw: {
                $arrayElemAt: ["$_eventDoc.registration.registrationFee", 0]
            },
            _eventFound: {
                $gt: [{ $size: "$_eventDoc" }, 0]
            }
        }
    },
    {
        $addFields: {
            // Event fee: use the recorded fee from the event document, defaulting to null if event not found.
            // We use null (not 0) so we can distinguish "event not found" from "free event (fee=0)".
            _eventFee: {
                $cond: [
                    "$_eventFound",
                    { $ifNull: ["$_eventFeeRaw", 0] },
                    null
                ]
            }
        }
    },
    {
        $addFields: {
            // For VERIFIED: use receivedAmount → expectedAmount → eventFee.
            // This applies to ALL payment methods, not just CASH.
            // A payment with status VERIFIED and no recorded amounts will use the current event fee.
            //
            // IMPORTANT: Fields that are entirely absent from a document (not stored at all) resolve
            // to a "missing" BSON value in MongoDB aggregation. { $ne: [missingField, null] } returns
            // true (missing ≠ null), but referencing missingField as a value returns undefined/missing,
            // which causes $addFields to silently drop the computed field entirely.
            // We must wrap every field reference in $ifNull to coerce missing → null before comparing.
            _resolvedReceivedAmount: {
                $switch: {
                    branches: [
                        // Explicitly recorded received amount (not null, not missing)
                        {
                            case: { $ne: [{ $ifNull: ["$payment.receivedAmount", null] }, null] },
                            then: { $ifNull: ["$payment.receivedAmount", null] }
                        },
                        // Explicitly recorded expected amount (treat as received for verified)
                        {
                            case: { $ne: [{ $ifNull: ["$payment.expectedAmount", null] }, null] },
                            then: { $ifNull: ["$payment.expectedAmount", null] }
                        },
                        // Derive from current event fee (all methods, including UPI)
                        {
                            case: { $ne: ["$_eventFee", null] },
                            then: "$_eventFee"
                        }
                    ],
                    default: null
                }
            },
            // For PENDING / REJECTED: use expectedAmount → eventFee.
            _resolvedExpectedAmount: {
                $switch: {
                    branches: [
                        // Explicitly recorded expected amount (not null, not missing)
                        {
                            case: { $ne: [{ $ifNull: ["$payment.expectedAmount", null] }, null] },
                            then: { $ifNull: ["$payment.expectedAmount", null] }
                        },
                        // Derive from current event fee
                        {
                            case: { $ne: ["$_eventFee", null] },
                            then: "$_eventFee"
                        }
                    ],
                    default: null
                }
            }
        }
    }
];

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
            allEventsList,
            participantCounts
        ] = await Promise.all([
            this._aggregateCollectionSummary(Registration, individualMatch),
            this._aggregateCollectionSummary(Team, teamMatch),
            this._fetchCashPayments(Registration, individualMatch),
            this._fetchCashPayments(Team, teamMatch),
            eventObjectId
                ? [targetEvent]
                : Event.find(scopedEventIds ? { _id: { $in: scopedEventIds } } : {})
                    .select("name category startDate registration.registrationFee status")
                    .lean(),
            this._aggregateParticipantCounts(individualMatch, teamMatch)
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

        // Collection rate: participant-registration count-based, not amount-based.
        // Formula: verifiedParticipants / totalPaidParticipants * 100
        // Denominator: participants with VERIFIED, PENDING, or REJECTED status.
        // NOT_REQUIRED (free) participants are excluded from the paid collection rate.
        const verifiedParticipants = participantCounts.verifiedParticipants;
        const pendingParticipants = participantCounts.pendingParticipants;
        const rejectedParticipants = participantCounts.rejectedParticipants;
        const totalPaidParticipants = verifiedParticipants + pendingParticipants + rejectedParticipants;

        let collectionPercentage = null;
        if (totalPaidParticipants > 0) {
            collectionPercentage = Number(((verifiedParticipants / totalPaidParticipants) * 100).toFixed(1));
        } else {
            // No paid participants exist: rate is not applicable
            collectionPercentage = null;
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
                // Count-based collection rate (participant registrations)
                collectionPercentage,
                verifiedParticipants,
                pendingParticipants,
                rejectedParticipants,
                totalPaidParticipants,
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
     * Aggregates collection amounts and counts from a model (Registration or Team).
     * Uses the corrected amount resolution: all payment methods fall back to event fee.
     */
    async _aggregateCollectionSummary(model, matchQuery) {
        const amountStages = buildAmountResolutionStages();
        const results = await model.aggregate([
            { $match: matchQuery },
            ...amountStages,
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

                    // Amounts: resolved using the corrected resolution logic
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

                    // Unknown amount: payment where even event-fee resolution fails (event not found / deleted)
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
     * Aggregates participant-level counts for the count-based collection rate.
     *
     * Individual registrations: each Registration document is one participant.
     * Team registrations: each Registration document with a non-null team is one participant.
     *   The effective payment status for team members is derived from the Team document, not
     *   from the individual Registration.payment placeholder.
     *
     * NOT_REQUIRED participants are excluded from the paid collection rate denominator.
     */
    async _aggregateParticipantCounts(individualMatch, teamMatch) {
        // Individual participants: team === null, their own payment status
        const [individualCounts, teamParticipantCounts] = await Promise.all([
            Registration.aggregate([
                { $match: { ...individualMatch } },
                {
                    $group: {
                        _id: null,
                        verifiedParticipants: {
                            $sum: { $cond: [{ $eq: ["$payment.status", "VERIFIED"] }, 1, 0] }
                        },
                        pendingParticipants: {
                            $sum: { $cond: [{ $eq: ["$payment.status", "PENDING"] }, 1, 0] }
                        },
                        rejectedParticipants: {
                            $sum: { $cond: [{ $eq: ["$payment.status", "REJECTED"] }, 1, 0] }
                        }
                    }
                }
            ]),
            // Team participants: use Team payment status for all team members.
            // Match team registrations matching the event scope, then look up team payment status.
            (async () => {
                // Build team-member registration match
                const memberMatch = { team: { $ne: null }, status: "REGISTERED" };
                if (individualMatch.event) {
                    memberMatch.event = individualMatch.event;
                }

                return Registration.aggregate([
                    { $match: memberMatch },
                    {
                        $lookup: {
                            from: "teams",
                            localField: "team",
                            foreignField: "_id",
                            as: "_teamDoc"
                        }
                    },
                    {
                        $addFields: {
                            _teamPaymentStatus: {
                                $ifNull: [
                                    { $arrayElemAt: ["$_teamDoc.payment.status", 0] },
                                    "PENDING"
                                ]
                            },
                            _teamStatus: {
                                $ifNull: [
                                    { $arrayElemAt: ["$_teamDoc.status", 0] },
                                    "REGISTERED"
                                ]
                            }
                        }
                    },
                    // Only count participants whose team is REGISTERED (not cancelled)
                    { $match: { _teamStatus: "REGISTERED" } },
                    {
                        $group: {
                            _id: null,
                            verifiedParticipants: {
                                $sum: { $cond: [{ $eq: ["$_teamPaymentStatus", "VERIFIED"] }, 1, 0] }
                            },
                            pendingParticipants: {
                                $sum: { $cond: [{ $eq: ["$_teamPaymentStatus", "PENDING"] }, 1, 0] }
                            },
                            rejectedParticipants: {
                                $sum: { $cond: [{ $eq: ["$_teamPaymentStatus", "REJECTED"] }, 1, 0] }
                            }
                        }
                    }
                ]);
            })()
        ]);

        const indiv = individualCounts[0] || {};
        const team = teamParticipantCounts[0] || {};

        return {
            verifiedParticipants: (Number(indiv.verifiedParticipants) || 0) + (Number(team.verifiedParticipants) || 0),
            pendingParticipants: (Number(indiv.pendingParticipants) || 0) + (Number(team.pendingParticipants) || 0),
            rejectedParticipants: (Number(indiv.rejectedParticipants) || 0) + (Number(team.rejectedParticipants) || 0)
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
     * Groups cash records by cashReceiverName.
     * Uses the corrected amount resolution: receivedAmount → expectedAmount → eventFee.
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
            const eventFee = record.event?.registration?.registrationFee ?? null;

            // Resolve amount using corrected logic: receivedAmount → expectedAmount → eventFee
            const resolveAmount = (forVerified) => {
                if (typeof record.payment?.receivedAmount === "number" && Number.isFinite(record.payment.receivedAmount)) {
                    return record.payment.receivedAmount;
                }
                if (typeof record.payment?.expectedAmount === "number" && Number.isFinite(record.payment.expectedAmount)) {
                    return record.payment.expectedAmount;
                }
                if (typeof eventFee === "number" && Number.isFinite(eventFee)) {
                    return eventFee;
                }
                return null;
            };

            const resolvedAmount = resolveAmount(status === "VERIFIED");

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
                if (typeof resolvedAmount === "number" && Number.isFinite(resolvedAmount)) {
                    const paise = toPaise(resolvedAmount);
                    receiver.verifiedPaise += paise;
                    eventEntry.verifiedPaise += paise;
                } else {
                    receiver.unknownAmountCount += 1;
                }
            } else if (status === "PENDING") {
                receiver.pendingCount += 1;
                if (typeof resolvedAmount === "number" && Number.isFinite(resolvedAmount)) {
                    receiver.pendingPaise += toPaise(resolvedAmount);
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
     * Builds event-wise financial summary using the corrected amount resolution.
     * Also includes participant counts per event for the breakdown table.
     */
    async _buildEventBreakdown(events, individualMatch, teamMatch, singleEventId) {
        if (!events || events.length === 0) return [];

        const targetEventIds = events.map(e => new mongoose.Types.ObjectId(e._id.toString()));

        const amountStages = buildAmountResolutionStages();

        // Run per-event aggregation on Registration and Team
        const [regByEvent, teamByEvent, participantsByEvent] = await Promise.all([
            Registration.aggregate([
                {
                    $match: {
                        team: null,
                        status: "REGISTERED",
                        event: { $in: targetEventIds }
                    }
                },
                ...amountStages,
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
                        rejectedAmount: {
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
                        verifiedCount: {
                            $sum: { $cond: [{ $eq: ["$payment.status", "VERIFIED"] }, 1, 0] }
                        },
                        pendingCount: {
                            $sum: { $cond: [{ $eq: ["$payment.status", "PENDING"] }, 1, 0] }
                        },
                        rejectedCount: {
                            $sum: { $cond: [{ $eq: ["$payment.status", "REJECTED"] }, 1, 0] }
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
                ...amountStages,
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
                        rejectedAmount: {
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
                        verifiedCount: {
                            $sum: { $cond: [{ $eq: ["$payment.status", "VERIFIED"] }, 1, 0] }
                        },
                        pendingCount: {
                            $sum: { $cond: [{ $eq: ["$payment.status", "PENDING"] }, 1, 0] }
                        },
                        rejectedCount: {
                            $sum: { $cond: [{ $eq: ["$payment.status", "REJECTED"] }, 1, 0] }
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
            // Per-event participant counts (count-based)
            this._aggregateEventParticipantCounts(targetEventIds)
        ]);

        const regMap = new Map(regByEvent.map(r => [r._id.toString(), r]));
        const teamMap = new Map(teamByEvent.map(t => [t._id.toString(), t]));
        const participantMap = new Map(participantsByEvent.map(p => [p.eventId, p]));

        const list = events.map(evt => {
            const eId = evt._id.toString();
            const r = regMap.get(eId) || {};
            const t = teamMap.get(eId) || {};
            const p = participantMap.get(eId) || {};

            const verifiedPaise = toPaise(r.verifiedAmount) + toPaise(t.verifiedAmount);
            const cashPaise = toPaise(r.cashAmount) + toPaise(t.cashAmount);
            const upiPaise = toPaise(r.upiAmount) + toPaise(t.upiAmount);
            const pendingPaise = toPaise(r.pendingAmount) + toPaise(t.pendingAmount);
            const rejectedPaise = toPaise(r.rejectedAmount) + toPaise(t.rejectedAmount);

            const verifiedAmount = toRupees(verifiedPaise);
            const cashAmount = toRupees(cashPaise);
            const upiAmount = toRupees(upiPaise);
            const pendingAmount = toRupees(pendingPaise);
            const rejectedAmount = toRupees(rejectedPaise);

            const verifiedCount = (Number(r.verifiedCount) || 0) + (Number(t.verifiedCount) || 0);
            const pendingCount = (Number(r.pendingCount) || 0) + (Number(t.pendingCount) || 0);
            const rejectedCount = (Number(r.rejectedCount) || 0) + (Number(t.rejectedCount) || 0);
            const unknownAmountCount = (Number(r.unknownAmountCount) || 0) + (Number(t.unknownAmountCount) || 0);

            // Participant counts for this event (count-based collection rate)
            const verifiedParticipants = Number(p.verifiedParticipants) || 0;
            const pendingParticipants = Number(p.pendingParticipants) || 0;
            const rejectedParticipants = Number(p.rejectedParticipants) || 0;
            const totalPaidParticipants = verifiedParticipants + pendingParticipants + rejectedParticipants;

            let collectionPercentage = null;
            if (totalPaidParticipants > 0) {
                collectionPercentage = Number(((verifiedParticipants / totalPaidParticipants) * 100).toFixed(1));
            }

            return {
                eventId: evt._id,
                eventName: evt.name,
                category: evt.category,
                verifiedAmount,
                cashAmount,
                upiAmount,
                pendingAmount,
                rejectedAmount,
                verifiedCount,
                pendingCount,
                rejectedCount,
                unknownAmountCount,
                verifiedParticipants,
                pendingParticipants,
                rejectedParticipants,
                totalPaidParticipants,
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

    /**
     * Aggregates participant-level counts per event for the event breakdown table.
     */
    async _aggregateEventParticipantCounts(targetEventIds) {
        const [individualByEvent, teamMembersByEvent] = await Promise.all([
            // Individual participants per event
            Registration.aggregate([
                {
                    $match: {
                        team: null,
                        status: "REGISTERED",
                        event: { $in: targetEventIds }
                    }
                },
                {
                    $group: {
                        _id: "$event",
                        verifiedParticipants: {
                            $sum: { $cond: [{ $eq: ["$payment.status", "VERIFIED"] }, 1, 0] }
                        },
                        pendingParticipants: {
                            $sum: { $cond: [{ $eq: ["$payment.status", "PENDING"] }, 1, 0] }
                        },
                        rejectedParticipants: {
                            $sum: { $cond: [{ $eq: ["$payment.status", "REJECTED"] }, 1, 0] }
                        }
                    }
                }
            ]),
            // Team member participants per event (using team payment status)
            Registration.aggregate([
                {
                    $match: {
                        team: { $ne: null },
                        status: "REGISTERED",
                        event: { $in: targetEventIds }
                    }
                },
                {
                    $lookup: {
                        from: "teams",
                        localField: "team",
                        foreignField: "_id",
                        as: "_teamDoc"
                    }
                },
                {
                    $addFields: {
                        _teamPaymentStatus: {
                            $ifNull: [
                                { $arrayElemAt: ["$_teamDoc.payment.status", 0] },
                                "PENDING"
                            ]
                        },
                        _teamStatus: {
                            $ifNull: [
                                { $arrayElemAt: ["$_teamDoc.status", 0] },
                                "REGISTERED"
                            ]
                        }
                    }
                },
                { $match: { _teamStatus: "REGISTERED" } },
                {
                    $group: {
                        _id: "$event",
                        verifiedParticipants: {
                            $sum: { $cond: [{ $eq: ["$_teamPaymentStatus", "VERIFIED"] }, 1, 0] }
                        },
                        pendingParticipants: {
                            $sum: { $cond: [{ $eq: ["$_teamPaymentStatus", "PENDING"] }, 1, 0] }
                        },
                        rejectedParticipants: {
                            $sum: { $cond: [{ $eq: ["$_teamPaymentStatus", "REJECTED"] }, 1, 0] }
                        }
                    }
                }
            ])
        ]);

        const indivMap = new Map(individualByEvent.map(r => [r._id.toString(), r]));
        const teamMap = new Map(teamMembersByEvent.map(r => [r._id.toString(), r]));

        const allEventIds = new Set([...indivMap.keys(), ...teamMap.keys()]);
        return Array.from(allEventIds).map(eId => {
            const i = indivMap.get(eId) || {};
            const t = teamMap.get(eId) || {};
            return {
                eventId: eId,
                verifiedParticipants: (Number(i.verifiedParticipants) || 0) + (Number(t.verifiedParticipants) || 0),
                pendingParticipants: (Number(i.pendingParticipants) || 0) + (Number(t.pendingParticipants) || 0),
                rejectedParticipants: (Number(i.rejectedParticipants) || 0) + (Number(t.rejectedParticipants) || 0)
            };
        });
    }
}

const financialAnalyticsService = new FinancialAnalyticsService();
module.exports = financialAnalyticsService;
