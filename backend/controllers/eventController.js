
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


module.exports = {
    createEvent,getAllEvents , getEventById
};
