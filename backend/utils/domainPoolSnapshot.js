"use strict";

const crypto = require("node:crypto");

function canonicalDomains(domains) {
    return domains.map(domain => ({
        domain: domain.domain?._id ? domain.domain._id.toString() : domain.domain.toString(),
        title: domain.title,
        problemStatement: domain.problemStatement,
        instructions: domain.instructions || ""
    }));
}

function hashDomains(domains) {
    return crypto.createHash("sha256").update(JSON.stringify(canonicalDomains(domains))).digest("hex");
}

function verifySnapshot(event, snapshot) {
    if (!snapshot || !Array.isArray(snapshot.domains) || snapshot.domains.length === 0) return false;
    if (snapshot.domains.some(item => !item?.domain || typeof item.title !== "string" ||
        !item.title.trim() || typeof item.problemStatement !== "string" || !item.problemStatement.trim())) return false;
    const config = event.domainConfig || {};
    if (Number(config.poolVersion || 0) !== Number(snapshot.poolVersion)) return false;
    if (!config.publishedAt || new Date(config.publishedAt).getTime() !== new Date(snapshot.publishedAt).getTime()) return false;
    if (snapshot.event?.toString() !== event._id.toString()) return false;
    return hashDomains(snapshot.domains) === snapshot.contentHash;
}

module.exports = { canonicalDomains, hashDomains, verifySnapshot };
