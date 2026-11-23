"use strict";

const mongoose = require("mongoose");

/**
 * EventGraphCoordination Model
 *
 * Dedicated database coordination document for multi-event relationship graph mutations.
 * Completely isolated from normal Event, Registration and Team business entities.
 *
 * All transactions that create, modify or delete nodes/edges in the combo hierarchy
 * perform an atomic $inc write on this document to guarantee serializability and
 * prevent write-skew / cyclic combo relationships in MongoDB Atlas.
 */
const eventGraphCoordinationSchema = new mongoose.Schema(
    {
        key: {
            type: String,
            required: true,
            default: "GLOBAL_EVENT_GRAPH"
        },
        version: {
            type: Number,
            required: true,
            default: 0
        },
        lastModifiedAt: {
            type: Date,
            default: Date.now
        }
    },
    {
        collection: "event_graph_coordinations",
        timestamps: true
    }
);

eventGraphCoordinationSchema.index({ key: 1 }, { unique: true });

module.exports = mongoose.models.EventGraphCoordination ||
    mongoose.model("EventGraphCoordination", eventGraphCoordinationSchema);
