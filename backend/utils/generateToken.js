const jwt = require("jsonwebtoken");

const generateToken = (userId) => {
    const token = jwt.sign(
        {
            sub: userId.toString()
        },
        process.env.JWT_SECRET,
        {
            algorithm: "HS256",
            expiresIn: "1h",
            issuer: "vibrant-api",
            audience: "vibrant-client"
        }
    );

    return token;
};

module.exports = generateToken;