
const Event = require("../models/Event");

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

module.exports = {
    createEvent
};
