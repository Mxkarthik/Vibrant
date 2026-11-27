const express = require("express");
const protect = require("../middleware/authMiddleware");
const authorizeParticipantPortal = require("../middleware/authorizeParticipantPortal");
const authorizeRoles = require("../middleware/roleMiddleware");
const { getParticipantDashboard } = require("../controllers/participantController");
const { getDomainStatus, drawDomain, getMyTheme, getDomainBank } = require("../controllers/participantDomainController");

const router = express.Router();

function noStore(_req, res, next) {
    res.set("Cache-Control", "no-store");
    next();
}

function requireTrustedCookieOrigin(req, res, next) {
    // Match protect's credential priority. A Bearer header does not override a cookie.
    const origin = req.get("Origin");
    if (req.cookies?.vibrant_token && (!origin || !req.app.get("trustedFrontendOrigins")?.includes(origin))) {
        return res.status(403).json({ success: false, code: "ORIGIN_NOT_ALLOWED", message: "A trusted Origin is required for cookie authentication." });
    }
    return next();
}

router.get("/dashboard", protect, authorizeParticipantPortal, getParticipantDashboard);
router.get("/events/:eventId/domains/status", noStore, protect, authorizeRoles("PARTICIPANT", "ADMIN"), getDomainStatus);
router.get("/events/:eventId/domains/my-theme", noStore, protect, authorizeRoles("PARTICIPANT", "ADMIN"), getMyTheme);
router.get("/events/:eventId/domains", noStore, protect, authorizeRoles("PARTICIPANT", "ADMIN"), getDomainBank);
router.post("/events/:eventId/domains/draw", noStore, protect, authorizeRoles("PARTICIPANT", "ADMIN"), requireTrustedCookieOrigin, drawDomain);

module.exports = router;
