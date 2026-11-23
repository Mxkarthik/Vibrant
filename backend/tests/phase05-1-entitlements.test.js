"use strict";

process.env.NODE_ENV = "test";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Registration = require("../models/Registration");
const Event = require("../models/Event");
const {
    normalizeEventId,
    buildRegistrationAccessSnapshot,
    resolveEffectiveAccess
} = require("../utils/registrationEntitlement");

const makeId = () => new mongoose.Types.ObjectId();

describe("Phase 05.1: Registration Entitlement Snapshot Model and Resolver", () => {
    // 1. Standard single-event snapshot
    test("1. Standard single-event snapshot returns SINGLE_EVENT with registered event ID", () => {
        const eventId = makeId();
        const event = {
            _id: eventId,
            name: "Individual Coding",
            multiEventAccess: { enabled: false, includedEvents: [] }
        };

        const snapshot = buildRegistrationAccessSnapshot({ event });

        assert.equal(snapshot.type, "SINGLE_EVENT");
        assert.equal(snapshot.eligibleEventIds.length, 1);
        assert.equal(snapshot.eligibleEventIds[0].toString(), eventId.toString());
        assert.ok(snapshot.grantedAt instanceof Date);
    });

    // 2. Combo snapshot with multiple children
    test("2. Combo snapshot with multiple children returns MULTI_EVENT with includedEvents only (parent excluded)", () => {
        const parentId = makeId();
        const child1 = makeId();
        const child2 = makeId();
        const child3 = makeId();

        const comboEvent = {
            _id: parentId,
            name: "Tech Combo Mega Pass",
            multiEventAccess: {
                enabled: true,
                includedEvents: [child1, child2, child3]
            }
        };

        const snapshot = buildRegistrationAccessSnapshot({ event: comboEvent });

        assert.equal(snapshot.type, "MULTI_EVENT");
        assert.equal(snapshot.eligibleEventIds.length, 3);
        assert.equal(snapshot.eligibleEventIds[0].toString(), child1.toString());
        assert.equal(snapshot.eligibleEventIds[1].toString(), child2.toString());
        assert.equal(snapshot.eligibleEventIds[2].toString(), child3.toString());
        // Crucial architecture rule: parent combo is a registration product, not an attendance destination
        assert.ok(!snapshot.eligibleEventIds.some(id => id.toString() === parentId.toString()));
    });

    // 3. Empty combo configuration throws
    test("3. Empty combo configuration when multiEventAccess.enabled is true throws error", () => {
        const parentId = makeId();
        const emptyCombo = {
            _id: parentId,
            name: "Empty Combo",
            multiEventAccess: {
                enabled: true,
                includedEvents: []
            }
        };

        assert.throws(
            () => buildRegistrationAccessSnapshot({ event: emptyCombo }),
            /Multi-event access is enabled, but no included events were provided/
        );
    });

    // 4. Duplicate included-event IDs throws
    test("4. Duplicate included-event IDs in combo configuration throws error", () => {
        const parentId = makeId();
        const child1 = makeId();

        const duplicateCombo = {
            _id: parentId,
            name: "Duplicate Combo",
            multiEventAccess: {
                enabled: true,
                includedEvents: [child1, child1]
            }
        };

        assert.throws(
            () => buildRegistrationAccessSnapshot({ event: duplicateCombo }),
            /Duplicate event ID in includedEvents/
        );
    });

    // 5. Invalid ObjectIds throw
    test("5. Invalid event ID or child ID throws defensive validation error", () => {
        assert.throws(
            () => normalizeEventId("invalid-hex-id"),
            /Invalid event ID/
        );

        assert.throws(
            () => buildRegistrationAccessSnapshot({ event: null }),
            /Event is required/
        );

        const parentId = makeId();
        assert.throws(
            () => buildRegistrationAccessSnapshot({
                event: {
                    _id: parentId,
                    multiEventAccess: { enabled: true, includedEvents: ["not-an-object-id"] }
                }
            }),
            /Invalid event ID/
        );
    });

    // 6. Multi-Event Access disabled returns SINGLE_EVENT
    test("6. Event with multiEventAccess.enabled === false returns SINGLE_EVENT with registered event", () => {
        const eventId = makeId();
        const nonCombo = {
            _id: eventId,
            multiEventAccess: {
                enabled: false,
                includedEvents: [makeId()] // Even if leftover IDs exist in database, disabled means disabled
            }
        };

        const snapshot = buildRegistrationAccessSnapshot({ event: nonCombo });

        assert.equal(snapshot.type, "SINGLE_EVENT");
        assert.equal(snapshot.eligibleEventIds.length, 1);
        assert.equal(snapshot.eligibleEventIds[0].toString(), eventId.toString());
    });

    // 7. Legacy Registration with no access field resolves to SINGLE_EVENT
    test("7. Legacy registration with no access field resolves to SINGLE_EVENT pointing to registration.event", () => {
        const eventId = makeId();
        const legacyRegistration = {
            _id: makeId(),
            event: eventId,
            qrToken: "a".repeat(64),
            createdAt: new Date("2026-11-20T10:00:00.000Z"),
            status: "REGISTERED"
            // access field is undefined
        };

        const resolved = resolveEffectiveAccess(legacyRegistration);

        assert.equal(resolved.type, "SINGLE_EVENT");
        assert.equal(resolved.eligibleEventIds.length, 1);
        assert.equal(resolved.eligibleEventIds[0].toString(), eventId.toString());
        assert.equal(resolved.isLegacy, true);
        assert.equal(resolved.grantedAt.toISOString(), "2026-11-20T10:00:00.000Z");
        // Verify source registration was not mutated
        assert.equal(legacyRegistration.access, undefined);
    });

    // 8. Legacy registration belonging to parent later configured as combo never gets combo access
    test("8. Legacy registration belonging to parent later configured as combo retains single-event access to parent only", () => {
        const parentId = makeId();
        const child1 = makeId();
        const child2 = makeId();

        // The parent event is NOW configured as a combo in the system
        const parentEventInDb = {
            _id: parentId,
            name: "Grandfathered Event",
            multiEventAccess: {
                enabled: true,
                includedEvents: [child1, child2]
            }
        };

        // But the legacy registration was created before the combo configuration and has no access snapshot
        const legacyRegistration = {
            _id: makeId(),
            event: parentEventInDb, // Even when populated with current combo event
            qrToken: "b".repeat(64),
            createdAt: new Date("2026-11-15T08:00:00.000Z"),
            status: "REGISTERED"
        };

        const resolved = resolveEffectiveAccess(legacyRegistration);

        assert.equal(resolved.type, "SINGLE_EVENT");
        assert.equal(resolved.eligibleEventIds.length, 1);
        assert.equal(resolved.eligibleEventIds[0].toString(), parentId.toString());
        assert.ok(!resolved.eligibleEventIds.some(id => id.toString() === child1.toString()));
        assert.ok(!resolved.eligibleEventIds.some(id => id.toString() === child2.toString()));
        assert.equal(resolved.isLegacy, true);
    });

    // 9. Populated Event references in resolver
    test("9. Resolver handles populated event references ({ _id: ... }) correctly", () => {
        const eventId = makeId();
        const regWithPopulatedEvent = {
            _id: makeId(),
            event: { _id: eventId, name: "Robo Wars", status: "PUBLISHED" },
            createdAt: new Date()
        };

        const resolved = resolveEffectiveAccess(regWithPopulatedEvent);

        assert.equal(resolved.type, "SINGLE_EVENT");
        assert.equal(resolved.eligibleEventIds[0].toString(), eventId.toString());
    });

    // 10. Unpopulated Event references in resolver
    test("10. Resolver handles unpopulated event references (raw ObjectId or string) correctly", () => {
        const eventId = makeId();
        const regWithRawEvent = {
            _id: makeId(),
            event: eventId.toString(),
            createdAt: new Date()
        };

        const resolved = resolveEffectiveAccess(regWithRawEvent);

        assert.equal(resolved.type, "SINGLE_EVENT");
        assert.equal(resolved.eligibleEventIds[0].toString(), eventId.toString());
    });

    // 11. Team-member snapshot independence
    test("11. Team-member snapshot independence: separate team members receive independent snapshots", () => {
        const parentCombo = {
            _id: makeId(),
            multiEventAccess: {
                enabled: true,
                includedEvents: [makeId(), makeId()]
            }
        };

        const leaderSnapshot = buildRegistrationAccessSnapshot({ event: parentCombo });
        const memberSnapshot = buildRegistrationAccessSnapshot({ event: parentCombo });

        assert.notEqual(leaderSnapshot, memberSnapshot);
        assert.notEqual(leaderSnapshot.eligibleEventIds, memberSnapshot.eligibleEventIds);
        assert.deepEqual(leaderSnapshot.eligibleEventIds, memberSnapshot.eligibleEventIds);

        // Mutating one does not affect the other
        leaderSnapshot.eligibleEventIds.push(makeId());
        assert.equal(leaderSnapshot.eligibleEventIds.length, 3);
        assert.equal(memberSnapshot.eligibleEventIds.length, 2);
    });

    // 12. Source Event immutability
    test("12. Source Event object and includedEvents array are immutable after snapshot creation", () => {
        const child1 = makeId();
        const child2 = makeId();
        const sourceIncluded = [child1, child2];
        const sourceEvent = {
            _id: makeId(),
            name: "Original Event",
            multiEventAccess: {
                enabled: true,
                includedEvents: sourceIncluded
            }
        };

        const snapshot = buildRegistrationAccessSnapshot({ event: sourceEvent });

        // Modify snapshot
        snapshot.eligibleEventIds.pop();

        // Source must remain completely untouched
        assert.equal(sourceEvent.multiEventAccess.includedEvents.length, 2);
        assert.equal(sourceIncluded.length, 2);
    });

    // 13. QR token preservation
    test("13. QR token format and preservation: existing tokens are never touched or regenerated", () => {
        const existingToken = "c".repeat(64);
        const registration = new Registration({
            event: makeId(),
            participantDetails: {
                fullName: "Alice Smith",
                mobileNumber: "9876543210",
                collegeName: "Eng College",
                department: "CSE",
                section: "A",
                yearOfStudy: "3",
                rollNumber: "24CS001"
            },
            qrToken: existingToken
        });

        assert.equal(registration.qrToken, existingToken);
        const resolved = resolveEffectiveAccess(registration);
        assert.equal(registration.qrToken, existingToken);
        assert.equal(resolved.eligibleEventIds.length, 1);
    });

    // 14. No child Registration creation
    test("14. Snapshot creation creates access objects, not child Registration documents", () => {
        const parentCombo = {
            _id: makeId(),
            multiEventAccess: {
                enabled: true,
                includedEvents: [makeId(), makeId(), makeId()]
            }
        };

        const snapshot = buildRegistrationAccessSnapshot({ event: parentCombo });

        // Builder returns an access metadata object, not a Mongoose document or collection of documents
        assert.ok(!(snapshot instanceof Registration));
        assert.equal(typeof snapshot.type, "string");
        assert.ok(Array.isArray(snapshot.eligibleEventIds));
        assert.equal(snapshot.eligibleEventIds.length, 3);
    });

    // 15. No attendance changes
    test("15. Attendance schema and state remain strictly isolated from entitlement snapshot", () => {
        const reg = new Registration({
            event: makeId(),
            participantDetails: {
                fullName: "Bob Jones",
                mobileNumber: "9876543211",
                collegeName: "Eng College",
                department: "ECE",
                section: "B",
                yearOfStudy: "2",
                rollNumber: "25EC002"
            },
            attendance: {
                isPresent: false,
                checkedInAt: null
            }
        });

        assert.equal(reg.attendance.isPresent, false);
        assert.equal(reg.attendance.checkedInAt, null);

        // Access snapshot does not touch reg.attendance
        reg.access = buildRegistrationAccessSnapshot({
            event: { _id: reg.event, multiEventAccess: { enabled: false } }
        });

        assert.equal(reg.attendance.isPresent, false);
        assert.equal(reg.attendance.checkedInAt, null);
    });

    // 16. No payment changes
    test("16. Payment schema and status remain completely untouched by access snapshot", () => {
        const reg = new Registration({
            event: makeId(),
            participantDetails: {
                fullName: "Charlie Brown",
                mobileNumber: "9876543212",
                collegeName: "Eng College",
                department: "MECH",
                section: "A",
                yearOfStudy: "4",
                rollNumber: "23ME003"
            },
            payment: {
                method: "UPI",
                status: "PENDING",
                expectedAmount: 250
            }
        });

        assert.equal(reg.payment.status, "PENDING");
        assert.equal(reg.payment.expectedAmount, 250);

        reg.access = buildRegistrationAccessSnapshot({
            event: { _id: reg.event, multiEventAccess: { enabled: false } }
        });

        assert.equal(reg.payment.status, "PENDING");
        assert.equal(reg.payment.expectedAmount, 250);
    });

    // 17. No capacity counter changes
    test("17. Capacity counter on Event documents is never mutated by snapshot builder or resolver", () => {
        const eventDoc = {
            _id: makeId(),
            registration: {
                capacity: 100,
                registeredParticipants: 42
            },
            multiEventAccess: {
                enabled: true,
                includedEvents: [makeId(), makeId()]
            }
        };

        const snapshot = buildRegistrationAccessSnapshot({ event: eventDoc });
        assert.equal(eventDoc.registration.registeredParticipants, 42);
        assert.equal(eventDoc.registration.capacity, 100);
        assert.equal(snapshot.eligibleEventIds.length, 2);
    });

    // 18. Schema validation for Registration.access
    test("18. Registration schema enforces valid access.type enum and rejects invalid structures", async () => {
        const validReg = new Registration({
            event: makeId(),
            participantDetails: {
                fullName: "David Lee",
                mobileNumber: "9876543213",
                collegeName: "Eng College",
                department: "IT",
                section: "A",
                yearOfStudy: "1",
                rollNumber: "26IT004"
            },
            access: {
                type: "MULTI_EVENT",
                eligibleEventIds: [makeId(), makeId()],
                grantedAt: new Date()
            }
        });

        const validationErr = await validReg.validate();
        assert.equal(validationErr, undefined);

        const invalidReg = new Registration({
            event: makeId(),
            participantDetails: {
                fullName: "Invalid User",
                mobileNumber: "9876543214",
                collegeName: "Eng College",
                department: "IT",
                section: "A",
                yearOfStudy: "1",
                rollNumber: "26IT005"
            },
            access: {
                type: "INVALID_ACCESS_TYPE",
                eligibleEventIds: [makeId()]
            }
        });

        let caughtErr = null;
        try {
            await invalidReg.validate();
        } catch (err) {
            caughtErr = err;
        }

        assert.ok(caughtErr);
        assert.ok(caughtErr.errors["access.type"]);
    });

    // 19. Existing Registration index compatibility
    test("19. Existing Registration schema indexes are fully preserved without regression", () => {
        const indexes = Registration.schema.indexes();

        // 1. { event: 1, user: 1 } unique index
        const userEventIdx = indexes.find(idx => idx[0].event === 1 && idx[0].user === 1);
        assert.ok(userEventIdx, "Expected compound index on { event: 1, user: 1 }");
        assert.equal(userEventIdx[1].unique, true);

        // 2. { "certificate.certificateId": 1 } index
        const certIdx = indexes.find(idx => idx[0]["certificate.certificateId"] === 1);
        assert.ok(certIdx, "Expected index on { 'certificate.certificateId': 1 }");
        assert.equal(certIdx[1].unique, true);

        // 3. qrToken unique index is defined field-level
        assert.equal(Registration.schema.paths.qrToken.options.unique, true);
    });

    // 20. Legacy Registration document compatibility
    test("20. Legacy registration document without access field remains completely valid and access is undefined", async () => {
        const legacyReg = new Registration({
            event: makeId(),
            participantDetails: {
                fullName: "Legacy Participant",
                mobileNumber: "9876543215",
                collegeName: "Eng College",
                department: "CIVIL",
                section: "A",
                yearOfStudy: "3",
                rollNumber: "24CE006"
            }
        });

        const validationErr = await legacyReg.validate();
        assert.equal(validationErr, undefined);

        const obj = legacyReg.toObject();
        assert.equal("access" in obj, false);
        assert.equal(legacyReg.access, undefined);

        // Resolver works seamlessly with this legacy document
        const resolved = resolveEffectiveAccess(legacyReg);
        assert.equal(resolved.type, "SINGLE_EVENT");
        assert.equal(resolved.eligibleEventIds[0].toString(), legacyReg.event.toString());
        assert.equal(resolved.isLegacy, true);
    });

    // --- Phase 05.2B Hardening Tests ---

    // 21. Resolver rejects malformed access type instead of falling back to legacy
    test("21. Resolver rejects malformed access.type instead of falling back to legacy access", () => {
        const malformed = {
            event: makeId(),
            access: {
                type: "CORRUPTED_TYPE",
                eligibleEventIds: [makeId()]
            }
        };

        assert.throws(
            () => resolveEffectiveAccess(malformed),
            /Malformed registration access snapshot: invalid access type "CORRUPTED_TYPE"/
        );
    });

    // 22. Resolver rejects empty eligibleEventIds array in access snapshot
    test("22. Resolver rejects empty eligibleEventIds array in access snapshot instead of falling back", () => {
        const malformed = {
            event: makeId(),
            access: {
                type: "MULTI_EVENT",
                eligibleEventIds: []
            }
        };

        assert.throws(
            () => resolveEffectiveAccess(malformed),
            /Malformed registration access snapshot: eligibleEventIds must be a non-empty array/
        );
    });

    // 23. Resolver rejects SINGLE_EVENT with multiple IDs in access snapshot
    test("23. Resolver rejects SINGLE_EVENT with multiple eligibleEventIds in access snapshot", () => {
        const malformed = {
            event: makeId(),
            access: {
                type: "SINGLE_EVENT",
                eligibleEventIds: [makeId(), makeId()]
            }
        };

        assert.throws(
            () => resolveEffectiveAccess(malformed),
            /Malformed registration access snapshot: SINGLE_EVENT must have exactly one eligible event ID/
        );
    });

    // 24. Resolver rejects duplicate IDs in access snapshot
    test("24. Resolver rejects duplicate event IDs in access snapshot", () => {
        const id1 = makeId();
        const malformed = {
            event: makeId(),
            access: {
                type: "MULTI_EVENT",
                eligibleEventIds: [id1, id1]
            }
        };

        assert.throws(
            () => resolveEffectiveAccess(malformed),
            /duplicate event ID/
        );
    });

    // 25. Registration schema enforces non-empty, unique eligibleEventIds and SINGLE_EVENT cardinality
    test("25. Registration schema rejects empty, duplicate, and invalid SINGLE_EVENT eligibleEventIds", async () => {
        const id1 = makeId();
        const id2 = makeId();

        // 25a. Empty eligibleEventIds rejected by schema
        const emptyIdsReg = new Registration({
            event: makeId(),
            participantDetails: {
                fullName: "Empty IDs User",
                mobileNumber: "9876543216",
                collegeName: "Eng College",
                department: "IT",
                section: "A",
                yearOfStudy: "1",
                rollNumber: "26IT007"
            },
            access: {
                type: "MULTI_EVENT",
                eligibleEventIds: []
            }
        });
        await assert.rejects(
            async () => emptyIdsReg.validate(),
            /eligibleEventIds must be a non-empty array of Event IDs/
        );

        // 25b. Duplicate IDs rejected by schema
        const dupIdsReg = new Registration({
            event: makeId(),
            participantDetails: {
                fullName: "Dup IDs User",
                mobileNumber: "9876543217",
                collegeName: "Eng College",
                department: "IT",
                section: "A",
                yearOfStudy: "1",
                rollNumber: "26IT008"
            },
            access: {
                type: "MULTI_EVENT",
                eligibleEventIds: [id1, id1]
            }
        });
        await assert.rejects(
            async () => dupIdsReg.validate(),
            /eligibleEventIds cannot contain duplicate Event IDs/
        );

        // 25c. SINGLE_EVENT with > 1 ID rejected by schema
        const singleMultiReg = new Registration({
            event: makeId(),
            participantDetails: {
                fullName: "Single Multi User",
                mobileNumber: "9876543218",
                collegeName: "Eng College",
                department: "IT",
                section: "A",
                yearOfStudy: "1",
                rollNumber: "26IT009"
            },
            access: {
                type: "SINGLE_EVENT",
                eligibleEventIds: [id1, id2]
            }
        });
        await assert.rejects(
            async () => singleMultiReg.validate(),
            /SINGLE_EVENT access must contain exactly one eligible event ID/
        );
    });

    // 26. Resolver rejects explicit null access snapshot with INVALID_REGISTRATION_ACCESS
    test("26. Resolver rejects explicit null access snapshot with INVALID_REGISTRATION_ACCESS error", () => {
        const nullAccessDoc = {
            event: makeId(),
            access: null
        };

        assert.throws(
            () => resolveEffectiveAccess(nullAccessDoc),
            (err) => {
                assert.equal(err.code, "INVALID_REGISTRATION_ACCESS");
                assert.match(err.message, /explicit null access snapshot/);
                return true;
            }
        );
    });
});
