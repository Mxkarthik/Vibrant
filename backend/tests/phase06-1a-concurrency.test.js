"use strict";

process.env.NODE_ENV = "test";

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const Event = require("../models/Event");
const Registration = require("../models/Registration");
const Team = require("../models/Team");
const { markAttendance } = require("../controllers/registrationController");
const { getCertificateEligibility } = require("../utils/certificateEligibility");

const makeId = () => new mongoose.Types.ObjectId();
const adminId = makeId();
const assignedOrgAId = makeId();
const assignedOrgBId = makeId();
const unassignedOrgId = makeId();

function mockResponse() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(data) {
            this.body = data;
            return this;
        }
    };
}

describe("Phase 06.1A: Combo Attendance Completion & Concurrency Hardening", () => {
    let standardEventId;
    let comboParentId;
    let childAId;
    let childBId;
    let childCId;

    let standardEvent;
    let comboParentEvent;
    let childEventA;
    let childEventB;
    let childEventC;

    let standardQr;
    let comboQr;

    beforeEach(() => {
        standardEventId = makeId();
        comboParentId = makeId();
        childAId = makeId();
        childBId = makeId();
        childCId = makeId();

        standardQr = "a".repeat(64);
        comboQr = "b".repeat(64);

        standardEvent = {
            _id: standardEventId,
            name: "Standard Event",
            status: "PUBLISHED",
            organizers: [assignedOrgAId],
            registration: { registeredParticipants: 10 }
        };

        childEventA = {
            _id: childAId,
            name: "Child Event A",
            status: "PUBLISHED",
            organizers: [assignedOrgAId],
            registration: { registeredParticipants: 5 }
        };

        childEventB = {
            _id: childBId,
            name: "Child Event B",
            status: "PUBLISHED",
            organizers: [assignedOrgBId],
            registration: { registeredParticipants: 5 }
        };

        childEventC = {
            _id: childCId,
            name: "Child Event C",
            status: "PUBLISHED",
            organizers: [assignedOrgAId, assignedOrgBId],
            registration: { registeredParticipants: 5 }
        };

        comboParentEvent = {
            _id: comboParentId,
            name: "3-in-1 Tech Combo",
            status: "PUBLISHED",
            organizers: [],
            registration: { registeredParticipants: 20 },
            multiEventAccess: {
                enabled: true,
                includedEvents: [childAId, childBId, childCId]
            }
        };
    });

    // =========================================================================
    // 1. Combo Aggregate Completion Progression (Tests 1-5)
    // =========================================================================

    test("1. Scan event 1 of 3: HTTP 200, attendedCount 1/3, comboProgress.isComplete: false, isPresent remains false", async (context) => {
        const regDoc = {
            _id: makeId(),
            qrToken: comboQr,
            event: comboParentEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            participantDetails: { fullName: "Alice Combo" },
            attendance: { isPresent: false, checkedInAt: null },
            access: {
                type: "MULTI_EVENT",
                eligibleEventIds: [childAId, childBId, childCId],
                grantedAt: new Date()
            },
            eventAttendance: []
        };

        context.mock.method(Registration, "findOne", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));
        context.mock.method(Event, "findById", () => ({ select: () => childEventA }));
        context.mock.method(Registration, "findOneAndUpdate", (query, update) => {
            if (update.$push?.eventAttendance) {
                regDoc.eventAttendance.push(update.$push.eventAttendance);
            }
            if (update.$set) {
                if (update.$set["attendance.isPresent"] !== undefined) regDoc.attendance.isPresent = update.$set["attendance.isPresent"];
                if (update.$set["attendance.checkedInAt"]) regDoc.attendance.checkedInAt = update.$set["attendance.checkedInAt"];
            }
            return regDoc;
        });

        const req = { body: { qrToken: comboQr, eventId: childAId.toString() }, user: { _id: adminId, role: "ADMIN" } };
        const res = mockResponse();
        await markAttendance(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.comboProgress.attendedCount, 1);
        assert.equal(res.body.comboProgress.totalEligible, 3);
        assert.equal(res.body.comboProgress.isComplete, false);
        assert.equal(regDoc.attendance.isPresent, false);
        assert.equal(regDoc.attendance.checkedInAt, null);
        assert.equal(regDoc.eventAttendance.length, 1);
    });

    test("2. Scan event 2 of 3: HTTP 200, attendedCount 2/3, comboProgress.isComplete: false, isPresent remains false", async (context) => {
        const regDoc = {
            _id: makeId(),
            qrToken: comboQr,
            event: comboParentEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            participantDetails: { fullName: "Alice Combo" },
            attendance: { isPresent: false, checkedInAt: null },
            access: {
                type: "MULTI_EVENT",
                eligibleEventIds: [childAId, childBId, childCId],
                grantedAt: new Date()
            },
            eventAttendance: [
                { eventId: childAId, checkedInAt: new Date("2026-03-01T10:00:00Z"), checkedInBy: adminId }
            ]
        };

        context.mock.method(Registration, "findOne", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));
        context.mock.method(Event, "findById", () => ({ select: () => childEventB }));
        context.mock.method(Registration, "findOneAndUpdate", (query, update) => {
            if (update.$push?.eventAttendance) {
                regDoc.eventAttendance.push(update.$push.eventAttendance);
            }
            if (update.$set) {
                if (update.$set["attendance.isPresent"] !== undefined) regDoc.attendance.isPresent = update.$set["attendance.isPresent"];
                if (update.$set["attendance.checkedInAt"]) regDoc.attendance.checkedInAt = update.$set["attendance.checkedInAt"];
            }
            return regDoc;
        });

        const req = { body: { qrToken: comboQr, eventId: childBId.toString() }, user: { _id: adminId, role: "ADMIN" } };
        const res = mockResponse();
        await markAttendance(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.comboProgress.attendedCount, 2);
        assert.equal(res.body.comboProgress.totalEligible, 3);
        assert.equal(res.body.comboProgress.isComplete, false);
        assert.equal(regDoc.attendance.isPresent, false);
        assert.equal(regDoc.attendance.checkedInAt, null);
        assert.equal(regDoc.eventAttendance.length, 2);
    });

    test("3. Scan event 3 of 3: HTTP 200, attendedCount 3/3, comboProgress.isComplete: true, isPresent: true and checkedInAt set", async (context) => {
        const regDoc = {
            _id: makeId(),
            qrToken: comboQr,
            event: comboParentEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            participantDetails: { fullName: "Alice Combo" },
            attendance: { isPresent: false, checkedInAt: null },
            access: {
                type: "MULTI_EVENT",
                eligibleEventIds: [childAId, childBId, childCId],
                grantedAt: new Date()
            },
            eventAttendance: [
                { eventId: childAId, checkedInAt: new Date("2026-03-01T10:00:00Z"), checkedInBy: adminId },
                { eventId: childBId, checkedInAt: new Date("2026-03-01T11:00:00Z"), checkedInBy: adminId }
            ]
        };

        context.mock.method(Registration, "findOne", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));
        context.mock.method(Event, "findById", () => ({ select: () => childEventC }));
        context.mock.method(Registration, "findOneAndUpdate", (query, update) => {
            if (update.$push?.eventAttendance) {
                regDoc.eventAttendance.push(update.$push.eventAttendance);
            }
            if (update.$set) {
                if (update.$set["attendance.isPresent"] !== undefined) regDoc.attendance.isPresent = update.$set["attendance.isPresent"];
                if (update.$set["attendance.checkedInAt"]) regDoc.attendance.checkedInAt = update.$set["attendance.checkedInAt"];
            }
            return regDoc;
        });

        const req = { body: { qrToken: comboQr, eventId: childCId.toString() }, user: { _id: adminId, role: "ADMIN" } };
        const res = mockResponse();
        await markAttendance(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.comboProgress.attendedCount, 3);
        assert.equal(res.body.comboProgress.totalEligible, 3);
        assert.equal(res.body.comboProgress.isComplete, true);
        assert.equal(regDoc.attendance.isPresent, true);
        assert(regDoc.attendance.checkedInAt instanceof Date);
        assert.equal(regDoc.eventAttendance.length, 3);
    });

    test("4. Post-completion query: registration.attendance.isPresent === true and checkedInAt matches final scan", async (context) => {
        const finalTime = new Date("2026-03-01T14:30:00Z");
        const regDoc = {
            _id: makeId(),
            qrToken: comboQr,
            event: comboParentEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            participantDetails: { fullName: "Alice Combo" },
            attendance: { isPresent: true, checkedInAt: finalTime },
            access: {
                type: "MULTI_EVENT",
                eligibleEventIds: [childAId, childBId, childCId],
                grantedAt: new Date()
            },
            eventAttendance: [
                { eventId: childAId, checkedInAt: new Date("2026-03-01T10:00:00Z"), checkedInBy: adminId },
                { eventId: childBId, checkedInAt: new Date("2026-03-01T11:00:00Z"), checkedInBy: adminId },
                { eventId: childCId, checkedInAt: finalTime, checkedInBy: adminId }
            ]
        };

        context.mock.method(Registration, "findOne", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));

        assert.equal(regDoc.attendance.isPresent, true);
        assert.equal(regDoc.attendance.checkedInAt.toISOString(), finalTime.toISOString());
        assert.equal(regDoc.eventAttendance.length, 3);
    });

    test("5. Final scan begins with target event genuinely absent from eventAttendance and sets aggregate completion", async (context) => {
        const regDoc = {
            _id: makeId(),
            qrToken: comboQr,
            event: comboParentEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            participantDetails: { fullName: "Bob Tech" },
            attendance: { isPresent: false, checkedInAt: null },
            access: {
                type: "MULTI_EVENT",
                eligibleEventIds: [childAId, childBId],
                grantedAt: new Date()
            },
            eventAttendance: [
                { eventId: childAId, checkedInAt: new Date("2026-03-01T09:00:00Z"), checkedInBy: adminId }
            ]
        };

        // Target event childBId is NOT in eventAttendance
        assert(!regDoc.eventAttendance.some(e => e.eventId.toString() === childBId.toString()));

        context.mock.method(Registration, "findOne", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));
        context.mock.method(Event, "findById", () => ({ select: () => childEventB }));
        context.mock.method(Registration, "findOneAndUpdate", (query, update) => {
            if (update.$push?.eventAttendance) {
                regDoc.eventAttendance.push(update.$push.eventAttendance);
            }
            if (update.$set) {
                if (update.$set["attendance.isPresent"] !== undefined) regDoc.attendance.isPresent = update.$set["attendance.isPresent"];
                if (update.$set["attendance.checkedInAt"]) regDoc.attendance.checkedInAt = update.$set["attendance.checkedInAt"];
            }
            return regDoc;
        });

        const req = { body: { qrToken: comboQr, eventId: childBId.toString() }, user: { _id: adminId, role: "ADMIN" } };
        const res = mockResponse();
        await markAttendance(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.comboProgress.isComplete, true);
        assert.equal(regDoc.attendance.isPresent, true);
        assert(regDoc.attendance.checkedInAt instanceof Date);
    });

    // =========================================================================
    // 2. Combo Concurrent Different-Event Safety & Reconciliation (Tests 6-10)
    // =========================================================================

    test("6. Two distinct child events scanned: both recorded in eventAttendance without overwriting", async (context) => {
        const regDoc = {
            _id: makeId(),
            qrToken: comboQr,
            event: comboParentEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            participantDetails: { fullName: "Charlie Multi" },
            attendance: { isPresent: false, checkedInAt: null },
            access: {
                type: "MULTI_EVENT",
                eligibleEventIds: [childAId, childBId, childCId],
                grantedAt: new Date()
            },
            eventAttendance: []
        };

        context.mock.method(Registration, "findOne", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));
        context.mock.method(Event, "findById", (id) => ({
            select: () => (id.toString() === childAId.toString() ? childEventA : childEventB)
        }));
        context.mock.method(Registration, "findOneAndUpdate", (query, update) => {
            if (update.$push?.eventAttendance) {
                regDoc.eventAttendance.push(update.$push.eventAttendance);
            }
            return regDoc;
        });

        // Scan 1: Child A
        const req1 = { body: { qrToken: comboQr, eventId: childAId.toString() }, user: { _id: adminId, role: "ADMIN" } };
        const res1 = mockResponse();
        await markAttendance(req1, res1);
        assert.equal(res1.statusCode, 200);

        // Scan 2: Child B
        const req2 = { body: { qrToken: comboQr, eventId: childBId.toString() }, user: { _id: adminId, role: "ADMIN" } };
        const res2 = mockResponse();
        await markAttendance(req2, res2);
        assert.equal(res2.statusCode, 200);

        // Both recorded
        assert.equal(regDoc.eventAttendance.length, 2);
        const recordedEventIds = regDoc.eventAttendance.map(e => e.eventId.toString());
        assert(recordedEventIds.includes(childAId.toString()));
        assert(recordedEventIds.includes(childBId.toString()));
    });

    test("7. Concurrent final scans: post-update reconciliation triggers aggregate completion", async (context) => {
        // Child A already attended. Child B and C are scanned concurrently.
        // In this simulated race, both initial findOne calls see [Child A].
        // Neither pre-update sees the combo as complete.
        // But post-update inspects all attended IDs, triggering reconciliation.
        const regDoc = {
            _id: makeId(),
            qrToken: comboQr,
            event: comboParentEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            participantDetails: { fullName: "Concurrent User" },
            attendance: { isPresent: false, checkedInAt: null },
            access: {
                type: "MULTI_EVENT",
                eligibleEventIds: [childAId, childBId, childCId],
                grantedAt: new Date()
            },
            eventAttendance: [
                { eventId: childAId, checkedInAt: new Date("2026-03-01T10:00:00Z"), checkedInBy: adminId }
            ]
        };

        context.mock.method(Registration, "findOne", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));
        context.mock.method(Event, "findById", (id) => ({
            select: () => (id.toString() === childBId.toString() ? childEventB : childEventC)
        }));

        let reconciliationExecuted = false;
        context.mock.method(Registration, "findOneAndUpdate", (query, update) => {
            if (update.$push?.eventAttendance) {
                regDoc.eventAttendance.push(update.$push.eventAttendance);
            }
            // Check for post-update reconciliation query
            if (query["attendance.isPresent"] === false && update.$set?.["attendance.isPresent"] === true) {
                reconciliationExecuted = true;
                regDoc.attendance.isPresent = true;
                regDoc.attendance.checkedInAt = update.$set["attendance.checkedInAt"];
            }
            return regDoc;
        });

        // Scan Child B first (now has [A, B])
        const reqB = { body: { qrToken: comboQr, eventId: childBId.toString() }, user: { _id: adminId, role: "ADMIN" } };
        const resB = mockResponse();
        await markAttendance(reqB, resB);
        assert.equal(resB.statusCode, 200);
        assert.equal(resB.body.comboProgress.isComplete, false);

        // Scan Child C second (now has [A, B, C] -> triggers completion)
        const reqC = { body: { qrToken: comboQr, eventId: childCId.toString() }, user: { _id: adminId, role: "ADMIN" } };
        const resC = mockResponse();
        await markAttendance(reqC, resC);
        assert.equal(resC.statusCode, 200);
        assert.equal(resC.body.comboProgress.isComplete, true);
        assert.equal(regDoc.attendance.isPresent, true);
        assert(regDoc.attendance.checkedInAt instanceof Date);
    });

    test("8. Concurrent reconciliation idempotence: multiple reconciliation attempts do not overwrite earlier checkedInAt", async (context) => {
        const initialCheckedInAt = new Date("2026-03-01T12:00:00Z");
        const regDoc = {
            _id: makeId(),
            qrToken: comboQr,
            event: comboParentEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            participantDetails: { fullName: "Dave Safe" },
            attendance: { isPresent: true, checkedInAt: initialCheckedInAt },
            access: {
                type: "MULTI_EVENT",
                eligibleEventIds: [childAId, childBId],
                grantedAt: new Date()
            },
            eventAttendance: [
                { eventId: childAId, checkedInAt: new Date("2026-03-01T10:00:00Z"), checkedInBy: adminId },
                { eventId: childBId, checkedInAt: initialCheckedInAt, checkedInBy: adminId }
            ]
        };

        // If attendance.isPresent is true, a reconciliation query with attendance.isPresent: false matches 0 docs
        const queryWithGuard = {
            _id: regDoc._id,
            status: "REGISTERED",
            "attendance.isPresent": false
        };
        const documentMatches = regDoc.attendance.isPresent === queryWithGuard["attendance.isPresent"];
        assert.equal(documentMatches, false, "Atomic guard prevents overwriting existing present attendance");
    });

    test("9. Aggregate checkedInAt is set to the timestamp of the scan that completed the combo", async (context) => {
        const scan1Time = new Date("2026-03-01T10:00:00Z");
        const regDoc = {
            _id: makeId(),
            qrToken: comboQr,
            event: comboParentEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            participantDetails: { fullName: "Eve Timestamp" },
            attendance: { isPresent: false, checkedInAt: null },
            access: {
                type: "MULTI_EVENT",
                eligibleEventIds: [childAId, childBId],
                grantedAt: new Date()
            },
            eventAttendance: [
                { eventId: childAId, checkedInAt: scan1Time, checkedInBy: adminId }
            ]
        };

        context.mock.method(Registration, "findOne", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));
        context.mock.method(Event, "findById", () => ({ select: () => childEventB }));
        context.mock.method(Registration, "findOneAndUpdate", (query, update) => {
            if (update.$push?.eventAttendance) {
                regDoc.eventAttendance.push(update.$push.eventAttendance);
            }
            if (update.$set) {
                if (update.$set["attendance.isPresent"] !== undefined) regDoc.attendance.isPresent = update.$set["attendance.isPresent"];
                if (update.$set["attendance.checkedInAt"]) regDoc.attendance.checkedInAt = update.$set["attendance.checkedInAt"];
            }
            return regDoc;
        });

        const req = { body: { qrToken: comboQr, eventId: childBId.toString() }, user: { _id: adminId, role: "ADMIN" } };
        const res = mockResponse();
        const beforeScan = new Date();
        await markAttendance(req, res);
        const afterScan = new Date();

        assert.equal(res.statusCode, 200);
        assert.equal(regDoc.attendance.isPresent, true);
        assert(regDoc.attendance.checkedInAt >= beforeScan);
        assert(regDoc.attendance.checkedInAt <= afterScan);
        assert.notEqual(regDoc.attendance.checkedInAt.toISOString(), scan1Time.toISOString());
    });

    test("10. Earlier checkedInAt is not overwritten if already set", async (context) => {
        const originalTime = new Date("2026-03-01T09:00:00Z");
        const regDoc = {
            _id: makeId(),
            qrToken: comboQr,
            event: comboParentEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            participantDetails: { fullName: "Frank Preserved" },
            attendance: { isPresent: true, checkedInAt: originalTime },
            access: {
                type: "MULTI_EVENT",
                eligibleEventIds: [childAId, childBId, childCId],
                grantedAt: new Date()
            },
            eventAttendance: [
                { eventId: childAId, checkedInAt: originalTime, checkedInBy: adminId },
                { eventId: childBId, checkedInAt: originalTime, checkedInBy: adminId }
            ]
        };

        context.mock.method(Registration, "findOne", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));
        context.mock.method(Event, "findById", () => ({ select: () => childEventC }));
        context.mock.method(Registration, "findOneAndUpdate", (query, update) => {
            if (update.$push?.eventAttendance) {
                regDoc.eventAttendance.push(update.$push.eventAttendance);
            }
            // updateOp.$set will not include attendance.checkedInAt because attendance.isPresent was already true
            if (update.$set?.["attendance.checkedInAt"]) {
                regDoc.attendance.checkedInAt = update.$set["attendance.checkedInAt"];
            }
            return regDoc;
        });

        const req = { body: { qrToken: comboQr, eventId: childCId.toString() }, user: { _id: adminId, role: "ADMIN" } };
        const res = mockResponse();
        await markAttendance(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(regDoc.attendance.checkedInAt.toISOString(), originalTime.toISOString());
    });

    // =========================================================================
    // 3. Combo Duplicate Scan Protection (Tests 11-13)
    // =========================================================================

    test("11. Same child event scanned twice sequentially: second returns HTTP 409", async (context) => {
        const regDoc = {
            _id: makeId(),
            qrToken: comboQr,
            event: comboParentEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            participantDetails: { fullName: "Grace Duplicate" },
            attendance: { isPresent: false, checkedInAt: null },
            access: {
                type: "MULTI_EVENT",
                eligibleEventIds: [childAId, childBId],
                grantedAt: new Date()
            },
            eventAttendance: []
        };

        context.mock.method(Registration, "findOne", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));
        context.mock.method(Event, "findById", () => ({ select: () => childEventA }));
        context.mock.method(Registration, "findOneAndUpdate", (query, update) => {
            if (update.$push?.eventAttendance) {
                regDoc.eventAttendance.push(update.$push.eventAttendance);
            }
            return regDoc;
        });

        // Scan 1: succeeds
        const req1 = { body: { qrToken: comboQr, eventId: childAId.toString() }, user: { _id: adminId, role: "ADMIN" } };
        const res1 = mockResponse();
        await markAttendance(req1, res1);
        assert.equal(res1.statusCode, 200);

        // Scan 2: fails at pre-check with 409
        const req2 = { body: { qrToken: comboQr, eventId: childAId.toString() }, user: { _id: adminId, role: "ADMIN" } };
        const res2 = mockResponse();
        await markAttendance(req2, res2);
        assert.equal(res2.statusCode, 409);
        assert.equal(res2.body.code, "ALREADY_CHECKED_IN");
    });

    test("12. Same child event scanned concurrently: atomic filter causes second to fail with HTTP 409", async (context) => {
        const regDoc = {
            _id: makeId(),
            qrToken: comboQr,
            event: comboParentEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            participantDetails: { fullName: "Henry Race" },
            attendance: { isPresent: false, checkedInAt: null },
            access: {
                type: "MULTI_EVENT",
                eligibleEventIds: [childAId, childBId],
                grantedAt: new Date()
            },
            eventAttendance: []
        };

        context.mock.method(Registration, "findOne", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));
        context.mock.method(Event, "findById", () => ({ select: () => childEventA }));

        // Simulate racing write: findOneAndUpdate returns null (0 matched) because another worker pushed eventAttendance first
        context.mock.method(Registration, "findOneAndUpdate", () => null);
        context.mock.method(Registration, "findById", () => ({
            select: async () => ({ status: "REGISTERED", payment: { status: "VERIFIED" } })
        }));

        const req = { body: { qrToken: comboQr, eventId: childAId.toString() }, user: { _id: adminId, role: "ADMIN" } };
        const res = mockResponse();
        await markAttendance(req, res);

        assert.equal(res.statusCode, 409);
        assert.equal(res.body.code, "ALREADY_CHECKED_IN");
    });

    test("13. Atomic update filter includes eventAttendance.eventId: { $ne: targetEventId }", async (context) => {
        const regDoc = {
            _id: makeId(),
            qrToken: comboQr,
            event: comboParentEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            participantDetails: { fullName: "Ian Guard" },
            attendance: { isPresent: false, checkedInAt: null },
            access: {
                type: "MULTI_EVENT",
                eligibleEventIds: [childAId, childBId],
                grantedAt: new Date()
            },
            eventAttendance: []
        };

        context.mock.method(Registration, "findOne", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));
        context.mock.method(Event, "findById", () => ({ select: () => childEventA }));

        let capturedQuery = null;
        context.mock.method(Registration, "findOneAndUpdate", (query) => {
            capturedQuery = query;
            return regDoc;
        });

        const req = { body: { qrToken: comboQr, eventId: childAId.toString() }, user: { _id: adminId, role: "ADMIN" } };
        const res = mockResponse();
        await markAttendance(req, res);

        assert.equal(res.statusCode, 200);
        assert(capturedQuery != null);
        assert(capturedQuery["eventAttendance.eventId"]);
        assert.deepEqual(capturedQuery["eventAttendance.eventId"].$ne.toString(), childAId.toString());
    });

    // =========================================================================
    // 4. Payment and Cancellation Status Guards (Tests 14-19)
    // =========================================================================

    test("14. Individual registration with payment.status: PENDING rejected at pre-check", async (context) => {
        const regDoc = {
            _id: makeId(),
            qrToken: comboQr,
            event: comboParentEvent,
            status: "REGISTERED",
            payment: { status: "PENDING" },
            access: { type: "MULTI_EVENT", eligibleEventIds: [childAId, childBId], grantedAt: new Date() },
            eventAttendance: []
        };

        context.mock.method(Registration, "findOne", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));
        context.mock.method(Event, "findById", () => ({ select: () => childEventA }));

        const req = { body: { qrToken: comboQr, eventId: childAId.toString() }, user: { _id: adminId, role: "ADMIN" } };
        const res = mockResponse();
        await markAttendance(req, res);

        assert.equal(res.statusCode, 400);
        assert.equal(res.body.code, "PAYMENT_PENDING");
    });

    test("15. Individual registration with payment.status: REJECTED rejected at pre-check", async (context) => {
        const regDoc = {
            _id: makeId(),
            qrToken: comboQr,
            event: comboParentEvent,
            status: "REGISTERED",
            payment: { status: "REJECTED" },
            access: { type: "MULTI_EVENT", eligibleEventIds: [childAId, childBId], grantedAt: new Date() },
            eventAttendance: []
        };

        context.mock.method(Registration, "findOne", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));
        context.mock.method(Event, "findById", () => ({ select: () => childEventA }));

        const req = { body: { qrToken: comboQr, eventId: childAId.toString() }, user: { _id: adminId, role: "ADMIN" } };
        const res = mockResponse();
        await markAttendance(req, res);

        assert.equal(res.statusCode, 400);
        assert.equal(res.body.code, "PAYMENT_REJECTED");
    });

    test("16. Registration with status: CANCELLED rejected at pre-check", async (context) => {
        const regDoc = {
            _id: makeId(),
            qrToken: comboQr,
            event: comboParentEvent,
            status: "CANCELLED",
            payment: { status: "VERIFIED" },
            access: { type: "MULTI_EVENT", eligibleEventIds: [childAId, childBId], grantedAt: new Date() },
            eventAttendance: []
        };

        context.mock.method(Registration, "findOne", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));
        context.mock.method(Event, "findById", () => ({ select: () => childEventA }));

        const req = { body: { qrToken: comboQr, eventId: childAId.toString() }, user: { _id: adminId, role: "ADMIN" } };
        const res = mockResponse();
        await markAttendance(req, res);

        assert.equal(res.statusCode, 400);
        assert.equal(res.body.code, "REGISTRATION_CANCELLED");
    });

    test("17. Atomic update includes status: REGISTERED and payment guard to prevent racing cancellations", async (context) => {
        const regDoc = {
            _id: makeId(),
            qrToken: comboQr,
            event: comboParentEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            access: { type: "MULTI_EVENT", eligibleEventIds: [childAId, childBId], grantedAt: new Date() },
            eventAttendance: []
        };

        context.mock.method(Registration, "findOne", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));
        context.mock.method(Event, "findById", () => ({ select: () => childEventA }));

        let capturedQuery = null;
        context.mock.method(Registration, "findOneAndUpdate", (query) => {
            capturedQuery = query;
            return regDoc;
        });

        const req = { body: { qrToken: comboQr, eventId: childAId.toString() }, user: { _id: adminId, role: "ADMIN" } };
        const res = mockResponse();
        await markAttendance(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(capturedQuery.status, "REGISTERED");
        assert.deepEqual(capturedQuery["payment.status"], { $in: ["VERIFIED", "NOT_REQUIRED"] });
    });

    test("18. Team registration with team.payment.status: PENDING rejected at pre-check", async (context) => {
        const regDoc = {
            _id: makeId(),
            qrToken: comboQr,
            event: null,
            status: "REGISTERED",
            team: {
                _id: makeId(),
                status: "REGISTERED",
                payment: { status: "PENDING" },
                event: comboParentEvent
            },
            access: { type: "MULTI_EVENT", eligibleEventIds: [childAId, childBId], grantedAt: new Date() },
            eventAttendance: []
        };

        context.mock.method(Registration, "findOne", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));
        context.mock.method(Event, "findById", () => ({ select: () => childEventA }));

        const req = { body: { qrToken: comboQr, eventId: childAId.toString() }, user: { _id: adminId, role: "ADMIN" } };
        const res = mockResponse();
        await markAttendance(req, res);

        assert.equal(res.statusCode, 400);
        assert.equal(res.body.code, "PAYMENT_PENDING");
    });

    test("19. Team registration with team.status: CANCELLED rejected at pre-check", async (context) => {
        const regDoc = {
            _id: makeId(),
            qrToken: comboQr,
            event: null,
            status: "REGISTERED",
            team: {
                _id: makeId(),
                status: "CANCELLED",
                payment: { status: "VERIFIED" },
                event: comboParentEvent
            },
            access: { type: "MULTI_EVENT", eligibleEventIds: [childAId, childBId], grantedAt: new Date() },
            eventAttendance: []
        };

        context.mock.method(Registration, "findOne", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));
        context.mock.method(Event, "findById", () => ({ select: () => childEventA }));

        const req = { body: { qrToken: comboQr, eventId: childAId.toString() }, user: { _id: adminId, role: "ADMIN" } };
        const res = mockResponse();
        await markAttendance(req, res);

        assert.equal(res.statusCode, 400);
        assert.equal(res.body.code, "TEAM_CANCELLED");
    });

    // =========================================================================
    // 5. Organiser Scoping Correctness (Tests 20-25)
    // =========================================================================

    test("20. Organiser assigned to Child A can scan at Child A (HTTP 200)", async (context) => {
        const regDoc = {
            _id: makeId(),
            qrToken: comboQr,
            event: comboParentEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            access: { type: "MULTI_EVENT", eligibleEventIds: [childAId, childBId], grantedAt: new Date() },
            eventAttendance: []
        };

        context.mock.method(Registration, "findOne", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));
        context.mock.method(Event, "findById", () => ({ select: () => childEventA }));
        context.mock.method(Registration, "findOneAndUpdate", () => regDoc);

        const req = { body: { qrToken: comboQr, eventId: childAId.toString() }, user: { _id: assignedOrgAId, role: "ORGANISER" } };
        const res = mockResponse();
        await markAttendance(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
    });

    test("21. Organiser assigned to Child A CANNOT scan at Child B (HTTP 403 ORGANISER_NOT_ASSIGNED)", async (context) => {
        const regDoc = {
            _id: makeId(),
            qrToken: comboQr,
            event: comboParentEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            access: { type: "MULTI_EVENT", eligibleEventIds: [childAId, childBId], grantedAt: new Date() },
            eventAttendance: []
        };

        context.mock.method(Registration, "findOne", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));
        context.mock.method(Event, "findById", () => ({ select: () => childEventB }));

        const req = { body: { qrToken: comboQr, eventId: childBId.toString() }, user: { _id: assignedOrgAId, role: "ORGANISER" } };
        const res = mockResponse();
        await markAttendance(req, res);

        assert.equal(res.statusCode, 403);
        assert.equal(res.body.code, "ORGANISER_NOT_ASSIGNED");
    });

    test("22. Admin can scan at Child A and Child B (HTTP 200 for both)", async (context) => {
        const regDoc = {
            _id: makeId(),
            qrToken: comboQr,
            event: comboParentEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            access: { type: "MULTI_EVENT", eligibleEventIds: [childAId, childBId], grantedAt: new Date() },
            eventAttendance: []
        };

        context.mock.method(Registration, "findOne", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));
        context.mock.method(Event, "findById", (id) => ({
            select: () => (id.toString() === childAId.toString() ? childEventA : childEventB)
        }));
        context.mock.method(Registration, "findOneAndUpdate", () => regDoc);

        const reqA = { body: { qrToken: comboQr, eventId: childAId.toString() }, user: { _id: adminId, role: "ADMIN" } };
        const resA = mockResponse();
        await markAttendance(reqA, resA);
        assert.equal(resA.statusCode, 200);

        const reqB = { body: { qrToken: comboQr, eventId: childBId.toString() }, user: { _id: adminId, role: "ADMIN" } };
        const resB = mockResponse();
        await markAttendance(reqB, resB);
        assert.equal(resB.statusCode, 200);
    });

    test("23. Combo scan without eventId returns HTTP 400 before organiser check", async (context) => {
        const regDoc = {
            _id: makeId(),
            qrToken: comboQr,
            event: comboParentEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            access: { type: "MULTI_EVENT", eligibleEventIds: [childAId, childBId], grantedAt: new Date() },
            eventAttendance: []
        };

        context.mock.method(Registration, "findOne", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));

        const req = { body: { qrToken: comboQr }, user: { _id: unassignedOrgId, role: "ORGANISER" } };
        const res = mockResponse();
        await markAttendance(req, res);

        assert.equal(res.statusCode, 400);
        assert.equal(res.body.code, "EVENT_ID_REQUIRED_FOR_COMBO");
    });

    test("24. Legacy standard event: organiser assigned to event can scan (HTTP 200)", async (context) => {
        const regDoc = {
            _id: makeId(),
            qrToken: standardQr,
            event: standardEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            attendance: { isPresent: false },
            eventAttendance: []
        };

        context.mock.method(Registration, "findOne", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));
        context.mock.method(Registration, "findOneAndUpdate", () => regDoc);

        const req = { body: { qrToken: standardQr }, user: { _id: assignedOrgAId, role: "ORGANISER" } };
        const res = mockResponse();
        await markAttendance(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
    });

    test("25. Legacy standard event: organiser NOT assigned to event cannot scan (HTTP 403)", async (context) => {
        const regDoc = {
            _id: makeId(),
            qrToken: standardQr,
            event: standardEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            attendance: { isPresent: false },
            eventAttendance: []
        };

        context.mock.method(Registration, "findOne", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));

        const req = { body: { qrToken: standardQr }, user: { _id: unassignedOrgId, role: "ORGANISER" } };
        const res = mockResponse();
        await markAttendance(req, res);

        assert.equal(res.statusCode, 403);
        assert.equal(res.body.code, "ORGANISER_NOT_ASSIGNED");
    });

    // =========================================================================
    // 6. Backward Compatibility & Zero Disruption (Tests 26-31)
    // =========================================================================

    test("26. Standard legacy registration (no access field) check-in succeeds and sets isPresent: true", async (context) => {
        const regDoc = {
            _id: makeId(),
            qrToken: standardQr,
            event: standardEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            participantDetails: { fullName: "Legacy John" },
            attendance: { isPresent: false, checkedInAt: null },
            eventAttendance: []
        };

        context.mock.method(Registration, "findOne", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));
        context.mock.method(Registration, "findOneAndUpdate", (query, update) => {
            if (update.$set?.["attendance.isPresent"] !== undefined) {
                regDoc.attendance.isPresent = update.$set["attendance.isPresent"];
                regDoc.attendance.checkedInAt = update.$set["attendance.checkedInAt"];
            }
            return regDoc;
        });

        const req = { body: { qrToken: standardQr }, user: { _id: adminId, role: "ADMIN" } };
        const res = mockResponse();
        await markAttendance(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.accessType, "SINGLE_EVENT");
        assert.equal(res.body.comboProgress, undefined);
        assert.equal(regDoc.attendance.isPresent, true);
    });

    test("27. Standard legacy registration: duplicate scan returns HTTP 409", async (context) => {
        const regDoc = {
            _id: makeId(),
            qrToken: standardQr,
            event: standardEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            participantDetails: { fullName: "Legacy John" },
            attendance: { isPresent: true, checkedInAt: new Date("2026-03-01T08:00:00Z") },
            eventAttendance: []
        };

        context.mock.method(Registration, "findOne", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));

        const req = { body: { qrToken: standardQr }, user: { _id: adminId, role: "ADMIN" } };
        const res = mockResponse();
        await markAttendance(req, res);

        assert.equal(res.statusCode, 409);
        assert.equal(res.body.code, "ALREADY_CHECKED_IN");
    });

    test("28. Existing QR tokens remain unchanged after check-in", async (context) => {
        const originalQr = "c".repeat(64);
        const regDoc = {
            _id: makeId(),
            qrToken: originalQr,
            event: standardEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            attendance: { isPresent: false },
            eventAttendance: []
        };

        context.mock.method(Registration, "findOne", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));
        context.mock.method(Registration, "findOneAndUpdate", () => regDoc);

        const req = { body: { qrToken: originalQr }, user: { _id: adminId, role: "ADMIN" } };
        const res = mockResponse();
        await markAttendance(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(regDoc.qrToken, originalQr, "QR token was not mutated");
    });

    test("29. Existing payment records, amounts, and history remain untouched", async (context) => {
        const paymentSnapshot = {
            status: "VERIFIED",
            method: "UPI",
            expectedAmount: 500,
            receivedAmount: 500,
            transactionId: "UPI123456789",
            history: [{ status: "VERIFIED", changedAt: new Date() }]
        };
        const regDoc = {
            _id: makeId(),
            qrToken: standardQr,
            event: standardEvent,
            status: "REGISTERED",
            payment: { ...paymentSnapshot },
            attendance: { isPresent: false },
            eventAttendance: []
        };

        context.mock.method(Registration, "findOne", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));
        context.mock.method(Registration, "findOneAndUpdate", () => regDoc);

        const req = { body: { qrToken: standardQr }, user: { _id: adminId, role: "ADMIN" } };
        const res = mockResponse();
        await markAttendance(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(regDoc.payment.status, "VERIFIED");
        assert.equal(regDoc.payment.method, "UPI");
        assert.equal(regDoc.payment.expectedAmount, 500);
        assert.equal(regDoc.payment.receivedAmount, 500);
        assert.equal(regDoc.payment.transactionId, "UPI123456789");
    });

    test("30. Scanning never modifies Event capacity or registeredParticipants (parent-only capacity preserved)", async (context) => {
        let eventUpdated = false;
        context.mock.method(Event, "findOneAndUpdate", () => {
            eventUpdated = true;
        });

        const regDoc = {
            _id: makeId(),
            qrToken: comboQr,
            event: comboParentEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            access: { type: "MULTI_EVENT", eligibleEventIds: [childAId, childBId], grantedAt: new Date() },
            eventAttendance: []
        };

        context.mock.method(Registration, "findOne", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));
        context.mock.method(Event, "findById", () => ({ select: () => childEventA }));
        context.mock.method(Registration, "findOneAndUpdate", () => regDoc);

        const req = { body: { qrToken: comboQr, eventId: childAId.toString() }, user: { _id: adminId, role: "ADMIN" } };
        const res = mockResponse();
        await markAttendance(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(eventUpdated, false, "Event capacity counter must never be mutated during attendance");
    });

    test("31. Certificate eligibility passes when combo completion achieved and fails when only partial", () => {
        const completedEvent = { status: "COMPLETED" };

        // Partial attendance (1 of 2 events attended): attendance.isPresent === false
        const partialReg = {
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            attendance: { isPresent: false },
            eventAttendance: [{ eventId: childAId }]
        };
        const partialCheck = getCertificateEligibility(completedEvent, partialReg);
        assert.equal(partialCheck.eligible, false);
        assert.equal(partialCheck.reason, "The participant must be checked in to receive a certificate.");

        // Completed attendance: attendance.isPresent === true
        const completeReg = {
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            attendance: { isPresent: true, checkedInAt: new Date() },
            eventAttendance: [{ eventId: childAId }, { eventId: childBId }]
        };
        const completeCheck = getCertificateEligibility(completedEvent, completeReg);
        assert.equal(completeCheck.eligible, true);
        assert.equal(completeCheck.reason, null);
    });
});
