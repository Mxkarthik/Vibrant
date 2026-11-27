"use strict";

const mongoose = require("mongoose");
const Event = require("../models/Event");
const EventDomain = require("../models/EventDomain");
const DomainAssignment = require("../models/DomainAssignment");
const { withDomainPoolLock } = require("./domainPoolCoordinator");

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
        throw domainError(409, "INELIGIBLE_EVENT", "Combo Pass parent events cannot have participant domain pools");
    }
    return event;
}

function domainState(event) {
    return event.domainConfig || {};
}

function assertMutablePool(event) {
    const config = domainState(event);
    if (!config.enabled) throw domainError(409, "DOMAINS_DISABLED", "Domains are disabled for this event");
    if (config.visibility !== "PRIVATE" || config.publishedAt) {
        throw domainError(409, "DOMAIN_POOL_LOCKED", "Published domain pools cannot be changed");
    }
    if (config.drawStatus === "OPEN") throw domainError(409, "DRAW_OPEN", "Domain pool cannot be changed while the draw is open");
}

async function updateEnabled(eventId, enabled) {
    return withDomainPoolLock(eventId, async session => {
        const event = await loadEligibleEvent(eventId, session);
        const config = domainState(event);
        if (!enabled) {
            if (config.drawStatus === "OPEN") throw domainError(409, "DRAW_OPEN", "Domains cannot be disabled while the draw is open");
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
        throw domainError(409, "INELIGIBLE_EVENT", "Combo Pass parent events cannot have participant domain pools");
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

module.exports = { updateEnabled, createDomain, updateDomain, deleteDomain, listDomains, getDomain };
