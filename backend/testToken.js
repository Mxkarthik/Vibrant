const generateToken = require("./utils/generateToken");
const jwt = require("jsonwebtoken");
require("dotenv").config();

// Temporary test user ID
const userId = "691234567890123456789012";

// Generate JWT
const token = generateToken(userId);

console.log("\nGenerated JWT:\n");
console.log(token);

// Decode JWT
const decoded = jwt.decode(token);

console.log("\nDecoded JWT Payload:\n");
console.log(decoded);