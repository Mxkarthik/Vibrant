/**
 * ============================================================================
 * PHASE 09A: SCANNER-FIRST LANDING & PRE-CAMERA UX REFINEMENT TESTS
 * ============================================================================
 *
 * Verifies:
 * 1. Scanner-First Landing Focus (Issue 1):
 *    - On fresh login / /scanner without an active event, QR scanner preview panel
 *      is rendered immediately as the dominant visual element.
 *    - Large duplicate event-card list is completely removed from the no-event state.
 *    - Structure: Header Card -> Event Check-in Title -> Compact Event Selector dropdown
 *      -> Scan QR / Manual Check-in tabs -> Scanner viewfinder preview panel.
 *    - Centered "Select an Event to Begin" placeholder when no event is selected.
 * 2. Pre-Camera Preview Centering & Single Clear Action (Issue 2):
 *    - CSS fixes: .viewfinder-video and .viewfinder-placeholder positioned absolute (inset: 0)
 *      to eliminate flex-row displacement.
 *    - Subtle indigo-framed QR icon (.viewfinder-icon-frame) centered vertically & horizontally.
 *    - "Ready to Scan" title and descriptive subtitle in pre-camera state.
 *    - Single primary action: "Activate Camera" centered inside viewfinder placeholder.
 *    - Duplicate "Start Scanner" button eliminated from .scanner-controls-bar in IDLE state.
 *    - Status pill ("Scanning Active") strictly visible only when state === "SCANNING",
 *      never rendered before camera activation.
 * 3. Operational Integrity & Invariants:
 *    - Camera stays completely inactive until a physical event is selected and activated.
 *    - Tab switching safety: clicking "Scan QR" does not trigger camera if no event is selected.
 *    - Manual Check-in tab available and guards against missing event selection.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("Phase 09A: Scanner-First Landing & Pre-Camera UX Refinement", () => {
  const scannerPagePath = path.resolve("ORGANISER_FRONTEND/src/pages/ScannerPage.tsx");
  const eventScannerPath = path.resolve("ORGANISER_FRONTEND/src/components/scanner/EventScanner.tsx");
  const cssPath = path.resolve("ORGANISER_FRONTEND/src/styles/organiser.css");

  const scannerPageContent = fs.readFileSync(scannerPagePath, "utf-8");
  const eventScannerContent = fs.readFileSync(eventScannerPath, "utf-8");
  const cssContent = fs.readFileSync(cssPath, "utf-8");

  // ==========================================================================
  // GROUP 1: SCANNER-FIRST LANDING FOCUS (ISSUE 1)
  // ==========================================================================
  describe("Group 1: Scanner-First Landing Focus (Issue 1)", () => {
    it("1. ScannerPage renders EventScanner directly in the no-event landing state", () => {
      // Must check !eventId || !event and render EventScanner
      assert.match(scannerPageContent, /if\s*\(!eventId\s*\|\|\s*!event\)/, "Must handle missing event route");
      assert.match(
        scannerPageContent,
        /<EventScanner\s+selectedEventId=""\s+selectedEventName=""\s+isComboParent=\{false\}\s*\/>/,
        "Must render EventScanner in no-event state"
      );
    });

    it("2. ScannerPage removes duplicate event card button list from no-event landing state", () => {
      // The old prompt card with accessibleEvents.map rendered buttons for each event.
      // In the new design, the duplicate list inside the prompt card must be removed.
      assert.doesNotMatch(
        scannerPageContent,
        /Select Event Venue:/,
        "Duplicate 'Select Event Venue:' heading must be removed from landing state"
      );
      assert.doesNotMatch(
        scannerPageContent,
        /View Notice &rarr;|Select Venue &rarr;/,
        "Duplicate event selection buttons must be removed from landing state"
      );
    });

    it("3. ScannerPage retains compact Event Selector dropdown in landing header", () => {
      assert.match(scannerPageContent, /id="landing-event-select"/, "Landing header must have event select dropdown");
      assert.match(
        scannerPageContent,
        /Choose an event to activate scanner…/,
        "Event dropdown must show prompt placeholder"
      );
      assert.match(
        scannerPageContent,
        /\[Package\] \$\{evt\.name\} — Not a Scanning Venue/,
        "Package events must be clearly labeled in dropdown options"
      );
    });

    it("4. EventScanner accepts optional selectedEventId and selectedEventName props", () => {
      assert.match(eventScannerContent, /selectedEventId\?: string/, "selectedEventId prop must be optional");
      assert.match(eventScannerContent, /selectedEventName\?: string/, "selectedEventName prop must be optional");
      assert.match(eventScannerContent, /selectedEventId = ""/, "selectedEventId must default to empty string");
    });
  });

  // ==========================================================================
  // GROUP 2: PRE-CAMERA PREVIEW CENTERING & INDIGO FRAMING (ISSUE 2)
  // ==========================================================================
  describe("Group 2: Pre-Camera Centering & Indigo Framing (Issue 2)", () => {
    it("5. CSS positions .viewfinder-video and .viewfinder-placeholder absolutely to eliminate flex-row misalignment", () => {
      assert.match(
        cssContent,
        /\.viewfinder-video\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;/,
        ".viewfinder-video must be position: absolute; inset: 0;"
      );
      assert.match(
        cssContent,
        /\.viewfinder-placeholder\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*z-index:\s*2;/,
        ".viewfinder-placeholder must be position: absolute; inset: 0; z-index: 2;"
      );
    });

    it("6. CSS defines .viewfinder-icon-frame with subtle indigo styling", () => {
      assert.match(cssContent, /\.viewfinder-icon-frame\s*\{/, "Must define .viewfinder-icon-frame class");
      assert.match(cssContent, /background:\s*rgba\(81,\s*75,\s*255,\s*0\.12\)/, "Must use subtle indigo tint");
      assert.match(cssContent, /border:\s*1px solid rgba\(81,\s*75,\s*255,\s*0\.28\)/, "Must use subtle indigo border");
    });

    it("7. CSS defines .viewfinder-placeholder-title and .viewfinder-placeholder-desc for centered typography", () => {
      assert.match(cssContent, /\.viewfinder-placeholder-title\s*\{/, "Must define title style");
      assert.match(cssContent, /\.viewfinder-placeholder-desc\s*\{/, "Must define description style");
    });

    it("8. Viewfinder shows 'Select an Event to Begin' when no event is selected", () => {
      assert.match(
        eventScannerContent,
        /Select an Event to Begin/,
        "Must display 'Select an Event to Begin' when !selectedEventId"
      );
      assert.match(
        eventScannerContent,
        /Choose a physical event venue above to enable participant QR scanning\./,
        "Must display venue guidance description when !selectedEventId"
      );
    });

    it("9. Viewfinder shows 'Ready to Scan' with centered 'Activate Camera' button when event is selected", () => {
      assert.match(
        eventScannerContent,
        /Ready to Scan/,
        "Must display 'Ready to Scan' heading when event is selected in IDLE state"
      );
      assert.match(
        eventScannerContent,
        /Allow camera access to start scanning participant QR codes for check-in\./,
        "Must display camera permission guidance description"
      );
      assert.match(
        eventScannerContent,
        /Activate Camera/,
        "Must render 'Activate Camera' button inside viewfinder placeholder"
      );
    });
  });

  // ==========================================================================
  // GROUP 3: ELIMINATION OF DUPLICATE BUTTONS & STATUS PILL SAFETY (ISSUE 2)
  // ==========================================================================
  describe("Group 3: Elimination of Duplicate Buttons & Status Pill Safety", () => {
    it("10. Scanner controls bar eliminates duplicate 'Start Scanner' button in IDLE state", () => {
      // In IDLE state, the controls bar must NOT render a second Start Scanner button.
      // Controls bar only renders Pause Scanner when SCANNING.
      assert.doesNotMatch(
        eventScannerContent,
        /<span>\{state === "IDLE" \? "Start Scanner" : "Resume Scanner"\}<\/span>/,
        "Duplicate Start Scanner / Resume Scanner button must be removed from scanner-controls-bar"
      );
      assert.match(
        eventScannerContent,
        /\{state === "SCANNING" && \([\s\S]*?<CameraOff/,
        "Controls bar must only render Pause Scanner when state === SCANNING"
      );
    });

    it("11. Status pill ('Scanning Active') is strictly rendered ONLY when scanning is active", () => {
      // Must NOT render status-dot-green or Scanning Active when IDLE or no event
      assert.match(
        eventScannerContent,
        /\{state === "SCANNING" \?\s*\(\s*<>\s*<div className="viewfinder-status-pill">\s*<span className="status-dot-green" \/>\s*<span>Scanning Active<\/span>/,
        "Status pill must only render when state === SCANNING"
      );
      assert.doesNotMatch(
        eventScannerContent,
        /:\s*"Camera Ready"\}/,
        "Status pill must never show 'Camera Ready' before camera is turned on"
      );
    });

    it("12. Tab switching to Scan QR does not activate camera if no event is selected", () => {
      assert.match(
        eventScannerContent,
        /if\s*\(selectedEventId\s*&&\s*state === "IDLE"\s*&&\s*!scanResult\)\s*\{\s*void startCamera\(\);/,
        "Scan QR tab click must guard startCamera with selectedEventId check"
      );
    });

    it("13. Camera activation is disabled if selectedEventId is absent or isComboParent", () => {
      assert.match(
        eventScannerContent,
        /disabled=\{!selectedEventId \|\| isComboParent\}/,
        "Activate Camera button must be disabled without selected event"
      );
      assert.match(
        eventScannerContent,
        /if\s*\(!selectedEventId\s*\|\|\s*isComboParent\)\s*\{[^}]*CAMERA_ERROR/,
        "startCamera must guard against missing event ID"
      );
    });

    it("14. Pause Scanner cleanly stops camera and transitions back to IDLE state", () => {
      assert.match(
        eventScannerContent,
        /onClick=\{\(\) => \{\s*stopCamera\(\);\s*setState\("IDLE"\);\s*\}\}/,
        "Pause Scanner must call stopCamera and reset state to IDLE"
      );
    });
  });
});
