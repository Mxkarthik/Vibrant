"use strict";

const mongoose = require("mongoose");
const EventGraphCoordination = require("../models/EventGraphCoordination");

const COORDINATION_KEY = "GLOBAL_EVENT_GRAPH";
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BACKOFF_MS = 50;

/**
 * Executes an async graph mutation within a MongoDB transaction coordinated on
 * the shared EventGraphCoordination document.
 *
 * Preventing Write Skew:
 * In MongoDB snapshot isolation, two concurrent transactions that merely read
 * each other's documents and write to different documents can both commit (e.g.
 * Admin A adds B to A, while Admin B adds A to B). By enforcing an atomic write
 * ($inc: { version: 1 }) on the shared coordination document, MongoDB serializes
 * graph-altering transactions, forcing conflicting concurrent transactions into
 * WriteConflict / TransientTransactionError, where they retry and observe the
 * freshly committed graph state.
 *
 * @param {Function} operation - async (session) => any
 * @param {Object} [options]
 * @param {number} [options.maxRetries=3]
 * @param {number} [options.backoffMs=50]
 * @returns {Promise<*>}
 */
async function executeWithGraphCoordination(operation, options = {}) {
    const maxRetries = Number.isInteger(options.maxRetries) && options.maxRetries >= 0
        ? options.maxRetries
        : DEFAULT_MAX_RETRIES;
    const backoffMs = Number.isInteger(options.backoffMs) && options.backoffMs >= 0
        ? options.backoffMs
        : DEFAULT_BACKOFF_MS;

    // Fail-closed enforcement:
    // Production configuration mutations always require an active MongoDB connection.
    // Mocked-session execution is strictly restricted to isolated test environments (NODE_ENV === "test").
    const isIsolatedTestMock = process.env.NODE_ENV === "test" && Boolean(mongoose.startSession?.mock);
    if (mongoose.connection.readyState !== 1 && !isIsolatedTestMock) {
        const error = new Error("Database transaction coordination unavailable: MongoDB is not connected.");
        error.statusCode = 503;
        error.code = "TRANSACTION_COORDINATION_UNAVAILABLE";
        throw error;
    }

    let session = null;
    try {
        session = await mongoose.startSession();
    } catch (sessionError) {
        // Fail-closed enforcement:
        // If sessions/transactions are unsupported by the database cluster or connection fails,
        // reject immediately. Never silently execute graph mutations uncoordinated.
        const error = new Error(`Database transaction coordination unavailable: ${sessionError.message}`);
        error.statusCode = 503;
        error.code = "TRANSACTION_COORDINATION_UNAVAILABLE";
        throw error;
    }

    let attempt = 0;
    try {
        while (true) {
            attempt++;
            try {
                let result;
                await session.withTransaction(async () => {
                    // Conflicting write on shared coordination document to serialize graph changes
                    await EventGraphCoordination.findOneAndUpdate(
                        { key: COORDINATION_KEY },
                        {
                            $inc: { version: 1 },
                            $set: { lastModifiedAt: new Date() }
                        },
                        {
                            upsert: true,
                            returnDocument: "after",
                            session
                        }
                    );

                    result = await operation(session);
                });

                return result;
            } catch (error) {
                // Determine if this is a transient transaction error, write conflict, or concurrent upsert duplicate key
                const isTransient = Boolean(
                    (error.hasErrorLabel && (
                        error.hasErrorLabel("TransientTransactionError") ||
                        error.hasErrorLabel("UnknownTransactionCommitResult")
                    )) ||
                    error.code === 112 || // WriteConflict error code in MongoDB
                    error.code === 11000 || // Duplicate key during parallel coordination document initialization
                    error.name === "WriteConflict" ||
                    /write conflict/i.test(error.message) ||
                    /duplicate key/i.test(error.message)
                );

                if (isTransient && attempt <= maxRetries) {
                    const delay = backoffMs * Math.pow(2, attempt - 1);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }

                if (isTransient && attempt > maxRetries) {
                    const retryError = new Error("Graph mutation aborted: exceeded retry budget due to concurrent conflicts");
                    retryError.statusCode = 409;
                    retryError.code = "CONCURRENT_TRANSACTION_TIMEOUT";
                    throw retryError;
                }

                // If non-transient or business validation error, re-throw immediately
                throw error;
            }
        }
    } finally {
        if (session) {
            await session.endSession();
        }
    }
}

module.exports = {
    executeWithGraphCoordination,
    EventGraphCoordination,
    COORDINATION_KEY
};
