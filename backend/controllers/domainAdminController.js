"use strict";

const mongoose = require("mongoose");
const service = require("../services/domainAdminService");
const {
    validateObjectId, validateConfigBody, validateEmptyBody, validateExpectedPool, validateDomainBody, validatePagination,
    validateRecoveryBody, validateCoordinationVersion
} = require("../utils/domainAdminValidation");

function configPayload(event) {
    const config = event.domainConfig || {};
    return {
        enabled: config.enabled === true,
        visibility: config.visibility || "PRIVATE",
        drawStatus: config.drawStatus || "CLOSED",
        publishedAt: config.publishedAt || null,
        publishedBy: config.publishedBy || null,
        drawOpenedAt: config.drawOpenedAt || null,
        drawClosedAt: config.drawClosedAt || null,
        readEnabledAt: config.readEnabledAt || null,
        readEnabledBy: config.readEnabledBy || null,
        poolVersion: config.poolVersion || 0,
        revisionPending: config.revisionPending === true
    };
}

function errorResponse(res, error) {
    if (error instanceof mongoose.Error.ValidationError || error instanceof mongoose.Error.CastError) {
        return res.status(400).json({ success: false, code: "INVALID_DOMAIN_INPUT", message: "Invalid domain data" });
    }
    const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    const code = error.code && typeof error.code === "string" ? error.code : "INTERNAL_ERROR";
    const message = status === 500 ? "Domain request failed" : error.message;
    return res.status(status).json({ success: false, code, message });
}

const withErrors = handler => async (req, res) => {
    try {
        return await handler(req, res);
    } catch (error) {
        return errorResponse(res, error);
    }
};

const updateDomainConfig = withErrors(async (req, res) => {
    validateObjectId(req.params.eventId, "event ID");
    validateConfigBody(req.body);
    const event = await service.updateEnabled(req.params.eventId, req.body.enabled);
    return res.status(200).json({
        success: true,
        message: req.body.enabled ? "Domains enabled successfully" : "Domains disabled successfully",
        data: { eventId: event._id.toString(), domainConfig: configPayload(event) }
    });
});

const createDomain = withErrors(async (req, res) => {
    validateObjectId(req.params.eventId, "event ID");
    const fields = validateDomainBody(req.body);
    const domain = await service.createDomain(req.params.eventId, req.user._id, fields);
    return res.status(201).json({ success: true, data: domain.toObject() });
});

const listDomains = withErrors(async (req, res) => {
    validateObjectId(req.params.eventId, "event ID");
    const pagination = validatePagination(req.query);
    const { event, domains, total } = await service.listDomains(req.params.eventId, pagination);
    return res.status(200).json({
        success: true,
        data: {
            eventId: event._id.toString(),
            domainConfig: configPayload(event),
            domains,
            total,
            page: pagination.page,
            limit: pagination.limit
        }
    });
});

const getDomain = withErrors(async (req, res) => {
    validateObjectId(req.params.eventId, "event ID");
    validateObjectId(req.params.domainId, "domain ID");
    const domain = await service.getDomain(req.params.eventId, req.params.domainId);
    return res.status(200).json({ success: true, data: domain });
});

const updateDomain = withErrors(async (req, res) => {
    validateObjectId(req.params.eventId, "event ID");
    validateObjectId(req.params.domainId, "domain ID");
    const fields = validateDomainBody(req.body, { partial: true });
    const domain = await service.updateDomain(req.params.eventId, req.params.domainId, req.user._id, fields);
    return res.status(200).json({ success: true, data: domain.toObject() });
});

const deleteDomain = withErrors(async (req, res) => {
    validateObjectId(req.params.eventId, "event ID");
    validateObjectId(req.params.domainId, "domain ID");
    await service.deleteDomain(req.params.eventId, req.params.domainId);
    return res.status(200).json({ success: true, message: "Domain deleted successfully" });
});

const openDomainDraw = withErrors(async (req, res) => {
    validateObjectId(req.params.eventId, "event ID");
    validateEmptyBody(req.body);
    const { event, snapshot } = await service.openDraw(req.params.eventId, req.user._id, validateExpectedPool(req.query?.poolState));
    return res.status(200).json({
        success: true,
        message: "Domain lottery opened",
        data: { eventId: event._id.toString(), ...configPayload(event), publishedDomainCount: snapshot.domains.length }
    });
});

const closeDomainDraw = withErrors(async (req, res) => {
    validateObjectId(req.params.eventId, "event ID");
    validateEmptyBody(req.body);
    const event = await service.closeDraw(req.params.eventId, validateExpectedPool(req.query?.poolState));
    return res.status(200).json({ success: true, message: "Domain lottery closed", data: { eventId: event._id.toString(), ...configPayload(event) } });
});

const enableDomainRead = withErrors(async (req, res) => {
    validateObjectId(req.params.eventId, "event ID");
    validateEmptyBody(req.body);
    const event = await service.enableRead(req.params.eventId, req.user._id, validateExpectedPool(req.query?.poolState));
    return res.status(200).json({ success: true, message: "Domain read access enabled", data: { eventId: event._id.toString(), ...configPayload(event) } });
});

const reviseDomainPool = withErrors(async (req, res) => {
    validateObjectId(req.params.eventId, "event ID");
    validateEmptyBody(req.body);
    const event = await service.revisePool(req.params.eventId, validateExpectedPool(req.query?.poolState));
    return res.status(200).json({
        success: true,
        message: "Domain pool returned to private draft",
        data: { eventId: event._id.toString(), ...configPayload(event) }
    });
});

const getDomainLifecycleStatus = withErrors(async (req, res) => {
    validateObjectId(req.params.eventId, "event ID");
    const data = await service.getLifecycleStatus(req.params.eventId);
    return res.status(200).json({ success: true, data });
});

function recoveryAction(confirmation, mutate, message) {
    return withErrors(async (req, res) => {
        const { eventId } = req.params;
        validateObjectId(eventId, "event ID");
        const reason = validateRecoveryBody(req.body, confirmation, { reasonRequired: confirmation === "RESET_TO_DRAFT" });
        const version = validateCoordinationVersion(req.query?.coordinationVersion);
        const { event, status, audit } = await mutate(eventId, req.user._id, reason, version);
        return res.status(200).json({
            success: true, message,
            data: { ...status, domainConfig: configPayload(event), audit }
        });
    });
}

const resetLotteryToDraft = recoveryAction("RESET_TO_DRAFT", (...args) => service.resetToDraft(...args),
    "Lottery reset to private draft");
const clearDraftDomains = recoveryAction("CLEAR_DOMAINS", (...args) => service.clearDraftDomains(...args),
    "Draft domains cleared");

module.exports = {
    updateDomainConfig, createDomain, listDomains, getDomain, updateDomain, deleteDomain,
    openDomainDraw, closeDomainDraw, enableDomainRead, reviseDomainPool, getDomainLifecycleStatus,
    resetLotteryToDraft, clearDraftDomains
};
