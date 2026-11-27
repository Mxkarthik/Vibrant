"use strict";

function serializeTheme({ title, problemStatement, instructions }) {
    return { title, problemStatement, instructions: instructions ?? "" };
}

function serializeLockedAssignment(assignment) {
    return {
        eventId: String(assignment.event),
        hasAssignment: true,
        isLocked: true,
        theme: serializeTheme(assignment.contentSnapshot),
        assignedAt: assignment.assignedAt
    };
}

module.exports = { serializeTheme, serializeLockedAssignment };
