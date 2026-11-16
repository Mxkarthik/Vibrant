
const cloudinary = require("../config/cloudinary");
const { Readable } = require("stream");

const uploadToCloudinary = (buffer, folder = "vibrant/payment-proofs") => {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder,
                resource_type: "image"
            },
            (error, result) => {
                if (error) {
                    return reject(error);
                }

                if (!result?.secure_url) {
                    return reject(new Error("Cloudinary did not return a secure image URL"));
                }

                resolve({
                    url: result.secure_url,
                    secureUrl: result.secure_url,
                    publicId: result.public_id
                });
            }
        );

        Readable.from(buffer).pipe(uploadStream);
    });
};

module.exports = uploadToCloudinary;
