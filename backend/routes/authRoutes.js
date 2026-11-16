
const express = require("express");
const passport = require("passport");
const generateToken = require("../utils/generateToken");
const protect = require("../middleware/authMiddleware");
const router = express.Router();
const authorizeRoles = require("../middleware/roleMiddleware");

const adminFrontendUrl = (process.env.ADMIN_FRONTEND_URL || "http://localhost:5173").split(",")[0].trim().replace(/\/$/, "");
const participantFrontendUrl = (process.env.PARTICIPANT_FRONTEND_URL || "http://localhost:5174").split(",")[0].trim().replace(/\/$/, "");
const cookieSameSite = (process.env.AUTH_COOKIE_SAME_SITE || "lax").toLowerCase();
const authCookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || cookieSameSite === "none",
    sameSite: cookieSameSite,
    ...(process.env.AUTH_COOKIE_DOMAIN ? { domain: process.env.AUTH_COOKIE_DOMAIN } : {}),
    path: "/"
};

// ==========================================
// 1. Start Google OAuth
// ==========================================

const setAuthPortal = (portal) => (req, res, next) => {
    req.session.authPortal = portal;
    next();
};

const startGoogleAuth = passport.authenticate("google", {
    scope: ["openid", "email", "profile"],
    session: false
});

router.get("/google", setAuthPortal("admin"), startGoogleAuth);
router.get("/google/participant", setAuthPortal("participant"), startGoogleAuth);

// ==========================================
// 2. Google OAuth Callback + JWT Generation
// ==========================================

router.get("/google/callback", (req, res, next) => {
    const portal = req.session?.authPortal === "participant" ? "participant" : "admin";
    const frontendUrl = portal === "participant" ? participantFrontendUrl : adminFrontendUrl;
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
    const portal = req.authPortal === "participant" ? "participant" : "admin";
    const frontendUrl = portal === "participant" ? participantFrontendUrl : adminFrontendUrl;
    if (req.session) delete req.session.authPortal;

    try {
        const token = generateToken(req.user._id);
        res.cookie("vibrant_token", token, {
            ...authCookieOptions,
            maxAge: 60 * 60 * 1000,
        });
        return res.redirect(302, portal === "participant" ? `${frontendUrl}/auth/callback` : `${frontendUrl}/admin`);
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
    const isParticipant = req.session?.authPortal === "participant";
    const frontendUrl = isParticipant ? participantFrontendUrl : adminFrontendUrl;
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
    authorizeRoles("PARTICIPANT"),
    (req, res) => {
        res.status(200).json({
            success: true,
            message: "Welcome Participant!"
        });
    }
);

module.exports = router;
