
const Event = require("../models/Event");
const mongoose = require("mongoose");
// @desc    Create a new event
// @route   POST /api/events
// @access  ADMIN only

const createEvent = async (req, res) => {
    try {
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

        // Create event
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
                registrationFee: registration.registrationFee ?? 0,
                minTeamSize: registration.mode === "TEAM"
                    ? registration.minTeamSize
                    : 1,
                maxTeamSize: registration.mode === "TEAM"
                    ? registration.maxTeamSize
                    : 1,

        // Always controlled by the backend
        registeredParticipants: 0
    },

    createdBy: req.user._id,
    status: "PUBLISHED"
});

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

        // Participants can only view published events.
        // Admins can also view cancelled or completed events.
        if (
            event.status !== "PUBLISHED" &&
            req.user.role !== "ADMIN"
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

const getAllEvents = async (req, res) => {
    try {
        const {
            search,
            category,
            page = 1,
            limit = 10
        } = req.query;

        // Validate pagination
        const pageNumber = Number(page);
        const limitNumber = Number(limit);

        if (
            !Number.isInteger(pageNumber) ||
            !Number.isInteger(limitNumber) ||
            pageNumber < 1 ||
            limitNumber < 1 ||
            limitNumber > 50
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid pagination parameters"
            });
        }

        const filter = {
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

            filter.category = category;
        }

        // Search by event name
        if (search && search.trim()) {
            const escapedSearch = search.trim().replace(
                /[.*+?^${}()|[\]\\]/g,
                "\\$&"
            );

            filter.name = {
                $regex: escapedSearch,
                $options: "i"
            };
        }

        const skip = (pageNumber - 1) * limitNumber;

        const [events, totalEvents] = await Promise.all([
            Event.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limitNumber)
                .populate("createdBy", "name")
                .lean(),

            Event.countDocuments(filter)
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
        console.error("Get events error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch events"
        });
    }
};

module.exports = {
    createEvent,getAllEvents , getEventById , updateEvent , cancelEvent
};
