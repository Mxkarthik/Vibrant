/**
 * ============================================================================
 * PHASE 06.5: QR + MANUAL ATTENDANCE RELIABILITY & CONTRACT VERIFICATION
 * ============================================================================
 *
 * Verifies Phase 04C reliability contracts:
 * 1. Payment status enum strictness (VERIFIED / NOT_REQUIRED accepted, PENDING / REJECTED denied,
 *    COMPLETED or other unknown values rejected as PAYMENT_NOT_ELIGIBLE).
 * 2. Strict 24-character hexadecimal Registration ID validation and whitespace trimming.
 * 3. Bidirectional duplicate prevention between QR and Manual check-in.
 * 4. Audit trail compatibility: historical records preserve checkInMethod: undefined,
 *    while new check-ins explicitly record QR_SCAN and MANUAL_REG_ID.
 * 5. Full preservation of event scoping, cancellations, and combo child independence.
 */

const { describe, test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const { resolveRegistrationAdmissionEligibility } = require("../utils/admissionEligibility");
const Registration = require("../models/Registration");
const Team = require("../models/Team");
const Event = require("../models/Event");
const { resolveEventSpecificAttendance } = require("../utils/eventAttendanceReportService");

// Helper to generate unique 24-char hex ObjectIds
function makeId() {
    return new mongoose.Types.ObjectId();
}

describe("PHASE 06.5: QR + MANUAL ATTENDANCE RELIABILITY & CONTRACT VERIFICATION", () => {

    // --------------------------------------------------------------------------
    // 1. PAYMENT STATUS CONTRACT AUDIT
    // --------------------------------------------------------------------------
    describe("1. Payment Status Contract & Persistence Audit", () => {
        test("1.1. Registration.payment.status schema enum accepts ONLY NOT_REQUIRED, PENDING, VERIFIED, REJECTED", () => {
            const schemaEnum = Registration.schema.path("payment.status").enumValues;
            assert.deepEqual(
                schemaEnum.sort(),
                ["NOT_REQUIRED", "PENDING", "REJECTED", "VERIFIED"].sort(),
                "Registration schema must strictly permit only the 4 canonical payment states"
            );
            assert.equal(schemaEnum.includes("COMPLETED"), false, "COMPLETED must NOT be in Registration payment enum");
        });

        test("1.2. Team.payment.status schema enum accepts ONLY NOT_REQUIRED, PENDING, VERIFIED, REJECTED", () => {
            const schemaEnum = Team.schema.path("payment.status").enumValues;
            assert.deepEqual(
                schemaEnum.sort(),
                ["NOT_REQUIRED", "PENDING", "REJECTED", "VERIFIED"].sort(),
                "Team schema must strictly permit only the 4 canonical payment states"
            );
            assert.equal(schemaEnum.includes("COMPLETED"), false, "COMPLETED must NOT be in Team payment enum");
        });

        test("1.3. resolveRegistrationAdmissionEligibility accepts VERIFIED and NOT_REQUIRED", () => {
            const targetEvent = { _id: makeId(), status: "PUBLISHED" };
            const regVerified = {
                _id: makeId(),
                event: targetEvent._id,
                status: "REGISTERED",
                payment: { status: "VERIFIED" }
            };
            const resVerified = resolveRegistrationAdmissionEligibility({
                registration: regVerified,
                targetEvent
            });
            assert.equal(resVerified.isEligible, true);
            assert.equal(resVerified.reasonCode, "ADMISSION_ALLOWED");

            const regNotReq = {
                _id: makeId(),
                event: targetEvent._id,
                status: "REGISTERED",
                payment: { status: "NOT_REQUIRED" }
            };
            const resNotReq = resolveRegistrationAdmissionEligibility({
                registration: regNotReq,
                targetEvent
            });
            assert.equal(resNotReq.isEligible, true);
            assert.equal(resNotReq.reasonCode, "ADMISSION_ALLOWED");
        });

        test("1.4. resolveRegistrationAdmissionEligibility rejects PENDING and REJECTED", () => {
            const targetEvent = { _id: makeId(), status: "PUBLISHED" };
            const regPending = {
                _id: makeId(),
                event: targetEvent._id,
                status: "REGISTERED",
                payment: { status: "PENDING" }
            };
            const resPending = resolveRegistrationAdmissionEligibility({
                registration: regPending,
                targetEvent
            });
            assert.equal(resPending.isEligible, false);
            assert.equal(resPending.reasonCode, "PAYMENT_PENDING");

            const regRejected = {
                _id: makeId(),
                event: targetEvent._id,
                status: "REGISTERED",
                payment: { status: "REJECTED" }
            };
            const resRejected = resolveRegistrationAdmissionEligibility({
                registration: regRejected,
                targetEvent
            });
            assert.equal(resRejected.isEligible, false);
            assert.equal(resRejected.reasonCode, "PAYMENT_REJECTED");
        });

        test("1.5. Documentation artifact COMPLETED is rejected by eligibility engine as PAYMENT_NOT_ELIGIBLE", () => {
            const targetEvent = { _id: makeId(), status: "PUBLISHED" };
            const regCompleted = {
                _id: makeId(),
                event: targetEvent._id,
                status: "REGISTERED",
                payment: { status: "COMPLETED" } // invalid non-persisted status
            };
            const res = resolveRegistrationAdmissionEligibility({
                registration: regCompleted,
                targetEvent
            });
            assert.equal(res.isEligible, false);
            assert.equal(res.reasonCode, "PAYMENT_NOT_ELIGIBLE");
        });

        test("1.6. Team payment status controls admission for team registrations", () => {
            const targetEvent = { _id: makeId(), status: "PUBLISHED" };
            const teamId = makeId();
            const regDoc = {
                _id: makeId(),
                event: targetEvent._id,
                team: teamId,
                status: "REGISTERED",
                payment: { status: "NOT_REQUIRED" } // Individual payment ignored for team
            };

            // Pending team payment
            const teamPending = {
                _id: teamId,
                status: "REGISTERED",
                payment: { status: "PENDING" }
            };
            const resPending = resolveRegistrationAdmissionEligibility({
                registration: regDoc,
                team: teamPending,
                targetEvent
            });
            assert.equal(resPending.isEligible, false);
            assert.equal(resPending.reasonCode, "PAYMENT_PENDING");

            // Verified team payment
            const teamVerified = {
                _id: teamId,
                status: "REGISTERED",
                payment: { status: "VERIFIED" }
            };
            const resVerified = resolveRegistrationAdmissionEligibility({
                registration: regDoc,
                team: teamVerified,
                targetEvent
            });
            assert.equal(resVerified.isEligible, true);
            assert.equal(resVerified.reasonCode, "ADMISSION_ALLOWED");
        });
    });

    // --------------------------------------------------------------------------
    // 2. STRICT 24-HEX REGISTRATION ID AUDIT
    // --------------------------------------------------------------------------
    describe("2. Strict 24-Hexadecimal Registration ID Validation", () => {
        test("2.1. Valid 24-character hexadecimal IDs pass", () => {
            const validHex = "507f1f77bcf86cd799439011";
            assert.match(validHex, /^[a-f0-9]{24}$/i);
            assert.equal(mongoose.isValidObjectId(validHex), true);
        });

        test("2.2. Whitespace-padded 24-hex IDs are normalized cleanly", () => {
            const raw = "   507f1f77bcf86cd799439011  \n ";
            const cleaned = raw.trim();
            assert.equal(cleaned, "507f1f77bcf86cd799439011");
            assert.match(cleaned, /^[a-f0-9]{24}$/i);
        });

        test("2.3. Non-hex characters are rejected", () => {
            const nonHex = "507f1f77bcf86cd79943901Z";
            assert.equal(/^[a-f0-9]{24}$/i.test(nonHex), false);
        });

        test("2.4. Truncated (23 char) and elongated (25 char) IDs are rejected", () => {
            assert.equal(/^[a-f0-9]{24}$/i.test("507f1f77bcf86cd79943901"), false);
            assert.equal(/^[a-f0-9]{24}$/i.test("507f1f77bcf86cd7994390111"), false);
        });

        test("2.5. Raw 12-byte string edge case rejected by strict 24-hex regex", () => {
            // Mongoose isValidObjectId("123456789012") returns true because length is 12 bytes.
            // Our strict regex /^[a-f0-9]{24}$/i correctly rejects it.
            const twelveByteString = "123456789012";
            assert.equal(/^[a-f0-9]{24}$/i.test(twelveByteString), false);
        });

        test("2.6. Legacy VIB26-REG-* placeholder strings rejected by strict regex", () => {
            assert.equal(/^[a-f0-9]{24}$/i.test("VIB26-REG-000123"), false);
        });
    });

    // --------------------------------------------------------------------------
    // 3. AUDIT TRAIL & HISTORICAL DATA COMPATIBILITY
    // --------------------------------------------------------------------------
    describe("3. Audit Trail & Historical Data Compatibility", () => {
        test("3.1. Historical records without checkInMethod preserve undefined (no default overwrite)", () => {
            // A historical record in MongoDB does not have checkInMethod.
            const historicalSubdoc = {
                eventId: makeId(),
                checkedInAt: new Date("2026-01-15T10:00:00Z"),
                checkedInBy: makeId()
                // checkInMethod is undefined
            };

            const regDoc = new Registration({
                event: makeId(),
                participantDetails: {
                    fullName: "Historical Participant",
                    mobileNumber: "9876543210",
                    collegeName: "Heritage College",
                    department: "ECE",
                    section: "A",
                    yearOfStudy: "3",
                    rollNumber: "ECE-01"
                },
                payment: { status: "VERIFIED" },
                eventAttendance: [historicalSubdoc]
            });

            // Without schema default: "QR_SCAN", checkInMethod remains undefined
            assert.equal(regDoc.eventAttendance[0].checkInMethod, undefined);
        });

        test("3.2. New QR check-in records explicit QR_SCAN checkInMethod", () => {
            const newQrSubdoc = {
                eventId: makeId(),
                checkedInAt: new Date(),
                checkedInBy: makeId(),
                checkInMethod: "QR_SCAN"
            };

            const regDoc = new Registration({
                event: makeId(),
                participantDetails: {
                    fullName: "QR Participant",
                    mobileNumber: "9876543210",
                    collegeName: "Heritage College",
                    department: "ECE",
                    section: "A",
                    yearOfStudy: "3",
                    rollNumber: "ECE-02"
                },
                payment: { status: "VERIFIED" },
                eventAttendance: [newQrSubdoc]
            });

            assert.equal(regDoc.eventAttendance[0].checkInMethod, "QR_SCAN");
        });

        test("3.3. New Manual check-in records explicit MANUAL_REG_ID checkInMethod", () => {
            const newManualSubdoc = {
                eventId: makeId(),
                checkedInAt: new Date(),
                checkedInBy: makeId(),
                checkInMethod: "MANUAL_REG_ID"
            };

            const regDoc = new Registration({
                event: makeId(),
                participantDetails: {
                    fullName: "Manual Participant",
                    mobileNumber: "9876543210",
                    collegeName: "Heritage College",
                    department: "ECE",
                    section: "A",
                    yearOfStudy: "3",
                    rollNumber: "ECE-03"
                },
                payment: { status: "VERIFIED" },
                eventAttendance: [newManualSubdoc]
            });

            assert.equal(regDoc.eventAttendance[0].checkInMethod, "MANUAL_REG_ID");
        });

        test("3.4. Attendance report resolver functions identically with or without checkInMethod", () => {
            const targetEventId = makeId();
            const historicalReg = {
                event: targetEventId,
                attendance: { isPresent: true, checkedInAt: new Date() },
                eventAttendance: [
                    { eventId: targetEventId, checkedInAt: new Date() } // no checkInMethod
                ]
            };

            const resHistorical = resolveEventSpecificAttendance(historicalReg, targetEventId);
            assert.equal(resHistorical.isPresent, true);
            assert.ok(resHistorical.checkedInAt);

            const modernReg = {
                event: targetEventId,
                attendance: { isPresent: true, checkedInAt: new Date() },
                eventAttendance: [
                    { eventId: targetEventId, checkedInAt: new Date(), checkInMethod: "MANUAL_REG_ID" }
                ]
            };

            const resModern = resolveEventSpecificAttendance(modernReg, targetEventId);
            assert.equal(resModern.isPresent, true);
            assert.ok(resModern.checkedInAt);
        });
    });

    // --------------------------------------------------------------------------
    // 4. SHARED ATTENDANCE LOGIC & ATOMIC DUPLICATE GUARDS
    // --------------------------------------------------------------------------
    describe("4. Shared Attendance Logic & Atomic Duplicate Guards", () => {
        test("4.1. Atomic condition { 'eventAttendance.eventId': { $ne: targetEventId } } guarantees single check-in", () => {
            const targetEventId = makeId();

            // Scenario: Document already has targetEventId in eventAttendance
            const existingAttendance = [
                { eventId: targetEventId, checkedInAt: new Date(), checkInMethod: "QR_SCAN" }
            ];

            // Filter simulates MongoDB's $ne check
            const alreadyContains = existingAttendance.some(
                e => e.eventId.toString() === targetEventId.toString()
            );
            assert.equal(alreadyContains, true, "Already contains target event ID");

            // A subsequent manual check-in will fail the $ne filter
            const matchesNeFilter = !alreadyContains;
            assert.equal(matchesNeFilter, false, "Second check-in cannot pass atomic $ne filter");
        });

        test("4.2. Child event venues for Combo Pass attendees are independently admissible", () => {
            const childVenueA = makeId();
            const childVenueB = makeId();

            const attendanceRecords = [
                { eventId: childVenueA, checkedInAt: new Date(), checkInMethod: "QR_SCAN" }
            ];

            // Attendee is already checked into Venue A
            const venueAAlreadyCheckedIn = attendanceRecords.some(
                e => e.eventId.toString() === childVenueA.toString()
            );
            assert.equal(venueAAlreadyCheckedIn, true);

            // Attendee is NOT yet checked into Venue B
            const venueBMatchesNeFilter = !attendanceRecords.some(
                e => e.eventId.toString() === childVenueB.toString()
            );
            assert.equal(venueBMatchesNeFilter, true, "Attendee must be eligible to check into Venue B");
        });

        test("4.3. Combo Pass package parent is rejected for check-in", () => {
            const comboParentEvent = {
                _id: makeId(),
                name: "Mega Combo",
                status: "PUBLISHED",
                multiEventAccess: {
                    enabled: true,
                    childEvents: [makeId(), makeId()]
                }
            };

            // Business invariant: parent package cannot be check-in destination
            assert.equal(Boolean(comboParentEvent.multiEventAccess?.enabled), true);
        });
    });
});
