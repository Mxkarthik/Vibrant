"use strict";

process.env.NODE_ENV = "test";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const validation = require("../utils/domainAdminValidation");
const controller = require("../controllers/domainAdminController");
const service = require("../services/domainAdminService");
const adminRoutes = require("../routes/adminRoutes");
const domainRoutes = require("../routes/domainAdminRoutes");

function response() {
    return {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
}

async function call(handler, req) {
    const res = response();
    await handler(req, res);
    return res;
}

describe("Admin private domain APIs", () => {
    it("validates ObjectIds, strict config fields, domain fields, sizes, and pagination", () => {
        assert.throws(() => validation.validateObjectId("bad", "event ID"), e => e.code === "INVALID_EVENT_ID");
        assert.throws(() => validation.validateConfigBody({ enabled: true, visibility: "PUBLIC" }));
        assert.throws(() => validation.validateConfigBody({ enabled: "true" }));
        assert.throws(() => validation.validateDomainBody({ title: "ok", problemStatement: "ok", createdBy: "x" }));
        assert.throws(() => validation.validateDomainBody({ title: " ", problemStatement: "ok" }));
        assert.throws(() => validation.validateDomainBody({ title: "ok", problemStatement: "x".repeat(20001) }));
        assert.deepEqual(validation.validateDomainBody({ title: "  T  ", problemStatement: " S " }), {
            title: "T", problemStatement: "S"
        });
        assert.deepEqual(validation.validatePagination({ page: "2", limit: "25" }), { page: 2, limit: 25 });
        assert.throws(() => validation.validatePagination({ limit: 101 }));
    });

    it("mounts all paths under Admin protection and registers the six intended routes", () => {
        assert.ok(adminRoutes.stack.some(layer => layer.handle === domainRoutes), "domain routes are mounted in admin router");
        assert.equal(adminRoutes.stack[0].name, "protect");
        const adminRoleGuard = adminRoutes.stack[1].handle;
        for (const role of ["PARTICIPANT", "ORGANISER"]) {
            let nextCalled = false;
            const res = response();
            adminRoleGuard({ user: { role } }, res, () => { nextCalled = true; });
            assert.equal(res.statusCode, 403);
            assert.equal(nextCalled, false);
        }
        const routes = domainRoutes.stack.filter(layer => layer.route).map(layer => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);
        assert.deepEqual(routes, ["PATCH /config", "POST /", "GET /", "GET /:domainId", "PATCH /:domainId", "DELETE /:domainId"]);
    });

    it("rejects client supplied identity and lifecycle fields before calling create service", async () => {
        const original = service.createDomain;
        let invoked = false;
        service.createDomain = async () => { invoked = true; };
        try {
            const res = await call(controller.createDomain, {
                params: { eventId: new mongoose.Types.ObjectId().toString() },
                user: { _id: new mongoose.Types.ObjectId() },
                body: { title: "T", problemStatement: "S", event: "evil", createdBy: "evil" }
            });
            assert.equal(res.statusCode, 400);
            assert.equal(res.body.code, "INVALID_DOMAIN_INPUT");
            assert.equal(invoked, false);
        } finally { service.createDomain = original; }
    });

    it("returns the stable admin configuration envelope and does not publish on enable", async () => {
        const original = service.updateEnabled;
        const eventId = new mongoose.Types.ObjectId();
        service.updateEnabled = async (_id, enabled) => ({
            _id: eventId,
            domainConfig: { enabled, visibility: "PRIVATE", drawStatus: "CLOSED", publishedAt: null, poolVersion: 0 }
        });
        try {
            const res = await call(controller.updateDomainConfig, {
                params: { eventId: eventId.toString() }, body: { enabled: true }
            });
            assert.equal(res.statusCode, 200);
            assert.deepEqual(res.body.data.domainConfig, {
                enabled: true, visibility: "PRIVATE", drawStatus: "CLOSED", publishedAt: null,
                drawOpenedAt: null, drawClosedAt: null, poolVersion: 0
            });
        } finally { service.updateEnabled = original; }
    });

    it("returns domain lifecycle conflicts without leaking unexpected errors", async () => {
        const original = service.deleteDomain;
        service.deleteDomain = async () => { const e = new Error("assigned"); e.statusCode = 409; e.code = "DOMAIN_HAS_ASSIGNMENTS"; throw e; };
        try {
            const res = await call(controller.deleteDomain, {
                params: { eventId: new mongoose.Types.ObjectId().toString(), domainId: new mongoose.Types.ObjectId().toString() }
            });
            assert.equal(res.statusCode, 409);
            assert.equal(res.body.code, "DOMAIN_HAS_ASSIGNMENTS");
        } finally { service.deleteDomain = original; }
    });

    it("keeps unexpected database error details out of HTTP responses", async () => {
        const original = service.listDomains;
        service.listDomains = async () => { throw new Error("mongodb://secret-host/credentials"); };
        try {
            const res = await call(controller.listDomains, {
                params: { eventId: new mongoose.Types.ObjectId().toString() }, query: {}
            });
            assert.equal(res.statusCode, 500);
            assert.equal(res.body.message, "Domain request failed");
            assert.doesNotMatch(JSON.stringify(res.body), /secret-host|mongodb:\/\//);
        } finally { service.listDomains = original; }
    });
});
