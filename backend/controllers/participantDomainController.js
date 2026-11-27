"use strict";

const { getParticipantDomainStatus, getParticipantLockedTheme, getParticipantDomainBank } = require("../services/participantDomainService");
const { drawParticipantDomain } = require("../services/participantDomainDrawService");
const { validateEmptyBody } = require("../utils/domainAdminValidation");

const publicErrors = new Set([
    "INVALID_EVENT_ID", "INVALID_DOMAIN_INPUT", "EVENT_NOT_FOUND", "EVENT_NOT_ELIGIBLE", "DOMAIN_ENTRY_AMBIGUOUS",
    "DOMAIN_ASSIGNMENT_INTEGRITY_FAILED", "AUTHENTICATION_REQUIRED", "FORBIDDEN", "DOMAINS_DISABLED",
    "DOMAIN_LOTTERY_NOT_OPEN", "PARTICIPANT_NOT_REGISTERED", "REGISTRATION_NOT_ELIGIBLE", "TEAM_NOT_ELIGIBLE",
    "PAYMENT_NOT_VERIFIED", "TEAM_LEADER_REQUIRED", "DOMAIN_POOL_NOT_FROZEN", "DOMAIN_POOL_INTEGRITY_FAILED",
    "DOMAIN_COORDINATION_UNAVAILABLE", "DOMAIN_COMMIT_UNKNOWN", "DOMAIN_CONFIG_CONFLICT", "DOMAIN_ASSIGNMENT_CONFLICT",
    "DOMAIN_BANK_UNAVAILABLE", "DOMAIN_BANK_CHECK_UNAVAILABLE"
]);

function respondError(res, error, fallback) {
    if (publicErrors.has(error.code)) {
        return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
    }
    return res.status(500).json({ success: false, code: "INTERNAL_ERROR", message: fallback });
}

async function getDomainStatus(req, res) {
    try {
        const data = await getParticipantDomainStatus({ eventId: req.params.eventId, authenticatedUser: req.user });
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return respondError(res, error, "Could not load lottery status.");
    }
}

async function drawDomain(req, res) {
    if (!req.is("application/json") || Object.keys(req.query).length > 0) {
        return res.status(400).json({ success: false, code: "INVALID_DOMAIN_INPUT", message: "Send an empty JSON object." });
    }
    try {
        validateEmptyBody(req.body);
        const data = await drawParticipantDomain({ eventId: req.params.eventId, authenticatedUser: req.user });
        return res.status(data.alreadyAssigned ? 200 : 201).json({
            success: true,
            message: data.alreadyAssigned ? "Your entry already has a locked theme." : "Theme assigned and locked.",
            data
        });
    } catch (error) {
        return respondError(res, error, "Could not draw a theme.");
    }
}

function readDomainData(service, fallback) {
    return async (req, res) => {
        try {
            const data = await service({ eventId: req.params.eventId, authenticatedUser: req.user });
            return res.status(200).json({ success: true, data });
        } catch (error) {
            return respondError(res, error, fallback);
        }
    };
}

const getMyTheme = readDomainData(getParticipantLockedTheme, "Could not load your locked theme.");
const getDomainBank = readDomainData(getParticipantDomainBank, "Could not load the problem bank.");

module.exports = { getDomainStatus, drawDomain, getMyTheme, getDomainBank };
