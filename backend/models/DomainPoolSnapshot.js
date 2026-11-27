"use strict";

const mongoose = require("mongoose");

const frozenDomainSchema = new mongoose.Schema({
    domain: { type: mongoose.Schema.Types.ObjectId, ref: "EventDomain", required: true, immutable: true },
    title: { type: String, required: true, maxlength: 160, immutable: true },
    problemStatement: { type: String, required: true, maxlength: 20000, immutable: true },
    instructions: { type: String, default: "", maxlength: 10000, immutable: true }
}, { _id: false });

const fields = {
    event: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true, immutable: true },
    poolVersion: { type: Number, required: true, min: 1, immutable: true },
    publishedAt: { type: Date, required: true, immutable: true },
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
    domains: { type: [frozenDomainSchema], required: true, immutable: true },
    contentHash: { type: String, required: true, match: /^[a-f0-9]{64}$/, immutable: true }
};

// Keep the deployed collection and unique index for version 1.
const schema = new mongoose.Schema(fields, { collection: "domain_pool_snapshots", timestamps: true });
schema.index({ event: 1 }, { unique: true, name: "uniq_domain_pool_snapshot_event" });

const versionedSchema = new mongoose.Schema(fields, { collection: "domain_pool_snapshot_versions", timestamps: true });
versionedSchema.index({ event: 1, poolVersion: 1 }, { unique: true, name: "uniq_domain_pool_snapshot_event_version" });

const DomainPoolSnapshot = mongoose.models.DomainPoolSnapshot || mongoose.model("DomainPoolSnapshot", schema);
const DomainPoolSnapshotVersion = mongoose.models.DomainPoolSnapshotVersion ||
    mongoose.model("DomainPoolSnapshotVersion", versionedSchema);

module.exports = DomainPoolSnapshot;
module.exports.forVersion = version => version === 1 ? DomainPoolSnapshot : DomainPoolSnapshotVersion;
