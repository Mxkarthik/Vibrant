
const express = require("express");
const router = express.Router();

const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");

const {
    getAllAdminEvents,
    deleteAdminEvent,
    getDashboard,
    getAllOrganisers,
    updateUserRole
} = require("../controllers/adminController");

// All routes require ADMIN authentication
router.use(protect, authorizeRoles("ADMIN"));

router.get("/dashboard", getDashboard);
router.get("/events", getAllAdminEvents);
router.delete("/events/:id", deleteAdminEvent);

// Get all organisers
router.get("/organisers", getAllOrganisers);

// Promote or demote a registered user
router.patch("/users/role", updateUserRole);

module.exports = router;
