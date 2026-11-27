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

    it("mounts all domain paths under Admin protection, including revision", async () => {
        assert.ok(adminRoutes.stack.some(layer => layer.handle === domainRoutes), "domain routes are mounted in admin router");
        assert.equal(adminRoutes.stack[0].name, "protect");
        const unauthenticated = response();
        await adminRoutes.stack[0].handle({ headers: {} }, unauthenticated, () => assert.fail("unauthenticated request"));
        assert.equal(unauthenticated.statusCode, 401);
        const adminRoleGuard = adminRoutes.stack[1].handle;
        for (const role of ["PARTICIPANT", "ORGANISER"]) {
            let nextCalled = false;
            const res = response();
            adminRoleGuard({ user: { role } }, res, () => { nextCalled = true; });
            assert.equal(res.statusCode, 403);
            assert.equal(nextCalled, false);
        }
        let admitted = false;
        adminRoleGuard({ user: { role: "ADMIN" } }, response(), () => { admitted = true; });
        assert.equal(admitted, true);
        const routes = domainRoutes.stack.filter(layer => layer.route).map(layer => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);
        assert.deepEqual(routes, ["PATCH /config", "POST /open", "POST /close", "POST /enable-read", "POST /revise",
            "POST /reset-to-draft", "POST /clear-draft", "GET /status", "POST /", "GET /", "GET /:domainId", "PATCH /:domainId", "DELETE /:domainId"]);
    });

    it("requires typed reset confirmation, a reason, and a current coordination version", async t => {
        const eventId = new mongoose.Types.ObjectId().toString();
        const admin = new mongoose.Types.ObjectId();
        const audit = { action: "RESET_TO_DRAFT", admin: admin.toString(), reason: "Accidental READ" };
        const reset = t.mock.method(service, "resetToDraft", async () => ({
            event: { domainConfig: { visibility: "PRIVATE", poolVersion: 1, revisionPending: true } },
            status: { activeDraft: true, lastPreservedVersion: 1, activePoolVersion: null, domainCount: 1, allowedActions: { clearDraft: true } },
            audit
        }));
        const req = {
            params: { eventId }, query: { coordinationVersion: "5" }, user: { _id: admin },
            body: { confirmation: "RESET_TO_DRAFT", reason: " Accidental READ " }
        };
        const incorrect = await call(controller.resetLotteryToDraft, { ...req, body: { confirmation: "OTHER" } });
        assert.equal(incorrect.statusCode, 400);
        assert.equal(incorrect.body.code, "INVALID_CONFIRMATION");
        for (const body of [
            { confirmation: "RESET_TO_DRAFT" },
            { ...req.body, reason: " ".repeat(5) },
            { ...req.body, reason: "x".repeat(501) },
            { ...req.body, visibility: "PRIVATE" }
        ]) assert.equal((await call(controller.resetLotteryToDraft, { ...req, body })).statusCode, 400);
        for (const coordinationVersion of [undefined, "01", ["5"], "9007199254740992"]) {
            assert.equal((await call(controller.resetLotteryToDraft, { ...req, query: { coordinationVersion } })).statusCode, 400);
        }
        assert.equal(reset.mock.callCount(), 0);
        const applied = await call(controller.resetLotteryToDraft, req);
        assert.equal(applied.statusCode, 200);
        assert.deepEqual(reset.mock.calls[0].arguments, [eventId, admin, "Accidental READ", 5]);
        assert.equal(applied.body.data.domainConfig.revisionPending, true);
        assert.equal(applied.body.data.lastPreservedVersion, 1);
        assert.deepEqual(applied.body.data.audit, audit);
    });

    it("accepts a clear without a reason and returns an uncertain commit without retry", async t => {
        const eventId = new mongoose.Types.ObjectId().toString();
        const admin = new mongoose.Types.ObjectId();
        const clear = t.mock.method(service, "clearDraftDomains", async () => {
            throw Object.assign(new Error("Read status before retrying"), { statusCode: 503, code: "DOMAIN_COMMIT_UNKNOWN" });
        });
        const res = await call(controller.clearDraftDomains, {
            params: { eventId }, user: { _id: admin }, query: { coordinationVersion: "0" },
            body: { confirmation: "CLEAR_DOMAINS" }
        });
        assert.equal(res.statusCode, 503);
        assert.equal(res.body.code, "DOMAIN_COMMIT_UNKNOWN");
        assert.equal(clear.mock.callCount(), 1);
        assert.deepEqual(clear.mock.calls[0].arguments, [eventId, admin, "", 0]);
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
                publishedBy: null, drawOpenedAt: null, drawClosedAt: null,
                readEnabledAt: null, readEnabledBy: null, poolVersion: 0, revisionPending: false
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

    it("validates revision bodies and versions and returns the draft configuration", async t => {
        const eventId = new mongoose.Types.ObjectId();
        const revise = t.mock.method(service, "revisePool", async () => ({
            _id: eventId,
            domainConfig: { enabled: true, visibility: "PRIVATE", drawStatus: "CLOSED", poolVersion: 1, revisionPending: true }
        }));
        const req = { params: { eventId: eventId.toString() }, body: {}, query: { poolState: "frozen:1" } };
        for (const invalid of [{ ...req, body: { reset: true } }, { ...req, query: { poolState: ["frozen:1"] } }]) {
            assert.equal((await call(controller.reviseDomainPool, invalid)).statusCode, 400);
        }
        assert.equal(revise.mock.callCount(), 0);
        const res = await call(controller.reviseDomainPool, req);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.data.revisionPending, true);
        assert.equal(res.body.data.publishedAt, null);
        assert.deepEqual(revise.mock.calls[0].arguments, [eventId.toString(), "frozen:1"]);
    });

    it("requires empty lifecycle bodies and never returns frozen membership when opening", async () => {
        assert.throws(() => validation.validateEmptyBody({ domainId: "chosen" }));
        const original = service.openDraw;
        const eventId = new mongoose.Types.ObjectId();
        service.openDraw = async () => ({
            event: { _id: eventId, domainConfig: { enabled: true, visibility: "PRIVATE", drawStatus: "OPEN", poolVersion: 1 } },
            snapshot: { domains: [{ domain: new mongoose.Types.ObjectId(), title: "Secret", problemStatement: "Private text" }] }
        });
        try {
            const res = await call(controller.openDomainDraw, {
                params: { eventId: eventId.toString() }, body: {}, user: { _id: new mongoose.Types.ObjectId() }
            });
            assert.equal(res.statusCode, 200);
            assert.equal(res.body.data.visibility, "PRIVATE");
            assert.equal(res.body.data.drawStatus, "OPEN");
            assert.equal(res.body.data.publishedDomainCount, 1);
            assert.equal(JSON.stringify(res.body).includes("Private text"), false);
            assert.equal("domains" in res.body.data, false);
        } finally { service.openDraw = original; }
    });
});
