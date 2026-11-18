"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Event = require("../models/Event");
const Registration = require("../models/Registration");
const Team = require("../models/Team");
const { getAllAdminEvents } = require("../controllers/adminController");
const { getEventById } = require("../controllers/eventController");
const {
    attachEventParticipantCounts,
    buildEventParticipantCountPipeline
} = require("../utils/eventParticipantCounts");

function runPipeline(pipeline, registrations, teams) {
    let documents = registrations.map(document => JSON.parse(JSON.stringify(document)));
    const teamDocuments = teams.map(document => JSON.parse(JSON.stringify(document)));

    for (const stage of pipeline) {
        if (stage.$match) {
            documents = documents.filter(document => matches(document, stage.$match));
        } else if (stage.$lookup) {
            const { localField, foreignField, as } = stage.$lookup;
            for (const document of documents) {
                const match = teamDocuments.find(team =>
                    sameValue(document[localField], team[foreignField])
                );
                document[as] = match ? [match] : [];
            }
        } else if (stage.$addFields) {
            for (const document of documents) {
                for (const [field, expression] of Object.entries(stage.$addFields)) {
                    document[field] = evaluate(expression, document);
                }
            }
        } else if (stage.$group) {
            const groups = new Map();
            for (const document of documents) {
                const id = evaluate(stage.$group._id, document);
                const key = String(id);
                if (!groups.has(key)) {
                    groups.set(key, { _id: id });
                }
                const group = groups.get(key);
                for (const [field, operation] of Object.entries(stage.$group)) {
                    if (field !== "_id" && operation.$sum) {
                        group[field] = (group[field] || 0) + evaluate(operation.$sum, document);
                    }
                }
            }
            documents = [...groups.values()];
        }
    }

    return documents;
}

function matches(document, query) {
    return Object.entries(query).every(([field, expected]) => {
        if (field === "$expr") return Boolean(evaluate(expected, document));

        const value = getPath(document, field);
        if (expected && typeof expected === "object" && expected.$in) {
            return expected.$in.some(candidate => sameValue(value, candidate));
        }
        return sameValue(value, expected);
    });
}

function evaluate(expression, document) {
    if (typeof expression === "string" && expression.startsWith("$")) {
        return getPath(document, expression.slice(1));
    }
    if (typeof expression !== "object" || expression === null) return expression;

    if (expression.$arrayElemAt) {
        const [arrayExpression, index] = expression.$arrayElemAt;
        const array = evaluate(arrayExpression, document);
        return Array.isArray(array) ? array[index] ?? null : null;
    }
    if (expression.$ifNull) {
        const [valueExpression, fallbackExpression] = expression.$ifNull;
        const value = evaluate(valueExpression, document);
        return value == null ? evaluate(fallbackExpression, document) : value;
    }
    if (expression.$eq) {
        const [left, right] = expression.$eq.map(value => evaluate(value, document));
        return sameValue(left, right);
    }
    if (expression.$ne) {
        const [left, right] = expression.$ne.map(value => evaluate(value, document));
        return !sameValue(left, right);
    }
    if (expression.$in) {
        const [valueExpression, candidates] = expression.$in;
        const value = evaluate(valueExpression, document);
        return candidates.some(candidate => sameValue(value, candidate));
    }
    if (expression.$cond) {
        const [condition, whenTrue, whenFalse] = expression.$cond;
        return evaluate(condition, document)
            ? evaluate(whenTrue, document)
            : evaluate(whenFalse, document);
    }
    if (expression.$and) return expression.$and.every(value => Boolean(evaluate(value, document)));
    if (expression.$or) return expression.$or.some(value => Boolean(evaluate(value, document)));

    return expression;
}

function getPath(value, path) {
    return path.split(".").reduce(
        (current, key) => current == null ? null : current[key],
        value
    );
}

function sameValue(left, right) {
    if (left == null || right == null) return left == null && right == null;
    return String(left) === String(right);
}

function makeIndividual(eventId, paymentStatus, status = "REGISTERED") {
    return {
        event: eventId,
        user: new mongoose.Types.ObjectId(),
        team: null,
        status,
        payment: { status: paymentStatus }
    };
}

function makeTeam(eventId, paymentStatus, status, memberCount) {
    return {
        _id: new mongoose.Types.ObjectId(),
        event: eventId,
        payment: { status: paymentStatus },
        status,
        memberCount
    };
}

function makeTeamRegistration(eventId, team, { user = null, isTeamLeader = false, status = "REGISTERED" } = {}) {
    return {
        event: eventId,
        team: team._id,
        user,
        isTeamLeader,
        status,
        payment: { status: "NOT_REQUIRED" }
    };
}

function mockRes() {
    const response = { statusCode: 200 };
    response.status = code => {
        response.statusCode = code;
        return response;
    };
    response.json = body => {
        response.body = body;
        return response;
    };
    return response;
}

describe("Dynamic event participant counts", () => {
    test("counts eligible registrations per event and replaces stale counters", async (context) => {
        const eventOneId = new mongoose.Types.ObjectId();
        const eventTwoId = new mongoose.Types.ObjectId();
        const emptyEventId = new mongoose.Types.ObjectId();
        const otherEventId = new mongoose.Types.ObjectId();

        const pendingTeam = makeTeam(eventOneId, "PENDING", "REGISTERED", 40);
        const verifiedTeam = makeTeam(eventOneId, "VERIFIED", "REGISTERED", 1);
        const rejectedTeam = makeTeam(eventOneId, "REJECTED", "REGISTERED", 2);
        const cancelledTeam = makeTeam(eventOneId, "VERIFIED", "CANCELLED", 2);
        const freeTeam = makeTeam(eventTwoId, "NOT_REQUIRED", "REGISTERED", 20);
        const mismatchedTeam = makeTeam(eventTwoId, "VERIFIED", "REGISTERED", 1);
        const missingTeamId = new mongoose.Types.ObjectId();

        const registrations = [
            makeIndividual(eventOneId, "PENDING"),
            makeIndividual(eventOneId, "VERIFIED"),
            makeIndividual(eventOneId, "NOT_REQUIRED"),
            makeIndividual(eventOneId, "REJECTED"),
            makeIndividual(eventOneId, "VERIFIED", "CANCELLED"),
            makeTeamRegistration(eventOneId, pendingTeam, { user: new mongoose.Types.ObjectId(), isTeamLeader: true }),
            makeTeamRegistration(eventOneId, pendingTeam),
            ...Array.from({ length: 4 }, (_, index) =>
                makeTeamRegistration(eventOneId, verifiedTeam, {
                    user: index === 0 ? new mongoose.Types.ObjectId() : null,
                    isTeamLeader: index === 0
                })
            ),
            ...Array.from({ length: 2 }, () => makeTeamRegistration(eventOneId, rejectedTeam)),
            ...Array.from({ length: 2 }, () => makeTeamRegistration(eventOneId, cancelledTeam)),
            {
                event: eventOneId,
                team: missingTeamId,
                status: "REGISTERED",
                payment: { status: "NOT_REQUIRED" }
            },
            {
                event: eventOneId,
                user: null,
                team: null,
                status: "REGISTERED",
                payment: { status: "NOT_REQUIRED" }
            },
            makeTeamRegistration(eventOneId, mismatchedTeam, { user: new mongoose.Types.ObjectId() }),
            makeIndividual(otherEventId, "VERIFIED"),
            makeIndividual(eventTwoId, "PENDING"),
            ...Array.from({ length: 3 }, (_, index) =>
                makeTeamRegistration(eventTwoId, freeTeam, {
                    user: index === 0 ? new mongoose.Types.ObjectId() : null,
                    isTeamLeader: index === 0
                })
            )
        ];
        const teams = [pendingTeam, verifiedTeam, rejectedTeam, cancelledTeam, freeTeam, mismatchedTeam];
        let aggregationCalls = 0;
        context.mock.method(Registration, "aggregate", async pipeline => {
            aggregationCalls += 1;
            return runPipeline(pipeline, registrations, teams);
        });

        const events = [
            { _id: eventOneId, registration: { registeredParticipants: 99, capacity: 50 } },
            { _id: eventTwoId, registration: { registeredParticipants: 0, capacity: 12 } },
            { _id: emptyEventId, registration: { registeredParticipants: 17, capacity: 8 } }
        ];
        const result = await attachEventParticipantCounts(events);

        assert.deepEqual(result.map(event => event.registration.registeredParticipants), [9, 4, 0]);
        assert.deepEqual(result.map(event => event.registration.capacity), [50, 12, 8]);
        assert.equal(aggregationCalls, 1);
    });

    test("recomputes counts on each request after registrations are added or removed", async (context) => {
        const eventId = new mongoose.Types.ObjectId();
        const registrations = [makeIndividual(eventId, "PENDING")];
        context.mock.method(Registration, "aggregate", async pipeline =>
            runPipeline(pipeline, registrations, [])
        );
        const event = { _id: eventId, registration: { registeredParticipants: 500, capacity: 6 } };

        assert.equal((await attachEventParticipantCounts([event]))[0].registration.registeredParticipants, 1);
        registrations.push(makeIndividual(eventId, "VERIFIED"));
        assert.equal((await attachEventParticipantCounts([event]))[0].registration.registeredParticipants, 2);
        registrations.shift();
        assert.equal((await attachEventParticipantCounts([event]))[0].registration.registeredParticipants, 1);
    });

    test("admin events API returns dynamic counts with the existing capacity and pagination", async (context) => {
        const eventId = new mongoose.Types.ObjectId();
        const registrations = [makeIndividual(eventId, "PENDING")];
        const events = [{ _id: eventId, registration: { registeredParticipants: 50, capacity: 8 } }];
        const query = {
            sort() { return this; },
            skip() { return this; },
            limit() { return this; },
            select() { return this; },
            lean: async () => events
        };
        context.mock.method(Event, "find", () => query);
        context.mock.method(Event, "countDocuments", async () => events.length);
        context.mock.method(Registration, "aggregate", async pipeline =>
            runPipeline(pipeline, registrations, [])
        );

        const response = mockRes();
        await getAllAdminEvents({ query: {} }, response);

        assert.equal(response.statusCode, 200);
        assert.equal(response.body.events[0].registration.registeredParticipants, 1);
        assert.equal(response.body.events[0].registration.capacity, 8);
        assert.equal(response.body.pagination.totalEvents, 1);
    });

    test("event details API returns dynamic participant count and preserves capacity", async (context) => {
        const eventId = new mongoose.Types.ObjectId();
        const event = {
            _id: eventId,
            status: "PUBLISHED",
            registration: { registeredParticipants: 42, capacity: 11 }
        };
        const query = Promise.resolve(event);
        query.populate = () => query;
        context.mock.method(Event, "findById", () => query);
        context.mock.method(Registration, "aggregate", async pipeline =>
            runPipeline(pipeline, [makeIndividual(eventId, "VERIFIED")], [])
        );

        const response = mockRes();
        await getEventById({
            params: { id: eventId.toString() },
            user: { role: "ADMIN" }
        }, response);

        assert.equal(response.statusCode, 200);
        assert.equal(response.body.event.registration.registeredParticipants, 1);
        assert.equal(response.body.event.registration.capacity, 11);
    });

    test("empty event collections do not issue an aggregation", async (context) => {
        const aggregate = context.mock.method(Registration, "aggregate", async () => {
            throw new Error("No aggregate is expected for an empty event list");
        });

        assert.deepEqual(await attachEventParticipantCounts([]), []);
        assert.equal(aggregate.mock.callCount(), 0);
    });

    test("count pipeline scopes registrations to requested event IDs", () => {
        const eventIds = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
        const pipeline = buildEventParticipantCountPipeline(eventIds);

        assert.deepEqual(pipeline[0].$match.event.$in, eventIds);
        assert.equal(pipeline[0].$match.status, "REGISTERED");
        assert.equal(pipeline[pipeline.length - 1].$group._id, "$event");
    });
});
