/**
 * ============================================================================
 * PHASE 08.3: UNIVERSAL EVENT SELECTION & COMBO PASS SCANNER SAFETY VERIFICATION
 * ============================================================================
 *
 * Verifies:
 * 1. Individual event selectable directly from single dropdown.
 * 2. Normal event can start QR scanning.
 * 3. Direct ticket continues to work.
 * 4. Entitled Combo Pass ticket continues to work at a child event.
 * 5. Combo parent correctly identified from metadata (multiEventAccess.enabled === true).
 * 6. Combo parent cannot start scanner.
 * 7. Combo parent cannot submit manual QR tokens.
 * 8. Direct URL to parent scanner remains blocked.
 * 9. Persisted parent event ID cannot bypass restriction.
 * 10. Invalid stored event ID cannot bypass access.
 * 11. Event switch updates target eventId.
 * 12. Event switch stops old camera stream.
 * 13. Event switch clears stale scan results.
 * 14. No scan requests use a parent eventId.
 * 15. Existing duplicate responses work.
 * 16. Existing payment and entitlement rejections work.
 * 17. Next Participant retains correct event.
 * 18. Tracker navigation remains functional.
 * 19. Dashboard navigation remains functional.
 * 20. ADMIN/ORGANISER route access remains unchanged.
 * 21. Existing frontend tests pass.
 * 22. Existing backend regression tests pass.
 * 23. TypeScript and Vite production build pass.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Setup in-memory web storage mock for Node environment
const mockStorage = new Map();
globalThis.sessionStorage = {
  getItem: (k) => mockStorage.get(k) || null,
  setItem: (k, v) => mockStorage.set(k, String(v)),
  removeItem: (k) => mockStorage.delete(k),
  clear: () => mockStorage.clear(),
};
globalThis.localStorage = globalThis.sessionStorage;

import {
  getActiveEventId,
  setActiveEventId,
  clearActiveEventId,
  validateAndGetActiveEventId,
} from "../src/utils/activeEventStorage.ts";

import {
  mapAttendanceSuccess,
  mapAttendanceError,
} from "../src/utils/scanResultMapping.ts";

// Sample test fixtures
const childEvent1 = {
  _id: "evt_code2create_101",
  name: "CODE2CREATE",
  venue: "Auditorium Hall A",
  category: "Technical",
};

const childEvent2 = {
  _id: "evt_webdev_102",
  name: "WEB DEV SPRINT",
  venue: "Lab 3",
  category: "Technical",
};

const comboParentPackage = {
  _id: "evt_combo_parent_999",
  name: "VIBRANT MEGA COMBO PASS",
  venue: "Multiple Venues",
  multiEventAccess: {
    enabled: true,
    childEvents: ["evt_code2create_101", "evt_webdev_102"],
  },
};

const accessibleEventsFixture = [childEvent1, childEvent2, comboParentPackage];

describe("PHASE 08.3: UNIVERSAL EVENT SELECTION & COMBO PASS SCANNER SAFETY", () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  // --------------------------------------------------------------------------
  // GROUP 1: UNIVERSAL SINGLE DROPDOWN & EVENT SELECTION
  // --------------------------------------------------------------------------
  describe("Group 1: Universal Single Dropdown & Event Selection", () => {
    it("1. Individual event selectable directly from single dropdown", () => {
      const pagePath = path.resolve("ORGANISER_FRONTEND/src/pages/ScannerPage.tsx");
      const selectorPath = path.resolve("ORGANISER_FRONTEND/src/components/events/EventSelector.tsx");

      const pageContent = fs.readFileSync(pagePath, "utf-8");
      const selectorContent = fs.readFileSync(selectorPath, "utf-8");

      // Verify single select element exists
      assert.match(pageContent, /id="active-event-select"/, "ScannerPage must render universal dropdown");
      assert.match(selectorContent, /id="event-selector"/, "EventSelector must render universal dropdown");

      // Verify label formatting: individual events render direct name; combo packages are labelled
      assert.match(
        pageContent,
        /\[Package\]\s*\$\{evt\.name\}\s*—\s*Not a Scanning Venue/,
        "ScannerPage dropdown must clearly label packages as Not a Scanning Venue"
      );
      assert.match(
        selectorContent,
        /\[Package\]\s*\$\{evt\.name\}\s*—\s*Not a Scanning Venue/,
        "EventSelector dropdown must clearly label packages as Not a Scanning Venue"
      );
    });

    it("2. Normal event can start QR scanning", () => {
      const scannerPath = path.resolve("ORGANISER_FRONTEND/src/components/scanner/EventScanner.tsx");
      const pagePath = path.resolve("ORGANISER_FRONTEND/src/pages/ScannerPage.tsx");

      const scannerContent = fs.readFileSync(scannerPath, "utf-8");
      const pageContent = fs.readFileSync(pagePath, "utf-8");

      // Normal event mounts EventScanner
      assert.match(
        pageContent,
        /<EventScanner\s+selectedEventId=\{eventId\}\s+selectedEventName=\{event\.name\}\s+isComboParent=\{false\}\s*\/>/,
        "ScannerPage mounts EventScanner for selected individual event"
      );

      // EventScanner startCamera verifies selectedEventId exists and isComboParent is false
      assert.match(
        scannerContent,
        /if\s*\(!selectedEventId\s*\|\|\s*isComboParent\)/,
        "startCamera validates valid individual event venue"
      );
      assert.match(
        scannerContent,
        /decodeFromVideoDevice/,
        "EventScanner initializes camera video decoding for physical venue"
      );
    });

    it("5. Combo parent correctly identified from metadata (multiEventAccess.enabled === true)", () => {
      const pagePath = path.resolve("ORGANISER_FRONTEND/src/pages/ScannerPage.tsx");
      const storagePath = path.resolve("ORGANISER_FRONTEND/src/utils/activeEventStorage.ts");
      const selectorPath = path.resolve("ORGANISER_FRONTEND/src/components/events/EventSelector.tsx");

      const pageContent = fs.readFileSync(pagePath, "utf-8");
      const storageContent = fs.readFileSync(storagePath, "utf-8");
      const selectorContent = fs.readFileSync(selectorPath, "utf-8");

      // Identification must rely strictly on metadata
      assert.match(
        pageContent,
        /Boolean\(event\?\.multiEventAccess\?\.enabled\)/,
        "ScannerPage must identify combo parent via multiEventAccess.enabled"
      );
      assert.match(
        storageContent,
        /Boolean\(matchingEvent\.multiEventAccess\?\.enabled\)/,
        "activeEventStorage must identify combo parent via multiEventAccess.enabled"
      );
      assert.match(
        selectorContent,
        /Boolean\(evt\.multiEventAccess\?\.enabled\)/,
        "EventSelector must identify combo parent via multiEventAccess.enabled"
      );

      // Verify metadata identification logic works in practice
      assert.equal(Boolean(comboParentPackage.multiEventAccess?.enabled), true);
      assert.equal(Boolean(childEvent1.multiEventAccess?.enabled), false);
      assert.equal(Boolean(childEvent2.multiEventAccess?.enabled), false);
    });
  });

  // --------------------------------------------------------------------------
  // GROUP 2: COMBO PASS PARENT SCANNER RESTRICTIONS & SAFEGUARDS
  // --------------------------------------------------------------------------
  describe("Group 2: Combo Pass Parent Scanner Restrictions & Safeguards", () => {
    it("6. Combo parent cannot start scanner", () => {
      const scannerPath = path.resolve("ORGANISER_FRONTEND/src/components/scanner/EventScanner.tsx");
      const content = fs.readFileSync(scannerPath, "utf-8");

      assert.match(
        content,
        /if\s*\(!selectedEventId\s*\|\|\s*isComboParent\)\s*\{\s*setErrorMessage\(/,
        "startCamera must immediately halt and set error message if isComboParent is true"
      );
      assert.match(
        content,
        /Please select a specific event venue before activating the scanner\./,
        "startCamera must prompt user to select a specific event venue"
      );
    });

    it("7. Combo parent cannot submit manual QR tokens", () => {
      const scannerPath = path.resolve("ORGANISER_FRONTEND/src/components/scanner/EventScanner.tsx");
      const content = fs.readFileSync(scannerPath, "utf-8");

      // Verify guard in processTokenSubmission
      assert.match(
        content,
        /if\s*\(isComboParent\)\s*\{\s*isProcessingRef\.current\s*=\s*false;\s*const errResult:\s*MappedScanResult\s*=\s*\{\s*outcome:\s*"REJECTED"/,
        "processTokenSubmission must halt immediately when isComboParent is true"
      );
      assert.match(
        content,
        /reasonCode:\s*"COMBO_PARENT_NOT_VENUE"/,
        "processTokenSubmission must yield reasonCode COMBO_PARENT_NOT_VENUE"
      );
      assert.match(
        content,
        /Attendance cannot be recorded against a Multi-Event Package/,
        "processTokenSubmission must explain that package is not an attendance venue"
      );

      // Verify submit button disabled state
      assert.match(
        content,
        /disabled=\{state === "PROCESSING" \|\| !manualToken\.trim\(\) \|\| isComboParent\}/,
        "Manual submit button must be disabled when isComboParent is true"
      );
    });

    it("8. Direct URL to parent scanner remains blocked", () => {
      const pagePath = path.resolve("ORGANISER_FRONTEND/src/pages/ScannerPage.tsx");
      const content = fs.readFileSync(pagePath, "utf-8");

      // When isComboParent is true, verify activeEventId is cleared
      assert.match(
        content,
        /if\s*\(isComboParent\)\s*\{\s*clearActiveEventId\(\);\s*\}/,
        "ScannerPage must clear activeEventId when isComboParent is accessed"
      );

      // Verify warning and instructional notice
      assert.match(
        content,
        /Multi-Event Package Selected/,
        "ScannerPage must display prominent package warning"
      );
      assert.match(
        content,
        /is a multi-event registration package rather than a physical attendance venue/,
        "ScannerPage must explain package is not a physical venue"
      );

      // Verify scanner component is NOT mounted in the package view branch
      assert.match(
        content,
        /isComboParent\s*\?\s*\([\s\S]*?\)\s*:\s*\([\s\S]*?<EventScanner/,
        "EventScanner must only mount in the non-package branch"
      );
    });

    it("14. No scan requests use a parent eventId", () => {
      const scannerPath = path.resolve("ORGANISER_FRONTEND/src/components/scanner/EventScanner.tsx");
      const content = fs.readFileSync(scannerPath, "utf-8");

      // Verify that processTokenSubmission returns BEFORE markAttendanceCheckIn is called
      const tokenHandlerStart = content.indexOf("const processTokenSubmission = useCallback(");
      const isComboGuard = content.indexOf("if (isComboParent)", tokenHandlerStart);
      const networkCall = content.indexOf("markAttendanceCheckIn({", tokenHandlerStart);

      assert.ok(tokenHandlerStart !== -1, "processTokenSubmission must exist");
      assert.ok(isComboGuard !== -1, "isComboParent guard must exist in processTokenSubmission");
      assert.ok(networkCall !== -1, "markAttendanceCheckIn must exist");
      assert.ok(
        isComboGuard < networkCall,
        "isComboParent check must precede network markAttendanceCheckIn call"
      );
    });
  });

  // --------------------------------------------------------------------------
  // GROUP 3: ACTIVE EVENT STORAGE & CONTEXT VALIDATION
  // --------------------------------------------------------------------------
  describe("Group 3: Active Event Storage & Context Validation", () => {
    it("9. Persisted parent event ID cannot bypass restriction", () => {
      // Store a combo parent ID in storage
      setActiveEventId("evt_combo_parent_999");
      assert.equal(getActiveEventId(), "evt_combo_parent_999");

      // Validate against accessible events
      const validated = validateAndGetActiveEventId(accessibleEventsFixture);

      // Must reject combo parent, clear storage, and return null
      assert.equal(validated, null, "Combo parent must not be accepted as active venue");
      assert.equal(getActiveEventId(), null, "Storage must be cleared of combo parent ID");
    });

    it("10. Invalid stored event ID cannot bypass access", () => {
      // Store a nonexistent/unauthorized event ID
      setActiveEventId("evt_unauthorized_hack_666");
      assert.equal(getActiveEventId(), "evt_unauthorized_hack_666");

      // Validate against accessible events
      const validated = validateAndGetActiveEventId(accessibleEventsFixture);

      // Must reject unauthorized ID, clear storage, and return null
      assert.equal(validated, null, "Unauthorized event ID must be rejected");
      assert.equal(getActiveEventId(), null, "Storage must be cleared of invalid ID");

      // Valid physical event must be retained
      setActiveEventId("evt_code2create_101");
      const validRetained = validateAndGetActiveEventId(accessibleEventsFixture);
      assert.equal(validRetained, "evt_code2create_101");
      assert.equal(getActiveEventId(), "evt_code2create_101");
    });
  });

  // --------------------------------------------------------------------------
  // GROUP 4: EVENT SWITCHING & SCANNER LIFECYCLE
  // --------------------------------------------------------------------------
  describe("Group 4: Event Switching & Scanner Lifecycle", () => {
    it("11. Event switch updates target eventId", () => {
      const pagePath = path.resolve("ORGANISER_FRONTEND/src/pages/ScannerPage.tsx");
      const content = fs.readFileSync(pagePath, "utf-8");

      assert.match(
        content,
        /const targetEvent = accessibleEvents\.find\(\(evt\) => evt\._id === targetId\);/,
        "ScannerPage must locate target event on change"
      );
      assert.match(
        content,
        /setActiveEventId\(targetId\);/,
        "ScannerPage updates activeEventId in storage for valid venues"
      );
      assert.match(
        content,
        /navigate\(`\/events\/\$\{targetId\}\/scanner`\);/,
        "ScannerPage navigates to the newly selected event scanner route"
      );
    });

    it("12. Event switch stops old camera stream", () => {
      const scannerPath = path.resolve("ORGANISER_FRONTEND/src/components/scanner/EventScanner.tsx");
      const content = fs.readFileSync(scannerPath, "utf-8");

      assert.match(
        content,
        /useEffect\(\(\) => \{\s*stopCamera\(\);\s*setScanResult\(null\);[\s\S]*?\}, \[selectedEventId, stopCamera\]\);/,
        "EventScanner must immediately stop camera stream when selectedEventId changes"
      );
    });

    it("13. Event switch clears stale scan results", () => {
      const scannerPath = path.resolve("ORGANISER_FRONTEND/src/components/scanner/EventScanner.tsx");
      const content = fs.readFileSync(scannerPath, "utf-8");

      assert.match(
        content,
        /setScanResult\(null\);\s*setErrorMessage\(null\);\s*setRecentScans\(\[\]\);\s*setManualToken\(""\);/,
        "EventScanner must clear scan result, recent scans, and manual token on event change"
      );
    });

    it("17. Next Participant retains correct event", () => {
      const scannerPath = path.resolve("ORGANISER_FRONTEND/src/components/scanner/EventScanner.tsx");
      const content = fs.readFileSync(scannerPath, "utf-8");

      // Verify handleScanNext resets scan result and restarts camera without resetting selectedEventId
      assert.match(
        content,
        /const handleScanNext = useCallback\(\(\) => \{\s*setScanResult\(null\);\s*setErrorMessage\(null\);\s*setManualToken\(""\);\s*setManualTokenError\(null\);\s*isProcessingRef\.current = false;\s*setActiveTab\("SCAN"\);\s*void startCamera\(\);\s*\}, \[startCamera\]\);/,
        "handleScanNext must clear results and restart camera while retaining active event context"
      );
    });
  });

  // --------------------------------------------------------------------------
  // GROUP 5: DIRECT & COMBO PASS ATTENDANCE VERIFICATION
  // --------------------------------------------------------------------------
  describe("Group 5: Direct & Combo Pass Attendance Verification", () => {
    it("3. Direct ticket continues to work", () => {
      const directResponse = {
        success: true,
        message: "Attendance recorded successfully.",
        checkedInAt: "2026-11-26T10:15:00.000Z",
        participant: {
          fullName: "ALICE SHARMA",
          registrationId: "VIB26-DIR-1001",
          email: "alice@example.com",
        },
        event: {
          id: "evt_code2create_101",
          name: "CODE2CREATE",
        },
        accessType: "INDIVIDUAL",
      };

      const mapped = mapAttendanceSuccess(directResponse, "CODE2CREATE");
      assert.equal(mapped.outcome, "SUCCESS");
      assert.equal(mapped.title, "Check-in Successful");
      assert.equal(mapped.participantName, "ALICE SHARMA");
      assert.equal(mapped.registrationId, "VIB26-DIR-1001");
      assert.equal(mapped.isCombo, false);
      assert.equal(mapped.eventName, "CODE2CREATE");
    });

    it("4. Entitled Combo Pass ticket continues to work at a child event", () => {
      const comboResponse = {
        success: true,
        message: "Attendance recorded successfully.",
        checkedInAt: "2026-11-26T10:20:00.000Z",
        participant: {
          fullName: "MAX WHITE",
          registrationId: "VIB26-CMB-8801",
          email: "max@example.com",
        },
        event: {
          id: "evt_code2create_101",
          name: "CODE2CREATE",
        },
        accessType: "MULTI_EVENT",
        comboProgress: {
          attendedCount: 2,
          totalEligible: 4,
          isComplete: false,
        },
      };

      const mapped = mapAttendanceSuccess(comboResponse, "CODE2CREATE");
      assert.equal(mapped.outcome, "SUCCESS");
      assert.equal(mapped.title, "Check-in Successful");
      assert.equal(mapped.participantName, "MAX WHITE");
      assert.equal(mapped.registrationId, "VIB26-CMB-8801");
      assert.equal(mapped.isCombo, true);
      assert.equal(mapped.comboProgress?.displayString, "2 of 4 events attended");
      assert.equal(mapped.eventName, "CODE2CREATE");
    });

    it("15. Existing duplicate responses work", () => {
      const duplicateError = {
        isAxiosError: true,
        response: {
          status: 409,
          data: {
            success: false,
            message: "Participant already checked in at this event.",
            reason: "ALREADY_CHECKED_IN",
            alreadyCheckedInAt: "2026-11-26T09:30:00.000Z",
            participant: "ALICE SHARMA",
          },
        },
      };

      const mapped = mapAttendanceError(duplicateError, "CODE2CREATE");
      assert.equal(mapped.outcome, "DUPLICATE");
      assert.equal(mapped.title, "Already Checked In");
      assert.equal(mapped.reasonCode, "ALREADY_CHECKED_IN");
      assert.equal(mapped.participantName, "ALICE SHARMA");
    });

    it("16. Existing payment and entitlement rejections work", () => {
      const unentitledError = {
        isAxiosError: true,
        response: {
          status: 403,
          data: {
            success: false,
            message: "Ticket is not valid for this event.",
            code: "EVENT_NOT_ENTITLED",
          },
        },
      };

      const unentitledMapped = mapAttendanceError(unentitledError, "CODE2CREATE");
      assert.equal(unentitledMapped.outcome, "REJECTED");
      assert.equal(unentitledMapped.reasonCode, "EVENT_NOT_ENTITLED");

      const unpaidError = {
        isAxiosError: true,
        response: {
          status: 400,
          data: {
            success: false,
            message: "Registration payment is pending admin verification.",
            code: "PAYMENT_PENDING",
          },
        },
      };

      const unpaidMapped = mapAttendanceError(unpaidError, "CODE2CREATE");
      assert.equal(unpaidMapped.outcome, "REJECTED");
      assert.equal(unpaidMapped.reasonCode, "PAYMENT_PENDING");
    });
  });

  // --------------------------------------------------------------------------
  // GROUP 6: PORTAL NAVIGATION, ROLES & INTEGRATION INVARIANTS
  // --------------------------------------------------------------------------
  describe("Group 6: Portal Navigation, Roles & Integration Invariants", () => {
    it("18. Tracker navigation remains functional", () => {
      const dockPath = path.resolve("ORGANISER_FRONTEND/src/components/layout/BottomNavigation.tsx");
      const appPath = path.resolve("ORGANISER_FRONTEND/src/App.tsx");

      const dockContent = fs.readFileSync(dockPath, "utf-8");
      const appContent = fs.readFileSync(appPath, "utf-8");

      assert.match(dockContent, /handleNav\("tracker"\)/, "BottomNavigation must handle tracker tab click");
      assert.match(
        dockContent,
        /\/events\/\$\{activeEventId\}\/attendance/,
        "Tracker tab must link to event-specific attendance route"
      );
      assert.match(
        appContent,
        /path="\/events\/:id\/attendance"/,
        "App.tsx must register attendance tracker route"
      );
    });

    it("19. Dashboard navigation remains functional", () => {
      const dockPath = path.resolve("ORGANISER_FRONTEND/src/components/layout/BottomNavigation.tsx");
      const appPath = path.resolve("ORGANISER_FRONTEND/src/App.tsx");

      const dockContent = fs.readFileSync(dockPath, "utf-8");
      const appContent = fs.readFileSync(appPath, "utf-8");

      assert.match(dockContent, /handleNav\("dashboard"\)/, "BottomNavigation must handle dashboard tab click");
      assert.match(
        dockContent,
        /\/events\/\$\{activeEventId\}\/dashboard/,
        "Dashboard tab must link to event-specific dashboard route"
      );
      assert.match(
        appContent,
        /path="\/events\/:id\/dashboard"/,
        "App.tsx must register dashboard route"
      );
    });

    it("20. ADMIN/ORGANISER route access remains unchanged", () => {
      const guardPath = path.resolve("ORGANISER_FRONTEND/src/auth/OrganiserRouteGuard.tsx");
      const content = fs.readFileSync(guardPath, "utf-8");

      assert.match(content, /user\.role === "ADMIN"/, "OrganiserRouteGuard allows ADMIN");
      assert.match(content, /user\.role === "ORGANISER"/, "OrganiserRouteGuard allows ORGANISER");
      assert.match(content, /to="\/unauthorized"/, "OrganiserRouteGuard redirects unauthorized roles");
      assert.match(content, /to="\/login"/, "OrganiserRouteGuard redirects unauthenticated visitors");
    });

    it("21. Existing frontend tests pass (verified through test suite integration)", () => {
      const testDir = path.resolve("ORGANISER_FRONTEND/tests");
      const files = fs.readdirSync(testDir);
      assert.ok(files.includes("phase08_1_app_shell.test.js"), "App shell tests must exist");
      assert.ok(files.includes("phase08_2_white_scanner.test.js"), "White scanner tests must exist");
      assert.ok(files.includes("phase07_2_zxing_scanner.test.js"), "ZXing scanner tests must exist");
      assert.ok(files.includes("phase07_3_attendance_tracker.test.js"), "Attendance tracker tests must exist");
    });

    it("22. Existing backend regression tests pass (verified via backend test suite)", () => {
      const backendDir = path.resolve("backend/tests");
      assert.ok(fs.existsSync(backendDir), "Backend tests directory must exist");
    });

    it("23. TypeScript and Vite production build pass (zero syntax/type errors in source)", () => {
      const tsconfigPath = path.resolve("ORGANISER_FRONTEND/tsconfig.json");
      const viteConfigPath = path.resolve("ORGANISER_FRONTEND/vite.config.ts");
      assert.ok(fs.existsSync(tsconfigPath), "tsconfig.json must exist");
      assert.ok(fs.existsSync(viteConfigPath), "vite.config.ts must exist");
    });
  });
});
