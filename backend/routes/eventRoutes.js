
const express = require("express");
const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");
const {registerForEvent} = require("../controllers/registrationController");
const { createEvent , getAllEvents,getAllEventsWithFilters , getEventById , updateEvent , cancelEvent , completeEvent } = require("../controllers/eventController");
const {
    getEventParticipants,getEventAttendanceReport,exportEventParticipants
} = require("../controllers/registrationController");
const router = express.Router();
const { registerTeam } = require("../controllers/teamRegistrationController");
const {
    issueEventCertificates
} = require("../controllers/registrationController");

// Create event - ADMIN only
router.post(
    "/",
    protect,
    authorizeRoles("ADMIN"),
    createEvent
);

router.post(
    "/:id/certificates/issue",
    protect,
    authorizeRoles("ADMIN"),
    issueEventCertificates
);

router.get(
    "/:id/export",
    protect,
    authorizeRoles("ADMIN", "ORGANISER"),
    exportEventParticipants
);

router.post("/:id/register", protect, registerForEvent);

router.get(
    "/filtered",
    protect,
    getAllEventsWithFilters
);

// Get all published events
router.get(
    "/",
    protect,
    getAllEvents,
);

// Get event by ID
router.get(
    "/:id",
    protect,
    getEventById
);

router.get("/test", (req, res) => {
    res.status(200).json({
        success: true,
        message: "Event routes are working!"
    });
});

// Update event - ADMIN only
router.patch(
    "/:id",
    protect,
    authorizeRoles("ADMIN"),
    updateEvent
);


// Cancel event - ADMIN only
router.patch(
    "/:id/cancel",
    protect,
    authorizeRoles("ADMIN"),
    cancelEvent
);

router.patch(
    "/:id/complete",
    protect,
    authorizeRoles("ADMIN"),
    completeEvent
);

// Attandence report
router.get(
    "/:id/attendance",
    protect,
    authorizeRoles("ADMIN", "ORGANISER"),
    getEventAttendanceReport
);

router.post("/:id/register-team", protect, registerTeam);

router.get("/:id/participants", protect, getEventParticipants);


module.exports = router;
