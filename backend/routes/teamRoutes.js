const express = require("express");

const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");
const paymentProofUpload = require("../middleware/paymentProofUpload");

const {
    uploadTeamPaymentProof
} = require("../controllers/teamRegistrationController");

const {
    updateTeamPaymentStatus
} = require("../controllers/teamRegistrationController");
const { getLeaderTeamById } = require("../controllers/teamRegistrationController");

const router = express.Router();

// Team leader: view their own team details
router.get("/:id", protect, authorizeRoles("PARTICIPANT"), getLeaderTeamById);

// Team leader: upload shared team payment proof
router.post(
    "/:id/payment-proof",
    protect,
    authorizeRoles("PARTICIPANT"),
    paymentProofUpload,
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
