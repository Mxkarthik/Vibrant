const mongoose = require("mongoose");

const eventDomainSchema = new mongoose.Schema(
    {
        event: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Event",
            required: true,
            index: false
        },
        title: {
            type: String,
            required: true,
            trim: true,
            minlength: 1,
            maxlength: 160
        },
        problemStatement: {
            type: String,
            required: true,
            trim: true,
            minlength: 1,
            maxlength: 20000
        },
        instructions: {
            type: String,
            trim: true,
            maxlength: 10000,
            default: ""
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        }
    },
    { timestamps: true }
);

// Event scoping supports deterministic admin listings; duplicate titles remain allowed.
eventDomainSchema.index({ event: 1, createdAt: 1, _id: 1 });

module.exports = mongoose.model("EventDomain", eventDomainSchema);
