
const express = require("express");
const router = express.Router();

const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");

const {
    getAllAdminEvents,
    deleteAdminEvent,
    getDashboard,
    getIndividualPayments,
    getTeamPayments,
    getFinancialSummary,
    getAllOrganisers,
    getAdminUsers,
    getAdminEventAttendance,
    getEventCertificates,
    updateUserRole
} = require("../controllers/adminController");
const { issueIndividualCertificate } = require("../controllers/registrationController");

// All routes require ADMIN authentication
router.use(protect, authorizeRoles("ADMIN"));

router.get("/dashboard", getDashboard);
router.get("/events", getAllAdminEvents);
router.get("/events/:id/attendance", getAdminEventAttendance);
router.get("/events/:id/certificates", getEventCertificates);
router.post("/certificates/:registrationId/issue", issueIndividualCertificate);
router.delete("/events/:id", deleteAdminEvent);
router.get("/payments/summary", getFinancialSummary);
router.get("/payments/individual", getIndividualPayments);
router.get("/payments/teams", getTeamPayments);

// Get all organisers
router.get("/organisers", getAllOrganisers);
router.get("/users", getAdminUsers);

// Promote or demote a registered user
router.patch("/users/role", updateUserRole);

module.exports = router;
