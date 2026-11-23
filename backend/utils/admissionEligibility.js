"use strict";

const mongoose = require("mongoose");
const { resolveEffectiveAccess } = require("./registrationEntitlement");

/**
 * Normalizes an event ID (or populated object) into a valid mongoose.Types.ObjectId.
 * Returns null if invalid or missing.
 *
 * @param {string|mongoose.Types.ObjectId|object} idOrObj
 * @returns {mongoose.Types.ObjectId|null}
 */
function toObjectIdOrNull(idOrObj) {
    if (!idOrObj) return null;
    const raw = (typeof idOrObj === "object" && idOrObj._id) ? idOrObj._id : idOrObj;
    const str = raw.toString();
    return mongoose.isValidObjectId(str) ? new mongoose.Types.ObjectId(str) : null;
}

/**
 * Resolves whether a participant ticket/registration is eligible for admission
 * to a specific target event.
 *
 * Strictly read-only: does NOT modify documents or produce database side effects.
 *
 * @param {object} params
 * @param {object} params.registration - The Registration document or object
 * @param {object} [params.team] - The Team document or object (required if registration is part of a team)
 * @param {object|string|mongoose.Types.ObjectId} params.targetEvent - The target event object or event ID being checked into
 * @param {object} [params.parentEvent] - Explicit parent combo event object (with status)
 * @returns {object} { isEligible: boolean, reasonCode: string, message: string, access?: object }
 */
function resolveRegistrationAdmissionEligibility({ registration, team, targetEvent, parentEvent: explicitParentEvent } = {}) {
    if (!registration || typeof registration !== "object") {
        return {
            isEligible: false,
            reasonCode: "INVALID_REGISTRATION",
            message: "Registration details are required to evaluate admission eligibility."
        };
    }

    if (!targetEvent) {
        return {
            isEligible: false,
            reasonCode: "INVALID_TARGET_EVENT",
            message: "Target event is required to evaluate admission eligibility."
        };
    }

    const targetEventId = toObjectIdOrNull(targetEvent);
    if (!targetEventId) {
        return {
            isEligible: false,
            reasonCode: "INVALID_TARGET_EVENT",
            message: "Target event reference is invalid."
        };
    }

    // 1. Resolve effective access snapshot
    let effectiveAccess;
    try {
        effectiveAccess = resolveEffectiveAccess(registration);
    } catch (accessErr) {
        return {
            isEligible: false,
            reasonCode: "INVALID_ACCESS_SNAPSHOT",
            message: accessErr.message || "Invalid registration access configuration."
        };
    }

    // 2. Verify target event is entitled
    const targetEventStr = targetEventId.toString();
    const isEntitled = effectiveAccess.eligibleEventIds.some(
        eligibleId => eligibleId.toString() === targetEventStr
    );

    if (!isEntitled) {
        return {
            isEligible: false,
            reasonCode: "EVENT_NOT_ENTITLED",
            message: "Ticket is not valid for this event."
        };
    }

    // 3. Verify active registration status
    if (registration.status !== "REGISTERED") {
        return {
            isEligible: false,
            reasonCode: "REGISTRATION_CANCELLED",
            message: "Registration is cancelled or inactive."
        };
    }

    // 4. Verify target event status (if targetEvent is an object with status)
    if (typeof targetEvent === "object" && targetEvent.status) {
        if (targetEvent.status === "CANCELLED") {
            return {
                isEligible: false,
                reasonCode: "TARGET_EVENT_CANCELLED",
                message: "The target event has been cancelled."
            };
        }
        if (targetEvent.status !== "PUBLISHED" && targetEvent.status !== "COMPLETED") {
            return {
                isEligible: false,
                reasonCode: "TARGET_EVENT_INACTIVE",
                message: "The target event is not active."
            };
        }
    }

    // 5. For combo registrations, verify parent event status is not cancelled
    if (effectiveAccess.type === "MULTI_EVENT") {
        const parentEvent = (explicitParentEvent && typeof explicitParentEvent === "object" && explicitParentEvent.status)
            ? explicitParentEvent
            : (registration.event && typeof registration.event === "object" && registration.event.status)
                ? registration.event
                : (team && team.event && typeof team.event === "object" && team.event.status)
                    ? team.event
                    : null;

        if (!parentEvent || !parentEvent.status) {
            return {
                isEligible: false,
                reasonCode: "PARENT_EVENT_UNVERIFIED",
                message: "Parent combo event status could not be verified."
            };
        }

        if (parentEvent.status === "CANCELLED") {
            return {
                isEligible: false,
                reasonCode: "PARENT_EVENT_CANCELLED",
                message: "The parent combo event has been cancelled."
            };
        }
        if (parentEvent.status !== "PUBLISHED" && parentEvent.status !== "COMPLETED") {
            return {
                isEligible: false,
                reasonCode: "PARENT_EVENT_INACTIVE",
                message: "The parent combo event is not active."
            };
        }
    }

    // 6. Payment validation: distinguish team vs individual
    const isTeamRegistration = Boolean(registration.team);

    if (isTeamRegistration) {
        if (!team || typeof team !== "object") {
            return {
                isEligible: false,
                reasonCode: "TEAM_REQUIRED",
                message: "Team information is required to verify team registration admission."
            };
        }

        if (team.status !== "REGISTERED") {
            return {
                isEligible: false,
                reasonCode: "TEAM_CANCELLED",
                message: "Team registration is cancelled or inactive."
            };
        }

        const teamPaymentStatus = team.payment?.status || "NOT_REQUIRED";
        if (teamPaymentStatus === "PENDING") {
            return {
                isEligible: false,
                reasonCode: "PAYMENT_PENDING",
                message: "Team payment is pending verification."
            };
        }
        if (teamPaymentStatus === "REJECTED") {
            return {
                isEligible: false,
                reasonCode: "PAYMENT_REJECTED",
                message: "Team payment was rejected."
            };
        }
        if (!["VERIFIED", "NOT_REQUIRED"].includes(teamPaymentStatus)) {
            return {
                isEligible: false,
                reasonCode: "PAYMENT_NOT_ELIGIBLE",
                message: "Team payment is not verified."
            };
        }
    } else {
        const regPaymentStatus = registration.payment?.status || "NOT_REQUIRED";
        if (regPaymentStatus === "PENDING") {
            return {
                isEligible: false,
                reasonCode: "PAYMENT_PENDING",
                message: "Registration payment is pending verification."
            };
        }
        if (regPaymentStatus === "REJECTED") {
            return {
                isEligible: false,
                reasonCode: "PAYMENT_REJECTED",
                message: "Registration payment was rejected."
            };
        }
        if (!["VERIFIED", "NOT_REQUIRED"].includes(regPaymentStatus)) {
            return {
                isEligible: false,
                reasonCode: "PAYMENT_NOT_ELIGIBLE",
                message: "Registration payment is not verified."
            };
        }
    }

    // 7. All checks passed
    return {
        isEligible: true,
        reasonCode: "ADMISSION_ALLOWED",
        message: "Admission granted.",
        access: effectiveAccess
    };
}

module.exports = {
    resolveRegistrationAdmissionEligibility
};
