"use strict";

process.env.NODE_ENV = "test";

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Event = require("../models/Event");
const Registration = require("../models/Registration");
const Team = require("../models/Team");
const { EventGraphCoordination, executeWithGraphCoordination, COORDINATION_KEY } = require("../utils/eventGraphCoordinator");
const { createEvent, updateEvent, getEventById } = require("../controllers/eventController");
const { deleteAdminEvent, getEligibleMultiAccessEvents } = require("../controllers/adminController");

const makeId = () => new mongoose.Types.ObjectId();

function mockRes() {
    return {
        statusCode: 200,
        headers: {},
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

function mockQuery(result = null) {
    const p = Promise.resolve(result);
    p.select = () => p;
    p.lean = () => p;
    p.populate = () => p;
    p.sort = () => p;
    p.skip = () => p;
    p.limit = () => p;
    p.session = () => p;
    return p;
}

describe("Multi-Event Access — Phase 03: Concurrency, Coordination & Release-Gate Verification", () => {

    beforeEach((context) => {
        context.mock.method(mongoose, "startSession", async () => ({
            withTransaction: async (fn) => fn(),
            endSession: async () => {}
        }));
        context.mock.method(EventGraphCoordination, "findOneAndUpdate", async () => ({
            key: COORDINATION_KEY,
            version: 1
        }));
    });

    // =========================================================================
    // 1. Database Coordination & Transaction Engine Tests
    // =========================================================================

    describe("1. MongoDB Graph Coordination Engine", () => {

        test("1.1 Coordination document increments version on coordinated mutation", async (context) => {
            let version = 0;
            let mockSession = {
                withTransaction: async (fn) => fn(),
                endSession: async () => {}
            };

            context.mock.method(mongoose, "startSession", async () => mockSession);
            context.mock.method(EventGraphCoordination, "findOneAndUpdate", async (filter, update) => {
                if (update.$inc?.version) {
                    version += update.$inc.version;
                }
                return { key: COORDINATION_KEY, version };
            });

            await executeWithGraphCoordination(async (session) => {
                assert.ok(session);
                return "mutated";
            });

            assert.equal(version, 1);
        });

        test("1.2 TransientTransactionError triggers bounded retries up to maxRetries", async (context) => {
            let attempts = 0;
            const transientErr = new Error("Write conflict in transaction");
            transientErr.errorLabels = ["TransientTransactionError"];
            transientErr.hasErrorLabel = (label) => label === "TransientTransactionError";

            let mockSession = {
                withTransaction: async (fn) => {
                    attempts++;
                    if (attempts < 3) {
                        throw transientErr;
                    }
                    return fn();
                },
                endSession: async () => {}
            };

            context.mock.method(mongoose, "startSession", async () => mockSession);
            context.mock.method(EventGraphCoordination, "findOneAndUpdate", async () => ({ key: COORDINATION_KEY }));

            const result = await executeWithGraphCoordination(
                async () => "recovered_after_retry",
                { maxRetries: 3, backoffMs: 5 }
            );

            assert.equal(result, "recovered_after_retry");
            assert.equal(attempts, 3);
        });

        test("1.3 Exhausted retry budget on persistent conflict aborts with 409 CONCURRENT_TRANSACTION_TIMEOUT", async (context) => {
            let attempts = 0;
            const transientErr = new Error("Persistent write conflict");
            transientErr.errorLabels = ["TransientTransactionError"];
            transientErr.hasErrorLabel = (label) => label === "TransientTransactionError";

            let mockSession = {
                withTransaction: async () => {
                    attempts++;
                    throw transientErr;
                },
                endSession: async () => {}
            };

            context.mock.method(mongoose, "startSession", async () => mockSession);
            context.mock.method(EventGraphCoordination, "findOneAndUpdate", async () => ({ key: COORDINATION_KEY }));

            await assert.rejects(
                async () => {
                    await executeWithGraphCoordination(
                        async () => "never_reaches",
                        { maxRetries: 2, backoffMs: 5 }
                    );
                },
                (err) => {
                    assert.equal(err.statusCode, 409);
                    assert.equal(err.code, "CONCURRENT_TRANSACTION_TIMEOUT");
                    return true;
                }
            );

            assert.equal(attempts, 3); // initial attempt + 2 retries
        });

        test("1.4 Business validation failure rolls back without retrying", async (context) => {
            let attempts = 0;
            const validationErr = new Error("Custom business rule failure");
            validationErr.statusCode = 400;

            let mockSession = {
                withTransaction: async (fn) => {
                    attempts++;
                    return fn();
                },
                endSession: async () => {}
            };

            context.mock.method(mongoose, "startSession", async () => mockSession);
            context.mock.method(EventGraphCoordination, "findOneAndUpdate", async () => ({ key: COORDINATION_KEY }));

            await assert.rejects(
                async () => {
                    await executeWithGraphCoordination(async () => {
                        throw validationErr;
                    });
                },
                (err) => {
                    assert.equal(err.statusCode, 400);
                    return true;
                }
            );

            assert.equal(attempts, 1); // No retries for non-transient errors
        });

        test("1.5 Fail-closed enforcement: rejects with 503 when transaction coordination is unavailable", async (context) => {
            context.mock.method(mongoose, "startSession", async () => {
                throw new Error("Transaction numbers are only allowed on a replica set member or mongos");
            });

            await assert.rejects(
                async () => {
                    await executeWithGraphCoordination(async () => "unreachable");
                },
                (err) => {
                    assert.equal(err.statusCode, 503);
                    assert.equal(err.code, "TRANSACTION_COORDINATION_UNAVAILABLE");
                    assert.match(err.message, /replica set member/);
                    return true;
                }
            );
        });

        test("1.6 Parallel coordination document initialization (E11000 duplicate key) retries safely", async (context) => {
            let attempts = 0;
            const duplicateKeyErr = new Error("E11000 duplicate key error collection: event_graph_coordinations index: key_1 dup key: { key: 'GLOBAL_EVENT_GRAPH' }");
            duplicateKeyErr.code = 11000;

            let mockSession = {
                withTransaction: async (fn) => {
                    attempts++;
                    if (attempts === 1) {
                        throw duplicateKeyErr; // Simulate concurrent upsert collision on first attempt
                    }
                    return fn();
                },
                endSession: async () => {}
            };

            context.mock.method(mongoose, "startSession", async () => mockSession);
            context.mock.method(EventGraphCoordination, "findOneAndUpdate", async () => ({ key: COORDINATION_KEY }));

            const result = await executeWithGraphCoordination(
                async () => "initialized_successfully",
                { maxRetries: 2, backoffMs: 5 }
            );

            assert.equal(result, "initialized_successfully");
            assert.equal(attempts, 2);
        });

        test("1.7 Session always closes on success or failure", async (context) => {
            let sessionClosed = false;
            let mockSession = {
                withTransaction: async () => {
                    throw new Error("Simulated mutation failure");
                },
                endSession: async () => {
                    sessionClosed = true;
                }
            };

            context.mock.method(mongoose, "startSession", async () => mockSession);
            context.mock.method(EventGraphCoordination, "findOneAndUpdate", async () => ({ key: COORDINATION_KEY }));

            await assert.rejects(async () => {
                await executeWithGraphCoordination(async () => {});
            });

            assert.equal(sessionClosed, true);
        });
    });

    // =========================================================================
    // 2. Concurrency Race Condition Scenarios
    // =========================================================================

    describe("2. Concurrency & Cross-Relationship Safety", () => {

        test("2.1 Opposing cross-parent creation: cycle cannot be established (Admin A vs Admin B)", async (context) => {
            const eventAId = makeId();
            const eventBId = makeId();

            const eventA = {
                _id: eventAId,
                name: "Event A",
                registration: { mode: "INDIVIDUAL", capacity: 100, registeredParticipants: 0 },
                multiEventAccess: { enabled: false, includedEvents: [] },
                save: async function () { return this; }
            };

            context.mock.method(Event, "findById", () => eventA);
            context.mock.method(Registration, "countDocuments", async () => 0);
            context.mock.method(Team, "countDocuments", async () => 0);

            // Simulate that Event B committed first and is now an active combo parent
            context.mock.method(Event, "find", () => mockQuery([
                {
                    _id: eventBId,
                    name: "Event B",
                    status: "PUBLISHED",
                    registration: { mode: "INDIVIDUAL" },
                    multiEventAccess: { enabled: true, includedEvents: [eventAId] }
                }
            ]));
            context.mock.method(Event, "findOne", () => mockQuery(null));

            const req = {
                params: { id: eventAId.toString() },
                body: {
                    multiEventAccess: {
                        enabled: true,
                        includedEvents: [eventBId.toString()]
                    }
                }
            };
            const res = mockRes();
            await updateEvent(req, res);

            // Must reject because Event B is already a combo parent (nested combos prohibited)
            assert.equal(res.statusCode, 400);
            assert.match(res.body.message, /nested combos are prohibited/);
        });

        test("2.2 Child deletion race: deleting child while another admin adds child to combo", async (context) => {
            const childId = makeId();
            const parentId = makeId();

            const childEvent = {
                _id: childId,
                name: "Child Contest",
                status: "CANCELLED",
                registration: { registeredParticipants: 0 }
            };

            // Parent combo committed just before delete executed
            context.mock.method(Event, "findById", () => mockQuery(childEvent));
            context.mock.method(Event, "findOne", (query) => {
                if (query && query["multiEventAccess.enabled"] === true) {
                    return mockQuery({ _id: parentId, name: "Parent Combo Pass" });
                }
                return mockQuery(null);
            });

            const req = { params: { id: childId.toString() } };
            const res = mockRes();
            await deleteAdminEvent(req, res);

            assert.equal(res.statusCode, 409);
            assert.equal(res.body.code, "REFERENCED_BY_PARENT_COMBO");
        });

        test("2.3 Disabling a parent while another references it as child: parentIsChild prevents cycle", async (context) => {
            const childId = makeId();
            const parentId = makeId();

            // Event is an included child of another parent combo
            context.mock.method(Event, "findById", () => ({
                _id: childId,
                name: "Child Event",
                registration: { mode: "INDIVIDUAL", capacity: 100, registeredParticipants: 0 },
                multiEventAccess: { enabled: false, includedEvents: [] },
                save: async function () { return this; }
            }));
            context.mock.method(Registration, "countDocuments", async () => 0);
            context.mock.method(Team, "countDocuments", async () => 0);
            context.mock.method(Event, "find", () => mockQuery([
                { _id: makeId(), name: "Grandchild", status: "PUBLISHED", registration: { mode: "INDIVIDUAL" } }
            ]));
            context.mock.method(Event, "findOne", () => mockQuery({
                _id: parentId,
                name: "Existing Active Parent"
            }));

            const req = {
                params: { id: childId.toString() },
                body: {
                    multiEventAccess: {
                        enabled: true,
                        includedEvents: [makeId().toString()]
                    }
                }
            };
            const res = mockRes();
            await updateEvent(req, res);

            // Cannot become a combo parent if already an included child
            assert.equal(res.statusCode, 400);
            assert.match(res.body.message, /already an included child/);
        });

        test("2.4 Fan-out allowed: multiple parents can reference the same eligible child event", async (context) => {
            const childId = makeId();
            const parent1Id = makeId();

            const parent1 = {
                _id: parent1Id,
                name: "Technical Combo Pass",
                registration: { mode: "INDIVIDUAL", capacity: 100, registeredParticipants: 0 },
                multiEventAccess: { enabled: false, includedEvents: [] },
                save: async function () { return this; }
            };

            context.mock.method(Event, "findById", () => parent1);
            context.mock.method(Registration, "countDocuments", async () => 0);
            context.mock.method(Team, "countDocuments", async () => 0);
            context.mock.method(Event, "find", () => mockQuery([
                {
                    _id: childId,
                    name: "Coding Sprint",
                    status: "PUBLISHED",
                    registration: { mode: "INDIVIDUAL" },
                    multiEventAccess: { enabled: false, includedEvents: [] }
                }
            ]));
            context.mock.method(Event, "findOne", () => mockQuery(null));

            const req = {
                params: { id: parent1Id.toString() },
                body: {
                    multiEventAccess: {
                        enabled: true,
                        includedEvents: [childId.toString()]
                    }
                }
            };
            const res = mockRes();
            await updateEvent(req, res);

            assert.equal(res.statusCode, 200);
            assert.equal(parent1.multiEventAccess.enabled, true);
            assert.equal(parent1.multiEventAccess.includedEvents.length, 1);
        });
    });

    // =========================================================================
    // 3. Authoritative Registration-History Safeguards
    // =========================================================================

    describe("3. Authoritative Registration-History Safeguards", () => {

        test("3.1 Active individual registration blocks combo conversion", async (context) => {
            const parentId = makeId();
            context.mock.method(Event, "findById", () => ({
                _id: parentId,
                registration: { mode: "INDIVIDUAL", capacity: 100, registeredParticipants: 1 },
                multiEventAccess: { enabled: false, includedEvents: [] },
                save: async function () { return this; }
            }));
            context.mock.method(Registration, "countDocuments", async () => 1);
            context.mock.method(Team, "countDocuments", async () => 0);

            const req = {
                params: { id: parentId.toString() },
                body: { multiEventAccess: { enabled: true, includedEvents: [makeId().toString()] } }
            };
            const res = mockRes();
            await updateEvent(req, res);

            assert.equal(res.statusCode, 409);
            assert.equal(res.body.code, "CANNOT_MODIFY_REGISTERED_COMBO");
        });

        test("3.2 Cancelled individual registration blocks combo conversion (authoritative record)", async (context) => {
            const parentId = makeId();
            // cached counter is 0 because registration was cancelled, but document still exists!
            context.mock.method(Event, "findById", () => ({
                _id: parentId,
                registration: { mode: "INDIVIDUAL", capacity: 100, registeredParticipants: 0 },
                multiEventAccess: { enabled: false, includedEvents: [] },
                save: async function () { return this; }
            }));
            context.mock.method(Registration, "countDocuments", async () => 1); // Cancelled registration exists
            context.mock.method(Team, "countDocuments", async () => 0);

            const req = {
                params: { id: parentId.toString() },
                body: { multiEventAccess: { enabled: true, includedEvents: [makeId().toString()] } }
            };
            const res = mockRes();
            await updateEvent(req, res);

            assert.equal(res.statusCode, 409);
            assert.equal(res.body.code, "CANNOT_MODIFY_REGISTERED_COMBO");
        });

        test("3.3 Cancelled team blocks combo conversion", async (context) => {
            const parentId = makeId();
            context.mock.method(Event, "findById", () => ({
                _id: parentId,
                registration: { mode: "TEAM", capacity: 50, registeredParticipants: 0 },
                multiEventAccess: { enabled: false, includedEvents: [] },
                save: async function () { return this; }
            }));
            context.mock.method(Registration, "countDocuments", async () => 0);
            context.mock.method(Team, "countDocuments", async () => 1); // Cancelled team exists

            const req = {
                params: { id: parentId.toString() },
                body: { multiEventAccess: { enabled: true, includedEvents: [makeId().toString()] } }
            };
            const res = mockRes();
            await updateEvent(req, res);

            assert.equal(res.statusCode, 409);
            assert.equal(res.body.code, "CANNOT_MODIFY_REGISTERED_COMBO");
        });

        test("3.4 Stale or corrupted counter alone (> 0) blocks combo conversion", async (context) => {
            const parentId = makeId();
            context.mock.method(Event, "findById", () => ({
                _id: parentId,
                registration: { mode: "INDIVIDUAL", capacity: 100, registeredParticipants: 3 },
                multiEventAccess: { enabled: false, includedEvents: [] },
                save: async function () { return this; }
            }));
            context.mock.method(Registration, "countDocuments", async () => 0);
            context.mock.method(Team, "countDocuments", async () => 0);

            const req = {
                params: { id: parentId.toString() },
                body: { multiEventAccess: { enabled: true, includedEvents: [makeId().toString()] } }
            };
            const res = mockRes();
            await updateEvent(req, res);

            assert.equal(res.statusCode, 409);
            assert.equal(res.body.code, "CANNOT_MODIFY_REGISTERED_COMBO");
        });

        test("3.5 Unrelated field update on event with registrations succeeds without conflict", async (context) => {
            const parentId = makeId();
            const event = {
                _id: parentId,
                name: "Initial Event Name",
                venue: "Old Venue",
                registration: { mode: "INDIVIDUAL", capacity: 100, registeredParticipants: 25 },
                multiEventAccess: { enabled: false, includedEvents: [] },
                save: async function () { return this; }
            };

            context.mock.method(Event, "findById", () => event);
            context.mock.method(Registration, "countDocuments", async () => 25);
            context.mock.method(Team, "countDocuments", async () => 0);

            // Update only venue and name; multiEventAccess is undefined
            const req = {
                params: { id: parentId.toString() },
                body: { name: "Renamed Event", venue: "New Hall" }
            };
            const res = mockRes();
            await updateEvent(req, res);

            assert.equal(res.statusCode, 200);
            assert.equal(event.name, "Renamed Event");
            assert.equal(event.venue, "New Hall");
        });
    });

    // =========================================================================
    // 4. Advisory Selector Endpoint Contracts
    // =========================================================================

    describe("4. Advisory Selector Endpoint Behavior", () => {

        test("4.1 Invalid parentId format returns 400 Bad Request", async () => {
            const req = { query: { parentId: "invalid-hex-id" } };
            const res = mockRes();
            await getEligibleMultiAccessEvents(req, res);

            assert.equal(res.statusCode, 400);
            assert.equal(res.body.message, "Invalid parent event ID");
        });

        test("4.2 Parent event already an included child in another combo flags isParentEligibleAsCombo: false", async (context) => {
            const parentId = makeId();
            context.mock.method(Event, "find", () => mockQuery([
                { _id: makeId(), name: "Candidate 1", status: "PUBLISHED", registration: { mode: "INDIVIDUAL" } }
            ]));
            context.mock.method(Event, "findOne", () => mockQuery({
                _id: makeId(),
                name: "Parent Combo Alpha"
            }));

            const req = { query: { parentId: parentId.toString() } };
            const res = mockRes();
            await getEligibleMultiAccessEvents(req, res);

            assert.equal(res.statusCode, 200);
            assert.equal(res.body.isParentEligibleAsCombo, false);
            assert.match(res.body.parentIneligibilityReason, /already an included child/);
            assert.equal(res.body.eligibleCount, 0);
        });

        test("4.3 Events already included in this parent are flagged with isAlreadyIncluded: true", async (context) => {
            const parentId = makeId();
            const child1Id = makeId();
            const child2Id = makeId();

            const events = [
                {
                    _id: parentId,
                    name: "Existing Combo Parent",
                    status: "PUBLISHED",
                    registration: { mode: "INDIVIDUAL" },
                    multiEventAccess: { enabled: true, includedEvents: [child1Id] }
                },
                {
                    _id: child1Id,
                    name: "Already Included Child",
                    status: "PUBLISHED",
                    registration: { mode: "INDIVIDUAL" }
                },
                {
                    _id: child2Id,
                    name: "Fresh Eligible Child",
                    status: "PUBLISHED",
                    registration: { mode: "INDIVIDUAL" }
                }
            ];

            context.mock.method(Event, "find", () => mockQuery(events));
            context.mock.method(Event, "findOne", () => mockQuery(null));

            const req = { query: { parentId: parentId.toString(), parentMode: "INDIVIDUAL" } };
            const res = mockRes();
            await getEligibleMultiAccessEvents(req, res);

            assert.equal(res.statusCode, 200);
            const child1Eval = res.body.events.find(e => e._id.toString() === child1Id.toString());
            assert.equal(child1Eval.isAlreadyIncluded, true);
            assert.equal(child1Eval.isEligible, true);

            const child2Eval = res.body.events.find(e => e._id.toString() === child2Id.toString());
            assert.equal(child2Eval.isAlreadyIncluded, false);
            assert.equal(child2Eval.isEligible, true);
        });
    });

    // =========================================================================
    // 5. Production Legacy Compatibility (Isolated Fixtures)
    // =========================================================================

    describe("5. Production Legacy Compatibility Fixtures", () => {

        test("5.1 Legacy Event without multiEventAccess defaults to disabled", () => {
            const legacyEvent = new Event({
                name: "Legacy Coding Competition",
                description: "Single legacy event",
                category: "TECHNICAL",
                venue: "Auditorium",
                startDate: new Date("2026-11-28T09:00:00Z"),
                endDate: new Date("2026-11-28T17:00:00Z"),
                registration: {
                    mode: "INDIVIDUAL",
                    deadline: new Date("2026-11-27T23:59:00Z"),
                    capacity: 50
                },
                createdBy: makeId()
            });

            assert.equal(legacyEvent.multiEventAccess.enabled, false);
            assert.deepEqual(legacyEvent.multiEventAccess.includedEvents, []);
            assert.equal(legacyEvent.registration.allowDirectRegistration, true);
        });

        test("5.2 Legacy individual Registration maintains exact schema and unique 64-hex QR token", () => {
            const reg = new Registration({
                event: makeId(),
                user: makeId(),
                participantDetails: {
                    fullName: "Participant Alpha",
                    mobileNumber: "9988776655",
                    collegeName: "DIET",
                    department: "CSE",
                    section: "A",
                    yearOfStudy: "3",
                    rollNumber: "21U41A0501"
                },
                payment: {
                    method: "UPI",
                    status: "VERIFIED",
                    receivedAmount: 200
                }
            });

            assert.ok(reg.qrToken);
            assert.equal(typeof reg.qrToken, "string");
            assert.equal(reg.qrToken.length, 64);
            assert.equal(reg.attendance.isPresent, false);
            assert.equal(reg.attendance.checkedInAt, null);
            assert.equal(reg.payment.status, "VERIFIED");
        });

        test("5.3 Legacy Team Registration preserves team schema and member references", () => {
            const teamId = makeId();
            const eventId = makeId();

            const team = new Team({
                _id: teamId,
                teamName: "Byte Builders",
                event: eventId,
                leader: makeId(),
                memberCount: 2,
                payment: {
                    method: "CASH",
                    status: "PENDING",
                    cashReceiverName: "Receiver X"
                }
            });

            assert.equal(team.teamName, "Byte Builders");
            assert.equal(team.memberCount, 2);
            assert.equal(team.payment.cashReceiverName, "Receiver X");
            assert.equal(team.status, "REGISTERED");
        });

        test("5.4 Attendance fields and status remain unchanged on existing registrations", () => {
            const checkInTime = new Date("2026-11-28T10:15:00Z");
            const reg = new Registration({
                event: makeId(),
                user: makeId(),
                participantDetails: {
                    fullName: "Checked-in Participant",
                    mobileNumber: "9876543210",
                    collegeName: "DIET",
                    department: "ECE",
                    section: "B",
                    yearOfStudy: "2",
                    rollNumber: "22U41A0402"
                },
                attendance: {
                    isPresent: true,
                    checkedInAt: checkInTime
                }
            });

            assert.equal(reg.attendance.isPresent, true);
            assert.equal(reg.attendance.checkedInAt, checkInTime);
        });

        test("5.5 Payment history and cash receiver names operate without modification", () => {
            const adminId = makeId();
            const reg = new Registration({
                event: makeId(),
                user: makeId(),
                participantDetails: {
                    fullName: "Cash Participant",
                    mobileNumber: "9123456789",
                    collegeName: "DIET",
                    department: "MECH",
                    section: "A",
                    yearOfStudy: "4",
                    rollNumber: "20U41A0303"
                },
                payment: {
                    method: "CASH",
                    status: "VERIFIED",
                    cashReceiverName: "Treasurer Team",
                    history: [
                        {
                            fromStatus: "PENDING",
                            toStatus: "VERIFIED",
                            changedBy: adminId,
                            changedAt: new Date("2026-11-20T12:00:00Z")
                        }
                    ]
                }
            });

            assert.equal(reg.payment.cashReceiverName, "Treasurer Team");
            assert.equal(reg.payment.history.length, 1);
            assert.equal(reg.payment.history[0].toStatus, "VERIFIED");
        });
    });

});
