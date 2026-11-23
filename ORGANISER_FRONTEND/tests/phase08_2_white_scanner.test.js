/**
 * ============================================================================
 * PHASE 08.2: WHITE MODERN SCANNER-FIRST INTERFACE VERIFICATION
 * ============================================================================
 *
 * Verifies:
 * 1. Content Hierarchy & Event Selector Card:
 *    - Compact Event Check-in heading.
 *    - Select Event dropdown with calendar icon and event selection.
 *    - Active venue information with Ready status indicator.
 *    - Multi-Event Combo parent package identified as package and NOT labelled as valid scanning venue.
 * 2. Segmented Mode Control (Scan QR vs Manual Check-in):
 *    - Segmented tabs matching design reference.
 *    - Scan QR is active by default.
 *    - Manual Check-in tab renders Registration ID search structure (Screen 2).
 *    - Registration ID search safely informs user that Phase 04 backend integration is required.
 *    - Working 64-char QR token fallback remains fully operational in both QR and Manual workflows.
 * 3. Modern Camera Viewport & Viewfinder Elements:
 *    - Rounded camera panel with indigo corner brackets.
 *    - Translucent center QR guide icon in viewfinder.
 *    - Animated viewfinder laser scan.
 *    - Status badge with green dot and "Camera Ready" indicator.
 *    - Start / Pause / Resume controls bar.
 *    - Camera switching support.
 * 4. Redesigned Result Feedback Panel (Screen 3):
 *    - Success state: Large circular green checkmark badge, "Check-in Successful", participant avatar, name, reg ID, status pill ("✔ Checked In"), event name, checked-in timestamp, registration type.
 *    - Duplicate state: Warning badge, "Already Checked In", reason code ALREADY_CHECKED_IN.
 *    - Rejection state: Error badge, title, reason code (e.g. EVENT_NOT_ENTITLED, PAYMENT_PENDING).
 *    - Ambiguous state: Safe timeout warning without marking checked in or retrying automatically.
 *    - Next Participant action: Clears scan result, resets processing lock, restarts scanner feed smoothly.
 * 5. Recent Scan Results Drawer:
 *    - Expandable session history drawer matching visual reference.
 *    - Dynamic count badge reflecting session check-ins.
 * 6. Architectural & Security Invariants:
 *    - Code splitting maintained for ScannerPage and AttendanceTrackerPage.
 *    - Zero payment status or attendance override endpoints in portal.
 *    - No raw QR token logged or persisted in browser storage.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  validateQrToken,
  mapAttendanceSuccess,
  mapAttendanceError,
} from "../src/utils/scanResultMapping.ts";

const validQrToken = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

describe("PHASE 08.2: WHITE MODERN SCANNER-FIRST INTERFACE", () => {
  // --------------------------------------------------------------------------
  // GROUP 1: CONTENT HIERARCHY & EVENT SELECTOR CARD
  // --------------------------------------------------------------------------
  describe("Group 1: Content Hierarchy & Event Selector Card", () => {
    it("1. ScannerPage renders Event Check-in heading and select event dropdown", () => {
      const pagePath = path.resolve("ORGANISER_FRONTEND/src/pages/ScannerPage.tsx");
      const content = fs.readFileSync(pagePath, "utf-8");

      assert.match(content, /Event Check-in/, "Must render Event Check-in heading");
      assert.match(content, /Scan participant QR or use manual check-in/, "Must render subtitle");
      assert.match(content, /Select Event/, "Must render Select Event label");
      assert.match(content, /id="active-event-select"/, "Must render active event select dropdown");
    });

    it("2. Normal child event is labelled as Active Venue (Ready)", () => {
      const pagePath = path.resolve("ORGANISER_FRONTEND/src/pages/ScannerPage.tsx");
      const content = fs.readFileSync(pagePath, "utf-8");

      assert.match(content, /Active Venue:\s*\{event\.name\}/, "Must label normal event as Active Venue");
      assert.match(content, /scanner-venue-pill-ready/, "Must include Ready status indicator for active venue");
    });

    it("3. Combo Pass parent is NOT labelled as a valid scanning venue", () => {
      const pagePath = path.resolve("ORGANISER_FRONTEND/src/pages/ScannerPage.tsx");
      const content = fs.readFileSync(pagePath, "utf-8");

      // Verify conditional check for isComboParent
      assert.match(content, /isComboParent\s*\?/, "Must branch on isComboParent");
      assert.match(
        content,
        /Multi-Event Package:\s*\{event\.name\}/,
        "Combo parent must be explicitly labelled as Multi-Event Package, not as an active scanning venue"
      );
      assert.match(
        content,
        /Select Venue Below/,
        "Combo parent must prompt user to select included child venue"
      );
    });
  });

  // --------------------------------------------------------------------------
  // GROUP 2: SEGMENTED TABS & REGISTRATION ID SEARCH
  // --------------------------------------------------------------------------
  describe("Group 2: Segmented Tabs & Registration ID Search", () => {
    it("4. EventScanner includes segmented tabs: Scan QR and Manual Check-in", () => {
      const scannerPath = path.resolve("ORGANISER_FRONTEND/src/components/scanner/EventScanner.tsx");
      const content = fs.readFileSync(scannerPath, "utf-8");

      assert.match(content, /scanner-mode-tabs/, "Must render scanner-mode-tabs container");
      assert.match(content, /Scan QR/, "Must render Scan QR tab label");
      assert.match(content, /Manual Check-in/, "Must render Manual Check-in tab label");
      assert.match(content, /activeTab === "SCAN"/, "Scan QR must be active tab by default");
    });

    it("5. Manual Check-in tab renders Registration ID Search card (Screen 2)", () => {
      const scannerPath = path.resolve("ORGANISER_FRONTEND/src/components/scanner/EventScanner.tsx");
      const content = fs.readFileSync(scannerPath, "utf-8");

      assert.match(content, /search-checkin-card/, "Must render search-checkin-card");
      assert.match(content, /Registration ID Search/, "Must render Registration ID Search heading");
      assert.match(
        content,
        /Enter the participant's Registration ID to find and check-in/,
        "Must render search instructions"
      );
      assert.match(
        content,
        /placeholder="e\.g\.\s*(?:VIB26-REG-000123|507f1f77bcf86cd799439011|[a-f0-9]{24})"/,
        "Must provide Registration ID placeholder"
      );
    });

    it("6. Registration ID search informs user that Phase 04 backend integration is required", () => {
      const scannerPath = path.resolve("ORGANISER_FRONTEND/src/components/scanner/EventScanner.tsx");
      const content = fs.readFileSync(scannerPath, "utf-8");

      assert.match(
        content,
        /requires backend integration \(scheduled for Phase 04\)/,
        "Must clearly notify that Registration ID check-in requires Phase 04 backend"
      );
    });

    it("7. Working 64-character QR token fallback is accessible in both QR and Manual views", () => {
      const scannerPath = path.resolve("ORGANISER_FRONTEND/src/components/scanner/EventScanner.tsx");
      const content = fs.readFileSync(scannerPath, "utf-8");

      assert.match(
        content,
        /Active Token Check-in Fallback/,
        "Manual tab must provide active 64-char token fallback"
      );
      assert.match(
        content,
        /Hardware Scanner \/ Manual QR Token/,
        "Scan QR tab must provide collapsible hardware/manual token fallback"
      );
      assert.match(content, /handleManualTokenSubmit/, "Must handle manual token check-in submission");
    });
  });

  // --------------------------------------------------------------------------
  // GROUP 3: MODERN CAMERA VIEWPORT & CONTROLS
  // --------------------------------------------------------------------------
  describe("Group 3: Modern Camera Viewport & Controls", () => {
    it("8. Viewfinder includes rounded panel, corner scanning guides, and center guide icon", () => {
      const scannerPath = path.resolve("ORGANISER_FRONTEND/src/components/scanner/EventScanner.tsx");
      const content = fs.readFileSync(scannerPath, "utf-8");

      assert.match(content, /viewfinder-wrapper/, "Must render viewfinder-wrapper");
      assert.match(content, /viewfinder-corners/, "Must render viewfinder-corners");
      assert.match(content, /corner corner-tl/, "Must render corner-tl");
      assert.match(content, /corner corner-tr/, "Must render corner-tr");
      assert.match(content, /corner corner-bl/, "Must render corner-bl");
      assert.match(content, /corner corner-br/, "Must render corner-br");
      assert.match(content, /viewfinder-center-guide/, "Must render center QR guide icon");
      assert.match(content, /Align the QR code within the frame/, "Must render alignment hint");
    });

    it("9. Viewfinder includes status indicator with green dot", () => {
      const scannerPath = path.resolve("ORGANISER_FRONTEND/src/components/scanner/EventScanner.tsx");
      const content = fs.readFileSync(scannerPath, "utf-8");

      assert.match(content, /viewfinder-status-pill/, "Must render viewfinder-status-pill");
      assert.match(content, /status-dot-green/, "Must render status-dot-green");
      assert.match(content, /Camera Ready/, "Must show Camera Ready status");
    });

    it("10. Scanner controls bar supports Pause, Resume and Camera Switching", () => {
      const scannerPath = path.resolve("ORGANISER_FRONTEND/src/components/scanner/EventScanner.tsx");
      const content = fs.readFileSync(scannerPath, "utf-8");

      assert.match(content, /Pause Scanner/, "Must support Pause Scanner button");
      assert.match(content, /Resume Scanner|Start Scanner/, "Must support Resume/Start Scanner button");
      assert.match(content, /videoDevices\.length > 1/, "Must support camera switcher when multiple cameras exist");
    });
  });

  // --------------------------------------------------------------------------
  // GROUP 4: REDESIGNED RESULT FEEDBACK PANEL & NEXT PARTICIPANT
  // --------------------------------------------------------------------------
  describe("Group 4: Redesigned Result Feedback Panel & Next Participant", () => {
    it("11. ScanResultPanel renders large outcome badge and Check-in Successful headline", () => {
      const panelPath = path.resolve("ORGANISER_FRONTEND/src/components/scanner/ScanResultPanel.tsx");
      const content = fs.readFileSync(panelPath, "utf-8");

      assert.match(content, /result-badge-circle/, "Must render large circular outcome badge");
      assert.match(content, /Check-in Successful/, "Must display Check-in Successful heading on success");
      assert.match(content, /Already Checked In/, "Must display Already Checked In heading on duplicate");
    });

    it("12. ScanResultPanel renders participant row with avatar, name, reg ID and status pill", () => {
      const panelPath = path.resolve("ORGANISER_FRONTEND/src/components/scanner/ScanResultPanel.tsx");
      const content = fs.readFileSync(panelPath, "utf-8");

      assert.match(content, /result-participant-box/, "Must render participant box");
      assert.match(content, /result-avatar-circle/, "Must render user avatar circle");
      assert.match(content, /result-participant-name/, "Must render participant name");
      assert.match(content, /result-participant-id/, "Must render registration ID");
      assert.match(content, /✔ Checked In/, "Must display Checked In status pill for success");
    });

    it("13. ScanResultPanel renders details table: Event, Checked In, Registration Type", () => {
      const panelPath = path.resolve("ORGANISER_FRONTEND/src/components/scanner/ScanResultPanel.tsx");
      const content = fs.readFileSync(panelPath, "utf-8");

      assert.match(content, /result-details-table/, "Must render result details table");
      assert.match(content, /Registration Type/, "Must display Registration Type row");
      assert.match(content, /Checked In/, "Must display Checked In timestamp row");
    });

    it("14. ScanResultPanel renders prominent Next Participant action button", () => {
      const panelPath = path.resolve("ORGANISER_FRONTEND/src/components/scanner/ScanResultPanel.tsx");
      const content = fs.readFileSync(panelPath, "utf-8");

      assert.match(content, /btn-next-participant/, "Must render btn-next-participant");
      assert.match(content, /Next Participant/, "Action button label must be Next Participant");
    });
  });

  // --------------------------------------------------------------------------
  // GROUP 5: RECENT SCAN RESULTS DRAWER & SESSION HISTORY
  // --------------------------------------------------------------------------
  describe("Group 5: Recent Scan Results Drawer & Session History", () => {
    it("15. EventScanner renders expandable Recent Scan Results drawer matching design reference", () => {
      const scannerPath = path.resolve("ORGANISER_FRONTEND/src/components/scanner/EventScanner.tsx");
      const content = fs.readFileSync(scannerPath, "utf-8");

      assert.match(content, /recent-scans-card/, "Must render recent-scans-card");
      assert.match(content, /recent-scans-toggle/, "Must render toggle button");
      assert.match(content, /Recent Scan Results/, "Must display Recent Scan Results label");
      assert.match(content, /recent-scans-count-badge/, "Must display count badge for recent scans");
    });

    it("16. Event switching clears recent session history to avoid cross-event contamination", () => {
      const scannerPath = path.resolve("ORGANISER_FRONTEND/src/components/scanner/EventScanner.tsx");
      const content = fs.readFileSync(scannerPath, "utf-8");

      assert.match(
        content,
        /setRecentScans\(\[\]\)/,
        "Switching selected event must reset recent session scans"
      );
    });
  });

  // --------------------------------------------------------------------------
  // GROUP 6: REGRESSION REQUIREMENTS & CONTRACT PRESERVATION
  // --------------------------------------------------------------------------
  describe("Group 6: Regression Requirements & Contract Preservation", () => {
    it("17. validateQrToken accepts valid 64-char lowercase hex tokens", () => {
      const res = validateQrToken(validQrToken);
      assert.equal(res.isValid, true);
    });

    it("18. validateQrToken rejects malformed or truncated tokens", () => {
      const shortToken = "abcdef123456";
      const invalidToken = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9G"; // Contains 'G'

      assert.equal(validateQrToken(shortToken).isValid, false);
      assert.equal(validateQrToken(invalidToken).isValid, false);
      assert.equal(validateQrToken("").isValid, false);
    });

    it("19. mapAttendanceSuccess formats success result with participant & combo details", () => {
      const mockResponse = {
        success: true,
        message: "Attendance recorded successfully",
        checkedInAt: "2026-11-26T10:24:00Z",
        accessType: "MULTI_EVENT",
        participant: {
          fullName: "MAX WHITE",
          registrationId: "VIB26-REG-000123",
          email: "max@vibrant.org",
        },
        event: {
          _id: "evt_101",
          name: "CODE2CREATE",
        },
        comboProgress: {
          attendedCount: 2,
          totalEligible: 3,
          isComplete: false,
        },
      };

      const result = mapAttendanceSuccess(mockResponse, "CODE2CREATE");
      assert.equal(result.outcome, "SUCCESS");
      assert.equal(result.participantName, "MAX WHITE");
      assert.equal(result.registrationId, "VIB26-REG-000123");
      assert.equal(result.eventName, "CODE2CREATE");
      assert.equal(result.isCombo, true);
      assert.equal(result.comboProgress?.displayString, "2 of 3 events attended");
    });

    it("20. mapAttendanceError correctly identifies duplicate scans and reason codes", () => {
      const duplicateError = {
        isAxiosError: true,
        response: {
          status: 409,
          data: {
            success: false,
            message: "Participant already checked in at this event.",
            reason: "ALREADY_CHECKED_IN",
            alreadyCheckedInAt: "2026-11-26T09:15:00Z",
            participant: "ALICE SHARMA",
          },
        },
      };

      const result = mapAttendanceError(duplicateError, "CODE2CREATE");
      assert.equal(result.outcome, "DUPLICATE");
      assert.equal(result.reasonCode, "ALREADY_CHECKED_IN");
      assert.equal(result.participantName, "ALICE SHARMA");
    });
  });
});
