
const mongoose = require("mongoose");
const User = require("../models/User");

// @desc Get all registered organisers
// @route GET /api/admin/organisers
// @access ADMIN

const getAllOrganisers = async (req, res) => {
    try {
        const organisers = await User.find({
            role: "ORGANISER"
        })
            .select("name email profilePicture role isActive createdAt")
            .sort({ createdAt: -1 })
            .lean();

        return res.status(200).json({
            success: true,
            count: organisers.length,
            organisers
        });

    } catch (error) {
        console.error("Get organisers error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch organisers"
        });
    }
};


// @desc Assign or update a user's role using Gmail
// @route PATCH /api/admin/users/role
// @access ADMIN

const updateUserRole = async (req, res) => {
    try {
        const { email, role } = req.body;

        if (
            typeof email !== "string" ||
            !email.trim() ||
            typeof role !== "string"
        ) {
            return res.status(400).json({
                success: false,
                message: "Email and role are required"
            });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const normalizedRole = role.trim().toUpperCase();

        // Only allow these two role changes.
        // ADMIN accounts cannot be modified through this API.
        const allowedRoles = ["PARTICIPANT", "ORGANISER"];

        if (!allowedRoles.includes(normalizedRole)) {
            return res.status(400).json({
                success: false,
                message: "Role must be PARTICIPANT or ORGANISER"
            });
        }

        // Find the existing Google-authenticated account
        const user = await User.findOne({
            email: normalizedEmail
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "No registered user found with this Gmail address"
            });
        }

        if (user.role === "ADMIN") {
            return res.status(403).json({
                success: false,
                message: "Admin accounts cannot be modified through this API"
            });
        }

        if (!user.isActive) {
            return res.status(403).json({
                success: false,
                message: "This user account is inactive"
            });
        }

        if (user.role === normalizedRole) {
            return res.status(200).json({
                success: true,
                message: `User already has the ${normalizedRole} role`,
                user: {
                    name: user.name,
                    email: user.email,
                    role: user.role
                }
            });
        }

        user.role = normalizedRole;
        await user.save();

        return res.status(200).json({
            success: true,
            message: `User role updated to ${normalizedRole} successfully`,
            user: {
                _id: user._id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });

    } catch (error) {
        console.error("Update user role error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to update user role"
        });
    }
};

module.exports = {
    getAllOrganisers,
    updateUserRole
};
