const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;

const User = require("../models/User");


console.log("Google Client ID:", !!process.env.GOOGLE_CLIENT_ID);
console.log("Google Callback URL:", process.env.GOOGLE_CALLBACK_URL);

passport.use(
    new GoogleStrategy(
    {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL,

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

                // Do not automatically link an existing email
                // to a different Google account.
                const existingEmail = await User.findOne({ email });

                if (existingEmail) {
                    return done(null, false, {
                        message: "Email already registered with another account"
                    });
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
