"use strict";

const mongoose = require("mongoose");

/**
 * Normalizes an event ID (or populated object) into a valid mongoose.Types.ObjectId.
 * Throws an Error if invalid or missing.
 *
 * @param {string|mongoose.Types.ObjectId|object} idOrObj
 * @returns {mongoose.Types.ObjectId}
 */
function normalizeEventId(idOrObj) {
    if (!idOrObj) {
        throw new Error("Event ID cannot be null or undefined");
    }
    const raw = (typeof idOrObj === "object" && idOrObj._id) ? idOrObj._id : idOrObj;
    const str = raw.toString();
    if (!mongoose.isValidObjectId(str)) {
        throw new Error(`Invalid event ID: "${str}"`);
    }
    return new mongoose.Types.ObjectId(str);
}

/**
 * Builds an immutable Registration entitlement access snapshot.
 *
 * For SINGLE_EVENT (standard or multiEventAccess disabled):
 * - Exactly one eligible event ID (the registered event).
 *
 * For MULTI_EVENT (combo parent with multiEventAccess enabled):
 * - eligibleEventIds contains the explicitly selected included events.
 * - In accordance with Phase 05.1 architecture rules, the parent combo
 *   is a registration product and is NOT automatically an attendance destination;
 *   therefore the parent event ID is not added automatically.
 *
 * @param {object} params
 * @param {object} params.event - The registered event (or event object)
 * @param {Array<string|mongoose.Types.ObjectId|object>} [params.includedEvents] - Explicit included events (defaults to event.multiEventAccess.includedEvents)
 * @param {Date} [params.grantedAt] - Date when access is granted (defaults to current date)
 * @returns {object} Access snapshot object { type, eligibleEventIds, grantedAt }
 */
function buildRegistrationAccessSnapshot({ event, includedEvents, grantedAt = new Date() } = {}) {
    if (!event) {
        throw new Error("Event is required to build registration access snapshot");
    }

    const registeredEventId = normalizeEventId(event);
    const isCombo = Boolean(event.multiEventAccess && event.multiEventAccess.enabled === true);

    const snapshotDate = grantedAt instanceof Date
        ? new Date(grantedAt.getTime())
        : new Date(grantedAt);

    if (!isCombo) {
        return {
            type: "SINGLE_EVENT",
            eligibleEventIds: [registeredEventId],
            grantedAt: snapshotDate
        };
    }

    // Determine included events from explicit parameter or event.multiEventAccess.includedEvents
    const rawIncluded = includedEvents !== undefined
        ? includedEvents
        : (event.multiEventAccess && Array.isArray(event.multiEventAccess.includedEvents)
            ? event.multiEventAccess.includedEvents
            : []);

    if (!Array.isArray(rawIncluded) || rawIncluded.length === 0) {
        throw new Error("Multi-event access is enabled, but no included events were provided");
    }

    const seenIds = new Set();
    const normalizedEligibleEventIds = [];

    for (const rawItem of rawIncluded) {
        const normalizedId = normalizeEventId(rawItem);
        const strId = normalizedId.toString();

        if (seenIds.has(strId)) {
            throw new Error(`Duplicate event ID in includedEvents: "${strId}"`);
        }
        seenIds.add(strId);
        normalizedEligibleEventIds.push(normalizedId);
    }

    return {
        type: "MULTI_EVENT",
        eligibleEventIds: normalizedEligibleEventIds,
        grantedAt: snapshotDate
    };
}

/**
 * Resolves the effective access entitlement for a registration.
 *
 * For registrations with an existing `access` snapshot:
 * - Returns the frozen snapshot.
 *
 * For legacy registrations without `access`:
 * - Returns effective single-event access to `registration.event`.
 * - Does NOT inspect parent combo configuration to retroactively grant new events.
 *
 * Strictly read-only: does NOT modify the registration or produce database side effects.
 *
 * @param {object} registration
 * @returns {object} Effective access object { type, eligibleEventIds, grantedAt, isLegacy }
 */
function resolveEffectiveAccess(registration) {
    if (!registration) {
        throw new Error("Registration is required to resolve effective access");
    }

    // 1. Explicit null is invalid corrupted data: reject with explicit error
    if (registration.access === null) {
        const error = new Error("Invalid registration access: explicit null access snapshot");
        error.code = "INVALID_REGISTRATION_ACCESS";
        error.statusCode = 400;
        throw error;
    }

    // 2. If access snapshot is explicitly present on registration, it is NOT a legacy record.
    // Malformed snapshots must be rejected explicitly instead of silently falling back to legacy access.
    if (registration.access !== undefined) {
        const access = registration.access;
        if (typeof access !== "object") {
            throw new Error("Malformed registration access snapshot: access must be an object");
        }

        if (!["SINGLE_EVENT", "MULTI_EVENT"].includes(access.type)) {
            throw new Error(`Malformed registration access snapshot: invalid access type "${access.type}"`);
        }

        if (!Array.isArray(access.eligibleEventIds) || access.eligibleEventIds.length === 0) {
            throw new Error("Malformed registration access snapshot: eligibleEventIds must be a non-empty array");
        }

        if (access.type === "SINGLE_EVENT" && access.eligibleEventIds.length !== 1) {
            throw new Error("Malformed registration access snapshot: SINGLE_EVENT must have exactly one eligible event ID");
        }

        const seen = new Set();
        const frozenEventIds = [];
        for (const rawId of access.eligibleEventIds) {
            const normalizedId = normalizeEventId(rawId);
            const strId = normalizedId.toString();
            if (seen.has(strId)) {
                throw new Error(`Malformed registration access snapshot: duplicate event ID "${strId}" in eligibleEventIds`);
            }
            seen.add(strId);
            frozenEventIds.push(normalizedId);
        }

        return {
            type: access.type,
            eligibleEventIds: frozenEventIds,
            grantedAt: access.grantedAt ? new Date(access.grantedAt) : null,
            isLegacy: false
        };
    }

    // 3. Fallback strictly for legacy registration (access === undefined)
    if (!registration.event) {
        throw new Error("Registration has no event reference to resolve legacy access");
    }

    const fallbackEventId = (registration.event && registration.event._id)
        ? registration.event._id
        : registration.event;

    return {
        type: "SINGLE_EVENT",
        eligibleEventIds: [fallbackEventId],
        grantedAt: registration.createdAt ? new Date(registration.createdAt) : null,
        isLegacy: true
    };
}

module.exports = {
    normalizeEventId,
    buildRegistrationAccessSnapshot,
    resolveEffectiveAccess
};
