
const mongoose = require("mongoose");

const teamSchema = new mongoose.Schema(
    {
        event: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Event",
            required: true
        },

        teamName: {
            type: String,
            required: true,
            trim: true
        },

        leader: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },

        memberCount: {
            type: Number,
            required: true,
            min: 1
        },

        payment: {
            method: {
                type: String,
                enum: ["UPI", "CASH", "NONE"],
                default: "NONE"
            },

            status: {
                type: String,
                enum: ["NOT_REQUIRED", "PENDING", "VERIFIED", "REJECTED"],
                default: "PENDING"
            },

            proofUrl: {
                type: String,
                default: null
            },

            cashReceiverName: {
                type: String,
                trim: true,
                maxlength: 120,
                default: null
            },

            expectedAmount: {
                type: Number,
                min: 0,
                default: null
            },

            receivedAmount: {
                type: Number,
                min: 0,
                default: null
            },

            currency: {
                type: String,
                default: "INR",
                uppercase: true,
                trim: true
            },

            verifiedBy: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "User",
                default: null
            },

            verifiedAt: {
                type: Date,
                default: null
            },

            // Append-only audit history. Never overwrite existing entries.
            history: [
                {
                    fromStatus: {
                        type: String,
                        enum: ["NOT_REQUIRED", "PENDING", "VERIFIED", "REJECTED"],
                        required: true
                    },
                    toStatus: {
                        type: String,
                        enum: ["NOT_REQUIRED", "PENDING", "VERIFIED", "REJECTED"],
                        required: true
                    },
                    changedBy: {
                        type: mongoose.Schema.Types.ObjectId,
                        ref: "User",
                        required: true
                    },
                    changedAt: {
                        type: Date,
                        required: true
                    },
                    reason: {
                        type: String,
                        trim: true,
                        default: null
                    }
                }
            ]
        },

        status: {
            type: String,
            enum: ["REGISTERED", "CANCELLED"],
            default: "REGISTERED"
        }
    },
    {
        timestamps: true
    }
);

// Prevent duplicate team names within the same event.
teamSchema.index(
    { event: 1, teamName: 1 },
    { unique: true }
);

module.exports = mongoose.model("Team", teamSchema);
