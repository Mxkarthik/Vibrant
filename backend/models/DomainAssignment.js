const mongoose = require("mongoose");

const assignedContentSchema = new mongoose.Schema(
    {
        title: { type: String, required: true, maxlength: 160 },
        problemStatement: { type: String, required: true, maxlength: 20000 },
        instructions: { type: String, default: "", maxlength: 10000 }
    },
    { _id: false }
);

const domainAssignmentSchema = new mongoose.Schema(
    {
        event: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Event",
            required: true
        },
        domain: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "EventDomain",
            required: true,
            immutable: true
        },
        // Registration._id for individual entries; Team._id for team entries.
        entryType: {
            type: String,
            enum: ["INDIVIDUAL", "TEAM"],
            required: true,
            immutable: true
        },
        entry: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            immutable: true
        },
        initiatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            immutable: true
        },
        assignedAt: { type: Date, required: true, default: Date.now, immutable: true },
        poolVersion: { type: Number, required: true, min: 1, immutable: true },
        // Persistent copy preserves the assigned text if the source domain is revised/deleted.
        contentSnapshot: { type: assignedContentSchema, required: true, immutable: true }
    },
    { timestamps: true }
);

// A registration/team entry may receive only one assignment within an event.
// The entry type is included because Registration and Team have separate ID spaces.
domainAssignmentSchema.index(
    { event: 1, entryType: 1, entry: 1 },
    { unique: true, name: "uniq_domain_assignment_event_entry" }
);
domainAssignmentSchema.index({ event: 1, domain: 1 });

module.exports = mongoose.model("DomainAssignment", domainAssignmentSchema);
