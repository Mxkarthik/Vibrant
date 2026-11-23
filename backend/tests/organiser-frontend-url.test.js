"use strict";

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { resolveOrganiserFrontendUrl } = require("../utils/organiserFrontendUrl");

describe("Organiser frontend redirect configuration", () => {
    test("production prefers configured HTTPS origins over localhost, regardless of order", () => {
        assert.equal(
            resolveOrganiserFrontendUrl({
                NODE_ENV: "production",
                ORGANISER_FRONTEND_URL: "http://localhost:5175/, https://vibrantorganiser.vercel.app/"
            }),
            "https://vibrantorganiser.vercel.app"
        );
    });

    test("production falls back to default HTTPS if unset", () => {
        assert.equal(
            resolveOrganiserFrontendUrl({ NODE_ENV: "production" }),
            "https://dietvibrant-organiser.vercel.app"
        );
    });

    test("production throws when configured only with localhost", () => {
        assert.throws(
            () => resolveOrganiserFrontendUrl({
                NODE_ENV: "production",
                ORGANISER_FRONTEND_URL: "http://localhost:5175"
            }),
            /non-local HTTPS origin/
        );
    });

    test("development keeps the configured local origin and local fallback", () => {
        assert.equal(
            resolveOrganiserFrontendUrl({
                NODE_ENV: "development",
                ORGANISER_FRONTEND_URL: "https://vibrantorganiser.vercel.app, http://localhost:5175/"
            }),
            "http://localhost:5175"
        );
        assert.equal(resolveOrganiserFrontendUrl({ NODE_ENV: "development" }), "http://localhost:5175");
    });

    test("configured origins cannot contain paths or credentials", () => {
        assert.throws(
            () => resolveOrganiserFrontendUrl({
                NODE_ENV: "production",
                ORGANISER_FRONTEND_URL: "https://user:pass@example.com/organiser"
            }),
            /without paths or credentials/
        );
    });
});
