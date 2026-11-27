"use strict";

const mongoose = require("mongoose");
const Event = require("../models/Event");
const Registration = require("../models/Registration");
const Team = require("../models/Team");
const DomainAssignment = require("../models/DomainAssignment");
const DomainPoolSnapshot = require("../models/DomainPoolSnapshot");
const { validateObjectId } = require("../utils/domainAdminValidation");
const { resolveRegistrationAdmissionEligibility } = require("../utils/admissionEligibility");
const { verifySnapshot } = require("../utils/domainPoolSnapshot");
const { loadActiveSnapshot } = require("./domainAdminService");
const { serializeTheme, serializeLockedAssignment } = require("../utils/participantDomainSerializer");

const entryTypes = new Set(DomainAssignment.schema.path("entryType").enumValues);
const eventFields = "status registration.mode multiEventAccess.enabled domainConfig";
const messages = {
    EVENT_NOT_ELIGIBLE: "This event is not eligible for the domain lottery.",
    DOMAINS_DISABLED: "Domains are disabled for this event.",
    PARTICIPANT_NOT_REGISTERED: "No entry was found for this event.",
    REGISTRATION_NOT_ELIGIBLE: "Your entry is not eligible for this event.",
    TEAM_NOT_ELIGIBLE: "Your team entry could not be verified.",
    PAYMENT_NOT_VERIFIED: "Payment must be eligible for event admission.",
    TEAM_LEADER_REQUIRED: "Only your team leader can request a draw.",
    DOMAIN_LOTTERY_NOT_OPEN: "The lottery is not open for new draws.",
    DOMAIN_ENTRY_AMBIGUOUS: "Multiple eligible entries match this event. Contact event support for a review.",
    DOMAIN_LOTTERY_UNAVAILABLE: "The lottery is not available for this action.",
    DOMAIN_ASSIGNMENT_INTEGRITY_FAILED: "Your locked assignment could not be verified. Contact event support.",
    DOMAIN_BANK_UNAVAILABLE: "The problem bank is not available.",
    DOMAIN_BANK_CHECK_UNAVAILABLE: "Problem bank access could not be verified. Try again later.",
    ASSIGNMENT_LOCKED: "A theme is already locked to your entry.",
    DRAW_AVAILABLE: "Your entry is eligible to draw when drawing is available.",
    READ_AVAILABLE: "Your entry is eligible to read the frozen bank when reading is available."
};

function failure(statusCode, code, message = messages[code]) {
    return Object.assign(new Error(message), { statusCode, code });
}

function read(query, fields, session) {
    if (session) query.session(session);
    return query.select(fields).lean();
}

function sameId(a, b) {
    return Boolean(a && b && String(a) === String(b));
}

async function eligibleEntry(registration, event, userId, session) {
    const teamEntry = Boolean(registration.team);
    const entryType = teamEntry ? "TEAM" : "INDIVIDUAL";
    if (!entryTypes.has(entryType) || entryType !== event.registration?.mode) {
        return { reason: "REGISTRATION_NOT_ELIGIBLE" };
    }
    let parentEvent;
    if (!sameId(registration.event, event._id)) {
        if (registration.access?.type !== "MULTI_EVENT") return { reason: "REGISTRATION_NOT_ELIGIBLE" };
        parentEvent = await read(Event.findById(registration.event), "status registration.mode multiEventAccess.enabled", session);
        if (parentEvent?.multiEventAccess?.enabled !== true || parentEvent.registration?.mode !== entryType) {
            return { reason: "REGISTRATION_NOT_ELIGIBLE" };
        }
    } else if (registration.access?.type === "MULTI_EVENT") {
        return { reason: "REGISTRATION_NOT_ELIGIBLE" };
    }

    const team = teamEntry ? await read(Team.findOne({ _id: registration.team, event: registration.event }),
        "event leader status payment.status", session) : null;
    if (teamEntry && (!team || !team.leader)) return { reason: "TEAM_NOT_ELIGIBLE" };
    const admission = resolveRegistrationAdmissionEligibility({ registration, team, targetEvent: event, parentEvent });
    if (!admission.isEligible) {
        if (admission.reasonCode.startsWith("PAYMENT_")) return { reason: "PAYMENT_NOT_VERIFIED" };
        if (admission.reasonCode.startsWith("TEAM_")) return { reason: "TEAM_NOT_ELIGIBLE" };
        return { reason: "REGISTRATION_NOT_ELIGIBLE" };
    }
    return { entryType, entry: teamEntry ? team._id : registration._id, canInitiateDraw: !teamEntry || sameId(team.leader, userId) };
}

async function findAssignment(event, { entryType, entry }, session, majority) {
    const key = { event: event._id, entryType, entry };
    const query = DomainAssignment.findOne(key);
    if (majority) query.readConcern("majority");
    const assignment = await read(query, "event entryType entry domain poolVersion assignedAt contentSnapshot", session);
    if (!assignment) return null;

    const { poolVersion } = assignment;
    const config = event.domainConfig;
    const invalid = () => failure(409, "DOMAIN_ASSIGNMENT_INTEGRITY_FAILED");
    if (!Number.isSafeInteger(poolVersion) || poolVersion < 1 || poolVersion > (config?.poolVersion ?? 0) ||
        !sameId(assignment.event, key.event) || assignment.entryType !== entryType || !sameId(assignment.entry, entry)) throw invalid();

    const snapshot = await read(DomainPoolSnapshot.forVersion(poolVersion).findOne({ event: event._id, poolVersion }),
        "event poolVersion publishedAt domains contentHash", session);
    const publishedAt = poolVersion === config.poolVersion && config.publishedAt ? config.publishedAt : snapshot?.publishedAt;
    if (!verifySnapshot({ _id: event._id, domainConfig: { poolVersion, publishedAt } }, snapshot)) throw invalid();
    const matches = snapshot.domains.filter(domain => sameId(domain.domain, assignment.domain));
    const domain = matches[0];
    const content = assignment.contentSnapshot;
    if (matches.length !== 1 || !content || content.title !== domain.title ||
        content.problemStatement !== domain.problemStatement || (content.instructions || "") !== (domain.instructions || "")) throw invalid();
    return assignment;
}

function validateParticipantDomainRequest({ eventId, authenticatedUser }) {
    validateObjectId(String(eventId), "event ID");
    const userId = authenticatedUser?._id;
    if (!mongoose.isObjectIdOrHexString(userId) || authenticatedUser.isActive === false) {
        throw failure(401, "AUTHENTICATION_REQUIRED", "Authentication required.");
    }
    if (!["PARTICIPANT", "ADMIN"].includes(authenticatedUser.role)) {
        throw failure(403, "FORBIDDEN", "You do not have permission to access this resource.");
    }
}

function isEligibleLotteryEvent(event) {
    return ["PUBLISHED", "COMPLETED"].includes(event?.status) && event.multiEventAccess?.enabled !== true;
}

function isBankReadable(event) {
    const config = event?.domainConfig;
    return config?.enabled === true && config.visibility === "READABLE" && config.drawStatus === "CLOSED";
}

async function resolveParticipantEntry({ eventId, authenticatedUser, session }) {
    validateParticipantDomainRequest({ eventId, authenticatedUser });
    const userId = authenticatedUser._id;
    const event = await read(Event.findById(eventId), eventFields, session);
    if (!event) throw failure(404, "EVENT_NOT_FOUND", "Event not found.");
    if (event.multiEventAccess?.enabled === true) throw failure(409, "EVENT_NOT_ELIGIBLE");
    const eventEligible = isEligibleLotteryEvent(event);
    const result = { event, eventEligible, entry: null };
    if (!eventEligible) return { ...result, reason: "EVENT_NOT_ELIGIBLE" };

    const registrations = await read(Registration.find({
        user: userId,
        $or: [{ event: event._id }, { "access.type": "MULTI_EVENT", "access.eligibleEventIds": event._id }]
    }), "user event team status access payment.status", session);
    if (!registrations.length) return { ...result, reason: "PARTICIPANT_NOT_REGISTERED" };

    const entries = new Map();
    const reasons = new Set();
    for (const registration of registrations) {
        if (!sameId(registration.user, userId)) continue;
        const candidate = await eligibleEntry(registration, event, userId, session);
        if (candidate.reason) reasons.add(candidate.reason);
        else entries.set(`${candidate.entryType}:${candidate.entry}`, candidate);
        if (entries.size > 1) throw failure(409, "DOMAIN_ENTRY_AMBIGUOUS");
    }
    if (!entries.size) {
        const reason = ["PAYMENT_NOT_VERIFIED", "TEAM_NOT_ELIGIBLE"].find(code => reasons.has(code)) || "REGISTRATION_NOT_ELIGIBLE";
        return { ...result, reason };
    }

    return { ...result, entry: entries.values().next().value };
}

async function resolveParticipantDomainEligibility({ eventId, authenticatedUser, session, reconcileAssignment = false }) {
    const resolved = await resolveParticipantEntry({ eventId, authenticatedUser, session });
    const { event } = resolved;
    const result = { ...resolved, assignment: null, activeSnapshot: null, canDraw: false, canReadAllDomains: false };
    if (!result.entry) return result;
    result.assignment = await findAssignment(event, result.entry, session, reconcileAssignment);
    if (reconcileAssignment) return result;
    const config = event.domainConfig;
    if (config?.enabled !== true) return { ...result, reason: "DOMAINS_DISABLED" };

    const wantsDraw = event.status === "PUBLISHED" && config.visibility === "PRIVATE" && config.drawStatus === "OPEN";
    const wantsRead = isBankReadable(event);
    if (wantsRead || (wantsDraw && result.entry.canInitiateDraw && !result.assignment)) {
        try {
            result.activeSnapshot = await loadActiveSnapshot(event, session);
        } catch (error) {
            if (!["DOMAIN_POOL_INTEGRITY_FAILED", "DOMAIN_POOL_NOT_FROZEN"].includes(error.code)) throw error;
            return { ...result, reason: "DOMAIN_LOTTERY_UNAVAILABLE", snapshotError: error.code };
        }
        result.canDraw = wantsDraw;
        result.canReadAllDomains = wantsRead;
    }
    const reason = result.assignment ? "ASSIGNMENT_LOCKED"
        : result.canDraw ? "DRAW_AVAILABLE"
            : result.canReadAllDomains ? "READ_AVAILABLE"
                : wantsDraw && !result.entry.canInitiateDraw ? "TEAM_LEADER_REQUIRED" : "DOMAIN_LOTTERY_UNAVAILABLE";
    return { ...result, reason };
}

async function getParticipantDomainStatus(input) {
    const { event, eventEligible, entry, assignment, canDraw, canReadAllDomains, reason } =
        await resolveParticipantDomainEligibility(input);
    const config = event.domainConfig;
    return {
        eventId: String(event._id),
        eventEligible,
        domainsEnabled: config?.enabled === true,
        visibility: entry ? config?.visibility ?? "PRIVATE" : null,
        drawStatus: entry ? config?.drawStatus ?? "CLOSED" : null,
        isEligible: Boolean(entry),
        entryType: entry?.entryType ?? null,
        canDraw,
        hasAssignment: Boolean(assignment),
        canReadAllDomains,
        reasonCode: reason,
        message: messages[reason]
    };
}

async function getParticipantLockedTheme(input) {
    const { event, eventEligible, entry, reason } = await resolveParticipantEntry(input);
    if (!entry) throw failure(eventEligible ? 403 : 409, reason);
    const assignment = await findAssignment(event, entry, input.session, !input.session);
    if (assignment) return serializeLockedAssignment(assignment);
    return { eventId: String(event._id), hasAssignment: false, isLocked: false, theme: null, assignedAt: null };
}

async function getParticipantDomainBank({ eventId, authenticatedUser }) {
    const unavailable = () => failure(403, "DOMAIN_BANK_UNAVAILABLE");
    const { event, entry } = await resolveParticipantEntry({ eventId, authenticatedUser });
    if (!entry || !isBankReadable(event)) throw unavailable();

    const snapshot = await loadActiveSnapshot(event);
    const domains = snapshot.domains.map(serializeTheme);

    // Read only the event document from the primary as the last disclosure check.
    // A majority-committed reset precedes this check or is concurrent with this GET.
    let current;
    try {
        current = await read(Event.findById(event._id).read("primary").readConcern("linearizable").maxTimeMS(5000), eventFields);
    } catch {
        throw failure(503, "DOMAIN_BANK_CHECK_UNAVAILABLE");
    }
    if (!isEligibleLotteryEvent(current) || !isBankReadable(current) || current.registration?.mode !== entry.entryType ||
        current.domainConfig.revisionPending === true || current.domainConfig.poolVersion !== snapshot.poolVersion ||
        !current.domainConfig.publishedAt || +new Date(current.domainConfig.publishedAt) !== +new Date(snapshot.publishedAt)) {
        throw unavailable();
    }
    return { eventId: String(event._id), visibility: "READABLE", domains, total: domains.length };
}

module.exports = {
    resolveParticipantDomainEligibility, getParticipantDomainStatus, getParticipantLockedTheme, getParticipantDomainBank,
    validateParticipantDomainRequest, failure
};
