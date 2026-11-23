"use strict";

const mongoose = require("mongoose");

/**
 * Sanitizes a string to prevent spreadsheet formula injection.
 * Prepend single quote (') if the string begins with =, +, -, @, \t, or \r.
 */
function sanitizeForExcel(value) {
    if (value == null) return "";
    const str = typeof value === "string" ? value : String(value);
    if (/^[=+\-@\t\r]/.test(str)) {
        return `'${str}`;
    }
    return str;
}

/**
 * Builds a unified MongoDB filter matching both direct registrations and combo-entitled registrations.
 */
function buildEventCohortFilter(targetEventId, status = "REGISTERED") {
    const targetObjectId = typeof targetEventId === "string"
        ? new mongoose.Types.ObjectId(targetEventId)
        : targetEventId;

    const filter = {
        $or: [
            { event: targetObjectId },
            {
                "access.type": "MULTI_EVENT",
                "access.eligibleEventIds": targetObjectId
            }
        ]
    };

    if (status && status !== "ALL") {
        filter.status = status;
    }

    return filter;
}

/**
 * Builds attendance match condition for MongoDB queries (PRESENT or ABSENT at target event).
 */
function buildAttendanceMatchCondition(targetEventId, attendanceFilter) {
    if (!attendanceFilter || attendanceFilter === "ALL") {
        return null;
    }

    const targetObjectId = typeof targetEventId === "string"
        ? new mongoose.Types.ObjectId(targetEventId)
        : targetEventId;

    if (attendanceFilter === "PRESENT") {
        return {
            $or: [
                { "eventAttendance.eventId": targetObjectId },
                {
                    event: targetObjectId,
                    "attendance.isPresent": true
                }
            ]
        };
    }

    if (attendanceFilter === "ABSENT") {
        return {
            "eventAttendance.eventId": { $ne: targetObjectId },
            $nor: [
                {
                    event: targetObjectId,
                    "attendance.isPresent": true
                }
            ]
        };
    }

    return null;
}

/**
 * Resolves event-specific attendance for a registration document.
 * Handles both direct registrations (with legacy fallback) and combo registrations (strictly via eventAttendance).
 */
function resolveEventSpecificAttendance(registration, targetEventId) {
    const targetIdStr = targetEventId.toString();
    const isDirect = registration.event && (registration.event._id || registration.event).toString() === targetIdStr;
    const isCombo = registration.access?.type === "MULTI_EVENT";

    // 1. Check for specific entry in eventAttendance
    const eventAttendanceEntry = Array.isArray(registration.eventAttendance)
        ? registration.eventAttendance.find(e => e.eventId && (e.eventId._id || e.eventId).toString() === targetIdStr)
        : null;

    if (eventAttendanceEntry) {
        return {
            isPresent: true,
            checkedInAt: eventAttendanceEntry.checkedInAt || null,
            cohortType: isCombo ? "COMBO" : "DIRECT",
            parentEventId: isCombo ? (registration.event?._id || registration.event) : null
        };
    }

    // 2. For direct registrations, fallback to legacy attendance.isPresent
    if (isDirect && !isCombo) {
        const isPresent = registration.attendance?.isPresent === true;
        return {
            isPresent,
            checkedInAt: isPresent ? (registration.attendance?.checkedInAt || null) : null,
            cohortType: "DIRECT",
            parentEventId: null
        };
    }

    // 3. For combo registrations without an eventAttendance entry at this child event:
    // Do NOT inherit parent combo's aggregate attendance.isPresent!
    return {
        isPresent: false,
        checkedInAt: null,
        cohortType: isCombo ? "COMBO" : "DIRECT",
        parentEventId: isCombo ? (registration.event?._id || registration.event) : null
    };
}

/**
 * Computes comprehensive attendance statistics for a given cohort of registrations.
 */
function calculateEventAttendanceStats(targetEventId, registrations) {
    let totalParticipants = 0;
    let present = 0;

    let individualTotal = 0;
    let individualPresent = 0;

    let directTotal = 0;
    let directPresent = 0;

    let comboTotal = 0;
    let comboPresent = 0;

    let eligibleTotal = 0;
    let eligiblePresent = 0;

    const targetIdStr = targetEventId.toString();

    for (const r of registrations) {
        totalParticipants += 1;
        const att = resolveEventSpecificAttendance(r, targetIdStr);
        const isPres = att.isPresent;

        if (isPres) {
            present += 1;
        }

        const isTeam = Boolean(r.team);
        if (!isTeam) {
            individualTotal += 1;
            if (isPres) individualPresent += 1;
        }

        if (att.cohortType === "DIRECT") {
            directTotal += 1;
            if (isPres) directPresent += 1;
        } else {
            comboTotal += 1;
            if (isPres) comboPresent += 1;
        }

        // Admission eligibility check (verified payment + active registration)
        const isRegActive = r.status === "REGISTERED";
        const isPaymentEligible = isTeam
            ? ["VERIFIED", "NOT_REQUIRED"].includes(r.team?.payment?.status)
            : ["VERIFIED", "NOT_REQUIRED"].includes(r.payment?.status);

        if (isRegActive && isPaymentEligible) {
            eligibleTotal += 1;
            if (isPres) eligiblePresent += 1;
        }
    }

    const teamTotal = totalParticipants - individualTotal;
    const teamPresent = present - individualPresent;

    return {
        totalParticipants,
        present,
        absent: Math.max(0, totalParticipants - present),
        attendancePercentage: totalParticipants ? Number(((present / totalParticipants) * 100).toFixed(2)) : 0,
        individual: {
            total: individualTotal,
            present: individualPresent,
            absent: Math.max(0, individualTotal - individualPresent)
        },
        team: {
            total: teamTotal,
            present: teamPresent,
            absent: Math.max(0, teamTotal - teamPresent)
        },
        direct: {
            total: directTotal,
            present: directPresent,
            absent: Math.max(0, directTotal - directPresent)
        },
        combo: {
            total: comboTotal,
            present: comboPresent,
            absent: Math.max(0, comboTotal - comboPresent)
        },
        admissionEligible: {
            total: eligibleTotal,
            present: eligiblePresent,
            absent: Math.max(0, eligibleTotal - eligiblePresent)
        }
    };
}

module.exports = {
    sanitizeForExcel,
    buildEventCohortFilter,
    buildAttendanceMatchCondition,
    resolveEventSpecificAttendance,
    calculateEventAttendanceStats
};
