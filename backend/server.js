const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const dotenv = require("dotenv");
const express = require("express");
const cors = require("cors");


dotenv.config();
const app = express();

// Trust reverse proxy (Render load balancer) so req.secure and secure cookies work behind TLS termination
app.set("trust proxy", 1);

const configuredOrigins = [process.env.ADMIN_FRONTEND_URL || "http://localhost:5173", process.env.PARTICIPANT_FRONTEND_URL || "http://localhost:5174"]
    .join(",")
    .split(",")
    .map(origin => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
const cookieSameSite = (process.env.AUTH_COOKIE_SAME_SITE || "lax").toLowerCase();

app.use(cors({
    origin(origin, callback) {
        // Requests without an Origin header (health checks and server-to-server) are allowed.
        if (!origin || configuredOrigins.includes(origin.replace(/\/$/, ""))) {
            return callback(null, true);
        }
        return callback(new Error("Origin is not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept"]
}));


const session = require("express-session");
const passport = require("./config/passport");
const connectDB = require("./config/db");
const cookieParser = require("cookie-parser");
const eventRoutes = require("./routes/eventRoutes");
const registrationRoutes = require("./routes/registrationRoutes");
const teamRoutes = require("./routes/teamRoutes");
const adminRoutes = require("./routes/adminRoutes");
const participantRoutes = require("./routes/participantRoutes");

app.use(express.json());
app.use(cookieParser());

app.use(
    session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production" || cookieSameSite === "none",
            sameSite: cookieSameSite,
            ...(process.env.AUTH_COOKIE_DOMAIN ? { domain: process.env.AUTH_COOKIE_DOMAIN } : {})
        }
    })
);

app.use(passport.initialize());

app.get("/", (req, res) => {
    res.json({ message: "VIBRANT Backend is running!" });
});

const startServer = async () => {
    await connectDB();

    app.listen(process.env.PORT, () => {
        console.log(`Server running on port ${process.env.PORT}`);
    });
};

const authRoutes = require("./routes/authRoutes");
app.use("/api/auth", authRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/registrations", registrationRoutes);
app.use("/api/teams", teamRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/participant", participantRoutes);

app.use((error, req, res, next) => {
    if (error.message === "Origin is not allowed by CORS") {
        return res.status(403).json({ success: false, message: "Origin is not allowed" });
    }
    return next(error);
});

startServer();
