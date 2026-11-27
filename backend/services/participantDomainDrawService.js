"use strict";

const crypto = require("node:crypto");
const { isObjectIdOrHexString } = require("mongoose");
const DomainAssignment = require("../models/DomainAssignment");
const { serializeLockedAssignment } = require("../utils/participantDomainSerializer");
const { withDomainPoolLock } = require("./domainPoolCoordinator");
const {
    resolveParticipantDomainEligibility, validateParticipantDomainRequest, failure
} = require("./participantDomainService");

function toResult(assignment, alreadyAssigned) {
    return { ...serializeLockedAssignment(assignment), alreadyAssigned };
}

function verifyCandidates(domains) {
    const ids = new Set();
    if (!domains?.length) throw failure(409, "DOMAIN_POOL_NOT_FROZEN", "No active frozen pool is available.");
    for (const candidate of domains) {
        const id = String(candidate.domain);
        if (!isObjectIdOrHexString(candidate.domain) || ids.has(id) ||
            candidate.title.length > 160 || candidate.problemStatement.length > 20000 ||
            (candidate.instructions != null && (typeof candidate.instructions !== "string" || candidate.instructions.length > 10000))) {
            throw failure(409, "DOMAIN_POOL_INTEGRITY_FAILED", "The active frozen pool could not be verified.");
        }
        ids.add(id);
    }
}

async function drawParticipantDomain({ eventId, authenticatedUser }) {
    validateParticipantDomainRequest({ eventId, authenticatedUser });
    let attemptedEntry;
    try {
        return await withDomainPoolLock(eventId, async session => {
            attemptedEntry = undefined;
            const eligibility = await resolveParticipantDomainEligibility({ eventId, authenticatedUser, session });
            const { event, entry, assignment, canDraw, activeSnapshot, reason, snapshotError } = eligibility;
            if (!entry) throw failure(eligibility.eventEligible ? 403 : 409, reason);
            attemptedEntry = entry;
            if (assignment) return toResult(assignment, true);
            if (!entry.canInitiateDraw) throw failure(403, "TEAM_LEADER_REQUIRED");
            if (reason === "DOMAINS_DISABLED") throw failure(409, reason);
            if (snapshotError === "DOMAIN_POOL_NOT_FROZEN") {
                throw failure(409, snapshotError, "No active frozen pool is available.");
            }
            if (snapshotError === "DOMAIN_POOL_INTEGRITY_FAILED") {
                throw failure(409, snapshotError, "The active frozen pool could not be verified.");
            }
            if (!canDraw) throw failure(409, "DOMAIN_LOTTERY_NOT_OPEN");

            verifyCandidates(activeSnapshot.domains);
            const selected = activeSnapshot.domains[crypto.randomInt(0, activeSnapshot.domains.length)];
            const { domain, title, problemStatement, instructions } = selected;
            let created;
            try {
                [created] = await DomainAssignment.create([{
                    event: event._id, entryType: entry.entryType, entry: entry.entry, domain,
                    initiatedBy: authenticatedUser._id, assignedAt: new Date(), poolVersion: activeSnapshot.poolVersion,
                    contentSnapshot: { title, problemStatement, instructions: instructions ?? "" }
                }], { session });
            } catch (error) {
                // The coordinator retries lock bootstrap collisions. Assignment collisions must abort and reconcile.
                if (error.code === 11000) {
                    throw failure(409, "DOMAIN_ASSIGNMENT_CONFLICT", "The assignment changed. Refresh status before retrying.");
                }
                throw error;
            }
            return toResult(created, false);
        });
    } catch (error) {
        if (!attemptedEntry || !["DOMAIN_ASSIGNMENT_CONFLICT", "DOMAIN_COMMIT_UNKNOWN"].includes(error.code)) throw error;
        let committed;
        try {
            committed = await resolveParticipantDomainEligibility({ eventId, authenticatedUser, reconcileAssignment: true });
        } catch (readError) {
            if (readError.code === "DOMAIN_ASSIGNMENT_INTEGRITY_FAILED") throw readError;
            // Preserve the unresolved result if the database or eligibility is no longer available.
            throw error;
        }
        if (committed.assignment && committed.entry.entryType === attemptedEntry.entryType &&
            String(committed.entry.entry) === String(attemptedEntry.entry)) return toResult(committed.assignment, true);
        throw error;
    }
}

module.exports = { drawParticipantDomain };
