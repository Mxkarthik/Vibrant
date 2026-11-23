"use strict";

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { resolveOrganiserFrontendUrl } = require("../utils/organiserFrontendUrl");
const { resolveAdminFrontendUrl } = require("../utils/adminFrontendUrl");

describe("Phase 08C: Google OAuth Redirect Destination & Security Verification", () => {
    test("1. Organiser OAuth success explicitly redirects to /scanner", () => {
        const authRoutesSrc = fs.readFileSync(
            path.join(__dirname, "../routes/authRoutes.js"),
            "utf-8"
        );

        assert.ok(
            authRoutesSrc.includes('if (portal === "organiser") {\n            return res.redirect(302, `${frontendUrl}/scanner`);\n        }') ||
            authRoutesSrc.includes('return res.redirect(302, `${frontendUrl}/scanner`);'),
            "Organiser success callback must redirect to /scanner"
        );
        assert.ok(
            !authRoutesSrc.includes('return res.redirect(302, `${frontendUrl}/events`);'),
            "Legacy redirect to /events must be completely replaced"
        );
    });

    test("2. Admin OAuth success behavior is preserved (/admin destination)", () => {
        const authRoutesSrc = fs.readFileSync(
            path.join(__dirname, "../routes/authRoutes.js"),
            "utf-8"
        );

        assert.ok(
            authRoutesSrc.includes('return res.redirect(302, `${frontendUrl}/admin`);'),
            "Admin success callback must redirect to /admin"
        );
    });

    test("3. Participant OAuth success behavior is preserved (/auth/callback destination with token)", () => {
        const authRoutesSrc = fs.readFileSync(
            path.join(__dirname, "../routes/authRoutes.js"),
            "utf-8"
        );

        assert.ok(
            authRoutesSrc.includes('return res.redirect(302, `${frontendUrl}/auth/callback?token=${encodeURIComponent(token)}`);'),
            "Participant callback must preserve token parameter in query string"
        );
    });

    test("4. Organiser OAuth failure redirects to /login?error=google_auth_failed", () => {
        const authRoutesSrc = fs.readFileSync(
            path.join(__dirname, "../routes/authRoutes.js"),
            "utf-8"
        );

        assert.ok(
            authRoutesSrc.includes('const failureUrl = portal === "participant"'),
            "Failure URL checks portal type"
        );
        assert.ok(
            authRoutesSrc.includes('`${frontendUrl}/login?error=google_auth_failed`'),
            "Organiser and Admin failures route to /login?error=google_auth_failed"
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

    test("6. Organiser URL resolver rejects origins with paths or embedded credentials", () => {
        assert.throws(
            () => resolveOrganiserFrontendUrl({
                NODE_ENV: "production",
                ORGANISER_FRONTEND_URL: "https://user:pass@evil.com/path"
            }),
            /without paths or credentials/
        );
    });

    test("7. Cookie configuration sets httpOnly, secure, and SameSite=none for cross-origin authentication", () => {
        const authRoutesSrc = fs.readFileSync(
            path.join(__dirname, "../routes/authRoutes.js"),
            "utf-8"
        );

        assert.ok(authRoutesSrc.includes("httpOnly: true"), "Enforces httpOnly: true");
        assert.ok(
            authRoutesSrc.includes('cookieSameSite = (process.env.AUTH_COOKIE_SAME_SITE || (isProduction ? "none" : "lax")).toLowerCase()'),
            "Defaults SameSite to none in production"
        );
        assert.ok(
            authRoutesSrc.includes('secure: isProduction || cookieSameSite === "none"'),
            "Enforces Secure attribute in production"
        );
    });
});
