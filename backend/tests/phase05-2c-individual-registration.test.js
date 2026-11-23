"use strict";

process.env.NODE_ENV = "test";

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Event = require("../models/Event");
const Registration = require("../models/Registration");
const { registerForEvent } = require("../controllers/registrationController");
const { resolveEffectiveAccess } = require("../utils/registrationEntitlement");

const makeId = () => new mongoose.Types.ObjectId();
const ownerId = makeId();

const sampleDetails = () => ({
    fullName: "John Doe",
    mobileNumber: "9876543210",
    collegeName: "Vibrant Institute",
    department: "Computer Science",
    yearOfStudy: "3",
    section: "A",
    rollNumber: "24CS101"
});

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

describe("Phase 05.2C: Individual Registration Entitlement Integration", () => {
    let state;

    beforeEach((context) => {
        state = {
            events: new Map(),
            registrations: [],
            capacityUpdates: new Map(),
            commits: 0,
            aborts: 0,
            duplicate: false,
            full: false
        };

        context.mock.method(console, "error", () => {});

        // Mock transaction session
        context.mock.method(mongoose, "startSession", async () => ({
            withTransaction: async (callback) => {
                try {
                    await callback();
                    state.commits += 1;
                } catch (error) {
                    state.aborts += 1;
                    state.registrations = [];
                    throw error;
                }
            },
            endSession: async () => {}
        }));

        // Mock Event.findById
        context.mock.method(Event, "findById", (id) => ({
            session: async () => state.events.get(id?.toString()) || null
        }));

        // Mock Event.find for included events verification
        context.mock.method(Event, "find", (filter) => ({
            select: () => ({
                session: () => ({
                    lean: async () => {
                        const inIds = filter?._id?.$in || [];
                        return inIds
                            .map(id => state.events.get(id?.toString()))
                            .filter(Boolean);
                    }
                }),
                lean: async () => {
                    const inIds = filter?._id?.$in || [];
                    return inIds
                        .map(id => state.events.get(id?.toString()))
                        .filter(Boolean);
                }
            })
        }));

        // Mock Event.findOneAndUpdate (capacity reservation)
        context.mock.method(Event, "findOneAndUpdate", async (filter, update) => {
            const eventId = filter._id?.toString();
            const event = state.events.get(eventId);
            if (!event) return null;
            if (state.full) return null;

            if (filter.status && filter.status !== event.status) return null;
            if (filter["registration.deadline"] && new Date() >= new Date(event.registration.deadline)) return null;

            // Increment capacity
            const inc = update?.$inc?.["registration.registeredParticipants"] || 0;
            if (inc > 0 && event.registration.registeredParticipants >= event.registration.capacity) {
                return null;
            }
            event.registration.registeredParticipants += inc;
            state.capacityUpdates.set(eventId, (state.capacityUpdates.get(eventId) || 0) + inc);
            return event;
        });

        // Mock Registration.create
        context.mock.method(Registration, "create", async (records) => {
            if (state.duplicate) {
                const err = new Error("Duplicate registration");
                err.code = 11000;
                throw err;
            }
            const documents = records.map(r => new Registration(r));
            for (const doc of documents) {
                await doc.validate();
            }
            state.registrations.push(...documents);
            return documents;
        });

        // Mock Registration.findOne (duplicate check)
        context.mock.method(Registration, "findOne", () => ({
            select: () => ({
                session: async () => state.duplicate ? { _id: makeId() } : null
            })
        }));
    });

    // Helper to create events in test state
    function setupEvent({
        isCombo = false,
        includedEventIds = [],
        mode = "INDIVIDUAL",
        status = "PUBLISHED",
        capacity = 50,
        registeredParticipants = 0,
        fee = 0
    } = {}) {
        const evId = makeId();
        const event = new Event({
            _id: evId,
            name: isCombo ? "Tech Combo Pass" : "Solo Coding",
            description: "Event description",
            category: "TECHNICAL",
            venue: "Auditorium",
            createdBy: ownerId,
            startDate: new Date("2035-11-20T09:00:00.000Z"),
            endDate: new Date("2035-11-20T17:00:00.000Z"),
            status,
            registration: {
                mode,
                deadline: new Date("2035-11-19T23:59:59.000Z"),
                capacity,
                registeredParticipants,
                registrationFee: fee,
                minTeamSize: 1,
                maxTeamSize: 1
            },
            multiEventAccess: {
                enabled: isCombo,
                includedEvents: includedEventIds
            }
        });
        state.events.set(evId.toString(), event);
        return event;
    }

    // 1. Standard individual registration gets SINGLE_EVENT access
    test("1. Standard individual registration gets SINGLE_EVENT access snapshot", async () => {
        const standardEvent = setupEvent();
        const req = {
            params: { id: standardEvent._id.toString() },
            user: { _id: ownerId, role: "PARTICIPANT" },
            body: {
                participantDetails: JSON.stringify(sampleDetails()),
                customResponses: "[]",
                paymentMethod: "NONE"
            }
        };
        const res = mockResponse();

        await registerForEvent(req, res);

        assert.equal(res.statusCode, 201);
        assert.equal(state.registrations.length, 1);
        const created = state.registrations[0];
        assert.ok(created.access);
        assert.equal(created.access.type, "SINGLE_EVENT");
        assert.equal(created.access.eligibleEventIds.length, 1);
        assert.equal(created.access.eligibleEventIds[0].toString(), standardEvent._id.toString());
        assert.ok(created.access.grantedAt instanceof Date);
    });

    // 2. Combo individual registration gets MULTI_EVENT access
    test("2. Combo individual registration gets MULTI_EVENT access snapshot", async () => {
        const child1 = setupEvent();
        const child2 = setupEvent();
        const parentCombo = setupEvent({
            isCombo: true,
            includedEventIds: [child1._id, child2._id]
        });

        const req = {
            params: { id: parentCombo._id.toString() },
            user: { _id: ownerId, role: "PARTICIPANT" },
            body: {
                participantDetails: JSON.stringify(sampleDetails()),
                customResponses: "[]",
                paymentMethod: "NONE"
            }
        };
        const res = mockResponse();

        await registerForEvent(req, res);

        assert.equal(res.statusCode, 201);
        assert.equal(state.registrations.length, 1);
        const created = state.registrations[0];
        assert.ok(created.access);
        assert.equal(created.access.type, "MULTI_EVENT");
        assert.equal(created.access.eligibleEventIds.length, 2);
    });

    // 3. Parent is excluded from combo eligibleEventIds
    test("3. Parent combo ID is excluded from combo eligibleEventIds", async () => {
        const child1 = setupEvent();
        const child2 = setupEvent();
        const parentCombo = setupEvent({
            isCombo: true,
            includedEventIds: [child1._id, child2._id]
        });

        const req = {
            params: { id: parentCombo._id.toString() },
            user: { _id: ownerId, role: "PARTICIPANT" },
            body: {
                participantDetails: JSON.stringify(sampleDetails()),
                customResponses: "[]",
                paymentMethod: "NONE"
            }
        };
        const res = mockResponse();

        await registerForEvent(req, res);

        const created = state.registrations[0];
        const isParentIncluded = created.access.eligibleEventIds.some(
            id => id.toString() === parentCombo._id.toString()
        );
        assert.equal(isParentIncluded, false);
    });

    // 4. Included events are preserved exactly
    test("4. Included events are preserved exactly in the snapshot", async () => {
        const child1 = setupEvent();
        const child2 = setupEvent();
        const parentCombo = setupEvent({
            isCombo: true,
            includedEventIds: [child1._id, child2._id]
        });

        const req = {
            params: { id: parentCombo._id.toString() },
            user: { _id: ownerId, role: "PARTICIPANT" },
            body: {
                participantDetails: JSON.stringify(sampleDetails()),
                customResponses: "[]",
                paymentMethod: "NONE"
            }
        };
        const res = mockResponse();

        await registerForEvent(req, res);

        const created = state.registrations[0];
        const stringIds = created.access.eligibleEventIds.map(id => id.toString());
        assert.ok(stringIds.includes(child1._id.toString()));
        assert.ok(stringIds.includes(child2._id.toString()));
    });

    // 5 & 6. Only parent capacity is incremented; child capacities remain unchanged
    test("5 & 6. Only parent capacity counter is incremented; child capacity counters remain untouched", async () => {
        const child1 = setupEvent({ capacity: 20, registeredParticipants: 5 });
        const child2 = setupEvent({ capacity: 30, registeredParticipants: 10 });
        const parentCombo = setupEvent({
            isCombo: true,
            includedEventIds: [child1._id, child2._id],
            capacity: 100,
            registeredParticipants: 0
        });

        const req = {
            params: { id: parentCombo._id.toString() },
            user: { _id: ownerId, role: "PARTICIPANT" },
            body: {
                participantDetails: JSON.stringify(sampleDetails()),
                customResponses: "[]",
                paymentMethod: "NONE"
            }
        };
        const res = mockResponse();

        await registerForEvent(req, res);

        assert.equal(res.statusCode, 201);
        // Parent capacity incremented by 1
        assert.equal(parentCombo.registration.registeredParticipants, 1);
        assert.equal(state.capacityUpdates.get(parentCombo._id.toString()), 1);

        // Child capacities remain unchanged!
        assert.equal(child1.registration.registeredParticipants, 5);
        assert.equal(child2.registration.registeredParticipants, 10);
        assert.equal(state.capacityUpdates.has(child1._id.toString()), false);
        assert.equal(state.capacityUpdates.has(child2._id.toString()), false);
    });

    // 7. No child Registration documents are created
    test("7. Exactly one Registration document is created (no child registrations)", async () => {
        const child1 = setupEvent();
        const child2 = setupEvent();
        const parentCombo = setupEvent({
            isCombo: true,
            includedEventIds: [child1._id, child2._id]
        });

        const req = {
            params: { id: parentCombo._id.toString() },
            user: { _id: ownerId, role: "PARTICIPANT" },
            body: {
                participantDetails: JSON.stringify(sampleDetails()),
                customResponses: "[]",
                paymentMethod: "NONE"
            }
        };
        const res = mockResponse();

        await registerForEvent(req, res);

        assert.equal(state.registrations.length, 1);
        assert.equal(state.registrations[0].event.toString(), parentCombo._id.toString());
    });

    // 8. Existing QR generator remains unchanged (64-char hex format)
    test("8. Existing QR token generator format is preserved (64-character hex)", async () => {
        const parentCombo = setupEvent({ isCombo: true, includedEventIds: [setupEvent()._id] });
        const req = {
            params: { id: parentCombo._id.toString() },
            user: { _id: ownerId, role: "PARTICIPANT" },
            body: {
                participantDetails: JSON.stringify(sampleDetails()),
                customResponses: "[]",
                paymentMethod: "NONE"
            }
        };
        const res = mockResponse();

        await registerForEvent(req, res);

        const created = state.registrations[0];
        assert.ok(created.qrToken);
        assert.equal(typeof created.qrToken, "string");
        assert.equal(created.qrToken.length, 64);
        assert.match(created.qrToken, /^[a-f0-9]{64}$/);
    });

    // 9. Existing payment logic remains unchanged
    test("9. Payment logic for free events initializes to NOT_REQUIRED", async () => {
        const parentCombo = setupEvent({ isCombo: true, includedEventIds: [setupEvent()._id], fee: 0 });
        const req = {
            params: { id: parentCombo._id.toString() },
            user: { _id: ownerId, role: "PARTICIPANT" },
            body: {
                participantDetails: JSON.stringify(sampleDetails()),
                customResponses: "[]",
                paymentMethod: "NONE"
            }
        };
        const res = mockResponse();

        await registerForEvent(req, res);

        const created = state.registrations[0];
        assert.equal(created.payment.status, "NOT_REQUIRED");
        assert.equal(created.payment.method, "NONE");
    });

    // 10. Duplicate individual registration is still rejected
    test("10. Duplicate registration returns 409 conflict", async () => {
        state.duplicate = true;
        const parentCombo = setupEvent({ isCombo: true, includedEventIds: [setupEvent()._id] });
        const req = {
            params: { id: parentCombo._id.toString() },
            user: { _id: ownerId, role: "PARTICIPANT" },
            body: {
                participantDetails: JSON.stringify(sampleDetails()),
                customResponses: "[]",
                paymentMethod: "NONE"
            }
        };
        const res = mockResponse();

        await registerForEvent(req, res);

        assert.equal(res.statusCode, 409);
        assert.match(res.body.message, /already registered/i);
    });

    // 11. Parent capacity exhaustion is still rejected
    test("11. Parent capacity exhaustion rejects with 409", async () => {
        state.full = true;
        const parentCombo = setupEvent({ isCombo: true, includedEventIds: [setupEvent()._id] });
        const req = {
            params: { id: parentCombo._id.toString() },
            user: { _id: ownerId, role: "PARTICIPANT" },
            body: {
                participantDetails: JSON.stringify(sampleDetails()),
                customResponses: "[]",
                paymentMethod: "NONE"
            }
        };
        const res = mockResponse();

        await registerForEvent(req, res);

        assert.equal(res.statusCode, 409);
        assert.match(res.body.message, /full or registration is closed/i);
    });

    // 12. Invalid combo configuration is rejected
    test("12. Invalid combo with empty includedEvents is rejected with 400", async () => {
        const brokenCombo = setupEvent({ isCombo: true, includedEventIds: [] });
        const req = {
            params: { id: brokenCombo._id.toString() },
            user: { _id: ownerId, role: "PARTICIPANT" },
            body: {
                participantDetails: JSON.stringify(sampleDetails()),
                customResponses: "[]",
                paymentMethod: "NONE"
            }
        };
        const res = mockResponse();

        await registerForEvent(req, res);

        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /not properly configured/i);
    });

    // 13. Cancelled parent is rejected
    test("13. Cancelled parent event is rejected with 400", async () => {
        const cancelledParent = setupEvent({ isCombo: true, includedEventIds: [setupEvent()._id], status: "CANCELLED" });
        const req = {
            params: { id: cancelledParent._id.toString() },
            user: { _id: ownerId, role: "PARTICIPANT" },
            body: {
                participantDetails: JSON.stringify(sampleDetails()),
                customResponses: "[]",
                paymentMethod: "NONE"
            }
        };
        const res = mockResponse();

        await registerForEvent(req, res);

        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /not available for registration/i);
    });

    // 14. Parent deadline rules are preserved
    test("14. Expired parent deadline is rejected with 400", async () => {
        const expiredParent = setupEvent({ isCombo: true, includedEventIds: [setupEvent()._id] });
        expiredParent.registration.deadline = new Date("2020-01-01T00:00:00.000Z"); // past date
        const req = {
            params: { id: expiredParent._id.toString() },
            user: { _id: ownerId, role: "PARTICIPANT" },
            body: {
                participantDetails: JSON.stringify(sampleDetails()),
                customResponses: "[]",
                paymentMethod: "NONE"
            }
        };
        const res = mockResponse();

        await registerForEvent(req, res);

        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /deadline has passed/i);
    });

    // 15. Existing legacy registrations remain unchanged
    test("15. Existing legacy registrations resolve correctly with legacy resolver", () => {
        const legacyEventId = makeId();
        const legacyDoc = {
            _id: makeId(),
            event: legacyEventId,
            createdAt: new Date("2026-11-10T12:00:00.000Z"),
            status: "REGISTERED"
            // access is undefined
        };

        const resolved = resolveEffectiveAccess(legacyDoc);
        assert.equal(resolved.type, "SINGLE_EVENT");
        assert.equal(resolved.eligibleEventIds[0].toString(), legacyEventId.toString());
        assert.equal(resolved.isLegacy, true);
    });

    // 16. Existing registration response contract is preserved
    test("16. Registration response contract maintains expected keys", async () => {
        const parentCombo = setupEvent({ isCombo: true, includedEventIds: [setupEvent()._id] });
        const req = {
            params: { id: parentCombo._id.toString() },
            user: { _id: ownerId, role: "PARTICIPANT" },
            body: {
                participantDetails: JSON.stringify(sampleDetails()),
                customResponses: "[]",
                paymentMethod: "NONE"
            }
        };
        const res = mockResponse();

        await registerForEvent(req, res);

        assert.equal(res.statusCode, 201);
        assert.equal(res.body.success, true);
        assert.equal(res.body.message, "Registration successful");
        assert.ok(res.body.registration._id);
        assert.equal(res.body.registration.status, "REGISTERED");
        assert.ok(res.body.registration.payment);
        assert.equal(res.body.registration.payment.method, "NONE");
        assert.equal(res.body.registration.payment.status, "NOT_REQUIRED");
    });

    // 17. Explicit-null access handling is correct
    test("17. Explicit-null access handling throws INVALID_REGISTRATION_ACCESS", () => {
        const nullDoc = { event: makeId(), access: null };
        assert.throws(
            () => resolveEffectiveAccess(nullDoc),
            (err) => {
                assert.equal(err.code, "INVALID_REGISTRATION_ACCESS");
                return true;
            }
        );
    });

    // 18. Registration creation is atomic with snapshot persistence
    test("18. Registration document contains persisted access snapshot upon commit", async () => {
        const child1 = setupEvent();
        const parentCombo = setupEvent({ isCombo: true, includedEventIds: [child1._id] });
        const req = {
            params: { id: parentCombo._id.toString() },
            user: { _id: ownerId, role: "PARTICIPANT" },
            body: {
                participantDetails: JSON.stringify(sampleDetails()),
                customResponses: "[]",
                paymentMethod: "NONE"
            }
        };
        const res = mockResponse();

        await registerForEvent(req, res);

        assert.equal(state.commits, 1);
        const saved = state.registrations[0];
        assert.equal(saved.access.type, "MULTI_EVENT");
        assert.equal(saved.access.eligibleEventIds[0].toString(), child1._id.toString());
    });

    // 19. Transaction failure does not persist partial changes
    test("19. Transaction failure does not persist partial changes", async () => {
        const parentCombo = setupEvent({ isCombo: true, includedEventIds: [setupEvent()._id] });
        state.duplicate = true; // triggers error inside transaction
        const req = {
            params: { id: parentCombo._id.toString() },
            user: { _id: ownerId, role: "PARTICIPANT" },
            body: {
                participantDetails: JSON.stringify(sampleDetails()),
                customResponses: "[]",
                paymentMethod: "NONE"
            }
        };
        const res = mockResponse();

        await registerForEvent(req, res);

        assert.equal(state.aborts, 1);
        assert.equal(state.registrations.length, 0);
    });

    // 20. No unrelated controller behavior is changed
    test("20. Non-combo individual registration preserves all standard single-event behaviors", async () => {
        const standardEvent = setupEvent({ fee: 0 });
        const req = {
            params: { id: standardEvent._id.toString() },
            user: { _id: ownerId, role: "PARTICIPANT" },
            body: {
                participantDetails: JSON.stringify(sampleDetails()),
                customResponses: "[]",
                paymentMethod: "NONE"
            }
        };
        const res = mockResponse();

        await registerForEvent(req, res);

        assert.equal(res.statusCode, 201);
        assert.equal(state.registrations.length, 1);
        const reg = state.registrations[0];
        assert.equal(reg.access.type, "SINGLE_EVENT");
        assert.equal(reg.event.toString(), standardEvent._id.toString());
        assert.equal(reg.access.eligibleEventIds[0].toString(), standardEvent._id.toString());
    });
});
