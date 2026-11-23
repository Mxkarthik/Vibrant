"use strict";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function isLocalhost(url) {
    const hostname = url.hostname.toLowerCase();
    return LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost");
}

function parseOrganiserOrigins(rawValue) {
    return rawValue.split(",").map(value => {
        const configuredValue = value.trim();
        let url;

        try {
            url = new URL(configuredValue);
        } catch {
            throw new Error("ORGANISER_FRONTEND_URL must contain valid frontend origins.");
        }

        if (
            !["http:", "https:"].includes(url.protocol) ||
            url.username ||
            url.password ||
            url.pathname !== "/" ||
            url.search ||
            url.hash
        ) {
            throw new Error("ORGANISER_FRONTEND_URL must contain frontend origins without paths or credentials.");
        }

        return url;
    });
}

function resolveOrganiserFrontendUrl(env = process.env) {
    const rawValue = env.ORGANISER_FRONTEND_URL?.trim();
    const isProduction = env.NODE_ENV === "production";

    if (!rawValue) {
        if (isProduction) {
            return "https://dietvibrant-organiser.vercel.app";
        }
        return "http://localhost:5175";
    }

    const origins = parseOrganiserOrigins(rawValue);
    if (!isProduction) {
        const localOrigin = origins.find(isLocalhost);
        return (localOrigin || origins[0]).origin;
    }

    const productionOrigin = origins.find(url => url.protocol === "https:" && !isLocalhost(url));
    if (!productionOrigin) {
        throw new Error(
            "ORGANISER_FRONTEND_URL must include a non-local HTTPS origin in production; refusing to redirect authentication to localhost."
        );
    }

    return productionOrigin.origin;
}

module.exports = {
    resolveOrganiserFrontendUrl,
    parseOrganiserOrigins
};
