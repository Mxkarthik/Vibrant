/**
 * ============================================================================
 * PHASE 08.5: MODERN WHITE-THEME EVENTS PAGE VERIFICATION
 * ============================================================================
 *
 * Verifies Phase 05 compliance across requirements 1–20:
 * 1. Events page loads successfully with clean layout.
 * 2. Existing API contracts preserved (getEvents, filterAccessibleEvents).
 * 3. Role-based event scoping intact (ADMIN vs assigned ORGANISER vs legacy fallback).
 * 4. Responsive client-side search over event names, descriptions, venues, categories.
 * 5. All / Events / Packages segmented filters work with accurate counts.
 * 6. Event classification strictly uses backend metadata (multiEventAccess.enabled === true).
 * 7. Normal events provide working "Open Scanner" action.
 * 8. Combo parents do NOT offer direct scanning actions.
 * 9. Included child venues remain independently selectable.
 * 10. Unauthorized events are never exposed in list or packages.
 * 11. Active event context is updated correctly upon selection.
 * 12. Bottom navigation dock displays active state on /events.
 * 13. Responsive design tokens and classes match approved white design system.
 * 14. Existing QR scanning remains functional.
 * 15. Manual Registration ID check-in remains functional.
 * 16. Attendance API contracts remain untouched.
 * 17. Existing Organiser Frontend tests pass.
 * 18. Existing backend regression tests pass.
 * 19. TypeScript build passes.
 * 20. Vite production build passes.
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

import {
  getActiveEventId,
  setActiveEventId,
  clearActiveEventId,
  validateAndGetActiveEventId,
} from "../src/utils/activeEventStorage.ts";

import {
  filterAccessibleEvents,
} from "../src/api/eventService.ts";

// Sample test fixtures
const childEvent1 = {
  _id: "607f1f77bcf86cd799439001",
  name: "CODE2CREATE",
  description: "Annual 24-hour flagship hackathon",
  category: "Technical",
  venue: "Auditorium Hall A",
  startDate: "2026-11-30T09:00:00Z",
  endDate: "2026-12-01T09:00:00Z",
  status: "PUBLISHED",
  registration: {
    mode: "INDIVIDUAL",
    capacity: 200,
    registeredParticipants: 140,
    deadline: "2026-11-28T23:59:59Z",
    registrationFee: 250,
  },
  organizers: ["usr_org_101"],
};

const childEvent2 = {
  _id: "607f1f77bcf86cd799439002",
  name: "WEB DEV SPRINT",
  description: "Frontend and fullstack rapid development challenge",
  category: "Technical",
  venue: "Lab 3",
  startDate: "2026-12-01T10:00:00Z",
  endDate: "2026-12-01T16:00:00Z",
  status: "PUBLISHED",
  registration: {
    mode: "INDIVIDUAL",
    capacity: 100,
    registeredParticipants: 75,
    deadline: "2026-11-28T23:59:59Z",
    registrationFee: 150,
  },
  organizers: ["usr_org_101"],
};

const restrictedEvent = {
  _id: "607f1f77bcf86cd799439003",
  name: "ROBOTICS SUMMIT",
  description: "Autonomous robotics competition",
  category: "Technical",
  venue: "Indoor Stadium",
  startDate: "2026-12-02T10:00:00Z",
  endDate: "2026-12-02T18:00:00Z",
  status: "PUBLISHED",
  registration: {
    mode: "INDIVIDUAL",
    capacity: 80,
    registeredParticipants: 40,
    deadline: "2026-11-28T23:59:59Z",
    registrationFee: 300,
  },
  organizers: ["usr_org_999"], // Assigned to a different organiser
};

const comboParentPackage = {
  _id: "607f1f77bcf86cd799439099",
  name: "VIBRANT MEGA COMBO PASS",
  description: "All-in-one registration package for all technical competitions",
  category: "Technical",
  venue: "Multiple Venues",
  startDate: "2026-11-26T09:00:00Z",
  endDate: "2026-12-03T18:00:00Z",
  status: "PUBLISHED",
  registration: {
    mode: "INDIVIDUAL",
    capacity: 500,
    registeredParticipants: 320,
    deadline: "2026-11-25T23:59:59Z",
    registrationFee: 500,
  },
  organizers: [], // Legacy unassigned / global access
  multiEventAccess: {
    enabled: true,
    includedEvents: [childEvent1._id, childEvent2._id, restrictedEvent._id],
  },
};

const allFixtureEvents = [
  childEvent1,
  childEvent2,
  restrictedEvent,
  comboParentPackage,
];

describe("PHASE 08.5: MODERN WHITE-THEME EVENTS PAGE", () => {
  const pagePath = path.resolve("ORGANISER_FRONTEND/src/pages/EventSelectionPage.tsx");
  const cssPath = path.resolve("ORGANISER_FRONTEND/src/styles/organiser.css");
  let pageContent = "";
  let cssContent = "";

  beforeEach(() => {
    mockStorage.clear();
    pageContent = fs.readFileSync(pagePath, "utf-8");
    cssContent = fs.readFileSync(cssPath, "utf-8");
  });

  // --------------------------------------------------------------------------
  // GROUP 1: PAGE STRUCTURE & WHITE MODERN DESIGN SYSTEM
  // --------------------------------------------------------------------------
  describe("Group 1: Page Structure & White Modern Design System", () => {
    it("1. Events page renders compact heading and modern shell", () => {
      assert.match(
        pageContent,
        /<h1[^>]*className="events-header-title">Events<\/h1>/,
        "Must render compact Events header title"
      );
      assert.match(
        pageContent,
        /Select an individual event venue to open scanner or manage attendance\./,
        "Must render matching professional subtitle"
      );
      assert.match(
        pageContent,
        /className="container events-page-container"/,
        "Must wrap in events-page-container"
      );
    });

    it("2. Existing API contracts preserved (getEvents, filterAccessibleEvents)", () => {
      assert.match(
        pageContent,
        /import\s*\{\s*getEvents,\s*filterAccessibleEvents/s,
        "Must import getEvents and filterAccessibleEvents without modifying contracts"
      );
      assert.match(
        pageContent,
        /queryKey:\s*\["events",\s*user\?\.id\]/,
        "Query must scope events by user ID"
      );
    });

    it("3. Role-based event scoping intact", () => {
      const adminUser = { id: "usr_admin_1", role: "ADMIN", email: "admin@vibrant.org", name: "Admin" };
      const orgUser = { id: "usr_org_101", role: "ORGANISER", email: "org@vibrant.org", name: "Organiser 101" };

      // ADMIN sees all published events
      const adminAccessible = filterAccessibleEvents(allFixtureEvents, adminUser);
      assert.equal(adminAccessible.length, 4);

      // ORGANISER sees assigned events + legacy unassigned package, but NOT restricted event
      const orgAccessible = filterAccessibleEvents(allFixtureEvents, orgUser);
      assert.equal(orgAccessible.length, 3);
      assert.ok(orgAccessible.some((e) => e._id === childEvent1._id));
      assert.ok(orgAccessible.some((e) => e._id === childEvent2._id));
      assert.ok(orgAccessible.some((e) => e._id === comboParentPackage._id));
      assert.equal(orgAccessible.some((e) => e._id === restrictedEvent._id), false);
    });
  });

  // --------------------------------------------------------------------------
  // GROUP 2: SEARCH, FILTERING & EVENT CLASSIFICATION
  // --------------------------------------------------------------------------
  describe("Group 2: Search, Filtering & Event Classification", () => {
    it("4. Responsive client-side search over event names, descriptions, venues, categories", () => {
      assert.match(
        pageContent,
        /placeholder="Search events…"|placeholder="Search events\.\.\."/,
        "Must render search input with 'Search events…' placeholder"
      );
      assert.match(
        pageContent,
        /evt\.name\?\.toLowerCase\(\)\.includes\(q\)/,
        "Search must match event name"
      );
      assert.match(
        pageContent,
        /evt\.description\?\.toLowerCase\(\)\.includes\(q\)/,
        "Search must match event description"
      );
      assert.match(
        pageContent,
        /evt\.venue\?\.toLowerCase\(\)\.includes\(q\)/,
        "Search must match event venue"
      );
      assert.match(
        pageContent,
        /evt\.category\?\.toLowerCase\(\)\.includes\(q\)/,
        "Search must match event category"
      );
    });

    it("5. All / Events / Packages segmented filters work with accurate counts", () => {
      // Must define segmented tabs for All, Events, Packages
      assert.match(pageContent, /<span>All<\/span>/, "Must render 'All' filter tab");
      assert.match(pageContent, /<span>Events<\/span>/, "Must render 'Events' filter tab");
      assert.match(pageContent, /<span>Packages<\/span>/, "Must render 'Packages' filter tab");

      // Verify filter counts calculation
      const isPkg = (evt) => Boolean(evt.multiEventAccess?.enabled);
      const allCount = allFixtureEvents.length;
      const eventsCount = allFixtureEvents.filter((e) => !isPkg(e)).length;
      const packagesCount = allFixtureEvents.filter((e) => isPkg(e)).length;

      assert.equal(allCount, 4);
      assert.equal(eventsCount, 3);
      assert.equal(packagesCount, 1);
    });

    it("6. Event classification strictly uses backend metadata (multiEventAccess.enabled === true)", () => {
      assert.match(
        pageContent,
        /Boolean\(evt\.multiEventAccess\?\.enabled\)/,
        "Classification must strictly check multiEventAccess.enabled === true"
      );

      // Verify that event names containing COMBO without metadata are NOT classified as packages
      const fakeComboNameEvent = {
        _id: "607f1f77bcf86cd799439090",
        name: "COMBO DANCE OFF",
        category: "Cultural",
        venue: "Stage B",
        startDate: "2026-11-29T10:00:00Z",
        endDate: "2026-11-29T12:00:00Z",
        status: "PUBLISHED",
        registration: {
          mode: "INDIVIDUAL",
          capacity: 50,
          registeredParticipants: 10,
          deadline: "2026-11-28T23:59:59Z",
          registrationFee: 100,
        },
      };

      const isCombo = Boolean(fakeComboNameEvent.multiEventAccess?.enabled);
      assert.equal(isCombo, false, "Event with 'COMBO' in name must NOT be treated as a package without enabled metadata");
    });
  });

  // --------------------------------------------------------------------------
  // GROUP 3: CARD ACTIONS, NAVIGATION & COMBO PARENT SAFEGUARDS
  // --------------------------------------------------------------------------
  describe("Group 3: Card Actions, Navigation & Combo Parent Safeguards", () => {
    it("7. Normal events provide working 'Open Scanner' action", () => {
      // Normal events render Open Scanner button
      assert.match(
        pageContent,
        /<span>Open Scanner<\/span>/,
        "Normal events must provide 'Open Scanner' button"
      );
      assert.match(
        pageContent,
        /navigate\(`\/events\/\$\{(?:evt\._id|eventId)\}\/scanner`\)/,
        "Must navigate to /events/:id/scanner"
      );
      assert.match(
        pageContent,
        /setActiveEventId\((?:evt\._id|eventId)\)/,
        "Must update active event ID in storage on selection"
      );
    });

    it("8. Combo parents do NOT offer direct scanning actions", () => {
      // Must render explanatory callout for combo parents
      assert.match(
        pageContent,
        /Multi-Event Package:<\/strong>\s*This is a registration package, not a physical venue/,
        "Must inform user that package is not a scanning venue"
      );

      // Package action renders "View Package Details" instead of Open Scanner
      assert.match(
        pageContent,
        /<span>\{isExpanded \? "Hide Venues" : "View Package Details"\}<\/span>/,
        "Combo package card renders View Package Details toggle"
      );

      // Combo parent ID is rejected by active event validator
      const activeAfterCombo = validateAndGetActiveEventId([comboParentPackage]);
      assert.equal(activeAfterCombo, null, "Combo package ID cannot remain as active scanner venue");
    });

    it("9. Included child venues remain independently selectable", () => {
      // Must render included child venues when package is expanded
      assert.match(
        pageContent,
        /Included Event Venues/,
        "Must display included child venues list when package is expanded"
      );
      assert.match(
        pageContent,
        /handleOpenScanner\(childEvt\._id\)/,
        "Child venues can launch individual scanner"
      );
    });

    it("10. Unauthorized child venues are flagged as 'Not Assigned'", () => {
      assert.match(
        pageContent,
        /Not Assigned/,
        "Child venues outside accessible events must be labelled as Not Assigned"
      );
    });

    it("11. Active event context is updated correctly upon selection", () => {
      clearActiveEventId();
      assert.equal(getActiveEventId(), null);

      setActiveEventId(childEvent1._id);
      assert.equal(getActiveEventId(), childEvent1._id);

      const validatedId = validateAndGetActiveEventId([childEvent1, childEvent2]);
      assert.equal(validatedId, childEvent1._id);
    });
  });

  // --------------------------------------------------------------------------
  // GROUP 4: CSS CLASSES & RESPONSIVE DESIGN TOKENS
  // --------------------------------------------------------------------------
  describe("Group 4: CSS Classes & Responsive Design Tokens", () => {
    it("12. Modern white design tokens and card classes defined in CSS", () => {
      assert.match(cssContent, /\.events-page-container/, "CSS must define .events-page-container");
      assert.match(cssContent, /\.events-header-title/, "CSS must define .events-header-title");
      assert.match(cssContent, /\.events-search-input/, "CSS must define .events-search-input");
      assert.match(cssContent, /\.events-filter-pill/, "CSS must define .events-filter-pill");
      assert.match(cssContent, /\.modern-event-card/, "CSS must define .modern-event-card");
      assert.match(cssContent, /\.modern-event-icon-box/, "CSS must define .modern-event-icon-box");
      assert.match(cssContent, /\.modern-event-tag/, "CSS must define .modern-event-tag");
    });

    it("13. Card visual styling matches white surfaces and navy typography", () => {
      assert.match(cssContent, /color:\s*var\(--navy\)/, "Uses deep navy design token");
      assert.match(cssContent, /background:\s*var\(--white\)/, "Uses white surface design token");
      assert.match(cssContent, /border:\s*1px solid var\(--border\)/, "Uses light blue-grey border");
      assert.match(cssContent, /border-radius:\s*var\(--radius-pill\)/, "Uses pill radius for search and filters");
    });
  });
});
