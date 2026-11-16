const express = require("express");

const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");

const {
    updateTeamPaymentStatus
} = require("../controllers/teamRegistrationController");

const router = express.Router();

// Admin: verify or reject shared team payment
router.patch(
    "/:id/payment",
    protect,
    authorizeRoles("ADMIN"),
    updateTeamPaymentStatus
);

module.exports = router;