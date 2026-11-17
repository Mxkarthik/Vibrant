const express = require("express");

const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");
const authorizeParticipantPortal = require("../middleware/authorizeParticipantPortal");
const paymentProofUpload = require("../middleware/paymentProofUpload");

const {
    uploadTeamPaymentProof
} = require("../controllers/teamRegistrationController");

const {
    updateTeamPaymentStatus
} = require("../controllers/teamRegistrationController");
const { getLeaderTeamById, getLeaderTeamTickets } = require("../controllers/teamRegistrationController");

const router = express.Router();

// Team leader: view their own team details
router.get("/:id", protect, authorizeParticipantPortal, getLeaderTeamById);
router.get("/:id/tickets", protect, authorizeParticipantPortal, getLeaderTeamTickets);

// Team leader: upload shared team payment proof
router.post(
    "/:id/payment-proof",
    protect,
    authorizeParticipantPortal,
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
