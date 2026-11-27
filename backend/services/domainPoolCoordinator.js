"use strict";

const mongoose = require("mongoose");
const DomainPoolCoordination = require("../models/DomainPoolCoordination");

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function unavailable(message, cause) {
    const error = new Error(message, { cause });
    error.statusCode = 503;
    error.code = "DOMAIN_COORDINATION_UNAVAILABLE";
    return error;
}

/**
 * Serialize every domain-pool mutation for an event, including assignment writes.
 * This lock write must precede the callback's reads and writes in the same transaction.
 */
async function withDomainPoolLock(eventId, operation, { maxRetries = 3, backoffMs = 40 } = {}) {
    if (mongoose.connection.readyState !== 1) {
        throw unavailable("Domain lifecycle coordination requires a connected MongoDB database");
    }

    let session;
    try {
        session = await mongoose.startSession();
    } catch (cause) {
        throw unavailable("Domain lifecycle coordination is unavailable", cause);
    }

    try {
        for (let attempt = 0; ; attempt += 1) {
            try {
                session.startTransaction({
                    readConcern: { level: "snapshot" },
                    writeConcern: { w: "majority" },
                    readPreference: "primary"
                });
                const lock = await DomainPoolCoordination.findOneAndUpdate(
                    { event: eventId },
                    {
                        $setOnInsert: { _id: new mongoose.Types.ObjectId(eventId) },
                        $inc: { version: 1 },
                        $set: { lastModifiedAt: new Date() }
                    },
                    { upsert: true, returnDocument: "after", session }
                );
                if (!lock) throw unavailable("The event's domain coordination lock could not be acquired");
                const result = await operation(session, lock.version);
                await session.commitTransaction();
                return result;
            } catch (error) {
                if (error.hasErrorLabel?.("UnknownTransactionCommitResult")) {
                    // Do not automatically rerun an operation whose commit may
                    // already have succeeded (for example, domain creation).
                    const uncertain = new Error("The domain operation commit result is unknown; verify current status before retrying");
                    uncertain.statusCode = 503;
                    uncertain.code = "DOMAIN_COMMIT_UNKNOWN";
                    throw uncertain;
                }
                if (session.inTransaction()) await session.abortTransaction();
                if (error.code === 20 || /transaction numbers are only allowed|does not support transactions/i.test(error.message)) {
                    throw unavailable("Domain lifecycle coordination requires MongoDB transaction support", error);
                }
                if (error.name === "MongoServerSelectionError" && !error.hasErrorLabel?.("TransientTransactionError")) {
                    throw unavailable("The domain coordination database is unavailable", error);
                }
                const retryable = Boolean(
                    error.hasErrorLabel?.("TransientTransactionError") ||
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
