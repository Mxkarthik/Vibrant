const mongoose = require("mongoose");

/**
 * Campus-appropriate maximum bounded limit for included events in a single combo pass.
 * Configurable via options.maxIncludedEvents.
 */
const DEFAULT_MAX_INCLUDED_EVENTS = 20;

/**
 * Reusable Multi-Event Access validation engine.
 * Validates configuration shape, referential integrity, lifecycle states,
 * single-level relationship boundaries (no nesting/cycles), and registration mode compatibility.
 *
 * Designed for use across Event creation and update pipelines in Phase 02.
 * Pure validation utility: does NOT depend on Express req/res and does NOT mutate documents.
 *
 * @param {Object|null|undefined} config - The multiEventAccess payload to validate
 * @param {Object} [options]
 * @param {string|mongoose.Types.ObjectId|null} [options.parentId] - ID of the parent event (when updating)
 * @param {string} [options.parentMode] - "INDIVIDUAL" or "TEAM" (registration mode of parent event)
 * @param {Object} [options.EventModel] - Mongoose Event model (defaults to registered "Event" model)
 * @param {number} [options.maxIncludedEvents=20] - Maximum allowable child events
 * @param {boolean} [options.throwOnError=false] - Whether to throw an Error instead of returning error result
 * @returns {Promise<{ isValid: boolean, error: string|null, value: { enabled: boolean, includedEvents: mongoose.Types.ObjectId[] }|null, childEvents?: Object[] }>}
 */
async function validateMultiEventAccess(config, options = {}) {
    const {
        parentId = null,
        parentMode = null,
        maxIncludedEvents = DEFAULT_MAX_INCLUDED_EVENTS,
        throwOnError = false,
        session = null
    } = options;

    const fail = (message) => {
        if (throwOnError) {
            const error = new Error(message);
            error.statusCode = 400;
            throw error;
        }
        return {
            isValid: false,
            error: message,
            value: null
        };
    };

    // 1. Missing or undefined configuration defaults to disabled canonical representation
    if (config === undefined || config === null) {
        return {
            isValid: true,
            error: null,
            value: {
                enabled: false,
                includedEvents: []
            }
        };
    }

    // Rule 1: Valid configuration shape
    if (typeof config !== "object" || Array.isArray(config)) {
        return fail("multiEventAccess must be an object");
    }

    // Strict property check: no unknown properties
    const allowedKeys = new Set(["enabled", "includedEvents"]);
    for (const key of Object.keys(config)) {
        if (!allowedKeys.has(key)) {
            return fail(`Unexpected property in multiEventAccess: "${key}"`);
        }
    }

    // Strict boolean check: no arbitrary string or truthy coercion
    if (typeof config.enabled !== "boolean") {
        return fail("multiEventAccess.enabled must be a boolean");
    }

    // Rule 2: Disabled configuration
    if (!config.enabled) {
        if (config.includedEvents !== undefined && config.includedEvents !== null) {
            if (!Array.isArray(config.includedEvents)) {
                return fail("multiEventAccess.includedEvents must be an array");
            }
            if (config.includedEvents.length > 0) {
                return fail("Included events cannot be specified when multi-event access is disabled");
            }
        }
        return {
            isValid: true,
            error: null,
            value: {
                enabled: false,
                includedEvents: []
            }
        };
    }

    // Rule 3: Minimum inclusion when enabled
    if (!Array.isArray(config.includedEvents) || config.includedEvents.length === 0) {
        return fail("At least one included event is required when multi-event access is enabled");
    }

    // Rule 4: Maximum inclusion limit
    const limit = Number.isInteger(maxIncludedEvents) && maxIncludedEvents > 0
        ? maxIncludedEvents
        : DEFAULT_MAX_INCLUDED_EVENTS;

    if (config.includedEvents.length > limit) {
        return fail(`multiEventAccess.includedEvents cannot exceed ${limit} events (received ${config.includedEvents.length})`);
    }

    // Normalize IDs and check for valid ObjectId syntax (Rule 1 & Rule 5)
    const normalizedIds = [];
    const seenIds = new Set();

    for (let i = 0; i < config.includedEvents.length; i++) {
        const rawEntry = config.includedEvents[i];
        const idString = rawEntry?.toString ? rawEntry.toString().trim() : String(rawEntry).trim();

        // Must be a 24-character hexadecimal string
        if (!mongoose.Types.ObjectId.isValid(idString) || !/^[0-9a-fA-F]{24}$/.test(idString)) {
            return fail(`Invalid event ID in includedEvents at index ${i}: "${rawEntry}"`);
        }

        // Rule 5: Unique included events (No silent deduplication)
        if (seenIds.has(idString)) {
            return fail(`Duplicate event ID found in includedEvents: "${idString}"`);
        }

        seenIds.add(idString);
        normalizedIds.push(new mongoose.Types.ObjectId(idString));
    }

    // Rule 6: Self-inclusion prevention
    if (parentId) {
        const parentIdStr = parentId.toString().trim();
        if (seenIds.has(parentIdStr)) {
            return fail("A parent event cannot include itself in multi-event access");
        }
    }

    // Resolve Mongoose Event model
    let EventModel = options.EventModel;
    if (!EventModel) {
        try {
            EventModel = mongoose.model("Event");
        } catch {
            EventModel = require("../models/Event");
        }
    }

    // Rule 7: Referential integrity query
    const childQuery = EventModel.find({
        _id: { $in: normalizedIds }
    }).select("name status registration multiEventAccess");
    if (session && typeof childQuery.session === "function") {
        childQuery.session(session);
    }
    const childEvents = await childQuery.lean();

    if (childEvents.length !== normalizedIds.length) {
        const foundIdSet = new Set(childEvents.map(e => e._id.toString()));
        const missingIds = normalizedIds
            .map(id => id.toString())
            .filter(id => !foundIdSet.has(id));

        return fail(`One or more included events do not exist: ${missingIds.join(", ")}`);
    }

    // Rule 8: Lifecycle constraints (Reject cancelled or completed child events)
    for (const child of childEvents) {
        if (child.status === "CANCELLED") {
            return fail(`Cannot include cancelled event: "${child.name || child._id}" (status: CANCELLED)`);
        }
        if (child.status === "COMPLETED") {
            return fail(`Cannot include completed event: "${child.name || child._id}" (status: COMPLETED)`);
        }
    }

    // Rule 9a: No nesting — Child cannot already be a multi-event combo parent
    for (const child of childEvents) {
        if (child.multiEventAccess?.enabled === true) {
            return fail(`Cannot include event "${child.name || child._id}" because it is already a multi-event parent (nested combos are prohibited)`);
        }
    }

    // Rule 9b: No nesting / cycle — If parent event is being configured, verify it is not already an included child of another combo
    if (parentId) {
        const parentObjId = new mongoose.Types.ObjectId(parentId.toString().trim());
        const parentIsChildQuery = EventModel.findOne({
            _id: { $ne: parentObjId },
            "multiEventAccess.enabled": true,
            "multiEventAccess.includedEvents": parentObjId
        }).select("name");
        if (session && typeof parentIsChildQuery.session === "function") {
            parentIsChildQuery.session(session);
        }
        const parentIsChild = await parentIsChildQuery.lean();

        if (parentIsChild) {
            return fail(`This event is already an included child of parent event "${parentIsChild.name || parentIsChild._id}" and cannot become a multi-event parent`);
        }
    }

    // Rule 10: Registration mode compatibility
    if (parentMode) {
        const normalizedParentMode = String(parentMode).toUpperCase();
        for (const child of childEvents) {
            const childMode = child.registration?.mode ? String(child.registration.mode).toUpperCase() : null;
            if (childMode !== normalizedParentMode) {
                return fail(`Registration mode mismatch: Parent event is ${normalizedParentMode}, but included event "${child.name || child._id}" is ${childMode || "unknown"}`);
            }
        }
    }

    // Rule 11: Validation is strictly read-only and returns normalized result
    return {
        isValid: true,
        error: null,
        value: {
            enabled: true,
            includedEvents: normalizedIds
        },
        childEvents
    };
}

module.exports = {
    validateMultiEventAccess,
    DEFAULT_MAX_INCLUDED_EVENTS
};
