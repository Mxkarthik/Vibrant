
const express = require("express");
const passport = require("passport");
const generateToken = require("../utils/generateToken");
const protect = require("../middleware/authMiddleware");
const router = express.Router();
const authorizeRoles = require("../middleware/roleMiddleware");
const authorizeParticipantPortal = require("../middleware/authorizeParticipantPortal");
const { resolveAdminFrontendUrl } = require("../utils/adminFrontendUrl");

const adminFrontendUrl = resolveAdminFrontendUrl();

/**
 * Resolves the Participant Frontend URL.
 * In production (NODE_ENV === "production"):
 *   - Uses PARTICIPANT_FRONTEND_URL if set and does not point to localhost.
 *   - Defaults to the production Vercel deployment: https://dietvibrant.vercel.app.
 * In development:
 *   - Uses PARTICIPANT_FRONTEND_URL or defaults to http://localhost:5174.
 */
const getParticipantFrontendUrl = () => {
    const raw = process.env.PARTICIPANT_FRONTEND_URL?.split(",")[0]?.trim();
    const isProduction = process.env.NODE_ENV === "production";

    if (raw && (!isProduction || !raw.includes("localhost"))) {
        return raw.replace(/\/+$/, "");
    }

    if (isProduction) {
        return "https://dietvibrant.vercel.app";
    }

    return (raw || "http://localhost:5174").replace(/\/+$/, "");
};

const isProduction = process.env.NODE_ENV === "production";
const cookieSameSite = (process.env.AUTH_COOKIE_SAME_SITE || (isProduction ? "none" : "lax")).toLowerCase();
const authCookieOptions = {
    httpOnly: true,
    secure: isProduction || cookieSameSite === "none",
    sameSite: cookieSameSite,
    ...(process.env.AUTH_COOKIE_DOMAIN ? { domain: process.env.AUTH_COOKIE_DOMAIN } : {}),
    path: "/"
};

// ==========================================
// 1. Start Google OAuth
// ==========================================

const setAuthPortal = (portal) => (req, res, next) => {
    if (req.session) {
        req.session.authPortal = portal;
    }
    next();
};

const startGoogleAuth = (portal) => (req, res, next) => {
    passport.authenticate("google", {
        scope: ["openid", "email", "profile"],
        state: portal,
        prompt: "select_account",
        session: false
    })(req, res, next);
};

router.get("/google", setAuthPortal("admin"), startGoogleAuth("admin"));
router.get("/google/participant", setAuthPortal("participant"), startGoogleAuth("participant"));

// ==========================================
// 2. Google OAuth Callback + JWT Generation
// ==========================================

router.get("/google/callback", (req, res, next) => {
    const portal = req.query.state === "participant" || req.session?.authPortal === "participant"
        ? "participant"
        : "admin";
    const frontendUrl = portal === "participant" ? getParticipantFrontendUrl() : adminFrontendUrl;
    const failureUrl = portal === "participant"
        ? `${frontendUrl}/auth/callback?error=google_auth_failed`
        : `${frontendUrl}/login?error=google_auth_failed`;

    passport.authenticate("google", { session: false }, (error, user) => {
        if (error || !user) {
            if (req.session) delete req.session.authPortal;
            return res.redirect(302, failureUrl);
        }
        req.user = user;
        req.authPortal = portal;
        return next();
    })(req, res, next);
}, (req, res) => {
    const portal = req.authPortal === "participant" || req.query.state === "participant" || req.session?.authPortal === "participant"
        ? "participant"
        : "admin";
    const frontendUrl = portal === "participant" ? getParticipantFrontendUrl() : adminFrontendUrl;
    if (req.session) delete req.session.authPortal;

    try {
        const token = generateToken(req.user._id);
        res.cookie("vibrant_token", token, {
            ...authCookieOptions,
            maxAge: 60 * 60 * 1000,
        });
        if (portal === "participant") {
            return res.redirect(302, `${frontendUrl}/auth/callback?token=${encodeURIComponent(token)}`);
        }
        return res.redirect(302, `${frontendUrl}/admin`);
    } catch (error) {
        console.error("JWT generation error:", error);
        const failurePath = portal === "participant" ? "/auth/callback?error=google_auth_failed" : "/login?error=google_auth_failed";
        return res.redirect(302, `${frontendUrl}${failurePath}`);
    }
});

// ==========================================
// 3. Authentication Failure
// ==========================================

router.get("/failed", (req, res) => {
    const isParticipant = req.query.state === "participant" || req.session?.authPortal === "participant";
    const frontendUrl = isParticipant ? getParticipantFrontendUrl() : adminFrontendUrl;
    if (req.session) delete req.session.authPortal;
    const failurePath = isParticipant ? "/auth/callback?error=google_auth_failed" : "/login?error=google_auth_failed";
    return res.redirect(302, `${frontendUrl}${failurePath}`);
});

router.post("/logout", (req, res) => {
    res.clearCookie("vibrant_token", authCookieOptions);
    return res.status(200).json({
        success: true,
        message: "Logged out successfully"
    });
});


// Get currently authenticated user
router.get("/me", protect, (req, res) => {
    return res.status(200).json({
        success: true,
        user: {
            id: req.user._id,
            name: req.user.name,
            email: req.user.email,
            profilePicture: req.user.profilePicture,
            role: req.user.role
        }
    });
});

router.get(
    "/admin-test",
    protect,
    authorizeRoles("ADMIN"),
    (req, res) => {
        res.status(200).json({
            success: true,
            message: "Welcome Admin!"
        });
    }
);

router.get(
    "/participant-test",
    protect,
    authorizeParticipantPortal,
    (req, res) => {
        res.status(200).json({
            success: true,
            message: "Welcome Participant!"
        });
    }
);

module.exports = router;
