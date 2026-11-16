
const express = require("express");
const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");
const {registerForEvent} = require("../controllers/registrationController");
const { createEvent , getAllEvents,getAllEventsWithFilters , getEventById , updateEvent , cancelEvent , completeEvent } = require("../controllers/eventController");

const router = express.Router();

// Create event - ADMIN only
router.post(
    "/",
    protect,
    authorizeRoles("ADMIN"),
    createEvent
);

router.post(
    "/:id/register", 
    protect, 
    registerForEvent
);

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


module.exports = router;
