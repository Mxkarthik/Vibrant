/**
 * payment-lifecycle.test.js
 *
 * Tests for Phase 1 — Reversible payment status, audit history, and capacity sync.
 * Uses Node's built-in test runner (node:test) with no extra dependencies.
 * All database and Cloudinary calls are mocked; no live connection is required.
 */

"use strict";

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Event = require("../models/Event");
const Registration = require("../models/Registration");
const Team = require("../models/Team");

// ─── Helpers ────────────────────────────────────────────────────────────────

const adminId = new mongoose.Types.ObjectId();

/** Minimal valid event stub. capacity defaults to 10. */
function makeEvent(overrides = {}) {
    return new Event({
        name: "Test Event",
        description: "Test",
        category: "TECHNICAL",
        venue: "Hall A",
        createdBy: adminId,
        startDate: "2035-12-20",
        endDate: "2035-12-21",
        registration: {
            mode: "INDIVIDUAL",
            deadline: "2035-12-19",
            capacity: 10,
            registrationFee: 100,
            registeredParticipants: 5,
            minTeamSize: 1,
            maxTeamSize: 1,
            ...overrides.registration
        },
        ...overrides
    });
}

/**
 * Build a minimal in-memory Registration document that behaves like a saved
 * document (has an _id, a save() method, and a mutable payment subdocument).
 */
function makeRegistration(paymentStatus = "PENDING", regStatus = "REGISTERED", eventOverrides = {}) {
    const event = makeEvent(eventOverrides);
    const reg = new Registration({
        event: event._id,
        user: adminId,
        participantDetails: {
            fullName: "Test User",
            mobileNumber: "9999999999",
            collegeName: "Test College",
            department: "CS",
            section: "A",
            yearOfStudy: "2",
            rollNumber: "TC001"
        },
        payment: {
            method: paymentStatus === "NOT_REQUIRED" ? "NONE" : "UPI",
            status: paymentStatus
        },
        status: regStatus
    });
    // Attach the event object so controllers can reference it.
    reg._testEvent = event;
    return reg;
}

/** Build a minimal in-memory Team document. */
function makeTeam(paymentStatus = "PENDING", teamStatus = "REGISTERED", memberCount = 3, eventCapacity = 10, eventRegistered = 5) {
    const event = makeEvent({
        registration: {
            mode: "TEAM",
            deadline: "2035-12-19",
            capacity: eventCapacity,
            registrationFee: 100,
            registeredParticipants: eventRegistered,
            minTeamSize: 2,
            maxTeamSize: 5
        }
    });
    const team = new Team({
        event: event._id,
        teamName: "Team Alpha",
        leader: adminId,
        memberCount,
        payment: {
            method: paymentStatus === "NOT_REQUIRED" ? "NONE" : "UPI",
            status: paymentStatus
        },
        status: teamStatus
    });
    team._testEvent = event;
    return team;
}

/** Minimal Express response mock. */
function mockRes() {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
}

/** Admin request stub. */
function adminReq(id, body) {
    return { params: { id: id.toString() }, body, user: { _id: adminId, role: "ADMIN" } };
}

// ─── Load controllers (after stubs, so they pick up mocked modules) ─────────

const { updatePaymentStatus } = require("../controllers/registrationController");
const { updateTeamPaymentStatus } = require("../controllers/teamRegistrationController");
const authorizeRoles = require("../middleware/roleMiddleware");

// ─── Shared per-test state ───────────────────────────────────────────────────

let eventCapacityDelta;   // tracks net $inc applied to registeredParticipants

// ─── INDIVIDUAL PAYMENT TESTS ────────────────────────────────────────────────

describe("Individual payment lifecycle", () => {

    // Before each test, intercept mongoose.startSession and model methods.
    beforeEach((context) => {
        context.mock.method(console, "error", () => {});
        eventCapacityDelta = 0;

        // Session mock: executes the callback synchronously (single-document ops
        // happen inside withTransaction in our new controllers).
        context.mock.method(mongoose, "startSession", async () => ({
            withTransaction: async (cb) => {
                await cb();
            },
            endSession: async () => {}
        }));
    });

    // Helper: set up per-test Registration.findById + Event.findOneAndUpdate mocks.
    function setupMocks(context, registration) {
        context.mock.method(Registration, "findById", () => ({
            session: async () => registration
        }));

        context.mock.method(Event, "findOneAndUpdate", async (filter, update) => {
            const delta = update.$inc["registration.registeredParticipants"];
            eventCapacityDelta += delta;

            // Simulate capacity guard for increment path
            if (delta > 0) {
                const event = registration._testEvent;
                const after = event.registration.registeredParticipants + delta;
                if (after > event.registration.capacity) return null; // at capacity
            }

            return registration._testEvent;
        });
    }

    // --- Transition: PENDING → VERIFIED ---
    test("PENDING → VERIFIED sets verifiedBy, verifiedAt, appends history", async (context) => {
        const reg = makeRegistration("PENDING");
        reg.save = async () => {};
        setupMocks(context, reg);

        const res = mockRes();
        await updatePaymentStatus(adminReq(reg._id, { status: "VERIFIED" }), res);

        assert.equal(res.statusCode, 200);
        assert.equal(reg.payment.status, "VERIFIED");
        assert.ok(reg.payment.verifiedBy.equals(adminId));
        assert.ok(reg.payment.verifiedAt instanceof Date);
        assert.equal(reg.payment.history.length, 1);
        assert.equal(reg.payment.history[0].fromStatus, "PENDING");
        assert.equal(reg.payment.history[0].toStatus, "VERIFIED");
        assert.ok(reg.payment.history[0].changedBy.equals(adminId));
        assert.ok(reg.payment.history[0].changedAt instanceof Date);
        assert.equal(eventCapacityDelta, 0); // no capacity change
    });

    // --- Transition: PENDING → REJECTED (with reason) ---
    test("PENDING → REJECTED with reason releases capacity, clears verifiedBy", async (context) => {
        const reg = makeRegistration("PENDING");
        reg.save = async () => {};
        setupMocks(context, reg);

        const res = mockRes();
        await updatePaymentStatus(adminReq(reg._id, { status: "REJECTED", reason: "Proof unclear" }), res);

        assert.equal(res.statusCode, 200);
        assert.equal(reg.payment.status, "REJECTED");
        assert.equal(reg.payment.verifiedBy, null);
        assert.equal(reg.payment.verifiedAt, null);
        assert.equal(reg.payment.history.length, 1);
        assert.equal(reg.payment.history[0].fromStatus, "PENDING");
        assert.equal(reg.payment.history[0].toStatus, "REJECTED");
        assert.equal(reg.payment.history[0].reason, "Proof unclear");
        assert.equal(eventCapacityDelta, -1); // capacity released
    });

    // --- REJECTED without reason must fail ---
    test("PENDING → REJECTED without reason returns 400", async (context) => {
        const reg = makeRegistration("PENDING");
        reg.save = async () => {};
        setupMocks(context, reg);

        const res = mockRes();
        await updatePaymentStatus(adminReq(reg._id, { status: "REJECTED" }), res);

        assert.equal(res.statusCode, 400);
        assert.equal(res.body.success, false);
        assert.match(res.body.message, /reason/i);
        assert.equal(eventCapacityDelta, 0);
    });

    // --- Transition: REJECTED with whitespace-only reason must fail ---
    test("PENDING → REJECTED with whitespace-only reason returns 400", async (context) => {
        const reg = makeRegistration("PENDING");
        reg.save = async () => {};
        setupMocks(context, reg);

        const res = mockRes();
        await updatePaymentStatus(adminReq(reg._id, { status: "REJECTED", reason: "   " }), res);

        assert.equal(res.statusCode, 400);
        assert.equal(res.body.success, false);
    });

    // --- Transition: VERIFIED → REJECTED ---
    test("VERIFIED → REJECTED releases capacity, clears verifiedBy", async (context) => {
        const reg = makeRegistration("VERIFIED");
        reg.payment.verifiedBy = adminId;
        reg.payment.verifiedAt = new Date("2025-01-01");
        reg.save = async () => {};
        setupMocks(context, reg);

        const res = mockRes();
        await updatePaymentStatus(adminReq(reg._id, { status: "REJECTED", reason: "Wrong event" }), res);

        assert.equal(res.statusCode, 200);
        assert.equal(reg.payment.status, "REJECTED");
        assert.equal(reg.payment.verifiedBy, null);
        assert.equal(reg.payment.verifiedAt, null);
        assert.equal(reg.payment.history[0].fromStatus, "VERIFIED");
        assert.equal(reg.payment.history[0].toStatus, "REJECTED");
        assert.equal(eventCapacityDelta, -1);
    });

    // --- Transition: VERIFIED → PENDING ---
    test("VERIFIED → PENDING clears verification metadata, no capacity change", async (context) => {
        const reg = makeRegistration("VERIFIED");
        reg.payment.verifiedBy = adminId;
        reg.payment.verifiedAt = new Date();
        reg.save = async () => {};
        setupMocks(context, reg);

        const res = mockRes();
        await updatePaymentStatus(adminReq(reg._id, { status: "PENDING" }), res);

        assert.equal(res.statusCode, 200);
        assert.equal(reg.payment.status, "PENDING");
        assert.equal(reg.payment.verifiedBy, null);
        assert.equal(reg.payment.verifiedAt, null);
        assert.equal(reg.payment.history[0].fromStatus, "VERIFIED");
        assert.equal(reg.payment.history[0].toStatus, "PENDING");
        assert.equal(eventCapacityDelta, 0);
    });

    // --- Transition: REJECTED → VERIFIED ---
    test("REJECTED → VERIFIED reacquires capacity, sets verifiedBy", async (context) => {
        const reg = makeRegistration("REJECTED");
        reg.save = async () => {};
        setupMocks(context, reg);

        const res = mockRes();
        await updatePaymentStatus(adminReq(reg._id, { status: "VERIFIED" }), res);

        assert.equal(res.statusCode, 200);
        assert.equal(reg.payment.status, "VERIFIED");
        assert.ok(reg.payment.verifiedBy.equals(adminId));
        assert.equal(reg.payment.history[0].fromStatus, "REJECTED");
        assert.equal(reg.payment.history[0].toStatus, "VERIFIED");
        assert.equal(eventCapacityDelta, 1);
    });

    // --- Transition: REJECTED → PENDING ---
    test("REJECTED → PENDING reacquires capacity", async (context) => {
        const reg = makeRegistration("REJECTED");
        reg.save = async () => {};
        setupMocks(context, reg);

        const res = mockRes();
        await updatePaymentStatus(adminReq(reg._id, { status: "PENDING" }), res);

        assert.equal(res.statusCode, 200);
        assert.equal(reg.payment.status, "PENDING");
        assert.equal(reg.payment.history[0].fromStatus, "REJECTED");
        assert.equal(reg.payment.history[0].toStatus, "PENDING");
        assert.equal(eventCapacityDelta, 1);
    });

    // --- No-op: same status ---
    test("Same-status update returns 200 no-op, does not append history", async (context) => {
        const reg = makeRegistration("PENDING");
        reg.save = async () => {};
        setupMocks(context, reg);

        const res = mockRes();
        await updatePaymentStatus(adminReq(reg._id, { status: "PENDING" }), res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        // No history appended for a no-op
        assert.equal(reg.payment.history.length, 0);
        assert.equal(eventCapacityDelta, 0);
    });

    // --- Invalid status value ---
    test("Invalid status value returns 400", async (context) => {
        const reg = makeRegistration("PENDING");
        reg.save = async () => {};
        setupMocks(context, reg);

        const res = mockRes();
        await updatePaymentStatus(adminReq(reg._id, { status: "APPROVED" }), res);

        assert.equal(res.statusCode, 400);
        assert.equal(res.body.success, false);
    });

    // --- NOT_REQUIRED payment cannot be changed ---
    test("NOT_REQUIRED payment returns 409", async (context) => {
        const reg = makeRegistration("NOT_REQUIRED");
        reg.save = async () => {};
        setupMocks(context, reg);

        const res = mockRes();
        await updatePaymentStatus(adminReq(reg._id, { status: "VERIFIED" }), res);

        assert.equal(res.statusCode, 409);
        assert.equal(res.body.success, false);
        assert.equal(eventCapacityDelta, 0);
    });

    // --- Cancelled registration ---
    test("Cancelled registration returns 409", async (context) => {
        const reg = makeRegistration("PENDING", "CANCELLED");
        reg.save = async () => {};
        setupMocks(context, reg);

        const res = mockRes();
        await updatePaymentStatus(adminReq(reg._id, { status: "VERIFIED" }), res);

        assert.equal(res.statusCode, 409);
        assert.equal(res.body.success, false);
        assert.equal(eventCapacityDelta, 0);
    });

    // --- Registration not found ---
    test("Missing registration returns 404", async (context) => {
        context.mock.method(Registration, "findById", () => ({ session: async () => null }));

        const res = mockRes();
        await updatePaymentStatus(adminReq(new mongoose.Types.ObjectId(), { status: "VERIFIED" }), res);

        assert.equal(res.statusCode, 404);
    });

    // --- Capacity full prevents REJECTED → PENDING/VERIFIED ---
    test("REJECTED → VERIFIED fails when event is at capacity, leaves payment unchanged", async (context) => {
        // Set registeredParticipants == capacity so increment is blocked
        const reg = makeRegistration("REJECTED", "REGISTERED", {
            registration: {
                capacity: 5,
                registeredParticipants: 5,
                registrationFee: 100,
                deadline: "2035-12-19",
                mode: "INDIVIDUAL",
                minTeamSize: 1,
                maxTeamSize: 1
            }
        });
        reg.save = async () => {};

        context.mock.method(Registration, "findById", () => ({ session: async () => reg }));
        context.mock.method(Event, "findOneAndUpdate", async () => null); // capacity full

        const res = mockRes();
        await updatePaymentStatus(adminReq(reg._id, { status: "VERIFIED" }), res);

        assert.equal(res.statusCode, 409);
        // Payment status must remain unchanged
        assert.equal(reg.payment.status, "REJECTED");
        assert.equal(reg.payment.history.length, 0);
    });

    // --- History is append-only across multiple transitions ---
    test("Multiple transitions accumulate history entries in order", async (context) => {
        const reg = makeRegistration("PENDING");
        reg.save = async () => {};
        setupMocks(context, reg);

        // PENDING → VERIFIED
        await updatePaymentStatus(adminReq(reg._id, { status: "VERIFIED" }), mockRes());
        assert.equal(reg.payment.history.length, 1);

        // VERIFIED → REJECTED
        await updatePaymentStatus(adminReq(reg._id, { status: "REJECTED", reason: "Duplicate" }), mockRes());
        assert.equal(reg.payment.history.length, 2);
        assert.equal(reg.payment.history[0].toStatus, "VERIFIED");
        assert.equal(reg.payment.history[1].fromStatus, "VERIFIED");
        assert.equal(reg.payment.history[1].toStatus, "REJECTED");

        // REJECTED → PENDING
        await updatePaymentStatus(adminReq(reg._id, { status: "PENDING" }), mockRes());
        assert.equal(reg.payment.history.length, 3);
        // Confirm older entries unchanged
        assert.equal(reg.payment.history[0].toStatus, "VERIFIED");
        assert.equal(reg.payment.history[1].toStatus, "REJECTED");
        assert.equal(reg.payment.history[2].toStatus, "PENDING");
    });

    // --- Payment proof URL is preserved across transitions ---
    test("Payment proof URL is not modified by status transitions", async (context) => {
        const reg = makeRegistration("PENDING");
        const originalProof = "https://example.invalid/proof.png";
        reg.payment.proofUrl = originalProof;
        reg.save = async () => {};
        setupMocks(context, reg);

        await updatePaymentStatus(adminReq(reg._id, { status: "VERIFIED" }), mockRes());

        assert.equal(reg.payment.proofUrl, originalProof);
    });

    // --- History reason stored when provided for non-rejection ---
    test("Optional reason is stored for PENDING → VERIFIED when provided", async (context) => {
        const reg = makeRegistration("PENDING");
        reg.save = async () => {};
        setupMocks(context, reg);

        await updatePaymentStatus(adminReq(reg._id, { status: "VERIFIED", reason: "Confirmed manually" }), mockRes());

        assert.equal(reg.payment.history[0].reason, "Confirmed manually");
    });

    // --- History reason is null when not provided for non-rejection ---
    test("Reason is null in history when not provided for VERIFIED transition", async (context) => {
        const reg = makeRegistration("PENDING");
        reg.save = async () => {};
        setupMocks(context, reg);

        await updatePaymentStatus(adminReq(reg._id, { status: "VERIFIED" }), mockRes());

        assert.equal(reg.payment.history[0].reason, null);
    });

    // --- changedBy is the authenticated admin's ID ---
    test("History changedBy matches admin user ID", async (context) => {
        const reg = makeRegistration("PENDING");
        reg.save = async () => {};
        setupMocks(context, reg);

        await updatePaymentStatus(adminReq(reg._id, { status: "VERIFIED" }), mockRes());

        assert.ok(reg.payment.history[0].changedBy.equals(adminId));
    });
});

// ─── TEAM PAYMENT TESTS ──────────────────────────────────────────────────────

describe("Team payment lifecycle", () => {

    beforeEach((context) => {
        context.mock.method(console, "error", () => {});
        eventCapacityDelta = 0;

        context.mock.method(mongoose, "startSession", async () => ({
            withTransaction: async (cb) => { await cb(); },
            endSession: async () => {}
        }));
    });

    function setupTeamMocks(context, team) {
        context.mock.method(Team, "findById", () => ({ session: async () => team }));

        context.mock.method(Event, "findOneAndUpdate", async (filter, update) => {
            const delta = update.$inc["registration.registeredParticipants"];
            eventCapacityDelta += delta;

            if (delta > 0) {
                const event = team._testEvent;
                const after = event.registration.registeredParticipants + delta;
                if (after > event.registration.capacity) return null;
            }

            return team._testEvent;
        });
    }

    // --- PENDING → VERIFIED ---
    test("PENDING → VERIFIED sets verifiedBy, appends history, no capacity change", async (context) => {
        const team = makeTeam("PENDING");
        team.save = async () => {};
        setupTeamMocks(context, team);

        const res = mockRes();
        await updateTeamPaymentStatus(adminReq(team._id, { status: "VERIFIED" }), res);

        assert.equal(res.statusCode, 200);
        assert.equal(team.payment.status, "VERIFIED");
        assert.ok(team.payment.verifiedBy.equals(adminId));
        assert.equal(team.payment.history.length, 1);
        assert.equal(team.payment.history[0].fromStatus, "PENDING");
        assert.equal(team.payment.history[0].toStatus, "VERIFIED");
        assert.equal(eventCapacityDelta, 0);
    });

    // --- PENDING → REJECTED (with reason) ---
    test("PENDING → REJECTED with reason releases capacity by memberCount", async (context) => {
        const memberCount = 3;
        const team = makeTeam("PENDING", "REGISTERED", memberCount);
        team.save = async () => {};
        setupTeamMocks(context, team);

        const res = mockRes();
        await updateTeamPaymentStatus(adminReq(team._id, { status: "REJECTED", reason: "Invalid proof" }), res);

        assert.equal(res.statusCode, 200);
        assert.equal(team.payment.status, "REJECTED");
        assert.equal(team.payment.history[0].reason, "Invalid proof");
        assert.equal(eventCapacityDelta, -memberCount);
    });

    // --- REJECTED without reason ---
    test("PENDING → REJECTED without reason returns 400", async (context) => {
        const team = makeTeam("PENDING");
        team.save = async () => {};
        setupTeamMocks(context, team);

        const res = mockRes();
        await updateTeamPaymentStatus(adminReq(team._id, { status: "REJECTED" }), res);

        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /reason/i);
        assert.equal(eventCapacityDelta, 0);
    });

    // --- VERIFIED → REJECTED ---
    test("VERIFIED → REJECTED releases capacity by memberCount", async (context) => {
        const memberCount = 4;
        const team = makeTeam("VERIFIED", "REGISTERED", memberCount);
        team.payment.verifiedBy = adminId;
        team.payment.verifiedAt = new Date();
        team.save = async () => {};
        setupTeamMocks(context, team);

        const res = mockRes();
        await updateTeamPaymentStatus(adminReq(team._id, { status: "REJECTED", reason: "Payment bounced" }), res);

        assert.equal(res.statusCode, 200);
        assert.equal(team.payment.status, "REJECTED");
        assert.equal(team.payment.verifiedBy, null);
        assert.equal(eventCapacityDelta, -memberCount);
    });

    // --- VERIFIED → PENDING ---
    test("VERIFIED → PENDING clears verification metadata, no capacity change", async (context) => {
        const team = makeTeam("VERIFIED");
        team.payment.verifiedBy = adminId;
        team.payment.verifiedAt = new Date();
        team.save = async () => {};
        setupTeamMocks(context, team);

        const res = mockRes();
        await updateTeamPaymentStatus(adminReq(team._id, { status: "PENDING" }), res);

        assert.equal(res.statusCode, 200);
        assert.equal(team.payment.status, "PENDING");
        assert.equal(team.payment.verifiedBy, null);
        assert.equal(eventCapacityDelta, 0);
    });

    // --- REJECTED → VERIFIED ---
    test("REJECTED → VERIFIED reacquires capacity by memberCount", async (context) => {
        const memberCount = 2;
        const team = makeTeam("REJECTED", "REGISTERED", memberCount);
        team.save = async () => {};
        setupTeamMocks(context, team);

        const res = mockRes();
        await updateTeamPaymentStatus(adminReq(team._id, { status: "VERIFIED" }), res);

        assert.equal(res.statusCode, 200);
        assert.equal(team.payment.status, "VERIFIED");
        assert.equal(eventCapacityDelta, memberCount);
    });

    // --- REJECTED → PENDING ---
    test("REJECTED → PENDING reacquires capacity by memberCount", async (context) => {
        const memberCount = 3;
        const team = makeTeam("REJECTED", "REGISTERED", memberCount);
        team.save = async () => {};
        setupTeamMocks(context, team);

        const res = mockRes();
        await updateTeamPaymentStatus(adminReq(team._id, { status: "PENDING" }), res);

        assert.equal(res.statusCode, 200);
        assert.equal(team.payment.status, "PENDING");
        assert.equal(eventCapacityDelta, memberCount);
    });

    // --- Same-status no-op ---
    test("Same-status update is a no-op, no history appended", async (context) => {
        const team = makeTeam("VERIFIED");
        team.save = async () => {};
        setupTeamMocks(context, team);

        const res = mockRes();
        await updateTeamPaymentStatus(adminReq(team._id, { status: "VERIFIED" }), res);

        assert.equal(res.statusCode, 200);
        assert.equal(team.payment.history.length, 0);
        assert.equal(eventCapacityDelta, 0);
    });

    // --- NOT_REQUIRED payment cannot be changed ---
    test("NOT_REQUIRED payment returns 409", async (context) => {
        const team = makeTeam("NOT_REQUIRED");
        team.save = async () => {};
        setupTeamMocks(context, team);

        const res = mockRes();
        await updateTeamPaymentStatus(adminReq(team._id, { status: "VERIFIED" }), res);

        assert.equal(res.statusCode, 409);
        assert.equal(eventCapacityDelta, 0);
    });

    // --- Cancelled team ---
    test("Cancelled team returns 409", async (context) => {
        const team = makeTeam("PENDING", "CANCELLED");
        team.save = async () => {};
        setupTeamMocks(context, team);

        const res = mockRes();
        await updateTeamPaymentStatus(adminReq(team._id, { status: "VERIFIED" }), res);

        assert.equal(res.statusCode, 409);
        assert.equal(eventCapacityDelta, 0);
    });

    // --- Team not found ---
    test("Missing team returns 404", async (context) => {
        context.mock.method(Team, "findById", () => ({ session: async () => null }));

        const res = mockRes();
        await updateTeamPaymentStatus(adminReq(new mongoose.Types.ObjectId(), { status: "VERIFIED" }), res);

        assert.equal(res.statusCode, 404);
    });

    // --- Capacity full prevents REJECTED → anything ---
    test("REJECTED → VERIFIED fails when event is full, leaves team unchanged", async (context) => {
        // capacity == registeredParticipants so there's no room
        const team = makeTeam("REJECTED", "REGISTERED", 3, 5, 5);
        team.save = async () => {};

        context.mock.method(Team, "findById", () => ({ session: async () => team }));
        context.mock.method(Event, "findOneAndUpdate", async () => null); // full

        const res = mockRes();
        await updateTeamPaymentStatus(adminReq(team._id, { status: "VERIFIED" }), res);

        assert.equal(res.statusCode, 409);
        assert.equal(team.payment.status, "REJECTED");
        assert.equal(team.payment.history.length, 0);
    });

    // --- Capacity uses memberCount exactly ---
    test("Capacity delta equals team.memberCount (5 members)", async (context) => {
        const memberCount = 5;
        const team = makeTeam("PENDING", "REGISTERED", memberCount);
        team.save = async () => {};
        setupTeamMocks(context, team);

        await updateTeamPaymentStatus(adminReq(team._id, { status: "REJECTED", reason: "X" }), mockRes());

        assert.equal(eventCapacityDelta, -memberCount);
    });

    // --- History is append-only across multiple transitions ---
    test("Multiple team transitions accumulate history in order", async (context) => {
        const team = makeTeam("PENDING");
        team.save = async () => {};
        setupTeamMocks(context, team);

        await updateTeamPaymentStatus(adminReq(team._id, { status: "VERIFIED" }), mockRes());
        await updateTeamPaymentStatus(adminReq(team._id, { status: "REJECTED", reason: "Re-check" }), mockRes());
        await updateTeamPaymentStatus(adminReq(team._id, { status: "PENDING" }), mockRes());

        assert.equal(team.payment.history.length, 3);
        assert.equal(team.payment.history[0].toStatus, "VERIFIED");
        assert.equal(team.payment.history[1].toStatus, "REJECTED");
        assert.equal(team.payment.history[2].toStatus, "PENDING");
        // Older entries untouched
        assert.equal(team.payment.history[0].fromStatus, "PENDING");
    });

    // --- changedBy is admin ID ---
    test("History changedBy is the authenticated admin's ObjectId", async (context) => {
        const team = makeTeam("PENDING");
        team.save = async () => {};
        setupTeamMocks(context, team);

        await updateTeamPaymentStatus(adminReq(team._id, { status: "VERIFIED" }), mockRes());

        assert.ok(team.payment.history[0].changedBy.equals(adminId));
    });
});

// ─── AUTHORIZATION TESTS ─────────────────────────────────────────────────────

describe("Authorization boundaries", () => {

    test("roleMiddleware blocks PARTICIPANT and ORGANISER from payment update endpoints", () => {
        const adminMiddleware = authorizeRoles("ADMIN");
        for (const role of ["PARTICIPANT", "ORGANISER"]) {
            const res = mockRes();
            let called = false;
            adminMiddleware({ user: { role } }, res, () => { called = true; });
            assert.equal(called, false, `${role} should NOT pass ADMIN-only middleware`);
            assert.equal(res.statusCode, 403);
        }
    });

    test("roleMiddleware allows ADMIN through payment update endpoints", () => {
        const adminMiddleware = authorizeRoles("ADMIN");
        const res = mockRes();
        let called = false;
        adminMiddleware({ user: { role: "ADMIN" } }, res, () => { called = true; });
        assert.equal(called, true);
        assert.equal(res.statusCode, 200); // unchanged (next() was called)
    });
});

// ─── HISTORY SCHEMA VALIDATION ───────────────────────────────────────────────

describe("Payment history schema validation", () => {

    test("Registration schema accepts valid payment history entries", async () => {
        const reg = makeRegistration("PENDING");
        reg.payment.history = [
            {
                fromStatus: "PENDING",
                toStatus: "VERIFIED",
                changedBy: adminId,
                changedAt: new Date(),
                reason: null
            }
        ];
        // Should not throw
        await reg.validate();
    });

    test("Team schema accepts valid payment history entries", async () => {
        const team = makeTeam("PENDING");
        team.payment.history = [
            {
                fromStatus: "PENDING",
                toStatus: "REJECTED",
                changedBy: adminId,
                changedAt: new Date(),
                reason: "Bad proof"
            }
        ];
        await team.validate();
    });

    test("History changedBy is required", async () => {
        const reg = makeRegistration("PENDING");
        reg.payment.history = [
            {
                fromStatus: "PENDING",
                toStatus: "VERIFIED",
                changedAt: new Date(),
                reason: null
            }
        ];
        await assert.rejects(() => reg.validate(), /changedBy/i);
    });

    test("History changedAt is required", async () => {
        const reg = makeRegistration("PENDING");
        reg.payment.history = [
            {
                fromStatus: "PENDING",
                toStatus: "VERIFIED",
                changedBy: adminId,
                reason: null
            }
        ];
        await assert.rejects(() => reg.validate(), /changedAt/i);
    });

    test("History fromStatus must be a valid enum value", async () => {
        const reg = makeRegistration("PENDING");
        reg.payment.history = [
            {
                fromStatus: "INVALID",
                toStatus: "VERIFIED",
                changedBy: adminId,
                changedAt: new Date(),
                reason: null
            }
        ];
        await assert.rejects(() => reg.validate());
    });
});

// ─── BACKWARD-COMPATIBILITY: EXISTING REGISTRATION TESTS ─────────────────────

describe("Backward-compatibility: existing registration tests still pass", () => {

    beforeEach((context) => {
        context.mock.method(console, "error", () => {});

        context.mock.method(mongoose, "startSession", async () => ({
            withTransaction: async (cb) => {
                await cb();
                // No-op to simulate the old simple tests
            },
            endSession: async () => {}
        }));
    });

    test("Original PENDING → VERIFIED transition still works via new controller", async (context) => {
        const reg = makeRegistration("PENDING");
        reg.save = async () => {};

        context.mock.method(Registration, "findById", () => ({ session: async () => reg }));
        context.mock.method(Event, "findOneAndUpdate", async () => reg._testEvent);

        const res = mockRes();
        await updatePaymentStatus(adminReq(reg._id, { status: "VERIFIED" }), res);

        assert.equal(res.statusCode, 200);
        assert.equal(reg.payment.status, "VERIFIED");
    });

    test("Original PENDING → REJECTED transition still works via new controller", async (context) => {
        const reg = makeRegistration("PENDING");
        reg.save = async () => {};

        context.mock.method(Registration, "findById", () => ({ session: async () => reg }));
        context.mock.method(Event, "findOneAndUpdate", async () => reg._testEvent);

        const res = mockRes();
        await updatePaymentStatus(adminReq(reg._id, { status: "REJECTED", reason: "Cannot verify" }), res);

        assert.equal(res.statusCode, 200);
        assert.equal(reg.payment.status, "REJECTED");
    });

    test("Original team PENDING → VERIFIED still works via new controller", async (context) => {
        const team = makeTeam("PENDING");
        team.save = async () => {};

        context.mock.method(Team, "findById", () => ({ session: async () => team }));
        context.mock.method(Event, "findOneAndUpdate", async () => team._testEvent);

        const res = mockRes();
        await updateTeamPaymentStatus(adminReq(team._id, { status: "VERIFIED" }), res);

        assert.equal(res.statusCode, 200);
        assert.equal(team.payment.status, "VERIFIED");
    });

    test("Original team PENDING → REJECTED still works via new controller", async (context) => {
        const team = makeTeam("PENDING");
        team.save = async () => {};

        context.mock.method(Team, "findById", () => ({ session: async () => team }));
        context.mock.method(Event, "findOneAndUpdate", async () => team._testEvent);

        const res = mockRes();
        await updateTeamPaymentStatus(adminReq(team._id, { status: "REJECTED", reason: "Invalid" }), res);

        assert.equal(res.statusCode, 200);
        assert.equal(team.payment.status, "REJECTED");
    });
});

// ─── CAPACITY DECREMENT FAILURE HANDLING (correction regression tests) ────────

describe("Capacity decrement failure handling — individual", () => {

    beforeEach((context) => {
        context.mock.method(console, "error", () => {});

        context.mock.method(mongoose, "startSession", async () => ({
            withTransaction: async (cb) => { await cb(); },
            endSession: async () => {}
        }));
    });

    // Helper: set up per-test Registration.findById mock.
    function setupRegMock(context, registration) {
        context.mock.method(Registration, "findById", () => ({
            session: async () => registration
        }));
    }

    // 1. Rejection succeeds when registeredParticipants > 0
    test("Rejection succeeds when registeredParticipants is sufficient (> 0)", async (context) => {
        const reg = makeRegistration("PENDING");
        reg.save = async () => {};
        setupRegMock(context, reg);

        // Event has 3 registered; decrement is possible
        context.mock.method(Event, "findOneAndUpdate", async () => ({
            registration: { registeredParticipants: 2 }
        }));

        const res = mockRes();
        await updatePaymentStatus(adminReq(reg._id, { status: "REJECTED", reason: "Bad proof" }), res);

        assert.equal(res.statusCode, 200);
        assert.equal(reg.payment.status, "REJECTED");
        assert.equal(reg.payment.history.length, 1);
    });

    // 2. Rejection fails when registeredParticipants is 0 (counter at floor)
    test("Rejection returns 409 when registeredParticipants is 0 (counter insufficient)", async (context) => {
        const reg = makeRegistration("PENDING");
        // save should NOT be called — if it is, force a failure so we notice
        reg.save = async () => { throw new Error("save() must not be called when capacity decrement fails"); };
        setupRegMock(context, reg);

        // Simulate the $gt: 0 guard failing — counter is already 0
        context.mock.method(Event, "findOneAndUpdate", async () => null);

        const res = mockRes();
        await updatePaymentStatus(adminReq(reg._id, { status: "REJECTED", reason: "Bad proof" }), res);

        assert.equal(res.statusCode, 409);
        assert.equal(res.body.success, false);
        assert.match(res.body.message, /inconsistent|not found/i);
        // Payment status must be unchanged
        assert.equal(reg.payment.status, "PENDING");
        // No history entry must have been appended
        assert.equal(reg.payment.history.length, 0);
    });

    // 3. Event not found during decrement aborts the update
    test("Rejection returns 409 when event is not found during capacity decrement", async (context) => {
        const reg = makeRegistration("VERIFIED");
        reg.payment.verifiedBy = adminId;
        reg.payment.verifiedAt = new Date();
        reg.save = async () => { throw new Error("save() must not be called"); };
        setupRegMock(context, reg);

        // Event.findOneAndUpdate returns null — event does not exist
        context.mock.method(Event, "findOneAndUpdate", async () => null);

        const res = mockRes();
        await updatePaymentStatus(adminReq(reg._id, { status: "REJECTED", reason: "Wrong event" }), res);

        assert.equal(res.statusCode, 409);
        assert.equal(reg.payment.status, "VERIFIED");   // unchanged
        assert.equal(reg.payment.history.length, 0);    // no history
    });

    // 4. Reactivation (REJECTED → PENDING) succeeds when capacity is available
    test("REJECTED → PENDING succeeds when capacity is available", async (context) => {
        const reg = makeRegistration("REJECTED");
        reg.save = async () => {};
        setupRegMock(context, reg);

        context.mock.method(Event, "findOneAndUpdate", async () => ({
            registration: { registeredParticipants: 4, capacity: 10 }
        }));

        const res = mockRes();
        await updatePaymentStatus(adminReq(reg._id, { status: "PENDING" }), res);

        assert.equal(res.statusCode, 200);
        assert.equal(reg.payment.status, "PENDING");
        assert.equal(reg.payment.history.length, 1);
    });

    // 5. Reactivation (REJECTED → VERIFIED) fails when event is at capacity
    test("REJECTED → VERIFIED returns 409 when event is at capacity", async (context) => {
        const reg = makeRegistration("REJECTED");
        reg.save = async () => { throw new Error("save() must not be called"); };
        setupRegMock(context, reg);

        // Reclaim path guard fails — event full
        context.mock.method(Event, "findOneAndUpdate", async () => null);

        const res = mockRes();
        await updatePaymentStatus(adminReq(reg._id, { status: "VERIFIED" }), res);

        assert.equal(res.statusCode, 409);
        assert.equal(reg.payment.status, "REJECTED");   // unchanged
        assert.equal(reg.payment.history.length, 0);
    });
});

describe("Capacity decrement failure handling — team", () => {

    beforeEach((context) => {
        context.mock.method(console, "error", () => {});

        context.mock.method(mongoose, "startSession", async () => ({
            withTransaction: async (cb) => { await cb(); },
            endSession: async () => {}
        }));
    });

    function setupTeamMockFixed(context, team) {
        context.mock.method(Team, "findById", () => ({
            session: async () => team
        }));
    }

    // 6. Team rejection succeeds when counter >= memberCount
    test("Team rejection succeeds when registeredParticipants >= memberCount", async (context) => {
        const memberCount = 3;
        const team = makeTeam("PENDING", "REGISTERED", memberCount);
        team.save = async () => {};
        setupTeamMockFixed(context, team);

        // Counter is 5, memberCount is 3 — decrement is valid
        context.mock.method(Event, "findOneAndUpdate", async () => ({
            registration: { registeredParticipants: 2 }
        }));

        const res = mockRes();
        await updateTeamPaymentStatus(adminReq(team._id, { status: "REJECTED", reason: "Invalid" }), res);

        assert.equal(res.statusCode, 200);
        assert.equal(team.payment.status, "REJECTED");
        assert.equal(team.payment.history.length, 1);
    });

    // 7. Team rejection fails when counter < memberCount
    test("Team rejection returns 409 when registeredParticipants < memberCount", async (context) => {
        const memberCount = 5;
        const team = makeTeam("PENDING", "REGISTERED", memberCount);
        team.save = async () => { throw new Error("save() must not be called"); };
        setupTeamMockFixed(context, team);

        // $gte: memberCount guard fails — only 2 slots registered but team has 5
        context.mock.method(Event, "findOneAndUpdate", async () => null);

        const res = mockRes();
        await updateTeamPaymentStatus(adminReq(team._id, { status: "REJECTED", reason: "Invalid" }), res);

        assert.equal(res.statusCode, 409);
        assert.equal(res.body.success, false);
        assert.match(res.body.message, /inconsistent|not found/i);
        assert.equal(team.payment.status, "PENDING");   // unchanged
        assert.equal(team.payment.history.length, 0);   // no history
    });

    // 8. Team rejection fails when event is not found
    test("Team rejection returns 409 when event is not found during capacity decrement", async (context) => {
        const team = makeTeam("VERIFIED", "REGISTERED", 3);
        team.payment.verifiedBy = adminId;
        team.payment.verifiedAt = new Date();
        team.save = async () => { throw new Error("save() must not be called"); };
        setupTeamMockFixed(context, team);

        context.mock.method(Event, "findOneAndUpdate", async () => null);

        const res = mockRes();
        await updateTeamPaymentStatus(adminReq(team._id, { status: "REJECTED", reason: "Bad payment" }), res);

        assert.equal(res.statusCode, 409);
        assert.equal(team.payment.status, "VERIFIED");  // unchanged
        assert.equal(team.payment.history.length, 0);
    });

    // 9. Team reactivation succeeds when capacity is available
    test("Team REJECTED → PENDING succeeds when capacity is available", async (context) => {
        const memberCount = 2;
        const team = makeTeam("REJECTED", "REGISTERED", memberCount);
        team.save = async () => {};
        setupTeamMockFixed(context, team);

        context.mock.method(Event, "findOneAndUpdate", async () => ({
            registration: { registeredParticipants: 4, capacity: 10 }
        }));

        const res = mockRes();
        await updateTeamPaymentStatus(adminReq(team._id, { status: "PENDING" }), res);

        assert.equal(res.statusCode, 200);
        assert.equal(team.payment.status, "PENDING");
        assert.equal(team.payment.history.length, 1);
    });

    // 10. Team reactivation fails when event is at capacity
    test("Team REJECTED → VERIFIED returns 409 when event is at capacity", async (context) => {
        const team = makeTeam("REJECTED", "REGISTERED", 3);
        team.save = async () => { throw new Error("save() must not be called"); };
        setupTeamMockFixed(context, team);

        context.mock.method(Event, "findOneAndUpdate", async () => null);

        const res = mockRes();
        await updateTeamPaymentStatus(adminReq(team._id, { status: "VERIFIED" }), res);

        assert.equal(res.statusCode, 409);
        assert.equal(team.payment.status, "REJECTED");  // unchanged
        assert.equal(team.payment.history.length, 0);
    });
});
