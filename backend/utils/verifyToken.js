
const jwt = require("jsonwebtoken");

const verifyToken = (token) => {
    try {
        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET,
            {
                algorithms: ["HS256"],
                issuer: "vibrant-api",
                audience: "vibrant-client"
            }
        );

        return decoded;

    } catch (error) {
        throw error;
    }
};

module.exports = verifyToken;
