const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const dotenv = require("dotenv");
const express = require("express");


dotenv.config();
const app = express();


const session = require("express-session");
const passport = require("./config/passport");
const connectDB = require("./config/db");
const cookieParser = require("cookie-parser");
const eventRoutes = require("./routes/eventRoutes");
const registrationRoutes = require("./routes/registrationRoutes");

app.use(express.json());
app.use(cookieParser());


app.use(express.json());

app.use(
    session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            secure: false, // Local development only
            sameSite: "lax"
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

startServer();