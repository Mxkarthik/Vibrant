"use strict";

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { resolveAdminFrontendUrl } = require("../utils/adminFrontendUrl");

describe("Admin frontend redirect configuration", () => {
    test("production prefers configured HTTPS origins over localhost, regardless of order", () => {
        assert.equal(
            resolveAdminFrontendUrl({
                NODE_ENV: "production",
                ADMIN_FRONTEND_URL: "http://localhost:5173/, https://vibrantadmin.vercel.app/"
            }),
            "https://vibrantadmin.vercel.app"
        );
    });

    test("production requires an explicit non-local HTTPS admin origin", () => {
        assert.throws(
            () => resolveAdminFrontendUrl({ NODE_ENV: "production" }),
            /Missing required ADMIN_FRONTEND_URL/
        );
        assert.throws(
            () => resolveAdminFrontendUrl({
                NODE_ENV: "production",
                ADMIN_FRONTEND_URL: "http://localhost:5173"
            }),
            /non-local HTTPS origin/
        );
    });

    test("development keeps the configured local origin and local fallback", () => {
        assert.equal(
            resolveAdminFrontendUrl({
                NODE_ENV: "development",
                ADMIN_FRONTEND_URL: "https://vibrantadmin.vercel.app, http://localhost:5173/"
            }),
            "http://localhost:5173"
        );
        assert.equal(resolveAdminFrontendUrl({ NODE_ENV: "development" }), "http://localhost:5173");
    });

    test("configured origins cannot contain paths or credentials", () => {
        assert.throws(
            () => resolveAdminFrontendUrl({
                NODE_ENV: "production",
                ADMIN_FRONTEND_URL: "https://user:pass@example.com/admin"
            }),
            /without paths or credentials/
        );
    });
});
