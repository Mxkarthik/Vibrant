const express = require("express");

const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");
const upload = require("../middleware/uploadMiddleware");

const {
    uploadTeamPaymentProof
} = require("../controllers/teamRegistrationController");

const {
    updateTeamPaymentStatus
} = require("../controllers/teamRegistrationController");

const router = express.Router();

// Team leader: upload shared team payment proof
router.post(
    "/:id/payment-proof",
    protect,
    upload.single("screenshot"),
    uploadTeamPaymentProof
);

// Admin: verify or reject shared team payment
router.patch(
    "/:id/payment",
    protect,
    authorizeRoles("ADMIN"),
    updateTeamPaymentStatus
);

module.exports = router;