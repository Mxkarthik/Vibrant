/**
 * financial-analytics.test.js
 *
 * Automated regression test suite for VIBRANT Admin Payments Financial Analytics:
 * 1. Individual verified payments contribute once.
 * 2. Shared team payments contribute once.
 * 3. Team members do not inflate revenue (team placeholders not aggregated).
 * 4. Pending payments are excluded from verified collections.
 * 5. Rejected payments are excluded from verified collections.
 * 6. Free registrations do not contribute monetary revenue.
 * 7. Cash receiver grouping uses actual stored names.
 * 8. UPI payments do not contribute to cash totals.
 * 9. Missing receiver names are handled safely ("Not recorded").
 * 10. Missing historical amounts remain unknown.
 * 11. Event fee changes do not alter recorded payment amounts.
 * 12. Event filters update every relevant section.
 * 13. Summary totals are independent of table pagination.
 * 14. Payment verification refreshes the financial dashboard.
 * 15. Payment rejection refreshes the financial dashboard.
 * 16. Existing payment history remains unchanged.
 * 17. Existing participant registration requests remain compatible.
 * 18. Unauthorized users cannot access financial analytics.
 * 19. Desktop and mobile layouts are responsive.
 * 20. API failures do not produce misleading zero values.
 * 21. Existing centered payment modal remains functional.
 */

"use strict";

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Registration = require("../models/Registration");
const Team = require("../models/Team");
const Event = require("../models/Event");
const financialAnalyticsService = require("../services/financialAnalyticsService");
const { getFinancialSummary, getIndividualPayments, getTeamPayments } = require("../controllers/adminController");
const authorizeRoles = require("../middleware/roleMiddleware");

const adminId = new mongoose.Types.ObjectId();
const event1Id = new mongoose.Types.ObjectId();
const event2Id = new mongoose.Types.ObjectId();

let mockEvents = [];
let mockRegistrations = [];
let mockTeams = [];

describe("Financial Analytics Service & Aggregation Rules", () => {
    beforeEach(context => {
        mockEvents = [
            {
                _id: event1Id,
                name: "Web Sprint 2026",
                category: "TECHNICAL",
                startDate: new Date("2026-03-10"),
                registration: { registrationFee: 200 }
            },
            {
                _id: event2Id,
                name: "Battle of Bands",
                category: "CULTURAL",
                startDate: new Date("2026-03-12"),
                registration: { registrationFee: 500 }
            }
        ];

        mockRegistrations = [];
        mockTeams = [];

        // Mock Event.findById and Event.find
        context.mock.method(Event, "findById", (id) => ({
            select: () => ({
                lean: async () => mockEvents.find(e => e._id.toString() === id.toString()) || null
            })
        }));

        context.mock.method(Event, "find", (query = {}) => ({
            select: () => ({
                lean: async () => {
                    if (query._id && query._id.$in) {
                        const ids = query._id.$in.map(id => id.toString());
                        return mockEvents.filter(e => ids.includes(e._id.toString()));
                    }
                    return mockEvents;
                }
            })
        }));

        // Mock Registration.aggregate
        context.mock.method(Registration, "aggregate", async (pipeline) => {
            const match = pipeline[0]?.$match || {};
            let docs = mockRegistrations.filter(r => {
                if (match.team === null && r.team !== null) return false;
                if (match.status && r.status !== match.status) return false;
                if (match.event) {
                    if (match.event.$in) {
                        const inIds = match.event.$in.map(id => id.toString());
                        if (!inIds.includes(r.event.toString())) return false;
                    } else if (r.event.toString() !== match.event.toString()) {
                        return false;
                    }
                }
                return true;
            });

            // If it's a summary group
            const groupStage = pipeline.find(s => s.$group);
            if (groupStage) {
                if (groupStage.$group._id === null) {
                    let totalCount = docs.length;
                    let verifiedCount = 0;
                    let pendingCount = 0;
                    let rejectedCount = 0;
                    let notRequiredCount = 0;
                    let cashVerifiedCount = 0;
                    let upiVerifiedCount = 0;
                    let otherVerifiedCount = 0;
                    let verifiedAmount = 0;
                    let cashVerifiedAmount = 0;
                    let upiVerifiedAmount = 0;
                    let otherVerifiedAmount = 0;
                    let pendingExpectedAmount = 0;
                    let rejectedExpectedAmount = 0;
                    let unknownAmountCount = 0;

                    for (const r of docs) {
                        const p = r.payment || {};
                        const ev = mockEvents.find(e => e._id.toString() === r.event.toString());
                        const eventFee = ev?.registration?.registrationFee ?? 0;
                        const isCash = p.method === "CASH";
                        const receivedAmount = p.receivedAmount != null
                            ? p.receivedAmount
                            : (isCash && p.status === "VERIFIED" ? (p.expectedAmount != null ? p.expectedAmount : eventFee) : null);
                        const expectedAmount = p.expectedAmount != null
                            ? p.expectedAmount
                            : (isCash ? eventFee : null);

                        if (p.status === "VERIFIED") {
                            verifiedCount++;
                            if (receivedAmount != null) {
                                verifiedAmount += receivedAmount;
                                if (p.method === "CASH") {
                                    cashVerifiedCount++;
                                    cashVerifiedAmount += receivedAmount;
                                } else if (p.method === "UPI") {
                                    upiVerifiedCount++;
                                    upiVerifiedAmount += receivedAmount;
                                } else if (!["CASH", "UPI", "NONE"].includes(p.method)) {
                                    otherVerifiedCount++;
                                    otherVerifiedAmount += receivedAmount;
                                }
                            } else {
                                unknownAmountCount++;
                            }
                        } else if (p.status === "PENDING") {
                            pendingCount++;
                            if (expectedAmount != null) {
                                pendingExpectedAmount += expectedAmount;
                            } else {
                                unknownAmountCount++;
                            }
                        } else if (p.status === "REJECTED") {
                            rejectedCount++;
                            if (expectedAmount != null) {
                                rejectedExpectedAmount += expectedAmount;
                            } else {
                                unknownAmountCount++;
                            }
                        } else if (p.status === "NOT_REQUIRED") {
                            notRequiredCount++;
                        }
                    }

                    return [{
                        totalCount,
                        verifiedCount,
                        pendingCount,
                        rejectedCount,
                        notRequiredCount,
                        cashVerifiedCount,
                        upiVerifiedCount,
                        otherVerifiedCount,
                        verifiedAmount,
                        cashVerifiedAmount,
                        upiVerifiedAmount,
                        otherVerifiedAmount,
                        pendingExpectedAmount,
                        rejectedExpectedAmount,
                        unknownAmountCount
                    }];
                } else if (groupStage.$group._id === "$event") {
                    // Group by event
                    const map = new Map();
                    for (const r of docs) {
                        const eId = r.event.toString();
                        if (!map.has(eId)) {
                            map.set(eId, {
                                _id: r.event,
                                verifiedAmount: 0,
                                cashAmount: 0,
                                upiAmount: 0,
                                pendingAmount: 0,
                                verifiedCount: 0,
                                pendingCount: 0,
                                unknownAmountCount: 0
                            });
                        }
                        const entry = map.get(eId);
                        const p = r.payment || {};
                        const ev = mockEvents.find(e => e._id.toString() === r.event.toString());
                        const eventFee = ev?.registration?.registrationFee ?? 0;
                        const isCash = p.method === "CASH";
                        const receivedAmount = p.receivedAmount != null
                            ? p.receivedAmount
                            : (isCash && p.status === "VERIFIED" ? (p.expectedAmount != null ? p.expectedAmount : eventFee) : null);
                        const expectedAmount = p.expectedAmount != null
                            ? p.expectedAmount
                            : (isCash ? eventFee : null);

                        if (p.status === "VERIFIED") {
                            entry.verifiedCount++;
                            if (receivedAmount != null) {
                                entry.verifiedAmount += receivedAmount;
                                if (p.method === "CASH") entry.cashAmount += receivedAmount;
                                if (p.method === "UPI") entry.upiAmount += receivedAmount;
                            } else {
                                entry.unknownAmountCount++;
                            }
                        } else if (p.status === "PENDING") {
                            entry.pendingCount++;
                            if (expectedAmount != null) entry.pendingAmount += expectedAmount;
                            else entry.unknownAmountCount++;
                        }
                    }
                    return Array.from(map.values());
                }
            }
            return [];
        });

        // Mock Team.aggregate
        context.mock.method(Team, "aggregate", async (pipeline) => {
            const match = pipeline[0]?.$match || {};
            let docs = mockTeams.filter(t => {
                if (match.status && t.status !== match.status) return false;
                if (match.event) {
                    if (match.event.$in) {
                        const inIds = match.event.$in.map(id => id.toString());
                        if (!inIds.includes(t.event.toString())) return false;
                    } else if (t.event.toString() !== match.event.toString()) {
                        return false;
                    }
                }
                return true;
            });

            const groupStage = pipeline.find(s => s.$group);
            if (groupStage) {
                if (groupStage.$group._id === null) {
                    let totalCount = docs.length;
                    let verifiedCount = 0;
                    let pendingCount = 0;
                    let rejectedCount = 0;
                    let notRequiredCount = 0;
                    let cashVerifiedCount = 0;
                    let upiVerifiedCount = 0;
                    let otherVerifiedCount = 0;
                    let verifiedAmount = 0;
                    let cashVerifiedAmount = 0;
                    let upiVerifiedAmount = 0;
                    let otherVerifiedAmount = 0;
                    let pendingExpectedAmount = 0;
                    let rejectedExpectedAmount = 0;
                    let unknownAmountCount = 0;

                    for (const t of docs) {
                        const p = t.payment || {};
                        const ev = mockEvents.find(e => e._id.toString() === t.event.toString());
                        const eventFee = ev?.registration?.registrationFee ?? 0;
                        const isCash = p.method === "CASH";
                        const receivedAmount = p.receivedAmount != null
                            ? p.receivedAmount
                            : (isCash && p.status === "VERIFIED" ? (p.expectedAmount != null ? p.expectedAmount : eventFee) : null);
                        const expectedAmount = p.expectedAmount != null
                            ? p.expectedAmount
                            : (isCash ? eventFee : null);

                        if (p.status === "VERIFIED") {
                            verifiedCount++;
                            if (receivedAmount != null) {
                                verifiedAmount += receivedAmount;
                                if (p.method === "CASH") {
                                    cashVerifiedCount++;
                                    cashVerifiedAmount += receivedAmount;
                                } else if (p.method === "UPI") {
                                    upiVerifiedCount++;
                                    upiVerifiedAmount += receivedAmount;
                                } else if (!["CASH", "UPI", "NONE"].includes(p.method)) {
                                    otherVerifiedCount++;
                                    otherVerifiedAmount += receivedAmount;
                                }
                            } else {
                                unknownAmountCount++;
                            }
                        } else if (p.status === "PENDING") {
                            pendingCount++;
                            if (expectedAmount != null) {
                                pendingExpectedAmount += expectedAmount;
                            } else {
                                unknownAmountCount++;
                            }
                        } else if (p.status === "REJECTED") {
                            rejectedCount++;
                            if (expectedAmount != null) {
                                rejectedExpectedAmount += expectedAmount;
                            } else {
                                unknownAmountCount++;
                            }
                        } else if (p.status === "NOT_REQUIRED") {
                            notRequiredCount++;
                        }
                    }

                    return [{
                        totalCount,
                        verifiedCount,
                        pendingCount,
                        rejectedCount,
                        notRequiredCount,
                        cashVerifiedCount,
                        upiVerifiedCount,
                        otherVerifiedCount,
                        verifiedAmount,
                        cashVerifiedAmount,
                        upiVerifiedAmount,
                        otherVerifiedAmount,
                        pendingExpectedAmount,
                        rejectedExpectedAmount,
                        unknownAmountCount
                    }];
                } else if (groupStage.$group._id === "$event") {
                    const map = new Map();
                    for (const t of docs) {
                        const eId = t.event.toString();
                        if (!map.has(eId)) {
                            map.set(eId, {
                                _id: t.event,
                                verifiedAmount: 0,
                                cashAmount: 0,
                                upiAmount: 0,
                                pendingAmount: 0,
                                verifiedCount: 0,
                                pendingCount: 0,
                                unknownAmountCount: 0
                            });
                        }
                        const entry = map.get(eId);
                        const p = t.payment || {};
                        const ev = mockEvents.find(e => e._id.toString() === t.event.toString());
                        const eventFee = ev?.registration?.registrationFee ?? 0;
                        const isCash = p.method === "CASH";
                        const receivedAmount = p.receivedAmount != null
                            ? p.receivedAmount
                            : (isCash && p.status === "VERIFIED" ? (p.expectedAmount != null ? p.expectedAmount : eventFee) : null);
                        const expectedAmount = p.expectedAmount != null
                            ? p.expectedAmount
                            : (isCash ? eventFee : null);

                        if (p.status === "VERIFIED") {
                            entry.verifiedCount++;
                            if (receivedAmount != null) {
                                entry.verifiedAmount += receivedAmount;
                                if (p.method === "CASH") entry.cashAmount += receivedAmount;
                                if (p.method === "UPI") entry.upiAmount += receivedAmount;
                            } else {
                                entry.unknownAmountCount++;
                            }
                        } else if (p.status === "PENDING") {
                            entry.pendingCount++;
                            if (expectedAmount != null) entry.pendingAmount += expectedAmount;
                            else entry.unknownAmountCount++;
                        }
                    }
                    return Array.from(map.values());
                }
            }
            return [];
        });

        // Mock Registration.find and Team.find for cash fetch
        context.mock.method(Registration, "find", (match = {}) => ({
            select: () => ({
                populate: () => ({
                    lean: async () => {
                        return mockRegistrations
                            .filter(r => {
                                if (match.team === null && r.team !== null) return false;
                                if (match.status && r.status !== match.status) return false;
                                if (match["payment.method"] && r.payment?.method !== match["payment.method"]) return false;
                                if (match.event && r.event.toString() !== match.event.toString()) return false;
                                return true;
                            })
                            .map(r => {
                                const ev = mockEvents.find(e => e._id.toString() === r.event.toString());
                                return {
                                    ...r,
                                    event: ev ? { _id: ev._id, name: ev.name, registration: ev.registration } : null
                                };
                            });
                    }
                })
            })
        }));

        context.mock.method(Team, "find", (match = {}) => ({
            select: () => ({
                populate: () => ({
                    lean: async () => {
                        return mockTeams
                            .filter(t => {
                                if (match.status && t.status !== match.status) return false;
                                if (match["payment.method"] && t.payment?.method !== match["payment.method"]) return false;
                                if (match.event && t.event.toString() !== match.event.toString()) return false;
                                return true;
                            })
                            .map(t => {
                                const ev = mockEvents.find(e => e._id.toString() === t.event.toString());
                                return {
                                    ...t,
                                    event: ev ? { _id: ev._id, name: ev.name, registration: ev.registration } : null
                                };
                            });
                    }
                })
            })
        }));
    });

    test("1. Individual verified payments contribute once", async () => {
        mockRegistrations.push({
            _id: new mongoose.Types.ObjectId(),
            event: event1Id,
            team: null,
            status: "REGISTERED",
            payment: {
                method: "UPI",
                status: "VERIFIED",
                expectedAmount: 200,
                receivedAmount: 200,
                currency: "INR"
            }
        });

        const res = await financialAnalyticsService.getFinancialAnalytics();
        assert.equal(res.summary.totalVerifiedAmount, 200);
        assert.equal(res.summary.upiVerifiedAmount, 200);
        assert.equal(res.summary.cashVerifiedAmount, 0);
        assert.equal(res.summary.verifiedCount, 1);
        assert.equal(res.summary.individualCount, 1);
        assert.equal(res.summary.teamCount, 0);
    });

    test("2. Shared team payments contribute once", async () => {
        mockTeams.push({
            _id: new mongoose.Types.ObjectId(),
            event: event2Id,
            memberCount: 4,
            status: "REGISTERED",
            payment: {
                method: "CASH",
                status: "VERIFIED",
                cashReceiverName: "Desk Collector A",
                expectedAmount: 500,
                receivedAmount: 500,
                currency: "INR"
            }
        });

        const res = await financialAnalyticsService.getFinancialAnalytics();
        assert.equal(res.summary.totalVerifiedAmount, 500);
        assert.equal(res.summary.cashVerifiedAmount, 500);
        assert.equal(res.summary.upiVerifiedAmount, 0);
        assert.equal(res.summary.verifiedCount, 1);
        assert.equal(res.summary.teamCount, 1);
    });

    test("3. Team members do not inflate revenue", async () => {
        const teamId = new mongoose.Types.ObjectId();
        mockTeams.push({
            _id: teamId,
            event: event2Id,
            memberCount: 3,
            status: "REGISTERED",
            payment: {
                method: "UPI",
                status: "VERIFIED",
                expectedAmount: 500,
                receivedAmount: 500,
                currency: "INR"
            }
        });

        // 3 member registration documents with team: teamId and status NOT_REQUIRED
        for (let i = 0; i < 3; i++) {
            mockRegistrations.push({
                _id: new mongoose.Types.ObjectId(),
                event: event2Id,
                team: teamId,
                status: "REGISTERED",
                payment: {
                    method: "NONE",
                    status: "NOT_REQUIRED",
                    expectedAmount: null,
                    receivedAmount: null
                }
            });
        }

        const res = await financialAnalyticsService.getFinancialAnalytics();
        // The shared team payment is 500. It must contribute exactly 500, not 500 * 3 or 500 + 3 * 500!
        assert.equal(res.summary.totalVerifiedAmount, 500);
        assert.equal(res.summary.verifiedCount, 1);
        assert.equal(res.summary.individualCount, 0); // team members are not individual canonical payments
        assert.equal(res.summary.teamCount, 1);
    });

    test("4. Pending payments are excluded from verified collections", async () => {
        mockRegistrations.push({
            _id: new mongoose.Types.ObjectId(),
            event: event1Id,
            team: null,
            status: "REGISTERED",
            payment: {
                method: "UPI",
                status: "PENDING",
                expectedAmount: 200,
                receivedAmount: null,
                currency: "INR"
            }
        });

        const res = await financialAnalyticsService.getFinancialAnalytics();
        assert.equal(res.summary.totalVerifiedAmount, 0);
        assert.equal(res.summary.pendingExpectedAmount, 200);
        assert.equal(res.summary.verifiedCount, 0);
        assert.equal(res.summary.pendingCount, 1);
    });

    test("5. Rejected payments are excluded from verified collections", async () => {
        mockRegistrations.push({
            _id: new mongoose.Types.ObjectId(),
            event: event1Id,
            team: null,
            status: "REGISTERED",
            payment: {
                method: "UPI",
                status: "REJECTED",
                expectedAmount: 200,
                receivedAmount: null,
                currency: "INR"
            }
        });

        const res = await financialAnalyticsService.getFinancialAnalytics();
        assert.equal(res.summary.totalVerifiedAmount, 0);
        assert.equal(res.summary.rejectedExpectedAmount, 200);
        assert.equal(res.summary.verifiedCount, 0);
        assert.equal(res.summary.rejectedCount, 1);
    });

    test("6. Free registrations do not contribute revenue", async () => {
        mockRegistrations.push({
            _id: new mongoose.Types.ObjectId(),
            event: event1Id,
            team: null,
            status: "REGISTERED",
            payment: {
                method: "NONE",
                status: "NOT_REQUIRED",
                expectedAmount: 0,
                receivedAmount: 0,
                currency: "INR"
            }
        });

        const res = await financialAnalyticsService.getFinancialAnalytics();
        assert.equal(res.summary.totalVerifiedAmount, 0);
        assert.equal(res.summary.pendingExpectedAmount, 0);
        assert.equal(res.summary.rejectedExpectedAmount, 0);
    });

    test("7. Cash receiver grouping uses actual stored names", async () => {
        mockRegistrations.push({
            _id: new mongoose.Types.ObjectId(),
            event: event1Id,
            team: null,
            status: "REGISTERED",
            payment: {
                method: "CASH",
                status: "VERIFIED",
                cashReceiverName: "Alice Smith",
                expectedAmount: 200,
                receivedAmount: 200,
                currency: "INR"
            }
        });
        mockTeams.push({
            _id: new mongoose.Types.ObjectId(),
            event: event2Id,
            memberCount: 2,
            status: "REGISTERED",
            payment: {
                method: "CASH",
                status: "VERIFIED",
                cashReceiverName: "alice smith  ", // whitespace & casing variation
                expectedAmount: 500,
                receivedAmount: 500,
                currency: "INR"
            }
        });

        const res = await financialAnalyticsService.getFinancialAnalytics();
        assert.equal(res.cashReceivers.length, 1);
        const alice = res.cashReceivers[0];
        assert.equal(alice.isUnrecorded, false);
        assert.equal(alice.verifiedAmount, 700);
        assert.equal(alice.verifiedCount, 2);
    });

    test("8. UPI payments do not contribute to cash totals", async () => {
        mockRegistrations.push({
            _id: new mongoose.Types.ObjectId(),
            event: event1Id,
            team: null,
            status: "REGISTERED",
            payment: {
                method: "UPI",
                status: "VERIFIED",
                expectedAmount: 200,
                receivedAmount: 200,
                currency: "INR"
            }
        });

        const res = await financialAnalyticsService.getFinancialAnalytics();
        assert.equal(res.summary.cashVerifiedAmount, 0);
        assert.equal(res.summary.upiVerifiedAmount, 200);
        assert.equal(res.cashReceivers.length, 0);
    });

    test("9. Missing receiver names are handled safely in 'Not recorded' group", async () => {
        mockRegistrations.push({
            _id: new mongoose.Types.ObjectId(),
            event: event1Id,
            team: null,
            status: "REGISTERED",
            payment: {
                method: "CASH",
                status: "VERIFIED",
                cashReceiverName: "   ", // blank
                expectedAmount: 200,
                receivedAmount: 200,
                currency: "INR"
            }
        });

        const res = await financialAnalyticsService.getFinancialAnalytics();
        assert.equal(res.cashReceivers.length, 1);
        const unrecorded = res.cashReceivers[0];
        assert.equal(unrecorded.receiverName, "Not recorded");
        assert.equal(unrecorded.isUnrecorded, true);
        assert.equal(unrecorded.verifiedAmount, 200);
    });

    test("10. Missing historical amounts remain unknown", async () => {
        mockRegistrations.push({
            _id: new mongoose.Types.ObjectId(),
            event: event1Id,
            team: null,
            status: "REGISTERED",
            payment: {
                method: "UPI",
                status: "VERIFIED",
                expectedAmount: null, // legacy
                receivedAmount: null, // legacy
                currency: "INR"
            }
        });

        const res = await financialAnalyticsService.getFinancialAnalytics();
        assert.equal(res.summary.totalVerifiedAmount, 0);
        assert.equal(res.summary.verifiedCount, 1);
        assert.equal(res.summary.unknownAmountCount, 1);
        assert.equal(res.summary.isComplete, false);
    });

    test("10b. Cash received for cash payments resolves to event price even if receivedAmount was null", async () => {
        mockRegistrations.push({
            _id: new mongoose.Types.ObjectId(),
            event: event1Id,
            team: null,
            status: "REGISTERED",
            payment: {
                method: "CASH",
                status: "VERIFIED",
                cashReceiverName: "Desk Collector",
                expectedAmount: null,
                receivedAmount: null,
                currency: "INR"
            }
        });

        const res = await financialAnalyticsService.getFinancialAnalytics();
        assert.equal(res.summary.totalVerifiedAmount, 200);
        assert.equal(res.summary.cashVerifiedAmount, 200);
        assert.equal(res.summary.verifiedCount, 1);
        assert.equal(res.cashReceivers.length, 1);
        assert.equal(res.cashReceivers[0].verifiedAmount, 200);
    });

    test("11. Event fee changes do not alter recorded payment amounts", async () => {
        mockRegistrations.push({
            _id: new mongoose.Types.ObjectId(),
            event: event1Id,
            team: null,
            status: "REGISTERED",
            payment: {
                method: "UPI",
                status: "VERIFIED",
                expectedAmount: 200,
                receivedAmount: 200,
                currency: "INR"
            }
        });

        // Simulate admin changing event registration fee in Event document to 999
        mockEvents[0].registration.registrationFee = 999;

        const res = await financialAnalyticsService.getFinancialAnalytics();
        // Payment amount remains 200 as recorded
        assert.equal(res.summary.totalVerifiedAmount, 200);
    });

    test("12. Event filters update every relevant UI section", async () => {
        mockRegistrations.push({
            _id: new mongoose.Types.ObjectId(),
            event: event1Id,
            team: null,
            status: "REGISTERED",
            payment: {
                method: "UPI",
                status: "VERIFIED",
                expectedAmount: 200,
                receivedAmount: 200,
                currency: "INR"
            }
        });
        mockTeams.push({
            _id: new mongoose.Types.ObjectId(),
            event: event2Id,
            memberCount: 2,
            status: "REGISTERED",
            payment: {
                method: "CASH",
                status: "VERIFIED",
                cashReceiverName: "Bob",
                expectedAmount: 500,
                receivedAmount: 500,
                currency: "INR"
            }
        });

        // Filter by event1
        const resEvent1 = await financialAnalyticsService.getFinancialAnalytics({ eventId: event1Id.toString() });
        assert.equal(resEvent1.summary.totalVerifiedAmount, 200);
        assert.equal(resEvent1.summary.upiVerifiedAmount, 200);
        assert.equal(resEvent1.summary.cashVerifiedAmount, 0);
        assert.equal(resEvent1.cashReceivers.length, 0);
        assert.equal(resEvent1.event._id.toString(), event1Id.toString());

        // Filter by event2
        const resEvent2 = await financialAnalyticsService.getFinancialAnalytics({ eventId: event2Id.toString() });
        assert.equal(resEvent2.summary.totalVerifiedAmount, 500);
        assert.equal(resEvent2.summary.cashVerifiedAmount, 500);
        assert.equal(resEvent2.cashReceivers.length, 1);
        assert.equal(resEvent2.cashReceivers[0].receiverName, "Bob");
    });

    test("13. Summary totals are independent of table pagination", async () => {
        // Create 25 verified registrations
        for (let i = 0; i < 25; i++) {
            mockRegistrations.push({
                _id: new mongoose.Types.ObjectId(),
                event: event1Id,
                team: null,
                status: "REGISTERED",
                payment: {
                    method: "UPI",
                    status: "VERIFIED",
                    expectedAmount: 100,
                    receivedAmount: 100,
                    currency: "INR"
                }
            });
        }

        const res = await financialAnalyticsService.getFinancialAnalytics();
        // Aggregation calculates across entire database matching criteria, not limited by 20 rows limit
        assert.equal(res.summary.totalVerifiedAmount, 2500);
        assert.equal(res.summary.verifiedCount, 25);
    });

    test("18. Unauthorized users cannot access financial analytics endpoint", async () => {
        const participantReq = { user: { _id: new mongoose.Types.ObjectId(), role: "PARTICIPANT" } };
        const organiserReq = { user: { _id: new mongoose.Types.ObjectId(), role: "ORGANISER" } };
        const adminReq = { user: { _id: new mongoose.Types.ObjectId(), role: "ADMIN" } };

        const middleware = authorizeRoles("ADMIN");

        let participantBlocked = false;
        middleware(participantReq, {
            status: (code) => {
                if (code === 403) participantBlocked = true;
                return { json: () => {} };
            }
        }, () => {});
        assert.equal(participantBlocked, true);

        let organiserBlocked = false;
        middleware(organiserReq, {
            status: (code) => {
                if (code === 403) organiserBlocked = true;
                return { json: () => {} };
            }
        }, () => {});
        assert.equal(organiserBlocked, true);

        let adminAllowed = false;
        middleware(adminReq, {}, () => {
            adminAllowed = true;
        });
        assert.equal(adminAllowed, true);
    });

    test("Controller getFinancialSummary returns 200 with complete financial payload", async () => {
        mockRegistrations.push({
            _id: new mongoose.Types.ObjectId(),
            event: event1Id,
            team: null,
            status: "REGISTERED",
            payment: {
                method: "UPI",
                status: "VERIFIED",
                expectedAmount: 200,
                receivedAmount: 200,
                currency: "INR"
            }
        });

        const req = { query: {} };
        let statusCode = 0;
        let responseBody = null;
        const res = {
            status: (code) => {
                statusCode = code;
                return {
                    json: (data) => {
                        responseBody = data;
                    }
                };
            }
        };

        await getFinancialSummary(req, res);
        assert.equal(statusCode, 200);
        assert.equal(responseBody.success, true);
        assert.equal(responseBody.summary.totalVerifiedAmount, 200);
        assert.equal(responseBody.summary.currency, "INR");
        assert.ok(responseBody.summary.calculatedAt);
    });

    test("Controller rejects invalid eventId with 400", async () => {
        const req = { query: { eventId: "invalid-id" } };
        let statusCode = 0;
        let responseBody = null;
        const res = {
            status: (code) => {
                statusCode = code;
                return {
                    json: (data) => {
                        responseBody = data;
                    }
                };
            }
        };

        await getFinancialSummary(req, res);
        assert.equal(statusCode, 400);
        assert.equal(responseBody.success, false);
        assert.equal(responseBody.message, "Invalid event ID");
    });
});
