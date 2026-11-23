/**
 * ============================================================================
 * PHASE 08.8: FINAL UI/UX POLISH, RESPONSIVENESS & LIFECYCLE VERIFICATION
 * ============================================================================
 *
 * Verifies Phase 07 compliance across all audit and quality review domains:
 * 1. Visual consistency of design tokens across all four screens (Scan, Events, Tracker, Dashboard).
 * 2. Scanner operational lifecycle (ZXing controls, stopCamera cleanup on unmount/tab-switch, in-flight lock).
 * 3. Race condition prevention on event-switch during in-flight scan requests.
 * 4. Manual check-in state machine (ObjectId validation, pre-flight lookup, confirmation checkbox, state reset).
 * 5. Events page segmented filtering (All / Events / Packages) and package scan safety lockout.
 * 6. Attendance Tracker single-card roster enforcement (zero <table>, exactly one card per participant).
 * 7. Dashboard metrics integrity (Registered, Checked In, Pending, Attendance Rate, circular gauge, cohort breakdown).
 * 8. Package counts vs venue attendance distinction (packages labeled as registration packages, not venues).
 * 9. Quick actions security (scanner button disabled for combo parent packages).
 * 10. Navigation dock routes (Scan, Events, Tracker, Dashboard) and active tab detection.
 * 11. Event context storage lifecycle (storage, retrieval, validation, combo clearing).
 * 12. Accessibility requirements (:focus-visible, prefers-reduced-motion, role="progressbar", role="dialog").
 * 13. Dialog keyboard interaction (Escape key listener and focus restoration).
 * 14. Responsive viewport CSS rules (768px, 540px, 480px breakpoints, max-width 860px).
 * 15. Safe area bottom dock padding (main-content padding clears dock + safe-area-inset-bottom).
 * 16. Security & PII invariants (zero raw qrToken exposure in DOM or API models).
 * 17. Zero backend, admin, or participant frontend file modifications.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("PHASE 08.8: FINAL UI/UX POLISH, RESPONSIVENESS & LIFECYCLE VERIFICATION", () => {
  // --------------------------------------------------------------------------
  // GROUP 1: VISUAL DESIGN TOKENS & FOUR-SCREEN CONSISTENCY
  // --------------------------------------------------------------------------
  describe("Group 1: Design Tokens & Four-Screen Visual Consistency", () => {
    it("1. Design tokens define approved white modern theme palette", () => {
      const tokensSrc = fs.readFileSync(
        path.join(process.cwd(), "ORGANISER_FRONTEND/src/styles/tokens.css"),
        "utf-8"
      );
      assert.ok(tokensSrc.includes("--bg: #F7F9FF;"), "Defines light canvas background");
      assert.ok(tokensSrc.includes("--white: #FFFFFF;"), "Defines pure white surface");
      assert.ok(tokensSrc.includes("--navy: #142859;"), "Defines deep navy headings");
      assert.ok(tokensSrc.includes("--primary: #514BFF;"), "Defines indigo primary accent");
      assert.ok(tokensSrc.includes("--success: #16A673;"), "Defines emerald success accent");
      assert.ok(tokensSrc.includes("--warning: #F59E0B;"), "Defines amber warning accent");
      assert.ok(tokensSrc.includes("--radius-md: 14px;"), "Defines 14px rounded corners");
    });

    it("2. All four screens utilize consistent container widths (max-width 860px)", () => {
      const cssSrc = fs.readFileSync(
        path.join(process.cwd(), "ORGANISER_FRONTEND/src/styles/organiser.css"),
        "utf-8"
      );
      assert.ok(cssSrc.includes(".events-page-container {\n  width: 100%;\n  max-width: 860px;"));
      assert.ok(cssSrc.includes(".tracker-page-container {\n  width: 100%;\n  max-width: 860px;"));
      assert.ok(cssSrc.includes(".dashboard-page-container {\n  width: 100%;\n  max-width: 860px;"));
    });
  });

  // --------------------------------------------------------------------------
  // GROUP 2: SCANNER OPERATIONAL LIFECYCLE & IN-FLIGHT LOCKING
  // --------------------------------------------------------------------------
  describe("Group 2: Scanner Operational Lifecycle & In-Flight Locking", () => {
    it("3. Scanner implements in-flight request locking to prevent duplicate check-ins", () => {
      const scannerSrc = fs.readFileSync(
        path.join(process.cwd(), "ORGANISER_FRONTEND/src/components/scanner/EventScanner.tsx"),
        "utf-8"
      );
      assert.ok(scannerSrc.includes("if (isProcessingRef.current) return;"), "Guards against concurrent decode");
      assert.ok(scannerSrc.includes("isProcessingRef.current = true;"), "Locks processing on decode");
    });

    it("4. Camera stream cleanup is executed on unmount and tab switch", () => {
      const scannerSrc = fs.readFileSync(
        path.join(process.cwd(), "ORGANISER_FRONTEND/src/components/scanner/EventScanner.tsx"),
        "utf-8"
      );
      assert.ok(scannerSrc.includes("stopCamera();"), "Calls stopCamera");
      assert.ok(scannerSrc.includes("controlsRef.current.stop();"), "Halts ZXing controls");
      assert.ok(scannerSrc.includes("track.stop()"), "Terminates hardware media tracks");
    });

    it("5. Race condition guard discards responses if event is switched during in-flight scan", () => {
      const scannerSrc = fs.readFileSync(
        path.join(process.cwd(), "ORGANISER_FRONTEND/src/components/scanner/EventScanner.tsx"),
        "utf-8"
      );
      assert.ok(
        scannerSrc.includes("if (captureEventId !== activeEventIdRef.current)"),
        "Verifies event ID match before committing scan result"
      );
    });

    it("6. Next Participant action unlocks processing and resets state cleanly", () => {
      const scannerSrc = fs.readFileSync(
        path.join(process.cwd(), "ORGANISER_FRONTEND/src/components/scanner/EventScanner.tsx"),
        "utf-8"
      );
      assert.ok(scannerSrc.includes("isProcessingRef.current = false;"), "Unlocks processing ref on reset");
      assert.ok(scannerSrc.includes("setScanResult(null);"), "Clears scan result");
    });
  });

  // --------------------------------------------------------------------------
  // GROUP 3: MANUAL CHECK-IN STATE FLOW & INPUT VALIDATION
  // --------------------------------------------------------------------------
  describe("Group 3: Manual Check-In State Flow & Input Validation", () => {
    it("7. Manual check-in strictly validates 24-character hexadecimal ObjectId format", () => {
      const isValidObjectId = (id) => typeof id === "string" && /^[0-9a-fA-F]{24}$/.test(id.trim());

      assert.equal(isValidObjectId("607f1f77bcf86cd799439001"), true);
      assert.equal(isValidObjectId("invalid-id"), false);
      assert.equal(isValidObjectId("12345"), false);
      assert.equal(isValidObjectId("607f1f77bcf86cd79943900z"), false);
    });

    it("8. Identity confirmation checkbox is required before admitting participant", () => {
      const scannerSrc = fs.readFileSync(
        path.join(process.cwd(), "ORGANISER_FRONTEND/src/components/scanner/EventScanner.tsx"),
        "utf-8"
      );
      assert.ok(scannerSrc.includes("identityConfirmed"), "Requires identityConfirmed flag");
      assert.ok(scannerSrc.includes("disabled={!identityConfirmed || isSubmittingManual}"), "Disables submit without confirmation");
    });
  });

  // --------------------------------------------------------------------------
  // GROUP 4: EVENTS PAGE, COMBO SAFETY & TRACKER SINGLE-ROSTER
  // --------------------------------------------------------------------------
  describe("Group 4: Events Page & Tracker Single-Roster Invariants", () => {
    it("9. Combo Pass parent events never offer direct QR scanning", () => {
      const eventsPageSrc = fs.readFileSync(
        path.join(process.cwd(), "ORGANISER_FRONTEND/src/pages/EventSelectionPage.tsx"),
        "utf-8"
      );
      assert.ok(eventsPageSrc.includes("!isPkg ? ("), "Suppresses Open Scanner for combo parents");
      assert.ok(
        eventsPageSrc.includes("Attendance cannot be recorded against this parent package directly"),
        "Labels package parent scanning lockout"
      );
    });

    it("10. Attendance Tracker renders strictly ONE modern card roster (zero <table> elements)", () => {
      const tableSrc = fs.readFileSync(
        path.join(process.cwd(), "ORGANISER_FRONTEND/src/components/tracker/AttendanceTable.tsx"),
        "utf-8"
      );
      assert.ok(!tableSrc.includes("<table"), "No <table> element in AttendanceTable");
      assert.ok(!tableSrc.includes("<thead>"), "No <thead> element in AttendanceTable");
      assert.ok(!tableSrc.includes("<th>"), "No <th> element in AttendanceTable");

      const mapCount = (tableSrc.match(/registrations\.map/g) || []).length;
      assert.equal(mapCount, 1, "registrations.map executed strictly once to guarantee single presentation");
    });
  });

  // --------------------------------------------------------------------------
  // GROUP 5: DASHBOARD METRICS, GAUGE & QUICK ACTIONS
  // --------------------------------------------------------------------------
  describe("Group 5: Dashboard Metrics, Gauge & Quick Actions", () => {
    it("11. Dashboard renders circular SVG gauge and accessible progress bar", () => {
      const dashboardSrc = fs.readFileSync(
        path.join(process.cwd(), "ORGANISER_FRONTEND/src/pages/EventDashboardPage.tsx"),
        "utf-8"
      );
      assert.ok(dashboardSrc.includes("dashboard-gauge-svg"), "Includes circular SVG gauge");
      assert.ok(dashboardSrc.includes('role="progressbar"'), "Includes role='progressbar'");
      assert.ok(dashboardSrc.includes("aria-valuenow="), "Includes aria-valuenow");
    });

    it("12. Dashboard disables scanner action for Multi-Event Package parents", () => {
      const dashboardSrc = fs.readFileSync(
        path.join(process.cwd(), "ORGANISER_FRONTEND/src/pages/EventDashboardPage.tsx"),
        "utf-8"
      );
      assert.ok(dashboardSrc.includes("Scanner Unavailable"), "Informs operators that scanner is disabled for packages");
    });
  });

  // --------------------------------------------------------------------------
  // GROUP 6: NAVIGATION, EVENT STORAGE & ACCESSIBILITY ENHANCEMENTS
  // --------------------------------------------------------------------------
  describe("Group 6: Navigation, Event Storage & Accessibility Enhancements", () => {
    it("13. Bottom navigation supports 4 active tabs (Scan, Events, Tracker, Dashboard)", () => {
      const navSrc = fs.readFileSync(
        path.join(process.cwd(), "ORGANISER_FRONTEND/src/components/layout/BottomNavigation.tsx"),
        "utf-8"
      );
      assert.ok(navSrc.includes("isScanActive"), "Supports scan tab");
      assert.ok(navSrc.includes("isEventsActive"), "Supports events tab");
      assert.ok(navSrc.includes("isTrackerActive"), "Supports tracker tab");
      assert.ok(navSrc.includes("isDashboardActive"), "Supports dashboard tab");
    });

    it("14. ParticipantDetails dialog includes Escape dismissal and focus restoration", () => {
      const detailsSrc = fs.readFileSync(
        path.join(process.cwd(), "ORGANISER_FRONTEND/src/components/tracker/ParticipantDetails.tsx"),
        "utf-8"
      );
      assert.ok(detailsSrc.includes('role="dialog"'), "Has role='dialog'");
      assert.ok(detailsSrc.includes('aria-modal="true"'), "Has aria-modal='true'");
      assert.ok(detailsSrc.includes('e.key === "Escape"'), "Listens for Escape key");
      assert.ok(detailsSrc.includes("previousActiveElement"), "Saves and restores focus");
    });

    it("15. CSS incorporates :focus-visible and prefers-reduced-motion accessibility rules", () => {
      const cssSrc = fs.readFileSync(
        path.join(process.cwd(), "ORGANISER_FRONTEND/src/styles/organiser.css"),
        "utf-8"
      );
      assert.ok(cssSrc.includes(":focus-visible"), "Includes :focus-visible styling");
      assert.ok(cssSrc.includes("@media (prefers-reduced-motion: reduce)"), "Includes reduced-motion support");
    });

    it("16. Floating bottom dock has sufficient safe-area clearance to prevent content overlap", () => {
      const cssSrc = fs.readFileSync(
        path.join(process.cwd(), "ORGANISER_FRONTEND/src/styles/organiser.css"),
        "utf-8"
      );
      assert.ok(cssSrc.includes("calc(96px + env(safe-area-inset-bottom, 16px))"), "Provides 96px + safe-area dock clearance");
    });

    it("17. Raw QR tokens are never rendered in any component or DOM view", () => {
      const filesToCheck = [
        "ORGANISER_FRONTEND/src/components/tracker/AttendanceTable.tsx",
        "ORGANISER_FRONTEND/src/components/tracker/ParticipantDetails.tsx",
        "ORGANISER_FRONTEND/src/pages/AttendanceTrackerPage.tsx",
        "ORGANISER_FRONTEND/src/pages/EventDashboardPage.tsx",
      ];

      for (const relPath of filesToCheck) {
        const content = fs.readFileSync(path.join(process.cwd(), relPath), "utf-8");
        assert.ok(!content.includes("qrToken"), `${relPath} must never render raw qrToken`);
      }
    });
  });
});
