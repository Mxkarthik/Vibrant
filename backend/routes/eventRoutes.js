
const express = require("express");
const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");
const authorizeParticipantPortal = require("../middleware/authorizeParticipantPortal");
const upload = require("../middleware/uploadMiddleware");
const paymentProofUpload = require("../middleware/paymentProofUpload");
const {registerForEvent} = require("../controllers/registrationController");
const { createEvent , getAllEvents,getAllEventsWithFilters , getEventById , updateEvent , cancelEvent , completeEvent, uploadEventPoster, uploadEventPaymentQr } = require("../controllers/eventController");
const {
    getEventParticipants,getEventAttendanceReport,exportEventParticipants
} = require("../controllers/registrationController");
const router = express.Router();
const parseEventPoster = (req, res, next) => {
    upload.single("poster")(req, res, error => {
        if (!error) return next();
        const message = error.code === "LIMIT_FILE_SIZE"
            ? "Poster images must be 5 MB or smaller"
            : error.message === "Only JPG, PNG and WEBP images are allowed"
                ? error.message
                : "The poster image could not be read";
        return res.status(400).json({ success: false, message });
    });
};
const parseEventPaymentQr = (req, res, next) => {
    upload.single("paymentQr")(req, res, error => {
        if (!error) return next();
        const message = error.code === "LIMIT_FILE_SIZE"
            ? "Payment QR images must be 5 MB or smaller"
            : error.message === "Only JPG, PNG and WEBP images are allowed"
                ? error.message
                : "The payment QR image could not be read";
        return res.status(400).json({ success: false, message });
    });
};
const { registerTeam } = require("../controllers/teamRegistrationController");
const {
    issueEventCertificates
} = require("../controllers/registrationController");

// Create event - ADMIN only
router.post(
    "/poster",
    protect,
    authorizeRoles("ADMIN"),
    parseEventPoster,
    uploadEventPoster
);

router.post(
    "/payment-qr",
    protect,
    authorizeRoles("ADMIN"),
    parseEventPaymentQr,
    uploadEventPaymentQr
);

router.post(
    "/",
    protect,
    authorizeRoles("ADMIN"),
    createEvent
);

router.post(
    "/:id/certificates/issue",
    protect,
    authorizeRoles("ADMIN"),
    issueEventCertificates
);

router.get(
    "/:id/export",
    protect,
    authorizeRoles("ADMIN", "ORGANISER"),
    exportEventParticipants
);

router.post("/:id/register", protect, authorizeParticipantPortal, paymentProofUpload, registerForEvent);

router.get(
    "/filtered",
    protect,
    getAllEventsWithFilters
);

// Get all published events
router.get(
    "/",
    protect,
    getAllEvents,
);

router.get("/test", (req, res) => {
    res.status(200).json({
        success: true,
        message: "Event routes are working!"
    });
});

// Get event by ID
router.get(
    "/:id",
    protect,
    getEventById
);

// Update event - ADMIN only
router.patch(
    "/:id",
    protect,
    authorizeRoles("ADMIN"),
    updateEvent
);


// Cancel event - ADMIN only
router.patch(
    "/:id/cancel",
    protect,
    authorizeRoles("ADMIN"),
    cancelEvent
);

router.patch(
    "/:id/complete",
    protect,
    authorizeRoles("ADMIN"),
    completeEvent
);

// Attandence report
router.get(
    "/:id/attendance",
    protect,
    authorizeRoles("ADMIN", "ORGANISER"),
    getEventAttendanceReport
);

router.post("/:id/register-team", protect, authorizeParticipantPortal, paymentProofUpload, registerTeam);

router.get("/:id/participants", protect, getEventParticipants);


module.exports = router;
