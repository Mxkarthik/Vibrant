
const Event = require("../models/Event");
const mongoose = require("mongoose");
const crypto = require("node:crypto");
const uploadToCloudinary = require("../utils/uploadToCloudinary");

const uploadEventPoster = async (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({ success: false, message: "Select a JPG, PNG or WEBP poster image" });
        }

        const bytes = file.buffer;
        const isJpeg = file.mimetype === "image/jpeg" && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
        const isPng = file.mimetype === "image/png" && bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        const isWebp = file.mimetype === "image/webp" && bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
        if (!isJpeg && !isPng && !isWebp) {
            return res.status(400).json({ success: false, message: "The selected file is not a valid JPG, PNG or WEBP image" });
        }

        const uploaded = await uploadToCloudinary(bytes, "vibrant/event-posters");
        return res.status(201).json({ success: true, secureUrl: uploaded.secureUrl });
    } catch (error) {
        console.error("Event poster upload error:", error.message);
        return res.status(502).json({ success: false, message: "The event poster could not be uploaded. Please try again." });
    }
};

// @desc    Create a new event
// @route   POST /api/events
// @access  ADMIN only




const createEvent = async (req, res) => {
    try {
        // 1. Validate request body
        if (
            !req.body ||
            typeof req.body !== "object" ||
            Array.isArray(req.body)
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid request body"
            });
        }

        // 2. Extract event details
        const {
            name,
            description,
            category,
            poster,
            venue,
            startDate,
            endDate,
            registration,
            registrationFields = []
        } = req.body;

        // 3. Validate registration configuration
        if (
            !registration ||
            typeof registration !== "object" ||
            Array.isArray(registration)
        ) {
            return res.status(400).json({
                success: false,
                message: "Registration configuration is required"
            });
        }

        // 4. Validate registration fields
        if (!Array.isArray(registrationFields)) {
            return res.status(400).json({
                success: false,
                message: "Registration fields must be an array"
            });
        }

        const allowedFieldTypes = [
            "TEXT",
            "TEXTAREA",
            "NUMBER",
            "DROPDOWN",
            "RADIO",
            "CHECKBOX",
            "DATE",
            "URL"
        ];

        const usedFieldKeys = new Set();

        const validatedFields = [];

        for (const field of registrationFields) {

            // Ensure each field is an object
            if (
                !field ||
                typeof field !== "object" ||
                Array.isArray(field)
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid registration field"
                });
            }

            const label =
                typeof field.label === "string"
                    ? field.label.trim()
                    : "";

            const fieldKey =
                typeof field.fieldKey === "string"
                    ? field.fieldKey.trim()
                    : "";

            const fieldType = field.fieldType;

            // Validate label and field key
            if (!label || !fieldKey) {
                return res.status(400).json({
                    success: false,
                    message: "Field label and field key are required"
                });
            }

            // Validate field key format
            if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(fieldKey)) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid field key: ${fieldKey}`
                });
            }

            // Validate field type
            if (!allowedFieldTypes.includes(fieldType)) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid field type for ${label}`
                });
            }

            // Prevent duplicate field keys
            const normalizedKey = fieldKey.toLowerCase();

            if (usedFieldKeys.has(normalizedKey)) {
                return res.status(400).json({
                    success: false,
                    message: `Duplicate field key: ${fieldKey}`
                });
            }

            usedFieldKeys.add(normalizedKey);

            // Validate options
            let options = [];

            if (
                ["DROPDOWN", "RADIO", "CHECKBOX"].includes(fieldType)
            ) {
                if (
                    !Array.isArray(field.options) ||
                    field.options.length === 0
                ) {
                    return res.status(400).json({
                        success: false,
                        message: `${label} requires options`
                    });
                }

                options = field.options.map(option =>
                    typeof option === "string" ? option.trim() : ""
                );

                if (options.some(option => !option)) {
                    return res.status(400).json({
                        success: false,
                        message: `Invalid options for ${label}`
                    });
                }

                if (new Set(options).size !== options.length) {
                    return res.status(400).json({
                        success: false,
                        message: `Duplicate options in ${label}`
                    });
                }
            }

            // Build trusted field configuration
            validatedFields.push({
                fieldId: crypto.randomUUID(),
                label,
                fieldKey,
                fieldType,
                required: field.required === true,
                options,
                order: Number.isInteger(field.order)
                    ? field.order
                    : validatedFields.length
            });
        }

        // 5. Create event
        const event = await Event.create({
            name,
            description,
            category,
            poster,
            venue,
            startDate,
            endDate,

            registration: {
                mode: registration.mode,
                deadline: registration.deadline,
                capacity: registration.capacity,

                registrationFee:
                    registration.registrationFee ?? 0,

                minTeamSize:
                    registration.mode === "TEAM"
                        ? registration.minTeamSize
                        : 1,

                maxTeamSize:
                    registration.mode === "TEAM"
                        ? registration.maxTeamSize
                        : 1,

                registeredParticipants: 0
            },

            registrationFields: validatedFields,

            // Controlled by backend
            createdBy: req.user._id,
            status: "PUBLISHED"
        });

        // 6. Success response
        return res.status(201).json({
            success: true,
            message: "Event created successfully",
            event
        });

    } catch (error) {

        console.error("Create event error:", error);

        if (error.name === "ValidationError") {
            return res.status(400).json({
                success: false,
                message: "Event validation failed",
                errors: Object.values(error.errors).map(
                    err => err.message
                )
            });
        }

        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: "Duplicate data detected"
            });
        }

        return res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
};


// @desc    Get all published events
// @route   GET /api/events
// @access  Authenticated users

const getAllEvents = async (req, res) => {
    try {
        const events = await Event.find({
            status: "PUBLISHED"
        })
        .populate("createdBy", "name email")
        .populate("organizers", "name email")
        .sort({ createdAt: -1 });

        return res.status(200).json({
            success: true,
            count: events.length,
            events
        });

    } catch (error) {
        console.error("Get events error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch events"
        });
    }
};




// @desc    Get a single event by ID
// @route   GET /api/events/:id
// @access  Authenticated users

const getEventById = async (req, res) => {
    try {
        const { id } = req.params;

        // Check whether the ID is valid
        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid event ID"
            });
        }

        // Find event
        const event = await Event.findById(id)
            .populate("createdBy", "name email")
            .populate("organizers", "name email");

        if (!event) {
            return res.status(404).json({
                success: false,
                message: "Event not found"
            });
        }

        // Participants can only view published events. Admins and global
        // organisers can also view cancelled or completed events.
        if (
            event.status !== "PUBLISHED" &&
            !["ADMIN", "ORGANISER"].includes(req.user.role)
        ) {
            return res.status(404).json({
                success: false,
                message: "Event not found"
            });
        }

        return res.status(200).json({
            success: true,
            event
        });

    } catch (error) {
        console.error("Get event error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch event"
        });
    }
};


const updateEvent = async (req, res) => {
    try {
        const { id } = req.params;

        // Validate MongoDB ObjectId
        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid event ID"
            });
        }

        const event = await Event.findById(id);

        if (!event) {
            return res.status(404).json({
                success: false,
                message: "Event not found"
            });
        }

        const {
            name,
            description,
            category,
            poster,
            venue,
            startDate,
            endDate,
            registration
        } = req.body;

        // Update only permitted basic fields
        if (name !== undefined) event.name = name;
        if (description !== undefined) event.description = description;
        if (category !== undefined) event.category = category;
        if (poster !== undefined) event.poster = poster;
        if (venue !== undefined) event.venue = venue;
        if (startDate !== undefined) event.startDate = startDate;
        if (endDate !== undefined) event.endDate = endDate;

        // Update permitted registration settings
        if (registration !== undefined) {
            if (
                typeof registration !== "object" ||
                registration === null ||
                Array.isArray(registration)
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid registration configuration"
                });
            }

            const allowedRegistrationFields = [
                "deadline",
                "capacity",
                "registrationFee"
            ];

            for (const field of allowedRegistrationFields) {
                if (registration[field] !== undefined) {
                    event.registration[field] = registration[field];
                }
            }
        }

        // Capacity cannot be lower than existing registrations
        if (
            event.registration.capacity <
            event.registration.registeredParticipants
        ) {
            return res.status(400).json({
                success: false,
                message: "Capacity cannot be lower than registered participants"
            });
        }

        // Save and run Mongoose document validation
        await event.save();

        return res.status(200).json({
            success: true,
            message: "Event updated successfully",
            event
        });

    } catch (error) {
        console.error("Update event error:", error);

        if (error.name === "ValidationError") {
            return res.status(400).json({
                success: false,
                message: "Event validation failed",
                errors: Object.values(error.errors).map(
                    err => err.message
                )
            });
        }

        return res.status(500).json({
            success: false,
            message: "Failed to update event"
        });
    }
};


const cancelEvent = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid event ID"
            });
        }

        const event = await Event.findById(id);

        if (!event) {
            return res.status(404).json({
                success: false,
                message: "Event not found"
            });
        }

        if (event.status === "CANCELLED") {
            return res.status(409).json({
                success: false,
                message: "Event is already cancelled"
            });
        }

        if (event.status === "COMPLETED") {
            return res.status(409).json({
                success: false,
                message: "Completed events cannot be cancelled"
            });
        }

        event.status = "CANCELLED";

        await event.save();

        return res.status(200).json({
            success: true,
            message: "Event cancelled successfully",
            event
        });

    } catch (error) {
        console.error("Cancel event error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to cancel event"
        });
    }
};


const getAllEventsWithFilters = async (req, res) => {
    try {
        const {
            search,
            category,
            page = "1",
            limit = "10",
            filter: availabilityFilter,
            sortBy = "latest"
        } = req.query;

        if (
            (search !== undefined && (typeof search !== "string" || search.length > 120)) ||
            (category !== undefined && typeof category !== "string") ||
            (availabilityFilter !== undefined && typeof availabilityFilter !== "string") ||
            typeof sortBy !== "string" ||
            typeof page !== "string" ||
            typeof limit !== "string" ||
            !/^\d+$/.test(page) ||
            !/^\d+$/.test(limit)
        ) {
            return res.status(400).json({ success: false, message: "Invalid event query parameters" });
        }

        // Validate pagination
        const pageNumber = Number(page);
        const limitNumber = Number(limit);

        if (
            !Number.isSafeInteger(pageNumber) ||
            !Number.isSafeInteger(limitNumber) ||
            pageNumber < 1 ||
            limitNumber < 1 ||
            limitNumber > 50
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid pagination parameters"
            });
        }

        const eventFilter = {
            status: "PUBLISHED"
        };

        // Category filter
        if (category) {
            const allowedCategories = [
                "TECHNICAL",
                "CULTURAL",
                "SPORTS",
                "WORKSHOP",
                "COMPETITION"
            ];

            if (!allowedCategories.includes(category)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid event category"
                });
            }

            eventFilter.category = category;
        }

        // Search event name, description, or category.
        if (search && search.trim()) {
            const escapedSearch = search.trim().replace(
                /[.*+?^${}()|[\]\\]/g,
                "\\$&"
            );

            const searchExpression = {
                $regex: escapedSearch,
                $options: "i"
            };
            eventFilter.$or = [
                { name: searchExpression },
                { description: searchExpression },
                { category: searchExpression }
            ];
        }

        const now = new Date();
        const allowedFilters = ["upcoming", "open", "closing-soon", "free", "paid"];
        if (availabilityFilter && !allowedFilters.includes(availabilityFilter)) {
            return res.status(400).json({ success: false, message: "Invalid event filter" });
        }
        if (availabilityFilter === "upcoming") {
            eventFilter.endDate = { $gte: now };
        } else if (availabilityFilter === "open") {
            eventFilter["registration.deadline"] = { $gt: now };
            eventFilter.$expr = { $lt: ["$registration.registeredParticipants", "$registration.capacity"] };
        } else if (availabilityFilter === "closing-soon") {
            eventFilter["registration.deadline"] = { $gt: now, $lte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) };
            eventFilter.$expr = { $lt: ["$registration.registeredParticipants", "$registration.capacity"] };
        } else if (availabilityFilter === "free") {
            eventFilter["registration.registrationFee"] = 0;
        } else if (availabilityFilter === "paid") {
            eventFilter["registration.registrationFee"] = { $gt: 0 };
        }

        const allowedSorts = ["upcoming", "latest", "name"];
        if (!allowedSorts.includes(sortBy)) {
            return res.status(400).json({ success: false, message: "Invalid event sort order" });
        }

        const skip = (pageNumber - 1) * limitNumber;

        const [events, totalEvents] = await Promise.all([
            sortBy === "upcoming"
                ? Event.aggregate([
                    { $match: eventFilter },
                    { $addFields: { _isUpcoming: { $gte: ["$endDate", now] } } },
                    { $sort: { _isUpcoming: -1, startDate: 1, createdAt: -1 } },
                    { $skip: skip },
                    { $limit: limitNumber },
                    { $project: { _isUpcoming: 0 } }
                ]).then(events => Event.populate(events, { path: "createdBy", select: "name" }))
                : Event.find(eventFilter)
                    .sort(sortBy === "name" ? { name: 1, _id: 1 } : { createdAt: -1 })
                    .skip(skip)
                    .limit(limitNumber)
                    .populate("createdBy", "name")
                    .lean(),

            Event.countDocuments(eventFilter)
        ]);

        return res.status(200).json({
            success: true,
            pagination: {
                totalEvents,
                currentPage: pageNumber,
                totalPages: Math.ceil(totalEvents / limitNumber),
                limit: limitNumber,
                hasNextPage: skip + events.length < totalEvents,
                hasPreviousPage: pageNumber > 1
            },
            events
        });

    } catch (error) {
        console.error("Get filtered events error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch events"
        });
    }
};

const completeEvent = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid event ID"
            });
        }

        const event = await Event.findById(id);

        if (!event) {
            return res.status(404).json({
                success: false,
                message: "Event not found"
            });
        }

        if (event.status === "CANCELLED") {
            return res.status(409).json({
                success: false,
                message: "Cancelled events cannot be completed"
            });
        }

        if (event.status === "COMPLETED") {
            return res.status(409).json({
                success: false,
                message: "Event is already completed"
            });
        }

        event.status = "COMPLETED";

        await event.save();

        return res.status(200).json({
            success: true,
            message: "Event marked as completed",
            event
        });

    } catch (error) {
        console.error("Complete event error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to complete event"
        });
    }
};


module.exports = {
    createEvent, getAllEvents, getAllEventsWithFilters, getEventById, updateEvent, cancelEvent, completeEvent, uploadEventPoster
};
