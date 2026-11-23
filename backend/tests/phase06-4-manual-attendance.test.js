"use strict";

process.env.NODE_ENV = "test";

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const Event = require("../models/Event");
const Registration = require("../models/Registration");
const Team = require("../models/Team");
const {
    markAttendance,
    lookupRegistrationForManualCheckIn,
    markManualAttendance
} = require("../controllers/registrationController");

const makeId = () => new mongoose.Types.ObjectId();
const adminId = makeId();
const assignedOrgId = makeId();
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

describe("Phase 06.4: Secure Registration ID Manual Check-in Implementation", () => {
    let standardEventId;
    let comboParentId;
    let childAId;
    let childBId;
    let unrelatedEventId;

    let standardEvent;
    let comboParentEvent;
    let childEventA;
    let childEventB;
    let unrelatedEvent;

    beforeEach(() => {
        standardEventId = makeId();
        comboParentId = makeId();
        childAId = makeId();
        childBId = makeId();
        unrelatedEventId = makeId();

        standardEvent = {
            _id: standardEventId,
            name: "CODE2CREATE",
            status: "PUBLISHED",
            organizers: [assignedOrgId],
            multiEventAccess: { enabled: false }
        };

        childEventA = {
            _id: childAId,
            name: "Web Dev Sprint",
            status: "PUBLISHED",
            organizers: [assignedOrgId],
            multiEventAccess: { enabled: false }
        };

        childEventB = {
            _id: childBId,
            name: "Cloud Hackathon",
            status: "PUBLISHED",
            organizers: [assignedOrgId],
            multiEventAccess: { enabled: false }
        };

        comboParentEvent = {
            _id: comboParentId,
            name: "Vibrant Mega Combo Pass",
            status: "PUBLISHED",
            organizers: [assignedOrgId],
            multiEventAccess: {
                enabled: true,
                childEvents: [childAId, childBId]
            }
        };

        unrelatedEvent = {
            _id: unrelatedEventId,
            name: "Design Workshop",
            status: "PUBLISHED",
            organizers: [assignedOrgId],
            multiEventAccess: { enabled: false }
        };
    });

    // 1. Individual Registration ID lookup
    test("1. Individual Registration ID lookup succeeds with expected metadata", async (context) => {
        const regId = makeId();
        const regDoc = {
            _id: regId,
            qrToken: "a".repeat(64),
            event: standardEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            participantDetails: {
                fullName: "Alice Sharma",
                collegeName: "Tech Institute",
                department: "CS",
                rollNumber: "21CS01",
                mobileNumber: "9876543210"
            },
            access: {
                type: "SINGLE_EVENT",
                eligibleEventIds: [standardEventId],
                grantedAt: new Date()
            },
            eventAttendance: []
        };

        context.mock.method(Event, "findById", () => ({
            select: async () => standardEvent
        }));

        context.mock.method(Registration, "findById", () => ({
            select: () => ({
                populate: () => ({
                    populate: async () => regDoc
                })
            })
        }));

        const req = {
            body: { registrationId: regId.toString(), eventId: standardEventId.toString() },
            user: { _id: adminId, role: "ADMIN" }
        };
        const res = mockResponse();

        await lookupRegistrationForManualCheckIn(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.data.registrationId, regId.toString());
        assert.equal(res.body.data.participant.fullName, "Alice Sharma");
        assert.equal(res.body.data.participant.maskedMobile, "******3210");
        assert.equal(res.body.data.eligibility.canCheckIn, true);
        assert.equal(res.body.data.eligibility.alreadyCheckedIn, false);
    });

    // 2. Team member Registration ID lookup
    test("2. Team member Registration ID lookup returns that member with team details", async (context) => {
        const memberRegId = makeId();
        const teamDoc = {
            _id: makeId(),
            teamName: "CodeNinjas",
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            event: standardEvent
        };

        const regDoc = {
            _id: memberRegId,
            qrToken: "b".repeat(64),
            team: teamDoc,
            event: standardEvent,
            isTeamLeader: false,
            status: "REGISTERED",
            participantDetails: {
                fullName: "Bob Patel",
                collegeName: "Tech Institute",
                department: "IT",
                rollNumber: "21IT05",
                mobileNumber: "9123456789"
            },
            access: {
                type: "SINGLE_EVENT",
                eligibleEventIds: [standardEventId],
                grantedAt: new Date()
            },
            eventAttendance: []
        };

        context.mock.method(Event, "findById", () => ({
            select: async () => standardEvent
        }));

        context.mock.method(Registration, "findById", () => ({
            select: () => ({
                populate: () => ({
                    populate: async () => regDoc
                })
            })
        }));

        const req = {
            body: { registrationId: memberRegId.toString(), eventId: standardEventId.toString() },
            user: { _id: assignedOrgId, role: "ORGANISER" }
        };
        const res = mockResponse();

        await lookupRegistrationForManualCheckIn(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.data.registration.registrationType, "TEAM");
        assert.equal(res.body.data.registration.teamName, "CodeNinjas");
        assert.equal(res.body.data.participant.fullName, "Bob Patel");
    });

    // 3. Combo Pass registration lookup
    test("3. Combo Pass registration lookup correctly identifies combo cohort", async (context) => {
        const comboRegId = makeId();
        const regDoc = {
            _id: comboRegId,
            qrToken: "c".repeat(64),
            event: comboParentEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            participantDetails: { fullName: "Charlie Brown" },
            access: {
                type: "MULTI_EVENT",
                eligibleEventIds: [childAId, childBId],
                grantedAt: new Date()
            },
            eventAttendance: []
        };

        context.mock.method(Event, "findById", () => ({
            select: async () => childEventA
        }));

        context.mock.method(Registration, "findById", () => ({
            select: () => ({
                populate: () => ({
                    populate: async () => regDoc
                })
            })
        }));

        const req = {
            body: { registrationId: comboRegId.toString(), eventId: childAId.toString() },
            user: { _id: adminId, role: "ADMIN" }
        };
        const res = mockResponse();

        await lookupRegistrationForManualCheckIn(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.data.registration.cohortType, "COMBO");
        assert.equal(res.body.data.registration.comboName, "Vibrant Mega Combo Pass");
        assert.equal(res.body.data.eligibility.canCheckIn, true);
    });

    // 4. Valid direct-event entitlement
    test("4. Valid direct-event entitlement confirms canCheckIn true", async (context) => {
        const regId = makeId();
        const regDoc = {
            _id: regId,
            event: standardEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            access: { type: "SINGLE_EVENT", eligibleEventIds: [standardEventId] },
            eventAttendance: []
        };

        context.mock.method(Event, "findById", () => ({ select: async () => standardEvent }));
        context.mock.method(Registration, "findById", () => ({
            select: () => ({ populate: () => ({ populate: async () => regDoc }) })
        }));

        const req = { body: { registrationId: regId.toString(), eventId: standardEventId.toString() }, user: { role: "ADMIN" } };
        const res = mockResponse();
        await lookupRegistrationForManualCheckIn(req, res);

        assert.equal(res.body.data.eligibility.canCheckIn, true);
        assert.equal(res.body.data.eligibility.reasonCode, "ADMISSION_ALLOWED");
    });

    // 5. Valid child-event combo entitlement
    test("5. Valid child-event combo entitlement confirms canCheckIn true for child venue", async (context) => {
        const regId = makeId();
        const regDoc = {
            _id: regId,
            event: comboParentEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            access: { type: "MULTI_EVENT", eligibleEventIds: [childAId, childBId] },
            eventAttendance: []
        };

        context.mock.method(Event, "findById", () => ({ select: async () => childEventA }));
        context.mock.method(Registration, "findById", () => ({
            select: () => ({ populate: () => ({ populate: async () => regDoc }) })
        }));

        const req = { body: { registrationId: regId.toString(), eventId: childAId.toString() }, user: { role: "ADMIN" } };
        const res = mockResponse();
        await lookupRegistrationForManualCheckIn(req, res);

        assert.equal(res.body.data.eligibility.canCheckIn, true);
    });

    // 6. Unentitled event rejection
    test("6. Unentitled event lookup yields isEntitled false and canCheckIn false", async (context) => {
        const regId = makeId();
        const regDoc = {
            _id: regId,
            event: standardEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            access: { type: "SINGLE_EVENT", eligibleEventIds: [standardEventId] },
            eventAttendance: []
        };

        context.mock.method(Event, "findById", () => ({ select: async () => unrelatedEvent }));
        context.mock.method(Registration, "findById", () => ({
            select: () => ({ populate: () => ({ populate: async () => regDoc }) })
        }));

        const req = { body: { registrationId: regId.toString(), eventId: unrelatedEventId.toString() }, user: { role: "ADMIN" } };
        const res = mockResponse();
        await lookupRegistrationForManualCheckIn(req, res);

        assert.equal(res.body.data.eligibility.isEntitled, false);
        assert.equal(res.body.data.eligibility.canCheckIn, false);
        assert.equal(res.body.data.eligibility.reasonCode, "EVENT_NOT_ENTITLED");
    });

    // 7. Combo parent rejection
    test("7. Lookup scoped to Combo Pass parent package is rejected with 400 COMBO_PARENT_NOT_VENUE", async (context) => {
        const regId = makeId();
        context.mock.method(Event, "findById", () => ({ select: async () => comboParentEvent }));

        const req = { body: { registrationId: regId.toString(), eventId: comboParentId.toString() }, user: { role: "ADMIN" } };
        const res = mockResponse();
        await lookupRegistrationForManualCheckIn(req, res);

        assert.equal(res.statusCode, 400);
        assert.equal(res.body.code, "COMBO_PARENT_NOT_VENUE");
    });

    // 8. Pending payment rejection
    test("8. Pending payment registration yields canCheckIn false with PAYMENT_PENDING", async (context) => {
        const regId = makeId();
        const regDoc = {
            _id: regId,
            event: standardEvent,
            status: "REGISTERED",
            payment: { status: "PENDING" },
            access: { type: "SINGLE_EVENT", eligibleEventIds: [standardEventId] },
            eventAttendance: []
        };

        context.mock.method(Event, "findById", () => ({ select: async () => standardEvent }));
        context.mock.method(Registration, "findById", () => ({
            select: () => ({ populate: () => ({ populate: async () => regDoc }) })
        }));

        const req = { body: { registrationId: regId.toString(), eventId: standardEventId.toString() }, user: { role: "ADMIN" } };
        const res = mockResponse();
        await lookupRegistrationForManualCheckIn(req, res);

        assert.equal(res.body.data.eligibility.canCheckIn, false);
        assert.equal(res.body.data.eligibility.reasonCode, "PAYMENT_PENDING");
    });

    // 9. Rejected payment rejection
    test("9. Rejected payment registration yields canCheckIn false with PAYMENT_REJECTED", async (context) => {
        const regId = makeId();
        const regDoc = {
            _id: regId,
            event: standardEvent,
            status: "REGISTERED",
            payment: { status: "REJECTED" },
            access: { type: "SINGLE_EVENT", eligibleEventIds: [standardEventId] },
            eventAttendance: []
        };

        context.mock.method(Event, "findById", () => ({ select: async () => standardEvent }));
        context.mock.method(Registration, "findById", () => ({
            select: () => ({ populate: () => ({ populate: async () => regDoc }) })
        }));

        const req = { body: { registrationId: regId.toString(), eventId: standardEventId.toString() }, user: { role: "ADMIN" } };
        const res = mockResponse();
        await lookupRegistrationForManualCheckIn(req, res);

        assert.equal(res.body.data.eligibility.canCheckIn, false);
        assert.equal(res.body.data.eligibility.reasonCode, "PAYMENT_REJECTED");
    });

    // 10. Cancelled registration rejection
    test("10. Cancelled registration yields canCheckIn false with REGISTRATION_CANCELLED", async (context) => {
        const regId = makeId();
        const regDoc = {
            _id: regId,
            event: standardEvent,
            status: "CANCELLED",
            payment: { status: "VERIFIED" },
            access: { type: "SINGLE_EVENT", eligibleEventIds: [standardEventId] },
            eventAttendance: []
        };

        context.mock.method(Event, "findById", () => ({ select: async () => standardEvent }));
        context.mock.method(Registration, "findById", () => ({
            select: () => ({ populate: () => ({ populate: async () => regDoc }) })
        }));

        const req = { body: { registrationId: regId.toString(), eventId: standardEventId.toString() }, user: { role: "ADMIN" } };
        const res = mockResponse();
        await lookupRegistrationForManualCheckIn(req, res);

        assert.equal(res.body.data.eligibility.canCheckIn, false);
        assert.equal(res.body.data.eligibility.reasonCode, "REGISTRATION_CANCELLED");
    });

    // 11. Cancelled team rejection
    test("11. Cancelled team registration yields canCheckIn false with TEAM_CANCELLED", async (context) => {
        const regId = makeId();
        const regDoc = {
            _id: regId,
            team: { _id: makeId(), status: "CANCELLED", payment: { status: "VERIFIED" }, event: standardEvent },
            event: standardEvent,
            status: "REGISTERED",
            access: { type: "SINGLE_EVENT", eligibleEventIds: [standardEventId] },
            eventAttendance: []
        };

        context.mock.method(Event, "findById", () => ({ select: async () => standardEvent }));
        context.mock.method(Registration, "findById", () => ({
            select: () => ({ populate: () => ({ populate: async () => regDoc }) })
        }));

        const req = { body: { registrationId: regId.toString(), eventId: standardEventId.toString() }, user: { role: "ADMIN" } };
        const res = mockResponse();
        await lookupRegistrationForManualCheckIn(req, res);

        assert.equal(res.body.data.eligibility.canCheckIn, false);
        assert.equal(res.body.data.eligibility.reasonCode, "TEAM_CANCELLED");
    });

    // 12. Cancelled parent or child event rejection
    test("12. Cancelled target event yields TARGET_EVENT_CANCELLED", async (context) => {
        const regId = makeId();
        const cancelledTarget = { ...standardEvent, status: "CANCELLED" };
        const regDoc = {
            _id: regId,
            event: cancelledTarget,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            access: { type: "SINGLE_EVENT", eligibleEventIds: [standardEventId] },
            eventAttendance: []
        };

        context.mock.method(Event, "findById", () => ({ select: async () => cancelledTarget }));
        context.mock.method(Registration, "findById", () => ({
            select: () => ({ populate: () => ({ populate: async () => regDoc }) })
        }));

        const req = { body: { registrationId: regId.toString(), eventId: standardEventId.toString() }, user: { role: "ADMIN" } };
        const res = mockResponse();
        await lookupRegistrationForManualCheckIn(req, res);

        assert.equal(res.body.data.eligibility.canCheckIn, false);
        assert.equal(res.body.data.eligibility.reasonCode, "TARGET_EVENT_CANCELLED");
    });

    // 13. Invalid Registration ID
    test("13. Invalid Registration ID format returns 400 INVALID_REGISTRATION_ID", async () => {
        const req = { body: { registrationId: "not-a-valid-24-hex-id", eventId: standardEventId.toString() }, user: { role: "ADMIN" } };
        const res = mockResponse();
        await lookupRegistrationForManualCheckIn(req, res);

        assert.equal(res.statusCode, 400);
        assert.equal(res.body.code, "INVALID_REGISTRATION_ID");
    });

    // 14. Unknown Registration ID
    test("14. Unknown Registration ID returns 404 REGISTRATION_NOT_FOUND", async (context) => {
        const unknownId = makeId();
        context.mock.method(Event, "findById", () => ({ select: async () => standardEvent }));
        context.mock.method(Registration, "findById", () => ({
            select: () => ({ populate: () => ({ populate: async () => null }) })
        }));

        const req = { body: { registrationId: unknownId.toString(), eventId: standardEventId.toString() }, user: { role: "ADMIN" } };
        const res = mockResponse();
        await lookupRegistrationForManualCheckIn(req, res);

        assert.equal(res.statusCode, 404);
        assert.equal(res.body.code, "REGISTRATION_NOT_FOUND");
    });

    // 15. Unauthorized role rejection (unassigned role or participant rejected)
    test("15. Unassigned organiser rejected with 403 ORGANISER_NOT_ASSIGNED", async (context) => {
        const regId = makeId();
        context.mock.method(Event, "findById", () => ({ select: async () => standardEvent }));

        const req = {
            body: { registrationId: regId.toString(), eventId: standardEventId.toString() },
            user: { _id: unassignedOrgId, role: "ORGANISER" }
        };
        const res = mockResponse();
        await lookupRegistrationForManualCheckIn(req, res);

        assert.equal(res.statusCode, 403);
        assert.equal(res.body.code, "ORGANISER_NOT_ASSIGNED");
    });

    // 16. Organiser event-scoping rejection on manual check-in
    test("16. Manual check-in by unassigned organiser rejected with 403 ORGANISER_NOT_ASSIGNED", async (context) => {
        const regId = makeId();
        context.mock.method(Event, "findById", () => ({ select: async () => standardEvent }));

        const req = {
            body: { registrationId: regId.toString(), eventId: standardEventId.toString(), identityConfirmed: true },
            user: { _id: unassignedOrgId, role: "ORGANISER" }
        };
        const res = mockResponse();
        await markManualAttendance(req, res);

        assert.equal(res.statusCode, 403);
        assert.equal(res.body.code, "ORGANISER_NOT_ASSIGNED");
    });

    // 17. Lookup excludes qrToken
    test("17. Lookup response never exposes raw qrToken", async (context) => {
        const regId = makeId();
        const regDoc = {
            _id: regId,
            event: standardEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            participantDetails: { fullName: "Alice" },
            access: { type: "SINGLE_EVENT", eligibleEventIds: [standardEventId] },
            eventAttendance: []
        };

        context.mock.method(Event, "findById", () => ({ select: async () => standardEvent }));
        context.mock.method(Registration, "findById", (id) => ({
            select: (proj) => {
                assert.ok(proj.includes("-qrToken"), "Projection must exclude qrToken");
                return { populate: () => ({ populate: async () => regDoc }) };
            }
        }));

        const req = { body: { registrationId: regId.toString(), eventId: standardEventId.toString() }, user: { role: "ADMIN" } };
        const res = mockResponse();
        await lookupRegistrationForManualCheckIn(req, res);

        assert.equal(res.body.data.qrToken, undefined);
    });

    // 18. Lookup never modifies attendance
    test("18. Lookup is strictly read-only and never modifies attendance", async (context) => {
        let updateCalled = false;
        context.mock.method(Registration, "findOneAndUpdate", () => {
            updateCalled = true;
        });

        const regId = makeId();
        const regDoc = {
            _id: regId,
            event: standardEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            access: { type: "SINGLE_EVENT", eligibleEventIds: [standardEventId] },
            eventAttendance: []
        };

        context.mock.method(Event, "findById", () => ({ select: async () => standardEvent }));
        context.mock.method(Registration, "findById", () => ({
            select: () => ({ populate: () => ({ populate: async () => regDoc }) })
        }));

        const req = { body: { registrationId: regId.toString(), eventId: standardEventId.toString() }, user: { role: "ADMIN" } };
        const res = mockResponse();
        await lookupRegistrationForManualCheckIn(req, res);

        assert.equal(updateCalled, false, "Lookup must not trigger findOneAndUpdate");
    });

    // 19. Manual check-in requires identity confirmation
    test("19. Manual check-in without identityConfirmed true returns 400 IDENTITY_NOT_CONFIRMED", async () => {
        const req = {
            body: { registrationId: makeId().toString(), eventId: standardEventId.toString(), identityConfirmed: false },
            user: { role: "ADMIN" }
        };
        const res = mockResponse();
        await markManualAttendance(req, res);

        assert.equal(res.statusCode, 400);
        assert.equal(res.body.code, "IDENTITY_NOT_CONFIRMED");
    });

    // 20. Valid manual check-in succeeds
    test("20. Valid manual check-in marks attendance and returns success response", async (context) => {
        const regId = makeId();
        const regDoc = {
            _id: regId,
            event: standardEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            participantDetails: { fullName: "Alice Sharma" },
            attendance: { isPresent: false },
            access: { type: "SINGLE_EVENT", eligibleEventIds: [standardEventId] },
            eventAttendance: []
        };

        context.mock.method(Event, "findById", () => ({ select: async () => standardEvent }));
        context.mock.method(Registration, "findById", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));

        let recordedOp = null;
        context.mock.method(Registration, "findOneAndUpdate", (query, update) => {
            recordedOp = update;
            regDoc.attendance.isPresent = true;
            regDoc.eventAttendance.push(update.$push.eventAttendance);
            return regDoc;
        });

        const req = {
            body: { registrationId: regId.toString(), eventId: standardEventId.toString(), identityConfirmed: true },
            user: { _id: adminId, role: "ADMIN" }
        };
        const res = mockResponse();
        await markManualAttendance(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.participant.fullName, "Alice Sharma");
        assert.equal(recordedOp.$push.eventAttendance.checkInMethod, "MANUAL_REG_ID");
    });

    // 21. Duplicate manual check-in rejected
    test("21. Duplicate manual check-in returns 409 ALREADY_CHECKED_IN", async (context) => {
        const regId = makeId();
        const regDoc = {
            _id: regId,
            event: standardEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            participantDetails: { fullName: "Alice Sharma" },
            attendance: { isPresent: true, checkedInAt: new Date() },
            access: { type: "SINGLE_EVENT", eligibleEventIds: [standardEventId] },
            eventAttendance: [{ eventId: standardEventId, checkedInAt: new Date() }]
        };

        context.mock.method(Event, "findById", () => ({ select: async () => standardEvent }));
        context.mock.method(Registration, "findById", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));

        const req = {
            body: { registrationId: regId.toString(), eventId: standardEventId.toString(), identityConfirmed: true },
            user: { role: "ADMIN" }
        };
        const res = mockResponse();
        await markManualAttendance(req, res);

        assert.equal(res.statusCode, 409);
        assert.equal(res.body.code, "ALREADY_CHECKED_IN");
    });

    // 22. Duplicate QR check-in behavior preserved
    test("22. Duplicate QR check-in behavior preserved via shared engine", async (context) => {
        const regDoc = {
            _id: makeId(),
            qrToken: "d".repeat(64),
            event: standardEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            participantDetails: { fullName: "Dan" },
            attendance: { isPresent: true, checkedInAt: new Date() },
            access: { type: "SINGLE_EVENT", eligibleEventIds: [standardEventId] },
            eventAttendance: [{ eventId: standardEventId, checkedInAt: new Date() }]
        };

        context.mock.method(Registration, "findOne", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));

        const req = {
            body: { qrToken: "d".repeat(64), eventId: standardEventId.toString() },
            user: { role: "ADMIN" }
        };
        const res = mockResponse();
        await markAttendance(req, res);

        assert.equal(res.statusCode, 409);
        assert.equal(res.body.code, "ALREADY_CHECKED_IN");
    });

    // 23. QR/manual simultaneous requests race-condition protection
    test("23. QR/manual atomic filter prevents concurrent duplicate check-in", async (context) => {
        const regId = makeId();
        const regDoc = {
            _id: regId,
            event: standardEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            access: { type: "SINGLE_EVENT", eligibleEventIds: [standardEventId] },
            eventAttendance: []
        };

        context.mock.method(Event, "findById", () => ({ select: async () => standardEvent }));
        context.mock.method(Registration, "findById", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));

        // Simulate atomic findOneAndUpdate returning null because concurrent request pushed eventId
        context.mock.method(Registration, "findOneAndUpdate", () => null);

        const req = {
            body: { registrationId: regId.toString(), eventId: standardEventId.toString(), identityConfirmed: true },
            user: { role: "ADMIN" }
        };
        const res = mockResponse();
        await markManualAttendance(req, res);

        assert.equal(res.statusCode, 409);
        assert.equal(res.body.code, "ALREADY_CHECKED_IN");
    });

    // 24. Team member attendance remains independent
    test("24. Team member attendance remains strictly independent", async (context) => {
        const teamDoc = { _id: makeId(), teamName: "Alpha", status: "REGISTERED", payment: { status: "VERIFIED" } };
        const member1Id = makeId();
        const member2Id = makeId();

        const member1 = {
            _id: member1Id,
            team: teamDoc,
            event: standardEvent,
            status: "REGISTERED",
            access: { type: "SINGLE_EVENT", eligibleEventIds: [standardEventId] },
            eventAttendance: [{ eventId: standardEventId, checkedInAt: new Date() }]
        };

        const member2 = {
            _id: member2Id,
            team: teamDoc,
            event: standardEvent,
            status: "REGISTERED",
            access: { type: "SINGLE_EVENT", eligibleEventIds: [standardEventId] },
            eventAttendance: []
        };

        context.mock.method(Event, "findById", () => ({ select: async () => standardEvent }));
        context.mock.method(Registration, "findById", (id) => ({
            select: () => ({
                populate: () => ({
                    populate: async () => (id.toString() === member1Id.toString() ? member1 : member2)
                })
            })
        }));

        const req1 = { body: { registrationId: member1Id.toString(), eventId: standardEventId.toString() }, user: { role: "ADMIN" } };
        const res1 = mockResponse();
        await lookupRegistrationForManualCheckIn(req1, res1);

        const req2 = { body: { registrationId: member2Id.toString(), eventId: standardEventId.toString() }, user: { role: "ADMIN" } };
        const res2 = mockResponse();
        await lookupRegistrationForManualCheckIn(req2, res2);

        assert.equal(res1.body.data.eligibility.alreadyCheckedIn, true);
        assert.equal(res2.body.data.eligibility.alreadyCheckedIn, false);
        assert.equal(res2.body.data.eligibility.canCheckIn, true);
    });

    // 25. Combo child attendance remains independent
    test("25. Combo child attendance remains independent for each included event", async (context) => {
        const comboRegId = makeId();
        const regDoc = {
            _id: comboRegId,
            event: comboParentEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            access: { type: "MULTI_EVENT", eligibleEventIds: [childAId, childBId] },
            eventAttendance: [{ eventId: childAId, checkedInAt: new Date() }]
        };

        context.mock.method(Event, "findById", (id) => ({
            select: async () => (id.toString() === childAId.toString() ? childEventA : childEventB)
        }));
        context.mock.method(Registration, "findById", () => ({
            select: () => ({ populate: () => ({ populate: async () => regDoc }) })
        }));

        // Lookup for Child A (already checked in)
        const reqA = { body: { registrationId: comboRegId.toString(), eventId: childAId.toString() }, user: { role: "ADMIN" } };
        const resA = mockResponse();
        await lookupRegistrationForManualCheckIn(reqA, resA);

        // Lookup for Child B (not yet checked in)
        const reqB = { body: { registrationId: comboRegId.toString(), eventId: childBId.toString() }, user: { role: "ADMIN" } };
        const resB = mockResponse();
        await lookupRegistrationForManualCheckIn(reqB, resB);

        assert.equal(resA.body.data.eligibility.alreadyCheckedIn, true);
        assert.equal(resB.body.data.eligibility.alreadyCheckedIn, false);
        assert.equal(resB.body.data.eligibility.canCheckIn, true);
    });

    // 26. Audit method and actor recorded
    test("26. Audit method and actor recorded on manual check-in", async (context) => {
        const regId = makeId();
        const regDoc = {
            _id: regId,
            event: standardEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            participantDetails: { fullName: "Alice" },
            attendance: { isPresent: false },
            access: { type: "SINGLE_EVENT", eligibleEventIds: [standardEventId] },
            eventAttendance: []
        };

        context.mock.method(Event, "findById", () => ({ select: async () => standardEvent }));
        context.mock.method(Registration, "findById", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));

        let pushedAttendance = null;
        context.mock.method(Registration, "findOneAndUpdate", (query, update) => {
            pushedAttendance = update.$push.eventAttendance;
            regDoc.attendance.isPresent = true;
            regDoc.eventAttendance.push(pushedAttendance);
            return regDoc;
        });

        const req = {
            body: { registrationId: regId.toString(), eventId: standardEventId.toString(), identityConfirmed: true },
            user: { _id: assignedOrgId, role: "ORGANISER" }
        };
        const res = mockResponse();
        await markManualAttendance(req, res);

        assert.equal(pushedAttendance.checkInMethod, "MANUAL_REG_ID");
        assert.equal(pushedAttendance.checkedInBy.toString(), assignedOrgId.toString());
    });

    // 27. Legacy attendance records remain readable
    test("27. Legacy attendance records without checkInMethod remain fully readable", async (context) => {
        const regId = makeId();
        const regDoc = {
            _id: regId,
            event: standardEvent,
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            participantDetails: { fullName: "Legacy Attendee" },
            access: { type: "SINGLE_EVENT", eligibleEventIds: [standardEventId] },
            // Legacy record has eventId and checkedInAt, but no checkInMethod
            eventAttendance: [{ eventId: standardEventId, checkedInAt: new Date("2026-11-20T10:00:00Z") }]
        };

        context.mock.method(Event, "findById", () => ({ select: async () => standardEvent }));
        context.mock.method(Registration, "findById", () => ({
            select: () => ({ populate: () => ({ populate: async () => regDoc }) })
        }));

        const req = { body: { registrationId: regId.toString(), eventId: standardEventId.toString() }, user: { role: "ADMIN" } };
        const res = mockResponse();
        await lookupRegistrationForManualCheckIn(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.data.eligibility.alreadyCheckedIn, true);
    });

    // 28. No existing registration/payment/capacity regressions
    test("28. Manual check-in never modifies capacity, registeredParticipants, or payment details", async (context) => {
        const regId = makeId();
        const initialPayment = { status: "VERIFIED", method: "UPI", receivedAmount: 250 };
        const regDoc = {
            _id: regId,
            event: standardEvent,
            status: "REGISTERED",
            payment: { ...initialPayment },
            participantDetails: { fullName: "Alice" },
            attendance: { isPresent: false },
            access: { type: "SINGLE_EVENT", eligibleEventIds: [standardEventId] },
            eventAttendance: []
        };

        context.mock.method(Event, "findById", () => ({ select: async () => standardEvent }));
        context.mock.method(Registration, "findById", () => ({
            populate: () => ({ populate: async () => regDoc })
        }));

        let updateQueryExecuted = null;
        context.mock.method(Registration, "findOneAndUpdate", (query, update) => {
            updateQueryExecuted = update;
            regDoc.attendance.isPresent = true;
            return regDoc;
        });

        const req = {
            body: { registrationId: regId.toString(), eventId: standardEventId.toString(), identityConfirmed: true },
            user: { role: "ADMIN" }
        };
        const res = mockResponse();
        await markManualAttendance(req, res);

        assert.equal(res.statusCode, 200);
        assert.deepEqual(regDoc.payment, initialPayment);
        assert.equal(updateQueryExecuted.$set["payment.status"], undefined);
    });
});
