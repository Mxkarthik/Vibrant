"use strict";

const mongoose = require("mongoose");

const LIMITS = Object.freeze({ title: 160, problemStatement: 20000, instructions: 10000 });

function fail(message, code = "INVALID_DOMAIN_INPUT") {
    const error = new Error(message);
    error.statusCode = 400;
    error.code = code;
    return error;
}

function validateObjectId(value, label) {
    if (typeof value !== "string" || !mongoose.Types.ObjectId.isValid(value)) {
        throw fail(`Invalid ${label}`, label === "event ID" ? "INVALID_EVENT_ID" : "INVALID_DOMAIN_ID");
    }
}

function validateConfigBody(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) throw fail("Request body must be an object");
    const keys = Object.keys(body);
    if (keys.some(key => key !== "enabled") || typeof body.enabled !== "boolean") {
        throw fail("Only a boolean enabled field is accepted");
    }
}

function validateEmptyBody(body) {
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 0) {
        throw fail("Lifecycle actions accept an empty JSON object only");
    }
}

function validateDomainBody(body, { partial = false } = {}) {
    if (!body || typeof body !== "object" || Array.isArray(body)) throw fail("Request body must be an object");
    const allowed = new Set(["title", "problemStatement", "instructions"]);
    const keys = Object.keys(body);
    if (!keys.length || keys.some(key => !allowed.has(key))) throw fail("Request contains missing or unsupported domain fields");
    if (!partial && (!Object.hasOwn(body, "title") || !Object.hasOwn(body, "problemStatement"))) {
        throw fail("title and problemStatement are required");
    }
    for (const key of ["title", "problemStatement", "instructions"]) {
        if (!Object.hasOwn(body, key)) continue;
        if (typeof body[key] !== "string") throw fail(`${key} must be a string`);
        const normalized = body[key].trim();
        if (key !== "instructions" && normalized.length === 0) throw fail(`${key} cannot be empty`);
        if (normalized.length > LIMITS[key]) throw fail(`${key} cannot exceed ${LIMITS[key]} characters`);
        body[key] = normalized;
    }
    return body;
}

function validatePagination(query) {
    const page = Number(query.page ?? 1);
    const limit = Number(query.limit ?? 50);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw fail("Invalid pagination parameters");
    }
    return { page, limit };
}

function validateExpectedPool(value) {
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !/^(draft|frozen):(?:0|[1-9]\d{0,15})$/.test(value) ||
        !Number.isSafeInteger(Number(value.split(":")[1]))) {
        throw fail("poolState must identify a draft or frozen pool version");
    }
    return value;
}

function validateRecoveryBody(body, confirmation, { reasonRequired = false } = {}) {
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some(key => key !== "confirmation" && key !== "reason")) {
        throw fail("Only confirmation and reason are accepted");
    }
    if (body.confirmation !== confirmation) {
        throw fail(`Confirmation must match ${confirmation}`, "INVALID_CONFIRMATION");
    }
    const reason = body.reason === undefined ? "" : body.reason;
    if (typeof reason !== "string" || reason.trim().length > 500 || (reasonRequired && !reason.trim())) {
        throw fail(reasonRequired ? "Provide a reason of 1 to 500 characters" : "Reason must be at most 500 characters");
    }
    return reason.trim();
}

function validateCoordinationVersion(value) {
    if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,15})$/.test(value) || !Number.isSafeInteger(Number(value))) {
        throw fail("coordinationVersion must match the current Admin domain status");
    }
    return Number(value);
}

module.exports = {
    LIMITS, validateObjectId, validateConfigBody, validateEmptyBody, validateExpectedPool,
    validateDomainBody, validatePagination, validateRecoveryBody, validateCoordinationVersion
};
