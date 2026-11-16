
const express = require("express");

const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");

const {
    getMyRegistrations,
    getRegistrationById,
    updatePaymentStatus
} = require("../controllers/registrationController");

const router = express.Router();

// Participant: view own registrations
router.get("/my", protect, getMyRegistrations);

// Admin: verify or reject payment
router.patch(
    "/:id/payment",
    protect,
    authorizeRoles("ADMIN"),
    updatePaymentStatus
);

// Participant, admin or assigned organiser: view registration
router.get("/:id", protect, getRegistrationById);

module.exports = router;
