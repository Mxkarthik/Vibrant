
const Event = require("../models/Event");
const Registration = require("../models/Registration");
const Team = require("../models/Team");
const mongoose = require("mongoose");
const crypto = require("node:crypto");
const uploadToCloudinary = require("../utils/uploadToCloudinary");
const isValidImageFile = require("../utils/validateImageBuffer");
const { attachEventParticipantCounts } = require("../utils/eventParticipantCounts");
const { validateMultiEventAccess } = require("../utils/validateMultiEventAccess");
const { executeWithGraphCoordination } = require("../utils/eventGraphCoordinator");

const uploadEventPoster = async (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({ success: false, message: "Select a JPG, PNG or WEBP poster image" });
        }

        const bytes = file.buffer;
        if (!isValidImageFile(file)) {
            return res.status(400).json({ success: false, message: "The selected file is not a valid JPG, PNG or WEBP image" });
        }

        const uploaded = await uploadToCloudinary(bytes, "vibrant/event-posters");
        return res.status(201).json({ success: true, secureUrl: uploaded.secureUrl });
    } catch (error) {
        console.error("Event poster upload error:", error.message);
        return res.status(502).json({ success: false, message: "The event poster could not be uploaded. Please try again." });
    }
};

const uploadEventPaymentQr = async (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({ success: false, message: "Select a JPG, PNG or WEBP payment QR image" });
        }

        const bytes = file.buffer;
        if (!isValidImageFile(file)) {
            return res.status(400).json({ success: false, message: "The selected file is not a valid JPG, PNG or WEBP image" });
        }

        const uploaded = await uploadToCloudinary(bytes, "vibrant/event-payment-qrs");
        return res.status(201).json({ success: true, secureUrl: uploaded.secureUrl });
    } catch (error) {
        console.error("Event payment QR upload error:", error.message);
        return res.status(502).json({ success: false, message: "The event payment QR image could not be uploaded. Please try again." });
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
            paymentQrUrl,
            venue,
            startDate,
            endDate,
            registration,
            registrationFields = [],
            multiEventAccess
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

        // 4b. Validate Multi-Event Access configuration if provided
        let normalizedMultiEvent = { enabled: false, includedEvents: [] };
        if (multiEventAccess !== undefined) {
            const validation = await validateMultiEventAccess(multiEventAccess, {
                parentMode: registration.mode
            });
            if (!validation.isValid) {
                return res.status(400).json({
                    success: false,
                    message: validation.error
                });
            }
            normalizedMultiEvent = validation.value;
        }

        // 5. Create event (use graph coordination transaction if creating a combo)
        let event;
        if (normalizedMultiEvent.enabled) {
            event = await executeWithGraphCoordination(async (session) => {
                const validation = await validateMultiEventAccess(multiEventAccess, {
                    parentMode: registration.mode,
                    session
                });
                if (!validation.isValid) {
                    const err = new Error(validation.error);
                    err.statusCode = 400;
                    throw err;
                }

                const eventData = {
                    name,
                    description,
                    category,
                    poster,
                    paymentQrUrl,
                    venue,
                    startDate,
                    endDate,
                    registration: {
                        mode: registration.mode,
                        deadline: registration.deadline,
                        capacity: registration.capacity,
                        registrationFee: registration.registrationFee ?? 0,
                        minTeamSize: registration.mode === "TEAM" ? registration.minTeamSize : 1,
                        maxTeamSize: registration.mode === "TEAM" ? registration.maxTeamSize : 1,
                        allowDirectRegistration: registration.allowDirectRegistration ?? true,
                        registeredParticipants: 0
                    },
                    registrationFields: validatedFields,
                    multiEventAccess: validation.value,
                    createdBy: req.user._id,
                    status: "PUBLISHED"
                };

                const createdEvents = await Event.create([eventData], session ? { session } : {});
                const created = Array.isArray(createdEvents) ? createdEvents[0] : createdEvents;
                return created;
            });
        } else {
            event = await Event.create({
                name,
                description,
                category,
                poster,
                paymentQrUrl,
                venue,
                startDate,
                endDate,
                registration: {
                    mode: registration.mode,
                    deadline: registration.deadline,
                    capacity: registration.capacity,
                    registrationFee: registration.registrationFee ?? 0,
                    minTeamSize: registration.mode === "TEAM" ? registration.minTeamSize : 1,
                    maxTeamSize: registration.mode === "TEAM" ? registration.maxTeamSize : 1,
                    allowDirectRegistration: registration.allowDirectRegistration ?? true,
                    registeredParticipants: 0
                },
                registrationFields: validatedFields,
                multiEventAccess: normalizedMultiEvent,
                createdBy: req.user._id,
                status: "PUBLISHED"
            });
        }

        // 6. Success response
        return res.status(201).json({
            success: true,
            message: "Event created successfully",
            event
        });

    } catch (error) {

        console.error("Create event error:", error);

        if (error.statusCode) {
            return res.status(error.statusCode).json({
                success: false,
                code: error.code,
                message: error.message
            });
        }

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

        const [eventWithParticipantCount] = await attachEventParticipantCounts([event]);

        let includedEventDetails = [];
        if (
            eventWithParticipantCount?.multiEventAccess?.enabled &&
            Array.isArray(eventWithParticipantCount.multiEventAccess.includedEvents) &&
            eventWithParticipantCount.multiEventAccess.includedEvents.length > 0
        ) {
            includedEventDetails = await Event.find({
                _id: { $in: eventWithParticipantCount.multiEventAccess.includedEvents }
            })
                .select("name category venue startDate endDate status registration.mode registration.capacity")
                .lean();
        }

        const canonicalIncludedEvents = (eventWithParticipantCount?.multiEventAccess?.includedEvents || []).map(id =>
            id?._id ? id._id.toString() : id.toString()
        );

        const responseEvent = {
            ...eventWithParticipantCount,
            multiEventAccess: {
                enabled: Boolean(eventWithParticipantCount?.multiEventAccess?.enabled),
                includedEvents: canonicalIncludedEvents
            },
            includedEventDetails
        };

        return res.status(200).json({
            success: true,
            event: responseEvent
        });

    } catch (error) {
        console.error("Get event error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch event"
        });
    }
};


/**
 * Normalizes multiEventAccess configuration to canonical form for comparison:
 * - If disabled, null, or undefined: canonical form is { enabled: false, includedEvents: [] }
 * - If enabled: canonical form is { enabled: true, includedEvents: sorted unique lowercase hex string IDs }
 */
const normalizeMultiEventConfig = (config) => {
    if (!config || typeof config !== "object") {
        return { enabled: false, includedEvents: [] };
    }

    const enabled = Boolean(config.enabled);
    if (!enabled) {
        return { enabled: false, includedEvents: [] };
    }

    const rawList = Array.isArray(config.includedEvents) ? config.includedEvents : [];
    const uniqueIds = new Set();

    for (const item of rawList) {
        if (!item) continue;
        let idStr;
        if (typeof item === "object") {
            if (item._id) {
                idStr = item._id.toString();
            } else if (item.id) {
                idStr = item.id.toString();
            } else {
                idStr = item.toString();
            }
        } else {
            idStr = String(item);
        }

        idStr = idStr.trim().toLowerCase();
        if (idStr) {
            uniqueIds.add(idStr);
        }
    }

    return {
        enabled: true,
        includedEvents: Array.from(uniqueIds).sort()
    };
};

const areMultiEventConfigsEqual = (configA, configB) => {
    const a = normalizeMultiEventConfig(configA);
    const b = normalizeMultiEventConfig(configB);

    if (a.enabled !== b.enabled) {
        return false;
    }

    if (!a.enabled && !b.enabled) {
        return true;
    }

    if (a.includedEvents.length !== b.includedEvents.length) {
        return false;
    }

    return a.includedEvents.every((id, idx) => id === b.includedEvents[idx]);
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

        let event = await Event.findById(id);

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
            paymentQrUrl,
            venue,
            startDate,
            endDate,
            registration,
            multiEventAccess
        } = req.body;

        // Update only permitted basic fields
        if (name !== undefined) event.name = name;
        if (description !== undefined) event.description = description;
        if (category !== undefined) event.category = category;
        if (poster !== undefined) event.poster = poster;
        if (paymentQrUrl !== undefined) {
            if (paymentQrUrl !== null && (typeof paymentQrUrl !== "string" || !/^https:\/\//i.test(paymentQrUrl))) {
                return res.status(400).json({ success: false, message: "Payment QR image must be a secure HTTPS URL" });
            }
            event.paymentQrUrl = paymentQrUrl;
        }
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
                "registrationFee",
                "allowDirectRegistration"
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

        // Validate and apply Multi-Event Access configuration if provided
        if (multiEventAccess !== undefined) {
            // Compare canonical sets and enabled flag
            const isConfigChanged = !areMultiEventConfigsEqual(event.multiEventAccess, multiEventAccess);

            if (isConfigChanged) {
                // Real structural change: execute coordinated graph mutation inside transaction
                await executeWithGraphCoordination(async (session) => {
                    const evtQuery = Event.findById(id);
                    if (session && typeof evtQuery.session === "function") evtQuery.session(session);
                    const lockedEvent = await evtQuery;

                    if (!lockedEvent) {
                        const err = new Error("Event not found");
                        err.statusCode = 404;
                        throw err;
                    }

                    // Check again with freshly locked event document (concurrency protection)
                    if (areMultiEventConfigsEqual(lockedEvent.multiEventAccess, multiEventAccess)) {
                        // Concurrently resolved to same configuration: no-op for graph mutation
                        return;
                    }

                    const regCountQuery = Registration.countDocuments({ event: lockedEvent._id });
                    const teamCountQuery = Team.countDocuments({ event: lockedEvent._id });
                    if (session && typeof regCountQuery.session === "function") {
                        regCountQuery.session(session);
                    }
                    if (session && typeof teamCountQuery.session === "function") {
                        teamCountQuery.session(session);
                    }
                    const [registrationCount, teamCount] = await Promise.all([regCountQuery, teamCountQuery]);

                    if (registrationCount > 0 || teamCount > 0 || (lockedEvent.registration?.registeredParticipants ?? 0) > 0) {
                        const err = new Error("Cannot modify multi-event access configuration for an event with existing registrations or teams");
                        err.statusCode = 409;
                        err.code = "CANNOT_MODIFY_REGISTERED_COMBO";
                        throw err;
                    }

                    const validation = await validateMultiEventAccess(multiEventAccess, {
                        parentId: lockedEvent._id,
                        parentMode: lockedEvent.registration?.mode,
                        session
                    });

                    if (!validation.isValid) {
                        const err = new Error(validation.error);
                        err.statusCode = 400;
                        throw err;
                    }

                    if (name !== undefined) lockedEvent.name = name;
                    if (description !== undefined) lockedEvent.description = description;
                    if (category !== undefined) lockedEvent.category = category;
                    if (poster !== undefined) lockedEvent.poster = poster;
                    if (paymentQrUrl !== undefined) lockedEvent.paymentQrUrl = paymentQrUrl;
                    if (venue !== undefined) lockedEvent.venue = venue;
                    if (startDate !== undefined) lockedEvent.startDate = startDate;
                    if (endDate !== undefined) lockedEvent.endDate = endDate;

                    if (registration !== undefined) {
                        for (const field of allowedRegistrationFields) {
                            if (registration[field] !== undefined) {
                                lockedEvent.registration[field] = registration[field];
                            }
                        }
                    }

                    if (lockedEvent.registration.capacity < lockedEvent.registration.registeredParticipants) {
                        const err = new Error("Capacity cannot be lower than registered participants");
                        err.statusCode = 400;
                        throw err;
                    }

                    lockedEvent.multiEventAccess = validation.value;
                    await lockedEvent.save(session ? { session } : undefined);
                    event = lockedEvent;
                });
            } else {
                // Configuration is unchanged: safe no-op for multi-event access.
                // Save document with any updated basic/registration fields.
                await event.save();
            }
        } else {
            // Save and run Mongoose document validation for non-graph mutations
            await event.save();
        }

        return res.status(200).json({
            success: true,
            message: "Event updated successfully",
            event
        });

    } catch (error) {
        console.error("Update event error:", error);

        if (error.statusCode) {
            return res.status(error.statusCode).json({
                success: false,
                code: error.code,
                message: error.message
            });
        }

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

        let event = await Event.findById(id);

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

        let event = await Event.findById(id);

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
    createEvent, getAllEvents, getAllEventsWithFilters, getEventById, updateEvent, cancelEvent, completeEvent, uploadEventPoster, uploadEventPaymentQr,
    normalizeMultiEventConfig, areMultiEventConfigsEqual
};
