"use strict";

const { before, after, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Event = require("../models/Event");
const EventDomain = require("../models/EventDomain");
const DomainAssignment = require("../models/DomainAssignment");
const DomainPoolCoordination = require("../models/DomainPoolCoordination");
const DomainPoolSnapshot = require("../models/DomainPoolSnapshot");
const DomainAdminAudit = require("../models/DomainAdminAudit");
const Registration = require("../models/Registration");
const Team = require("../models/Team");
const { drawParticipantDomain } = require("../services/participantDomainDrawService");
const controller = require("../controllers/domainAdminController");
const { withDomainPoolLock } = require("../services/domainPoolCoordinator");
const service = require("../services/domainAdminService");

const uri = process.env.DOMAIN_REVISION_REPLICA_URI;
const versions = DomainPoolSnapshot.forVersion(2);
const adminId = new mongoose.Types.ObjectId();
const fields = { title: "Initial theme", problemStatement: "Build a prototype" };

async function createEvent({ mode = "TEAM", enabled = true } = {}) {
    return Event.create({
        name: "Domain revision fixture", description: "Replica set test", category: "TECHNICAL",
        venue: "Local fixture", startDate: new Date("2030-02-01"), endDate: new Date("2030-02-02"),
        registration: {
            mode, capacity: 10, deadline: new Date("2030-01-31"),
            minTeamSize: mode === "TEAM" ? 2 : 1, maxTeamSize: mode === "TEAM" ? 2 : 1
        },
        createdBy: adminId, domainConfig: { enabled }
    });
}

async function fixture({ close = true, mode = "TEAM" } = {}) {
    const event = await createEvent({ mode });
    const draft = await service.createDomain(event._id, adminId, fields);
    await service.openDraw(event._id, adminId, "draft:0");
    if (close) await service.closeDraw(event._id, "frozen:1");
    return { id: event._id, draft };
}

async function invokeRecovery(handler, id, coordinationVersion, body) {
    const response = {
        status(code) { this.code = code; return this; },
        json(value) { this.body = value; return this; }
    };
    await handler({ params: { eventId: String(id) }, query: { coordinationVersion: String(coordinationVersion) },
        user: { _id: adminId }, body }, response);
    return response;
}

function draw(id, entryType, entry = new mongoose.Types.ObjectId()) {
    // Test fixture for the future assignment writer. All persistence uses the production lock.
    return withDomainPoolLock(id, async session => {
        const event = await Event.findById(id).session(session);
        const config = event.domainConfig;
        if (!config.enabled || config.drawStatus !== "OPEN" || config.visibility !== "PRIVATE") {
            throw new Error("Fixture draw is closed");
        }
        const snapshot = await service.loadActiveSnapshot(event, session);
        const { domain, title, problemStatement, instructions } = snapshot.domains[0];
        const [assignment] = await DomainAssignment.create([{
            event: id, domain, entryType, entry, initiatedBy: adminId,
            poolVersion: snapshot.poolVersion, contentSnapshot: { title, problemStatement, instructions }
        }], { session });
        return assignment;
    });
}

async function participantFixture(eventId, name) {
    const authenticatedUser = { _id: new mongoose.Types.ObjectId(), role: "PARTICIPANT", isActive: true };
    const team = await Team.create({
        event: eventId, teamName: name, leader: authenticatedUser._id, memberCount: 2,
        payment: { status: "NOT_REQUIRED" }
    });
    await Registration.create({
        event: eventId, user: authenticatedUser._id, team: team._id, isTeamLeader: true,
        participantDetails: { fullName: name, mobileNumber: "9999999999", collegeName: "Fixture",
            department: "CSM", section: "A", yearOfStudy: "2", rollNumber: name }
    });
    return { team, pick: () => drawParticipantDomain({ eventId, authenticatedUser }) };
}

describe("Domain pool revision and recovery on an isolated MongoDB replica set", {
    skip: uri ? false : "set DOMAIN_REVISION_REPLICA_URI to a dedicated loopback replica set"
}, () => {
    before(async () => {
        // Accept only a direct loopback seed. Ignore application .env and never accept an application database.
        if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):\d+\/\?replicaSet=[\w-]+$/.test(uri)) {
            throw new Error("Use mongodb://127.0.0.1:PORT/?replicaSet=NAME for a dedicated local test replica set");
        }
        await mongoose.connect(uri, {
            dbName: `domain_revision_test_${new mongoose.Types.ObjectId()}`,
            directConnection: true, autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000
        });
        const hello = await mongoose.connection.db.admin().command({ hello: 1 });
        assert.equal(hello.isWritablePrimary, true);
        const members = [...(hello.hosts || []), ...(hello.passives || []), ...(hello.arbiters || [])];
        const target = new URL(uri);
        assert.ok(hello.setName === target.searchParams.get("replicaSet") && members.length === 1 &&
            /^(127\.0\.0\.1|localhost):\d+$/.test(members[0]) && new URL(`mongodb://${members[0]}`).port === target.port,
            "Use a dedicated single-member loopback replica set");
        assert.ok(hello.logicalSessionTimeoutMinutes > 0, "Replica set must support sessions");
        const { databases } = await mongoose.connection.db.admin().listDatabases({ nameOnly: true, authorizedDatabases: false });
        assert.deepEqual(databases.map(database => database.name).filter(name => !["admin", "config", "local"].includes(name)), [],
            "Test writes require a fresh disposable server with no application databases");
        for (const model of [Event, EventDomain, DomainAssignment, DomainPoolCoordination, DomainPoolSnapshot, versions,
            DomainAdminAudit, Registration, Team]) {
            await model.createCollection();
            await model.createIndexes();
        }
    });

    after(async () => { await mongoose.disconnect(); });

    it("persists one actual participant draw across simultaneous sessions and lets other teams receive the same theme", async () => {
        const { id } = await fixture({ close: false });
        const { pick, team } = await participantFixture(id, "First team");
        const results = await Promise.all([pick(), pick()]);
        assert.deepEqual(results.map(result => result.alreadyAssigned).sort(), [false, true]);
        assert.deepEqual(results[0].theme, results[1].theme);
        assert.equal(+results[0].assignedAt, +results[1].assignedAt);
        assert.equal(await DomainAssignment.countDocuments({ event: id, entryType: "TEAM", entry: team._id }), 1);
        const other = await participantFixture(id, "Other team");
        assert.deepEqual((await other.pick()).theme, results[0].theme);
        await service.closeDraw(id, "frozen:1");
        const state = await service.getLifecycleStatus(id);
        await assert.rejects(service.resetToDraft(id, adminId, "Assigned", state.coordinationVersion), { code: "DOMAIN_HAS_ASSIGNMENTS" });
        assert.deepEqual((await pick()).theme, results[0].theme);
        assert.equal(await DomainAssignment.countDocuments({ event: id }), 2);
    });

    it("serializes the actual participant draw against Close", async () => {
        const { id } = await fixture({ close: false });
        const { pick } = await participantFixture(id, "Close race");
        const [drawResult, closeResult] = await Promise.allSettled([pick(), service.closeDraw(id, "frozen:1")]);
        assert.equal(closeResult.status, "fulfilled");
        assert.equal((await service.getLifecycleStatus(id)).drawStatus, "CLOSED");
        assert.equal(await DomainAssignment.countDocuments({ event: id }), drawResult.status === "fulfilled" ? 1 : 0);
        if (drawResult.status === "fulfilled") assert.deepEqual((await pick()).theme, drawResult.value.theme);
        else assert.equal(drawResult.reason.code, "DOMAIN_LOTTERY_NOT_OPEN");
    });

    for (const action of ["reset", "revision"]) {
        it(`does not draw from the historic pool during Admin ${action} and uses version two after publishing`, async () => {
            const { id, draft } = await fixture();
            const { pick } = await participantFixture(id, action);
            const state = await service.getLifecycleStatus(id);
            const historical = await DomainPoolSnapshot.findOne({ event: id }).lean();
            const [drawResult, recovery] = await Promise.allSettled([
                pick(), action === "reset"
                    ? service.resetToDraft(id, adminId, "Update draft", state.coordinationVersion)
                    : service.revisePool(id, "frozen:1")
            ]);
            assert.equal(recovery.status, "fulfilled");
            assert.equal(drawResult.reason.code, "DOMAIN_LOTTERY_NOT_OPEN");
            assert.equal(await DomainAssignment.countDocuments({ event: id }), 0);
            await service.updateDomain(id, draft._id, adminId, { title: "Replacement theme" });
            await service.openDraw(id, adminId, "draft:1");
            assert.equal((await pick()).theme.title, "Replacement theme");
            assert.equal((await DomainAssignment.findOne({ event: id })).poolVersion, 2);
            assert.deepEqual(await DomainPoolSnapshot.findOne({ event: id }).lean(), historical);
            assert.equal(await DomainAdminAudit.countDocuments({ event: id }), action === "reset" ? 1 : 0);
        });
    }

    for (const transient of [false, true]) {
        it(`verifies actual rollback ${transient ? "and retries a transient failure" : "after a failed assignment insert transaction"}`, async t => {
            const { id } = await fixture({ close: false });
            const { pick } = await participantFixture(id, `Rollback ${transient}`);
            const create = DomainAssignment.create.bind(DomainAssignment);
            let attempts = 0;
            t.mock.method(DomainAssignment, "create", async (...args) => {
                const result = await create(...args);
                if (++attempts === 1) throw Object.assign(new Error("Fixture abort"), {
                    hasErrorLabel: label => transient && label === "TransientTransactionError"
                });
                return result;
            });
            if (transient) assert.equal((await pick()).alreadyAssigned, false);
            else await assert.rejects(pick(), /Fixture abort/);
            assert.equal(await DomainAssignment.countDocuments({ event: id }), transient ? 1 : 0);
            assert.equal(attempts, transient ? 2 : 1);
        });
    }

    it("verifies actual MongoDB index keys and uniqueness", async t => {
        const expected = [
            [DomainAssignment, [[{ event: 1, entryType: 1, entry: 1 }, true], [{ event: 1, domain: 1 }, false]]],
            [DomainPoolSnapshot, [[{ event: 1 }, true]]],
            [versions, [[{ event: 1, poolVersion: 1 }, true]]],
            [DomainPoolCoordination, [[{ event: 1 }, true]]],
            [DomainAdminAudit, []],
            [EventDomain, [[{ event: 1, createdAt: 1, _id: 1 }, false]]]
        ];
        for (const [model, keys] of expected) {
            const indexes = await model.collection.indexes();
            t.diagnostic(`${model.collection.name}: ${JSON.stringify(indexes.map(({ name, key, unique }) => ({ name, key, unique })))}`);
            assert.ok(indexes.some(index => index.name === "_id_" && index.key._id === 1));
            assert.equal(indexes.length, keys.length + 1, model.collection.name);
            for (const [key, unique] of keys) {
                const index = indexes.find(candidate => JSON.stringify(candidate.key) === JSON.stringify(key));
                assert.ok(index && Boolean(index.unique) === unique, `${model.collection.name}: ${JSON.stringify(key)}`);
            }
        }
    });

    it("serializes opening against create, edit and delete and freezes the persisted winner", async () => {
        for (const mutate of [
            id => service.createDomain(id, adminId, { ...fields, title: "Added" }),
            (id, target) => service.updateDomain(id, target, adminId, { title: "Edited" }),
            (id, target) => service.deleteDomain(id, target)
        ]) {
            const { _id: id } = await createEvent();
            await service.createDomain(id, adminId, { ...fields, title: "Anchor" });
            const target = await service.createDomain(id, adminId, fields);
            const [opened, changed] = await Promise.allSettled([
                service.openDraw(id, adminId, "draft:0"), mutate(id, target._id)
            ]);
            assert.equal(opened.status, "fulfilled");
            if (changed.status === "rejected") assert.equal(changed.reason.code, "DOMAIN_POOL_LOCKED");
            const snapshot = await service.loadActiveSnapshot(await Event.findById(id));
            const rows = await EventDomain.find({ event: id }).sort({ createdAt: 1, _id: 1 }).lean();
            assert.deepEqual(snapshot.domains.map(row => [String(row.domain), row.title, row.problemStatement, row.instructions]),
                rows.map(row => [String(row._id), row.title, row.problemStatement, row.instructions]));
            assert.equal(await DomainPoolSnapshot.countDocuments({ event: id }), 1);
        }
    });

    it("uses the database uniqueness rule to allow shared themes and reject a second assignment per team", async () => {
        const { id } = await fixture({ close: false });
        const first = await draw(id, "TEAM");
        const second = await draw(id, "TEAM");
        assert.equal(String(first.domain), String(second.domain));
        assert.notEqual(String(first.entry), String(second.entry));
        const { _id, ...duplicate } = first.toObject();
        await assert.rejects(DomainAssignment.create(duplicate), { code: 11000 });
        assert.equal(await DomainAssignment.countDocuments({ event: id }), 2);
    });

    it("refuses bulk clear when a draft contains a legacy assignment reference", async () => {
        const { id } = await fixture({ close: false });
        const assignment = await draw(id, "TEAM");
        const historical = await DomainPoolSnapshot.findOne({ event: id }).lean();
        // Simulate pre-existing inconsistent data on this fixture only.
        await withDomainPoolLock(id, session => Event.updateOne({ _id: id }, { $set: {
            "domainConfig.drawStatus": "CLOSED", "domainConfig.publishedAt": null,
            "domainConfig.publishedBy": null, "domainConfig.revisionPending": true
        } }, { session }));
        const status = await service.getLifecycleStatus(id);
        assert.equal(status.activeDraft, true);
        assert.equal(status.allowedActions.clearDraft, false);
        await assert.rejects(service.clearDraftDomains(id, adminId, "", status.coordinationVersion), { code: "DOMAIN_HAS_ASSIGNMENTS" });
        assert.ok(await EventDomain.exists({ _id: assignment.domain, event: id }));
        assert.deepEqual(await DomainAssignment.findById(assignment._id).lean(), assignment.toObject());
        assert.deepEqual(await DomainPoolSnapshot.findOne({ event: id }).lean(), historical);
    });

    it("retains immutable version 1 and draws only from version 2 after draft CRUD", async () => {
        const { id, draft } = await fixture();
        const v1 = await DomainPoolSnapshot.findOne({ event: id }).lean();
        await assert.rejects(service.updateDomain(id, draft._id, adminId, fields), { code: "DOMAIN_POOL_LOCKED" });
        await assert.rejects(service.deleteDomain(id, draft._id), { code: "DOMAIN_POOL_LOCKED" });
        await service.revisePool(id, "frozen:1");
        await service.updateDomain(id, draft._id, adminId, { title: "Revised theme" });
        const added = await service.createDomain(id, adminId, { ...fields, title: "Discard this draft" });
        await service.deleteDomain(id, added._id);
        await assert.rejects(draw(id, "TEAM"), /draw is closed/);
        await service.openDraw(id, adminId, "draft:1");
        const assignment = await draw(id, "TEAM");
        assert.equal(assignment.poolVersion, 2);
        assert.equal(assignment.contentSnapshot.title, "Revised theme");
        assert.deepEqual(await DomainPoolSnapshot.findOne({ event: id }).lean(), v1);
        const v2 = await versions.findOne({ event: id, poolVersion: 2 }).lean();
        assert.equal(v2.domains.length, 1);
        const { _id, ...duplicate } = v2;
        await assert.rejects(versions.create(duplicate), { code: 11000 });
    });

    for (const entryType of ["TEAM", "INDIVIDUAL"]) {
        it(`blocks revision when one ${entryType} assignment exists`, async () => {
            const { id } = await fixture({ close: false, mode: entryType });
            const assignment = await draw(id, entryType);
            await service.closeDraw(id, "frozen:1");
            assert.equal((await service.getLifecycleStatus(id)).allowedActions.revise, false);
            await assert.rejects(service.revisePool(id, "frozen:1"), { code: "DOMAIN_HAS_ASSIGNMENTS" });
            const { coordinationVersion } = await service.getLifecycleStatus(id);
            await assert.rejects(service.resetToDraft(id, adminId, "Assigned pool", coordinationVersion), { code: "DOMAIN_HAS_ASSIGNMENTS" });
            assert.deepEqual(await DomainAssignment.findById(assignment._id).lean(), assignment.toObject());
        });
    }

    it("commits at most one concurrent revision, including on an event's first lock write", async () => {
        const { id } = await fixture();
        // Use another event with legacy frozen contents and no coordination document.
        const legacy = await Event.findById(id).lean();
        const snapshot = await DomainPoolSnapshot.findOne({ event: id }).lean();
        const legacyId = new mongoose.Types.ObjectId();
        await Event.create({ ...legacy, _id: legacyId });
        await DomainPoolSnapshot.create({ ...snapshot, _id: new mongoose.Types.ObjectId(), event: legacyId });
        const results = await Promise.allSettled([
            service.revisePool(legacyId, "frozen:1"), service.revisePool(legacyId, "frozen:1")
        ]);
        assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
        assert.equal(results.find(result => result.status === "rejected").reason.code, "DOMAIN_REVISION_NOT_ALLOWED");
        assert.equal(await DomainPoolCoordination.countDocuments({ event: legacyId }), 1);
        assert.equal((await Event.findById(legacyId)).domainConfig.revisionPending, true);
    });

    for (const [name, compete] of [
        ["reopen", id => service.openDraw(id, adminId, "frozen:1")],
        ["enable-read", id => service.enableRead(id, adminId, "frozen:1")]
    ]) {
        it(`serializes revision against ${name}`, async () => {
            const { id } = await fixture();
            const [revise, other] = await Promise.allSettled([service.revisePool(id, "frozen:1"), compete(id)]);
            assert.notEqual(revise.status, other.status);
            const state = await service.getLifecycleStatus(id);
            assert.equal(state.poolVersion, 1);
            assert.equal(state.revisionPending, revise.status === "fulfilled");
            assert.equal(state.frozenDomainCount, state.revisionPending ? 0 : 1);
        });
    }

    it("serializes revision against close and an assignment attempt", async () => {
        const { id } = await fixture({ close: false });
        const [assignment, close, revise] = await Promise.allSettled([
            draw(id, "TEAM"), service.closeDraw(id, "frozen:1"), service.revisePool(id, "frozen:1")
        ]);
        assert.equal(close.status, "fulfilled");
        const state = await service.getLifecycleStatus(id);
        assert.equal(state.assignedEntryCount, assignment.status === "fulfilled" ? 1 : 0);
        assert.equal(state.revisionPending, revise.status === "fulfilled");
        if (assignment.status === "fulfilled") assert.equal(revise.status, "rejected");
        else assert.match(assignment.reason.message, /draw is closed/);
        assert.equal(state.drawStatus, "CLOSED");
    });

    it("serializes Admin CRUD against revision", async () => {
        const { id } = await fixture();
        const [revise, create] = await Promise.allSettled([
            service.revisePool(id, "frozen:1"),
            service.createDomain(id, adminId, { ...fields, title: "Concurrent draft" })
        ]);
        assert.equal(revise.status, "fulfilled");
        assert.equal(await EventDomain.countDocuments({ event: id }), create.status === "fulfilled" ? 2 : 1);
        if (create.status === "rejected") assert.equal(create.reason.code, "DOMAIN_POOL_LOCKED");
        assert.equal((await DomainPoolSnapshot.findOne({ event: id })).domains.length, 1);
    });

    it("rolls back the version insert if the event cannot save and can safely publish on retry", async t => {
        const { id } = await fixture();
        await service.revisePool(id, "frozen:1");
        const save = t.mock.method(Event.prototype, "save", async () => { throw new Error("fixture save failed"); });
        try {
            await assert.rejects(service.openDraw(id, adminId, "draft:1"), /fixture save failed/);
        } finally { save.mock.restore(); }
        assert.equal(await versions.countDocuments({ event: id }), 0);
        assert.equal((await service.getLifecycleStatus(id)).revisionPending, true);
        assert.equal((await service.openDraw(id, adminId, "draft:1")).snapshot.poolVersion, 2);
    });

    it("audits READ recovery and draft deletion, preserving version 1 while version 2 becomes active", async () => {
        const { _id: id } = await createEvent({ enabled: false });
        const other = await fixture();
        await service.updateEnabled(id, true);
        const draft = await service.createDomain(id, adminId, fields);
        await service.createDomain(id, adminId, { ...fields, title: "Second theme" });
        await service.createDomain(id, adminId, { ...fields, title: "Third theme" });
        await service.openDraw(id, adminId, "draft:0");
        const open = await service.getLifecycleStatus(id);
        assert.equal(open.visibility, "PRIVATE");
        assert.equal(open.activePoolVersion, 1);
        assert.equal(open.frozenDomainCount, 3);
        await assert.rejects(service.createDomain(id, adminId, fields), { code: "DOMAIN_POOL_LOCKED" });
        await assert.rejects(service.updateDomain(id, draft._id, adminId, fields), { code: "DOMAIN_POOL_LOCKED" });
        await assert.rejects(service.deleteDomain(id, draft._id), { code: "DOMAIN_POOL_LOCKED" });
        await service.closeDraw(id, "frozen:1");
        const v1 = await DomainPoolSnapshot.findOne({ event: id }).lean();
        await service.enableRead(id, adminId, "frozen:1");
        const readable = await service.getLifecycleStatus(id);
        assert.equal(readable.allowedActions.resetToDraft, true);
        await assert.rejects(service.clearDraftDomains(id, adminId, "", readable.coordinationVersion), { code: "DOMAIN_DRAFT_CLEAR_NOT_ALLOWED" });
        const reset = await invokeRecovery(controller.resetLotteryToDraft, id, readable.coordinationVersion,
            { confirmation: "RESET_TO_DRAFT", reason: "Accidental READ" });
        assert.equal(reset.code, 200);
        assert.equal(reset.body.data.lastPreservedVersion, 1);
        assert.equal(reset.body.data.activeDraft, true);
        assert.equal(reset.body.data.audit.previous.visibility, "READABLE");
        assert.equal(reset.body.data.audit.previous.readEnabledBy.toString(), adminId.toString());
        assert.equal(reset.body.data.domainConfig.readEnabledAt, null);
        assert.ok(await DomainAdminAudit.exists({ _id: reset.body.data.audit._id, event: id, action: "RESET_TO_DRAFT" }));
        await assert.rejects(service.loadActiveSnapshot(await Event.findById(id)), { code: "DOMAIN_POOL_NOT_FROZEN" });
        await service.updateDomain(id, draft._id, adminId, { title: "Editable again" });
        const temporary = await service.createDomain(id, adminId, fields);
        await service.deleteDomain(id, temporary._id);
        const { coordinationVersion } = await service.getLifecycleStatus(id);
        const cleared = await invokeRecovery(controller.clearDraftDomains, id, coordinationVersion, { confirmation: "CLEAR_DOMAINS" });
        assert.equal(cleared.code, 200);
        assert.equal(cleared.body.data.audit.deletedDomainCount, 3);
        assert.ok(await DomainAdminAudit.exists({ _id: cleared.body.data.audit._id, event: id, action: "CLEAR_DOMAINS" }));
        assert.equal(await EventDomain.countDocuments({ event: id }), 0);
        assert.equal(await EventDomain.countDocuments({ event: other.id }), 1);
        assert.equal(await DomainAdminAudit.countDocuments({ event: id }), 2);
        await service.createDomain(id, adminId, { ...fields, title: "Fresh theme" });
        await service.createDomain(id, adminId, { ...fields, title: "Replacement theme" });
        await service.openDraw(id, adminId, "draft:1");
        const next = await service.getLifecycleStatus(id);
        assert.equal(next.activePoolVersion, 2);
        assert.equal(next.domainCount, 2);
        assert.equal(next.frozenDomainCount, 2);
        assert.deepEqual((await service.listDomains(id, { page: 1, limit: 10 })).domains.map(domain => domain.title).sort(),
            ["Fresh theme", "Replacement theme"]);
        const latest = await service.loadActiveSnapshot(await Event.findById(id));
        assert.equal(latest.poolVersion, 2);
        assert.equal(await versions.countDocuments({ event: id, poolVersion: 2 }), 1);
        assert.deepEqual(await DomainPoolSnapshot.findOne({ event: id }).lean(), v1);
        await assert.rejects(service.openDraw(id, adminId, "frozen:1"), { code: "DOMAIN_CONFIG_CONFLICT" });
        await service.closeDraw(id, "frozen:2");
        await service.enableRead(id, adminId, "frozen:2");
        assert.equal((await service.getLifecycleStatus(id)).visibility, "READABLE");
    });

    it("resets a private frozen pool once when two reset requests race", async () => {
        const { id } = await fixture();
        const { coordinationVersion } = await service.getLifecycleStatus(id);
        const results = await Promise.allSettled([
            service.resetToDraft(id, adminId, "First confirm", coordinationVersion),
            service.resetToDraft(id, adminId, "Second confirm", coordinationVersion)
        ]);
        assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
        assert.equal(results.find(result => result.status === "rejected").reason.code, "DOMAIN_RESET_NOT_ALLOWED");
        assert.equal(await DomainAdminAudit.countDocuments({ event: id }), 1);
        assert.equal((await service.getLifecycleStatus(id)).activeDraft, true);
    });

    for (const [name, compete] of [
        ["reopen and draw", async id => { await service.openDraw(id, adminId, "frozen:1"); return draw(id, "TEAM"); }],
        ["enable-read", id => service.enableRead(id, adminId, "frozen:1")]
    ]) {
        it(`serializes reset against ${name} and rejects stale confirmation`, async () => {
            const { id } = await fixture();
            const { coordinationVersion } = await service.getLifecycleStatus(id);
            const [reset, other] = await Promise.allSettled([
                service.resetToDraft(id, adminId, "Recovery", coordinationVersion), compete(id)
            ]);
            assert.notEqual(reset.status, other.status);
            const state = await service.getLifecycleStatus(id);
            assert.equal(state.activeDraft, reset.status === "fulfilled");
            if (reset.status === "fulfilled") assert.equal(state.assignedEntryCount, 0);
            assert.equal(await DomainAdminAudit.countDocuments({ event: id }), state.activeDraft ? 1 : 0);
        });
    }

    it("rejects open or corrupt recovery targets", async () => {
        const { id } = await fixture({ close: false });
        const { coordinationVersion } = await service.getLifecycleStatus(id);
        await assert.rejects(service.resetToDraft(id, adminId, "Open pool", coordinationVersion), { code: "DOMAIN_RESET_NOT_ALLOWED" });
        await service.closeDraw(id, "frozen:1");
        const source = await Event.findById(id).lean();
        const snapshot = await DomainPoolSnapshot.findOne({ event: id }).lean();
        const corrupt = await Event.create({ ...source, _id: new mongoose.Types.ObjectId() });
        await DomainPoolSnapshot.create({
            ...snapshot, _id: new mongoose.Types.ObjectId(), event: corrupt._id, contentHash: "0".repeat(64)
        });
        await assert.rejects(service.resetToDraft(corrupt._id, adminId, "Corrupt pool", 0), { code: "DOMAIN_POOL_INTEGRITY_FAILED" });
        assert.equal(await DomainAdminAudit.countDocuments({ event: corrupt._id }), 0);
    });

    it("never deletes a concurrent create that was absent from the reviewed draft", async () => {
        const { id } = await fixture();
        const before = await service.getLifecycleStatus(id);
        const { status } = await service.resetToDraft(id, adminId, "Recovery", before.coordinationVersion);
        const [clear, create] = await Promise.allSettled([
            service.clearDraftDomains(id, adminId, "", status.coordinationVersion),
            service.createDomain(id, adminId, { ...fields, title: "Concurrent theme" })
        ]);
        assert.equal(create.status, "fulfilled");
        assert.ok(await EventDomain.exists({ _id: create.value._id, event: id }));
        if (clear.status === "rejected") assert.equal(clear.reason.code, "DOMAIN_CONFIG_CONFLICT");
        assert.equal(await EventDomain.countDocuments({ event: id }), clear.status === "fulfilled" ? 1 : 2);
    });

    it("rolls back reset and bulk deletion when their audit write fails", async t => {
        const { id } = await fixture();
        const failAudit = () => t.mock.method(DomainAdminAudit, "create", async () => { throw new Error("fixture audit failed"); });
        const before = await service.getLifecycleStatus(id);
        const resetAudit = failAudit();
        try {
            await assert.rejects(service.resetToDraft(id, adminId, "Recovery", before.coordinationVersion), /fixture audit failed/);
        } finally { resetAudit.mock.restore(); }
        assert.equal((await service.getLifecycleStatus(id)).activePoolVersion, 1);
        const { status } = await service.resetToDraft(id, adminId, "Recovery", before.coordinationVersion);
        const clearAudit = failAudit();
        try {
            await assert.rejects(service.clearDraftDomains(id, adminId, "", status.coordinationVersion), /fixture audit failed/);
        } finally { clearAudit.mock.restore(); }
        assert.equal(await EventDomain.countDocuments({ event: id }), 1);
        assert.equal(await DomainAdminAudit.countDocuments({ event: id }), 1);
    });

    it("returns 503 without replay when a real commit succeeds but its acknowledgement is treated as unknown", async t => {
        const { id } = await fixture();
        const { coordinationVersion } = await service.getLifecycleStatus(id);
        const startSession = mongoose.startSession.bind(mongoose);
        let commits = 0;
        const injected = t.mock.method(mongoose, "startSession", async () => {
            const session = await startSession();
            const commit = session.commitTransaction.bind(session);
            session.commitTransaction = async () => {
                commits += 1;
                await commit();
                throw Object.assign(new Error("Synthetic acknowledgement loss"), {
                    hasErrorLabel: label => label === "UnknownTransactionCommitResult"
                });
            };
            return session;
        });
        try {
            const reset = await invokeRecovery(controller.resetLotteryToDraft, id, coordinationVersion,
                { confirmation: "RESET_TO_DRAFT", reason: "Reconcile unknown commit" });
            assert.equal(reset.code, 503);
            assert.equal(reset.body.code, "DOMAIN_COMMIT_UNKNOWN");
            assert.equal(commits, 1);
            assert.equal(injected.mock.callCount(), 1);
        } finally { injected.mock.restore(); }
        assert.equal((await service.getLifecycleStatus(id)).activeDraft, true);
        assert.equal(await DomainAdminAudit.countDocuments({ event: id }), 1);
    });
});
