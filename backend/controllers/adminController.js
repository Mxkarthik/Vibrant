
const mongoose = require("mongoose");
const User = require("../models/User");
const Event = require("../models/Event");
const Registration = require("../models/Registration");
const Team = require("../models/Team");

const getAllAdminEvents = async (req, res) => {
    try {
        const {
            search = "",
            status = "",
            category = "",
            page = "1",
            limit = "10",
            sortBy = "createdAt",
            sortOrder = "desc"
        } = req.query;
        const pageNumber = Number(page);
        const limitNumber = Number(limit);

        if (!Number.isInteger(pageNumber) || pageNumber < 1 || !Number.isInteger(limitNumber) || limitNumber < 1 || limitNumber > 50) {
            return res.status(400).json({ success: false, message: "Invalid pagination parameters" });
        }
        if (status && !["PUBLISHED", "CANCELLED", "COMPLETED"].includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid event status" });
        }
        if (category && !["TECHNICAL", "CULTURAL", "SPORTS", "WORKSHOP", "COMPETITION"].includes(category)) {
            return res.status(400).json({ success: false, message: "Invalid event category" });
        }
        if (!["createdAt", "startDate"].includes(sortBy) || !["asc", "desc"].includes(sortOrder)) {
            return res.status(400).json({ success: false, message: "Invalid sort parameters" });
        }

        const filter = {};
        if (status) filter.status = status;
        if (category) filter.category = category;
        if (typeof search === "string" && search.trim()) {
            const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            filter.name = { $regex: escaped, $options: "i" };
        }

        const skip = (pageNumber - 1) * limitNumber;
        const direction = sortOrder === "asc" ? 1 : -1;
        const [events, totalEvents] = await Promise.all([
            Event.find(filter)
                .sort({ [sortBy]: direction, _id: direction })
                .skip(skip)
                .limit(limitNumber)
                .select("name description category poster venue startDate endDate registration registrationFields status createdAt updatedAt")
                .lean(),
            Event.countDocuments(filter)
        ]);

        return res.status(200).json({
            success: true,
            events,
            pagination: {
                totalEvents,
                currentPage: pageNumber,
                totalPages: Math.ceil(totalEvents / limitNumber),
                limit: limitNumber,
                hasNextPage: skip + events.length < totalEvents,
                hasPreviousPage: pageNumber > 1
            }
        });
    } catch (error) {
        console.error("Get admin events error:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch events" });
    }
};

const deleteAdminEvent = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid event ID" });
        }

        const event = await Event.findById(id).select("status registration.registeredParticipants");
        if (!event) {
            return res.status(404).json({ success: false, message: "Event not found" });
        }
        if (event.status === "PUBLISHED") {
            return res.status(409).json({
                success: false,
                message: "Cancel or complete this event before deleting it."
            });
        }

        const [registrationCount, teamCount] = await Promise.all([
            Registration.countDocuments({ event: event._id }),
            Team.countDocuments({ event: event._id })
        ]);
        if (registrationCount > 0 || teamCount > 0 || (event.registration?.registeredParticipants ?? 0) > 0) {
            return res.status(409).json({
                success: false,
                message: "This event has registration or team history and cannot be deleted. Keep it cancelled or completed to preserve those records."
            });
        }

        await Event.deleteOne({ _id: event._id });
        return res.status(200).json({ success: true, message: "Event deleted successfully" });
    } catch (error) {
        console.error("Delete admin event error:", error);
        return res.status(500).json({ success: false, message: "Failed to delete event" });
    }
};

const getDashboard = async (req, res) => {
    try {
        const [eventSummary, registrationSummary, individualPayments, teamPayments, organiserCount, recentEvents] = await Promise.all([
            Event.aggregate([
                {
                    $group: {
                        _id: null,
                        totalEvents: { $sum: 1 },
                        publishedEvents: { $sum: { $cond: [{ $eq: ["$status", "PUBLISHED"] }, 1, 0] } },
                        completedEvents: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } },
                        cancelledEvents: { $sum: { $cond: [{ $eq: ["$status", "CANCELLED"] }, 1, 0] } }
                    }
                },
                { $project: { _id: 0 } }
            ]),
            Registration.aggregate([
                {
                    $group: {
                        _id: null,
                        totalRegistrations: { $sum: 1 },
                        totalRegistered: {
                            $sum: { $cond: [{ $eq: [{ $ifNull: ["$status", "REGISTERED"] }, "REGISTERED"] }, 1, 0] }
                        },
                        totalCheckedIn: {
                            $sum: {
                                $cond: [
                                    {
                                        $and: [
                                            { $eq: [{ $ifNull: ["$status", "REGISTERED"] }, "REGISTERED"] },
                                            { $eq: [{ $ifNull: ["$attendance.isPresent", false] }, true] }
                                        ]
                                    },
                                    1,
                                    0
                                ]
                            }
                        }
                    }
                },
                { $project: { _id: 0 } }
            ]),
            Registration.aggregate([
                { $match: { team: null } },
                {
                    $group: {
                        _id: null,
                        pendingIndividual: { $sum: { $cond: [{ $eq: ["$payment.status", "PENDING"] }, 1, 0] } },
                        verifiedIndividual: { $sum: { $cond: [{ $eq: ["$payment.status", "VERIFIED"] }, 1, 0] } }
                    }
                },
                { $project: { _id: 0 } }
            ]),
            Team.aggregate([
                {
                    $group: {
                        _id: null,
                        pendingTeams: { $sum: { $cond: [{ $eq: ["$payment.status", "PENDING"] }, 1, 0] } },
                        verifiedTeams: { $sum: { $cond: [{ $eq: ["$payment.status", "VERIFIED"] }, 1, 0] } }
                    }
                },
                { $project: { _id: 0 } }
            ]),
            User.countDocuments({ role: "ORGANISER", isActive: true }),
            Event.find({})
                .sort({ createdAt: -1, _id: -1 })
                .limit(5)
                .select("name category startDate venue status createdAt")
                .lean()
        ]);

        const events = eventSummary[0] || {};
        const registrations = registrationSummary[0] || {};
        const individual = individualPayments[0] || {};
        const teams = teamPayments[0] || {};
        const totalRegistered = Number(registrations.totalRegistered) || 0;
        const totalCheckedIn = Number(registrations.totalCheckedIn) || 0;

        return res.status(200).json({
            success: true,
            overview: {
                totalEvents: Number(events.totalEvents) || 0,
                publishedEvents: Number(events.publishedEvents) || 0,
                completedEvents: Number(events.completedEvents) || 0,
                cancelledEvents: Number(events.cancelledEvents) || 0,
                totalRegistrations: Number(registrations.totalRegistrations) || 0,
                totalOrganisers: Number(organiserCount) || 0
            },
            payments: {
                pendingIndividual: Number(individual.pendingIndividual) || 0,
                pendingTeams: Number(teams.pendingTeams) || 0,
                verifiedIndividual: Number(individual.verifiedIndividual) || 0,
                verifiedTeams: Number(teams.verifiedTeams) || 0
            },
            attendance: {
                totalCheckedIn,
                totalRegistered,
                attendancePercentage: totalRegistered
                    ? Number(((totalCheckedIn / totalRegistered) * 100).toFixed(2))
                    : 0
            },
            recentEvents: recentEvents.map(event => ({
                name: event.name,
                category: event.category,
                startDate: event.startDate,
                venue: event.venue,
                status: event.status,
                createdAt: event.createdAt
            }))
        });
    } catch (error) {
        console.error("Get admin dashboard error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch dashboard data"
        });
    }
};

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
    getAllAdminEvents,
    deleteAdminEvent,
    getDashboard,
    getAllOrganisers,
    updateUserRole
};
