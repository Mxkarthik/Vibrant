const authorizeRoles = require("./roleMiddleware");

// Roles allowed to use participant-facing features; ownership checks remain in controllers.
module.exports = authorizeRoles("PARTICIPANT", "ORGANISER", "ADMIN");
