
const express = require("express");
const passport = require("passport");
const generateToken = require("../utils/generateToken");
const protect = require("../middleware/authMiddleware");
const router = express.Router();
const authorizeRoles = require("../middleware/roleMiddleware");

const frontendUrl = (process.env.ADMIN_FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
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

router.get(
    "/google",
    passport.authenticate("google", {
        scope: ["openid", "email", "profile"],
        session: false
    })
);

// ==========================================
// 2. Google OAuth Callback + JWT Generation
// ==========================================

router.get(
    "/google/callback",

    passport.authenticate("google", {
        session: false,
        failureRedirect: `${frontendUrl}/login?error=google_auth_failed`
    }),

    (req, res) => {
        try {
            // Generate JWT using MongoDB user ID
            const token = generateToken(req.user._id);

            // Store JWT in HTTP-only cookie
            res.cookie("vibrant_token", token, {
                ...authCookieOptions,
                maxAge: 60 * 60 * 1000,
            });

            return res.redirect(302, `${frontendUrl}/admin`);

        } catch (error) {
            console.error("JWT generation error:", error);

            return res.redirect(302, `${frontendUrl}/login?error=google_auth_failed`);
        }
    }
);

// ==========================================
// 3. Authentication Failure
// ==========================================

router.get("/failed", (req, res) => {
    return res.redirect(302, `${frontendUrl}/login?error=google_auth_failed`);
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
