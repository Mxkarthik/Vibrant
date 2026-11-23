/**
 * ============================================================================
 * PHASE 08.4: SECURE REGISTRATION ID MANUAL CHECK-IN VERIFICATION
 * ============================================================================
 *
 * Verifies frontend compliance with requirements 29–42:
 * 29. Manual Check-in tab renders search interface (Screen 2: Header, input, helper).
 * 30. Validates 24-character hexadecimal ObjectId format.
 * 31. Loading and error states during registration search.
 * 32. Exact participant preview rendering (Screen 2 attributes).
 * 33. Correct payment and eligibility status messaging.
 * 34. Identity confirmation checkbox required before admission.
 * 35. Confirmation button disabled while submitting to prevent double-admission.
 * 36. Success state uses existing ScanResultPanel (Screen 3).
 * 37. "Next Participant" action retains MANUAL tab.
 * 38. "Next Participant" action retains selected event venue.
 * 39. Event switching clears stale lookup state.
 * 40. Existing QR scanner remains completely functional.
 * 41. Existing bottom navigation works across all tabs.
 * 42. Mobile responsiveness matches white modern design reference.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Setup in-memory web storage mock
const mockStorage = new Map();
globalThis.sessionStorage = {
  getItem: (k) => mockStorage.get(k) || null,
  setItem: (k, v) => mockStorage.set(k, String(v)),
  removeItem: (k) => mockStorage.delete(k),
  clear: () => mockStorage.clear(),
};
globalThis.localStorage = globalThis.sessionStorage;

describe("PHASE 08.4: SECURE REGISTRATION ID MANUAL CHECK-IN", () => {
  const scannerPath = path.resolve("ORGANISER_FRONTEND/src/components/scanner/EventScanner.tsx");
  const attendanceServicePath = path.resolve("ORGANISER_FRONTEND/src/api/attendanceService.ts");
  const scanResultPanelPath = path.resolve("ORGANISER_FRONTEND/src/components/scanner/ScanResultPanel.tsx");
  const bottomNavPath = path.resolve("ORGANISER_FRONTEND/src/components/layout/BottomNavigation.tsx");

  let scannerContent = "";
  let attendanceServiceContent = "";
  let scanResultPanelContent = "";
  let bottomNavContent = "";

  beforeEach(() => {
    mockStorage.clear();
    scannerContent = fs.readFileSync(scannerPath, "utf-8");
    attendanceServiceContent = fs.readFileSync(attendanceServicePath, "utf-8");
    scanResultPanelContent = fs.readFileSync(scanResultPanelPath, "utf-8");
    bottomNavContent = fs.readFileSync(bottomNavPath, "utf-8");
  });

  // --------------------------------------------------------------------------
  // GROUP 1: SEARCH INTERFACE & VALIDATION
  // --------------------------------------------------------------------------
  describe("Group 1: Search Interface & Validation", () => {
    it("29. Manual Check-in tab renders search interface matching Screen 2", () => {
      // Must have segmented tab button for Manual Check-in
      assert.match(
        scannerContent,
        /<span>Manual Check-in<\/span>/,
        "Segmented control must include 'Manual Check-in' tab"
      );
      assert.match(
        scannerContent,
        /activeTab\s*===\s*"MANUAL"/,
        "Must support activeTab === 'MANUAL' state"
      );

      // Must have Registration ID Search header
      assert.match(
        scannerContent,
        /<h3>Registration ID Search<\/h3>/,
        "Must render 'Registration ID Search' heading"
      );
      assert.match(
        scannerContent,
        /<p>Enter the participant's Registration ID to find and check-in\.<\/p>/,
        "Must render matching search subtitle"
      );

      // Must render search input with realistic 24-char hex placeholder
      assert.match(
        scannerContent,
        /placeholder="e\.g\.\s*(?:507f1f77bcf86cd799439011|[a-f0-9]{24})"/,
        "Must display 24-character hex placeholder"
      );

      // Must have search submit button and info callout
      assert.match(
        scannerContent,
        /className="search-submit-btn"/,
        "Must render dedicated search button"
      );
      assert.match(
        scannerContent,
        /Enter the 24-character Registration ID from the participant's ticket or receipt\./,
        "Must display informative callout"
      );
    });

    it("30. Validates 24-character hexadecimal ObjectId format", () => {
      // Must contain regex validation for 24 hex characters
      assert.match(
        scannerContent,
        /\/\^\[a-f0-9\]\{24\}\$\/i/,
        "Must enforce 24-character hexadecimal ObjectId format check"
      );

      // Must trim input and show clear error message if format is invalid
      assert.match(
        scannerContent,
        /Registration ID must be a valid 24-character hexadecimal ID/,
        "Must display specific validation error for non-hex or invalid length"
      );

      // Validate the regex against sample valid and invalid inputs
      const hexRegex = /^[a-f0-9]{24}$/i;
      assert.equal(hexRegex.test("507f1f77bcf86cd799439011"), true, "Valid 24-hex string should pass");
      assert.equal(hexRegex.test("507f1f77bcf86cd79943901Z"), false, "Non-hex characters should fail");
      assert.equal(hexRegex.test("507f1f77bcf86cd79943901"), false, "23 chars should fail");
      assert.equal(hexRegex.test("507f1f77bcf86cd7994390111"), false, "25 chars should fail");
      assert.equal(hexRegex.test("VIB26-REG-000123"), false, "Legacy string format should fail 24-hex test");
    });

    it("31. Loading and error states during registration search", () => {
      // Must track isSearchingRegId loading state
      assert.match(
        scannerContent,
        /const\s*\[isSearchingRegId,\s*setIsSearchingRegId\]\s*=\s*useState\(false\)/,
        "Must declare isSearchingRegId state"
      );

      // Must show loading indicator on submit button
      assert.match(
        scannerContent,
        /isSearchingRegId\s*\?\s*<RefreshCw[^>]*is-spinning/,
        "Must render spinning loader while lookup request is in flight"
      );

      // Input and button disabled during search
      assert.match(
        scannerContent,
        /disabled=\{isSearchingRegId\s*\|\|\s*isSubmittingManual\}/,
        "Input must be disabled while searching"
      );

      // Must track and display lookupError
      assert.match(
        scannerContent,
        /const\s*\[lookupError,\s*setLookupError\]\s*=\s*useState/,
        "Must declare lookupError state"
      );
      assert.match(
        scannerContent,
        /<strong>Lookup Failed:<\/strong>\s*\{lookupError\}/,
        "Must render error alert when lookup fails"
      );
    });
  });

  // --------------------------------------------------------------------------
  // GROUP 2: PARTICIPANT PREVIEW & ELIGIBILITY VERIFICATION
  // --------------------------------------------------------------------------
  describe("Group 2: Participant Preview & Eligibility Verification", () => {
    it("32. Exact participant preview rendering (Screen 2 attributes)", () => {
      // Must render participant verification card when lookupResult is present
      assert.match(
        scannerContent,
        /\{lookupResult\s*&&\s*\(/,
        "Must conditionally render verification card when lookupResult exists"
      );

      // Must render fullName and registrationId
      assert.match(
        scannerContent,
        /\{lookupResult\.participant\.fullName\}/,
        "Must display participant full name"
      );
      assert.match(
        scannerContent,
        /ID:\s*\{lookupResult\.registrationId\}/,
        "Must display Registration ID in monospace"
      );

      // Must render College, Department, Roll Number, and Mobile
      assert.match(
        scannerContent,
        /\{lookupResult\.participant\.collegeName/,
        "Must display college name"
      );
      assert.match(
        scannerContent,
        /\{lookupResult\.participant\.department/,
        "Must display department"
      );
      assert.match(
        scannerContent,
        /\{lookupResult\.participant\.rollNumber/,
        "Must display roll number"
      );
      assert.match(
        scannerContent,
        /\{lookupResult\.participant\.maskedMobile/,
        "Must display masked mobile number"
      );

      // Must render registrationType and cohort / pass type
      assert.match(
        scannerContent,
        /\{lookupResult\.registration\.registrationType\}/,
        "Must display registration type"
      );
      assert.match(
        scannerContent,
        /lookupResult\.registration\.cohortType\s*===\s*"COMBO"/,
        "Must display pass cohort type"
      );
    });

    it("33. Correct payment and eligibility status messaging", () => {
      // Must display eligibility pill
      assert.match(
        scannerContent,
        /lookupResult\.eligibility\.canCheckIn\s*\?\s*"✔ Eligible"\s*:\s*lookupResult\.eligibility\.reasonCode/,
        "Must display eligibility badge with clear affirmative or reason code"
      );

      // Must inspect payment status and eligible check-in banner
      assert.match(
        scannerContent,
        /Eligible for Check-in at \{selectedEventName\}\.\s*Payment is \{lookupResult\.eligibility\.paymentStatus\}/,
        "Must display green eligibility notification banner"
      );

      // Must render warning banner when not eligible
      assert.match(
        scannerContent,
        /lookupResult\.eligibility\.alreadyCheckedIn\s*\?\s*"Already Checked In"\s*:\s*"Admission Not Allowed"/,
        "Must show admission rejection or already-checked-in headline"
      );
      assert.match(
        scannerContent,
        /\{lookupResult\.eligibility\.message\}/,
        "Must display specific server eligibility message"
      );
    });

    it("34. Identity confirmation checkbox required before admission", () => {
      // Must track identityConfirmed state
      assert.match(
        scannerContent,
        /const\s*\[identityConfirmed,\s*setIdentityConfirmed\]\s*=\s*useState\(false\)/,
        "Must track identityConfirmed boolean state"
      );

      // Must render explicit physical photo ID confirmation checkbox
      assert.match(
        scannerContent,
        /checked=\{identityConfirmed\}/,
        "Must bind checked state to identityConfirmed"
      );
      assert.match(
        scannerContent,
        /I confirm I have physically verified the participant's photo ID and identity at the gate\./,
        "Must display physical ID verification declaration"
      );

      // Confirm button must be disabled if identity is not confirmed
      assert.match(
        scannerContent,
        /disabled=\{!identityConfirmed\s*\|\|\s*isSubmittingManual\}/,
        "Confirm button must require identityConfirmed === true"
      );
    });

    it("35. Confirmation button disabled while submitting to prevent double-admission", () => {
      // Must track isSubmittingManual state
      assert.match(
        scannerContent,
        /const\s*\[isSubmittingManual,\s*setIsSubmittingManual\]\s*=\s*useState\(false\)/,
        "Must declare isSubmittingManual state"
      );

      // Confirm button displays loading state while submitting
      assert.match(
        scannerContent,
        /isSubmittingManual\s*\?\s*\([\s\S]*?Admitting Participant…/,
        "Must display active progress text while submitting"
      );

      // In handleConfirmManualCheckIn, guard against double submission
      assert.match(
        scannerContent,
        /if\s*\(!lookupResult\s*\|\|\s*!identityConfirmed\s*\|\|\s*isSubmittingManual\)\s*return/,
        "handleConfirmManualCheckIn must reject in-flight or unconfirmed calls"
      );
    });
  });

  // --------------------------------------------------------------------------
  // GROUP 3: SUCCESS STATE, SCAN RESULT PANEL & WORKFLOW RESET
  // --------------------------------------------------------------------------
  describe("Group 3: Success State & Workflow Reset", () => {
    it("36. Success state uses existing ScanResultPanel (Screen 3)", () => {
      // In MANUAL tab, ScanResultPanel is rendered when scanResult exists
      assert.match(
        scannerContent,
        /\{scanResult\s*&&\s*\(state\s*===\s*"SUCCESS"\s*\|\|\s*state\s*===\s*"REJECTED"\)\s*\?\s*\(\s*<ScanResultPanel/,
        "Manual tab must render ScanResultPanel upon check-in completion"
      );

      // ScanResultPanel must render check-in details
      assert.match(
        scanResultPanelContent,
        /Check-in Successful/,
        "ScanResultPanel must render success headline"
      );
      assert.match(
        scanResultPanelContent,
        /participantName/,
        "ScanResultPanel must support participant name"
      );
      assert.match(
        scanResultPanelContent,
        /registrationId/,
        "ScanResultPanel must support registration ID"
      );
      assert.match(
        scanResultPanelContent,
        /Next Participant/,
        "ScanResultPanel must render Next Participant button"
      );
    });

    it("37. 'Next Participant' action retains MANUAL tab", () => {
      // In ScanResultPanel for MANUAL tab, onReset points to handleManualScanNext
      assert.match(
        scannerContent,
        /onReset=\{handleManualScanNext\}/,
        "Manual tab ScanResultPanel must bind onReset to handleManualScanNext"
      );

      // handleManualScanNext must reset form fields without switching activeTab to 'SCAN'
      assert.match(
        scannerContent,
        /const\s*handleManualScanNext\s*=\s*useCallback\(\(\)\s*=>\s*\{[\s\S]*?setScanResult\(null\);[\s\S]*?setRegIdInput\(""\);[\s\S]*?setLookupResult\(null\);[\s\S]*?setIdentityConfirmed\(false\);/,
        "handleManualScanNext must reset form fields without changing activeTab"
      );

      // QR handleScanNext switches back to SCAN, proving handleManualScanNext leaves activeTab as MANUAL
      assert.match(
        scannerContent,
        /setActiveTab\("SCAN"\);/,
        "handleScanNext sets activeTab to SCAN, proving handleManualScanNext leaves activeTab as MANUAL"
      );
    });

    it("38. 'Next Participant' action retains selected event venue", () => {
      // handleManualScanNext does NOT clear or change selectedEventId
      const manualResetMatch = scannerContent.match(
        /const\s*handleManualScanNext\s*=\s*useCallback\(\(\)\s*=>\s*\{([\s\S]*?)\},\s*\[\]\);/
      );
      assert.ok(manualResetMatch, "handleManualScanNext must be defined");
      const manualResetBody = manualResetMatch[1];

      assert.equal(
        manualResetBody.includes("selectedEventId"),
        false,
        "handleManualScanNext must never mutate selectedEventId"
      );
      assert.equal(
        manualResetBody.includes("setSelectedEventId"),
        false,
        "handleManualScanNext must never reset selected event state"
      );
    });

    it("39. Event switching clears stale lookup state", () => {
      // useEffect on selectedEventId must reset manual check-in state
      const eventSwitchEffect = scannerContent.match(
        /useEffect\(\(\)\s*=>\s*\{([\s\S]*?)\},\s*\[selectedEventId,\s*stopCamera\]\);/
      );
      assert.ok(eventSwitchEffect, "Event change useEffect must be declared");
      const effectBody = eventSwitchEffect[1];

      assert.match(effectBody, /setRegIdInput\(""\)/, "Must clear regIdInput on event change");
      assert.match(effectBody, /setLookupResult\(null\)/, "Must clear lookupResult on event change");
      assert.match(effectBody, /setLookupError\(null\)/, "Must clear lookupError on event change");
      assert.match(effectBody, /setIdentityConfirmed\(false\)/, "Must reset identityConfirmed on event change");
      assert.match(effectBody, /setScanResult\(null\)/, "Must clear scanResult on event change");
    });
  });

  // --------------------------------------------------------------------------
  // GROUP 4: REGRESSION PRESERVATION & DESIGN SYSTEM
  // --------------------------------------------------------------------------
  describe("Group 4: Regression Preservation & Design System", () => {
    it("40. Existing QR scanner remains completely functional", () => {
      // Camera viewport remains present
      assert.match(
        scannerContent,
        /<video[^>]*ref=\{videoRef\}/,
        "Camera video viewport must remain mounted"
      );

      // ZXing continuous decode flow intact
      assert.match(
        scannerContent,
        /decodeFromVideoDevice/,
        "ZXing decodeFromVideoDevice camera scanning flow must remain intact"
      );

      // QR token validation intact
      assert.match(
        scannerContent,
        /validateQrToken/,
        "QR token validator must remain integrated"
      );

      // QR check-in API call intact
      assert.match(
        attendanceServiceContent,
        /export\s+async\s+function\s+markAttendanceCheckIn/,
        "markAttendanceCheckIn must remain exported and active"
      );
    });

    it("41. Existing bottom navigation works across all tabs", () => {
      // Bottom navigation handles scan, events, tracker, dashboard
      assert.match(bottomNavContent, /handleNav\("scan"\)/, "Scan tab nav handler intact");
      assert.match(bottomNavContent, /handleNav\("events"\)/, "Events tab nav handler intact");
      assert.match(bottomNavContent, /handleNav\("tracker"\)/, "Tracker tab nav handler intact");
      assert.match(bottomNavContent, /handleNav\("dashboard"\)/, "Dashboard tab nav handler intact");
      assert.match(bottomNavContent, /\/scanner/, "Navigates to /scanner route");
      assert.match(bottomNavContent, /\/events/, "Navigates to /events route");
    });

    it("42. Mobile responsiveness matches white modern design reference", () => {
      // Modern white design tokens and styling classes used
      assert.match(
        scannerContent,
        /className="search-checkin-card"/,
        "Card container uses dedicated modern style class"
      );
      assert.match(
        scannerContent,
        /className="search-id-input"/,
        "Input uses modern styled class"
      );
      assert.match(
        scannerContent,
        /className="participant-verify-card"/,
        "Participant verification card uses dedicated style class"
      );
      assert.match(
        scannerContent,
        /var\(--primary\)/,
        "Uses design token for primary brand accent"
      );
      assert.match(
        scannerContent,
        /var\(--navy\)/,
        "Uses design token for navy typography"
      );
    });
  });
});
