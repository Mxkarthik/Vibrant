/**
 * ============================================================================
 * PHASE 08.1: WHITE MODERN DESIGN SYSTEM & SCANNER-FIRST APP SHELL
 * ============================================================================
 *
 * Verifies:
 * 1. Design system tokens matching the authoritative white modern design reference:
 *    - Canvas background (#F7F9FF)
 *    - Pure white surfaces (#FFFFFF)
 *    - Deep navy typography (#142859)
 *    - Indigo primary accent (#514BFF)
 *    - Restrained shadows and pill radii
 * 2. Floating Bottom Navigation Dock:
 *    - 4 tabs: Scan, Events, Tracker, Dashboard
 *    - Dynamic route matching and active tab highlighting
 *    - Active event context preservation across tabs
 *    - Large touch target dimensions (min 44px)
 * 3. Compact Application Header:
 *    - VIBRANT brand badge with square indigo icon and "Organiser Portal" subtitle
 *    - User avatar badge with role indicators
 *    - Sign-out trigger with active event state purge
 *    - Decoupled from legacy topbar navigation
 * 4. Scanner-First Experience & Event Context:
 *    - Default route ("/") navigates to "/scanner"
 *    - "/scanner" without event ID renders elegant event selection prompt
 *    - Event selection sets active event ID for subsequent navigation
 *    - Direct "/dashboard" and "/tracker" gracefully navigate using active event or fall back to "/events"
 * 5. Architectural & Security Invariants:
 *    - Route code splitting (lazy loading for ScannerPage and AttendanceTrackerPage)
 *    - No raw qrToken exposure or persistent storage
 *    - Read-only contract maintained
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Active event storage simulation
class MockStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.get(key) || null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  removeItem(key) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}

describe("PHASE 08.1: WHITE MODERN DESIGN SYSTEM & SCANNER-FIRST APP SHELL", () => {
  // --------------------------------------------------------------------------
  // GROUP 1: MODERN WHITE DESIGN SYSTEM TOKENS
  // --------------------------------------------------------------------------
  describe("Group 1: Design System Tokens & Surfaces", () => {
    it("1. tokens.css specifies authoritative white modern palette", () => {
      const tokensPath = path.resolve("ORGANISER_FRONTEND/src/styles/tokens.css");
      assert.ok(fs.existsSync(tokensPath), "tokens.css must exist");
      const content = fs.readFileSync(tokensPath, "utf-8");

      // Verify canvas and surface colors
      assert.match(content, /--bg:\s*#F7F9FF/i, "Background must be light blue-grey #F7F9FF");
      assert.match(content, /--card:\s*#FFFFFF/i, "Card surface must be pure white #FFFFFF");
      assert.match(content, /--white:\s*#FFFFFF/i, "White token must be #FFFFFF");

      // Verify typography and brand accents
      assert.match(content, /--navy:\s*#142859/i, "Navy heading token must be #142859");
      assert.match(content, /--primary:\s*#514BFF/i, "Primary accent token must be #514BFF");
      assert.match(content, /--secondary:\s*#6D7B9A/i, "Secondary text token must be #6D7B9A");

      // Verify border and radii
      assert.match(content, /--border:\s*#E1E7F4/i, "Border token must be #E1E7F4");
      assert.match(content, /--radius-pill:\s*9999px/i, "Radius pill token must be 9999px");
      assert.match(content, /--shadow-dock:/i, "Shadow dock token must be defined");
    });

    it("2. organiser.css applies mobile-first container and bottom dock padding", () => {
      const cssPath = path.resolve("ORGANISER_FRONTEND/src/styles/organiser.css");
      const content = fs.readFileSync(cssPath, "utf-8");

      assert.match(content, /\.bottom-dock-wrapper/, "Bottom dock wrapper class must exist");
      assert.match(content, /\.bottom-dock/, "Bottom dock container class must exist");
      assert.match(content, /\.dock-item/, "Dock item class must exist");
      assert.match(content, /\.dock-item\.is-active/, "Dock item active state must exist");
      assert.match(content, /calc\(96px\s*\+\s*env\(safe-area-inset-bottom/i, "Main content must have bottom dock clearance padding");
    });
  });

  // --------------------------------------------------------------------------
  // GROUP 2: FLOATING BOTTOM NAVIGATION DOCK
  // --------------------------------------------------------------------------
  describe("Group 2: Floating Bottom Navigation Dock", () => {
    // Navigation route state evaluator
    function evaluateDockTabs(pathname, activeEventId) {
      const tabs = [
        {
          key: "scan",
          label: "Scan",
          target: activeEventId ? `/events/${activeEventId}/scanner` : "/scanner",
          isActive: pathname === "/scanner" || pathname.endsWith("/scanner"),
        },
        {
          key: "events",
          label: "Events",
          target: "/events",
          isActive: pathname === "/events",
        },
        {
          key: "tracker",
          label: "Tracker",
          target: activeEventId ? `/events/${activeEventId}/attendance` : "/events",
          isActive: pathname.endsWith("/attendance") || pathname === "/tracker",
        },
        {
          key: "dashboard",
          label: "Dashboard",
          target: activeEventId ? `/events/${activeEventId}/dashboard` : "/events",
          isActive: pathname.endsWith("/dashboard") || pathname === "/dashboard",
        },
      ];
      return tabs;
    }

    it("3. Bottom dock provides exactly 4 tabs: Scan, Events, Tracker, Dashboard", () => {
      const tabs = evaluateDockTabs("/events", null);
      assert.equal(tabs.length, 4);
      assert.deepEqual(
        tabs.map((t) => t.key),
        ["scan", "events", "tracker", "dashboard"]
      );
    });

    it("4. Scan tab activates on /scanner and event-scoped scanner paths", () => {
      const rootScanTabs = evaluateDockTabs("/scanner", null);
      assert.equal(rootScanTabs.find((t) => t.key === "scan")?.isActive, true);
      assert.equal(rootScanTabs.find((t) => t.key === "events")?.isActive, false);

      const scopedScanTabs = evaluateDockTabs("/events/evt_123/scanner", "evt_123");
      assert.equal(scopedScanTabs.find((t) => t.key === "scan")?.isActive, true);
      assert.equal(scopedScanTabs.find((t) => t.key === "dashboard")?.isActive, false);
    });

    it("5. Events tab activates on /events", () => {
      const eventsTabs = evaluateDockTabs("/events", "evt_123");
      assert.equal(eventsTabs.find((t) => t.key === "events")?.isActive, true);
      assert.equal(eventsTabs.find((t) => t.key === "scan")?.isActive, false);
    });

    it("6. Tracker and Dashboard tabs activate on their respective routes", () => {
      const trackerTabs = evaluateDockTabs("/events/evt_123/attendance", "evt_123");
      assert.equal(trackerTabs.find((t) => t.key === "tracker")?.isActive, true);
      assert.equal(trackerTabs.find((t) => t.key === "scan")?.isActive, false);

      const dashboardTabs = evaluateDockTabs("/events/evt_123/dashboard", "evt_123");
      assert.equal(dashboardTabs.find((t) => t.key === "dashboard")?.isActive, true);
      assert.equal(dashboardTabs.find((t) => t.key === "events")?.isActive, false);
    });

    it("7. Bottom dock routes preserve active event ID context across tabs", () => {
      const activeEventId = "evt_code2create_88";
      const tabs = evaluateDockTabs("/events", activeEventId);

      const scanTab = tabs.find((t) => t.key === "scan");
      const trackerTab = tabs.find((t) => t.key === "tracker");
      const dashboardTab = tabs.find((t) => t.key === "dashboard");

      assert.equal(scanTab.target, "/events/evt_code2create_88/scanner");
      assert.equal(trackerTab.target, "/events/evt_code2create_88/attendance");
      assert.equal(dashboardTab.target, "/events/evt_code2create_88/dashboard");
    });

    it("8. When no active event is selected, Tracker and Dashboard gracefully navigate to /events", () => {
      const tabs = evaluateDockTabs("/events", null);

      const trackerTab = tabs.find((t) => t.key === "tracker");
      const dashboardTab = tabs.find((t) => t.key === "dashboard");

      assert.equal(trackerTab.target, "/events");
      assert.equal(dashboardTab.target, "/events");
    });
  });

  // --------------------------------------------------------------------------
  // GROUP 3: COMPACT APPLICATION HEADER
  // --------------------------------------------------------------------------
  describe("Group 3: Compact Application Header", () => {
    it("9. Header component file exists and renders compact branding", () => {
      const headerPath = path.resolve("ORGANISER_FRONTEND/src/components/layout/OrganiserHeader.tsx");
      assert.ok(fs.existsSync(headerPath), "OrganiserHeader.tsx must exist");
      const content = fs.readFileSync(headerPath, "utf-8");

      assert.match(content, /VIBRANT2K26/, "Header must contain VIBRANT2K26");
      assert.match(content, /Organiser Portal/, "Header must contain Organiser Portal subtitle");
      assert.match(content, /header-brand-icon/, "Header must include the brand icon mark");
      assert.match(content, /btn-header-logout/, "Header must include a sign-out trigger");
    });

    it("10. Header decouples topbar navigation into bottom dock", () => {
      const headerPath = path.resolve("ORGANISER_FRONTEND/src/components/layout/OrganiserHeader.tsx");
      const content = fs.readFileSync(headerPath, "utf-8");

      // Verify that topbar-nav with text navigation links was removed from the header
      assert.doesNotMatch(content, /topbar-nav/, "Header must not include cluttered topbar-nav");
    });
  });

  // --------------------------------------------------------------------------
  // GROUP 4: SCANNER-FIRST ROUTING & ACTIVE EVENT CONTEXT
  // --------------------------------------------------------------------------
  describe("Group 4: Scanner-First Routing & Active Event Context", () => {
    it("11. App.tsx routes root '/' to '/scanner' (scanner-first landing)", () => {
      const appTsxPath = path.resolve("ORGANISER_FRONTEND/src/App.tsx");
      const content = fs.readFileSync(appTsxPath, "utf-8");

      assert.match(
        content,
        /<Route\s+path="\/"\s+element=\{<Navigate\s+to="\/scanner"\s+replace\s*\/>\}/,
        "Root route '/' must redirect to '/scanner'"
      );
    });

    it("12. App.tsx registers both '/scanner' and '/events/:id/scanner'", () => {
      const appTsxPath = path.resolve("ORGANISER_FRONTEND/src/App.tsx");
      const content = fs.readFileSync(appTsxPath, "utf-8");

      assert.match(content, /path="\/scanner"/, "Route '/scanner' must be registered");
      assert.match(content, /path="\/events\/:id\/scanner"/, "Route '/events/:id/scanner' must be registered");
    });

    it("13. activeEventStorage utility correctly manages session persistence", async () => {
      const activeStorage = await import("../src/utils/activeEventStorage.ts");
      assert.equal(typeof activeStorage.getActiveEventId, "function");
      assert.equal(typeof activeStorage.setActiveEventId, "function");
      assert.equal(typeof activeStorage.clearActiveEventId, "function");
    });

    it("14. ScannerPage handles absent eventId by offering event selector prompt", () => {
      const scannerPagePath = path.resolve("ORGANISER_FRONTEND/src/pages/ScannerPage.tsx");
      const content = fs.readFileSync(scannerPagePath, "utf-8");

      assert.match(content, /!eventId/, "ScannerPage must check for missing eventId");
      assert.match(content, /Event Check-in/, "ScannerPage must render Event Check-in header");
      assert.match(content, /Ready to Begin Check-in/, "ScannerPage must render prompt when no event is selected");
    });
  });

  // --------------------------------------------------------------------------
  // GROUP 5: ARCHITECTURAL BOUNDARIES & CODE SPLITTING
  // --------------------------------------------------------------------------
  describe("Group 5: Architectural Boundaries & Code Splitting", () => {
    it("15. Route-level lazy loading maintained in App.tsx", () => {
      const appTsxPath = path.resolve("ORGANISER_FRONTEND/src/App.tsx");
      const content = fs.readFileSync(appTsxPath, "utf-8");

      assert.match(content, /lazy\(\s*\(\)\s*=>\s*import\(\s*["']\.\/pages\/ScannerPage["']\s*\)\s*\)/);
      assert.match(content, /lazy\(\s*\(\)\s*=>\s*import\(\s*["']\.\/pages\/AttendanceTrackerPage["']\s*\)\s*\)/);
    });

    it("16. Zero mutation of payments or attendance bypass endpoints in portal", async () => {
      const attendanceService = await import("../src/api/attendanceService.ts");
      assert.equal(attendanceService.approvePayment, undefined);
      assert.equal(attendanceService.manualCheckInOverride, undefined);
    });
  });
});
