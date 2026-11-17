const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;

const User = require("../models/User");

/**
 * Resolves the Google OAuth callback URL.
 * In production (NODE_ENV === "production"):
 *   - Uses GOOGLE_CALLBACK_URL if explicitly set and not pointing to localhost.
 *   - Defaults to the deployed Render backend URL: https://vibrant-qkl1.onrender.com/api/auth/google/callback
 *     (or dynamically derives from RENDER_EXTERNAL_URL if set by Render).
 * In development:
 *   - Preserves GOOGLE_CALLBACK_URL or defaults to http://localhost:${PORT}/api/auth/google/callback.
 */
const resolveGoogleCallbackUrl = () => {
    const raw = process.env.GOOGLE_CALLBACK_URL?.trim();
    const isProduction = process.env.NODE_ENV === "production";

    if (raw && (!isProduction || !raw.includes("localhost"))) {
        return raw;
    }

    if (isProduction) {
        const origin = (process.env.RENDER_EXTERNAL_URL || "https://vibrant-qkl1.onrender.com").replace(/\/+$/, "");
        return `${origin}/api/auth/google/callback`;
    }

    const port = process.env.PORT || 5000;
    return raw || `http://localhost:${port}/api/auth/google/callback`;
};

const callbackURL = resolveGoogleCallbackUrl();

console.log("Google Client ID configured:", !!process.env.GOOGLE_CLIENT_ID);
console.log("Google Callback URL:", callbackURL);

passport.use(
    new GoogleStrategy(
    {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL,

        // Default OAuth scopes
        scope: ["openid", "email", "profile"]
    },

        async (accessToken, refreshToken, profile, done) => {
            try {
                const email = profile.emails?.[0]?.value?.toLowerCase();
                if (!email) {
                    return done(new Error("Google account email not available"));
                }

                if (profile._json.email_verified !== true) {
                    return done(null, false, {
                    message: "Google email is not verified"
                    });
                }

                // Find existing user by Google ID
                let user = await User.findOne({
                    googleId: profile.id
                });

                if (user) {
                    if (!user.isActive) {
                        return done(null, false, {
                            message: "Account is inactive"
                        });
                    }

                    return done(null, user);
                }

                // Link or verify existing user by verified Google email
                const existingEmail = await User.findOne({ email });

                if (existingEmail) {
                    if (!existingEmail.isActive) {
                        return done(null, false, {
                            message: "Account is inactive"
                        });
                    }

                    // If existing user has no Google ID yet, link it
                    if (!existingEmail.googleId) {
                        existingEmail.googleId = profile.id;
                        if (!existingEmail.profilePicture && profile.photos?.[0]?.value) {
                            existingEmail.profilePicture = profile.photos[0].value;
                        }
                        await existingEmail.save();
                        return done(null, existingEmail);
                    }

                    // If existing user is registered with a different Google account ID
                    if (existingEmail.googleId !== profile.id) {
                        return done(null, false, {
                            message: "Email already registered with another account"
                        });
                    }

                    return done(null, existingEmail);
                }

                // Create a new participant
                user = await User.create({
                    name: profile.displayName,
                    email,
                    googleId: profile.id,
                    profilePicture: profile.photos?.[0]?.value || null,
                    role: "PARTICIPANT"
                });

                return done(null, user);

            } catch (error) {
                return done(error, null);
            }
        }
    )
);

module.exports = passport;
