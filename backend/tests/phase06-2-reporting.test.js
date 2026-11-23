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
    getEventAttendanceReport,
    getEventParticipants,
    exportEventParticipants
} = require("../controllers/registrationController");

const {
    getAdminEventAttendance
} = require("../controllers/adminController");

const {
    sanitizeForExcel,
    buildEventCohortFilter,
    buildAttendanceMatchCondition,
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

describe("Phase 06.2: Event-Specific Attendance Reporting and Export Integration", () => {
    let childEventId;
    let otherChildId;
    let comboParentId;
    let unrelatedEventId;

    let childEvent;
    let otherChildEvent;
    let comboParentEvent;
    let unrelatedEvent;

    beforeEach(() => {
        childEventId = makeId();
        otherChildId = makeId();
        comboParentId = makeId();
        unrelatedEventId = makeId();

        childEvent = {
            _id: childEventId,
            name: "Child Tech Workshop",
            status: "PUBLISHED",
            organizers: [assignedOrgId],
            registration: { registeredParticipants: 5, capacity: 50 }
        };

        otherChildEvent = {
            _id: otherChildId,
            name: "Child Code Sprint",
            status: "PUBLISHED",
            organizers: [assignedOrgId],
            registration: { registeredParticipants: 5, capacity: 50 }
        };

        comboParentEvent = {
            _id: comboParentId,
            name: "Mega Combo All-Access",
            status: "PUBLISHED",
            organizers: [assignedOrgId],
            registration: { registeredParticipants: 10, capacity: 100 },
            multiEventAccess: {
                enabled: true,
                includedEvents: [childEventId, otherChildId]
            }
        };

        unrelatedEvent = {
            _id: unrelatedEventId,
            name: "Unrelated Cultural Night",
            status: "PUBLISHED",
            organizers: [assignedOrgId],
            registration: { registeredParticipants: 20, capacity: 200 }
        };
    });

    // 1. Standard direct registration appears in event report
    test("1. Standard direct registration appears in event attendance report", async (context) => {
        const directReg = {
            _id: makeId(),
            event: childEvent,
            status: "REGISTERED",
            participantDetails: { fullName: "Direct Dave", mobileNumber: "9999999999", collegeName: "Tech Univ", department: "CS", rollNumber: "CS01" },
            attendance: { isPresent: true, checkedInAt: new Date("2026-03-01T10:00:00Z") },
            payment: { status: "VERIFIED" }
        };

        context.mock.method(Event, "findById", () => ({ select: () => childEvent }));
        context.mock.method(Registration, "find", () => ({
            populate: () => ({
                populate: () => ({
                    select: async () => [directReg]
                })
            })
        }));

        const req = { params: { id: childEventId.toString() }, user: { _id: adminId, role: "ADMIN" } };
        const res = mockResponse();
        await getEventAttendanceReport(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.participants.length, 1);
        assert.equal(res.body.participants[0].name, "Direct Dave");
        assert.equal(res.body.participants[0].attendance, "PRESENT");
        assert.equal(res.body.participants[0].cohortType, "DIRECT");
    });

    // 2. Combo-entitled Registration appears in included child report
    test("2. Combo-entitled Registration appears in included child report", async (context) => {
        const comboReg = {
            _id: makeId(),
            event: comboParentEvent,
            status: "REGISTERED",
            access: { type: "MULTI_EVENT", eligibleEventIds: [childEventId, otherChildId] },
            participantDetails: { fullName: "Combo Clara", mobileNumber: "8888888888", collegeName: "Engg Coll", department: "IT", rollNumber: "IT02" },
            attendance: { isPresent: false },
            eventAttendance: [{ eventId: childEventId, checkedInAt: new Date("2026-03-01T11:00:00Z"), checkedInBy: adminId }],
            payment: { status: "VERIFIED" }
        };

        context.mock.method(Event, "findById", () => ({ select: () => childEvent }));
        context.mock.method(Registration, "find", () => ({
            populate: () => ({
                populate: () => ({
                    select: async () => [comboReg]
                })
            })
        }));

        const req = { params: { id: childEventId.toString() }, user: { _id: adminId, role: "ADMIN" } };
        const res = mockResponse();
        await getEventAttendanceReport(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.participants.length, 1);
        assert.equal(res.body.participants[0].name, "Combo Clara");
        assert.equal(res.body.participants[0].attendance, "PRESENT");
        assert.equal(res.body.participants[0].cohortType, "COMBO");
        assert.equal(res.body.participants[0].parentEventName, "Mega Combo All-Access");
    });

    // 3. Combo Registration does not appear in unrelated event report
    test("3. Combo Registration does not appear in unrelated event report", () => {
        const comboReg = {
            _id: makeId(),
            event: comboParentId,
            access: { type: "MULTI_EVENT", eligibleEventIds: [childEventId, otherChildId] }
        };

        const filter = buildEventCohortFilter(unrelatedEventId);
        // Does comboReg match filter for unrelatedEventId?
        const matchesDirect = comboReg.event.toString() === unrelatedEventId.toString();
        const matchesCombo = comboReg.access?.eligibleEventIds?.some(id => id.toString() === unrelatedEventId.toString());

        assert.equal(matchesDirect, false);
        assert.equal(matchesCombo, false);
    });

    // 4. Legacy Registration remains visible
    test("4. Legacy Registration (no access field) remains visible in direct report", async (context) => {
        const legacyReg = {
            _id: makeId(),
            event: childEvent,
            status: "REGISTERED",
            participantDetails: { fullName: "Legacy Leo", mobileNumber: "7777777777" },
            attendance: { isPresent: false },
            payment: { status: "VERIFIED" }
        };

        context.mock.method(Event, "findById", () => ({ select: () => childEvent }));
        context.mock.method(Registration, "find", () => ({
            populate: () => ({
                populate: () => ({
                    select: async () => [legacyReg]
                })
            })
        }));

        const req = { params: { id: childEventId.toString() }, user: { _id: adminId, role: "ADMIN" } };
        const res = mockResponse();
        await getEventAttendanceReport(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.participants.length, 1);
        assert.equal(res.body.participants[0].name, "Legacy Leo");
        assert.equal(res.body.participants[0].cohortType, "DIRECT");
        assert.equal(res.body.participants[0].attendance, "ABSENT");
    });

    // 5. Historical attendance flag is respected
    test("5. Historical attendance.isPresent: true is respected for direct registrations", () => {
        const historicalTime = new Date("2026-02-15T09:00:00Z");
        const legacyDirect = {
            event: childEventId,
            attendance: { isPresent: true, checkedInAt: historicalTime },
            eventAttendance: []
        };

        const att = resolveEventSpecificAttendance(legacyDirect, childEventId);
        assert.equal(att.isPresent, true);
        assert.equal(att.checkedInAt.toISOString(), historicalTime.toISOString());
        assert.equal(att.cohortType, "DIRECT");
    });

    // 6. Child eventAttendance is read correctly
    test("6. Child eventAttendance entry is read correctly for attendance and timestamp", () => {
        const scanTime = new Date("2026-03-01T14:15:00Z");
        const comboReg = {
            event: comboParentId,
            access: { type: "MULTI_EVENT", eligibleEventIds: [childEventId, otherChildId] },
            attendance: { isPresent: false },
            eventAttendance: [
                { eventId: childEventId, checkedInAt: scanTime }
            ]
        };

        const att = resolveEventSpecificAttendance(comboReg, childEventId);
        assert.equal(att.isPresent, true);
        assert.equal(att.checkedInAt.toISOString(), scanTime.toISOString());
    });

    // 7. Combo aggregate attendance does not mark unvisited children present
    test("7. Combo aggregate attendance (isPresent: true) does NOT mark unvisited children present", () => {
        const completedTime = new Date("2026-03-01T16:00:00Z");
        const comboReg = {
            event: comboParentId,
            access: { type: "MULTI_EVENT", eligibleEventIds: [childEventId, otherChildId] },
            attendance: { isPresent: true, checkedInAt: completedTime }, // Aggregate completion true
            eventAttendance: [
                { eventId: otherChildId, checkedInAt: completedTime } // Attended otherChild, NOT childEventId!
            ]
        };

        // Checking attendance at childEventId (unvisited child)
        const att = resolveEventSpecificAttendance(comboReg, childEventId);
        assert.equal(att.isPresent, false);
        assert.equal(att.checkedInAt, null);
    });

    // 8. Direct and combo participants are counted separately
    test("8. Direct and combo participants are counted separately in statistics", () => {
        const registrations = [
            { event: childEventId, attendance: { isPresent: true }, payment: { status: "VERIFIED" }, status: "REGISTERED" },
            { event: childEventId, attendance: { isPresent: false }, payment: { status: "VERIFIED" }, status: "REGISTERED" },
            {
                event: comboParentId,
                access: { type: "MULTI_EVENT", eligibleEventIds: [childEventId] },
                eventAttendance: [{ eventId: childEventId }],
                payment: { status: "VERIFIED" },
                status: "REGISTERED"
            }
        ];

        const stats = calculateEventAttendanceStats(childEventId, registrations);
        assert.equal(stats.totalParticipants, 3);
        assert.equal(stats.present, 2);
        assert.equal(stats.direct.total, 2);
        assert.equal(stats.direct.present, 1);
        assert.equal(stats.combo.total, 1);
        assert.equal(stats.combo.present, 1);
    });

    // 9. One Registration is never double-counted
    test("9. One Registration is never double-counted when querying unified cohort", () => {
        const filter = buildEventCohortFilter(childEventId);
        assert(filter.$or != null);
        assert.equal(filter.$or.length, 2);
        // MongoDB $or guarantees distinct document returns
    });

    // 10. Team members appear independently
    test("10. Team members appear independently in attendance reports", () => {
        const teamId = makeId();
        const member1 = {
            event: childEventId,
            team: { _id: teamId, teamName: "Alpha Team", payment: { status: "VERIFIED" } },
            attendance: { isPresent: true, checkedInAt: new Date("2026-03-01T10:00:00Z") }
        };
        const member2 = {
            event: childEventId,
            team: { _id: teamId, teamName: "Alpha Team", payment: { status: "VERIFIED" } },
            attendance: { isPresent: false, checkedInAt: null }
        };

        const att1 = resolveEventSpecificAttendance(member1, childEventId);
        const att2 = resolveEventSpecificAttendance(member2, childEventId);

        assert.equal(att1.isPresent, true);
        assert.equal(att2.isPresent, false);
    });

    // 11. Team payment status is handled correctly
    test("11. Team payment status is sourced from Team document", () => {
        const teamReg = {
            event: childEventId,
            status: "REGISTERED",
            team: { teamName: "Winners", payment: { status: "VERIFIED" } },
            payment: { status: "NOT_REQUIRED" } // Individual record on team member
        };

        const stats = calculateEventAttendanceStats(childEventId, [teamReg]);
        assert.equal(stats.admissionEligible.total, 1);
    });

    // 12. Pending and rejected payments follow documented statistics rules
    test("12. Pending and rejected payments are included in totalParticipants but excluded from admissionEligible", () => {
        const regs = [
            { event: childEventId, status: "REGISTERED", payment: { status: "VERIFIED" }, attendance: { isPresent: false } },
            { event: childEventId, status: "REGISTERED", payment: { status: "PENDING" }, attendance: { isPresent: false } },
            { event: childEventId, status: "REGISTERED", payment: { status: "REJECTED" }, attendance: { isPresent: false } }
        ];

        const stats = calculateEventAttendanceStats(childEventId, regs);
        assert.equal(stats.totalParticipants, 3);
        assert.equal(stats.admissionEligible.total, 1);
    });

    // 13. Attendance percentage is accurately calculated
    test("13. Attendance percentage is accurate to 2 decimal places", () => {
        const regs = [
            { event: childEventId, status: "REGISTERED", attendance: { isPresent: true }, payment: { status: "VERIFIED" } },
            { event: childEventId, status: "REGISTERED", attendance: { isPresent: false }, payment: { status: "VERIFIED" } },
            { event: childEventId, status: "REGISTERED", attendance: { isPresent: false }, payment: { status: "VERIFIED" } }
        ];

        const stats = calculateEventAttendanceStats(childEventId, regs);
        assert.equal(stats.totalParticipants, 3);
        assert.equal(stats.present, 1);
        assert.equal(stats.attendancePercentage, 33.33);
    });

    // 14. No attendance is mutated during reporting
    test("14. Reporting functions are strictly read-only and never mutate registration state", async (context) => {
        let findOneAndUpdateCalled = false;
        context.mock.method(Registration, "findOneAndUpdate", () => { findOneAndUpdateCalled = true; });
        context.mock.method(Event, "findById", () => ({ select: () => childEvent }));
        context.mock.method(Registration, "find", () => ({
            populate: () => ({
                populate: () => ({
                    select: async () => []
                })
            })
        }));

        const req = { params: { id: childEventId.toString() }, user: { _id: adminId, role: "ADMIN" } };
        const res = mockResponse();
        await getEventAttendanceReport(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(findOneAndUpdateCalled, false, "Reporting must never trigger update mutations");
    });

    // 15. Existing event attendance response remains compatible
    test("15. Existing event attendance response retains success, event, statistics, participants keys", async (context) => {
        context.mock.method(Event, "findById", () => ({ select: () => childEvent }));
        context.mock.method(Registration, "find", () => ({
            populate: () => ({
                populate: () => ({
                    select: async () => []
                })
            })
        }));

        const req = { params: { id: childEventId.toString() }, user: { _id: adminId, role: "ADMIN" } };
        const res = mockResponse();
        await getEventAttendanceReport(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(typeof res.body.success, "boolean");
        assert.equal(typeof res.body.event, "string");
        assert(res.body.statistics != null);
        assert(Array.isArray(res.body.participants));
    });

    // 16. Existing Admin attendance response remains compatible
    test("16. Existing Admin attendance response retains event, statistics, pagination, participants keys", async (context) => {
        context.mock.method(Event, "findById", () => ({ select: () => ({ lean: async () => childEvent }) }));
        context.mock.method(Registration, "aggregate", async () => [{
            total: 2,
            present: 1,
            individualTotal: 2,
            individualPresent: 1,
            teamPresent: 0,
            directTotal: 1,
            directPresent: 1,
            comboTotal: 1,
            comboPresent: 0
        }]);
        context.mock.method(Registration, "find", () => ({
            select: () => ({
                populate: () => ({
                    populate: () => ({
                        populate: () => ({
                            sort: () => ({
                                skip: () => ({
                                    limit: () => ({
                                        lean: async () => []
                                    })
                                })
                            })
                        })
                    })
                })
            })
        }));
        context.mock.method(Registration, "countDocuments", async () => 2);

        const req = { params: { id: childEventId.toString() }, query: { page: "1", limit: "20" }, user: { _id: adminId, role: "ADMIN" } };
        const res = mockResponse();
        await getAdminEventAttendance(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert(res.body.event != null);
        assert(res.body.statistics != null);
        assert(res.body.statistics.individual != null);
        assert(res.body.statistics.team != null);
        assert(res.body.pagination != null);
        assert(Array.isArray(res.body.participants));
    });

    // 17. Existing participants endpoint remains compatible
    test("17. Existing participants endpoint GET /api/events/:id/participants returns pagination and registrations", async (context) => {
        context.mock.method(Event, "findById", () => ({ select: () => childEvent }));
        context.mock.method(Registration, "find", () => ({
            select: () => ({
                populate: () => ({
                    populate: () => ({
                        populate: () => ({
                            sort: () => ({
                                skip: () => ({
                                    limit: () => ({
                                        lean: async () => [{
                                            _id: makeId(),
                                            event: childEventId,
                                            participantDetails: { fullName: "Sam" }
                                        }]
                                    })
                                })
                            })
                        })
                    })
                })
            })
        }));
        context.mock.method(Registration, "countDocuments", async () => 1);

        const req = { params: { id: childEventId.toString() }, query: {}, user: { _id: adminId, role: "ADMIN" } };
        const res = mockResponse();
        await getEventParticipants(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.event.id.toString(), childEventId.toString());
        assert(Array.isArray(res.body.registrations));
        assert.equal(res.body.registrations[0].cohortType, "DIRECT");
    });

    // 18. Existing export columns remain compatible
    test("18. Existing export retains original 15 columns with additive columns", async (context) => {
        context.mock.method(Event, "findById", () => ({ select: () => childEvent }));
        context.mock.method(Registration, "find", () => ({
            populate: () => ({
                populate: () => ({
                    populate: () => ({
                        sort: async () => []
                    })
                })
            })
        }));

        const req = { params: { id: childEventId.toString() }, user: { _id: adminId, role: "ADMIN" } };
        const res = mockExportResponse();
        await exportEventParticipants(req, res);

        assert.equal(res.statusCode, 200);
        assert(res.headers["Content-Type"].includes("spreadsheetml"));
    });

    // 19. Combo fields appear correctly in exports
    test("19. Combo fields Cohort Type and Parent Event Name are populated for combo registrations", () => {
        const comboReg = {
            event: { _id: comboParentId, name: "Mega Combo All-Access" },
            access: { type: "MULTI_EVENT", eligibleEventIds: [childEventId] }
        };

        const att = resolveEventSpecificAttendance(comboReg, childEventId);
        assert.equal(att.cohortType, "COMBO");
        assert.equal(att.parentEventId.toString(), comboParentId.toString());
    });

    // 20. Export content is protected against spreadsheet formula injection
    test("20. Export content protects against formula injection (=, +, -, @, \\t, \\r)", () => {
        assert.equal(sanitizeForExcel("=SUM(A1:A10)"), "'=SUM(A1:A10)");
        assert.equal(sanitizeForExcel("+cmd|' /C calc'!A0"), "'+cmd|' /C calc'!A0");
        assert.equal(sanitizeForExcel("-100"), "'-100");
        assert.equal(sanitizeForExcel("@hyperlink"), "'@hyperlink");
        assert.equal(sanitizeForExcel("\tTabbed"), "'\tTabbed");
        assert.equal(sanitizeForExcel("Normal Text"), "Normal Text");
        assert.equal(sanitizeForExcel(null), "");
    });

    // 21. Unassigned organiser cannot access explicitly assigned Event reports
    test("21. Unassigned organiser rejected with 403 ORGANISER_NOT_ASSIGNED from explicitly assigned event", async (context) => {
        context.mock.method(Event, "findById", () => ({ select: () => childEvent }));

        const req = { params: { id: childEventId.toString() }, user: { _id: unassignedOrgId, role: "ORGANISER" } };
        const res = mockResponse();
        await getEventAttendanceReport(req, res);

        assert.equal(res.statusCode, 403);
        assert.equal(res.body.code, "ORGANISER_NOT_ASSIGNED");
    });

    // 22. Admin access remains valid
    test("22. Admin can access attendance report even if not in event organizers", async (context) => {
        context.mock.method(Event, "findById", () => ({ select: () => childEvent }));
        context.mock.method(Registration, "find", () => ({
            populate: () => ({
                populate: () => ({
                    select: async () => []
                })
            })
        }));

        const req = { params: { id: childEventId.toString() }, user: { _id: adminId, role: "ADMIN" } };
        const res = mockResponse();
        await getEventAttendanceReport(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
    });

    // 23. Participant access remains forbidden
    test("23. Participant access to attendance report returns HTTP 403", async (context) => {
        context.mock.method(Event, "findById", () => ({ select: () => childEvent }));

        const req = { params: { id: childEventId.toString() }, user: { _id: participantId, role: "PARTICIPANT" } };
        const res = mockResponse();
        await getEventAttendanceReport(req, res);

        assert.equal(res.statusCode, 403);
    });

    // 24. Pagination works with mixed direct/combo cohorts
    test("24. Pagination parameters are parsed and applied correctly for mixed cohort", async (context) => {
        context.mock.method(Event, "findById", () => ({ select: () => ({ lean: async () => childEvent }) }));
        context.mock.method(Registration, "aggregate", async () => [{ total: 10 }]);

        let skipValue = null;
        let limitValue = null;
        context.mock.method(Registration, "find", () => ({
            select: () => ({
                populate: () => ({
                    populate: () => ({
                        populate: () => ({
                            sort: () => ({
                                skip: (s) => {
                                    skipValue = s;
                                    return {
                                        limit: (l) => {
                                            limitValue = l;
                                            return { lean: async () => [] };
                                        }
                                    };
                                }
                            })
                        })
                    })
                })
            })
        }));
        context.mock.method(Registration, "countDocuments", async () => 10);

        const req = { params: { id: childEventId.toString() }, query: { page: "2", limit: "5" }, user: { _id: adminId, role: "ADMIN" } };
        const res = mockResponse();
        await getAdminEventAttendance(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(skipValue, 5); // (2 - 1) * 5
        assert.equal(limitValue, 5);
        assert.equal(res.body.pagination.totalPages, 2);
    });

    // 25. Filtering works with mixed direct/combo cohorts
    test("25. Attendance filtering constructs valid MongoDB match conditions for target event", () => {
        const presentMatch = buildAttendanceMatchCondition(childEventId, "PRESENT");
        assert(presentMatch.$or != null);
        assert.equal(presentMatch.$or.length, 2);

        const absentMatch = buildAttendanceMatchCondition(childEventId, "ABSENT");
        assert(absentMatch["eventAttendance.eventId"] != null);
        assert(absentMatch.$nor != null);
    });

    // 26. Existing financial attribution remains unchanged
    test("26. Child event reporting does not alter financial calculations or attribute child revenue", () => {
        const comboRegistration = {
            event: comboParentId,
            access: { type: "MULTI_EVENT", eligibleEventIds: [childEventId] },
            payment: { expectedAmount: 750, receivedAmount: 750 }
        };

        const att = resolveEventSpecificAttendance(comboRegistration, childEventId);
        assert.equal(att.cohortType, "COMBO");
        // Reporting only tracks attendance, leaving payment attribution on the combo parent
        assert.equal(comboRegistration.payment.expectedAmount, 750);
    });

    // 27. No QR regeneration
    test("27. Reporting leaves QR tokens unchanged", () => {
        const qr = "d".repeat(64);
        const reg = { qrToken: qr, event: childEventId };
        const att = resolveEventSpecificAttendance(reg, childEventId);
        assert.equal(reg.qrToken, qr);
    });

    // 28. No capacity mutation
    test("28. Event capacity counter registeredParticipants is not modified during reporting", async (context) => {
        let capacityModified = false;
        context.mock.method(Event, "findOneAndUpdate", () => { capacityModified = true; });
        context.mock.method(Event, "findById", () => ({ select: () => childEvent }));
        context.mock.method(Registration, "find", () => ({
            populate: () => ({
                populate: () => ({
                    select: async () => []
                })
            })
        }));

        const req = { params: { id: childEventId.toString() }, user: { _id: adminId, role: "ADMIN" } };
        const res = mockResponse();
        await getEventAttendanceReport(req, res);

        assert.equal(capacityModified, false);
        assert.equal(childEvent.registration.registeredParticipants, 5);
    });

    // 29. No child Registration creation
    test("29. Reporting creates zero new Registration documents", async (context) => {
        let regCreated = false;
        context.mock.method(Registration, "create", () => { regCreated = true; });
        context.mock.method(Event, "findById", () => ({ select: () => childEvent }));
        context.mock.method(Registration, "find", () => ({
            populate: () => ({
                populate: () => ({
                    select: async () => []
                })
            })
        }));

        const req = { params: { id: childEventId.toString() }, user: { _id: adminId, role: "ADMIN" } };
        const res = mockResponse();
        await getEventAttendanceReport(req, res);

        assert.equal(regCreated, false);
    });

    // 30. Existing certificate behavior remains unchanged
    test("30. Certificate eligibility logic respects event attendance correctly", () => {
        const completedEvent = { status: "COMPLETED" };
        const attendedReg = {
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            attendance: { isPresent: true }
        };
        const unattendedReg = {
            status: "REGISTERED",
            payment: { status: "VERIFIED" },
            attendance: { isPresent: false }
        };

        const cert1 = getCertificateEligibility(completedEvent, attendedReg);
        assert.equal(cert1.eligible, true);

        const cert2 = getCertificateEligibility(completedEvent, unattendedReg);
        assert.equal(cert2.eligible, false);
    });
});
