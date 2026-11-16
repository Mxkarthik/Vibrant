const crypto = require("crypto");
const Registration = require("../models/Registration");

function getCertificateEligibility(event, registration) {
    if (!event || event.status === "CANCELLED") {
        return { eligible: false, reason: "Certificates cannot be issued for a cancelled or missing event." };
    }
    if (event.status !== "COMPLETED") {
        return { eligible: false, reason: "The event must be completed before certificates can be issued." };
    }
    if (registration.status !== "REGISTERED") {
        return { eligible: false, reason: "This registration is not active." };
    }
    if (!registration.attendance?.isPresent) {
        return { eligible: false, reason: "The participant must be checked in to receive a certificate." };
    }
    const paymentStatus = registration.team
        ? registration.team.payment?.status
        : registration.payment?.status;
    if (!paymentStatus || !["VERIFIED", "NOT_REQUIRED"].includes(paymentStatus)) {
        return { eligible: false, reason: "Payment must be verified before a certificate can be issued." };
    }
    return { eligible: true, reason: null };
}

async function issueCertificateRecord(registrationId) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const certificateId = `VIB-${new Date().getFullYear()}-${crypto.randomBytes(16).toString("hex").toUpperCase()}`;
        try {
            const registration = await Registration.findOneAndUpdate(
                {
                    _id: registrationId,
                    status: "REGISTERED",
                    "attendance.isPresent": true,
                    "certificate.isIssued": { $ne: true }
                },
                {
                    $set: {
                        "certificate.certificateId": certificateId,
                        "certificate.issuedAt": new Date(),
                        "certificate.isIssued": true
                    }
                },
                { new: true, runValidators: true }
            );
            return registration;
        } catch (error) {
            if (error?.code === 11000 && attempt < 4) continue;
            throw error;
        }
    }
    return null;
}

module.exports = { getCertificateEligibility, issueCertificateRecord };
