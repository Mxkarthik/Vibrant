const express = require("express");
const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");
const { getParticipantDashboard } = require("../controllers/participantController");

const router = express.Router();

router.get("/dashboard", protect, authorizeRoles("PARTICIPANT"), getParticipantDashboard);

module.exports = router;
