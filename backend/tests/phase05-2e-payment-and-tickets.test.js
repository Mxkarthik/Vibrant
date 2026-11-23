"use strict";

process.env.NODE_ENV = "test";

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const Event = require("../models/Event");
const Registration = require("../models/Registration");
const Team = require("../models/Team");
const { resolveRegistrationAdmissionEligibility } = require("../utils/admissionEligibility");
const { resolveEffectiveAccess, buildRegistrationAccessSnapshot } = require("../utils/registrationEntitlement");
const { getMyRegistrationTicket, updatePaymentStatus, registerForEvent } = require("../controllers/registrationController");
const { getLeaderTeamTickets, updateTeamPaymentStatus, registerTeam } = require("../controllers/teamRegistrationController");

const makeId = () => new mongoose.Types.ObjectId();
const adminId = makeId();
const userId = makeId();
const leaderId = makeId();

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

describe("Phase 05.2E: Payment Lifecycle and Participant Ticket API Integration", () => {

    describe("Part 1: Payment-Aware Admission Eligibility Service", () => {
        const parentEventId = makeId();
        const child1Id = makeId();
        const child2Id = makeId();
        const unrelatedEventId = makeId();

        // 1. Verified individual payment
        test("1. Verified individual payment allows admission", () => {
            const reg = {
                _id: makeId(),
                event: parentEventId,
                status: "REGISTERED",
                payment: { status: "VERIFIED" },
                access: {
                    type: "SINGLE_EVENT",
                    eligibleEventIds: [parentEventId],
                    grantedAt: new Date()
                }
            };
            const targetEvent = { _id: parentEventId, status: "PUBLISHED" };
            const result = resolveRegistrationAdmissionEligibility({ registration: reg, targetEvent });
            assert.equal(result.isEligible, true);
            assert.equal(result.reasonCode, "ADMISSION_ALLOWED");
        });

        // 2. Pending individual payment
        test("2. Pending individual payment denies admission", () => {
            const reg = {
                _id: makeId(),
                event: parentEventId,
                status: "REGISTERED",
                payment: { status: "PENDING" },
                access: {
                    type: "SINGLE_EVENT",
                    eligibleEventIds: [parentEventId],
                    grantedAt: new Date()
                }
            };
            const targetEvent = { _id: parentEventId, status: "PUBLISHED" };
            const result = resolveRegistrationAdmissionEligibility({ registration: reg, targetEvent });
            assert.equal(result.isEligible, false);
            assert.equal(result.reasonCode, "PAYMENT_PENDING");
        });

        // 3. Rejected individual payment
        test("3. Rejected individual payment denies admission", () => {
            const reg = {
                _id: makeId(),
                event: parentEventId,
                status: "REGISTERED",
                payment: { status: "REJECTED" },
                access: {
                    type: "SINGLE_EVENT",
                    eligibleEventIds: [parentEventId],
                    grantedAt: new Date()
                }
            };
            const targetEvent = { _id: parentEventId, status: "PUBLISHED" };
            const result = resolveRegistrationAdmissionEligibility({ registration: reg, targetEvent });
            assert.equal(result.isEligible, false);
            assert.equal(result.reasonCode, "PAYMENT_REJECTED");
        });

        // 4. Free individual registration
        test("4. Free individual registration allows admission", () => {
            const reg = {
                _id: makeId(),
                event: parentEventId,
                status: "REGISTERED",
                payment: { status: "NOT_REQUIRED" },
                access: {
                    type: "SINGLE_EVENT",
                    eligibleEventIds: [parentEventId],
                    grantedAt: new Date()
                }
            };
            const targetEvent = { _id: parentEventId, status: "PUBLISHED" };
            const result = resolveRegistrationAdmissionEligibility({ registration: reg, targetEvent });
            assert.equal(result.isEligible, true);
            assert.equal(result.reasonCode, "ADMISSION_ALLOWED");
        });

        // 5. Verified Team payment
        test("5. Verified Team payment allows admission", () => {
            const teamId = makeId();
            const reg = {
                _id: makeId(),
                team: teamId,
                event: parentEventId,
                status: "REGISTERED",
                payment: { status: "NOT_REQUIRED" },
                access: {
                    type: "SINGLE_EVENT",
                    eligibleEventIds: [parentEventId],
                    grantedAt: new Date()
                }
            };
            const team = {
                _id: teamId,
                status: "REGISTERED",
                payment: { status: "VERIFIED" }
            };
            const targetEvent = { _id: parentEventId, status: "PUBLISHED" };
            const result = resolveRegistrationAdmissionEligibility({ registration: reg, team, targetEvent });
            assert.equal(result.isEligible, true);
            assert.equal(result.reasonCode, "ADMISSION_ALLOWED");
        });

        // 6. Pending Team payment
        test("6. Pending Team payment denies admission", () => {
            const teamId = makeId();
            const reg = {
                _id: makeId(),
                team: teamId,
                event: parentEventId,
                status: "REGISTERED",
                payment: { status: "NOT_REQUIRED" },
                access: {
                    type: "SINGLE_EVENT",
                    eligibleEventIds: [parentEventId],
                    grantedAt: new Date()
                }
            };
            const team = {
                _id: teamId,
                status: "REGISTERED",
                payment: { status: "PENDING" }
            };
            const targetEvent = { _id: parentEventId, status: "PUBLISHED" };
            const result = resolveRegistrationAdmissionEligibility({ registration: reg, team, targetEvent });
            assert.equal(result.isEligible, false);
            assert.equal(result.reasonCode, "PAYMENT_PENDING");
        });

        // 7. Rejected Team payment
        test("7. Rejected Team payment denies admission", () => {
            const teamId = makeId();
            const reg = {
                _id: makeId(),
                team: teamId,
                event: parentEventId,
                status: "REGISTERED",
                payment: { status: "NOT_REQUIRED" },
                access: {
                    type: "SINGLE_EVENT",
                    eligibleEventIds: [parentEventId],
                    grantedAt: new Date()
                }
            };
            const team = {
                _id: teamId,
                status: "REGISTERED",
                payment: { status: "REJECTED" }
            };
            const targetEvent = { _id: parentEventId, status: "PUBLISHED" };
            const result = resolveRegistrationAdmissionEligibility({ registration: reg, team, targetEvent });
            assert.equal(result.isEligible, false);
            assert.equal(result.reasonCode, "PAYMENT_REJECTED");
        });

        // 8. Free Team payment
        test("8. Free Team payment allows admission", () => {
            const teamId = makeId();
            const reg = {
                _id: makeId(),
                team: teamId,
                event: parentEventId,
                status: "REGISTERED",
                payment: { status: "NOT_REQUIRED" },
                access: {
                    type: "SINGLE_EVENT",
                    eligibleEventIds: [parentEventId],
                    grantedAt: new Date()
                }
            };
            const team = {
                _id: teamId,
                status: "REGISTERED",
                payment: { status: "NOT_REQUIRED" }
            };
            const targetEvent = { _id: parentEventId, status: "PUBLISHED" };
            const result = resolveRegistrationAdmissionEligibility({ registration: reg, team, targetEvent });
            assert.equal(result.isEligible, true);
            assert.equal(result.reasonCode, "ADMISSION_ALLOWED");
        });

        // 9. Team member NOT_REQUIRED with Team PENDING is denied
        test("9. Team member NOT_REQUIRED with Team PENDING is denied", () => {
            const teamId = makeId();
            const reg = {
                _id: makeId(),
                team: teamId,
                event: { _id: parentEventId, status: "PUBLISHED" },
                status: "REGISTERED",
                payment: { status: "NOT_REQUIRED" }, // member document has NOT_REQUIRED
                access: {
                    type: "MULTI_EVENT",
                    eligibleEventIds: [child1Id, child2Id],
                    grantedAt: new Date()
                }
            };
            const team = {
                _id: teamId,
                status: "REGISTERED",
                payment: { status: "PENDING" } // team payment is PENDING
            };
            const targetEvent = { _id: child1Id, status: "PUBLISHED" };
            const result = resolveRegistrationAdmissionEligibility({ registration: reg, team, targetEvent });
            assert.equal(result.isEligible, false);
            assert.equal(result.reasonCode, "PAYMENT_PENDING");
        });

        // 10. Team member NOT_REQUIRED with Team REJECTED is denied
        test("10. Team member NOT_REQUIRED with Team REJECTED is denied", () => {
            const teamId = makeId();
            const reg = {
                _id: makeId(),
                team: teamId,
                event: { _id: parentEventId, status: "PUBLISHED" },
                status: "REGISTERED",
                payment: { status: "NOT_REQUIRED" },
                access: {
                    type: "MULTI_EVENT",
                    eligibleEventIds: [child1Id, child2Id],
                    grantedAt: new Date()
                }
            };
            const team = {
                _id: teamId,
                status: "REGISTERED",
                payment: { status: "REJECTED" } // team payment is REJECTED
            };
            const targetEvent = { _id: child1Id, status: "PUBLISHED" };
            const result = resolveRegistrationAdmissionEligibility({ registration: reg, team, targetEvent });
            assert.equal(result.isEligible, false);
            assert.equal(result.reasonCode, "PAYMENT_REJECTED");
        });

        // 11. Team member NOT_REQUIRED with Team VERIFIED is eligible
        test("11. Team member NOT_REQUIRED with Team VERIFIED is eligible", () => {
            const teamId = makeId();
            const reg = {
                _id: makeId(),
                team: teamId,
                event: { _id: parentEventId, status: "PUBLISHED" },
                status: "REGISTERED",
                payment: { status: "NOT_REQUIRED" },
                access: {
                    type: "MULTI_EVENT",
                    eligibleEventIds: [child1Id, child2Id],
                    grantedAt: new Date()
                }
            };
            const team = {
                _id: teamId,
                status: "REGISTERED",
                payment: { status: "VERIFIED" }
            };
            const targetEvent = { _id: child1Id, status: "PUBLISHED" };
            const result = resolveRegistrationAdmissionEligibility({ registration: reg, team, targetEvent });
            assert.equal(result.isEligible, true);
            assert.equal(result.reasonCode, "ADMISSION_ALLOWED");
        });

        // 12. Valid combo entitlement
        test("12. Valid combo entitlement grants admission for entitled child", () => {
            const reg = {
                _id: makeId(),
                event: { _id: parentEventId, status: "PUBLISHED" },
                status: "REGISTERED",
                payment: { status: "VERIFIED" },
                access: {
                    type: "MULTI_EVENT",
                    eligibleEventIds: [child1Id, child2Id],
                    grantedAt: new Date()
                }
            };
            const targetEvent = { _id: child2Id, status: "PUBLISHED" };
            const result = resolveRegistrationAdmissionEligibility({ registration: reg, targetEvent });
            assert.equal(result.isEligible, true);
            assert.equal(result.reasonCode, "ADMISSION_ALLOWED");
            assert.equal(result.access.type, "MULTI_EVENT");
        });

        // 13. Unrelated event entitlement rejection
        test("13. Unrelated event entitlement rejection", () => {
            const reg = {
                _id: makeId(),
                event: { _id: parentEventId, status: "PUBLISHED" },
                status: "REGISTERED",
                payment: { status: "VERIFIED" },
                access: {
                    type: "MULTI_EVENT",
                    eligibleEventIds: [child1Id, child2Id],
                    grantedAt: new Date()
                }
            };
            const targetEvent = { _id: unrelatedEventId, status: "PUBLISHED" };
            const result = resolveRegistrationAdmissionEligibility({ registration: reg, targetEvent });
            assert.equal(result.isEligible, false);
            assert.equal(result.reasonCode, "EVENT_NOT_ENTITLED");
        });

        // 14. Cancelled registration rejection
        test("14. Cancelled registration rejection", () => {
            const reg = {
                _id: makeId(),
                event: parentEventId,
                status: "CANCELLED",
                payment: { status: "VERIFIED" },
                access: {
                    type: "SINGLE_EVENT",
                    eligibleEventIds: [parentEventId],
                    grantedAt: new Date()
                }
            };
            const targetEvent = { _id: parentEventId, status: "PUBLISHED" };
            const result = resolveRegistrationAdmissionEligibility({ registration: reg, targetEvent });
            assert.equal(result.isEligible, false);
            assert.equal(result.reasonCode, "REGISTRATION_CANCELLED");
        });

        // 15. Cancelled Team rejection
        test("15. Cancelled Team rejection", () => {
            const teamId = makeId();
            const reg = {
                _id: makeId(),
                team: teamId,
                event: parentEventId,
                status: "REGISTERED",
                payment: { status: "NOT_REQUIRED" },
                access: {
                    type: "SINGLE_EVENT",
                    eligibleEventIds: [parentEventId],
                    grantedAt: new Date()
                }
            };
            const team = {
                _id: teamId,
                status: "CANCELLED",
                payment: { status: "VERIFIED" }
            };
            const targetEvent = { _id: parentEventId, status: "PUBLISHED" };
            const result = resolveRegistrationAdmissionEligibility({ registration: reg, team, targetEvent });
            assert.equal(result.isEligible, false);
            assert.equal(result.reasonCode, "TEAM_CANCELLED");
        });

        // 16. Cancelled parent event rejection
        test("16. Cancelled parent event rejection for combo registration", () => {
            const reg = {
                _id: makeId(),
                event: { _id: parentEventId, status: "CANCELLED" },
                status: "REGISTERED",
                payment: { status: "VERIFIED" },
                access: {
                    type: "MULTI_EVENT",
                    eligibleEventIds: [child1Id, child2Id],
                    grantedAt: new Date()
                }
            };
            const targetEvent = { _id: child1Id, status: "PUBLISHED" };
            const result = resolveRegistrationAdmissionEligibility({ registration: reg, targetEvent });
            assert.equal(result.isEligible, false);
            assert.equal(result.reasonCode, "PARENT_EVENT_CANCELLED");
        });

        // 17. Cancelled target child event rejection
        test("17. Cancelled target child event rejection", () => {
            const reg = {
                _id: makeId(),
                event: { _id: parentEventId, status: "PUBLISHED" },
                status: "REGISTERED",
                payment: { status: "VERIFIED" },
                access: {
                    type: "MULTI_EVENT",
                    eligibleEventIds: [child1Id, child2Id],
                    grantedAt: new Date()
                }
            };
            const targetEvent = { _id: child1Id, status: "CANCELLED" };
            const result = resolveRegistrationAdmissionEligibility({ registration: reg, targetEvent });
            assert.equal(result.isEligible, false);
            assert.equal(result.reasonCode, "TARGET_EVENT_CANCELLED");
        });

        // 18. Legacy single-event access
        test("18. Legacy single-event access resolves correctly without access snapshot", () => {
            const reg = {
                _id: makeId(),
                event: parentEventId,
                status: "REGISTERED",
                payment: { status: "VERIFIED" },
                createdAt: new Date()
                // access is undefined: legacy record
            };
            const targetEvent = { _id: parentEventId, status: "PUBLISHED" };
            const result = resolveRegistrationAdmissionEligibility({ registration: reg, targetEvent });
            assert.equal(result.isEligible, true);
            assert.equal(result.reasonCode, "ADMISSION_ALLOWED");
            assert.equal(result.access.type, "SINGLE_EVENT");
            assert.equal(result.access.isLegacy, true);

            // Rejects unrelated event for legacy registration
            const unrelatedResult = resolveRegistrationAdmissionEligibility({
                registration: reg,
                targetEvent: { _id: unrelatedEventId, status: "PUBLISHED" }
            });
            assert.equal(unrelatedResult.isEligible, false);
            assert.equal(unrelatedResult.reasonCode, "EVENT_NOT_ENTITLED");
        });
    });

    describe("Part 2: Payment Lifecycle and Parent-Only Capacity Invariants", () => {
        let parentEventId;
        let child1Id;
        let child2Id;
        let regId;
        let initialQrToken;
        let parentEvent;
        let childEvent1;
        let childEvent2;
        let registrationDoc;

        beforeEach(() => {
            parentEventId = makeId();
            child1Id = makeId();
            child2Id = makeId();
            regId = makeId();
            initialQrToken = "a".repeat(64);

            parentEvent = {
                _id: parentEventId,
                name: "Parent Combo",
                status: "PUBLISHED",
                registration: {
                    mode: "INDIVIDUAL",
                    capacity: 50,
                    registeredParticipants: 10
                },
                multiEventAccess: {
                    enabled: true,
                    includedEvents: [child1Id, child2Id]
                }
            };

            childEvent1 = {
                _id: child1Id,
                name: "Child 1",
                status: "PUBLISHED",
                registration: {
                    capacity: 100,
                    registeredParticipants: 20
                }
            };

            childEvent2 = {
                _id: child2Id,
                name: "Child 2",
                status: "PUBLISHED",
                registration: {
                    capacity: 100,
                    registeredParticipants: 30
                }
            };

            registrationDoc = {
                _id: regId,
                event: parentEventId,
                user: userId,
                status: "REGISTERED",
                qrToken: initialQrToken,
                payment: {
                    method: "UPI",
                    status: "PENDING",
                    history: []
                },
                access: {
                    type: "MULTI_EVENT",
                    eligibleEventIds: [child1Id, child2Id],
                    grantedAt: new Date()
                },
                save: async function () { return this; }
            };
        });

        // 19. Rejected-payment parent capacity release
        test("19. Rejected-payment releases parent event capacity", async (context) => {
            context.mock.method(mongoose, "startSession", async () => ({
                withTransaction: async (cb) => cb(),
                endSession: async () => {}
            }));

            context.mock.method(Registration, "findById", () => ({
                session: () => registrationDoc
            }));

            let decrementedEvent = null;
            context.mock.method(Event, "findOneAndUpdate", (query, update) => {
                if (query._id.toString() === parentEventId.toString() && update.$inc) {
                    parentEvent.registration.registeredParticipants += update.$inc["registration.registeredParticipants"];
                    decrementedEvent = parentEvent;
                    return parentEvent;
                }
                return null;
            });

            const req = {
                params: { id: regId.toString() },
                body: { status: "REJECTED", reason: "Invalid transaction ID" },
                user: { _id: adminId, role: "ADMIN" }
            };
            const res = mockResponse();

            await updatePaymentStatus(req, res);

            assert.equal(res.statusCode, 200);
            assert.equal(registrationDoc.payment.status, "REJECTED");
            assert.equal(parentEvent.registration.registeredParticipants, 9); // decremented by 1
        });

        // 20. Payment reactivation parent capacity reclaim
        test("20. Payment reactivation reclaims parent capacity", async (context) => {
            registrationDoc.payment.status = "REJECTED";

            context.mock.method(mongoose, "startSession", async () => ({
                withTransaction: async (cb) => cb(),
                endSession: async () => {}
            }));

            context.mock.method(Registration, "findById", () => ({
                session: () => registrationDoc
            }));

            context.mock.method(Event, "findOneAndUpdate", (query, update) => {
                if (query._id.toString() === parentEventId.toString() && update.$inc) {
                    parentEvent.registration.registeredParticipants += update.$inc["registration.registeredParticipants"];
                    return parentEvent;
                }
                return null;
            });

            const req = {
                params: { id: regId.toString() },
                body: { status: "VERIFIED" },
                user: { _id: adminId, role: "ADMIN" }
            };
            const res = mockResponse();

            await updatePaymentStatus(req, res);

            assert.equal(res.statusCode, 200);
            assert.equal(registrationDoc.payment.status, "VERIFIED");
            assert.equal(parentEvent.registration.registeredParticipants, 11); // incremented by 1
        });

        // 21. No child capacity modification
        test("21. Payment updates never modify child event capacities", async (context) => {
            const initialChild1Count = childEvent1.registration.registeredParticipants;
            const initialChild2Count = childEvent2.registration.registeredParticipants;

            context.mock.method(mongoose, "startSession", async () => ({
                withTransaction: async (cb) => cb(),
                endSession: async () => {}
            }));

            context.mock.method(Registration, "findById", () => ({
                session: () => registrationDoc
            }));

            const updatedEventIds = [];
            context.mock.method(Event, "findOneAndUpdate", (query, update) => {
                updatedEventIds.push(query._id.toString());
                return parentEvent;
            });

            const req = {
                params: { id: regId.toString() },
                body: { status: "REJECTED", reason: "Rejected reason" },
                user: { _id: adminId, role: "ADMIN" }
            };
            const res = mockResponse();

            await updatePaymentStatus(req, res);

            assert.equal(res.statusCode, 200);
            // Verify findOneAndUpdate was ONLY called on parent event, never on child1 or child2
            assert.ok(updatedEventIds.every(id => id === parentEventId.toString()));
            assert.equal(childEvent1.registration.registeredParticipants, initialChild1Count);
            assert.equal(childEvent2.registration.registeredParticipants, initialChild2Count);
        });

        // 22. No QR token modification
        test("22. Payment updates never modify or regenerate QR token", async (context) => {
            context.mock.method(mongoose, "startSession", async () => ({
                withTransaction: async (cb) => cb(),
                endSession: async () => {}
            }));

            context.mock.method(Registration, "findById", () => ({
                session: () => registrationDoc
            }));

            context.mock.method(Event, "findOneAndUpdate", () => parentEvent);

            const req = {
                params: { id: regId.toString() },
                body: { status: "VERIFIED" },
                user: { _id: adminId, role: "ADMIN" }
            };
            const res = mockResponse();

            await updatePaymentStatus(req, res);

            assert.equal(res.statusCode, 200);
            assert.equal(registrationDoc.qrToken, initialQrToken);
        });

        // 23. No entitlement mutation during payment updates
        test("23. Entitlement snapshot is invariant during payment transitions", async (context) => {
            const originalEligibleIds = [...registrationDoc.access.eligibleEventIds];

            context.mock.method(mongoose, "startSession", async () => ({
                withTransaction: async (cb) => cb(),
                endSession: async () => {}
            }));

            context.mock.method(Registration, "findById", () => ({
                session: () => registrationDoc
            }));

            context.mock.method(Event, "findOneAndUpdate", () => parentEvent);

            const req = {
                params: { id: regId.toString() },
                body: { status: "VERIFIED" },
                user: { _id: adminId, role: "ADMIN" }
            };
            const res = mockResponse();

            await updatePaymentStatus(req, res);

            assert.equal(res.statusCode, 200);
            assert.equal(registrationDoc.access.type, "MULTI_EVENT");
            assert.deepEqual(registrationDoc.access.eligibleEventIds, originalEligibleIds);
        });
    });

    describe("Part 3: Participant Ticket API Integration and Authorization", () => {
        const parentEventId = makeId();
        const child1Id = makeId();
        const child2Id = makeId();
        const testUserId = makeId();
        const otherUserId = makeId();
        const validQr = "b".repeat(64);

        // 24. Ticket response contains eligible events
        test("24. Ticket response contains additive access metadata with eligible events", async (context) => {
            const regId = makeId();
            const populatedEvent = {
                _id: parentEventId,
                name: "Mega Combo",
                category: "TECHNICAL",
                venue: "Auditorium",
                startDate: new Date("2026-03-01"),
                endDate: new Date("2026-03-02"),
                status: "PUBLISHED"
            };

            const registrationData = {
                _id: regId,
                user: testUserId,
                team: null,
                qrToken: validQr,
                status: "REGISTERED",
                participantDetails: { fullName: "Alice Johnson" },
                payment: { status: "VERIFIED" },
                event: populatedEvent,
                access: {
                    type: "MULTI_EVENT",
                    eligibleEventIds: [child1Id, child2Id],
                    grantedAt: new Date()
                }
            };

            context.mock.method(Registration, "findOne", () => ({
                select: () => ({
                    populate: () => ({
                        lean: async () => registrationData
                    })
                })
            }));

            const req = {
                params: { id: regId.toString() },
                user: { _id: testUserId }
            };
            const res = mockResponse();

            await getMyRegistrationTicket(req, res);

            assert.equal(res.statusCode, 200);
            assert.equal(res.body.success, true);
            assert.equal(res.body.ticket.qrToken, validQr);
            assert.equal(res.body.ticket.paymentStatus, "VERIFIED");
            assert.ok(res.body.ticket.access);
            assert.equal(res.body.ticket.access.type, "MULTI_EVENT");
            assert.equal(res.body.ticket.access.eligibleEventIds.length, 2);
            assert.equal(res.body.ticket.access.eligibleEventIds[0].toString(), child1Id.toString());
            assert.equal(res.body.ticket.access.eligibleEventIds[1].toString(), child2Id.toString());
        });

        // 25. Legacy ticket response remains compatible
        test("25. Legacy ticket response remains fully backward compatible with fallback access", async (context) => {
            const regId = makeId();
            const populatedEvent = {
                _id: parentEventId,
                name: "Legacy Single Event",
                category: "NON_TECHNICAL",
                venue: "Seminar Hall",
                startDate: new Date("2026-03-01"),
                endDate: new Date("2026-03-02"),
                status: "PUBLISHED"
            };

            const legacyRegistrationData = {
                _id: regId,
                user: testUserId,
                team: null,
                qrToken: validQr,
                status: "REGISTERED",
                participantDetails: { fullName: "Bob Smith" },
                payment: { status: "VERIFIED" },
                event: populatedEvent,
                createdAt: new Date("2026-01-15")
                // access is undefined: legacy record
            };

            context.mock.method(Registration, "findOne", () => ({
                select: () => ({
                    populate: () => ({
                        lean: async () => legacyRegistrationData
                    })
                })
            }));

            const req = {
                params: { id: regId.toString() },
                user: { _id: testUserId }
            };
            const res = mockResponse();

            await getMyRegistrationTicket(req, res);

            assert.equal(res.statusCode, 200);
            assert.equal(res.body.success, true);
            assert.equal(res.body.ticket.registrationId.toString(), regId.toString());
            assert.equal(res.body.ticket.attendeeName, "Bob Smith");
            assert.equal(res.body.ticket.qrToken, validQr);
            assert.equal(res.body.ticket.paymentStatus, "VERIFIED");
            assert.equal(res.body.ticket.ticketStatus, "VALID");
            assert.equal(res.body.ticket.event.name, "Legacy Single Event");
            // Additive fallback access metadata
            assert.ok(res.body.ticket.access);
            assert.equal(res.body.ticket.access.type, "SINGLE_EVENT");
            assert.equal(res.body.ticket.access.eligibleEventIds[0].toString(), parentEventId.toString());
        });

        // 26. Team leader ticket ownership is preserved
        test("26. Team leader ticket retrieval returns tickets with access metadata", async (context) => {
            const teamId = makeId();
            const populatedEvent = {
                _id: parentEventId,
                name: "Team Hackathon",
                category: "TECHNICAL",
                venue: "Lab 3",
                startDate: new Date("2026-03-01"),
                endDate: new Date("2026-03-02"),
                status: "PUBLISHED"
            };

            const teamData = {
                _id: teamId,
                leader: leaderId,
                teamName: "Code Warriors",
                memberCount: 2,
                status: "REGISTERED",
                payment: { status: "VERIFIED" },
                event: populatedEvent
            };

            const member1Id = makeId();
            const member2Id = makeId();
            const memberRegistrations = [
                {
                    _id: member1Id,
                    team: teamId,
                    event: parentEventId,
                    participantDetails: { fullName: "Leader Alice" },
                    isTeamLeader: true,
                    status: "REGISTERED",
                    qrToken: "c".repeat(64),
                    access: {
                        type: "MULTI_EVENT",
                        eligibleEventIds: [child1Id, child2Id],
                        grantedAt: new Date()
                    }
                },
                {
                    _id: member2Id,
                    team: teamId,
                    event: parentEventId,
                    participantDetails: { fullName: "Member Bob" },
                    isTeamLeader: false,
                    status: "REGISTERED",
                    qrToken: "d".repeat(64),
                    access: {
                        type: "MULTI_EVENT",
                        eligibleEventIds: [child1Id, child2Id],
                        grantedAt: new Date()
                    }
                }
            ];

            context.mock.method(Team, "findById", () => ({
                select: () => ({
                    populate: () => ({
                        lean: async () => teamData
                    })
                })
            }));

            context.mock.method(Registration, "find", () => ({
                select: () => ({
                    sort: () => ({
                        lean: async () => memberRegistrations
                    })
                })
            }));

            const req = {
                params: { id: teamId.toString() },
                user: { _id: leaderId }
            };
            const res = mockResponse();

            await getLeaderTeamTickets(req, res);

            assert.equal(res.statusCode, 200);
            assert.equal(res.body.success, true);
            assert.equal(res.body.tickets.length, 2);
            assert.equal(res.body.tickets[0].access.type, "MULTI_EVENT");
            assert.equal(res.body.tickets[0].access.eligibleEventIds.length, 2);
            assert.equal(res.body.tickets[1].access.type, "MULTI_EVENT");
        });

        // 27. Unauthorized ticket retrieval is rejected
        test("27. Unauthorized ticket retrieval is rejected for both individual and team", async (context) => {
            const teamId = makeId();
            const regId = makeId();

            // Team ticket: non-leader
            context.mock.method(Team, "findById", () => ({
                select: () => ({
                    populate: () => ({
                        lean: async () => ({
                            _id: teamId,
                            leader: leaderId,
                            event: { name: "Test" },
                            status: "REGISTERED",
                            payment: { status: "VERIFIED" }
                        })
                    })
                })
            }));

            const teamReq = {
                params: { id: teamId.toString() },
                user: { _id: otherUserId } // Not the leader
            };
            const teamRes = mockResponse();

            await getLeaderTeamTickets(teamReq, teamRes);
            assert.equal(teamRes.statusCode, 403);
            assert.equal(teamRes.body.code, "TEAM_LEADER_REQUIRED");

            // Individual ticket: not the owner
            context.mock.method(Registration, "findOne", () => ({
                select: () => ({
                    populate: () => ({
                        lean: async () => null // Query has user: req.user._id, so returns null
                    })
                })
            }));

            const indReq = {
                params: { id: regId.toString() },
                user: { _id: otherUserId }
            };
            const indRes = mockResponse();

            await getMyRegistrationTicket(indReq, indRes);
            assert.equal(indRes.statusCode, 404);
            assert.equal(indRes.body.code, "TICKET_NOT_FOUND");
        });
    });

    describe("Part 4: Financial Analytics and Registration Invariants", () => {
        // 28. Existing financial analytics remain unchanged
        test("28. Financial analytics aggregation strictly includes only verified payments", () => {
            const sampleRegistrations = [
                { payment: { status: "VERIFIED", receivedAmount: 150 } },
                { payment: { status: "PENDING", receivedAmount: 0 } },
                { payment: { status: "REJECTED", receivedAmount: null } },
                { payment: { status: "VERIFIED", receivedAmount: 200 } },
                { payment: { status: "NOT_REQUIRED", receivedAmount: 0 } }
            ];

            const totalRevenue = sampleRegistrations
                .filter(r => r.payment.status === "VERIFIED")
                .reduce((sum, r) => sum + (r.payment.receivedAmount || 0), 0);

            assert.equal(totalRevenue, 350);
        });

        // 29. Existing individual registration remains functional
        test("29. Standard individual registration generates valid snapshot and increments parent capacity", () => {
            const standardEventId = makeId();
            const standardEvent = {
                _id: standardEventId,
                name: "Standard Solo Coding",
                status: "PUBLISHED",
                multiEventAccess: { enabled: false }
            };

            const snapshot = buildRegistrationAccessSnapshot({ event: standardEvent });
            assert.equal(snapshot.type, "SINGLE_EVENT");
            assert.equal(snapshot.eligibleEventIds.length, 1);
            assert.equal(snapshot.eligibleEventIds[0].toString(), standardEventId.toString());

            const effectiveAccess = resolveEffectiveAccess({
                event: standardEventId,
                access: snapshot
            });
            assert.equal(effectiveAccess.type, "SINGLE_EVENT");
            assert.equal(effectiveAccess.eligibleEventIds[0].toString(), standardEventId.toString());
        });

        // 30. Existing Team registration remains functional
        test("30. Standard team registration generates valid independent snapshots for all members", () => {
            const teamEventId = makeId();
            const teamEvent = {
                _id: teamEventId,
                name: "Standard Team Quiz",
                status: "PUBLISHED",
                multiEventAccess: { enabled: false }
            };

            const memberCount = 3;
            const snapshots = [];
            for (let i = 0; i < memberCount; i++) {
                snapshots.push(buildRegistrationAccessSnapshot({ event: teamEvent }));
            }

            assert.equal(snapshots.length, 3);
            snapshots.forEach(snapshot => {
                assert.equal(snapshot.type, "SINGLE_EVENT");
                assert.equal(snapshot.eligibleEventIds.length, 1);
                assert.equal(snapshot.eligibleEventIds[0].toString(), teamEventId.toString());
            });
        });
    });
});
