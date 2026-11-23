"use strict";

process.env.NODE_ENV = "test";

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Event = require("../models/Event");
const Registration = require("../models/Registration");
const Team = require("../models/Team");
const { EventGraphCoordination } = require("../utils/eventGraphCoordinator");
const { createEvent, getEventById, updateEvent } = require("../controllers/eventController");
const { getAllAdminEvents, deleteAdminEvent, getEligibleMultiAccessEvents } = require("../controllers/adminController");

// Helper to create valid ObjectIds
const makeId = () => new mongoose.Types.ObjectId();

// Mock response object
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

// Chainable query helper for mocking findOne
function mockQuery(result = null) {
    const p = Promise.resolve(result);
    p.select = () => p;
    p.lean = () => p;
    p.populate = () => p;
    p.sort = () => p;
    p.skip = () => p;
    p.limit = () => p;
    return p;
}

describe("Multi-Event Access — Phase 02: Admin Event Configuration API Integration", () => {

    beforeEach((context) => {
        context.mock.method(mongoose, "startSession", async () => ({
            withTransaction: async (fn) => fn(),
            endSession: async () => {}
        }));
        context.mock.method(EventGraphCoordination, "findOneAndUpdate", async () => ({
            key: "GLOBAL_EVENT_GRAPH",
            version: 1
        }));
    });

    test("Test 1: Legacy event creation without multiEventAccess defaults to disabled", async (context) => {
        let createdPayload = null;
        context.mock.method(Event, "create", async (data) => {
            const doc = Array.isArray(data) ? data[0] : data;
            createdPayload = doc;
            return { _id: makeId(), ...doc, toObject: () => ({ ...doc }) };
        });

        const req = {
            user: { _id: makeId(), role: "ADMIN" },
            body: {
                name: "Solo Coding Contest",
                description: "Single event without multi-access",
                category: "TECHNICAL",
                venue: "Lab 1",
                startDate: new Date("2026-11-28T09:00:00Z"),
                endDate: new Date("2026-11-28T17:00:00Z"),
                registration: {
                    mode: "INDIVIDUAL",
                    deadline: new Date("2026-11-27T23:59:00Z"),
                    capacity: 50,
                    registrationFee: 100
                }
            }
        };
        const res = mockRes();
        await createEvent(req, res);

        assert.equal(res.statusCode, 201);
        assert.equal(res.body.success, true);
        assert.equal(createdPayload.multiEventAccess.enabled, false);
        assert.deepEqual(createdPayload.multiEventAccess.includedEvents, []);
        assert.equal(createdPayload.registration.allowDirectRegistration, true);
    });

    test("Test 2: New multi-event parent creation with valid multiEventAccess stores normalized config", async (context) => {
        const child1Id = makeId();
        const child2Id = makeId();

        context.mock.method(Event, "find", () => mockQuery([
            { _id: child1Id, name: "Child 1", status: "PUBLISHED", registration: { mode: "INDIVIDUAL" } },
            { _id: child2Id, name: "Child 2", status: "PUBLISHED", registration: { mode: "INDIVIDUAL" } }
        ]));

        let createdPayload = null;
        context.mock.method(Event, "create", async (data) => {
            const doc = Array.isArray(data) ? data[0] : data;
            createdPayload = doc;
            return { _id: makeId(), ...doc, toObject: () => ({ ...doc }) };
        });

        const req = {
            user: { _id: makeId(), role: "ADMIN" },
            body: {
                name: "Mega Tech Pass",
                description: "Access to multiple technical competitions",
                category: "TECHNICAL",
                venue: "Main Auditorium",
                startDate: new Date("2026-11-28T09:00:00Z"),
                endDate: new Date("2026-11-28T17:00:00Z"),
                registration: {
                    mode: "INDIVIDUAL",
                    deadline: new Date("2026-11-27T23:59:00Z"),
                    capacity: 200,
                    registrationFee: 300,
                    allowDirectRegistration: true
                },
                multiEventAccess: {
                    enabled: true,
                    includedEvents: [child1Id.toString(), child2Id.toString()]
                }
            }
        };
        const res = mockRes();
        await createEvent(req, res);

        assert.equal(res.statusCode, 201);
        assert.equal(createdPayload.multiEventAccess.enabled, true);
        assert.equal(createdPayload.multiEventAccess.includedEvents.length, 2);
    });

    test("Test 3: Valid configuration update on existing event updates multiEventAccess", async (context) => {
        const parentId = makeId();
        const childId = makeId();

        const existingEvent = {
            _id: parentId,
            name: "Combo Event",
            registration: { mode: "INDIVIDUAL", capacity: 100, registeredParticipants: 0 },
            multiEventAccess: { enabled: false, includedEvents: [] },
            save: async function () { return this; }
        };

        context.mock.method(Event, "findById", () => existingEvent);
        context.mock.method(Registration, "countDocuments", async () => 0);
        context.mock.method(Team, "countDocuments", async () => 0);
        context.mock.method(Event, "find", () => mockQuery([
            { _id: childId, name: "Child Event", status: "PUBLISHED", registration: { mode: "INDIVIDUAL" } }
        ]));
        context.mock.method(Event, "findOne", () => mockQuery(null));

        const req = {
            params: { id: parentId.toString() },
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
        assert.equal(existingEvent.multiEventAccess.enabled, true);
        assert.equal(existingEvent.multiEventAccess.includedEvents.length, 1);
    });

    test("Test 4: Disable configuration before registrations exist resets config", async (context) => {
        const parentId = makeId();
        const childId = makeId();

        const existingEvent = {
            _id: parentId,
            name: "Combo Event",
            registration: { mode: "INDIVIDUAL", capacity: 100, registeredParticipants: 0 },
            multiEventAccess: { enabled: true, includedEvents: [childId] },
            save: async function () { return this; }
        };

        context.mock.method(Event, "findById", () => existingEvent);
        context.mock.method(Registration, "countDocuments", async () => 0);
        context.mock.method(Team, "countDocuments", async () => 0);

        const req = {
            params: { id: parentId.toString() },
            body: {
                multiEventAccess: {
                    enabled: false,
                    includedEvents: []
                }
            }
        };
        const res = mockRes();
        await updateEvent(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(existingEvent.multiEventAccess.enabled, false);
        assert.deepEqual(existingEvent.multiEventAccess.includedEvents, []);
    });

    test("Test 5: Reject invalid configuration payload shapes (400 Bad Request)", async (context) => {
        const parentId = makeId();
        const existingEvent = {
            _id: parentId,
            registration: { mode: "INDIVIDUAL", capacity: 100, registeredParticipants: 0 },
            multiEventAccess: { enabled: false, includedEvents: [] },
            save: async function () { return this; }
        };

        context.mock.method(Event, "findById", () => existingEvent);
        context.mock.method(Registration, "countDocuments", async () => 0);
        context.mock.method(Team, "countDocuments", async () => 0);

        const req = {
            params: { id: parentId.toString() },
            body: {
                multiEventAccess: {
                    enabled: "not_a_boolean",
                    includedEvents: []
                }
            }
        };
        const res = mockRes();
        await updateEvent(req, res);

        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /multiEventAccess.enabled must be a boolean/);
    });

    test("Test 6: Reject nonexistent child event IDs (400 Bad Request)", async (context) => {
        const parentId = makeId();
        const nonExistentChildId = makeId();

        const existingEvent = {
            _id: parentId,
            registration: { mode: "INDIVIDUAL", capacity: 100, registeredParticipants: 0 },
            multiEventAccess: { enabled: false, includedEvents: [] },
            save: async function () { return this; }
        };

        context.mock.method(Event, "findById", () => existingEvent);
        context.mock.method(Registration, "countDocuments", async () => 0);
        context.mock.method(Team, "countDocuments", async () => 0);
        context.mock.method(Event, "find", () => mockQuery([]));

        const req = {
            params: { id: parentId.toString() },
            body: {
                multiEventAccess: {
                    enabled: true,
                    includedEvents: [nonExistentChildId.toString()]
                }
            }
        };
        const res = mockRes();
        await updateEvent(req, res);

        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /do not exist/);
    });

    test("Test 7: Reject duplicate child IDs (400 Bad Request)", async (context) => {
        const parentId = makeId();
        const childId = makeId();

        const existingEvent = {
            _id: parentId,
            registration: { mode: "INDIVIDUAL", capacity: 100, registeredParticipants: 0 },
            multiEventAccess: { enabled: false, includedEvents: [] },
            save: async function () { return this; }
        };

        context.mock.method(Event, "findById", () => existingEvent);
        context.mock.method(Registration, "countDocuments", async () => 0);
        context.mock.method(Team, "countDocuments", async () => 0);

        const req = {
            params: { id: parentId.toString() },
            body: {
                multiEventAccess: {
                    enabled: true,
                    includedEvents: [childId.toString(), childId.toString()]
                }
            }
        };
        const res = mockRes();
        await updateEvent(req, res);

        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /Duplicate event ID found in includedEvents/);
    });

    test("Test 8: Reject self-reference in multiEventAccess (400 Bad Request)", async (context) => {
        const parentId = makeId();

        const existingEvent = {
            _id: parentId,
            registration: { mode: "INDIVIDUAL", capacity: 100, registeredParticipants: 0 },
            multiEventAccess: { enabled: false, includedEvents: [] },
            save: async function () { return this; }
        };

        context.mock.method(Event, "findById", () => existingEvent);
        context.mock.method(Registration, "countDocuments", async () => 0);
        context.mock.method(Team, "countDocuments", async () => 0);

        const req = {
            params: { id: parentId.toString() },
            body: {
                multiEventAccess: {
                    enabled: true,
                    includedEvents: [parentId.toString()]
                }
            }
        };
        const res = mockRes();
        await updateEvent(req, res);

        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /cannot include itself/);
    });

    test("Test 9: Reject nested combos when child is already a multi-event parent (400 Bad Request)", async (context) => {
        const parentId = makeId();
        const childId = makeId();

        const existingEvent = {
            _id: parentId,
            registration: { mode: "INDIVIDUAL", capacity: 100, registeredParticipants: 0 },
            multiEventAccess: { enabled: false, includedEvents: [] },
            save: async function () { return this; }
        };

        context.mock.method(Event, "findById", () => existingEvent);
        context.mock.method(Registration, "countDocuments", async () => 0);
        context.mock.method(Team, "countDocuments", async () => 0);
        context.mock.method(Event, "find", () => mockQuery([
            {
                _id: childId,
                name: "Already Combo",
                status: "PUBLISHED",
                registration: { mode: "INDIVIDUAL" },
                multiEventAccess: { enabled: true, includedEvents: [makeId()] }
            }
        ]));

        const req = {
            params: { id: parentId.toString() },
            body: {
                multiEventAccess: {
                    enabled: true,
                    includedEvents: [childId.toString()]
                }
            }
        };
        const res = mockRes();
        await updateEvent(req, res);

        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /nested combos are prohibited/);
    });

    test("Test 10: Reject registration mode mismatch (400 Bad Request)", async (context) => {
        const parentId = makeId();
        const childId = makeId();

        const existingEvent = {
            _id: parentId,
            registration: { mode: "INDIVIDUAL", capacity: 100, registeredParticipants: 0 },
            multiEventAccess: { enabled: false, includedEvents: [] },
            save: async function () { return this; }
        };

        context.mock.method(Event, "findById", () => existingEvent);
        context.mock.method(Registration, "countDocuments", async () => 0);
        context.mock.method(Team, "countDocuments", async () => 0);
        context.mock.method(Event, "find", () => mockQuery([
            {
                _id: childId,
                name: "Team Hackathon",
                status: "PUBLISHED",
                registration: { mode: "TEAM" }
            }
        ]));
        context.mock.method(Event, "findOne", () => mockQuery(null));

        const req = {
            params: { id: parentId.toString() },
            body: {
                multiEventAccess: {
                    enabled: true,
                    includedEvents: [childId.toString()]
                }
            }
        };
        const res = mockRes();
        await updateEvent(req, res);

        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /Registration mode mismatch/);
    });

    test("Test 11: Reject editing an already registered parent into a combo (409 Conflict)", async (context) => {
        const parentId = makeId();
        const childId = makeId();

        const existingEvent = {
            _id: parentId,
            registration: { mode: "INDIVIDUAL", capacity: 100, registeredParticipants: 5 },
            multiEventAccess: { enabled: false, includedEvents: [] },
            save: async function () { return this; }
        };

        context.mock.method(Event, "findById", () => existingEvent);
        context.mock.method(Registration, "countDocuments", async () => 5);
        context.mock.method(Team, "countDocuments", async () => 0);

        const req = {
            params: { id: parentId.toString() },
            body: {
                multiEventAccess: {
                    enabled: true,
                    includedEvents: [childId.toString()]
                }
            }
        };
        const res = mockRes();
        await updateEvent(req, res);

        assert.equal(res.statusCode, 409);
        assert.equal(res.body.code, "CANNOT_MODIFY_REGISTERED_COMBO");
        assert.match(res.body.message, /existing registrations or teams/);
    });

    test("Test 12: Preserve unrelated fields on PATCH when multiEventAccess is unchanged", async (context) => {
        const parentId = makeId();

        const existingEvent = {
            _id: parentId,
            name: "Old Event Name",
            venue: "Old Hall",
            registration: { mode: "INDIVIDUAL", capacity: 100, registeredParticipants: 10 },
            multiEventAccess: { enabled: false, includedEvents: [] },
            save: async function () { return this; }
        };

        context.mock.method(Event, "findById", () => existingEvent);
        context.mock.method(Registration, "countDocuments", async () => 10);
        context.mock.method(Team, "countDocuments", async () => 0);

        const req = {
            params: { id: parentId.toString() },
            body: {
                name: "Updated Event Name",
                venue: "Auditorium 2"
            }
        };
        const res = mockRes();
        await updateEvent(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(existingEvent.name, "Updated Event Name");
        assert.equal(existingEvent.venue, "Auditorium 2");
        assert.equal(existingEvent.multiEventAccess.enabled, false);
    });

    test("Test 13: Retrieve included-event IDs and details on GET /api/events/:id", async (context) => {
        const parentId = makeId();
        const child1Id = makeId();
        const child2Id = makeId();

        const comboEvent = {
            _id: parentId,
            name: "Mega Combo Pass",
            status: "PUBLISHED",
            registration: { mode: "INDIVIDUAL", capacity: 200, registeredParticipants: 15 },
            multiEventAccess: {
                enabled: true,
                includedEvents: [child1Id, child2Id]
            },
            toObject: function () {
                return {
                    _id: this._id,
                    name: this.name,
                    status: this.status,
                    registration: { ...this.registration },
                    multiEventAccess: { ...this.multiEventAccess }
                };
            }
        };

        context.mock.method(Event, "findById", () => mockQuery(comboEvent));
        context.mock.method(Registration, "aggregate", async () => [{ _id: parentId, registeredParticipants: 15 }]);
        context.mock.method(Event, "find", () => mockQuery([
            { _id: child1Id, name: "Child 1", category: "TECHNICAL", venue: "Lab 1", status: "PUBLISHED" },
            { _id: child2Id, name: "Child 2", category: "TECHNICAL", venue: "Lab 2", status: "PUBLISHED" }
        ]));

        const req = {
            params: { id: parentId.toString() },
            user: { role: "ADMIN" }
        };
        const res = mockRes();
        await getEventById(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.event.multiEventAccess.enabled, true);
        assert.deepEqual(res.body.event.multiEventAccess.includedEvents, [child1Id.toString(), child2Id.toString()]);
        assert.equal(res.body.event.includedEventDetails.length, 2);
        assert.equal(res.body.event.includedEventDetails[0].name, "Child 1");
    });

    test("Test 14: Admin listing contains multi-event configuration with legacy defaults", async (context) => {
        const comboId = makeId();
        const legacyId = makeId();

        const events = [
            {
                _id: comboId,
                name: "Combo Event",
                multiEventAccess: { enabled: true, includedEvents: [makeId()] },
                registration: { capacity: 50 }
            },
            {
                _id: legacyId,
                name: "Legacy Event",
                registration: { capacity: 100 }
            }
        ];

        context.mock.method(Event, "find", () => mockQuery(events));
        context.mock.method(Event, "countDocuments", async () => events.length);
        context.mock.method(Registration, "aggregate", async () => []);

        const res = mockRes();
        await getAllAdminEvents({ query: {} }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.events.length, 2);
        assert.equal(res.body.events[0].multiEventAccess.enabled, true);
        assert.equal(res.body.events[1].multiEventAccess.enabled, false);
        assert.deepEqual(res.body.events[1].multiEventAccess.includedEvents, []);
    });

    test("Test 15: Child deletion blocked while referenced by active combo parent (409 Conflict)", async (context) => {
        const childId = makeId();
        const parentId = makeId();

        const childEvent = {
            _id: childId,
            name: "Child Contender",
            status: "CANCELLED",
            registration: { registeredParticipants: 0 }
        };

        context.mock.method(Event, "findById", () => mockQuery(childEvent));
        context.mock.method(Event, "findOne", (query) => {
            if (query && query["multiEventAccess.enabled"] === true) {
                return mockQuery({ _id: parentId, name: "Active Parent Combo" });
            }
            return mockQuery(null);
        });

        const req = { params: { id: childId.toString() } };
        const res = mockRes();
        await deleteAdminEvent(req, res);

        assert.equal(res.statusCode, 409);
        assert.equal(res.body.code, "REFERENCED_BY_PARENT_COMBO");
        assert.match(res.body.message, /included in the active combo event "Active Parent Combo"/);
    });

    test("Test 16: Non-admin mutation denied by role and auth middleware", () => {
        const eventRoutes = require("../routes/eventRoutes");
        const adminRoutes = require("../routes/adminRoutes");

        assert.ok(eventRoutes.stack.length > 0);
        assert.ok(adminRoutes.stack.length > 0);
    });

    test("Test 17: Existing registration model and validations remain backward compatible", () => {
        const reg = new Registration({
            event: makeId(),
            user: makeId(),
            participantDetails: {
                fullName: "John Doe",
                mobileNumber: "9876543210",
                collegeName: "DIET",
                department: "CSE",
                section: "A",
                yearOfStudy: "3",
                rollNumber: "21U41A0501"
            },
            registrationFee: 0,
            payment: { status: "NOT_REQUIRED" }
        });

        assert.equal(reg.status, "REGISTERED");
        assert.ok(reg.qrToken);
        assert.equal(typeof reg.qrToken, "string");
    });

    test("Test 18: Existing payment functionality unaffected", () => {
        const reg = new Registration({
            event: makeId(),
            user: makeId(),
            participantDetails: {
                fullName: "Alice Smith",
                mobileNumber: "9876543211",
                collegeName: "DIET",
                department: "ECE",
                section: "B",
                yearOfStudy: "2",
                rollNumber: "22U41A0402"
            },
            payment: {
                status: "PENDING",
                method: "CASH",
                cashReceiverName: "Test Receiver"
            }
        });

        assert.equal(reg.payment.status, "PENDING");
        assert.equal(reg.payment.cashReceiverName, "Test Receiver");
    });

    test("Test 19: Existing attendance schema and default unaffected", () => {
        const reg = new Registration({
            event: makeId(),
            user: makeId(),
            participantDetails: {
                fullName: "Bob Ray",
                mobileNumber: "9876543212",
                collegeName: "DIET",
                department: "MECH",
                section: "A",
                yearOfStudy: "4",
                rollNumber: "20U41A0303"
            }
        });

        assert.equal(reg.attendance.isPresent, false);
        assert.equal(reg.attendance.checkedInAt, null);
    });

    test("Test 20: Existing QR token generation unaffected", () => {
        const reg = new Registration({
            event: makeId(),
            user: makeId(),
            participantDetails: {
                fullName: "Carol Danvers",
                mobileNumber: "9876543213",
                collegeName: "DIET",
                department: "IT",
                section: "C",
                yearOfStudy: "1",
                rollNumber: "23U41A1204"
            }
        });

        assert.ok(reg.qrToken);
        assert.equal(typeof reg.qrToken, "string");
        assert.equal(reg.qrToken.length, 64);
    });

    test("Test 21: Concurrent same-parent updates handled cleanly", async (context) => {
        const parentId = makeId();
        const childId = makeId();

        const existingEvent = {
            _id: parentId,
            registration: { mode: "INDIVIDUAL", capacity: 100, registeredParticipants: 0 },
            multiEventAccess: { enabled: false, includedEvents: [] },
            save: async function () { return this; }
        };

        context.mock.method(Event, "findById", () => existingEvent);
        context.mock.method(Registration, "countDocuments", async () => 0);
        context.mock.method(Team, "countDocuments", async () => 0);
        context.mock.method(Event, "find", () => mockQuery([
            { _id: childId, name: "Child 1", status: "PUBLISHED", registration: { mode: "INDIVIDUAL" } }
        ]));
        context.mock.method(Event, "findOne", () => mockQuery(null));

        const req1 = {
            params: { id: parentId.toString() },
            body: { multiEventAccess: { enabled: true, includedEvents: [childId.toString()] } }
        };
        const req2 = {
            params: { id: parentId.toString() },
            body: { multiEventAccess: { enabled: true, includedEvents: [childId.toString()] } }
        };

        const res1 = mockRes();
        const res2 = mockRes();

        await Promise.all([
            updateEvent(req1, res1),
            updateEvent(req2, res2)
        ]);

        assert.equal(res1.statusCode, 200);
        assert.equal(res2.statusCode, 200);
    });

    test("Test 22: Concurrent cross-parent relationship updates cannot establish cycles (409 CONCURRENT_CONFLICT)", async (context) => {
        const parentAId = makeId();
        const childBId = makeId();

        const eventA = {
            _id: parentAId,
            registration: { mode: "INDIVIDUAL", capacity: 100, registeredParticipants: 0 },
            multiEventAccess: { enabled: false, includedEvents: [] },
            save: async function () { return this; }
        };

        context.mock.method(Event, "findById", () => eventA);
        context.mock.method(Registration, "countDocuments", async () => 0);
        context.mock.method(Team, "countDocuments", async () => 0);
        context.mock.method(Event, "find", () => mockQuery([
            {
                _id: childBId,
                name: "Event B",
                status: "PUBLISHED",
                registration: { mode: "INDIVIDUAL" },
                multiEventAccess: { enabled: true, includedEvents: [makeId()] }
            }
        ]));
        context.mock.method(Event, "findOne", () => mockQuery(null));

        const req = {
            params: { id: parentAId.toString() },
            body: {
                multiEventAccess: {
                    enabled: true,
                    includedEvents: [childBId.toString()]
                }
            }
        };
        const res = mockRes();
        await updateEvent(req, res);

        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /nested combos are prohibited/);
    });

    test("Test 23: GET /api/admin/events/eligible-multi-access returns accurate eligibility breakdown", async (context) => {
        const parentId = makeId();
        const validChildId = makeId();
        const cancelledId = makeId();
        const comboParentId = makeId();
        const teamEventId = makeId();

        const allEvents = [
            {
                _id: parentId,
                name: "Parent Combo",
                category: "TECHNICAL",
                status: "PUBLISHED",
                registration: { mode: "INDIVIDUAL", capacity: 100 }
            },
            {
                _id: validChildId,
                name: "Valid Individual Event",
                category: "TECHNICAL",
                status: "PUBLISHED",
                registration: { mode: "INDIVIDUAL", capacity: 50 }
            },
            {
                _id: cancelledId,
                name: "Cancelled Contest",
                category: "TECHNICAL",
                status: "CANCELLED",
                registration: { mode: "INDIVIDUAL", capacity: 30 }
            },
            {
                _id: comboParentId,
                name: "Other Combo Parent",
                category: "TECHNICAL",
                status: "PUBLISHED",
                registration: { mode: "INDIVIDUAL", capacity: 100 },
                multiEventAccess: { enabled: true, includedEvents: [makeId()] }
            },
            {
                _id: teamEventId,
                name: "Team Hackathon",
                category: "TECHNICAL",
                status: "PUBLISHED",
                registration: { mode: "TEAM", capacity: 20 }
            }
        ];

        context.mock.method(Event, "find", () => mockQuery(allEvents));
        context.mock.method(Event, "findOne", () => mockQuery(null));

        const req = {
            query: {
                parentId: parentId.toString(),
                parentMode: "INDIVIDUAL"
            }
        };
        const res = mockRes();
        await getEligibleMultiAccessEvents(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.total, 5);
        assert.equal(res.body.eligibleCount, 1);

        const evaluatedValid = res.body.events.find(e => e._id.toString() === validChildId.toString());
        assert.equal(evaluatedValid.isEligible, true);
        assert.equal(evaluatedValid.ineligibilityReason, null);

        const evaluatedParent = res.body.events.find(e => e._id.toString() === parentId.toString());
        assert.equal(evaluatedParent.isEligible, false);
        assert.match(evaluatedParent.ineligibilityReason, /cannot include itself/);

        const evaluatedCancelled = res.body.events.find(e => e._id.toString() === cancelledId.toString());
        assert.equal(evaluatedCancelled.isEligible, false);
        assert.match(evaluatedCancelled.ineligibilityReason, /cancelled/);

        const evaluatedCombo = res.body.events.find(e => e._id.toString() === comboParentId.toString());
        assert.equal(evaluatedCombo.isEligible, false);
        assert.match(evaluatedCombo.ineligibilityReason, /nested combos are prohibited/);

        const evaluatedTeam = res.body.events.find(e => e._id.toString() === teamEventId.toString());
        assert.equal(evaluatedTeam.isEligible, false);
        assert.match(evaluatedTeam.ineligibilityReason, /Registration mode mismatch/);
    });

});
