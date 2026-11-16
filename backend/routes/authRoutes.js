
const express = require("express");
const passport = require("passport");
const generateToken = require("../utils/generateToken");
const protect = require("../middleware/authMiddleware");
const router = express.Router();
const authorizeRoles = require("../middleware/roleMiddleware");

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
        failureRedirect: "/api/auth/failed"
    }),

    (req, res) => {
        try {
            // Generate JWT using MongoDB user ID
            const token = generateToken(req.user._id);

            // Store JWT in HTTP-only cookie
            res.cookie("vibrant_token", token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "lax",
                maxAge: 60 * 60 * 1000,
                path: "/"
            });

            // Send user information without exposing JWT
            return res.status(200).json({
                success: true,
                message: "Google authentication successful",
                user: {
                    id: req.user._id,
                    name: req.user.name,
                    email: req.user.email,
                    role: req.user.role
                }
            });

        } catch (error) {
            console.error("JWT generation error:", error);

            return res.status(500).json({
                success: false,
                message: "JWT generation failed"
            });
        }
    }
);

// ==========================================
// 3. Authentication Failure
// ==========================================

router.get("/failed", (req, res) => {
    return res.status(401).json({
        success: false,
        message: "Google authentication failed"
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
