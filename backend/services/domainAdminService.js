"use strict";

const mongoose = require("mongoose");
const Event = require("../models/Event");
const EventDomain = require("../models/EventDomain");
const DomainAssignment = require("../models/DomainAssignment");
const DomainPoolSnapshot = require("../models/DomainPoolSnapshot");
const DomainPoolCoordination = require("../models/DomainPoolCoordination");
const DomainAdminAudit = require("../models/DomainAdminAudit");
const { withDomainPoolLock } = require("./domainPoolCoordinator");
const { hashDomains, verifySnapshot } = require("../utils/domainPoolSnapshot");

function domainError(statusCode, code, message) {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    return error;
}

async function loadEligibleEvent(eventId, session) {
    const event = await Event.findById(eventId).session(session);
    if (!event) throw domainError(404, "EVENT_NOT_FOUND", "Event not found");
    if (event.multiEventAccess?.enabled === true) {
        throw domainError(409, "EVENT_NOT_ELIGIBLE", "Combo Pass parent events cannot have participant domain pools");
    }
    return event;
}

function domainState(event) {
    return event.domainConfig || {};
}

function isDraft(config) {
    const version = config.poolVersion ?? 0;
    return config.visibility === "PRIVATE" && config.drawStatus === "CLOSED" &&
        !config.publishedAt && !config.publishedBy && !config.readEnabledAt && !config.readEnabledBy &&
        (config.revisionPending === true ? Number.isSafeInteger(version) && version > 0 : version === 0);
}

function canRevise(event, config) {
    return event.status === "PUBLISHED" && config.enabled === true && config.visibility === "PRIVATE" &&
        config.drawStatus === "CLOSED" && Boolean(config.publishedAt) &&
        config.revisionPending !== true && !config.readEnabledAt && !config.readEnabledBy;
}

function canReset(event, config) {
    return event.status === "PUBLISHED" && config.enabled === true &&
        (config.visibility === "PRIVATE" || config.visibility === "READABLE") &&
        config.drawStatus === "CLOSED" && Boolean(config.publishedAt) && config.revisionPending !== true;
}

function assertCoordinationVersion(expected, acquiredVersion) {
    if (!Number.isSafeInteger(acquiredVersion) || acquiredVersion < 1) {
        throw domainError(503, "DOMAIN_COORDINATION_UNAVAILABLE", "The domain coordination version is unavailable");
    }
    if (expected !== acquiredVersion - 1) {
        throw domainError(409, "DOMAIN_CONFIG_CONFLICT", "The lottery or its drafts changed. Refresh and review before confirming again");
    }
}

// A request to reopen a frozen pool must not become an open of a revised draft.
function assertExpectedPool(config, expectedPool, { requireForRevisionOpen = false } = {}) {
    const current = `${config.publishedAt ? "frozen" : "draft"}:${config.poolVersion ?? 0}`;
    if (expectedPool === undefined ? requireForRevisionOpen && config.revisionPending === true : expectedPool !== current) {
        throw domainError(409, "DOMAIN_CONFIG_CONFLICT", "The domain pool changed. Refresh status before continuing");
    }
}

function assertMutablePool(event) {
    const config = domainState(event);
    if (!config.enabled) throw domainError(409, "DOMAINS_DISABLED", "Domains are disabled for this event");
    if (config.visibility === "PRIVATE" && !config.publishedAt && config.drawStatus === "OPEN") {
        throw domainError(409, "DRAW_OPEN", "Domain pool cannot be changed while the draw is open");
    }
    if (!isDraft(config)) throw domainError(409, "DOMAIN_POOL_LOCKED", "Only a private draft pool can be changed");
}

async function loadActiveSnapshot(event, session) {
    const config = domainState(event);
    if (!config.publishedAt || config.revisionPending === true) {
        throw domainError(409, "DOMAIN_POOL_NOT_FROZEN", "A frozen domain pool snapshot is required");
    }
    const poolVersion = config.poolVersion;
    if (!Number.isSafeInteger(poolVersion) || poolVersion < 1) {
        throw domainError(409, "DOMAIN_POOL_INTEGRITY_FAILED", "The frozen domain pool version is invalid");
    }
    const query = DomainPoolSnapshot.forVersion(poolVersion).findOne({ event: event._id, poolVersion });
    if (session) query.session(session);
    const snapshot = await query;
    if (!verifySnapshot(event, snapshot)) {
        throw domainError(409, "DOMAIN_POOL_INTEGRITY_FAILED", "The frozen domain pool failed its integrity check");
    }
    return snapshot;
}

function lifecycleData(event, { frozenDomainCount, assignedEntryCount, domainCount, coordinationVersion }) {
    const config = domainState(event);
    const frozen = frozenDomainCount > 0;
    const privatePool = config.visibility === "PRIVATE";
    const closed = config.drawStatus === "CLOSED";
    const activeDraft = isDraft(config);
    const canOpen = config.enabled === true && event.status === "PUBLISHED" && privatePool && closed &&
        (frozen || (activeDraft && domainCount > 0 && (!config.revisionPending || assignedEntryCount === 0)));
    const poolVersion = config.poolVersion || 0;
    const canRecover = Number.isSafeInteger(coordinationVersion) && coordinationVersion >= 0 && assignedEntryCount === 0;
    return {
        eventId: event._id.toString(),
        enabled: config.enabled === true,
        visibility: config.visibility || "PRIVATE",
        drawStatus: config.drawStatus || "CLOSED",
        publishedAt: config.publishedAt || null,
        drawOpenedAt: config.drawOpenedAt || null,
        drawClosedAt: config.drawClosedAt || null,
        readEnabledAt: config.readEnabledAt || null,
        poolVersion,
        revisionPending: config.revisionPending === true,
        activeDraft,
        activePoolVersion: frozen ? poolVersion : null,
        lastPreservedVersion: (frozen ? poolVersion - 1 : poolVersion) || null,
        coordinationVersion,
        domainCount,
        frozenDomainCount,
        assignedEntryCount,
        allowedActions: {
            open: canOpen,
            reopen: canOpen && frozen,
            close: config.enabled === true && config.drawStatus === "OPEN",
            enableRead: config.enabled === true && privatePool && closed && frozen,
            revise: frozen && canRevise(event, config) && assignedEntryCount === 0,
            resetToDraft: canRecover && frozen && canReset(event, config),
            clearDraft: canRecover && config.enabled === true && activeDraft && domainCount > 0
        }
    };
}

async function updateEnabled(eventId, enabled) {
    return withDomainPoolLock(eventId, async session => {
        const event = await loadEligibleEvent(eventId, session);
        const config = domainState(event);
        if (!enabled) {
            if (config.drawStatus === "OPEN") throw domainError(409, "DRAW_OPEN", "Domains cannot be disabled while the draw is open");
            if (config.publishedAt || config.visibility === "READABLE") {
                throw domainError(409, "DOMAIN_CONFIG_CONFLICT", "Domains cannot be disabled after the pool is published");
            }
            const assignments = await DomainAssignment.countDocuments({ event: event._id }).session(session);
            if (assignments > 0) throw domainError(409, "DOMAIN_CONFIG_CONFLICT", "Domains cannot be disabled while assignments exist");
        }
        event.set("domainConfig.enabled", enabled);
        await event.save({ session });
        return event;
    });
}

async function createDomain(eventId, adminId, fields) {
    return withDomainPoolLock(eventId, async session => {
        const event = await loadEligibleEvent(eventId, session);
        assertMutablePool(event);
        const [domain] = await EventDomain.create([{
            event: event._id, ...fields, createdBy: adminId, updatedBy: adminId
        }], { session });
        return domain;
    });
}

async function updateDomain(eventId, domainId, adminId, fields) {
    return withDomainPoolLock(eventId, async session => {
        const event = await loadEligibleEvent(eventId, session);
        assertMutablePool(event);
        const domain = await EventDomain.findOne({ _id: domainId, event: event._id }).session(session);
        if (!domain) throw domainError(404, "DOMAIN_NOT_FOUND", "Domain not found for this event");
        if (await DomainAssignment.exists({ event: event._id, domain: domain._id }).session(session)) {
            throw domainError(409, "DOMAIN_HAS_ASSIGNMENTS", "A domain with assignments cannot be edited");
        }
        Object.assign(domain, fields, { updatedBy: adminId });
        await domain.save({ session });
        return domain;
    });
}

async function deleteDomain(eventId, domainId) {
    return withDomainPoolLock(eventId, async session => {
        const event = await loadEligibleEvent(eventId, session);
        assertMutablePool(event);
        const domain = await EventDomain.findOne({ _id: domainId, event: event._id }).session(session);
        if (!domain) throw domainError(404, "DOMAIN_NOT_FOUND", "Domain not found for this event");
        if (await DomainAssignment.exists({ event: event._id, domain: domain._id }).session(session)) {
            throw domainError(409, "DOMAIN_HAS_ASSIGNMENTS", "A domain with assignments cannot be deleted");
        }
        await EventDomain.deleteOne({ _id: domain._id, event: event._id }, { session });
        return domain;
    });
}

async function getEvent(eventId) {
    const event = await Event.findById(eventId);
    if (!event) throw domainError(404, "EVENT_NOT_FOUND", "Event not found");
    if (event.multiEventAccess?.enabled === true) {
        throw domainError(409, "EVENT_NOT_ELIGIBLE", "Combo Pass parent events cannot have participant domain pools");
    }
    return event;
}

async function listDomains(eventId, { page, limit }) {
    const event = await getEvent(eventId);
    const filter = { event: new mongoose.Types.ObjectId(eventId) };
    const [domains, total] = await Promise.all([
        EventDomain.find(filter).sort({ createdAt: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
        EventDomain.countDocuments(filter)
    ]);
    return { event, domains, total };
}

async function getDomain(eventId, domainId) {
    await getEvent(eventId);
    const domain = await EventDomain.findOne({ event: eventId, _id: domainId }).lean();
    if (!domain) throw domainError(404, "DOMAIN_NOT_FOUND", "Domain not found for this event");
    return domain;
}

async function openDraw(eventId, adminId, expectedPool) {
    return withDomainPoolLock(eventId, async session => {
        const event = await loadEligibleEvent(eventId, session);
        const config = domainState(event);
        if (!config.enabled) throw domainError(409, "DOMAINS_DISABLED", "Domains are disabled for this event");
        if (event.status !== "PUBLISHED") throw domainError(409, "EVENT_NOT_ELIGIBLE", "Only published events can open a domain lottery");
        if (config.visibility === "READABLE") throw domainError(409, "READ_ALREADY_ENABLED", "The domain pool is already readable; the lottery cannot be reopened");
        if (config.visibility !== "PRIVATE") throw domainError(409, "DOMAIN_POOL_LOCKED", "This legacy visibility state cannot open a private lottery");

        assertExpectedPool(config, expectedPool, { requireForRevisionOpen: true });
        if (config.publishedAt) {
            const snapshot = await loadActiveSnapshot(event, session);
            if (config.drawStatus === "OPEN") return { event, snapshot };
            if (config.drawStatus !== "CLOSED") throw domainError(409, "DOMAIN_CONFIG_CONFLICT", "Invalid lottery state");
            event.set("domainConfig.drawStatus", "OPEN");
            event.set("domainConfig.drawOpenedAt", new Date());
            await event.save({ session });
            return { event, snapshot };
        }

        if (!isDraft(config)) {
            throw domainError(409, "DOMAIN_POOL_INTEGRITY_FAILED", "The lottery has no valid draft or active frozen pool");
        }
        if (config.revisionPending && await DomainAssignment.exists({ event: event._id }).session(session)) {
            throw domainError(409, "DOMAIN_HAS_ASSIGNMENTS", "A revised pool cannot be published while assignments exist");
        }
        const domainQuery = EventDomain.find({ event: event._id }).sort({ createdAt: 1, _id: 1 });
        domainQuery.session(session);
        const domains = await domainQuery.lean();
        if (!domains.length) throw domainError(409, "DOMAIN_POOL_EMPTY", "At least one domain is required before opening the lottery");
        const publishedAt = new Date();
        const poolVersion = (config.poolVersion ?? 0) + 1;
        if (!Number.isSafeInteger(poolVersion)) {
            throw domainError(409, "DOMAIN_POOL_INTEGRITY_FAILED", "The next domain pool version is invalid");
        }
        const Snapshot = DomainPoolSnapshot.forVersion(poolVersion);
        if (config.revisionPending && await Snapshot.exists({ event: event._id, poolVersion: { $gte: poolVersion } }).session(session)) {
            throw domainError(409, "DOMAIN_POOL_INTEGRITY_FAILED", "The domain pool version history is ahead of this draft");
        }
        const frozenDomains = domains.map(domain => ({
            domain: domain._id,
            title: domain.title,
            problemStatement: domain.problemStatement,
            instructions: domain.instructions || ""
        }));
        // MongoDB limits a BSON document to 16 MiB. Keep margin for BSON field
        // overhead; larger pools fail with a clear lifecycle error instead of
        // relying on a server-side document-size failure.
        if (Buffer.byteLength(JSON.stringify({ domains: frozenDomains }), "utf8") > 14 * 1024 * 1024) {
            throw domainError(409, "DOMAIN_POOL_TOO_LARGE", "The domain pool is too large to freeze in one snapshot");
        }
        const contentHash = hashDomains(frozenDomains);
        const [snapshot] = await Snapshot.create([{
            event: event._id,
            poolVersion,
            publishedAt,
            publishedBy: adminId,
            domains: frozenDomains,
            contentHash
        }], { session });
        event.set("domainConfig.publishedAt", publishedAt);
        event.set("domainConfig.publishedBy", adminId);
        event.set("domainConfig.poolVersion", poolVersion);
        event.set("domainConfig.revisionPending", false);
        event.set("domainConfig.drawOpenedAt", publishedAt);
        event.set("domainConfig.drawStatus", "OPEN");
        await event.save({ session });
        return { event, snapshot };
    });
}

async function closeDraw(eventId, expectedPool) {
    return withDomainPoolLock(eventId, async session => {
        const event = await loadEligibleEvent(eventId, session);
        const config = domainState(event);
        if (!config.enabled) throw domainError(409, "DOMAINS_DISABLED", "Domains are disabled for this event");
        if (!config.publishedAt) throw domainError(409, "DRAW_NOT_STARTED", "The lottery has not been opened");
        assertExpectedPool(config, expectedPool);
        await loadActiveSnapshot(event, session);
        if (config.drawStatus === "CLOSED") return event; // deterministic idempotent close
        if (config.drawStatus !== "OPEN") throw domainError(409, "DRAW_ALREADY_CLOSED", "The lottery is not open");
        event.set("domainConfig.drawStatus", "CLOSED");
        event.set("domainConfig.drawClosedAt", new Date());
        await event.save({ session });
        return event;
    });
}

async function enableRead(eventId, adminId, expectedPool) {
    return withDomainPoolLock(eventId, async session => {
        const event = await loadEligibleEvent(eventId, session);
        const config = domainState(event);
        if (!config.enabled) throw domainError(409, "DOMAINS_DISABLED", "Domains are disabled for this event");
        if (config.drawStatus === "OPEN") throw domainError(409, "READ_REQUIRES_CLOSED_DRAW", "Close the lottery before enabling read access");
        if (!config.publishedAt) throw domainError(409, "DRAW_NOT_STARTED", "Open and close the lottery before enabling read access");
        assertExpectedPool(config, expectedPool);
        await loadActiveSnapshot(event, session);
        if (config.visibility === "READABLE") return event;
        if (config.visibility !== "PRIVATE") throw domainError(409, "DOMAIN_POOL_LOCKED", "This legacy visibility state cannot be changed automatically");
        event.set("domainConfig.visibility", "READABLE");
        event.set("domainConfig.readEnabledAt", new Date());
        event.set("domainConfig.readEnabledBy", adminId);
        await event.save({ session });
        return event;
    });
}

async function revisePool(eventId, expectedPool) {
    return withDomainPoolLock(eventId, async session => {
        const event = await loadEligibleEvent(eventId, session);
        const config = domainState(event);
        if (!canRevise(event, config)) {
            throw domainError(409, "DOMAIN_REVISION_NOT_ALLOWED", "Revision requires a published event with an enabled, closed, private frozen pool");
        }
        assertExpectedPool(config, expectedPool);
        await loadActiveSnapshot(event, session);
        if (await DomainAssignment.exists({ event: event._id }).session(session)) {
            throw domainError(409, "DOMAIN_HAS_ASSIGNMENTS", "This event already has domain assignments");
        }
        await returnToDraft(event, session);
        return event;
    });
}

async function returnToDraft(event, session) {
    event.set("domainConfig.visibility", "PRIVATE");
    for (const field of ["publishedAt", "publishedBy", "drawOpenedAt", "drawClosedAt", "readEnabledAt", "readEnabledBy"]) {
        event.set(`domainConfig.${field}`, null);
    }
    event.set("domainConfig.revisionPending", true);
    await event.save({ session });
}

function auditRecovery(event, admin, action, reason, coordinationVersion) {
    const config = domainState(event);
    const {
        visibility, poolVersion = 0, publishedAt, publishedBy,
        drawOpenedAt, drawClosedAt, readEnabledAt, readEnabledBy
    } = config;
    return {
        event: event._id, admin, action, reason, coordinationVersion, deletedDomainCount: 0,
        previous: { visibility, poolVersion, publishedAt, publishedBy, drawOpenedAt, drawClosedAt, readEnabledAt, readEnabledBy }
    };
}

async function assertNoRecoveryAssignments(event, session) {
    if (await DomainAssignment.exists({ event: event._id }).session(session)) {
        throw domainError(409, "DOMAIN_HAS_ASSIGNMENTS",
            "This event has theme assignments. A separate, audited reassignment workflow would be required to change the assigned pool");
    }
}

async function resetToDraft(eventId, admin, reason, expectedVersion) {
    return withDomainPoolLock(eventId, async (session, coordinationVersion) => {
        const event = await loadEligibleEvent(eventId, session);
        if (!canReset(event, domainState(event))) {
            throw domainError(409, "DOMAIN_RESET_NOT_ALLOWED", "Reset requires a published event with an enabled, closed, private or read-enabled frozen pool");
        }
        await assertNoRecoveryAssignments(event, session);
        assertCoordinationVersion(expectedVersion, coordinationVersion);
        await loadActiveSnapshot(event, session);
        const audit = auditRecovery(event, admin, "RESET_TO_DRAFT", reason, coordinationVersion);
        const domainCount = await EventDomain.countDocuments({ event: event._id }).session(session);
        await returnToDraft(event, session);
        const [record] = await DomainAdminAudit.create([audit], { session });
        const status = lifecycleData(event, { frozenDomainCount: 0, assignedEntryCount: 0, domainCount, coordinationVersion });
        return { event, status, audit: record };
    });
}

async function clearDraftDomains(eventId, admin, reason, expectedVersion) {
    return withDomainPoolLock(eventId, async (session, coordinationVersion) => {
        const event = await loadEligibleEvent(eventId, session);
        const config = domainState(event);
        if (!config.enabled || !isDraft(config)) {
            throw domainError(409, "DOMAIN_DRAFT_CLEAR_NOT_ALLOWED", "Only an enabled, closed private draft can be cleared");
        }
        await assertNoRecoveryAssignments(event, session);
        assertCoordinationVersion(expectedVersion, coordinationVersion);
        const { deletedCount } = await EventDomain.deleteMany({ event: event._id }, { session });
        if (!deletedCount) {
            throw domainError(409, "DOMAIN_DRAFT_CLEAR_NOT_ALLOWED", "The draft has no domains to clear");
        }
        const audit = auditRecovery(event, admin, "CLEAR_DOMAINS", reason, coordinationVersion);
        const [record] = await DomainAdminAudit.create([{ ...audit, deletedDomainCount: deletedCount }], { session });
        const status = lifecycleData(event, { frozenDomainCount: 0, assignedEntryCount: 0, domainCount: 0, coordinationVersion });
        return { event, status, audit: record };
    });
}

async function getLifecycleStatus(eventId) {
    // Read the lock version first. A concurrent write can make this token stale, but
    // cannot make it authorize clearing or resetting a newer state.
    const lock = await DomainPoolCoordination.findOne({ event: eventId }).select("version").lean();
    const coordinationVersion = lock ? lock.version : 0;
    const event = await getEvent(eventId);
    const config = domainState(event);
    let frozenDomainCount = 0;
    if (config.publishedAt) {
        const snapshot = await loadActiveSnapshot(event);
        frozenDomainCount = snapshot.domains.length;
    }
    if (frozenDomainCount === 0 && (config.drawStatus === "OPEN" || config.visibility === "READABLE" ||
        ((config.poolVersion > 0 || config.revisionPending) && !isDraft(config)))) {
        throw domainError(409, "DOMAIN_POOL_INTEGRITY_FAILED", "The active domain lifecycle has no valid frozen pool");
    }
    const [assignedEntryCount, domainCount] = await Promise.all([
        DomainAssignment.countDocuments({ event: event._id }),
        EventDomain.countDocuments({ event: event._id })
    ]);
    return lifecycleData(event, { frozenDomainCount, assignedEntryCount, domainCount, coordinationVersion });
}

module.exports = {
    updateEnabled, createDomain, updateDomain, deleteDomain, listDomains, getDomain,
    openDraw, closeDraw, enableRead, revisePool, resetToDraft, clearDraftDomains, getLifecycleStatus, loadActiveSnapshot
};
