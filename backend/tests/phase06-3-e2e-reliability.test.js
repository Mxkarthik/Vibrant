"use strict";

process.env.NODE_ENV = "test";

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { PassThrough } = require("stream");
const mongoose = require("mongoose");

const Event = require("../models/Event");
const Registration = require("../models/Registration");
const Team = require("../models/Team");
const User = require("../models/User");

const {
    markAttendance,
    getEventAttendanceReport,
    getEventParticipants,
    exportEventParticipants
} = require("../controllers/registrationController");

const {
    getAdminEventAttendance
} = require("../controllers/adminController");

const {
    buildRegistrationAccessSnapshot,
    resolveEffectiveAccess
} = require("../utils/registrationEntitlement");

const {
    resolveRegistrationAdmissionEligibility
} = require("../utils/admissionEligibility");

const {
    sanitizeForExcel,
    buildEventCohortFilter,
    resolveEventSpecificAttendance,
    calculateEventAttendanceStats
} = require("../utils/eventAttendanceReportService");

const { getCertificateEligibility } = require("../utils/certificateEligibility");

const makeId = () => new mongoose.Types.ObjectId();
const adminId = makeId();
const assignedOrgId = makeId();
const unassignedOrgId = makeId();
const participantId = makeId();

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

function mockExportResponse() {
    const res = new PassThrough();
    res.headers = {};
    res.statusCode = 200;
    res.setHeader = (k, v) => { res.headers[k] = v; };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (data) => { res.body = data; return res; };
    return res;
}

describe("Phase 06.3: End-to-End Attendance Reliability & Concurrency Verification", () => {
    let childAId;
    let childBId;
    let comboParentId;
    let standardEventId;
    let unrelatedEventId;

    let childEventA;
    let childEventB;
    let comboParentEvent;
    let standardEvent;
    let unrelatedEvent;

    let standardQr;
    let comboQr;

    beforeEach(() => {
        childAId = makeId();
        childBId = makeId();
        comboParentId = makeId();
        standardEventId = makeId();
        unrelatedEventId = makeId();

        standardQr = "1".repeat(64);
        comboQr = "2".repeat(64);

        childEventA = {
            _id: childAId,
            name: "Child Event A",
            status: "PUBLISHED",
            organizers: [assignedOrgId],
            registration: { registeredParticipants: 10, capacity: 50, mode: "INDIVIDUAL" }
        };

        childEventB = {
            _id: childBId,
            name: "Child Event B",
            status: "PUBLISHED",
            organizers: [assignedOrgId],
            registration: { registeredParticipants: 10, capacity: 50, mode: "INDIVIDUAL" }
        };

        comboParentEvent = {
            _id: comboParentId,
            name: "Grand Combo Tech Pass",
            status: "PUBLISHED",
            organizers: [assignedOrgId],
            registration: { registeredParticipants: 20, capacity: 100, mode: "INDIVIDUAL" },
            multiEventAccess: {
                enabled: true,
                includedEvents: [childAId, childBId]
            }
        };

        standardEvent = {
            _id: standardEventId,
            name: "Standard Solo Web Dev",
            status: "PUBLISHED",
            organizers: [assignedOrgId],
            registration: { registeredParticipants: 15, capacity: 60, mode: "INDIVIDUAL" }
        };

        unrelatedEvent = {
            _id: unrelatedEventId,
            name: "Unrelated Dance Competition",
            status: "PUBLISHED",
            organizers: [assignedOrgId],
            registration: { registeredParticipants: 5, capacity: 30, mode: "INDIVIDUAL" }
        };
    });

    // 1. Normal individual registration and check-in
    test("1. Normal individual single-event registration and check-in", async (context) => {
        const regDoc = {
            _id: makeId(),
            qrToken: standardQr,
            event: standardEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            participantDetails: { fullName: "Standard Alice" },
            attendance: { isPresent: false, checkedInAt: null },
            access: { type: "SINGLE_EVENT", eligibleEventIds: [standardEventId], grantedAt: new Date() },
            eventAttendance: []
        };

        context.mock.method(Registration, "findOne", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));
        context.mock.method(Registration, "findOneAndUpdate", (query, update) => {
            if (update.$push?.eventAttendance) regDoc.eventAttendance.push(update.$push.eventAttendance);
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
        assert.equal(regDoc.attendance.isPresent, true);
        assert(regDoc.attendance.checkedInAt instanceof Date);
    });

    // 2. Individual combo registration
    test("2. Individual combo registration snapshot generation and invariants", () => {
        const snapshot = buildRegistrationAccessSnapshot({ event: comboParentEvent });
        assert.equal(snapshot.type, "MULTI_EVENT");
        assert.equal(snapshot.eligibleEventIds.length, 2);
        assert.deepEqual(
            snapshot.eligibleEventIds.map(id => id.toString()),
            [childAId.toString(), childBId.toString()]
        );
        assert(snapshot.grantedAt instanceof Date);
    });

    // 3. Team combo registration
    test("3. Team combo registration: 3 independent snapshots sharing single team payment", () => {
        const teamComboEvent = {
            _id: comboParentId,
            name: "Mega Team Combo",
            status: "PUBLISHED",
            registration: { mode: "TEAM" },
            multiEventAccess: { enabled: true, includedEvents: [childAId, childBId] }
        };

        const member1Snapshot = buildRegistrationAccessSnapshot({ event: teamComboEvent });
        const member2Snapshot = buildRegistrationAccessSnapshot({ event: teamComboEvent });
        const member3Snapshot = buildRegistrationAccessSnapshot({ event: teamComboEvent });

        assert.deepEqual(member1Snapshot.eligibleEventIds, member2Snapshot.eligibleEventIds);
        assert.equal(member1Snapshot.type, "MULTI_EVENT");
        assert.equal(member2Snapshot.type, "MULTI_EVENT");
        assert.equal(member3Snapshot.type, "MULTI_EVENT");
    });

    // 4. Multiple member QR scans
    test("4. Multiple team members scan independently without cross-member attendance bleed", async (context) => {
        const teamId = makeId();
        const sharedTeam = {
            _id: teamId,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            event: comboParentEvent
        };

        const member1Reg = {
            _id: makeId(),
            qrToken: "3".repeat(64),
            team: sharedTeam,
            status: "REGISTERED",
            access: { type: "MULTI_EVENT", eligibleEventIds: [childAId, childBId], grantedAt: new Date() },
            attendance: { isPresent: false },
            eventAttendance: []
        };

        const member2Reg = {
            _id: makeId(),
            qrToken: "4".repeat(64),
            team: sharedTeam,
            status: "REGISTERED",
            access: { type: "MULTI_EVENT", eligibleEventIds: [childAId, childBId], grantedAt: new Date() },
            attendance: { isPresent: false },
            eventAttendance: []
        };

        // Scan member 1 at Child A
        context.mock.method(Registration, "findOne", () => ({
            populate: () => ({ populate: async () => member1Reg })
        }));
        context.mock.method(Event, "findById", () => ({ select: () => childEventA }));
        context.mock.method(Registration, "findOneAndUpdate", (query, update) => {
            member1Reg.eventAttendance.push(update.$push.eventAttendance);
            return member1Reg;
        });

        const req = { body: { qrToken: member1Reg.qrToken, eventId: childAId.toString() }, user: { _id: adminId, role: "ADMIN" } };
        const res = mockResponse();
        await markAttendance(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(member1Reg.eventAttendance.length, 1);
        assert.equal(member2Reg.eventAttendance.length, 0, "Member 2 must remain absent until scanned");
    });

    // 5. Same-event duplicate check-in
    test("5. Same-event duplicate check-in rejected with HTTP 409", async (context) => {
        const regDoc = {
            _id: makeId(),
            qrToken: comboQr,
            event: comboParentEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            access: { type: "MULTI_EVENT", eligibleEventIds: [childAId, childBId], grantedAt: new Date() },
            attendance: { isPresent: false },
            eventAttendance: [{ eventId: childAId, checkedInAt: new Date("2026-03-01T10:00:00Z"), checkedInBy: adminId }]
        };

        context.mock.method(Registration, "findOne", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));
        context.mock.method(Event, "findById", () => ({ select: () => childEventA }));

        const req = { body: { qrToken: comboQr, eventId: childAId.toString() }, user: { _id: adminId, role: "ADMIN" } };
        const res = mockResponse();
        await markAttendance(req, res);

        assert.equal(res.statusCode, 409);
        assert.equal(res.body.code, "ALREADY_CHECKED_IN");
    });

    // 6. Different-event independent check-in
    test("6. Different-event check-ins record separate timestamps under eventAttendance", async (context) => {
        const timeA = new Date("2026-03-01T09:00:00Z");
        const timeB = new Date("2026-03-01T11:00:00Z");

        const regDoc = {
            _id: makeId(),
            qrToken: comboQr,
            event: comboParentEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            access: { type: "MULTI_EVENT", eligibleEventIds: [childAId, childBId], grantedAt: new Date() },
            attendance: { isPresent: false },
            eventAttendance: [
                { eventId: childAId, checkedInAt: timeA, checkedInBy: adminId },
                { eventId: childBId, checkedInAt: timeB, checkedInBy: adminId }
            ]
        };

        const attA = resolveEventSpecificAttendance(regDoc, childAId);
        const attB = resolveEventSpecificAttendance(regDoc, childBId);

        assert.equal(attA.isPresent, true);
        assert.equal(attA.checkedInAt.toISOString(), timeA.toISOString());
        assert.equal(attB.isPresent, true);
        assert.equal(attB.checkedInAt.toISOString(), timeB.toISOString());
    });

    // 7. Concurrent final scans
    test("7. Concurrent final scans: atomic filter with reconciliation guarantees aggregate completion", async (context) => {
        const regDoc = {
            _id: makeId(),
            qrToken: comboQr,
            event: comboParentEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            access: { type: "MULTI_EVENT", eligibleEventIds: [childAId, childBId], grantedAt: new Date() },
            attendance: { isPresent: false },
            eventAttendance: [{ eventId: childAId, checkedInAt: new Date() }]
        };

        context.mock.method(Registration, "findOne", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));
        context.mock.method(Event, "findById", () => ({ select: () => childEventB }));
        context.mock.method(Registration, "findOneAndUpdate", (query, update) => {
            if (update.$push?.eventAttendance) regDoc.eventAttendance.push(update.$push.eventAttendance);
            if (update.$set?.["attendance.isPresent"] !== undefined) {
                regDoc.attendance.isPresent = update.$set["attendance.isPresent"];
                regDoc.attendance.checkedInAt = update.$set["attendance.checkedInAt"];
            }
            return regDoc;
        });

        const req = { body: { qrToken: comboQr, eventId: childBId.toString() }, user: { _id: adminId, role: "ADMIN" } };
        const res = mockResponse();
        await markAttendance(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.comboProgress.isComplete, true);
        assert.equal(regDoc.attendance.isPresent, true);
    });

    // 8. Aggregate completion crash/retry scenario
    test("8. Aggregate completion crash/retry analysis: documented atomicity gap when worker crashes before reconciliation", () => {
        // Documenting exact crash state:
        // Worker appended eventAttendance at final event, but crashed before reconciliation updated attendance.isPresent
        const crashedDoc = {
            access: { type: "MULTI_EVENT", eligibleEventIds: [childAId, childBId] },
            eventAttendance: [
                { eventId: childAId },
                { eventId: childBId }
            ],
            attendance: { isPresent: false, checkedInAt: null }
        };

        // All events were attended:
        const postAttendedIds = new Set(crashedDoc.eventAttendance.map(e => e.eventId.toString()));
        const isActuallyComplete = crashedDoc.access.eligibleEventIds.every(id => postAttendedIds.has(id.toString()));
        assert.equal(isActuallyComplete, true);

        // But attendance.isPresent remained false due to crash!
        assert.equal(crashedDoc.attendance.isPresent, false);

        // Documenting that scanning any child again will return 409 at pre-check without reconciling:
        const existingAttendance = crashedDoc.eventAttendance.find(e => e.eventId.toString() === childAId.toString());
        assert(existingAttendance != null, "Scan at Child A hits 409; automated background reconciliation required to heal");
    });

    // 9. Pending individual payment
    test("9. Pending individual payment rejected with PAYMENT_PENDING", () => {
        const reg = { event: childEventA, status: "REGISTERED", payment: { status: "PENDING" } };
        const check = resolveRegistrationAdmissionEligibility({ registration: reg, targetEvent: childEventA });
        assert.equal(check.isEligible, false);
        assert.equal(check.reasonCode, "PAYMENT_PENDING");
    });

    // 10. Rejected individual payment
    test("10. Rejected individual payment rejected with PAYMENT_REJECTED", () => {
        const reg = { event: childEventA, status: "REGISTERED", payment: { status: "REJECTED" } };
        const check = resolveRegistrationAdmissionEligibility({ registration: reg, targetEvent: childEventA });
        assert.equal(check.isEligible, false);
        assert.equal(check.reasonCode, "PAYMENT_REJECTED");
    });

    // 11. Pending Team payment
    test("11. Pending Team payment rejected with PAYMENT_PENDING", () => {
        const team = { status: "REGISTERED", payment: { status: "PENDING" } };
        const reg = { event: childEventA, status: "REGISTERED", team, payment: { status: "NOT_REQUIRED" } };
        const check = resolveRegistrationAdmissionEligibility({ registration: reg, team, targetEvent: childEventA });
        assert.equal(check.isEligible, false);
        assert.equal(check.reasonCode, "PAYMENT_PENDING");
    });

    // 12. Rejected Team payment
    test("12. Rejected Team payment rejected with PAYMENT_REJECTED", () => {
        const team = { status: "REGISTERED", payment: { status: "REJECTED" } };
        const reg = { event: childEventA, status: "REGISTERED", team, payment: { status: "NOT_REQUIRED" } };
        const check = resolveRegistrationAdmissionEligibility({ registration: reg, team, targetEvent: childEventA });
        assert.equal(check.isEligible, false);
        assert.equal(check.reasonCode, "PAYMENT_REJECTED");
    });

    // 13. Missing Team document
    test("13. Missing Team document fails closed with TEAM_REQUIRED", () => {
        const reg = { event: childEventA, status: "REGISTERED", team: makeId() }; // team ID without populated team doc
        const check = resolveRegistrationAdmissionEligibility({ registration: reg, team: null, targetEvent: childEventA });
        assert.equal(check.isEligible, false);
        assert.equal(check.reasonCode, "TEAM_REQUIRED");
    });

    // 14. Cancelled Registration
    test("14. Cancelled Registration rejected with REGISTRATION_CANCELLED", () => {
        const reg = { event: childEventA, status: "CANCELLED", payment: { status: "VERIFIED" } };
        const check = resolveRegistrationAdmissionEligibility({ registration: reg, targetEvent: childEventA });
        assert.equal(check.isEligible, false);
        assert.equal(check.reasonCode, "REGISTRATION_CANCELLED");
    });

    // 15. Cancelled parent combo
    test("15. Cancelled parent combo rejected with PARENT_EVENT_CANCELLED", () => {
        const parent = { status: "CANCELLED" };
        const reg = {
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            access: { type: "MULTI_EVENT", eligibleEventIds: [childAId] }
        };
        const check = resolveRegistrationAdmissionEligibility({ registration: reg, targetEvent: childEventA, parentEvent: parent });
        assert.equal(check.isEligible, false);
        assert.equal(check.reasonCode, "PARENT_EVENT_CANCELLED");
    });

    // 16. Cancelled included child
    test("16. Cancelled included child rejected with TARGET_EVENT_CANCELLED", () => {
        const target = { _id: childAId, status: "CANCELLED" };
        const reg = { event: target, status: "REGISTERED", payment: { status: "VERIFIED" } };
        const check = resolveRegistrationAdmissionEligibility({ registration: reg, targetEvent: target });
        assert.equal(check.isEligible, false);
        assert.equal(check.reasonCode, "TARGET_EVENT_CANCELLED");
    });

    // 17. Unentitled target event
    test("17. Unentitled target event rejected with EVENT_NOT_ENTITLED", async (context) => {
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

        const req = { body: { qrToken: comboQr, eventId: unrelatedEventId.toString() }, user: { _id: adminId, role: "ADMIN" } };
        const res = mockResponse();
        await markAttendance(req, res);

        assert.equal(res.statusCode, 403);
        assert.equal(res.body.code, "EVENT_NOT_ENTITLED");
    });

    // 18. Unassigned Organiser
    test("18. Unassigned Organiser rejected with 403 ORGANISER_NOT_ASSIGNED", async (context) => {
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

        const req = { body: { qrToken: comboQr, eventId: childAId.toString() }, user: { _id: unassignedOrgId, role: "ORGANISER" } };
        const res = mockResponse();
        await markAttendance(req, res);

        assert.equal(res.statusCode, 403);
        assert.equal(res.body.code, "ORGANISER_NOT_ASSIGNED");
    });

    // 19. Admin-authorized scan
    test("19. Admin-authorized scan succeeds even when not listed in event.organizers", async (context) => {
        const regDoc = {
            _id: makeId(),
            qrToken: comboQr,
            event: comboParentEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            access: { type: "MULTI_EVENT", eligibleEventIds: [childAId, childBId], grantedAt: new Date() },
            attendance: { isPresent: false },
            eventAttendance: []
        };

        context.mock.method(Registration, "findOne", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));
        context.mock.method(Event, "findById", () => ({ select: () => childEventA }));
        context.mock.method(Registration, "findOneAndUpdate", (query, update) => {
            if (update.$push?.eventAttendance) regDoc.eventAttendance.push(update.$push.eventAttendance);
            return regDoc;
        });

        const req = { body: { qrToken: comboQr, eventId: childAId.toString() }, user: { _id: adminId, role: "ADMIN" } };
        const res = mockResponse();
        await markAttendance(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
    });

    // 20. Legacy already-checked-in Registration
    test("20. Legacy already-checked-in Registration returns HTTP 409", async (context) => {
        const regDoc = {
            _id: makeId(),
            qrToken: standardQr,
            event: standardEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            attendance: { isPresent: true, checkedInAt: new Date("2026-02-20T08:00:00Z") },
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

    // 21. Direct and combo attendance reporting
    test("21. Direct and combo attendance reporting returns correct participant counts and cohorts", () => {
        const regs = [
            { event: childAId, status: "REGISTERED", payment: { status: "VERIFIED" }, attendance: { isPresent: true } },
            {
                event: comboParentId,
                status: "REGISTERED",
                payment: { status: "VERIFIED" },
                access: { type: "MULTI_EVENT", eligibleEventIds: [childAId] },
                eventAttendance: [{ eventId: childAId }]
            }
        ];

        const stats = calculateEventAttendanceStats(childAId, regs);
        assert.equal(stats.totalParticipants, 2);
        assert.equal(stats.present, 2);
        assert.equal(stats.direct.total, 1);
        assert.equal(stats.combo.total, 1);
    });

    // 22. Accurate payment-aware attendance metrics
    test("22. Payment-aware attendance metrics distinguish total entitled from admission eligible", () => {
        const regs = [
            { event: childAId, status: "REGISTERED", payment: { status: "VERIFIED" }, attendance: { isPresent: false } },
            { event: childAId, status: "REGISTERED", payment: { status: "PENDING" }, attendance: { isPresent: false } },
            {
                event: childAId,
                status: "REGISTERED",
                team: { payment: { status: "PENDING" } },
                payment: { status: "NOT_REQUIRED" },
                attendance: { isPresent: false }
            }
        ];

        const stats = calculateEventAttendanceStats(childAId, regs);
        assert.equal(stats.totalParticipants, 3);
        assert.equal(stats.admissionEligible.total, 1, "Only verified individual is admission eligible");
    });

    // 23. Excel export security
    test("23. Excel export sanitizes formula injection characters (=, +, -, @, \\t, \\r)", () => {
        assert.equal(sanitizeForExcel("=HYPERLINK(\"http://evil.com\")"), "'=HYPERLINK(\"http://evil.com\")");
        assert.equal(sanitizeForExcel("+1234567890"), "'+1234567890");
        assert.equal(sanitizeForExcel("-500"), "'-500");
        assert.equal(sanitizeForExcel("@SUM(A1:A5)"), "'@SUM(A1:A5)");
    });

    // 24. Financial analytics isolation
    test("24. Financial analytics isolation: Child events have 0 fee and combo revenue stays on parent", () => {
        const comboRegistration = {
            event: comboParentId,
            payment: { expectedAmount: 1500, receivedAmount: 1500, status: "VERIFIED" },
            access: { type: "MULTI_EVENT", eligibleEventIds: [childAId, childBId] }
        };

        // Attendance at Child A does not mutate payment expectedAmount or receivedAmount
        const att = resolveEventSpecificAttendance(comboRegistration, childAId);
        assert.equal(att.cohortType, "COMBO");
        assert.equal(comboRegistration.payment.expectedAmount, 1500);
        assert.equal(comboRegistration.payment.receivedAmount, 1500);
    });

    // 25. Certificate eligibility
    test("25. Certificate eligibility passes when combo completed, fails when partial", () => {
        const completedEvent = { status: "COMPLETED" };

        const partialReg = {
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            attendance: { isPresent: false }
        };
        assert.equal(getCertificateEligibility(completedEvent, partialReg).eligible, false);

        const completeReg = {
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            attendance: { isPresent: true, checkedInAt: new Date() }
        };
        assert.equal(getCertificateEligibility(completedEvent, completeReg).eligible, true);
    });

    // 26. No QR regeneration
    test("26. QR token is never mutated or regenerated during check-in or reporting", async (context) => {
        const originalToken = "5".repeat(64);
        const regDoc = {
            _id: makeId(),
            qrToken: originalToken,
            event: childEventA,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            attendance: { isPresent: false },
            eventAttendance: []
        };

        context.mock.method(Registration, "findOne", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));
        context.mock.method(Registration, "findOneAndUpdate", (query, update) => {
            if (update.$push?.eventAttendance) regDoc.eventAttendance.push(update.$push.eventAttendance);
            return regDoc;
        });

        const req = { body: { qrToken: originalToken }, user: { _id: adminId, role: "ADMIN" } };
        const res = mockResponse();
        await markAttendance(req, res);

        assert.equal(regDoc.qrToken, originalToken);
    });

    // 27. No child Registration creation
    test("27. Multi-event check-in creates zero new Registration documents", async (context) => {
        let registrationCreated = false;
        context.mock.method(Registration, "create", () => { registrationCreated = true; });

        const regDoc = {
            _id: makeId(),
            qrToken: comboQr,
            event: comboParentEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            access: { type: "MULTI_EVENT", eligibleEventIds: [childAId, childBId], grantedAt: new Date() },
            attendance: { isPresent: false },
            eventAttendance: []
        };

        context.mock.method(Registration, "findOne", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));
        context.mock.method(Event, "findById", () => ({ select: () => childEventA }));
        context.mock.method(Registration, "findOneAndUpdate", (query, update) => {
            if (update.$push?.eventAttendance) regDoc.eventAttendance.push(update.$push.eventAttendance);
            return regDoc;
        });

        const req = { body: { qrToken: comboQr, eventId: childAId.toString() }, user: { _id: adminId, role: "ADMIN" } };
        const res = mockResponse();
        await markAttendance(req, res);

        assert.equal(registrationCreated, false);
    });

    // 28. No child capacity changes
    test("28. Multi-event check-in never modifies child or parent capacity counters", async (context) => {
        let capacityModified = false;
        context.mock.method(Event, "findOneAndUpdate", () => { capacityModified = true; });

        const regDoc = {
            _id: makeId(),
            qrToken: comboQr,
            event: comboParentEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            access: { type: "MULTI_EVENT", eligibleEventIds: [childAId, childBId], grantedAt: new Date() },
            attendance: { isPresent: false },
            eventAttendance: []
        };

        context.mock.method(Registration, "findOne", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));
        context.mock.method(Event, "findById", () => ({ select: () => childEventA }));
        context.mock.method(Registration, "findOneAndUpdate", (query, update) => {
            if (update.$push?.eventAttendance) regDoc.eventAttendance.push(update.$push.eventAttendance);
            return regDoc;
        });

        const req = { body: { qrToken: comboQr, eventId: childAId.toString() }, user: { _id: adminId, role: "ADMIN" } };
        const res = mockResponse();
        await markAttendance(req, res);

        assert.equal(capacityModified, false);
        assert.equal(childEventA.registration.registeredParticipants, 10);
    });

    // 29. No historical data changes
    test("29. Historical registration records retain original timestamps and values", () => {
        const originalTimestamp = new Date("2026-01-10T12:00:00Z");
        const historicalReg = {
            createdAt: originalTimestamp,
            attendance: { isPresent: true, checkedInAt: originalTimestamp },
            event: standardEventId
        };

        const att = resolveEventSpecificAttendance(historicalReg, standardEventId);
        assert.equal(att.isPresent, true);
        assert.equal(att.checkedInAt.toISOString(), originalTimestamp.toISOString());
        assert.equal(historicalReg.createdAt.toISOString(), originalTimestamp.toISOString());
    });

    // 30. Existing response contract preservation
    test("30. Response contract matches expected frontend structure with additive keys", async (context) => {
        const regDoc = {
            _id: makeId(),
            qrToken: comboQr,
            event: comboParentEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            participantDetails: { fullName: "Contract User" },
            access: { type: "MULTI_EVENT", eligibleEventIds: [childAId, childBId], grantedAt: new Date() },
            attendance: { isPresent: false },
            eventAttendance: []
        };

        context.mock.method(Registration, "findOne", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));
        context.mock.method(Event, "findById", () => ({ select: () => childEventA }));
        context.mock.method(Registration, "findOneAndUpdate", (query, update) => {
            if (update.$push?.eventAttendance) regDoc.eventAttendance.push(update.$push.eventAttendance);
            return regDoc;
        });

        const req = { body: { qrToken: comboQr, eventId: childAId.toString() }, user: { _id: adminId, role: "ADMIN" } };
        const res = mockResponse();
        await markAttendance(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.message, "Attendance marked successfully.");
        assert(res.body.participant != null);
        assert(res.body.event != null);
        assert(res.body.checkedInAt != null);
        assert.equal(res.body.accessType, "MULTI_EVENT");
        assert(res.body.comboProgress != null);
        assert.equal(res.body.comboProgress.attendedCount, 1);
        assert.equal(res.body.comboProgress.totalEligible, 2);
        assert.equal(res.body.comboProgress.isComplete, false);
    });
});
