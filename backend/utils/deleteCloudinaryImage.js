const cloudinary = require("../config/cloudinary");

module.exports = async (publicId) => {
    if (!publicId) return;
    await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
};
