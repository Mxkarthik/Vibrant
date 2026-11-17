/**
 * dashboard-registration-count.test.js
 *
 * Tests for Phase 3, Fix 1 — Correct Admin Dashboard Total Registrations Count.
 * Validates counting rules:
 *   - Individual VERIFIED: 1
 *   - Individual NOT_REQUIRED: 1
 *   - Individual PENDING: 0
 *   - Individual REJECTED: 0
 *   - Individual CANCELLED: 0
 *   - Team VERIFIED: Active member count
 *   - Team NOT_REQUIRED: Active member count
 *   - Team PENDING: 0
 *   - Team REJECTED: 0
 *   - Team CANCELLED: 0
 *
 * Validates supplied example:
 *   - MEDHA (2 members, VERIFIED) + Helina Arcade (2 members, PENDING) => total = 2 (not 4).
 */

"use strict";

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Registration = require("../models/Registration");
const Team = require("../models/Team");
const Event = require("../models/Event");
const User = require("../models/User");
const { getDashboard, buildRegistrationSummaryPipeline } = require("../controllers/adminController");

const adminId = new mongoose.Types.ObjectId();
const eventId = new mongoose.Types.ObjectId();

/**
 * Execute the exact aggregation pipeline stages in JavaScript
 * mirroring MongoDB aggregation semantics.
 */
function runPipeline(pipeline, registrations, teams) {
    let docs = registrations.map(r => JSON.parse(JSON.stringify(r)));
    const teamsList = teams.map(t => JSON.parse(JSON.stringify(t)));

    for (const stage of pipeline) {
        if (stage.$lookup) {
            const { localField, foreignField, as } = stage.$lookup;
            for (const doc of docs) {
                const val = doc[localField];
                if (val != null) {
                    const match = teamsList.find(t => String(t[foreignField]) === String(val));
                    doc[as] = match ? [match] : [];
                } else {
                    doc[as] = [];
                }
            }
        } else if (stage.$addFields) {
            for (const doc of docs) {
                for (const [key, expr] of Object.entries(stage.$addFields)) {
                    doc[key] = evaluateExpr(expr, doc);
                }
            }
        } else if (stage.$group) {
            const groupSpec = stage.$group;
            const accum = {};
            for (const [key, op] of Object.entries(groupSpec)) {
                if (key === "_id") continue;
                accum[key] = 0;
            }
            for (const doc of docs) {
                for (const [key, op] of Object.entries(groupSpec)) {
                    if (key === "_id") continue;
                    if (op.$sum) {
                        const sumVal = evaluateExpr(op.$sum, doc);
                        accum[key] += typeof sumVal === "number" ? sumVal : 0;
                    }
                }
            }
            docs = docs.length ? [accum] : [];
        } else if (stage.$project) {
            // projection cleanup
        }
    }
    return docs;
}

function evaluateExpr(expr, doc) {
    if (typeof expr === "number") return expr;
    if (typeof expr === "string" && expr.startsWith("$")) {
        const path = expr.slice(1).split(".");
        let curr = doc;
        for (const p of path) {
            if (curr == null) return null;
            curr = curr[p];
        }
        return curr !== undefined ? curr : null;
    }
    if (typeof expr !== "object" || expr === null) return expr;

    if (expr.$arrayElemAt) {
        const arr = evaluateExpr(expr.$arrayElemAt[0], doc);
        const idx = expr.$arrayElemAt[1];
        return Array.isArray(arr) && arr.length > idx ? arr[idx] : null;
    }
    if (expr.$eq) {
        const left = evaluateExpr(expr.$eq[0], doc);
        const right = evaluateExpr(expr.$eq[1], doc);
        return left === right;
    }
    if (expr.$ne) {
        const left = evaluateExpr(expr.$ne[0], doc);
        const right = evaluateExpr(expr.$ne[1], doc);
        return left !== right;
    }
    if (expr.$ifNull) {
        const val = evaluateExpr(expr.$ifNull[0], doc);
        return val != null ? val : evaluateExpr(expr.$ifNull[1], doc);
    }
    if (expr.$cond) {
        const cond = evaluateExpr(expr.$cond[0], doc);
        return cond ? evaluateExpr(expr.$cond[1], doc) : evaluateExpr(expr.$cond[2], doc);
    }
    if (expr.$in) {
        const val = evaluateExpr(expr.$in[0], doc);
        const list = expr.$in[1];
        return list.includes(val);
    }
    if (expr.$and) {
        return expr.$and.every(sub => Boolean(evaluateExpr(sub, doc)));
    }
    return expr;
}

function createIndividualReg(paymentStatus = "VERIFIED", status = "REGISTERED") {
    return {
        _id: new mongoose.Types.ObjectId(),
        event: eventId,
        user: new mongoose.Types.ObjectId(),
        team: null,
        participantDetails: { fullName: "Test Individual" },
        status,
        payment: { method: paymentStatus === "NOT_REQUIRED" ? "NONE" : "UPI", status: paymentStatus },
        attendance: { isPresent: false }
    };
}

function createTeamAndMembers(teamName, memberCount, paymentStatus = "VERIFIED", teamStatus = "REGISTERED") {
    const teamId = new mongoose.Types.ObjectId();
    const team = {
        _id: teamId,
        teamName,
        memberCount,
        leader: new mongoose.Types.ObjectId(),
        status: teamStatus,
        payment: { method: paymentStatus === "NOT_REQUIRED" ? "NONE" : "UPI", status: paymentStatus }
    };

    const members = [];
    for (let i = 0; i < memberCount; i++) {
        members.push({
            _id: new mongoose.Types.ObjectId(),
            event: eventId,
            user: new mongoose.Types.ObjectId(),
            team: teamId,
            participantDetails: { fullName: `${teamName} Member ${i + 1}` },
            status: "REGISTERED",
            payment: { method: "NONE", status: "NOT_REQUIRED" },
            attendance: { isPresent: false }
        });
    }
    return { team, members };
}

describe("Dashboard Total Registrations Count — Counting Rules", () => {
    const pipeline = buildRegistrationSummaryPipeline();

    test("1. One verified individual registration counts as 1", () => {
        const regs = [createIndividualReg("VERIFIED", "REGISTERED")];
        const res = runPipeline(pipeline, regs, []);
        assert.equal(res[0].totalRegistrations, 1);
    });

    test("2. One pending individual registration counts as 0", () => {
        const regs = [createIndividualReg("PENDING", "REGISTERED")];
        const res = runPipeline(pipeline, regs, []);
        assert.equal(res[0].totalRegistrations, 0);
    });

    test("3. One rejected individual registration counts as 0", () => {
        const regs = [createIndividualReg("REJECTED", "REGISTERED")];
        const res = runPipeline(pipeline, regs, []);
        assert.equal(res[0].totalRegistrations, 0);
    });

    test("4. One NOT_REQUIRED individual registration counts as 1", () => {
        const regs = [createIndividualReg("NOT_REQUIRED", "REGISTERED")];
        const res = runPipeline(pipeline, regs, []);
        assert.equal(res[0].totalRegistrations, 1);
    });

    test("Cancelled individual registration counts as 0 even if payment was VERIFIED", () => {
        const regs = [createIndividualReg("VERIFIED", "CANCELLED")];
        const res = runPipeline(pipeline, regs, []);
        assert.equal(res[0].totalRegistrations, 0);
    });

    test("5. One verified team with two members counts as 2", () => {
        const { team, members } = createTeamAndMembers("Alpha", 2, "VERIFIED", "REGISTERED");
        const res = runPipeline(pipeline, members, [team]);
        assert.equal(res[0].totalRegistrations, 2);
    });

    test("One NOT_REQUIRED team with two members counts as 2", () => {
        const { team, members } = createTeamAndMembers("FreeTeam", 2, "NOT_REQUIRED", "REGISTERED");
        const res = runPipeline(pipeline, members, [team]);
        assert.equal(res[0].totalRegistrations, 2);
    });

    test("6. One pending team with two members counts as 0", () => {
        const { team, members } = createTeamAndMembers("Beta", 2, "PENDING", "REGISTERED");
        const res = runPipeline(pipeline, members, [team]);
        assert.equal(res[0].totalRegistrations, 0);
    });

    test("7. One rejected team counts as 0", () => {
        const { team, members } = createTeamAndMembers("Gamma", 3, "REJECTED", "REGISTERED");
        const res = runPipeline(pipeline, members, [team]);
        assert.equal(res[0].totalRegistrations, 0);
    });

    test("8. One cancelled team counts as 0 even if payment was VERIFIED", () => {
        const { team, members } = createTeamAndMembers("Delta", 2, "VERIFIED", "CANCELLED");
        const res = runPipeline(pipeline, members, [team]);
        assert.equal(res[0].totalRegistrations, 0);
    });

    test("Team with a cancelled member counts only active members", () => {
        const { team, members } = createTeamAndMembers("Epsilon", 3, "VERIFIED", "REGISTERED");
        members[0].status = "CANCELLED"; // 1 cancelled member, 2 active
        const res = runPipeline(pipeline, members, [team]);
        assert.equal(res[0].totalRegistrations, 2);
    });

    test("9. A mixture of individual and team registrations", () => {
        const indVerified = createIndividualReg("VERIFIED", "REGISTERED");       // +1
        const indPending = createIndividualReg("PENDING", "REGISTERED");         // +0
        const indRejected = createIndividualReg("REJECTED", "REGISTERED");       // +0
        const indNotRequired = createIndividualReg("NOT_REQUIRED", "REGISTERED");// +1
        const indCancelled = createIndividualReg("VERIFIED", "CANCELLED");       // +0

        const teamVer = createTeamAndMembers("T-Verified", 2, "VERIFIED");       // +2
        const teamPend = createTeamAndMembers("T-Pending", 3, "PENDING");        // +0
        const teamRej = createTeamAndMembers("T-Rejected", 2, "REJECTED");       // +0
        const teamCanc = createTeamAndMembers("T-Cancelled", 2, "VERIFIED", "CANCELLED"); // +0

        const allRegs = [
            indVerified,
            indPending,
            indRejected,
            indNotRequired,
            indCancelled,
            ...teamVer.members,
            ...teamPend.members,
            ...teamRej.members,
            ...teamCanc.members
        ];
        const allTeams = [teamVer.team, teamPend.team, teamRej.team, teamCanc.team];

        const res = runPipeline(pipeline, allRegs, allTeams);
        // Expected: 1 (indVerified) + 1 (indNotRequired) + 2 (teamVer members) = 4
        assert.equal(res[0].totalRegistrations, 4);
    });

    test("10. No duplicate participant counting", () => {
        const { team, members } = createTeamAndMembers("NoDupTeam", 4, "VERIFIED", "REGISTERED");
        const res = runPipeline(pipeline, members, [team]);
        assert.equal(res[0].totalRegistrations, 4);
        assert.equal(members.length, 4);
    });

    test("11. Supplied example from database: MEDHA (2 VERIFIED) + Helina Arcade (2 PENDING) => exactly 2, not 4", () => {
        const medha = createTeamAndMembers("MEDHA", 2, "VERIFIED", "REGISTERED");
        const helina = createTeamAndMembers("Helina Arcade", 2, "PENDING", "REGISTERED");

        const allRegs = [...medha.members, ...helina.members];
        const allTeams = [medha.team, helina.team];

        // Before Fix 1, this returned 4 because it counted all 4 Registration documents.
        // After Fix 1, it must return exactly 2.
        const res = runPipeline(pipeline, allRegs, allTeams);
        assert.equal(res[0].totalRegistrations, 2);
    });
});

describe("getDashboard Controller Endpoint Integration", () => {
    function mockRes() {
        const res = { statusCode: 200 };
        res.status = (code) => { res.statusCode = code; return res; };
        res.json = (body) => { res.body = body; return res; };
        return res;
    }

    test("getDashboard returns overview.totalRegistrations computed by pipeline", async (context) => {
        const medha = createTeamAndMembers("MEDHA", 2, "VERIFIED", "REGISTERED");
        const helina = createTeamAndMembers("Helina Arcade", 2, "PENDING", "REGISTERED");
        const allRegs = [...medha.members, ...helina.members];
        const allTeams = [medha.team, helina.team];

        const pipeline = buildRegistrationSummaryPipeline();
        const pipelineResult = runPipeline(pipeline, allRegs, allTeams);

        context.mock.method(Event, "aggregate", async () => [{
            totalEvents: 1,
            publishedEvents: 1,
            completedEvents: 0,
            cancelledEvents: 0
        }]);

        context.mock.method(Registration, "aggregate", async (pipe) => {
            // If it's the summary pipeline:
            if (pipe.length === pipeline.length) {
                return pipelineResult;
            }
            // individualPayments pipeline
            return [{ pendingIndividual: 0, verifiedIndividual: 0 }];
        });

        context.mock.method(Team, "aggregate", async () => [{
            pendingTeams: 1,
            verifiedTeams: 1
        }]);

        context.mock.method(User, "countDocuments", async () => 2);
        context.mock.method(Event, "find", () => ({
            sort: () => ({
                limit: () => ({
                    select: () => ({
                        lean: async () => []
                    })
                })
            })
        }));

        const req = { user: { _id: adminId, role: "ADMIN" } };
        const res = mockRes();

        await getDashboard(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.overview.totalRegistrations, 2, "Supplied example returns 2, not 4");
    });
});
