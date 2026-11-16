const verifyToken = require("../utils/verifyToken");
const User = require("../models/User");

const protect = async (req, res, next) => {
    try {
        // 1. Extract JWT from cookie
        const token = req.cookies?.vibrant_token;

        if (!token) {
            return res.status(401).json({
                success: false,
                message: "Authentication required"
            });
        }

        // 2. Verify JWT
        const decoded = verifyToken(token);

        // 3. Fetch the latest user details from MongoDB
        const user = await User.findById(decoded.sub);

        if (!user || !user.isActive) {
            return res.status(401).json({
                success: false,
                message: "User not found or account inactive"
            });
        }

        // 4. Attach authenticated user to request
        req.user = user;

        // 5. Continue to the next middleware or route
        next();

    } catch (error) {
        const message =
            error.name === "TokenExpiredError"
                ? "Authentication token expired"
                : "Invalid authentication token";

        return res.status(401).json({
            success: false,
            message
        });
    }
};

module.exports = protect;