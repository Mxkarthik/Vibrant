
const express = require("express");

const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");

const {
    getMyRegistrations,
    getRegistrationById,
    updatePaymentStatus,
    markAttendance
} = require("../controllers/registrationController");

const router = express.Router();

const {
    downloadCertificate
} = require("../controllers/registrationController");

// Participant: view own registrations
router.get("/my", protect, getMyRegistrations);

router.post(
    "/attendance",
    protect,
    authorizeRoles("ADMIN", "ORGANISER"),
    markAttendance
);

// Admin: verify or reject payment
router.patch(
    "/:id/payment",
    protect,
    authorizeRoles("ADMIN"),
    updatePaymentStatus
);

router.get(
    "/certificate/:certificateId/download",
    downloadCertificate
);

// Participant, admin or assigned organiser: view registration
router.get("/:id", protect, getRegistrationById);

module.exports = router;
