"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Event = require("../models/Event");
const EventDomain = require("../models/EventDomain");
const DomainAssignment = require("../models/DomainAssignment");

const makeId = () => new mongoose.Types.ObjectId();

function eventData(extra = {}) {
    return {
        name: "CODE2CREATE",
        description: "Hackathon",
        category: "TECHNICAL",
        venue: "Main Hall",
        startDate: new Date("2030-01-02T10:00:00Z"),
        endDate: new Date("2030-01-02T18:00:00Z"),
        registration: {
            mode: "TEAM", deadline: new Date("2030-01-01T10:00:00Z"),
            capacity: 10, minTeamSize: 1, maxTeamSize: 5
        },
        createdBy: makeId(),
        ...extra
    };
}

describe("Hackathon domain database foundation", () => {
    it("defaults the event feature off, private, and draw closed", () => {
        const event = new Event(eventData());
        assert.equal(event.domainConfig.enabled, false);
        assert.equal(event.domainConfig.visibility, "PRIVATE");
        assert.equal(event.domainConfig.drawStatus, "CLOSED");
    });

    it("keeps legacy event data valid without domain configuration", async () => {
        const event = new Event(eventData());
        event.domainConfig = undefined;
        await assert.doesNotReject(event.validate());
    });

    it("rejects an open draw unless enabled and published public", async () => {
        const event = new Event(eventData({ domainConfig: { drawStatus: "OPEN" } }));
        await assert.rejects(event.validate(), /Domain draw requires an enabled feature/);
        event.domainConfig = {
            enabled: true, visibility: "PUBLIC", drawStatus: "OPEN", publishedAt: new Date()
        };
        await assert.doesNotReject(event.validate());
    });

    it("accepts valid event domains and trims bounded text", async () => {
        const domain = new EventDomain({
            event: makeId(), title: "  Civic Tech  ", problemStatement: "  Build a useful tool.  ",
            instructions: "  Present a demo.  ", createdBy: makeId(), updatedBy: makeId()
        });
        await assert.doesNotReject(domain.validate());
        assert.equal(domain.title, "Civic Tech");
        assert.equal(domain.problemStatement, "Build a useful tool.");
        assert.equal(domain.instructions, "Present a demo.");
    });

    it("rejects missing, whitespace-only, and overlong domain content", async () => {
        for (const data of [
            { title: " ", problemStatement: "statement" },
            { title: "title", problemStatement: "   " },
            { title: "x".repeat(161), problemStatement: "statement" },
            { title: "title", problemStatement: "x".repeat(20001) }
        ]) {
            const domain = new EventDomain({ event: makeId(), createdBy: makeId(), updatedBy: makeId(), ...data });
            await assert.rejects(domain.validate());
        }
    });

    it("requires an event association and admin audit references", async () => {
        const domain = new EventDomain({ title: "Title", problemStatement: "Text" });
        await assert.rejects(domain.validate());
        assert.equal(EventDomain.schema.path("event").options.ref, "Event");
        assert.equal(EventDomain.schema.path("createdBy").options.ref, "User");
    });

    it("requires authoritative entry identity and preserves assigned content", async () => {
        const assignment = new DomainAssignment({
            event: makeId(), domain: makeId(), entryType: "INDIVIDUAL", entry: makeId(),
            initiatedBy: makeId(), poolVersion: 1,
            contentSnapshot: { title: "Title", problemStatement: "Statement", instructions: "" }
        });
        await assert.doesNotReject(assignment.validate());
        assignment.entry = undefined;
        await assert.rejects(assignment.validate());
    });

    it("uses Team identity for team assignments, including combo child event scope", async () => {
        const teamId = makeId();
        const childEventId = makeId();
        const assignment = new DomainAssignment({
            event: childEventId, domain: makeId(), entryType: "TEAM", entry: teamId,
            initiatedBy: makeId(), poolVersion: 3,
            contentSnapshot: { title: "Team domain", problemStatement: "Shared statement" }
        });
        await assert.doesNotReject(assignment.validate());
        assert.equal(assignment.entry.toString(), teamId.toString());
        assert.equal(assignment.event.toString(), childEventId.toString());
        assert.equal(DomainAssignment.schema.path("entry").options.ref, undefined);
    });

    it("defines event-scoped listing and unique event-entry indexes", () => {
        assert.ok(EventDomain.schema.indexes().some(([keys]) =>
            keys.event === 1 && keys.createdAt === 1 && keys._id === 1));
        assert.ok(DomainAssignment.schema.indexes().some(([keys, options]) =>
            keys.event === 1 && keys.entryType === 1 && keys.entry === 1 && options.unique === true));
        assert.ok(DomainAssignment.schema.indexes().some(([keys]) => keys.event === 1 && keys.domain === 1));
    });

    it("records snapshot/version immutability metadata without claiming service enforcement", () => {
        assert.equal(DomainAssignment.schema.path("contentSnapshot").options.immutable, true);
        assert.equal(DomainAssignment.schema.path("domain").options.immutable, true);
        assert.equal(DomainAssignment.schema.path("poolVersion").options.immutable, true);
        assert.equal(Event.schema.path("domainConfig.poolVersion").defaultValue, 0);
    });
});
