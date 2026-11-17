const express = require("express");
const protect = require("../middleware/authMiddleware");
const authorizeParticipantPortal = require("../middleware/authorizeParticipantPortal");
const { getParticipantDashboard } = require("../controllers/participantController");

const router = express.Router();

router.get("/dashboard", protect, authorizeParticipantPortal, getParticipantDashboard);

module.exports = router;
