const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Event = require("../models/Event");
const Registration = require("../models/Registration");
const Team = require("../models/Team");

// No real database or Cloudinary calls: exercise the real controllers and schemas
// with controlled storage adapters to check ownership and transaction outcomes.
let state;
const proofUrl = "https://example.invalid/test-proof.png";
const uploaderPath = require.resolve("../utils/uploadToCloudinary");
const cleanupPath = require.resolve("../utils/deleteCloudinaryImage");
require.cache[uploaderPath] = { id: uploaderPath, filename: uploaderPath, loaded: true, exports: async () => {
    state.uploads += 1;
    if (state.uploadFailure) throw new Error("Simulated Cloudinary failure");
    return { secureUrl: proofUrl, url: proofUrl, publicId: "test-proof" };
} };
require.cache[cleanupPath] = { id: cleanupPath, filename: cleanupPath, loaded: true, exports: async publicId => { state.deleted.push(publicId); } };
const { registerForEvent, updatePaymentStatus } = require("../controllers/registrationController");
const { registerTeam, updateTeamPaymentStatus } = require("../controllers/teamRegistrationController");
const authorizePortal = require("../middleware/authorizeParticipantPortal");
const authorizeRoles = require("../middleware/roleMiddleware");

const details = (index = 1) => ({ fullName: `Test Member ${index}`, mobileNumber: `999999999${index}`, collegeName: "Test College", department: "Test", yearOfStudy: "2", section: "A", rollNumber: `TEST${index}` });
const image = () => ({ mimetype: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=", "base64") });
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const owner = new mongoose.Types.ObjectId();

beforeEach(context => {
    state = { registrations: [], teams: [], uploads: 0, deleted: [], commits: 0, capacity: 0, event: null };
    context.mock.method(console, "error", () => {});
    context.mock.method(mongoose, "startSession", async () => ({
        withTransaction: async callback => {
            try { await callback(); state.commits += 1; }
            catch (error) { state.registrations = []; state.teams = []; state.capacity = 0; throw error; }
        },
        endSession: async () => {}
    }));
    context.mock.method(Event, "findById", () => ({ session: async () => state.event }));
    context.mock.method(Event, "findOneAndUpdate", async (filter, update) => {
        assert.equal(filter.status, "PUBLISHED");
        assert.ok(filter["registration.deadline"]);
        assert.ok(filter.$expr, "Capacity remains guarded by database expression");
        if (state.full) return null;
        state.capacity += update.$inc["registration.registeredParticipants"];
        return state.event;
    });
    context.mock.method(Registration, "create", async records => {
        if (state.duplicate) { const error = new Error("Duplicate registration"); error.code = 11000; throw error; }
        const documents = records.map(record => new Registration(record));
        for (const document of documents) await document.validate();
        state.registrations.push(...documents);
        return documents;
    });
    context.mock.method(Registration, "insertMany", async records => {
        const documents = records.map(record => new Registration(record));
        for (const document of documents) await document.validate();
        state.registrations.push(...documents);
        return documents;
    });
    context.mock.method(Team, "create", async records => {
        const documents = records.map(record => new Team(record));
        for (const document of documents) await document.validate();
        state.teams.push(...documents);
        return documents;
    });
    context.mock.method(Team, "findOne", () => ({ select() { return this; }, session: async () => state.duplicate ? { _id: new mongoose.Types.ObjectId() } : null, sort: async () => state.teams[0] }));
    context.mock.method(Registration, "findOne", () => ({ select() { return this; }, session: async () => null }));
    context.mock.method(Registration, "find", () => ({ select: async () => state.registrations }));
});

async function submit(mode, { method = "UPI", fee = 100, qr = true, screenshot = image(), receiver = "Test Cash Receiver", role = "PARTICIPANT" } = {}) {
    state.event = new Event({ name: "Test Event", description: "Test", category: "TECHNICAL", venue: "Test Venue", createdBy: owner, startDate: "2035-12-20", endDate: "2035-12-21", paymentQrUrl: qr ? "https://example.invalid/test-event-qr.png" : null, registration: { mode, deadline: "2035-12-19", capacity: 10, registrationFee: fee, minTeamSize: mode === "TEAM" ? 2 : 1, maxTeamSize: mode === "TEAM" ? 5 : 1 } });
    const req = { params: { id: state.event._id.toString() }, user: { _id: owner, role }, file: screenshot, body: mode === "TEAM" ? { teamName: "Test Team", members: JSON.stringify([1, 2].map(index => ({ participantDetails: details(index), customResponses: [] }))), paymentMethod: method, cashReceiverName: receiver } : { participantDetails: JSON.stringify(details()), customResponses: "[]", paymentMethod: method, cashReceiverName: receiver } };
    const res = response();
    await (mode === "TEAM" ? registerTeam : registerForEvent)(req, res);
    assert.equal(req.user.role, role);
    return res;
}

for (const mode of ["INDIVIDUAL", "TEAM"]) {
    for (const role of ["PARTICIPANT", "ORGANISER", "ADMIN"]) {
        test(`${mode} UPI: ${role} saves one proof with pending payment`, async () => {
            const res = await submit(mode, { role });
            assert.equal(res.statusCode, 201);
            assert.equal(state.uploads, 1);
            const paymentRecord = mode === "TEAM" ? state.teams[0] : state.registrations[0];
            assert.equal(paymentRecord.payment.proofUrl, proofUrl);
            assert.equal(paymentRecord.payment.status, "PENDING");
            assert.equal(state.commits, 1);
            assert.equal(state.capacity, mode === "TEAM" ? 2 : 1);
            assert.equal(state.registrations[0].user.toString(), owner.toString());
            if (mode === "TEAM") {
                assert.equal(state.teams[0].leader.toString(), owner.toString());
                assert.equal(state.registrations.length, 2);
                for (const member of state.registrations) {
                    assert.equal(member.payment.proofUrl, null);
                    assert.equal(member.payment.status, "NOT_REQUIRED");
                    assert.equal(member.team.toString(), state.teams[0]._id.toString());
                }
            }
        });
    }
    test(`${mode} CASH succeeds without QR or screenshot and stays pending`, async () => {
        const res = await submit(mode, { method: "CASH", qr: false, screenshot: null });
        assert.equal(res.statusCode, 201);
        const record = mode === "TEAM" ? state.teams[0] : state.registrations[0];
        assert.equal(record.payment.cashReceiverName, "Test Cash Receiver");
        assert.equal(record.payment.status, "PENDING");
        assert.equal(state.uploads, 0);
    });
    test(`${mode} free registration requires no payment information`, async () => {
        const res = await submit(mode, { method: "NONE", fee: 0, qr: false, screenshot: null });
        assert.equal(res.statusCode, 201);
        assert.equal((mode === "TEAM" ? state.teams[0] : state.registrations[0]).payment.status, "NOT_REQUIRED");
        assert.equal(state.uploads, 0);
    });
    for (const [name, options] of [["missing screenshot", { screenshot: null }], ["missing QR", { qr: false }], ["invalid image bytes", { screenshot: { mimetype: "image/png", buffer: Buffer.from("invalid") } }], ["missing cash receiver", { method: "CASH", receiver: "", screenshot: null }]]) {
        test(`${mode} rejects ${name}`, async () => {
            const res = await submit(mode, options);
            assert.equal(res.statusCode, 400);
            assert.equal(state.commits, 0);
            assert.equal(state.registrations.length + state.teams.length, 0);
        });
    }
    test(`${mode} Cloudinary failure cannot commit registration or capacity`, async () => {
        state.uploadFailure = true;
        const res = await submit(mode);
        assert.equal(res.statusCode, 502);
        assert.equal(state.commits + state.capacity + state.registrations.length + state.teams.length, 0);
    });
    test(`${mode} capacity failure rolls back and removes uploaded proof`, async () => {
        state.full = true;
        const res = await submit(mode);
        assert.equal(res.statusCode, 409);
        assert.deepEqual(state.deleted, ["test-proof"]);
        assert.equal(state.commits + state.capacity, 0);
    });
    test(`${mode} duplicate submission remains rejected`, async () => {
        state.duplicate = true;
        const res = await submit(mode);
        assert.equal(res.statusCode, 409);
        assert.equal(state.commits + state.capacity + state.registrations.length + state.teams.length, 0);
    });
}

test("Role middleware retains portal and administrative permission boundaries", () => {
    for (const role of ["PARTICIPANT", "ORGANISER", "ADMIN"]) {
        let allowed = false;
        authorizePortal({ user: { role } }, response(), () => { allowed = true; });
        assert.ok(allowed);
    }
    for (const role of ["PARTICIPANT", "ORGANISER"]) {
        const res = response();
        authorizeRoles("ADMIN")({ user: { role } }, res, () => assert.fail("Payment verification must remain ADMIN-only"));
        assert.equal(res.statusCode, 403);
    }
});

test("Existing individual and team ADMIN verification/rejection still accept pending payments", async context => {
    for (const [model, controller] of [[Registration, updatePaymentStatus], [Team, updateTeamPaymentStatus]]) {
        for (const status of ["VERIFIED", "REJECTED"]) {
            const record = { _id: new mongoose.Types.ObjectId(), status: "REGISTERED", payment: { method: "UPI", status: "PENDING", proofUrl, history: [] }, save: async () => {} };
            // New controller uses mongoose.startSession + .session() chaining on findById
            context.mock.method(mongoose, "startSession", async () => ({
                withTransaction: async cb => { await cb(); },
                endSession: async () => {}
            }));
            context.mock.method(model, "findById", () => ({ session: async () => record }));
            // New controller calls Event.findOneAndUpdate for REJECTED (capacity release)
            context.mock.method(Event, "findOneAndUpdate", async () => ({ registration: { registeredParticipants: 4 } }));
            const res = response();
            // REJECTED now requires a reason — supply one
            const body = status === "REJECTED" ? { status, reason: "Proof invalid" } : { status };
            await controller({ params: { id: record._id.toString() }, body, user: { _id: owner, role: "ADMIN" } }, res);
            assert.equal(res.statusCode, 200);
            assert.equal(record.payment.status, status);
            assert.equal(record.payment.proofUrl, proofUrl);
        }
    }
});

test("Existing Cloudinary adapter streams the original image and maps secure_url", async context => {
    const { Writable } = require("node:stream");
    const cloudinary = require("../config/cloudinary");
    const cached = require.cache[uploaderPath];
    delete require.cache[uploaderPath];
    const uploadToCloudinary = require(uploaderPath);
    require.cache[uploaderPath] = cached;
    const bytes = image().buffer;
    const chunks = [];
    context.mock.method(cloudinary.uploader, "upload_stream", (options, callback) => {
        assert.equal(options.folder, "vibrant/payment-proofs");
        assert.equal(options.resource_type, "image");
        return new Writable({ write(chunk, encoding, done) { chunks.push(chunk); done(); }, final(done) { callback(null, { secure_url: proofUrl, public_id: "test-proof" }); done(); } });
    });
    const result = await uploadToCloudinary(bytes);
    assert.deepEqual(Buffer.concat(chunks), bytes);
    assert.equal(result.secureUrl, proofUrl);
    assert.equal(result.url, proofUrl);
    assert.equal(result.publicId, "test-proof");
});
