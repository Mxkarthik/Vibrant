"use strict";

const mongoose = require("mongoose");

const publication = new mongoose.Schema({
    visibility: { type: String, required: true, immutable: true },
    poolVersion: { type: Number, required: true, immutable: true },
    publishedAt: { type: Date, immutable: true },
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", immutable: true },
    drawOpenedAt: { type: Date, immutable: true },
    drawClosedAt: { type: Date, immutable: true },
    readEnabledAt: { type: Date, immutable: true },
    readEnabledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", immutable: true }
}, { _id: false });

const schema = new mongoose.Schema({
    event: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true, immutable: true },
    admin: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
    action: { type: String, enum: ["RESET_TO_DRAFT", "CLEAR_DOMAINS"], required: true, immutable: true },
    reason: { type: String, maxlength: 500, immutable: true },
    previous: { type: publication, required: true, immutable: true },
    coordinationVersion: { type: Number, required: true, immutable: true },
    deletedDomainCount: { type: Number, required: true, immutable: true },
    recordedAt: { type: Date, default: Date.now, required: true, immutable: true }
}, { collection: "domain_admin_audits" });

module.exports = mongoose.model("DomainAdminAudit", schema);
