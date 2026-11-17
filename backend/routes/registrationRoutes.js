
const express = require("express");

const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");
const authorizeParticipantPortal = require("../middleware/authorizeParticipantPortal");

const {
    getMyRegistrations,
    getMyRegistrationTicket,
    getRegistrationById,
    updatePaymentStatus,
    markAttendance,
    uploadRegistrationPaymentProof
} = require("../controllers/registrationController");

const router = express.Router();

const paymentProofUpload = require("../middleware/paymentProofUpload");

const {
    downloadCertificate
} = require("../controllers/registrationController");

// Participant: view own registrations
router.get("/my", protect, authorizeParticipantPortal, getMyRegistrations);

// A ticket token is returned only to the authenticated owner of an individual registration.
router.get("/:id/ticket", protect, authorizeParticipantPortal, getMyRegistrationTicket);

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

// Participant: upload individual UPI payment proof
router.post(
    "/:id/payment-proof",
    protect,
    authorizeParticipantPortal,
    paymentProofUpload,
    uploadRegistrationPaymentProof
);

// Participant, admin or assigned organiser: view registration
router.get("/:id", protect, authorizeParticipantPortal, getRegistrationById);

module.exports = router;
