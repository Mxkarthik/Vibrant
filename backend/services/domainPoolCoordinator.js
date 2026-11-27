"use strict";

const mongoose = require("mongoose");
const DomainPoolCoordination = require("../models/DomainPoolCoordination");

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Serialize all domain-pool lifecycle mutations for one event in a MongoDB
 * transaction. Phase 03 publication and assignment operations must call this
 * same boundary. Fails closed when transactions are unavailable.
 */
async function withDomainPoolLock(eventId, operation, { maxRetries = 3, backoffMs = 40 } = {}) {
    if (mongoose.connection.readyState !== 1) {
        const error = new Error("Domain lifecycle coordination requires a connected MongoDB database");
        error.statusCode = 503;
        error.code = "DOMAIN_COORDINATION_UNAVAILABLE";
        throw error;
    }

    let session;
    try {
        session = await mongoose.startSession();
    } catch (cause) {
        const error = new Error("Domain lifecycle coordination is unavailable");
        error.statusCode = 503;
        error.code = "DOMAIN_COORDINATION_UNAVAILABLE";
        error.cause = cause;
        throw error;
    }

    try {
        for (let attempt = 0; ; attempt += 1) {
            try {
                let result;
                await session.withTransaction(async () => {
                    await DomainPoolCoordination.findOneAndUpdate(
                        { event: eventId },
                        { $inc: { version: 1 }, $set: { lastModifiedAt: new Date() } },
                        { upsert: true, returnDocument: "after", session }
                    );
                    result = await operation(session);
                });
                return result;
            } catch (error) {
                if (error.code === 20 || /transaction numbers are only allowed|does not support transactions/i.test(error.message)) {
                    const unavailable = new Error("Domain lifecycle coordination requires MongoDB transaction support");
                    unavailable.statusCode = 503;
                    unavailable.code = "DOMAIN_COORDINATION_UNAVAILABLE";
                    throw unavailable;
                }
                const retryable = Boolean(
                    error.hasErrorLabel?.("TransientTransactionError") ||
                    error.hasErrorLabel?.("UnknownTransactionCommitResult") ||
                    error.code === 112 || error.code === 11000 ||
                    error.name === "WriteConflict" || /write conflict/i.test(error.message)
                );
                if (!retryable || attempt >= maxRetries) {
                    if (retryable) {
                        const conflict = new Error("Concurrent domain pool change; retry the request");
                        conflict.statusCode = 409;
                        conflict.code = "DOMAIN_CONFIG_CONFLICT";
                        throw conflict;
                    }
                    throw error;
                }
                await sleep(backoffMs * (2 ** attempt));
            }
        }
    } finally {
        await session.endSession();
    }
}

module.exports = { withDomainPoolLock };
