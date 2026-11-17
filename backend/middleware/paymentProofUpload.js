const multer = require("multer");
const upload = require("./uploadMiddleware");

const parsePaymentProof = upload.single("screenshot");

module.exports = (req, res, next) => {
    parsePaymentProof(req, res, error => {
        if (!error) return next();

        if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
            return res.status(413).json({ success: false, message: "Payment proof must be 5 MB or smaller." });
        }

        return res.status(400).json({
            success: false,
            message: error.message === "Only JPG, PNG and WEBP images are allowed"
                ? error.message
                : "Invalid payment proof image."
        });
    });
};
