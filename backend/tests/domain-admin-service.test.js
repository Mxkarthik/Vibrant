"use strict";

process.env.NODE_ENV = "test";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Event = require("../models/Event");
const EventDomain = require("../models/EventDomain");
const DomainAssignment = require("../models/DomainAssignment");
const DomainPoolCoordination = require("../models/DomainPoolCoordination");
const service = require("../services/domainAdminService");

function fakeSession() {
    return {
        startTransaction() {},
        async commitTransaction() {},
        inTransaction: () => true,
        async abortTransaction() {},
        endSession: async () => {}
    };
}

async function withDatabaseStubs(t, { event, assignments = 0, domain = null } = {}, run) {
    const originals = {
        readyState: mongoose.connection.readyState,
        startSession: mongoose.startSession,
        coordination: DomainPoolCoordination.findOneAndUpdate,
        findEvent: Event.findById,
        countAssignments: DomainAssignment.countDocuments,
        findDomain: EventDomain.findOne,
        createDomain: EventDomain.create,
        findAssignment: DomainAssignment.exists
    };
    mongoose.connection.readyState = 1;
    mongoose.startSession = async () => fakeSession();
    DomainPoolCoordination.findOneAndUpdate = async () => ({});
    Event.findById = () => ({ session: async () => event });
    DomainAssignment.countDocuments = () => ({ session: async () => assignments });
    EventDomain.findOne = () => ({ session: async () => domain });
    EventDomain.create = async docs => docs.map(doc => ({ ...doc, _id: new mongoose.Types.ObjectId() }));
    DomainAssignment.exists = () => ({ session: async () => null });
    try { await run(); }
    finally {
        mongoose.connection.readyState = originals.readyState;
        mongoose.startSession = originals.startSession;
        DomainPoolCoordination.findOneAndUpdate = originals.coordination;
        Event.findById = originals.findEvent;
        DomainAssignment.countDocuments = originals.countAssignments;
        EventDomain.findOne = originals.findDomain;
        EventDomain.create = originals.createDomain;
        DomainAssignment.exists = originals.findAssignment;
    }
}

function fakeEvent(config = {}) {
    return {
        _id: new mongoose.Types.ObjectId(),
        multiEventAccess: { enabled: false },
        domainConfig: { enabled: false, visibility: "PRIVATE", drawStatus: "CLOSED", publishedAt: null, poolVersion: 0, ...config },
        set(path, value) { this.domainConfig[path.split(".")[1]] = value; },
        async save() {}
    };
}

describe("Admin domain service lifecycle guards (transaction mocked; no MongoDB)", () => {
    it("enables and disables without changing publication fields", async t => {
        const event = fakeEvent({ enabled: false, poolVersion: 4 });
        await withDatabaseStubs(t, { event, assignments: 0 }, async () => {
            const updated = await service.updateEnabled(event._id, true);
            assert.equal(updated.domainConfig.enabled, true);
            assert.equal(updated.domainConfig.visibility, "PRIVATE");
            assert.equal(updated.domainConfig.drawStatus, "CLOSED");
            assert.equal(updated.domainConfig.poolVersion, 4);
            await service.updateEnabled(event._id, false);
            assert.equal(event.domainConfig.enabled, false);
            assert.equal(event.domainConfig.poolVersion, 4);
        });
    });

    it("blocks disabling during an open draw or while assignments exist", async t => {
        const openEvent = fakeEvent({ enabled: true, visibility: "PUBLIC", drawStatus: "OPEN", publishedAt: new Date() });
        await withDatabaseStubs(t, { event: openEvent }, async () => {
            await assert.rejects(service.updateEnabled(openEvent._id, false), e => e.code === "DRAW_OPEN" && e.statusCode === 409);
        });
        const assignedEvent = fakeEvent({ enabled: true });
        await withDatabaseStubs(t, { event: assignedEvent, assignments: 1 }, async () => {
            await assert.rejects(service.updateEnabled(assignedEvent._id, false), e => e.code === "DOMAIN_CONFIG_CONFLICT" && e.statusCode === 409);
        });
    });

    it("creates only for enabled private pools and binds the URL event and authenticated admin", async t => {
        const event = fakeEvent({ enabled: true });
        const adminId = new mongoose.Types.ObjectId();
        await withDatabaseStubs(t, { event }, async () => {
            const created = await service.createDomain(event._id, adminId, { title: "X", problemStatement: "Y" });
            assert.equal(created.event.toString(), event._id.toString());
            assert.equal(created.createdBy.toString(), adminId.toString());
            assert.equal(created.updatedBy.toString(), adminId.toString());
        });
        const disabled = fakeEvent();
        await withDatabaseStubs(t, { event: disabled }, async () => {
            await assert.rejects(service.createDomain(disabled._id, adminId, { title: "X", problemStatement: "Y" }), e => e.code === "DOMAINS_DISABLED");
        });
        const combo = fakeEvent({ enabled: true });
        combo.multiEventAccess.enabled = true;
        await withDatabaseStubs(t, { event: combo }, async () => {
            await assert.rejects(service.createDomain(combo._id, adminId, { title: "X", problemStatement: "Y" }), e => e.code === "EVENT_NOT_ELIGIBLE");
        });
    });

    it("blocks edits and deletions of assigned or published domains", async t => {
        const event = fakeEvent({ enabled: true });
        const assignedDomain = { _id: new mongoose.Types.ObjectId(), event: event._id };
        await withDatabaseStubs(t, { event, domain: assignedDomain }, async () => {
            DomainAssignment.exists = () => ({ session: async () => ({ _id: new mongoose.Types.ObjectId() }) });
            await assert.rejects(service.updateDomain(event._id, assignedDomain._id, new mongoose.Types.ObjectId(), { title: "New" }), e => e.code === "DOMAIN_HAS_ASSIGNMENTS");
            await assert.rejects(service.deleteDomain(event._id, assignedDomain._id), e => e.code === "DOMAIN_HAS_ASSIGNMENTS");
        });
        const published = fakeEvent({ enabled: true, visibility: "PUBLIC", publishedAt: new Date() });
        await withDatabaseStubs(t, { event: published }, async () => {
            await assert.rejects(service.deleteDomain(published._id, new mongoose.Types.ObjectId()), e => e.code === "DOMAIN_POOL_LOCKED");
        });
    });
});
