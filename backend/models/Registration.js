
const mongoose = require("mongoose");
const crypto = require("crypto");

const registrationSchema = new mongoose.Schema(
    {
        event: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Event",
            required: true
        },

        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
        },

        team: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Team",
            default: null
        },

        isTeamLeader: {
            type: Boolean,
            default: false
        },

        // Standard participant information
        participantDetails: {
            fullName: {
                type: String,
                required: true,
                trim: true
            },

            mobileNumber: {
                type: String,
                required: true,
                trim: true
            },

            collegeName: {
                type: String,
                required: true,
                trim: true
            },

            department: {
                type: String,
                required: true,
                trim: true
            },
            section: {
                type: String,
                required: true,
                trim: true
            },

            yearOfStudy: {
                type: String,
                required: true,
                trim: true
            },

            rollNumber: {
                type: String,
                required: true,
                trim: true
            }
        },

        // Optional event-specific answers
        customResponses: [
            {
                fieldKey: {
                    type: String,
                    required: true
                },

                value: {
                    type: mongoose.Schema.Types.Mixed
                }
            }
        ],

        // Payment details
        payment: {
            method: {
                type: String,
                enum: ["UPI", "CASH", "NONE"],
                default: "NONE"
            },
        certificate: 
        {
            certificateId: {
                type: String,
                unique: true,
                sparse: true,
                default: null
            },
            issuedAt: {
                type: Date,
                default: null
            },
            isIssued: {
                type: Boolean,
                default: false
            }
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

            verifiedBy: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "User",
                default: null
            },

            verifiedAt: {
                type: Date,
                default: null
            }
        },

        // Individual QR code identity
        qrToken: {
            type: String,
            unique: true,
            default: () => crypto.randomBytes(32).toString("hex")
        },

        // Attendance
        attendance: {
            isPresent: {
                type: Boolean,
                default: false
            },

            checkedInAt: {
                type: Date,
                default: null
            }
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

// A user can register only once for an event.
registrationSchema.index(
    { event: 1, user: 1 },
    {
        unique: true,
        partialFilterExpression: {
            user: { $type: "objectId" }
        }
    }
);

module.exports = mongoose.model("Registration", registrationSchema);
