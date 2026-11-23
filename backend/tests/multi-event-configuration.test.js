const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Event = require("../models/Event");
const Registration = require("../models/Registration");
const Team = require("../models/Team");
const { validateMultiEventAccess, DEFAULT_MAX_INCLUDED_EVENTS } = require("../utils/validateMultiEventAccess");

// Helper to create valid MongoDB ObjectIds for testing
const makeId = () => new mongoose.Types.ObjectId();

// Mock EventModel factory to simulate MongoDB query responses without network or live database
function createMockEventModel(events = []) {
    return {
        find: (query) => ({
            select: () => ({
                lean: async () => {
                    if (query._id && query._id.$in) {
                        const inHexes = query._id.$in.map(id => id.toString());
                        return events.filter(e => inHexes.includes(e._id.toString()));
                    }
                    return events;
                }
            })
        }),
        findOne: (query) => ({
            select: () => ({
                lean: async () => {
                    // Check if parent is a child of another combo
                    if (query["multiEventAccess.includedEvents"]) {
                        const targetChildId = query["multiEventAccess.includedEvents"].toString();
                        const excludedParentId = query._id?.$ne ? query._id.$ne.toString() : null;
                        const match = events.find(e =>
                            e.multiEventAccess?.enabled === true &&
                            e.multiEventAccess?.includedEvents?.some(childId => childId.toString() === targetChildId) &&
                            (!excludedParentId || e._id.toString() !== excludedParentId)
                        );
                        return match || null;
                    }
                    return null;
                }
            })
        })
    };
}

describe("Multi-Event Access — Phase 01: Schema & Validation Engine", () => {

    // Test 1 — Legacy Event document with missing configuration
    it("Test 1: Legacy Event document with missing configuration defaults to disabled with empty includedEvents", () => {
        const legacyData = {
            name: "Legacy Coding Contest",
            description: "A traditional single event from earlier VIBRANT editions",
            category: "TECHNICAL",
            venue: "Lab 3",
            startDate: new Date("2026-11-28T10:00:00Z"),
            endDate: new Date("2026-11-28T16:00:00Z"),
            registration: {
                mode: "INDIVIDUAL",
                deadline: new Date("2026-11-27T23:59:00Z"),
                capacity: 100,
                registrationFee: 150
            },
            createdBy: makeId()
        };

        const event = new Event(legacyData);

        assert.equal(event.multiEventAccess.enabled, false);
        assert.deepEqual(event.multiEventAccess.includedEvents, []);
    });

    // Test 2 — Default disabled configuration
    it("Test 2: Default disabled configuration validation produces canonical disabled object", async () => {
        const res1 = await validateMultiEventAccess(undefined);
        assert.equal(res1.isValid, true);
        assert.equal(res1.value.enabled, false);
        assert.deepEqual(res1.value.includedEvents, []);

        const res2 = await validateMultiEventAccess(null);
        assert.equal(res2.isValid, true);
        assert.equal(res2.value.enabled, false);
        assert.deepEqual(res2.value.includedEvents, []);

        const res3 = await validateMultiEventAccess({ enabled: false });
        assert.equal(res3.isValid, true);
        assert.equal(res3.value.enabled, false);
        assert.deepEqual(res3.value.includedEvents, []);
    });

    // Test 3 — Valid enabled configuration
    it("Test 3: Valid enabled configuration succeeds and normalizes child ObjectIds", async () => {
        const child1 = { _id: makeId(), name: "Child 1", status: "PUBLISHED", registration: { mode: "INDIVIDUAL" } };
        const child2 = { _id: makeId(), name: "Child 2", status: "PUBLISHED", registration: { mode: "INDIVIDUAL" } };
        const mockModel = createMockEventModel([child1, child2]);

        const result = await validateMultiEventAccess(
            {
                enabled: true,
                includedEvents: [child1._id.toString(), child2._id.toString()]
            },
            {
                parentMode: "INDIVIDUAL",
                EventModel: mockModel
            }
        );

        assert.equal(result.isValid, true);
        assert.equal(result.value.enabled, true);
        assert.equal(result.value.includedEvents.length, 2);
        assert.ok(result.value.includedEvents[0] instanceof mongoose.Types.ObjectId);
        assert.equal(result.value.includedEvents[0].toString(), child1._id.toString());
        assert.equal(result.value.includedEvents[1].toString(), child2._id.toString());
    });

    // Test 4 — Empty included events while enabled
    it("Test 4: Empty included events while enabled is rejected (Rule 3 minimum inclusion)", async () => {
        const result = await validateMultiEventAccess({
            enabled: true,
            includedEvents: []
        });

        assert.equal(result.isValid, false);
        assert.match(result.error, /At least one included event is required/i);
    });

    // Test 5 — Invalid Boolean flag
    it("Test 5: Non-boolean enabled flags (strings, numbers, truthy values) are rejected without coercion", async () => {
        const stringFlag = await validateMultiEventAccess({ enabled: "true", includedEvents: [makeId().toString()] });
        assert.equal(stringFlag.isValid, false);
        assert.match(stringFlag.error, /multiEventAccess\.enabled must be a boolean/i);

        const numberFlag = await validateMultiEventAccess({ enabled: 1, includedEvents: [makeId().toString()] });
        assert.equal(numberFlag.isValid, false);
        assert.match(numberFlag.error, /multiEventAccess\.enabled must be a boolean/i);
    });

    // Test 6 — Invalid ObjectId
    it("Test 6: Malformed or non-ObjectId hex strings in includedEvents are rejected", async () => {
        const result = await validateMultiEventAccess({
            enabled: true,
            includedEvents: ["invalid-hex-id-12345"]
        });

        assert.equal(result.isValid, false);
        assert.match(result.error, /Invalid event ID in includedEvents at index 0/i);
    });

    // Test 7 — Duplicate IDs
    it("Test 7: Duplicate event IDs in includedEvents are rejected without silent deduplication", async () => {
        const id = makeId();
        const result = await validateMultiEventAccess({
            enabled: true,
            includedEvents: [id.toString(), id.toString()]
        });

        assert.equal(result.isValid, false);
        assert.match(result.error, /Duplicate event ID found in includedEvents/i);
    });

    // Test 8 — Self inclusion
    it("Test 8: Parent event cannot include itself in includedEvents", async () => {
        const parentId = makeId();
        const otherId = makeId();

        const result = await validateMultiEventAccess(
            {
                enabled: true,
                includedEvents: [parentId.toString(), otherId.toString()]
            },
            {
                parentId
            }
        );

        assert.equal(result.isValid, false);
        assert.match(result.error, /A parent event cannot include itself/i);
    });

    // Test 9 — Nonexistent included event
    it("Test 9: Included events missing from the database are rejected with referential integrity error", async () => {
        const existingChild = { _id: makeId(), name: "Real Event", status: "PUBLISHED", registration: { mode: "INDIVIDUAL" } };
        const missingId = makeId();
        const mockModel = createMockEventModel([existingChild]);

        const result = await validateMultiEventAccess(
            {
                enabled: true,
                includedEvents: [existingChild._id.toString(), missingId.toString()]
            },
            {
                EventModel: mockModel
            }
        );

        assert.equal(result.isValid, false);
        assert.match(result.error, /One or more included events do not exist/i);
        assert.ok(result.error.includes(missingId.toString()));
    });

    // Test 10 — Cancelled child event
    it("Test 10: Cancelled child events cannot be included in multi-event access", async () => {
        const cancelledChild = { _id: makeId(), name: "Cancelled Contest", status: "CANCELLED", registration: { mode: "INDIVIDUAL" } };
        const mockModel = createMockEventModel([cancelledChild]);

        const result = await validateMultiEventAccess(
            {
                enabled: true,
                includedEvents: [cancelledChild._id.toString()]
            },
            {
                EventModel: mockModel
            }
        );

        assert.equal(result.isValid, false);
        assert.match(result.error, /Cannot include cancelled event/i);
    });

    // Test 11 — Completed child event
    it("Test 11: Completed child events cannot be included in multi-event access", async () => {
        const completedChild = { _id: makeId(), name: "Past Workshop", status: "COMPLETED", registration: { mode: "INDIVIDUAL" } };
        const mockModel = createMockEventModel([completedChild]);

        const result = await validateMultiEventAccess(
            {
                enabled: true,
                includedEvents: [completedChild._id.toString()]
            },
            {
                EventModel: mockModel
            }
        );

        assert.equal(result.isValid, false);
        assert.match(result.error, /Cannot include completed event/i);
    });

    // Test 12 — Included child that is already a combo parent (No nesting)
    it("Test 12: Included child that is already a combo parent is rejected (No nesting / combos in combos)", async () => {
        const nestedCombo = {
            _id: makeId(),
            name: "Mini Combo",
            status: "PUBLISHED",
            registration: { mode: "INDIVIDUAL" },
            multiEventAccess: { enabled: true, includedEvents: [makeId()] }
        };
        const mockModel = createMockEventModel([nestedCombo]);

        const result = await validateMultiEventAccess(
            {
                enabled: true,
                includedEvents: [nestedCombo._id.toString()]
            },
            {
                EventModel: mockModel
            }
        );

        assert.equal(result.isValid, false);
        assert.match(result.error, /already a multi-event parent \(nested combos are prohibited\)/i);
    });

    // Test 13 — Parent that is already a child of another combo
    it("Test 13: An event that is already an included child of another combo cannot become a multi-event parent", async () => {
        const parentId = makeId();
        const existingParentCombo = {
            _id: makeId(),
            name: "Mega Fest Pass",
            status: "PUBLISHED",
            multiEventAccess: {
                enabled: true,
                includedEvents: [parentId] // parentId is already a child of Mega Fest Pass
            }
        };

        const standardChild = { _id: makeId(), name: "Workshop B", status: "PUBLISHED", registration: { mode: "INDIVIDUAL" } };
        const mockModel = createMockEventModel([existingParentCombo, standardChild]);

        const result = await validateMultiEventAccess(
            {
                enabled: true,
                includedEvents: [standardChild._id.toString()]
            },
            {
                parentId,
                parentMode: "INDIVIDUAL",
                EventModel: mockModel
            }
        );

        assert.equal(result.isValid, false);
        assert.match(result.error, /already an included child of parent event/i);
    });

    // Test 14 — Valid shared child among multiple parent combos
    it("Test 14: An ordinary child event can be shared among multiple distinct parent combos", async () => {
        const sharedChild = { _id: makeId(), name: "Keynote Talk", status: "PUBLISHED", registration: { mode: "INDIVIDUAL" } };
        const mockModel = createMockEventModel([sharedChild]);

        // Combo 1 includes sharedChild
        const combo1Result = await validateMultiEventAccess(
            {
                enabled: true,
                includedEvents: [sharedChild._id.toString()]
            },
            {
                parentId: makeId(),
                parentMode: "INDIVIDUAL",
                EventModel: mockModel
            }
        );
        assert.equal(combo1Result.isValid, true);

        // Combo 2 also includes sharedChild
        const combo2Result = await validateMultiEventAccess(
            {
                enabled: true,
                includedEvents: [sharedChild._id.toString()]
            },
            {
                parentId: makeId(),
                parentMode: "INDIVIDUAL",
                EventModel: mockModel
            }
        );
        assert.equal(combo2Result.isValid, true);
    });

    // Test 15 — Registration mode mismatch
    it("Test 15: Registration mode mismatch between parent and child is rejected", async () => {
        const teamChild = { _id: makeId(), name: "Team Hackathon", status: "PUBLISHED", registration: { mode: "TEAM" } };
        const mockModel = createMockEventModel([teamChild]);

        const result = await validateMultiEventAccess(
            {
                enabled: true,
                includedEvents: [teamChild._id.toString()]
            },
            {
                parentMode: "INDIVIDUAL",
                EventModel: mockModel
            }
        );

        assert.equal(result.isValid, false);
        assert.match(result.error, /Registration mode mismatch: Parent event is INDIVIDUAL, but included event "Team Hackathon" is TEAM/i);
    });

    // Test 16 — Valid INDIVIDUAL configuration
    it("Test 16: Valid INDIVIDUAL parent with INDIVIDUAL children passes validation", async () => {
        const ind1 = { _id: makeId(), name: "Coding", status: "PUBLISHED", registration: { mode: "INDIVIDUAL" } };
        const ind2 = { _id: makeId(), name: "Web Dev", status: "PUBLISHED", registration: { mode: "INDIVIDUAL" } };
        const mockModel = createMockEventModel([ind1, ind2]);

        const result = await validateMultiEventAccess(
            {
                enabled: true,
                includedEvents: [ind1._id.toString(), ind2._id.toString()]
            },
            {
                parentMode: "INDIVIDUAL",
                EventModel: mockModel
            }
        );

        assert.equal(result.isValid, true);
        assert.equal(result.value.enabled, true);
        assert.equal(result.value.includedEvents.length, 2);
    });

    // Test 17 — Valid TEAM configuration
    it("Test 17: Valid TEAM parent with TEAM children passes validation", async () => {
        const team1 = { _id: makeId(), name: "Robo Wars", status: "PUBLISHED", registration: { mode: "TEAM" } };
        const team2 = { _id: makeId(), name: "Treasure Hunt", status: "PUBLISHED", registration: { mode: "TEAM" } };
        const mockModel = createMockEventModel([team1, team2]);

        const result = await validateMultiEventAccess(
            {
                enabled: true,
                includedEvents: [team1._id.toString(), team2._id.toString()]
            },
            {
                parentMode: "TEAM",
                EventModel: mockModel
            }
        );

        assert.equal(result.isValid, true);
        assert.equal(result.value.enabled, true);
        assert.equal(result.value.includedEvents.length, 2);
    });

    // Test 18 — Disabled configuration normalization and non-empty rejection
    it("Test 18: Disabled configuration rejects non-empty includedEvents and normalizes empty list", async () => {
        // Non-empty array when disabled must be rejected (Rule 2)
        const rejectNonEmpty = await validateMultiEventAccess({
            enabled: false,
            includedEvents: [makeId().toString()]
        });
        assert.equal(rejectNonEmpty.isValid, false);
        assert.match(rejectNonEmpty.error, /Included events cannot be specified when multi-event access is disabled/i);

        // Empty array when disabled is normalized
        const emptyArray = await validateMultiEventAccess({
            enabled: false,
            includedEvents: []
        });
        assert.equal(emptyArray.isValid, true);
        assert.equal(emptyArray.value.enabled, false);
        assert.deepEqual(emptyArray.value.includedEvents, []);
    });

    // Test 19 — Legacy direct-registration default
    it("Test 19: Event model registration subdocument defaults allowDirectRegistration to true", () => {
        const event = new Event({
            name: "Direct Registration Test Event",
            description: "Test event for direct registration default",
            category: "CULTURAL",
            venue: "Auditorium",
            startDate: new Date("2026-11-28T10:00:00Z"),
            endDate: new Date("2026-11-28T16:00:00Z"),
            registration: {
                mode: "INDIVIDUAL",
                deadline: new Date("2026-11-27T23:59:00Z"),
                capacity: 50
            },
            createdBy: makeId()
        });

        assert.equal(event.registration.allowDirectRegistration, true);
    });

    // Test 20 — No mutation of Registration or Team data
    it("Test 20: Validation engine is strictly read-only and does not mutate Registration or Team collections", async () => {
        // Track whether any Mongoose mutating methods are called on Registration or Team
        let regMutationCalled = false;
        let teamMutationCalled = false;

        const origRegCreate = Registration.create;
        const origTeamCreate = Team.create;

        Registration.create = () => { regMutationCalled = true; };
        Team.create = () => { teamMutationCalled = true; };

        try {
            const child = { _id: makeId(), name: "Safe Event", status: "PUBLISHED", registration: { mode: "INDIVIDUAL" } };
            const mockModel = createMockEventModel([child]);

            const result = await validateMultiEventAccess(
                {
                    enabled: true,
                    includedEvents: [child._id.toString()]
                },
                {
                    parentMode: "INDIVIDUAL",
                    EventModel: mockModel
                }
            );

            assert.equal(result.isValid, true);
            assert.equal(regMutationCalled, false, "Registration collection must never be mutated during event validation");
            assert.equal(teamMutationCalled, false, "Team collection must never be mutated during event validation");
        } finally {
            Registration.create = origRegCreate;
            Team.create = origTeamCreate;
        }
    });

    // Bonus Test 21 — Maximum inclusion bound enforcement
    it("Test 21: Exceeding maximum inclusion limit is rejected", async () => {
        const limit = 5;
        const childIds = Array.from({ length: 6 }, () => makeId().toString());

        const result = await validateMultiEventAccess(
            {
                enabled: true,
                includedEvents: childIds
            },
            {
                maxIncludedEvents: limit
            }
        );

        assert.equal(result.isValid, false);
        assert.match(result.error, /cannot exceed 5 events/i);
    });

    // Bonus Test 22 — Unexpected properties rejection
    it("Test 22: Unknown or extraneous properties in multiEventAccess payload are rejected", async () => {
        const result = await validateMultiEventAccess({
            enabled: false,
            extraneousKey: "malicious_or_unknown"
        });

        assert.equal(result.isValid, false);
        assert.match(result.error, /Unexpected property in multiEventAccess: "extraneousKey"/i);
    });
});
