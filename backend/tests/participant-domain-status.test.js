"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const { Types } = mongoose;
const Event = require("../models/Event");
const EventDomain = require("../models/EventDomain");
const Registration = require("../models/Registration");
const Team = require("../models/Team");
const User = require("../models/User");
const DomainAssignment = require("../models/DomainAssignment");
const Snapshot = require("../models/DomainPoolSnapshot");
const Coordination = require("../models/DomainPoolCoordination");
const { drawParticipantDomain } = require("../services/participantDomainDrawService");
const { hashDomains } = require("../utils/domainPoolSnapshot");
const { resolveParticipantDomainEligibility, getParticipantDomainStatus } = require("../services/participantDomainService");
const router = require("../routes/participantRoutes");
const generateToken = require("../utils/generateToken");

process.env.JWT_SECRET = "local-participant-domain-test-signing-key";
const id = () => new Types.ObjectId();
const same = (a, b) => String(a) === String(b);
const publishedAt = new Date("2026-11-25T12:00:00Z");

function setup(t, mode = "INDIVIDUAL") {
    const user = { _id: id(), role: "PARTICIPANT", isActive: true, email: "hidden@example.invalid" };
    const event = {
        _id: id(), status: "PUBLISHED", registration: { mode },
        domainConfig: { enabled: true, visibility: "PRIVATE", drawStatus: "CLOSED", poolVersion: 0 }
    };
    const data = { events: [event], registrations: [], teams: [], snapshots: [], assignments: [], reads: [] };
    const query = (value, name, filter) => {
        const log = { name, filter };
        data.reads.push(log);
        return {
            session(session) { log.session = session; return this; },
            read(preference) { log.preference = preference; return this; },
            readConcern(level) { log.readConcern = level; return this; },
            maxTimeMS(limit) { log.maxTimeMS = limit; return this; },
            select(fields) { log.fields = fields; return this; },
            lean: async () => { await data.onRead?.(log); return value; },
            then(resolve, reject) { return this.lean().then(resolve, reject); }
        };
    };
    t.mock.method(Event, "findById", eventId => query(data.events.find(row => same(row._id, eventId)), "event", eventId));
    t.mock.method(Registration, "find", filter => query(data.registrations.filter(registration =>
        same(registration.user, filter.user) && (same(registration.event, filter.$or[0].event) ||
        (registration.access?.type === "MULTI_EVENT" && registration.access.eligibleEventIds.some(child =>
            same(child, filter.$or[1]["access.eligibleEventIds"]))))), "registrations", filter));
    t.mock.method(Team, "findOne", filter => query(data.teams.find(team =>
        same(team._id, filter._id) && same(team.event, filter.event)), "team", filter));
    t.mock.method(DomainAssignment, "findOne", filter => query(data.assignments.find(assignment =>
        same(assignment.event, filter.event) && assignment.entryType === filter.entryType &&
        same(assignment.entry, filter.entry)), "assignment", filter));
    for (const [model, name] of [[Snapshot, "legacySnapshot"], [Snapshot.forVersion(2), "versionedSnapshot"]]) {
        t.mock.method(model, "findOne", filter => query(data.snapshots.find(snapshot =>
            same(snapshot.event, filter.event) && snapshot.poolVersion === filter.poolVersion), name, filter));
    }
    const register = (fields = {}) => {
        const row = { _id: id(), user: user._id, event: event._id, status: "REGISTERED",
            payment: { status: "VERIFIED", proofUrl: "private-receipt" }, ...fields };
        data.registrations.push(row);
        return row;
    };
    const team = (fields = {}) => {
        const row = { _id: id(), event: event._id, leader: user._id, status: "REGISTERED", payment: { status: "VERIFIED" }, ...fields };
        data.teams.push(row);
        return row;
    };
    function freeze(version = 1, { visibility = "PRIVATE", drawStatus = "OPEN" } = {}) {
        Object.assign(event.domainConfig, { visibility, drawStatus, publishedAt, poolVersion: version });
        const domains = [{ domain: id(), title: "Secret theme", problemStatement: "Private statement", instructions: "Private instructions" }];
        const result = { event: event._id, publishedAt, domains, poolVersion: version, contentHash: hashDomains(domains) };
        data.snapshots.push(result);
        return result;
    }
    function assign(entryType, entry, snapshot) {
        const { domain, title, problemStatement, instructions } = snapshot.domains[0];
        const row = { event: event._id, entryType, entry, domain, assignedAt: publishedAt, poolVersion: snapshot.poolVersion,
            contentSnapshot: { title, problemStatement, instructions } };
        data.assignments.push(row);
        return row;
    }
    const status = (authenticatedUser = user) => getParticipantDomainStatus({ eventId: event._id, authenticatedUser });
    return { user, event, data, status, register, team, freeze, assign };
}

// Run this route's actual auth and controller chain without opening a TCP listener.
async function request(t, { user, eventId = id(), cookie = false, draw = false, body = {}, origin, bearer = false,
    resource = draw ? "/draw" : "/status",
    json = true, query = draw ? {} : { role: "ADMIN", team: String(id()), user: String(id()), domain: String(id()) } } = {}) {
    if (user) t.mock.method(User, "findById", async userId => same(userId, user._id) ? user : null);
    const route = router.stack.find(layer => layer.route?.path === `/events/:eventId/domains${resource}`).route;
    assert.equal(route.methods[draw ? "post" : "get"], true);
    const req = { params: { eventId: String(eventId) }, headers: {}, query, body,
        is: type => json && type === "application/json", get: name => name === "Origin" ? origin : undefined,
        app: { get: name => name === "trustedFrontendOrigins" ? ["http://localhost:5173"] : undefined } };
    if (user) {
        const token = generateToken(user._id);
        if (cookie) req.cookies = { vibrant_token: token };
        if (!cookie || bearer) req.headers.authorization = `Bearer ${token}`;
    }
    const res = {
        headers: {}, set(name, value) { this.headers[name] = value; },
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
    async function run(index) {
        let next;
        await route.stack[index].handle(req, res, () => { next = run(index + 1); });
        await next;
    }
    await run(0);
    return res;
}

test("rejects an unauthenticated request with no-store", async t => {
    const response = await request(t);
    assert.equal(response.statusCode, 401);
    assert.equal(response.headers["Cache-Control"], "no-store");
});

test("rejects an ORGANISER token on lottery routes", async t => {
    assert.equal((await request(t, { user: { _id: id(), role: "ORGANISER", isActive: true } })).statusCode, 403);
});

test("ADMIN can read status and only a verified eligible registration enables its draw", async t => {
    const { user, event, register, freeze } = setup(t);
    const admin = { ...user, role: "ADMIN" };
    register();
    freeze();
    const status = await request(t, { user: admin, eventId: event._id });
    assert.equal(status.statusCode, 200);
    assert.equal(status.body.data.canDraw, true);
    const unauthorized = await request(t, { user: { ...admin, _id: id() }, eventId: event._id });
    assert.equal(unauthorized.statusCode, 200);
    assert.equal(unauthorized.body.data.isEligible, false);
});

test("rejects an inactive account even with a valid token", async t => {
    assert.equal((await request(t, { user: { _id: id(), role: "PARTICIPANT", isActive: false } })).statusCode, 401);
});

for (const [name, expectedStatus, code] of [
    ["invalid", 400, "INVALID_EVENT_ID"], ["missing", 404, "EVENT_NOT_FOUND"], ["parent", 409, "EVENT_NOT_ELIGIBLE"]
]) {
    test(`returns a safe response for a ${name} lottery target`, async t => {
        const { user, event } = setup(t);
        if (name === "parent") event.multiEventAccess = { enabled: true };
        const eventId = name === "invalid" ? "invalid" : name === "missing" ? id() : event._id;
        const response = await request(t, { user, eventId });
        assert.equal(response.statusCode, expectedStatus);
        assert.equal(response.body.code, code);
    });
}

test("accepts cookie authentication and returns only allowlisted fields for an eligible open entry", async t => {
    const { user, event, register, freeze, data } = setup(t);
    const registration = register();
    const snapshot = freeze();
    const response = await request(t, { user, eventId: event._id, cookie: true });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["Cache-Control"], "no-store");
    assert.deepEqual(Object.keys(response.body.data).sort(), [
        "eventId", "eventEligible", "domainsEnabled", "visibility", "drawStatus", "isEligible", "entryType", "canDraw",
        "hasAssignment", "canReadAllDomains", "reasonCode", "message"
    ].sort());
    assert.equal(response.body.data.canDraw, true);
    assert.equal(response.body.data.canReadAllDomains, false);
    assert.deepEqual(data.reads.find(read => read.name === "assignment").filter,
        { event: event._id, entryType: "INDIVIDUAL", entry: registration._id });
    const body = JSON.stringify(response.body);
    for (const privateValue of ["Secret theme", "Private statement", "Private instructions", "private-receipt",
        String(registration._id), String(snapshot.domains[0].domain), snapshot.contentHash, user.email]) {
        assert.equal(body.includes(privateValue), false);
    }
});

test("excludes other users, unrelated events, and registrations without the requested entitlement", async t => {
    const { event, data, register, freeze, status } = setup(t, "TEAM");
    register({ user: id(), team: id() });
    register({ event: id(), team: id(), access: { type: "MULTI_EVENT", eligibleEventIds: [id()] } });
    register({ event: id(), access: { type: "SINGLE_EVENT", eligibleEventIds: [event._id] } });
    freeze();
    const result = await status();
    assert.equal(result.reasonCode, "PARTICIPANT_NOT_REGISTERED");
    assert.equal(result.visibility, null);
    assert.equal(result.drawStatus, null);
    assert.equal(result.hasAssignment, false);
    assert.deepEqual(data.reads.map(read => read.name), ["event", "registrations"]);
});

for (const [fields, reason] of [
    [{ status: "CANCELLED" }, "REGISTRATION_NOT_ELIGIBLE"],
    [{ payment: { status: "PENDING" } }, "PAYMENT_NOT_VERIFIED"],
    [{ payment: { status: "REJECTED" } }, "PAYMENT_NOT_VERIFIED"],
    [{ access: null }, "REGISTRATION_NOT_ELIGIBLE"]
]) {
    test(`denies entry with ${JSON.stringify(fields)}`, async t => {
        const { register, freeze, status } = setup(t);
        register(fields);
        freeze();
        const result = await status();
        assert.equal(result.reasonCode, reason);
        assert.equal(result.isEligible, false);
        assert.equal(result.visibility, null);
        assert.equal(result.canDraw, false);
    });
}

for (const [name, options, expected] of [
    ["disabled", {}, [false, false, false]],
    ["private draft", {}, [true, false, false]],
    ["closed frozen", { drawStatus: "CLOSED" }, [true, false, false]],
    ["readable", { visibility: "READABLE", drawStatus: "CLOSED" }, [true, false, true]],
    ["legacy public", { visibility: "PUBLIC" }, [true, false, false]],
    ["completed", {}, [true, false, false]],
    ["cancelled", {}, [true, false, false]],
    ["reset with history", {}, [true, false, false]],
    ["missing snapshot", {}, [true, false, false]]
]) {
    test(`returns the safe flag matrix for ${name}`, async t => {
        const { event, data, register, freeze, status } = setup(t);
        register({ payment: { status: "NOT_REQUIRED" } });
        if (name !== "private draft") freeze(1, options);
        if (name === "disabled") event.domainConfig.enabled = false;
        if (name === "completed" || name === "cancelled") event.status = name.toUpperCase();
        if (name === "missing snapshot") data.snapshots.length = 0;
        if (name === "reset with history") Object.assign(event.domainConfig, { publishedAt: null, revisionPending: true, drawStatus: "CLOSED" });
        const result = await status();
        assert.deepEqual([result.domainsEnabled, result.canDraw, result.canReadAllDomains], expected);
        assert.equal(result.hasAssignment, false);
        assert.equal(result.isEligible, name !== "cancelled");
        assert.equal(JSON.stringify(result).includes("Private statement"), false);
        if (name === "reset with history") assert.ok(!data.reads.some(read => read.name.endsWith("Snapshot")));
    });
}

test("allows only the leader to draw and resolves both account-linked team members to one historical assignment", async t => {
    const { user, event, data, register, team, freeze, assign, status } = setup(t, "TEAM");
    const roster = team();
    const member = { ...user, _id: id() };
    register({ team: roster._id, payment: { status: "NOT_REQUIRED" } });
    register({ user: member._id, team: roster._id, isTeamLeader: true });
    register({ user: null, team: roster._id });
    const old = freeze();
    assert.equal((await status()).canDraw, true);
    const memberStatus = await status(member);
    assert.equal(memberStatus.isEligible, true);
    assert.equal(memberStatus.canDraw, false);
    assert.equal(memberStatus.reasonCode, "TEAM_LEADER_REQUIRED");
    assign("TEAM", roster._id, old);
    freeze(2, { visibility: "READABLE", drawStatus: "CLOSED" });
    for (const owner of [user, member]) {
        const result = await status(owner);
        assert.equal(result.hasAssignment, true);
        assert.equal(result.canDraw, false);
        assert.equal(result.canReadAllDomains, true);
    }
    assert.deepEqual(data.reads.filter(read => read.name === "assignment").map(read => read.filter),
        Array(4).fill({ event: event._id, entryType: "TEAM", entry: roster._id }));
    event.domainConfig.visibility = "PRIVATE";
    assert.equal((await status(member)).hasAssignment, true);
    assert.equal((await status({ ...user, _id: id() })).isEligible, false);
});

test("uses team payment, rejects a cancelled team, and checks the team's source event", async t => {
    const { register, team, freeze, status } = setup(t, "TEAM");
    const roster = team({ payment: { status: "PENDING" } });
    register({ team: roster._id, payment: { status: "NOT_REQUIRED" } });
    freeze();
    assert.equal((await status()).reasonCode, "PAYMENT_NOT_VERIFIED");
    roster.payment.status = "VERIFIED";
    roster.status = "CANCELLED";
    assert.equal((await status()).reasonCode, "TEAM_NOT_ELIGIBLE");
    roster.status = "REGISTERED";
    roster.event = id();
    assert.equal((await status()).reasonCode, "TEAM_NOT_ELIGIBLE");
});

for (const mode of ["INDIVIDUAL", "TEAM"]) {
    test(`resolves ${mode} child entitlement with a child-scoped assignment and forwards the session to each query`, async t => {
        const { event, user, data, register, team, freeze, assign, status } = setup(t, mode);
        const parent = { _id: id(), status: "PUBLISHED", registration: { mode },
            multiEventAccess: { enabled: true, includedEvents: [id()] } };
        data.events.push(parent);
        const roster = mode === "TEAM" ? team({ event: parent._id }) : null;
        const registration = register({ event: parent._id, team: roster?._id,
            access: { type: "MULTI_EVENT", eligibleEventIds: [event._id] } });
        const entry = roster?._id ?? registration._id;
        const frozen = freeze();
        data.assignments.push({ event: parent._id, entryType: mode, entry });
        assert.equal((await status()).canDraw, true);
        assign(mode, entry, frozen);
        const session = {};
        data.reads.length = 0;
        const result = await resolveParticipantDomainEligibility({ eventId: event._id, authenticatedUser: user, session });
        assert.equal(result.assignment.event, event._id);
        assert.equal(result.entry.entry, entry);
        assert.ok(data.reads.every(read => read.session === session));
        parent.status = "CANCELLED";
        assert.equal((await status()).isEligible, false);
    });
}

test("rejects conflicting direct and Combo Pass entries without consulting assignments", async t => {
    const { event, user, data, register } = setup(t);
    const parent = { _id: id(), status: "PUBLISHED", registration: { mode: "INDIVIDUAL" }, multiEventAccess: { enabled: true } };
    data.events.push(parent);
    register();
    register({ event: parent._id, access: { type: "MULTI_EVENT", eligibleEventIds: [event._id] } });
    const response = await request(t, { user, eventId: event._id });
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.code, "DOMAIN_ENTRY_AMBIGUOUS");
    assert.ok(!data.reads.some(read => read.name === "assignment"));
});

test("deduplicates equivalent team keys and honors the legacy payment fallback", async t => {
    const { register, team, freeze, status } = setup(t, "TEAM");
    const roster = team({ payment: undefined });
    register({ team: roster._id });
    register({ team: roster._id });
    freeze();
    assert.equal((await status()).canDraw, true);
});

test("fails closed for invalid assignment content or a missing referenced snapshot", async t => {
    const { event, user, data, register, freeze, assign, status } = setup(t);
    const registration = register();
    const snapshot = freeze();
    const locked = assign("INDIVIDUAL", registration._id, snapshot);
    assert.equal((await status()).hasAssignment, true);
    locked.contentSnapshot.title = "Wrong secret";
    const response = await request(t, { user, eventId: event._id });
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.code, "DOMAIN_ASSIGNMENT_INTEGRITY_FAILED");
    assert.equal(JSON.stringify(response.body).includes("Wrong secret"), false);
    data.snapshots.length = 0;
    await assert.rejects(status(), { code: "DOMAIN_ASSIGNMENT_INTEGRITY_FAILED" });
});

test("suppresses unexpected database diagnostics", async t => {
    const user = { _id: id(), role: "PARTICIPANT", isActive: true };
    t.mock.method(Event, "findById", () => { throw new Error("mongodb://private-server/secret"); });
    const response = await request(t, { user });
    assert.equal(response.statusCode, 500);
    assert.equal(JSON.stringify(response.body).includes("private-server"), false);
});

function mockDrawTransactions(t, data, { beforeInsert, beforeCommit } = {}) {
    const original = mongoose.connection.readyState;
    mongoose.connection.readyState = 1;
    t.after(() => { mongoose.connection.readyState = original; });
    let tail = Promise.resolve();
    t.mock.method(Coordination, "findOneAndUpdate", async (_filter, _update, { session }) => {
        const previous = tail;
        tail = new Promise(resolve => { session.release = resolve; });
        await previous;
        session.hasLock = true;
        return { version: 1 };
    });
    t.mock.method(mongoose, "startSession", async () => ({
        startTransaction() { this.active = true; this.pending = []; },
        inTransaction() { return this.active; },
        async commitTransaction() {
            await beforeCommit?.(this, data);
            data.assignments.push(...this.pending);
            this.active = false;
            this.release();
        },
        async abortTransaction() { this.active = false; this.release?.(); },
        async endSession() { this.release?.(); }
    }));
    return t.mock.method(DomainAssignment, "create", async ([assignment], { session }) => {
        assert.ok(session.active && session.hasLock);
        await beforeInsert?.(assignment, session);
        session.pending.push(assignment);
        return [assignment];
    });
}

for (const [name, options, status] of [
    ["no token", {}, 401],
    ["wrong role", { role: "ORGANISER" }, 403],
    ["cookie missing Origin", { cookie: true }, 403],
    ["untrusted cookie Origin despite Bearer", { cookie: true, bearer: true, origin: "https://foreign.invalid" }, 403],
    ["cookie null Origin", { cookie: true, origin: "null" }, 403],
    ["manual theme", { body: { domainId: "chosen" } }, 400],
    ["query override", { query: { teamId: "other" } }, 400],
    ["array", { body: [] }, 400],
    ["wrong content type", { json: false }, 400],
    ["invalid event", { eventId: "bad-id" }, 400]
]) {
    test(`Phase 05B route rejects ${name} before the database lock`, async t => {
        const start = t.mock.method(mongoose, "startSession", async () => assert.fail("No session should start"));
        const user = name === "no token" ? undefined : { _id: id(), role: options.role ?? "PARTICIPANT", isActive: true };
        const response = await request(t, { draw: true, user, ...options });
        assert.equal(response.statusCode, status);
        assert.equal(response.headers["Cache-Control"], "no-store");
        assert.equal(start.mock.callCount(), 0);
    });
}

test("Phase 05B draws from the exact active version with crypto.randomInt and a private response", async t => {
    const { user, event, data, register, freeze } = setup(t);
    const reg = register();
    freeze();
    const active = freeze(2);
    active.domains.push({ domain: id(), title: "Selected", problemStatement: "Only this statement", instructions: "" });
    active.contentHash = hashDomains(active.domains);
    const save = mockDrawTransactions(t, data);
    const random = t.mock.method(crypto, "randomInt", () => 1);
    const response = await request(t, { draw: true, user, eventId: event._id, cookie: true, origin: "http://localhost:5173" });
    assert.equal(response.statusCode, 201);
    assert.deepEqual(random.mock.calls[0].arguments, [0, 2]);
    assert.equal(save.mock.callCount(), 1);
    assert.ok(data.reads.every(read => read.session === save.mock.calls[0].arguments[1].session));
    const [stored] = data.assignments;
    assert.equal(stored.event, event._id);
    assert.equal(stored.entry, reg._id);
    assert.equal(stored.entryType, "INDIVIDUAL");
    assert.equal(stored.initiatedBy, user._id);
    assert.equal(stored.poolVersion, 2);
    assert.equal(stored.domain, active.domains[1].domain);
    assert.deepEqual(response.body.data, {
        eventId: String(event._id), hasAssignment: true, isLocked: true, alreadyAssigned: false,
        theme: { title: "Selected", problemStatement: "Only this statement", instructions: "" }, assignedAt: stored.assignedAt
    });
    assert.equal(JSON.stringify(response.body).includes("Secret theme"), false);
});

test("Phase 05B ADMIN individual draw uses Registration identity and cannot create an assignment without registration", async t => {
    const { user, event, data, register, freeze } = setup(t);
    const admin = { ...user, role: "ADMIN" };
    const registration = register();
    freeze();
    mockDrawTransactions(t, data);
    const drawn = await request(t, { draw: true, user: admin, eventId: event._id });
    assert.equal(drawn.statusCode, 201);
    assert.equal(data.assignments[0].entryType, "INDIVIDUAL");
    assert.equal(data.assignments[0].entry, registration._id);

    const { user: unregistered, event: secondEvent, data: secondData, freeze: freezeSecond } = setup(t);
    const noRegistrationAdmin = { ...unregistered, role: "ADMIN" };
    freezeSecond();
    mockDrawTransactions(t, secondData);
    const denied = await request(t, { draw: true, user: noRegistrationAdmin, eventId: secondEvent._id });
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.body.code, "PARTICIPANT_NOT_REGISTERED");
    assert.equal(secondData.assignments.length, 0);
});

test("Phase 05B ADMIN team leader can draw once; an ordinary team member cannot initiate it", async t => {
    const { user, event, data, register, team, freeze } = setup(t, "TEAM");
    const admin = { ...user, role: "ADMIN" };
    const roster = team();
    const member = { ...admin, _id: id() };
    register({ team: roster._id });
    register({ user: member._id, team: roster._id });
    freeze();
    const save = mockDrawTransactions(t, data);
    const denied = await request(t, { draw: true, user: member, eventId: event._id });
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.body.code, "TEAM_LEADER_REQUIRED");
    assert.equal(data.assignments.length, 0);
    const drawn = await request(t, { draw: true, user: admin, eventId: event._id });
    assert.equal(drawn.statusCode, 201);
    assert.equal(data.assignments[0].entryType, "TEAM");
    assert.equal(data.assignments[0].entry, roster._id);
    const retry = await request(t, { draw: true, user: admin, eventId: event._id });
    assert.equal(retry.statusCode, 200);
    assert.equal(retry.body.data.alreadyAssigned, true);
    assert.equal(save.mock.callCount(), 1);
});

test("Phase 05B one team wins across sessions and authorized members retrieve the original result after closure", async t => {
    const { user, event, data, register, team, freeze } = setup(t, "TEAM");
    const roster = team();
    const member = { ...user, _id: id() };
    register({ team: roster._id });
    register({ user: member._id, team: roster._id, isTeamLeader: true });
    freeze();
    const save = mockDrawTransactions(t, data);
    const pick = authenticatedUser => drawParticipantDomain({ eventId: event._id, authenticatedUser });
    await assert.rejects(pick(member), { statusCode: 403, code: "TEAM_LEADER_REQUIRED" });
    const results = await Promise.all([pick(user), pick({ ...user })]);
    assert.deepEqual(results.map(result => result.alreadyAssigned).sort(), [false, true]);
    assert.deepEqual(results[0].theme, results[1].theme);
    assert.equal(data.assignments[0].entry, roster._id);
    assert.equal(save.mock.callCount(), 1);
    Object.assign(event.domainConfig, { visibility: "READABLE", drawStatus: "CLOSED" });
    event.status = "COMPLETED";
    const retry = await request(t, { draw: true, user: member, eventId: event._id });
    assert.equal(retry.statusCode, 200);
    assert.equal(retry.body.data.assignedAt, results[0].assignedAt);
    assert.deepEqual(retry.body.data.theme, results[0].theme);
    await assert.rejects(pick({ ...member, _id: id() }), { code: "PARTICIPANT_NOT_REGISTERED" });
    assert.equal(save.mock.callCount(), 1);
});

test("Phase 05B scopes Combo Pass writes to the entitled child and preserves the original team key", async t => {
    const { user, event, data, register, team, freeze } = setup(t, "TEAM");
    const parent = { _id: id(), status: "PUBLISHED", registration: { mode: "TEAM" }, multiEventAccess: { enabled: true } };
    data.events.push(parent);
    const roster = team({ event: parent._id });
    register({ event: parent._id, team: roster._id, access: { type: "MULTI_EVENT", eligibleEventIds: [event._id] } });
    freeze();
    mockDrawTransactions(t, data);
    await assert.rejects(drawParticipantDomain({ eventId: parent._id, authenticatedUser: user }), { code: "EVENT_NOT_ELIGIBLE" });
    await drawParticipantDomain({ eventId: event._id, authenticatedUser: user });
    assert.equal(data.assignments[0].event, event._id);
    assert.equal(data.assignments[0].entry, roster._id);
});

for (const [name, code] of [
    ["disabled", "DOMAINS_DISABLED"], ["closed", "DOMAIN_LOTTERY_NOT_OPEN"], ["readable", "DOMAIN_LOTTERY_NOT_OPEN"],
    ["public", "DOMAIN_LOTTERY_NOT_OPEN"], ["completed", "DOMAIN_LOTTERY_NOT_OPEN"], ["cancelled", "EVENT_NOT_ELIGIBLE"],
    ["payment", "PAYMENT_NOT_VERIFIED"], ["registration", "REGISTRATION_NOT_ELIGIBLE"],
    ["missing pool", "DOMAIN_POOL_INTEGRITY_FAILED"], ["bad hash", "DOMAIN_POOL_INTEGRITY_FAILED"],
    ["duplicate domain", "DOMAIN_POOL_INTEGRITY_FAILED"], ["after reset", "DOMAIN_LOTTERY_NOT_OPEN"],
    ["ambiguous", "DOMAIN_ENTRY_AMBIGUOUS"], ["bad historical assignment", "DOMAIN_ASSIGNMENT_INTEGRITY_FAILED"]
]) {
    test(`Phase 05B fails closed for ${name}`, async t => {
        const { user, event, data, register, freeze, assign } = setup(t);
        const entry = register();
        const active = freeze();
        if (name === "disabled") event.domainConfig.enabled = false;
        if (["closed", "readable", "after reset"].includes(name)) event.domainConfig.drawStatus = "CLOSED";
        if (name === "readable" || name === "public") event.domainConfig.visibility = name.toUpperCase();
        if (name === "completed" || name === "cancelled") event.status = name.toUpperCase();
        if (name === "payment") entry.payment.status = "PENDING";
        if (name === "registration") entry.status = "CANCELLED";
        if (name === "missing pool") data.snapshots.length = 0;
        if (name === "bad hash") active.contentHash = "0".repeat(64);
        if (name === "duplicate domain") {
            active.domains.push(active.domains[0]);
            active.contentHash = hashDomains(active.domains);
        }
        if (name === "after reset") Object.assign(event.domainConfig, { publishedAt: null, revisionPending: true });
        if (name === "ambiguous") register();
        if (name === "bad historical assignment") assign("INDIVIDUAL", entry._id, active).contentSnapshot.title = "Invalid";
        const save = mockDrawTransactions(t, data);
        await assert.rejects(drawParticipantDomain({ eventId: event._id, authenticatedUser: user }), { code });
        assert.equal(save.mock.callCount(), 0);
    });
}

test("Phase 05B aborts on duplicate-key and reconciles the winner without redrawing", async t => {
    const { user, event, data, register, freeze, assign } = setup(t);
    const reg = register();
    const active = freeze();
    let winner;
    const save = mockDrawTransactions(t, data, { beforeInsert() {
        winner = assign("INDIVIDUAL", reg._id, active);
        throw Object.assign(new Error("duplicate index details"), { code: 11000 });
    } });
    const result = await drawParticipantDomain({ eventId: event._id, authenticatedUser: user });
    assert.equal(result.alreadyAssigned, true);
    assert.equal(result.assignedAt, winner.assignedAt);
    assert.equal(save.mock.callCount(), 1);
    assert.equal(data.reads.filter(read => read.name === "assignment").at(-1).readConcern, "majority");
});

for (const committed of [true, false]) {
    test(`Phase 05B uncertain commit ${committed ? "returns a committed winner" : "returns 503 without replay"}`, async t => {
        const { user, event, data, register, freeze } = setup(t);
        register();
        freeze();
        const save = mockDrawTransactions(t, data, { beforeCommit(session) {
            if (committed) data.assignments.push(...session.pending);
            throw Object.assign(new Error("unknown"), { hasErrorLabel: label => label === "UnknownTransactionCommitResult" });
        } });
        const response = await request(t, { draw: true, user, eventId: event._id });
        assert.equal(response.statusCode, committed ? 200 : 503);
        if (committed) assert.equal(response.body.data.alreadyAssigned, true);
        else assert.equal(response.body.code, "DOMAIN_COMMIT_UNKNOWN");
        assert.equal(save.mock.callCount(), 1);
        assert.equal(data.reads.filter(read => read.name === "assignment").at(-1).readConcern, "majority");
    });
}

function readPhase05C(t, fixture, resource, overrides = {}) {
    return request(t, { resource, user: fixture.user, eventId: fixture.event._id, ...overrides });
}

function failOnReadSideEffects(t) {
    for (const [model, method] of [
        [mongoose, "startSession"], [Coordination, "findOneAndUpdate"], [DomainAssignment, "create"],
        [DomainAssignment, "updateOne"], [EventDomain, "find"], [crypto, "randomInt"]
    ]) t.mock.method(model, method, () => assert.fail(`Unexpected ${method} call from participant GET`));
}

for (const resource of ["/my-theme", ""]) {
    test(`Phase 05C ${resource || "bank"} requires authentication and allows ADMIN or PARTICIPANT`, async t => {
        const { user, event } = setup(t);
        const anonymous = await request(t, { resource, eventId: event._id });
        assert.equal(anonymous.statusCode, 401);
        assert.equal(anonymous.headers["Cache-Control"], "no-store");
        const denied = await request(t, { resource, user: { ...user, role: "ORGANISER" }, eventId: event._id });
        assert.equal(denied.statusCode, 403);
        assert.equal(denied.headers["Cache-Control"], "no-store");
    });

    test(`Phase 05C ${resource || "bank"} rejects invalid, missing and Combo Pass parent events`, async t => {
        const f = setup(t);
        assert.equal((await readPhase05C(t, f, resource, { eventId: "bad-id" })).body.code, "INVALID_EVENT_ID");
        assert.equal((await readPhase05C(t, f, resource, { eventId: id() })).statusCode, 404);
        f.event.multiEventAccess = { enabled: true };
        const rejected = await readPhase05C(t, f, resource);
        assert.equal(rejected.statusCode, 409);
        assert.equal(rejected.body.code, "EVENT_NOT_ELIGIBLE");
    });
}

test("Phase 05C returns a stable individual locked theme and original timestamp without writes", async t => {
    const f = setup(t);
    failOnReadSideEffects(t);
    const registration = f.register();
    const stored = f.assign("INDIVIDUAL", registration._id, f.freeze());
    const expected = {
        eventId: String(f.event._id), theme: stored.contentSnapshot, assignedAt: stored.assignedAt,
        hasAssignment: true, isLocked: true
    };
    for (const visibility of ["PRIVATE", "READABLE"]) {
        Object.assign(f.event.domainConfig, { visibility, drawStatus: "CLOSED" });
        f.event.status = "COMPLETED";
        const response = await readPhase05C(t, f, "/my-theme", { cookie: true });
        assert.equal(response.statusCode, 200);
        assert.equal(response.headers["Cache-Control"], "no-store");
        assert.deepEqual(response.body.data, expected);
    }
    assert.ok(f.data.reads.filter(read => read.name === "assignment").every(read =>
        read.readConcern === "majority" && same(read.filter.entry, registration._id)));
    assert.equal(f.data.assignments.length, 1);
});

test("Phase 05C ADMIN reads its own locked theme and ADMIN full-bank reads remain READABLE-only", async t => {
    const f = setup(t);
    const admin = { ...f.user, role: "ADMIN" };
    const registration = f.register();
    const stored = f.assign("INDIVIDUAL", registration._id, f.freeze(1, { visibility: "READABLE", drawStatus: "CLOSED" }));
    const theme = await readPhase05C(t, f, "/my-theme", { user: admin });
    assert.equal(theme.statusCode, 200);
    assert.deepEqual(theme.body.data.theme, stored.contentSnapshot);
    const bank = await readPhase05C(t, f, "", { user: admin });
    assert.equal(bank.statusCode, 200);
    f.event.domainConfig.visibility = "PRIVATE";
    const privateBank = await readPhase05C(t, f, "", { user: admin });
    assert.equal(privateBank.statusCode, 403);
    assert.equal(privateBank.body.code, "DOMAIN_BANK_UNAVAILABLE");
});

test("Phase 05C a team leader and linked member retrieve the same historical theme despite a newer active pool", async t => {
    const f = setup(t, "TEAM");
    const roster = f.team();
    const member = { ...f.user, _id: id() };
    f.register({ team: roster._id });
    f.register({ user: member._id, team: roster._id });
    const old = f.freeze();
    f.assign("TEAM", roster._id, old);
    const active = f.freeze(2, { visibility: "READABLE", drawStatus: "CLOSED" });
    active.contentHash = "invalid";
    const leader = await readPhase05C(t, f, "/my-theme");
    const linked = await readPhase05C(t, f, "/my-theme", { user: member });
    assert.equal(leader.statusCode, 200);
    assert.deepEqual(linked.body, leader.body);
    assert.ok(!f.data.reads.some(read => read.name === "versionedSnapshot"));
    const other = { ...f.user, _id: id() };
    const otherRoster = f.team({ leader: other._id });
    f.register({ user: other._id, team: otherRoster._id });
    const unrelated = await readPhase05C(t, f, "/my-theme", { user: other, query: { teamId: String(roster._id) } });
    assert.equal(unrelated.body.data.hasAssignment, false);
    assert.equal(unrelated.body.data.theme, null);
});

test("Phase 05C an unassigned private entry gets null theme even when the lottery is open", async t => {
    const f = setup(t);
    f.register();
    for (const drawStatus of ["CLOSED", "OPEN"]) {
        if (drawStatus === "OPEN") f.freeze();
        const response = await readPhase05C(t, f, "/my-theme");
        assert.equal(response.statusCode, 200);
        assert.deepEqual(response.body.data, {
            eventId: String(f.event._id), hasAssignment: false, isLocked: false, theme: null, assignedAt: null
        });
    }
    assert.ok(!f.data.reads.some(read => read.name.endsWith("Snapshot")));
});

test("Phase 05C allows child entitlement access while rejecting the parent and unrelated events", async t => {
    const f = setup(t, "TEAM");
    const parent = { _id: id(), status: "PUBLISHED", registration: { mode: "TEAM" }, multiEventAccess: { enabled: true } };
    const unrelated = { ...f.event, _id: id() };
    f.data.events.push(parent, unrelated);
    const roster = f.team({ event: parent._id });
    f.register({ event: parent._id, team: roster._id, access: { type: "MULTI_EVENT", eligibleEventIds: [f.event._id] } });
    f.assign("TEAM", roster._id, f.freeze(1, { visibility: "READABLE", drawStatus: "CLOSED" }));
    for (const resource of ["/my-theme", ""]) {
        assert.equal((await readPhase05C(t, f, resource)).statusCode, 200);
        assert.equal((await readPhase05C(t, f, resource, { eventId: parent._id })).statusCode, 409);
        assert.equal((await readPhase05C(t, f, resource, { eventId: unrelated._id })).statusCode, 403);
    }
});

test("Phase 05C rejects ambiguous and ineligible entries on both read paths", async t => {
    const f = setup(t);
    f.freeze(1, { visibility: "READABLE", drawStatus: "CLOSED" });
    const reg = f.register();
    const duplicate = f.register();
    for (const resource of ["/my-theme", ""]) {
        assert.equal((await readPhase05C(t, f, resource)).body.code, "DOMAIN_ENTRY_AMBIGUOUS");
    }
    duplicate.status = "CANCELLED";
    reg.payment.status = "PENDING";
    for (const resource of ["/my-theme", ""]) {
        assert.equal((await readPhase05C(t, f, resource)).statusCode, 403);
    }
    f.event.status = "CANCELLED";
    assert.equal((await readPhase05C(t, f, "/my-theme")).body.code, "EVENT_NOT_ELIGIBLE");
});

for (const state of ["draft", "private open", "private frozen", "public", "reset", "disabled", "readable open"]) {
    test(`Phase 05C bank denies ${state} without loading snapshot or assignment content`, async t => {
        const f = setup(t);
        f.register();
        if (state !== "draft") f.freeze();
        if (state === "private frozen") f.event.domainConfig.drawStatus = "CLOSED";
        if (state === "public") f.event.domainConfig.visibility = "PUBLIC";
        if (state === "reset") Object.assign(f.event.domainConfig, { publishedAt: null, revisionPending: true, drawStatus: "CLOSED" });
        if (state === "disabled") Object.assign(f.event.domainConfig, { enabled: false, visibility: "READABLE", drawStatus: "CLOSED" });
        if (state === "readable open") f.event.domainConfig.visibility = "READABLE";
        const response = await readPhase05C(t, f, "");
        assert.equal(response.statusCode, 403);
        assert.deepEqual(response.body, { success: false, code: "DOMAIN_BANK_UNAVAILABLE", message: "The problem bank is not available." });
        assert.ok(f.data.reads.every(read => !read.name.endsWith("Snapshot") && read.name !== "assignment"));
    });
}

test("Phase 05C bank serializes the exact current frozen version without touching assignments or drafts", async t => {
    const f = setup(t);
    failOnReadSideEffects(t);
    f.register();
    const old = f.freeze();
    const latest = f.freeze(2, { visibility: "READABLE", drawStatus: "CLOSED" });
    latest.domains = [{ domain: id(), title: "New theme", problemStatement: "Current statement" },
        { domain: id(), title: "Second", problemStatement: "Another statement", instructions: "Show your work" }];
    latest.contentHash = hashDomains(latest.domains);
    const response = await readPhase05C(t, f, "");
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["Cache-Control"], "no-store");
    assert.deepEqual(response.body.data, { eventId: String(f.event._id), visibility: "READABLE", total: 2,
        domains: [{ title: "New theme", problemStatement: "Current statement", instructions: "" },
            { title: "Second", problemStatement: "Another statement", instructions: "Show your work" }] });
    const body = JSON.stringify(response.body);
    for (const secret of [old.contentHash, latest.contentHash, String(latest.domains[0].domain), "Secret theme"]) {
        assert.equal(body.includes(secret), false);
    }
    assert.ok(f.data.reads.every(read => read.name !== "assignment" && read.name !== "legacySnapshot"));
    assert.equal(f.data.reads.at(-1).preference, "primary");
    assert.equal(f.data.reads.at(-1).readConcern, "linearizable");
    assert.equal(f.data.reads.at(-1).maxTimeMS, 5000);
    assert.equal(f.data.assignments.length, 0);
});

for (const changed of ["reset", "version", "publication", "read failure"]) {
    test(`Phase 05C bank fails closed when the disclosure check observes ${changed}`, async t => {
        const f = setup(t);
        f.register();
        f.freeze(1, { visibility: "READABLE", drawStatus: "CLOSED" });
        f.data.onRead = ({ name }) => {
            if (name !== "legacySnapshot") return;
            // A database read returns a detached document. Preserve the initially
            // resolved event and make the later authoritative read observe a new one.
            if (changed !== "read failure") {
                const current = { ...f.event, domainConfig: { ...f.event.domainConfig } };
                if (changed === "reset") Object.assign(current.domainConfig, { visibility: "PRIVATE", publishedAt: null, revisionPending: true });
                if (changed === "version") current.domainConfig.poolVersion = 2;
                if (changed === "publication") current.domainConfig.publishedAt = new Date("2026-11-27T12:00:00Z");
                f.data.events[0] = current;
            }
            if (changed === "read failure") f.data.onRead = () => { throw new Error("mongodb://private-server"); };
        };
        const response = await readPhase05C(t, f, "");
        assert.equal(response.statusCode, changed === "read failure" ? 503 : 403);
        assert.equal(response.body.data, undefined);
        assert.equal(JSON.stringify(response.body).includes("private-server"), false);
    });
}

test("Phase 05C rejects broken bank and assignment integrity without disclosing content", async t => {
    const f = setup(t);
    const reg = f.register();
    const snapshot = f.freeze(1, { visibility: "READABLE", drawStatus: "CLOSED" });
    const assignment = f.assign("INDIVIDUAL", reg._id, snapshot);
    assignment.contentSnapshot.problemStatement = "Wrong private statement";
    const theme = await readPhase05C(t, f, "/my-theme");
    assert.equal(theme.statusCode, 409);
    assert.equal(theme.body.code, "DOMAIN_ASSIGNMENT_INTEGRITY_FAILED");
    assert.equal(theme.body.data, undefined);
    snapshot.contentHash = "invalid";
    const bank = await readPhase05C(t, f, "");
    assert.equal(bank.statusCode, 409);
    assert.equal(bank.body.code, "DOMAIN_POOL_INTEGRITY_FAILED");
    assert.equal(bank.body.data, undefined);
});
