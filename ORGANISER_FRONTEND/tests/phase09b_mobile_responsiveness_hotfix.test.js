/**
 * ============================================================================
 * PHASE 09B: STICKY BOTTOM NAVIGATION, ROUTING & MOBILE RESPONSIVENESS HOTFIX
 * ============================================================================
 *
 * Verifies:
 * 1. Sticky Bottom Navigation & Viewport Anchoring (Reqs 1-7, 16, 23, 24, 25):
 *    - Viewport meta tag configured with viewport-fit=cover
 *    - Viewport-fixed positioning (.bottom-dock-wrapper: position: fixed; bottom: max(12px, env(...)); left: 50%; transform: translateX(-50%))
 *    - Responsive dimensions: width: min(440px, calc(100% - 24px)); max-width: calc(100vw - 24px)
 *    - Grid layout: 4 equal-width columns (repeat(4, minmax(0, 1fr)))
 *    - Vertical icon-above-label layout for compact mobile screens
 *    - Pointer-events pass-through on wrapper, active clickability on dock
 *    - Main content bottom clearance: padding-bottom: calc(110px + env(safe-area-inset-bottom, 0px))
 * 2. Tracker & Dashboard Tab Navigation (Reqs 8-15):
 *    - BottomNavigation routes: Scan -> /scanner, Events -> /events, Tracker -> /tracker, Dashboard -> /dashboard
 *    - Event preservation: with active event, routes to /events/:id/attendance and /events/:id/dashboard
 *    - No-event landing state in Tracker: displays "Select an Event to View Attendance", no redirect to /events
 *    - No-event landing state in Dashboard: displays "Select an Event to View Dashboard", no redirect to /events
 *    - Tab active state detection handles both base (/tracker, /dashboard) and event-specific routes
 * 3. Active Event Selector (MODEL EXPO) Overflow Corrections (Reqs 17-18):
 *    - .event-selector-container has width: 100%; min-width: 0; max-width: 100%
 *    - .event-selector-select has min-width: 0; max-width: 100%; text-overflow: ellipsis
 *    - Mobile breakpoint collapses to vertical stack preventing horizontal overflow
 * 4. Tracker Search, Filter & Participant Card Responsiveness (Reqs 19-22):
 *    - Search input has 100% container width with clear button
 *    - Filters use responsive CSS Grid (4 cols desktop, 2 cols tablet/mobile, 1 col narrow)
 *    - 2-row participant card structure: Row 1 = Avatar + Name + Ref/Roll + Chevron; Row 2 = Badges + Time
 *    - Status badges (Present/Absent) located in row 2, completely separated from participant name
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("Phase 09B: Sticky Bottom Navigation, Routing & Mobile Responsiveness Hotfix", () => {
  const indexHtmlPath = path.resolve("ORGANISER_FRONTEND/index.html");
  const bottomNavPath = path.resolve("ORGANISER_FRONTEND/src/components/layout/BottomNavigation.tsx");
  const appPath = path.resolve("ORGANISER_FRONTEND/src/App.tsx");
  const trackerPagePath = path.resolve("ORGANISER_FRONTEND/src/pages/AttendanceTrackerPage.tsx");
  const dashboardPagePath = path.resolve("ORGANISER_FRONTEND/src/pages/EventDashboardPage.tsx");
  const eventSelectorPath = path.resolve("ORGANISER_FRONTEND/src/components/events/EventSelector.tsx");
  const attendanceTablePath = path.resolve("ORGANISER_FRONTEND/src/components/tracker/AttendanceTable.tsx");
  const cssPath = path.resolve("ORGANISER_FRONTEND/src/styles/organiser.css");

  const indexHtmlContent = fs.readFileSync(indexHtmlPath, "utf-8");
  const bottomNavContent = fs.readFileSync(bottomNavPath, "utf-8");
  const appContent = fs.readFileSync(appPath, "utf-8");
  const trackerPageContent = fs.readFileSync(trackerPagePath, "utf-8");
  const dashboardPageContent = fs.readFileSync(dashboardPagePath, "utf-8");
  const eventSelectorContent = fs.readFileSync(eventSelectorPath, "utf-8");
  const attendanceTableContent = fs.readFileSync(attendanceTablePath, "utf-8");
  const cssContent = fs.readFileSync(cssPath, "utf-8");

  // ==========================================================================
  // GROUP 1: STICKY DOCK POSITIONING & VIEWPORT INTEGRATION (REQS 1-7, 16, 23-25)
  // ==========================================================================
  describe("Group 1: Sticky Bottom Navigation & Viewport Anchoring", () => {
    it("1. Global viewport meta tag includes viewport-fit=cover for safe-area calculation", () => {
      assert.match(
        indexHtmlContent,
        /viewport-fit=cover/,
        "index.html must include viewport-fit=cover"
      );
    });

    it("2. Dock wrapper uses viewport-fixed anchoring centered at viewport bottom", () => {
      assert.match(
        cssContent,
        /\.bottom-dock-wrapper\s*\{[^}]*position:\s*fixed;/,
        "bottom-dock-wrapper must be position: fixed"
      );
      assert.match(
        cssContent,
        /\.bottom-dock-wrapper\s*\{[^}]*bottom:\s*max\(12px,\s*env\(safe-area-inset-bottom,\s*12px\)\);/,
        "bottom-dock-wrapper must respect safe-area-inset-bottom"
      );
      assert.match(
        cssContent,
        /\.bottom-dock-wrapper\s*\{[^}]*left:\s*50%;[^}]*transform:\s*translateX\(-50%\);/,
        "bottom-dock-wrapper must be centered horizontally via transform"
      );
    });

    it("3. Dock wrapper width is constrained to prevent mobile viewport overflow across all sizes", () => {
      assert.match(
        cssContent,
        /\.bottom-dock-wrapper\s*\{[^}]*width:\s*min\(440px,\s*calc\(100%\s*-\s*24px\)\);/,
        "bottom-dock-wrapper must use min(440px, calc(100% - 24px))"
      );
      assert.match(
        cssContent,
        /\.bottom-dock-wrapper\s*\{[^}]*max-width:\s*calc\(100vw\s*-\s*24px\);/,
        "bottom-dock-wrapper must enforce max-width calc(100vw - 24px)"
      );
    });

    it("4. Bottom dock uses 4-column CSS grid layout with equal-width minmax columns", () => {
      assert.match(
        cssContent,
        /\.bottom-dock\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);/,
        "bottom-dock must be a 4-column grid with minmax(0, 1fr)"
      );
    });

    it("5. Dock items stack icon above label for compact mobile responsiveness", () => {
      assert.match(
        cssContent,
        /\.dock-item\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*align-items:\s*center;/,
        "dock-item must be flex-direction: column"
      );
      assert.match(
        cssContent,
        /\.dock-item\s*\{[^}]*min-width:\s*0;[^}]*width:\s*100%;/,
        "dock-item must have min-width: 0 and width: 100%"
      );
      assert.match(
        cssContent,
        /\.dock-item-label\s*\{[^}]*text-overflow:\s*ellipsis;/,
        "dock-item-label must truncate gracefully with ellipsis"
      );
    });

    it("6. Wrapper has pointer-events: none and dock has pointer-events: auto so clicks pass through", () => {
      assert.match(
        cssContent,
        /\.bottom-dock-wrapper\s*\{[^}]*pointer-events:\s*none;/,
        "wrapper must have pointer-events: none"
      );
      assert.match(
        cssContent,
        /\.bottom-dock\s*\{[^}]*pointer-events:\s*auto;/,
        "dock must have pointer-events: auto"
      );
    });

    it("7. Main content has sufficient bottom padding to prevent dock from obscuring content/pagination", () => {
      assert.match(
        cssContent,
        /\.main-content\s*\{[^}]*padding:[^}]*calc\(110px\s*\+\s*env\(safe-area-inset-bottom,\s*0px\)\);/,
        "main-content must have at least 110px bottom clearance"
      );
    });
  });

  // ==========================================================================
  // GROUP 2: TRACKER & DASHBOARD NAVIGATION & LANDING (REQS 8-15)
  // ==========================================================================
  describe("Group 2: Tracker and Dashboard Route Fixes", () => {
    it("8. BottomNavigation navigates to /tracker when no active event is present", () => {
      assert.match(
        bottomNavContent,
        /case "tracker":\s*if\s*\(activeEventId\)\s*\{\s*navigate\(`\/events\/\$\{activeEventId\}\/attendance`\);\s*\}\s*else\s*\{\s*navigate\("\/tracker"\);\s*\}/,
        "Tracker tab must navigate to /tracker when no active event is selected"
      );
    });

    it("9. BottomNavigation navigates to /dashboard when no active event is present", () => {
      assert.match(
        bottomNavContent,
        /case "dashboard":\s*if\s*\(activeEventId\)\s*\{\s*navigate\(`\/events\/\$\{activeEventId\}\/dashboard`\);\s*\}\s*else\s*\{\s*navigate\("\/dashboard"\);\s*\}/,
        "Dashboard tab must navigate to /dashboard when no active event is selected"
      );
    });

    it("10. App.tsx registers /tracker route rendering AttendanceTrackerPage without kicking to /events", () => {
      assert.match(
        appContent,
        /<Route path="\/tracker" element=\{<ActiveTrackerRoute \/>\} \/>/,
        "App.tsx must register /tracker route"
      );
      assert.match(
        appContent,
        /function ActiveTrackerRoute\(\)[\s\S]*return \(\s*<Suspense fallback=\{<PageLoader \/>\}>\s*<AttendanceTrackerPage \/>\s*<\/Suspense>\s*\);/,
        "ActiveTrackerRoute must render AttendanceTrackerPage when no active event is selected"
      );
    });

    it("11. App.tsx registers /dashboard route rendering EventDashboardPage without kicking to /events", () => {
      assert.match(
        appContent,
        /<Route path="\/dashboard" element=\{<ActiveDashboardRoute \/>\} \/>/,
        "App.tsx must register /dashboard route"
      );
      assert.match(
        appContent,
        /function ActiveDashboardRoute\(\)[\s\S]*return <EventDashboardPage \/>;/,
        "ActiveDashboardRoute must render EventDashboardPage when no active event is selected"
      );
    });

    it("12. AttendanceTrackerPage renders 'Select an Event to View Attendance' when no eventId", () => {
      assert.match(
        trackerPageContent,
        /Select an Event to View Attendance/,
        "Tracker page must render prompt title when !eventId"
      );
      assert.match(
        trackerPageContent,
        /Choose an event venue from the dropdown above to view participant roster and attendance metrics\./,
        "Tracker page must render prompt description"
      );
    });

    it("13. EventDashboardPage renders 'Select an Event to View Dashboard' when no eventId", () => {
      assert.match(
        dashboardPageContent,
        /Select an Event to View Dashboard/,
        "Dashboard page must render prompt title when !eventId"
      );
      assert.match(
        dashboardPageContent,
        /Choose an event venue from the dropdown above to view check-in statistics and operational metrics\./,
        "Dashboard page must render prompt description"
      );
    });

    it("14. BottomNavigation highlights active tab correctly for base and event routes", () => {
      assert.match(
        bottomNavContent,
        /const isTrackerActive = pathname\.endsWith\("\/attendance"\) \|\| pathname === "\/tracker";/,
        "isTrackerActive must match both /attendance and /tracker"
      );
      assert.match(
        bottomNavContent,
        /const isDashboardActive = pathname\.endsWith\("\/dashboard"\) \|\| pathname === "\/dashboard";/,
        "isDashboardActive must match both /dashboard and event dashboard"
      );
    });
  });

  // ==========================================================================
  // GROUP 3: EVENT SELECTOR OVERFLOW CORRECTION (REQS 17-18)
  // ==========================================================================
  describe("Group 3: Event Selector Responsiveness & Overflow Prevention", () => {
    it("15. EventSelector uses semantic classNames and removes rigid inline styles", () => {
      assert.match(
        eventSelectorContent,
        /className="event-selector-container"/,
        "EventSelector must use .event-selector-container"
      );
      assert.match(
        eventSelectorContent,
        /className="event-selector-select"/,
        "EventSelector select must use .event-selector-select"
      );
    });

    it("16. CSS gives EventSelector min-width: 0 and text-overflow: ellipsis to prevent card blowout", () => {
      assert.match(
        cssContent,
        /\.event-selector-container\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*min-width:\s*0;/,
        ".event-selector-container must have min-width: 0 and max-width: 100%"
      );
      assert.match(
        cssContent,
        /\.event-selector-select\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;[^}]*text-overflow:\s*ellipsis;/,
        ".event-selector-select must truncate with ellipsis and have min-width: 0"
      );
    });

    it("17. Mobile breakpoint collapses EventSelector to vertical column layout", () => {
      assert.match(
        cssContent,
        /@media\s*\(max-width:\s*640px\)\s*\{[\s\S]*\.event-selector-container\s*\{[^}]*flex-direction:\s*column;[^}]*align-items:\s*stretch;/,
        "Mobile breakpoint must stack event selector vertically"
      );
    });

    it("18. Tracker and Dashboard context bars enforce max-width: 100% and min-width: 0", () => {
      assert.match(
        cssContent,
        /\.tracker-context-bar\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*min-width:\s*0;/,
        ".tracker-context-bar must not overflow"
      );
      assert.match(
        cssContent,
        /\.dashboard-context-bar\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*min-width:\s*0;/,
        ".dashboard-context-bar must not overflow"
      );
    });
  });

  // ==========================================================================
  // GROUP 4: SEARCH, FILTERS & PARTICIPANT CARDS (REQS 19-22)
  // ==========================================================================
  describe("Group 4: Tracker Search, Filters & Participant Cards", () => {
    it("19. Tracker search input occupies full container width with box-sizing border-box", () => {
      assert.match(
        cssContent,
        /\.tracker-search-wrap\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/,
        ".tracker-search-wrap must have width: 100% and min-width: 0"
      );
      assert.match(
        cssContent,
        /\.tracker-search-input\s*\{[^}]*width:\s*100%;[^}]*box-sizing:\s*border-box;/,
        ".tracker-search-input must have box-sizing: border-box"
      );
    });

    it("20. Tracker filters use responsive CSS Grid with 2-column mobile breakpoint", () => {
      assert.match(
        cssContent,
        /\.tracker-filters-grid\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(4,\s*1fr\);/,
        ".tracker-filters-grid must be a CSS Grid"
      );
      assert.match(
        cssContent,
        /@media\s*\(max-width:\s*768px\)\s*\{[\s\S]*\.tracker-filters-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*1fr\);/,
        ".tracker-filters-grid must use 2-column grid on mobile <=768px"
      );
      assert.match(
        cssContent,
        /@media\s*\(max-width:\s*360px\)\s*\{[\s\S]*\.tracker-filters-grid\s*\{[^}]*grid-template-columns:\s*1fr;/,
        ".tracker-filters-grid must use single-column grid on narrow mobile <=360px"
      );
    });

    it("21. Participant cards adopt responsive 2-row structure to eliminate badge collision", () => {
      // Row 1: avatar + name & ref + chevron
      assert.match(
        attendanceTableContent,
        /{\/\* Row 1: Avatar \+ Name & Ref \+ Chevron \*\/}\s*<div className="tracker-card-main">/,
        "Card must have Row 1 with avatar and name"
      );
      assert.match(
        attendanceTableContent,
        /<div className="tracker-card-chevron">\s*<ChevronRight/,
        "Row 1 must place chevron at the end"
      );

      // Row 2: status badge + cohort + type + payment
      assert.match(
        attendanceTableContent,
        /{\/\* Row 2: Attendance Status \+ Cohort \+ Type \+ Payment \*\/}\s*<div className="tracker-card-footer">/,
        "Card must place attendance status badge in Row 2"
      );
      assert.match(
        attendanceTableContent,
        /<div className="tracker-card-tags">\s*\{isPresent \? \(\s*<span className="tracker-status-badge tracker-status-present">/,
        "Present/Absent status badge must be rendered in Row 2 tags"
      );
    });

    it("22. Participant card name truncates with ellipsis and status badges wrap naturally", () => {
      assert.match(
        cssContent,
        /\.tracker-card-name\s*\{[^}]*white-space:\s*nowrap;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/,
        "tracker-card-name must truncate with ellipsis"
      );
      assert.match(
        cssContent,
        /\.tracker-card-tags\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*flex-wrap:\s*wrap;/,
        "tracker-card-tags must have flex-wrap: wrap"
      );
      assert.match(
        cssContent,
        /\.tracker-card-chevron\s*\{[^}]*flex-shrink:\s*0;[^}]*margin-left:\s*auto;/,
        "tracker-card-chevron must be flex-shrink: 0 and aligned right"
      );
    });
  });
});
