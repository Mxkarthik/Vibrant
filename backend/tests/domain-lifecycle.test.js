"use strict";

process.env.NODE_ENV = "test";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Event = require("../models/Event");
const EventDomain = require("../models/EventDomain");
const DomainAssignment = require("../models/DomainAssignment");
const DomainPoolSnapshot = require("../models/DomainPoolSnapshot");
const DomainPoolCoordination = require("../models/DomainPoolCoordination");
const DomainAdminAudit = require("../models/DomainAdminAudit");
const service = require("../services/domainAdminService");
const { withDomainPoolLock } = require("../services/domainPoolCoordinator");
const { hashDomains, verifySnapshot } = require("../utils/domainPoolSnapshot");

function fakeSession() {
    return {
        startTransaction() {}, async commitTransaction() {}, inTransaction: () => true,
        async abortTransaction() {}, async endSession() {}
    };
}

function fakeEvent(eventId = new mongoose.Types.ObjectId(), config = {}) {
    return {
        _id: eventId,
        status: "PUBLISHED",
        multiEventAccess: { enabled: false },
        domainConfig: {
            enabled: true, visibility: "PRIVATE", drawStatus: "CLOSED", publishedAt: null,
            publishedBy: null, drawOpenedAt: null, drawClosedAt: null, readEnabledAt: null,
            readEnabledBy: null, poolVersion: 0, ...config
        },
        set(path, value) { this.domainConfig[path.slice("domainConfig.".length)] = value; },
        async save() {}
    };
}

async function withLifecycleDb(t, { event, drafts = [], existingSnapshot = null, assignments = 0 }, run) {
    const versioned = DomainPoolSnapshot.forVersion(2);
    const session = fakeSession();
    const snapshots = new Map(existingSnapshot ? [[existingSnapshot.poolVersion, existingSnapshot]] : []);
    const originals = {
        readyState: mongoose.connection.readyState,
        startSession: mongoose.startSession,
        coordination: DomainPoolCoordination.findOneAndUpdate,
        findEvent: Event.findById,
        findDrafts: EventDomain.find,
        draftCount: EventDomain.countDocuments,
        assignmentCount: DomainAssignment.countDocuments
    };
    mongoose.connection.readyState = 1;
    mongoose.startSession = async () => session;
    DomainPoolCoordination.findOneAndUpdate = async () => ({ version: 11 });
    t.mock.method(DomainPoolCoordination, "findOne", () => ({ select() { return this; }, lean: async () => ({ version: 10 }) }));
    Event.findById = () => ({
        session: async () => event,
        then: (resolve, reject) => Promise.resolve(event).then(resolve, reject)
    });
    EventDomain.find = () => ({
        sort() { return this; },
        session() { return this; },
        lean: async () => drafts
    });
    EventDomain.countDocuments = filter => ({
        session: async actual => {
            assert.equal(actual, session);
            assert.deepEqual(filter, { event: event._id });
            return drafts.length;
        },
        then: (resolve, reject) => Promise.resolve(drafts.length).then(resolve, reject)
    });
    t.mock.method(EventDomain, "deleteMany", async (filter, options) => {
        assert.deepEqual(filter, { event: event._id });
        assert.equal(options.session, session);
        return { deletedCount: drafts.splice(0).length };
    });
    t.mock.method(DomainAdminAudit, "create", async ([record], options) => {
        assert.equal(options.session, session);
        return [record];
    });
    DomainAssignment.countDocuments = () => ({ session: async () => assignments, then: (resolve, reject) => Promise.resolve(assignments).then(resolve, reject) });
    t.mock.method(DomainAssignment, "exists", filter => ({ session(actual) {
        assert.equal(actual, session);
        assert.deepEqual(filter, { event: event._id });
        return assignments ? { _id: new mongoose.Types.ObjectId() } : null;
    } }));
    for (const Model of [DomainPoolSnapshot, versioned]) {
        t.mock.method(Model, "findOne", filter => ({
            session(actual) { assert.equal(actual, session); return this; },
            then(resolve, reject) {
                assert.equal(filter.event, event._id);
                assert.equal(Model, DomainPoolSnapshot.forVersion(filter.poolVersion));
                return Promise.resolve(snapshots.get(filter.poolVersion)).then(resolve, reject);
            }
        }));
        t.mock.method(Model, "create", async ([doc], options) => {
            assert.equal(options.session, session);
            assert.equal(Model, DomainPoolSnapshot.forVersion(doc.poolVersion));
            const snapshot = { ...doc, _id: new mongoose.Types.ObjectId() };
            snapshots.set(doc.poolVersion, snapshot);
            return [snapshot];
        });
    }
    t.mock.method(versioned, "exists", filter => ({ session: async () =>
        Array.from(snapshots.keys()).some(version => version >= filter.poolVersion.$gte)
    }));
    try { await run((version = event.domainConfig.poolVersion) => snapshots.get(version)); }
    finally {
        t.mock.restoreAll();
        mongoose.connection.readyState = originals.readyState;
        mongoose.startSession = originals.startSession;
        DomainPoolCoordination.findOneAndUpdate = originals.coordination;
        Event.findById = originals.findEvent;
        EventDomain.find = originals.findDrafts;
        EventDomain.countDocuments = originals.draftCount;
        DomainAssignment.countDocuments = originals.assignmentCount;
    }
}

function makeDomain(title = "Theme A") {
    return {
        _id: new mongoose.Types.ObjectId(),
        title,
        problemStatement: `Build ${title}`,
        instructions: "Show a prototype",
        createdAt: new Date("2026-01-01T00:00:00Z")
    };
}

function bindSnapshot(event, adminId, version, publishedAt, domains) {
    return {
        event: event._id,
        poolVersion: version,
        publishedAt,
        publishedBy: adminId,
        domains: domains.map(({ _id, title, problemStatement, instructions }) => ({
            domain: _id, title, problemStatement, instructions
        })),
        contentHash: hashDomains(domains.map(({ _id, title, problemStatement, instructions }) => ({
            domain: _id, title, problemStatement, instructions
        })))
    };
}

describe("Admin domain lottery lifecycle (transaction mocked; no MongoDB)", () => {
    it("freezes exact ordered membership and statement content on first open", async t => {
        const event = fakeEvent();
        const adminId = new mongoose.Types.ObjectId();
        const drafts = [makeDomain("First"), makeDomain("Second")];
        await withLifecycleDb(t, { event, drafts }, async getSnapshot => {
            const result = await service.openDraw(event._id, adminId);
            const snapshot = getSnapshot();
            assert.equal(event.domainConfig.visibility, "PRIVATE");
            assert.equal(event.domainConfig.drawStatus, "OPEN");
            assert.equal(event.domainConfig.poolVersion, 1);
            assert.equal(event.domainConfig.publishedAt.getTime(), snapshot.publishedAt.getTime());
            assert.equal(snapshot.publishedBy.toString(), adminId.toString());
            assert.deepEqual(snapshot.domains.map(item => item.domain.toString()), drafts.map(item => item._id.toString()));
            assert.equal(snapshot.domains[1].problemStatement, "Build Second");
            assert.equal(result.snapshot.domains.length, 2);
        });
    });

    it("rejects empty, disabled, unpublished-event, and Combo Pass parent opens", async t => {
        const empty = fakeEvent();
        await withLifecycleDb(t, { event: empty }, async () => {
            await assert.rejects(service.openDraw(empty._id, new mongoose.Types.ObjectId()), e => e.code === "DOMAIN_POOL_EMPTY");
        });
        const disabled = fakeEvent(new mongoose.Types.ObjectId(), { enabled: false });
        await withLifecycleDb(t, { event: disabled, drafts: [makeDomain()] }, async () => {
            await assert.rejects(service.openDraw(disabled._id, new mongoose.Types.ObjectId()), e => e.code === "DOMAINS_DISABLED");
        });
        const cancelled = fakeEvent(new mongoose.Types.ObjectId(), { enabled: true });
        cancelled.status = "CANCELLED";
        await withLifecycleDb(t, { event: cancelled, drafts: [makeDomain()] }, async () => {
            await assert.rejects(service.openDraw(cancelled._id, new mongoose.Types.ObjectId()), e => e.code === "EVENT_NOT_ELIGIBLE");
        });
        const combo = fakeEvent();
        combo.multiEventAccess.enabled = true;
        await withLifecycleDb(t, { event: combo, drafts: [makeDomain()] }, async () => {
            await assert.rejects(service.openDraw(combo._id, new mongoose.Types.ObjectId()), e => e.code === "EVENT_NOT_ELIGIBLE");
        });
    });

    it("closes and reopens the same frozen pool without changing assignments or version", async t => {
        const event = fakeEvent();
        const adminId = new mongoose.Types.ObjectId();
        const publishedAt = new Date("2026-02-01T12:00:00Z");
        const domains = [makeDomain("Fixed")];
        event.domainConfig = {
            ...event.domainConfig, publishedAt, publishedBy: adminId, drawOpenedAt: publishedAt,
            drawStatus: "OPEN", poolVersion: 7
        };
        const snapshot = bindSnapshot(event, adminId, 7, publishedAt, domains);
        const assignmentCountBefore = 5;
        await withLifecycleDb(t, { event, existingSnapshot: snapshot, assignments: assignmentCountBefore }, async getSnapshot => {
            await service.closeDraw(event._id);
            assert.equal(event.domainConfig.drawStatus, "CLOSED");
            const closedAt = event.domainConfig.drawClosedAt;
            await service.openDraw(event._id, new mongoose.Types.ObjectId());
            assert.equal(event.domainConfig.drawStatus, "OPEN");
            assert.equal(event.domainConfig.poolVersion, 7);
            assert.equal(event.domainConfig.publishedAt.getTime(), publishedAt.getTime());
            assert.equal(event.domainConfig.drawClosedAt.getTime(), closedAt.getTime());
            assert.equal(getSnapshot(), snapshot);
            assert.equal(assignmentCountBefore, 5);
        });
    });

    it("enables READ only after closure and preserves the frozen snapshot", async t => {
        const unopened = fakeEvent();
        await withLifecycleDb(t, { event: unopened }, async () => {
            await assert.rejects(service.enableRead(unopened._id, new mongoose.Types.ObjectId()), e => e.code === "DRAW_NOT_STARTED");
        });
        const event = fakeEvent();
        const adminId = new mongoose.Types.ObjectId();
        const publishedAt = new Date("2026-03-01T12:00:00Z");
        const domains = [makeDomain("Frozen")];
        event.domainConfig = { ...event.domainConfig, publishedAt, publishedBy: adminId, poolVersion: 2 };
        const snapshot = bindSnapshot(event, adminId, 2, publishedAt, domains);
        await withLifecycleDb(t, { event, existingSnapshot: snapshot }, async getSnapshot => {
            event.domainConfig.drawStatus = "OPEN";
            await assert.rejects(service.enableRead(event._id, adminId), e => e.code === "READ_REQUIRES_CLOSED_DRAW");
            event.domainConfig.drawStatus = "CLOSED";
            await service.enableRead(event._id, adminId);
            const readAt = event.domainConfig.readEnabledAt;
            assert.equal(event.domainConfig.visibility, "READABLE");
            assert.equal(event.domainConfig.readEnabledBy.toString(), adminId.toString());
            assert.equal(event.domainConfig.drawStatus, "CLOSED");
            await service.enableRead(event._id, new mongoose.Types.ObjectId());
            assert.equal(event.domainConfig.readEnabledAt.getTime(), readAt.getTime());
            await assert.rejects(service.openDraw(event._id, adminId), e => e.code === "READ_ALREADY_ENABLED");
            assert.equal(getSnapshot(), snapshot);
        });
    });

    it("rejects corrupted frozen membership or content", async t => {
        const event = fakeEvent();
        const adminId = new mongoose.Types.ObjectId();
        const publishedAt = new Date("2026-04-01T12:00:00Z");
        event.domainConfig = { ...event.domainConfig, publishedAt, poolVersion: 3, drawStatus: "CLOSED" };
        const snapshot = bindSnapshot(event, adminId, 3, publishedAt, [makeDomain("Original")]);
        snapshot.domains[0].problemStatement = "Tampered";
        await withLifecycleDb(t, { event, existingSnapshot: snapshot }, async () => {
            await assert.rejects(service.openDraw(event._id, adminId), e => e.code === "DOMAIN_POOL_INTEGRITY_FAILED");
        });
    });

    it("returns lifecycle counts and allowed actions without exposing frozen entries", async t => {
        const event = fakeEvent();
        const adminId = new mongoose.Types.ObjectId();
        const publishedAt = new Date("2026-05-01T12:00:00Z");
        event.domainConfig = { ...event.domainConfig, publishedAt, publishedBy: adminId, poolVersion: 4 };
        const snapshot = bindSnapshot(event, adminId, 4, publishedAt, [makeDomain("Secret")]);
        await withLifecycleDb(t, { event, existingSnapshot: snapshot, assignments: 2 }, async () => {
            const status = await service.getLifecycleStatus(event._id);
            assert.equal(status.frozenDomainCount, 1);
            assert.equal(status.assignedEntryCount, 2);
            assert.equal(status.allowedActions.reopen, true);
            assert.equal(status.allowedActions.enableRead, true);
            assert.equal(status.allowedActions.revise, false);
            assert.equal("domains" in status, false);
            assert.equal(JSON.stringify(status).includes("Build Secret"), false);
        });
    });

    it("revises a closed pool without changing its snapshot, then freezes a new draft version", async t => {
        const event = fakeEvent();
        const adminId = new mongoose.Types.ObjectId();
        const drafts = [makeDomain()];
        await withLifecycleDb(t, { event, drafts }, async getSnapshot => {
            await service.openDraw(event._id, adminId);
            await service.closeDraw(event._id, "frozen:1");
            const first = getSnapshot(1);
            assert.equal((await service.getLifecycleStatus(event._id)).allowedActions.revise, true);
            await assert.rejects(service.createDomain(event._id, adminId, {}), { code: "DOMAIN_POOL_LOCKED" });
            await service.revisePool(event._id, "frozen:1");
            assert.equal(event.domainConfig.revisionPending, true);
            assert.equal(event.domainConfig.publishedAt, null);
            assert.equal(event.domainConfig.drawOpenedAt, null);
            assert.equal(event.domainConfig.drawClosedAt, null);
            const draftStatus = await service.getLifecycleStatus(event._id);
            assert.equal(draftStatus.frozenDomainCount, 0);
            assert.deepEqual(draftStatus.allowedActions, {
                open: true, reopen: false, close: false, enableRead: false, revise: false, resetToDraft: false, clearDraft: true
            });
            await assert.rejects(service.loadActiveSnapshot(event), { code: "DOMAIN_POOL_NOT_FROZEN" });
            await assert.rejects(service.openDraw(event._id, adminId), { code: "DOMAIN_CONFIG_CONFLICT" });
            await assert.rejects(service.openDraw(event._id, adminId, "frozen:1"), { code: "DOMAIN_CONFIG_CONFLICT" });
            await assert.rejects(service.revisePool(event._id, "frozen:1"), { code: "DOMAIN_REVISION_NOT_ALLOWED" });
            await assert.rejects(service.enableRead(event._id, adminId), { code: "DRAW_NOT_STARTED" });
            drafts[0].title = "Revised title";
            drafts.push(makeDomain("Added theme"));
            const reopened = await service.openDraw(event._id, adminId, "draft:1");
            assert.equal(reopened.snapshot.poolVersion, 2);
            assert.equal(event.domainConfig.revisionPending, false);
            assert.equal(getSnapshot(1), first);
            assert.equal(first.domains[0].title, "Theme A");
            assert.equal(first.domains.length, 1);
            assert.equal((await service.loadActiveSnapshot(event)).domains[0].title, "Revised title");
            assert.equal((await service.loadActiveSnapshot(event)).domains.length, 2);
            await service.closeDraw(event._id, "frozen:2");
            await assert.rejects(service.revisePool(event._id, "frozen:1"), { code: "DOMAIN_CONFIG_CONFLICT" });
            await service.revisePool(event._id, "frozen:2");
            const third = await service.openDraw(event._id, adminId, "draft:2");
            assert.equal(third.snapshot.poolVersion, 3);
            assert.equal(getSnapshot(2), reopened.snapshot);
        });
    });

    it("refuses revision for assignments, unsafe visibility, open draws, or damaged snapshots", async t => {
        const event = fakeEvent();
        const adminId = new mongoose.Types.ObjectId();
        const publishedAt = new Date();
        Object.assign(event.domainConfig, { poolVersion: 1, publishedAt, publishedBy: adminId });
        const snapshot = bindSnapshot(event, adminId, 1, publishedAt, [makeDomain()]);
        await withLifecycleDb(t, { event, existingSnapshot: snapshot, assignments: 1 }, async () => {
            await assert.rejects(service.revisePool(event._id), { code: "DOMAIN_HAS_ASSIGNMENTS" });
            assert.equal(event.domainConfig.publishedAt, publishedAt);
        });
        await withLifecycleDb(t, { event, existingSnapshot: snapshot }, async () => {
            for (const state of [{ visibility: "READABLE" }, { visibility: "PUBLIC" }, { drawStatus: "OPEN" }, { enabled: false }]) {
                const prior = { ...event.domainConfig };
                Object.assign(event.domainConfig, state);
                await assert.rejects(service.revisePool(event._id), { code: "DOMAIN_REVISION_NOT_ALLOWED" });
                event.domainConfig = prior;
            }
            snapshot.domains[0].title = "Tampered";
            await assert.rejects(service.revisePool(event._id), { code: "DOMAIN_POOL_INTEGRITY_FAILED" });
        });
        await withLifecycleDb(t, { event }, async () => {
            await assert.rejects(service.revisePool(event._id), { code: "DOMAIN_POOL_INTEGRITY_FAILED" });
        });
    });

    it("leaves the revised draft unpublished when snapshot allocation fails or collides", async t => {
        const event = fakeEvent(undefined, { poolVersion: 1, revisionPending: true });
        const adminId = new mongoose.Types.ObjectId();
        await withLifecycleDb(t, { event, drafts: [makeDomain()] }, async () => {
            const versioned = DomainPoolSnapshot.forVersion(2);
            versioned.exists.mock.mockImplementationOnce(() => ({ session: async () => ({}) }));
            await assert.rejects(service.openDraw(event._id, adminId, "draft:1"), { code: "DOMAIN_POOL_INTEGRITY_FAILED" });
            versioned.create.mock.mockImplementationOnce(async () => { throw new Error("snapshot insert failed"); });
            await assert.rejects(service.openDraw(event._id, adminId, "draft:1"), /snapshot insert failed/);
            assert.equal(event.domainConfig.revisionPending, true);
            assert.equal(event.domainConfig.poolVersion, 1);
            assert.equal(event.domainConfig.publishedAt, null);
        });
    });

    for (const visibility of ["PRIVATE", "READABLE"]) {
        it(`audits a ${visibility} reset, retains the snapshot, and publishes the next version`, async t => {
            const admin = new mongoose.Types.ObjectId();
            const publishedAt = new Date();
            const event = fakeEvent(undefined, {
                visibility, poolVersion: 1, publishedAt, publishedBy: admin, drawClosedAt: publishedAt,
                readEnabledAt: visibility === "READABLE" ? publishedAt : null,
                readEnabledBy: visibility === "READABLE" ? admin : null
            });
            const drafts = [makeDomain()];
            const snapshot = bindSnapshot(event, admin, 1, publishedAt, drafts);
            await withLifecycleDb(t, { event, drafts, existingSnapshot: snapshot }, async getSnapshot => {
                const before = await service.getLifecycleStatus(event._id);
                assert.equal(before.allowedActions.resetToDraft, true);
                assert.equal(before.allowedActions.clearDraft, false);
                const { status, audit } = await service.resetToDraft(event._id, admin, "Accidental READ", before.coordinationVersion);
                assert.equal(status.visibility, "PRIVATE");
                assert.equal(status.activeDraft, true);
                assert.equal(status.activePoolVersion, null);
                assert.equal(status.lastPreservedVersion, 1);
                assert.equal(status.domainCount, 1);
                assert.equal(status.allowedActions.clearDraft, true);
                assert.equal(event.domainConfig.readEnabledBy, null);
                assert.equal(event.domainConfig.readEnabledAt, null);
                assert.equal(audit.admin, admin);
                assert.equal(audit.action, "RESET_TO_DRAFT");
                assert.equal(audit.previous.visibility, visibility);
                assert.equal(audit.previous.readEnabledAt, visibility === "READABLE" ? publishedAt : null);
                assert.equal(getSnapshot(1), snapshot);
                await assert.rejects(service.loadActiveSnapshot(event), { code: "DOMAIN_POOL_NOT_FROZEN" });
                await assert.rejects(service.resetToDraft(event._id, admin, "duplicate", 10), { code: "DOMAIN_RESET_NOT_ALLOWED" });
                await assert.rejects(service.openDraw(event._id, admin, "frozen:1"), { code: "DOMAIN_CONFIG_CONFLICT" });
                const next = await service.openDraw(event._id, admin, "draft:1");
                assert.equal(next.snapshot.poolVersion, 2);
                assert.equal(await service.loadActiveSnapshot(event), next.snapshot);
                assert.equal(getSnapshot(1), snapshot);
            });
        });
    }

    it("rejects assigned, open, stale and corrupt reset requests before persisting audit", async t => {
        const admin = new mongoose.Types.ObjectId();
        const publishedAt = new Date();
        const event = fakeEvent(undefined, { poolVersion: 1, publishedAt });
        const snapshot = bindSnapshot(event, admin, 1, publishedAt, [makeDomain()]);
        await withLifecycleDb(t, { event, existingSnapshot: snapshot, assignments: 1 }, async () => {
            assert.equal((await service.getLifecycleStatus(event._id)).allowedActions.resetToDraft, false);
            await assert.rejects(service.resetToDraft(event._id, admin, "assigned", 10), { code: "DOMAIN_HAS_ASSIGNMENTS" });
            assert.equal(DomainAdminAudit.create.mock.callCount(), 0);
        });
        await withLifecycleDb(t, { event, existingSnapshot: snapshot }, async () => {
            event.domainConfig.drawStatus = "OPEN";
            await assert.rejects(service.resetToDraft(event._id, admin, "open", 10), { code: "DOMAIN_RESET_NOT_ALLOWED" });
            event.domainConfig.drawStatus = "CLOSED";
            await assert.rejects(service.resetToDraft(event._id, admin, "stale", 9), { code: "DOMAIN_CONFIG_CONFLICT" });
            snapshot.domains[0].title = "Corrupt";
            await assert.rejects(service.resetToDraft(event._id, admin, "corrupt", 10), { code: "DOMAIN_POOL_INTEGRITY_FAILED" });
            assert.equal(DomainAdminAudit.create.mock.callCount(), 0);
            assert.equal(event.domainConfig.publishedAt, publishedAt);
        });
    });

    it("bulk clears only the scoped draft and preserves the historic snapshot", async t => {
        const admin = new mongoose.Types.ObjectId();
        const event = fakeEvent(undefined, { poolVersion: 1, revisionPending: true });
        const drafts = [makeDomain(), makeDomain("Another")];
        const snapshot = bindSnapshot(event, admin, 1, new Date(), drafts);
        await withLifecycleDb(t, { event, drafts, existingSnapshot: snapshot }, async getSnapshot => {
            await assert.rejects(service.clearDraftDomains(event._id, admin, "", 9), { code: "DOMAIN_CONFIG_CONFLICT" });
            assert.equal(EventDomain.deleteMany.mock.callCount(), 0);
            const { status, audit } = await service.clearDraftDomains(event._id, admin, "Start fresh", 10);
            assert.equal(audit.deletedDomainCount, 2);
            assert.equal(audit.action, "CLEAR_DOMAINS");
            assert.equal(status.domainCount, 0);
            assert.equal(status.allowedActions.open, false);
            assert.equal(status.allowedActions.clearDraft, false);
            assert.equal(getSnapshot(1).domains.length, 2);
            await assert.rejects(service.clearDraftDomains(event._id, admin, "", 10), { code: "DOMAIN_DRAFT_CLEAR_NOT_ALLOWED" });
            event.domainConfig.publishedAt = snapshot.publishedAt;
            event.domainConfig.revisionPending = false;
            await assert.rejects(service.clearDraftDomains(event._id, admin, "", 10), { code: "DOMAIN_DRAFT_CLEAR_NOT_ALLOWED" });
            assert.equal(DomainAdminAudit.create.mock.callCount(), 1);
        });
        await withLifecycleDb(t, { event: fakeEvent(), drafts: [makeDomain()], assignments: 1 }, async () => {
            const draft = await Event.findById().session();
            await assert.rejects(service.clearDraftDomains(draft._id, admin, "", 10), { code: "DOMAIN_HAS_ASSIGNMENTS" });
            assert.equal(EventDomain.deleteMany.mock.callCount(), 0);
        });
    });

    it("fails closed when transaction coordination is unavailable", async () => {
        const originalReadyState = mongoose.connection.readyState;
        mongoose.connection.readyState = 0;
        try {
            await assert.rejects(withDomainPoolLock(new mongoose.Types.ObjectId(), async () => {}), error =>
                error.statusCode === 503 && error.code === "DOMAIN_COORDINATION_UNAVAILABLE");
            await assert.rejects(service.revisePool(new mongoose.Types.ObjectId()), {
                statusCode: 503, code: "DOMAIN_COORDINATION_UNAVAILABLE"
            });
        } finally { mongoose.connection.readyState = originalReadyState; }
    });

    it("does not reach the revision checks when the deployment rejects transactions", async t => {
        const event = fakeEvent();
        await withLifecycleDb(t, { event }, async () => {
            DomainPoolCoordination.findOneAndUpdate = async () => {
                throw Object.assign(new Error("Transaction numbers are only allowed on a replica set member or mongos"), { code: 20 });
            };
            const load = t.mock.method(Event, "findById");
            await assert.rejects(service.revisePool(event._id), { statusCode: 503, code: "DOMAIN_COORDINATION_UNAVAILABLE" });
            assert.equal(load.mock.callCount(), 0);
        });
    });

    it("does not replay a transaction with an unknown commit result", async () => {
        const originalReadyState = mongoose.connection.readyState;
        const originalStartSession = mongoose.startSession;
        let calls = 0;
        mongoose.connection.readyState = 1;
        let commits = 0;
        mongoose.startSession = async () => ({
            ...fakeSession(),
            commitTransaction: async () => {
                commits += 1;
                const error = new Error("commit uncertain");
                error.hasErrorLabel = label => label === "UnknownTransactionCommitResult";
                throw error;
            },
            endSession: async () => {}
        });
        const originalCoordination = DomainPoolCoordination.findOneAndUpdate;
        DomainPoolCoordination.findOneAndUpdate = async () => ({});
        try {
            await assert.rejects(withDomainPoolLock(new mongoose.Types.ObjectId(), async () => { calls += 1; }), error =>
                error.statusCode === 503 && error.code === "DOMAIN_COMMIT_UNKNOWN");
            assert.equal(calls, 1);
            assert.equal(commits, 1);
        } finally {
            mongoose.connection.readyState = originalReadyState;
            mongoose.startSession = originalStartSession;
            DomainPoolCoordination.findOneAndUpdate = originalCoordination;
        }
    });

    it("verifies immutable assignment/team identity and pool snapshot indexes", async () => {
        const eventId = new mongoose.Types.ObjectId();
        const teamId = new mongoose.Types.ObjectId();
        const assignment = new DomainAssignment({
            event: eventId, domain: new mongoose.Types.ObjectId(), entryType: "TEAM", entry: teamId,
            initiatedBy: new mongoose.Types.ObjectId(), poolVersion: 1,
            contentSnapshot: { title: "T", problemStatement: "S" }
        });
        await assert.doesNotReject(assignment.validate());
        assert.ok(DomainAssignment.schema.indexes().some(([keys, options]) =>
            keys.event === 1 && keys.entryType === 1 && keys.entry === 1 && options.unique));
        assert.ok(DomainPoolSnapshot.schema.indexes().some(([keys, options]) => keys.event === 1 && options.unique));
        assert.ok(DomainPoolSnapshot.forVersion(2).schema.indexes().some(([keys, options]) =>
            keys.event === 1 && keys.poolVersion === 1 && options.unique));
        assert.equal(DomainPoolSnapshot.schema.path("domains").options.immutable, true);
        const snapshot = {
            event: eventId, poolVersion: 1, publishedAt: new Date(), domains: [{
                domain: new mongoose.Types.ObjectId(), title: "T", problemStatement: "S", instructions: ""
            }]
        };
        snapshot.contentHash = hashDomains(snapshot.domains);
        assert.equal(verifySnapshot({ _id: eventId, domainConfig: { poolVersion: 1, publishedAt: snapshot.publishedAt } }, snapshot), true);
        assert.equal(verifySnapshot({ _id: eventId, domainConfig: { poolVersion: 2, publishedAt: snapshot.publishedAt } }, snapshot), false);
    });
});
