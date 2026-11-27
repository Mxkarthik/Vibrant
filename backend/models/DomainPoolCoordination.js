"use strict";

const mongoose = require("mongoose");

const schema = new mongoose.Schema({
    event: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },
    version: { type: Number, default: 0, required: true },
    lastModifiedAt: { type: Date, default: Date.now }
}, { collection: "domain_pool_coordinations", timestamps: true });

schema.index({ event: 1 }, { unique: true });

module.exports = mongoose.models.DomainPoolCoordination ||
    mongoose.model("DomainPoolCoordination", schema);
