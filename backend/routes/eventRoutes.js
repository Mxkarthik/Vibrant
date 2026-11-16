
const express = require("express");

const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");

const { createEvent } = require("../controllers/eventController");

const router = express.Router();

// Create event - ADMIN only
router.post(
    "/",
    protect,
    authorizeRoles("ADMIN"),
    createEvent
);

module.exports = router;
