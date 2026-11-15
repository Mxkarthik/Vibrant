const express = require("express");
const passport = require("passport");

const router = express.Router();

// Start Google authentication
router.get(
    "/google",
    passport.authenticate("google", {
        scope: ["openid", "email", "profile"],
        session: false
    })
);

// Google OAuth callback
router.get(
    "/google/callback",
    passport.authenticate("google", {
        session: false,
        failureRedirect: "/api/auth/failed"
    }),
    (req, res) => {
        res.json({
            message: "Google authentication successful",
            user: {
                id: req.user._id,
                name: req.user.name,
                email: req.user.email,
                role: req.user.role
            }
        });
    }
);

router.get("/failed", (req, res) => {
    res.status(401).json({
        message: "Google authentication failed"
    });
});

module.exports = router;