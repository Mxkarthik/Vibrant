
const mongoose = require("mongoose");

const eventSchema = new mongoose.Schema(
    {
        // Basic information
        name: {
            type: String,
            required: true,
            trim: true
        },

        description: {
            type: String,
            required: true,
            trim: true
        },

        category: {
            type: String,
            enum: [
                "TECHNICAL",
                "CULTURAL",
                "SPORTS",
                "WORKSHOP",
                "COMPETITION"
            ],
            required: true
        },

        poster: {
            type: String,
            default: null
        },

        paymentQrUrl: {
            type: String,
            default: null,
            validate: {
                validator: value => value == null || /^https:\/\//i.test(value),
                message: "Payment QR image must use a secure HTTPS URL"
            }
        },

        venue: {
            type: String,
            required: true,
            trim: true
        },

        // Schedule
        startDate: {
            type: Date,
            required: true
        },

        endDate: {
            type: Date,
            required: true
        },

        // Registration configuration
        registration: {
            mode: {
                type: String,
                enum: ["INDIVIDUAL", "TEAM"],
                required: true
            },
            registeredParticipants: {
                type: Number,
                default: 0,
                min: 0
            },
            deadline: {
                type: Date,
                required: true
            },

            capacity: {
                type: Number,
                required: true,
                min: 1
            },

            registrationFee: {
                type: Number,
                default: 0,
                min: 0
            },

            minTeamSize: {
                type: Number,
                default: 1,
                min: 1
            },

            maxTeamSize: {
                type: Number,
                default: 1,
                min: 1
            },

            allowDirectRegistration: {
                type: Boolean,
                default: true
            }
        },

        registrationFields: [
        {
            fieldId: {
                type: String,
                required: true
            },

            label: {
                type: String,
                required: true,
                trim: true
            },

            fieldKey: {
                type: String,
                required: true,
                trim: true
            },

            fieldType: {
                type: String,
                enum: [
                    "TEXT",
                    "TEXTAREA",
                    "NUMBER",
                    "DROPDOWN",
                    "RADIO",
                    "CHECKBOX",
                    "DATE",
                    "URL"
                ],
            required: true
            },

            required: {
                type: Boolean,
                default: false
            },

            options: {
                type: [String],
                default: []
            },

            order: {
                type: Number,
                default: 0
            }
        }
        ],

        // Event status
        status: {
            type: String,
            enum: ["PUBLISHED", "CANCELLED", "COMPLETED"],
            default: "PUBLISHED"
        },

        // Event ownership
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },

        organizers: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "User"
            }
        ],

        // Multi-Event Access configuration (Phase 01)
        multiEventAccess: {
            enabled: {
                type: Boolean,
                default: false
            },
            includedEvents: [
                {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: "Event"
                }
            ]
        },

        // Hackathon domain pool lifecycle. Publication and draw are separate states.
        // Mutating a published pool and enforcing lifecycle transitions require services.
        domainConfig: {
            enabled: { type: Boolean, default: false },
            visibility: {
                type: String,
                // PUBLIC is retained for compatibility with the Phase 01 enum.
                // New lifecycle transitions use PRIVATE until the draw is closed,
                // then READABLE. No participant route reads legacy PUBLIC values.
                enum: ["PRIVATE", "PUBLIC", "READABLE"],
                default: "PRIVATE"
            },
            drawStatus: {
                type: String,
                enum: ["CLOSED", "OPEN"],
                default: "CLOSED"
            },
            publishedAt: { type: Date, default: null },
            publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
            drawOpenedAt: { type: Date, default: null },
            drawClosedAt: { type: Date, default: null },
            readEnabledAt: { type: Date, default: null },
            readEnabledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
            // Last frozen version. Clearing the active publication does not rewind it.
            poolVersion: { type: Number, min: 0, default: 0 },
            revisionPending: { type: Boolean, default: false }
        }
    },
    {
        timestamps: true
    }
);


eventSchema.pre("validate", function () {
    if (this.domainConfig?.drawStatus === "OPEN" &&
        (this.domainConfig.enabled !== true || this.domainConfig.visibility === "READABLE" || !this.domainConfig.publishedAt)) {
        this.invalidate("domainConfig.drawStatus", "Domain draw requires an enabled feature and a published pool that is not read-enabled");
    }

    // 1. Validate event dates
    if (this.startDate && this.endDate) {
        if (this.endDate < this.startDate) {
            this.invalidate(
                "endDate",
                "Event end date cannot be before start date"
            );
        }
    }

    // 2. Validate registration deadline
    if (
        this.registration?.deadline &&
        this.startDate &&
        this.registration.deadline >= this.startDate
    ) {
        this.invalidate(
            "registration.deadline",
            "Registration deadline must be before the event starts"
        );
    }

    // 3. Validate team sizes
    if (this.registration?.mode === "TEAM") {
        if (
            this.registration.minTeamSize >
            this.registration.maxTeamSize
        ) {
            this.invalidate(
                "registration.maxTeamSize",
                "Maximum team size cannot be less than minimum team size"
            );
        }

        if (
            this.registration.capacity <
            this.registration.minTeamSize
        ) {
            this.invalidate(
                "registration.capacity",
                "Capacity must accommodate at least one complete team"
            );
        }
    }

    // 4. Individual registration must have team sizes of 1
    if (this.registration?.mode === "INDIVIDUAL") {
        if (
            this.registration.minTeamSize !== 1 ||
            this.registration.maxTeamSize !== 1
        ) {
            this.invalidate(
                "registration.minTeamSize",
                "Individual events must have team sizes of 1"
            );
        }
    }
});
module.exports = mongoose.model("Event", eventSchema);
