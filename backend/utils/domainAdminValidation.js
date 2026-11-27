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

module.exports = { LIMITS, validateObjectId, validateConfigBody, validateDomainBody, validatePagination };
