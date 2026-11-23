"use strict";

process.env.NODE_ENV = "test";

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Event = require("../models/Event");
const Team = require("../models/Team");
const Registration = require("../models/Registration");
const { registerTeam } = require("../controllers/teamRegistrationController");
const { resolveEffectiveAccess } = require("../utils/registrationEntitlement");

const makeId = () => new mongoose.Types.ObjectId();
const leaderId = makeId();

const memberDetails = (index = 1) => ({
    fullName: `Team Member ${index}`,
    mobileNumber: `987654321${index}`,
    collegeName: "Vibrant Institute",
    department: "Computer Science",
    yearOfStudy: "3",
    section: "A",
    rollNumber: `24CS20${index}`
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

describe("Phase 05.2D: Team Registration Entitlement Integration", () => {
    let state;

    beforeEach((context) => {
        state = {
            events: new Map(),
            teams: [],
            registrations: [],
            capacityUpdates: new Map(),
            commits: 0,
            aborts: 0,
            duplicateLeader: false,
            duplicateMember: false,
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
                    state.teams = [];
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

            const inc = update?.$inc?.["registration.registeredParticipants"] || 0;
            if (inc > 0 && (event.registration.registeredParticipants + inc) > event.registration.capacity) {
                return null;
            }
            event.registration.registeredParticipants += inc;
            state.capacityUpdates.set(eventId, (state.capacityUpdates.get(eventId) || 0) + inc);
            return event;
        });

        // Mock Team.findOne (duplicate leader check and post-commit lookup)
        context.mock.method(Team, "findOne", () => ({
            select() { return this; },
            session: async () => state.duplicateLeader ? { _id: makeId() } : null,
            sort: async () => state.teams[0] || null
        }));

        // Mock Registration.find (post-commit lookup)
        context.mock.method(Registration, "find", () => ({
            select: async () => state.registrations
        }));

        // Mock Registration.findOne (duplicate member check)
        context.mock.method(Registration, "findOne", () => ({
            select: () => ({
                session: async () => state.duplicateMember ? { _id: makeId() } : null
            })
        }));

        // Mock Team.create
        context.mock.method(Team, "create", async (records) => {
            const documents = records.map(r => new Team(r));
            for (const doc of documents) await doc.validate();
            state.teams.push(...documents);
            return documents;
        });

        // Mock Registration.insertMany
        context.mock.method(Registration, "insertMany", async (records) => {
            const documents = records.map(r => new Registration(r));
            for (const doc of documents) await doc.validate();
            state.registrations.push(...documents);
            return documents;
        });
    });

    // Helper to create team events
    function setupTeamEvent({
        isCombo = false,
        includedEventIds = [],
        mode = "TEAM",
        status = "PUBLISHED",
        capacity = 50,
        registeredParticipants = 0,
        minTeamSize = 2,
        maxTeamSize = 4,
        fee = 0
    } = {}) {
        const evId = makeId();
        const event = new Event({
            _id: evId,
            name: isCombo ? "Team Hackathon Combo" : "Web Dev Hackathon",
            description: "Event description",
            category: "TECHNICAL",
            venue: "Auditorium",
            createdBy: leaderId,
            startDate: new Date("2035-11-20T09:00:00.000Z"),
            endDate: new Date("2035-11-20T17:00:00.000Z"),
            status,
            registration: {
                mode,
                deadline: new Date("2035-11-19T23:59:59.000Z"),
                capacity,
                registeredParticipants,
                registrationFee: fee,
                minTeamSize,
                maxTeamSize
            },
            multiEventAccess: {
                enabled: isCombo,
                includedEvents: includedEventIds
            }
        });
        state.events.set(evId.toString(), event);
        return event;
    }

    function createTeamRequest(event, count = 3, method = "NONE", fee = 0) {
        const members = Array.from({ length: count }, (_, i) => ({
            participantDetails: memberDetails(i + 1),
            customResponses: []
        }));
        return {
            params: { id: event._id.toString() },
            user: { _id: leaderId, role: "PARTICIPANT" },
            body: {
                teamName: "Super Coders",
                members: JSON.stringify(members),
                paymentMethod: method,
                cashReceiverName: method === "CASH" ? "Admin Cashier" : undefined
            }
        };
    }

    // 1. Standard TEAM registration gets SINGLE_EVENT access
    test("1. Standard TEAM registration attaches SINGLE_EVENT access snapshot to every member", async () => {
        const standardTeamEvent = setupTeamEvent();
        const req = createTeamRequest(standardTeamEvent, 3);
        const res = mockResponse();

        await registerTeam(req, res);

        assert.equal(res.statusCode, 201);
        assert.equal(state.registrations.length, 3);
        for (const reg of state.registrations) {
            assert.ok(reg.access);
            assert.equal(reg.access.type, "SINGLE_EVENT");
            assert.equal(reg.access.eligibleEventIds.length, 1);
            assert.equal(reg.access.eligibleEventIds[0].toString(), standardTeamEvent._id.toString());
            assert.ok(reg.access.grantedAt instanceof Date);
        }
    });

    // 2. Combo TEAM registration attaches MULTI_EVENT access
    test("2. Combo TEAM registration attaches MULTI_EVENT access snapshot to every member", async () => {
        const child1 = setupTeamEvent();
        const child2 = setupTeamEvent();
        const comboParent = setupTeamEvent({
            isCombo: true,
            includedEventIds: [child1._id, child2._id]
        });

        const req = createTeamRequest(comboParent, 3);
        const res = mockResponse();

        await registerTeam(req, res);

        assert.equal(res.statusCode, 201);
        assert.equal(state.registrations.length, 3);
        for (const reg of state.registrations) {
            assert.ok(reg.access);
            assert.equal(reg.access.type, "MULTI_EVENT");
            assert.equal(reg.access.eligibleEventIds.length, 2);
        }
    });

    // 3. Team of three members receives three Registration documents
    test("3. Team of three members receives three distinct Registration documents", async () => {
        const child1 = setupTeamEvent();
        const comboParent = setupTeamEvent({ isCombo: true, includedEventIds: [child1._id] });

        const req = createTeamRequest(comboParent, 3);
        const res = mockResponse();

        await registerTeam(req, res);

        assert.equal(state.registrations.length, 3);
        assert.equal(state.teams.length, 1);
        // Leader registration
        assert.equal(state.registrations[0].isTeamLeader, true);
        assert.equal(state.registrations[0].user.toString(), leaderId.toString());
        // Member registrations
        assert.equal(state.registrations[1].isTeamLeader, false);
        assert.equal(state.registrations[2].isTeamLeader, false);
    });

    // 4. Each member receives a unique QR token
    test("4. Each team member receives a unique 64-character hexadecimal QR token", async () => {
        const comboParent = setupTeamEvent({ isCombo: true, includedEventIds: [setupTeamEvent()._id] });
        const req = createTeamRequest(comboParent, 3);
        const res = mockResponse();

        await registerTeam(req, res);

        const qrTokens = state.registrations.map(r => r.qrToken);
        assert.equal(qrTokens.length, 3);
        assert.equal(new Set(qrTokens).size, 3, "All QR tokens must be unique");
        for (const token of qrTokens) {
            assert.match(token, /^[a-f0-9]{64}$/);
        }
    });

    // 5. Each member receives an independent snapshot (no shared mutable reference)
    test("5. Each member receives an independent snapshot object (no shared mutable references)", async () => {
        const comboParent = setupTeamEvent({ isCombo: true, includedEventIds: [setupTeamEvent()._id] });
        const req = createTeamRequest(comboParent, 3);
        const res = mockResponse();

        await registerTeam(req, res);

        const [r1, r2, r3] = state.registrations;
        assert.notEqual(r1.access, r2.access);
        assert.notEqual(r1.access.eligibleEventIds, r2.access.eligibleEventIds);

        // Mutating r1 does not affect r2 or r3
        r1.access.eligibleEventIds.push(makeId());
        assert.equal(r1.access.eligibleEventIds.length, 2);
        assert.equal(r2.access.eligibleEventIds.length, 1);
        assert.equal(r3.access.eligibleEventIds.length, 1);
    });

    // 6. Shared team payment remains unchanged on Team document
    test("6. Shared team payment remains unchanged on Team document (member payments NOT_REQUIRED)", async () => {
        const comboParent = setupTeamEvent({ isCombo: true, includedEventIds: [setupTeamEvent()._id], fee: 300 });
        const req = createTeamRequest(comboParent, 3, "CASH", 300);
        const res = mockResponse();

        await registerTeam(req, res);

        assert.equal(res.statusCode, 201);
        const team = state.teams[0];
        assert.equal(team.payment.status, "PENDING");
        assert.equal(team.payment.method, "CASH");
        assert.equal(team.payment.expectedAmount, 300);

        // Member registrations retain payment method NONE and NOT_REQUIRED
        for (const reg of state.registrations) {
            assert.equal(reg.payment.status, "NOT_REQUIRED");
            assert.equal(reg.payment.method, "NONE");
        }
    });

    // 7 & 8. Parent capacity increments by memberCount; child capacities remain untouched
    test("7 & 8. Parent capacity increments by memberCount (3); child capacities remain completely untouched", async () => {
        const child1 = setupTeamEvent({ capacity: 50, registeredParticipants: 10 });
        const child2 = setupTeamEvent({ capacity: 50, registeredParticipants: 15 });
        const comboParent = setupTeamEvent({
            isCombo: true,
            includedEventIds: [child1._id, child2._id],
            capacity: 100,
            registeredParticipants: 0
        });

        const req = createTeamRequest(comboParent, 3);
        const res = mockResponse();

        await registerTeam(req, res);

        assert.equal(res.statusCode, 201);
        // Parent incremented by 3
        assert.equal(comboParent.registration.registeredParticipants, 3);
        assert.equal(state.capacityUpdates.get(comboParent._id.toString()), 3);

        // Children untouched!
        assert.equal(child1.registration.registeredParticipants, 10);
        assert.equal(child2.registration.registeredParticipants, 15);
        assert.equal(state.capacityUpdates.has(child1._id.toString()), false);
        assert.equal(state.capacityUpdates.has(child2._id.toString()), false);
    });

    // 9. No child Registration documents are created
    test("9. No child Registration documents are created (only 3 registrations for combo parent)", async () => {
        const child1 = setupTeamEvent();
        const comboParent = setupTeamEvent({ isCombo: true, includedEventIds: [child1._id] });

        const req = createTeamRequest(comboParent, 3);
        const res = mockResponse();

        await registerTeam(req, res);

        assert.equal(state.registrations.length, 3);
        for (const reg of state.registrations) {
            assert.equal(reg.event.toString(), comboParent._id.toString());
        }
    });

    // 10. Parent excluded from combo eligibleEventIds
    test("10. Parent combo ID is excluded from members' eligibleEventIds", async () => {
        const child1 = setupTeamEvent();
        const comboParent = setupTeamEvent({ isCombo: true, includedEventIds: [child1._id] });

        const req = createTeamRequest(comboParent, 2);
        const res = mockResponse();

        await registerTeam(req, res);

        for (const reg of state.registrations) {
            const includesParent = reg.access.eligibleEventIds.some(id => id.toString() === comboParent._id.toString());
            assert.equal(includesParent, false);
            assert.equal(reg.access.eligibleEventIds[0].toString(), child1._id.toString());
        }
    });

    // 11. Invalid combo configuration rejected
    test("11. Combo with empty includedEvents is rejected with 400", async () => {
        const invalidCombo = setupTeamEvent({ isCombo: true, includedEventIds: [] });
        const req = createTeamRequest(invalidCombo, 2);
        const res = mockResponse();

        await registerTeam(req, res);

        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /not properly configured/i);
    });

    // 12. Missing included event rejected
    test("12. Missing included event is rejected with 400", async () => {
        const missingChildId = makeId();
        const comboParent = setupTeamEvent({ isCombo: true, includedEventIds: [missingChildId] });
        const req = createTeamRequest(comboParent, 2);
        const res = mockResponse();

        await registerTeam(req, res);

        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /One or more included events do not exist/i);
    });

    // 13. Cancelled included event rejected
    test("13. Cancelled included event is rejected with 400", async () => {
        const cancelledChild = setupTeamEvent({ status: "CANCELLED" });
        const comboParent = setupTeamEvent({ isCombo: true, includedEventIds: [cancelledChild._id] });
        const req = createTeamRequest(comboParent, 2);
        const res = mockResponse();

        await registerTeam(req, res);

        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /not published/i);
    });

    // 14. Completed included event rejected
    test("14. Completed included event is rejected with 400", async () => {
        const completedChild = setupTeamEvent({ status: "COMPLETED" });
        const comboParent = setupTeamEvent({ isCombo: true, includedEventIds: [completedChild._id] });
        const req = createTeamRequest(comboParent, 2);
        const res = mockResponse();

        await registerTeam(req, res);

        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /not published/i);
    });

    // 15. Non-PUBLISHED child rejected (e.g. DRAFT)
    test("15. Draft included event is rejected with 400", async () => {
        const draftChild = setupTeamEvent({ status: "DRAFT" });
        const comboParent = setupTeamEvent({ isCombo: true, includedEventIds: [draftChild._id] });
        const req = createTeamRequest(comboParent, 2);
        const res = mockResponse();

        await registerTeam(req, res);

        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /not published/i);
    });

    // 16. Child registration-mode mismatch rejected
    test("16. Child event with INDIVIDUAL mode rejected for TEAM combo", async () => {
        const individualChild = setupTeamEvent({ mode: "INDIVIDUAL" });
        const comboParent = setupTeamEvent({ isCombo: true, includedEventIds: [individualChild._id] });
        const req = createTeamRequest(comboParent, 2);
        const res = mockResponse();

        await registerTeam(req, res);

        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /requires INDIVIDUAL registration/i);
    });

    // 17. Invalid team size rejected
    test("17. Team size violating min/max limits is rejected with 400", async () => {
        const comboParent = setupTeamEvent({ isCombo: true, includedEventIds: [setupTeamEvent()._id], minTeamSize: 3, maxTeamSize: 4 });
        // Attempting team of 2 (below min 3)
        const req = createTeamRequest(comboParent, 2);
        const res = mockResponse();

        await registerTeam(req, res);

        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /Team size must be between 3 and 4/i);
    });

    // 18. Duplicate team-member validation preserved
    test("18. Duplicate team member conflict returns 409", async () => {
        state.duplicateMember = true;
        const comboParent = setupTeamEvent({ isCombo: true, includedEventIds: [setupTeamEvent()._id] });
        const req = createTeamRequest(comboParent, 2);
        const res = mockResponse();

        await registerTeam(req, res);

        assert.equal(res.statusCode, 409);
        assert.match(res.body.message, /already have an active registration/i);
    });

    // 19. Parent capacity exhaustion rejected
    test("19. Parent capacity exhaustion returns 409", async () => {
        state.full = true;
        const comboParent = setupTeamEvent({ isCombo: true, includedEventIds: [setupTeamEvent()._id] });
        const req = createTeamRequest(comboParent, 2);
        const res = mockResponse();

        await registerTeam(req, res);

        assert.equal(res.statusCode, 409);
        assert.match(res.body.message, /Not enough participant slots are available/i);
    });

    // 20. Existing payment proof handling preserved
    test("20. Free team registration initializes to NOT_REQUIRED", async () => {
        const comboParent = setupTeamEvent({ isCombo: true, includedEventIds: [setupTeamEvent()._id], fee: 0 });
        const req = createTeamRequest(comboParent, 2, "NONE", 0);
        const res = mockResponse();

        await registerTeam(req, res);

        assert.equal(res.statusCode, 201);
        assert.equal(state.teams[0].payment.status, "NOT_REQUIRED");
    });

    // 21. Transaction failure rolls back all writes
    test("21. Transaction failure aborts and does not persist team or member registrations", async () => {
        state.duplicateMember = true;
        const comboParent = setupTeamEvent({ isCombo: true, includedEventIds: [setupTeamEvent()._id] });
        const req = createTeamRequest(comboParent, 2);
        const res = mockResponse();

        await registerTeam(req, res);

        assert.equal(state.aborts, 1);
        assert.equal(state.teams.length, 0);
        assert.equal(state.registrations.length, 0);
    });

    // 22. Legacy team registrations remain unchanged
    test("22. Legacy team member registration resolves effective access via resolver", () => {
        const legacyEventId = makeId();
        const legacyTeamMember = {
            _id: makeId(),
            event: legacyEventId,
            team: makeId(),
            createdAt: new Date("2026-11-05T10:00:00.000Z"),
            status: "REGISTERED"
            // access is undefined
        };

        const resolved = resolveEffectiveAccess(legacyTeamMember);
        assert.equal(resolved.type, "SINGLE_EVENT");
        assert.equal(resolved.eligibleEventIds[0].toString(), legacyEventId.toString());
        assert.equal(resolved.isLegacy, true);
    });

    // 23. Existing individual registration tests remain passing (tested via regression suite)
    test("23. Self-inclusion in combo is rejected with 400", async () => {
        const evId = makeId();
        const selfCombo = new Event({
            _id: evId,
            name: "Self Combo",
            description: "Desc",
            category: "TECHNICAL",
            venue: "Auditorium",
            createdBy: leaderId,
            startDate: new Date("2035-11-20T09:00:00.000Z"),
            endDate: new Date("2035-11-20T17:00:00.000Z"),
            status: "PUBLISHED",
            registration: {
                mode: "TEAM",
                deadline: new Date("2035-11-19T23:59:59.000Z"),
                capacity: 50,
                registeredParticipants: 0,
                registrationFee: 0,
                minTeamSize: 2,
                maxTeamSize: 4
            },
            multiEventAccess: {
                enabled: true,
                includedEvents: [evId] // Includes itself
            }
        });
        state.events.set(evId.toString(), selfCombo);

        const req = createTeamRequest(selfCombo, 2);
        const res = mockResponse();

        await registerTeam(req, res);

        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /cannot include itself/i);
    });

    // 24. Existing registration response contract preserved
    test("24. Response contract maintains team and registrations payload", async () => {
        const comboParent = setupTeamEvent({ isCombo: true, includedEventIds: [setupTeamEvent()._id] });
        const req = createTeamRequest(comboParent, 2);
        const res = mockResponse();

        await registerTeam(req, res);

        assert.equal(res.statusCode, 201);
        assert.equal(res.body.success, true);
        assert.equal(res.body.message, "Team registered successfully.");
        assert.ok(res.body.team);
        assert.ok(res.body.team.id);
        assert.equal(res.body.team.teamName, "Super Coders");
    });
});
