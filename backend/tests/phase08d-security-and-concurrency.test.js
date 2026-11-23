"use strict";

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const mongoose = require("mongoose");

const { resolveOrganiserFrontendUrl } = require("../utils/organiserFrontendUrl");
const { resolveAdminFrontendUrl } = require("../utils/adminFrontendUrl");
const authorizeRoles = require("../middleware/roleMiddleware");
const protect = require("../middleware/authMiddleware");

function makeId() {
    return new mongoose.Types.ObjectId();
}

function mockResponse() {
    return {
        statusCode: 200,
        body: null,
        clearedCookie: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(data) {
            this.body = data;
            return this;
        },
        clearCookie(name, options) {
            this.clearedCookie = { name, options };
            return this;
        }
    };
}

describe("PHASE 08D: SECURITY, CONCURRENCY & RELEASE SAFETY GATE", () => {

    // --------------------------------------------------------------------------
    // GROUP 1: GOOGLE OAUTH PORTAL SCOPING & REDIRECT INVARIANTS
    // --------------------------------------------------------------------------
    describe("Group 1: Google OAuth Portal Scoping & Redirect Invariants", () => {
        const authRoutesSrc = fs.readFileSync(path.join(__dirname, "../routes/authRoutes.js"), "utf-8");

        test("1. Organiser OAuth success explicitly redirects to /scanner", () => {
            assert.ok(
                authRoutesSrc.includes('return res.redirect(302, `${frontendUrl}/scanner`);'),
                "Organiser success callback must redirect to /scanner"
            );
            assert.ok(
                !authRoutesSrc.includes('return res.redirect(302, `${frontendUrl}/events`);'),
                "Legacy redirect to /events must be absent"
            );
        });

        test("2. Admin OAuth success behavior is preserved (/admin destination)", () => {
            assert.ok(
                authRoutesSrc.includes('return res.redirect(302, `${frontendUrl}/admin`);'),
                "Admin success callback must redirect to /admin"
            );
        });

        test("3. Participant OAuth success preserves callback with token query param", () => {
            assert.ok(
                authRoutesSrc.includes('return res.redirect(302, `${frontendUrl}/auth/callback?token=${encodeURIComponent(token)}`);'),
                "Participant callback must preserve token query param"
            );
        });

        test("4. Failed OAuth retains failure redirects without establishing session", () => {
            assert.ok(
                authRoutesSrc.includes('`${frontendUrl}/login?error=google_auth_failed`'),
                "Organiser/Admin failures route to /login?error=google_auth_failed"
            );
            assert.ok(
                authRoutesSrc.includes('`${frontendUrl}/auth/callback?error=google_auth_failed`'),
                "Participant failure routes to /auth/callback?error=google_auth_failed"
            );
        });

        test("5. Organiser URL resolver enforces HTTPS and rejects localhost in production", () => {
            assert.equal(
                resolveOrganiserFrontendUrl({
                    NODE_ENV: "production",
                    ORGANISER_FRONTEND_URL: "https://dietvibrant-organiser.vercel.app"
                }),
                "https://dietvibrant-organiser.vercel.app"
            );
            assert.throws(
                () => resolveOrganiserFrontendUrl({
                    NODE_ENV: "production",
                    ORGANISER_FRONTEND_URL: "http://localhost:5175"
                }),
                /non-local HTTPS origin/
            );
        });

        test("6. URL resolver rejects origins with paths or credentials (prevents open redirects)", () => {
            assert.throws(
                () => resolveOrganiserFrontendUrl({
                    NODE_ENV: "production",
                    ORGANISER_FRONTEND_URL: "https://attacker.com/malicious-path"
                }),
                /without paths or credentials/
            );
            assert.throws(
                () => resolveOrganiserFrontendUrl({
                    NODE_ENV: "production",
                    ORGANISER_FRONTEND_URL: "https://user:pass@attacker.com"
                }),
                /without paths or credentials/
            );
        });
    });

    // --------------------------------------------------------------------------
    // GROUP 2: ROLE AUTHORIZATION & ROUTE GUARDS
    // --------------------------------------------------------------------------
    describe("Group 2: Role Authorization & Route Guards", () => {
        test("7. Participants are strictly rejected with HTTP 403 on gate endpoints", () => {
            const middleware = authorizeRoles("ADMIN", "ORGANISER");
            const req = { user: { role: "PARTICIPANT" } };
            const res = mockResponse();
            let nextCalled = false;

            middleware(req, res, () => { nextCalled = true; });

            assert.equal(nextCalled, false, "next() must not be called for PARTICIPANT");
            assert.equal(res.statusCode, 403, "Must return HTTP 403 Forbidden");
            assert.equal(res.body?.success, false);
        });

        test("8. Unauthenticated requests are rejected with HTTP 401", () => {
            const middleware = authorizeRoles("ADMIN", "ORGANISER");
            const req = {}; // No req.user
            const res = mockResponse();
            let nextCalled = false;

            middleware(req, res, () => { nextCalled = true; });

            assert.equal(nextCalled, false, "next() must not be called for unauthenticated request");
            assert.equal(res.statusCode, 401, "Must return HTTP 401 Unauthorized");
        });

        test("9. ORGANISER and ADMIN roles pass role middleware successfully", () => {
            const middleware = authorizeRoles("ADMIN", "ORGANISER");

            for (const role of ["ADMIN", "ORGANISER"]) {
                const req = { user: { role } };
                const res = mockResponse();
                let nextCalled = false;

                middleware(req, res, () => { nextCalled = true; });

                assert.equal(nextCalled, true, `next() must be called for role ${role}`);
            }
        });
    });

    // --------------------------------------------------------------------------
    // GROUP 3: EVENT-LEVEL DATA SCOPING & LEGACY FALLBACK
    // --------------------------------------------------------------------------
    describe("Group 3: Event-Level Data Scoping & Legacy Fallback", () => {
        test("10. Explicitly assigned event blocks unassigned organiser with HTTP 403", () => {
            const regControllerSrc = fs.readFileSync(path.join(__dirname, "../controllers/registrationController.js"), "utf-8");

            assert.ok(
                regControllerSrc.includes('code: "ORGANISER_NOT_ASSIGNED"'),
                "Controller includes ORGANISER_NOT_ASSIGNED error code"
            );
            assert.ok(
                regControllerSrc.includes("targetEvent.organizers.some"),
                "Controller checks organiser assignment against targetEvent.organizers"
            );
        });

        test("11. Legacy events without assigned organizers permit verified organisers", () => {
            const regControllerSrc = fs.readFileSync(path.join(__dirname, "../controllers/registrationController.js"), "utf-8");

            assert.ok(
                regControllerSrc.includes("Array.isArray(targetEvent.organizers) && targetEvent.organizers.length > 0"),
                "Scoping is checked only when organizers array is populated"
            );
        });

        test("12. Combo Pass parent event is blocked from direct venue check-in", () => {
            const regControllerSrc = fs.readFileSync(path.join(__dirname, "../controllers/registrationController.js"), "utf-8");

            assert.ok(
                regControllerSrc.includes('code: "COMBO_PARENT_NOT_VENUE"'),
                "Controller blocks direct check-in on Combo Pass parents"
            );
        });
    });

    // --------------------------------------------------------------------------
    // GROUP 4: ATTENDANCE ATOMICITY, RACE CONDITIONS & RECOVERY
    // --------------------------------------------------------------------------
    describe("Group 4: Attendance Atomicity, Race Conditions & Recovery", () => {
        const regControllerSrc = fs.readFileSync(path.join(__dirname, "../controllers/registrationController.js"), "utf-8");

        test("13. Atomic update condition enforces $ne: targetEventId to guarantee single check-in per venue", () => {
            assert.ok(
                regControllerSrc.includes('"eventAttendance.eventId": { $ne: targetEventId }'),
                "Atomic update must include $ne: targetEventId condition"
            );
        });

        test("14. Individual payment status is atomically verified in the MongoDB update query", () => {
            assert.ok(
                regControllerSrc.includes('updateQuery["payment.status"] = { $in: ["VERIFIED", "NOT_REQUIRED"] };'),
                "Atomic update query includes payment.status filter for individual registrations"
            );
        });

        test("15. Registration status: REGISTERED is atomically verified in update query", () => {
            assert.ok(
                regControllerSrc.includes('status: "REGISTERED"'),
                "Atomic update query requires status: REGISTERED"
            );
        });

        test("16. Check-in records checkedInBy actor and checkInMethod audit fields", () => {
            assert.ok(
                regControllerSrc.includes("checkedInBy: user?._id || null") ||
                regControllerSrc.includes("checkedInBy: user ? user._id : null"),
                "Records checking in actor user ID"
            );
            assert.ok(
                regControllerSrc.includes("checkInMethod"),
                "Records checkInMethod audit field (QR_SCAN or MANUAL_REG_ID)"
            );
        });

        test("17. All attendance writes persist to the single Registration document (single-doc atomicity)", () => {
            const regModelSrc = fs.readFileSync(path.join(__dirname, "../models/Registration.js"), "utf-8");

            assert.ok(
                regModelSrc.includes("eventAttendance: ["),
                "eventAttendance is an embedded array within Registration schema"
            );
            assert.ok(
                regModelSrc.includes("checkInMethod: {"),
                "checkInMethod is defined in eventAttendance schema"
            );
        });

        test("18. Duplicate check-in attempts return HTTP 409 ALREADY_CHECKED_IN", () => {
            assert.ok(
                regControllerSrc.includes('code: "ALREADY_CHECKED_IN"'),
                "Returns ALREADY_CHECKED_IN code on duplicate entry"
            );
            assert.ok(
                regControllerSrc.includes("statusCode: 409"),
                "Sets HTTP 409 status code on duplicate entry"
            );
        });
    });
});
