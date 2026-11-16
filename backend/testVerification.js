
require("dotenv").config();

const generateToken = require("./utils/generateToken");
const verifyToken = require("./utils/verifyToken");

const userId = "691234567890123456789012";

// Generate token
const token = generateToken(userId);

try {
    const decoded = verifyToken(token);

    console.log("Token Verified Successfully!");
    console.log("User ID:", decoded.sub);

} catch (error) {
    console.error("Token Verification Failed:", error.message);
}
