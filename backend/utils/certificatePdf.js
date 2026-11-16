function formatEventDate(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return "Date unavailable";
    return date.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "long",
        year: "numeric",
        timeZone: "Asia/Kolkata"
    });
}

function drawFittedText(doc, value, font, maxFontSize, minFontSize, x, y, width, color) {
    let text = String(value || "").replace(/[\r\n\t]+/g, " ").trim();
    if (!text) text = "—";
    let fontSize = maxFontSize;
    doc.font(font).fontSize(fontSize);
    while (doc.widthOfString(text) > width && fontSize > minFontSize) {
        fontSize -= 1;
        doc.fontSize(fontSize);
    }
    if (doc.widthOfString(text) > width) {
        while (text.length > 1 && doc.widthOfString(`${text}…`) > width) text = text.slice(0, -1).trimEnd();
        text = `${text}…`;
    }
    doc.fillColor(color).font(font).fontSize(fontSize).text(text, x, y, {
        align: "center",
        width,
        lineBreak: false
    });
}

function drawCertificate(doc, { participantName, eventName, eventStartDate, certificateId, issuedAt }) {
    // Preserve the existing DADI institute certificate artwork and layout.
    doc.rect(0, 0, 842, 595).fill("#FFFFFF");
    doc.lineWidth(5).strokeColor("#172B3A").rect(20, 20, 802, 555).stroke();
    doc.lineWidth(1.5).strokeColor("#315B79").rect(32, 32, 778, 531).stroke();

    doc.fillColor("#315B79").font("Helvetica-Bold").fontSize(16)
        .text("DADI INSTITUTE OF ENGINEERING AND TECHNOLOGY", 55, 75, { align: "center" });
    doc.fillColor("#172B3A").font("Helvetica-Bold").fontSize(36)
        .text("CERTIFICATE", 55, 145, { align: "center" });
    doc.fillColor("#315B79").font("Helvetica-Bold").fontSize(20)
        .text("OF PARTICIPATION", 55, 195, { align: "center" });
    doc.fillColor("#555555").font("Helvetica").fontSize(15)
        .text("This certificate is proudly presented to", 55, 250, { align: "center" });

    drawFittedText(doc, participantName, "Helvetica-Bold", 29, 17, 65, 285, 712, "#172B3A");
    doc.fillColor("#555555").font("Helvetica").fontSize(15)
        .text("For successfully participating in", 55, 340, { align: "center" });
    drawFittedText(doc, eventName, "Helvetica-Bold", 21, 14, 65, 375, 712, "#315B79");

    doc.fillColor("#555555").font("Helvetica").fontSize(13)
        .text(`Event Date: ${formatEventDate(eventStartDate)}`, 55, 425, { align: "center" });
    doc.fontSize(10).fillColor("#555555")
        .text(`Certificate ID: ${certificateId || "Assigned upon issuance"}`, 55, 510);
    const issuedText = issuedAt ? formatEventDate(issuedAt) : "Upon issuance";
    doc.text(`Issued: ${issuedText}`, 55, 530);
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#172B3A")
        .text("Authorized Signature", 620, 515, { width: 150, align: "center" });
}

module.exports = { drawCertificate, formatEventDate };
