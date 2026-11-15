const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true
        },

        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true
        },
        googleId: {
            type: String,
            required: true,
            unique: true
        },
        profilePicture: 
        {
            type: String,
            default: null
        },
        role: {
            type: String,
            enum: ["PARTICIPANT", "ADMIN", "ORGANISER"],
            default: "PARTICIPANT"
        },
        isActive: 
        {
            type: Boolean,
            default: true
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model("User", userSchema);