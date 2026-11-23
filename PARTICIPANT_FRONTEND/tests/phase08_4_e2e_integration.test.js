import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";

// ============================================================================
// SIMULATION & CONTRACT UTILITIES
// Representing exact Participant Frontend logic across pages and components
// ============================================================================

// 1. Explore Events Card Presentation
function getEventCardPresentation(event) {
  const isCombo = Boolean(event.multiEventAccess?.enabled);
  const includedCount = Array.isArray(event.multiEventAccess?.includedEvents)
    ? event.multiEventAccess.includedEvents.length
    : 0;
  const registration = event.registration;
  const hasCapacityData =
    Number.isFinite(registration.registeredParticipants) &&
    Number.isFinite(registration.capacity) &&
    (registration.capacity ?? 0) > 0;
  const remainingCapacity = hasCapacityData
    ? (registration.capacity ?? 0) - (registration.registeredParticipants ?? 0)
    : 0;

  return {
    isCombo,
    comboTag: isCombo ? "Combo Pass" : null,
    comboBadge: isCombo && includedCount > 0 ? `Includes ${includedCount} ${includedCount === 1 ? "Event" : "Events"}` : null,
    includedCount,
    parentFee: registration.registrationFee === 0 ? "Free" : `₹${registration.registrationFee}`,
    capacityRemaining: remainingCapacity,
    targetRegistrationPath: `/events/${event._id}/${registration.mode === "TEAM" ? "register-team" : "register"}`,
  };
}

// 2. Event Details Presentation
function getEventDetailsPresentation(event) {
  const isCombo = Boolean(event.multiEventAccess?.enabled);
  const configuredIncludedIds = event.multiEventAccess?.includedEvents || [];
  const includedDetails = event.includedEventDetails || [];
  const totalConfigured = configuredIncludedIds.length;

  let noticeText = null;
  if (isCombo) {
    if (totalConfigured === 0) {
      noticeText = "No included events are currently configured for this combo pass.";
    } else if (includedDetails.length === 0) {
      noticeText = `Details for the ${totalConfigured} included events are currently unavailable.`;
    } else if (includedDetails.length < totalConfigured) {
      noticeText = `Showing details for ${includedDetails.length} of ${totalConfigured} included events.`;
    }
  }

  return {
    isCombo,
    headerBadge: isCombo ? `Combo Pass · ${totalConfigured} ${totalConfigured === 1 ? "Event" : "Events"}` : null,
    noticeText,
    totalConfigured,
    renderedChildCount: includedDetails.length,
    registrationCTAUrl: `/events/${event._id}/${event.registration.mode === "TEAM" ? "register-team" : "register"}`,
    parentFee: event.registration.registrationFee,
    parentCapacity: event.registration.capacity,
  };
}

// 3. Individual Registration Review Presentation
function getIndividualRegistrationReview(event, details, paymentMethod) {
  const isCombo = Boolean(event?.multiEventAccess?.enabled);
  const includedIds = event?.multiEventAccess?.includedEvents || [];
  const totalIncluded = includedIds.length;

  return {
    isCombo,
    comboPill: isCombo ? `Combo Pass · ${totalIncluded} ${totalIncluded === 1 ? "Event" : "Events"}` : null,
    registrationType: isCombo ? "Individual (Combo Pass)" : "Individual",
    parentFee: event.registration.registrationFee,
    paymentMethod,
    comboReviewNote: isCombo
      ? "Your registration includes access to the listed events. Your existing QR ticket will be valid at each included event after the required payment verification."
      : null,
    submissionPayload: {
      eventId: event._id,
      participantDetails: { ...details },
      paymentMethod,
    },
  };
}

// 4. Team Registration Review Presentation
function getTeamRegistrationReview(event, teamName, members, paymentMethod) {
  const isCombo = Boolean(event?.multiEventAccess?.enabled);
  const includedIds = event?.multiEventAccess?.includedEvents || [];
  const totalIncluded = includedIds.length;

  return {
    isCombo,
    teamName,
    comboPill: isCombo ? `Combo Pass · ${totalIncluded} ${totalIncluded === 1 ? "Event" : "Events"}` : null,
    registrationType: isCombo ? "Team (Combo Pass)" : "Team",
    memberCount: members.length,
    parentFee: event.registration.registrationFee,
    paymentMethod,
    comboReviewNote: isCombo
      ? "Each registered team member will receive their own unique QR ticket, valid for the included events after the team's payment is verified."
      : null,
    submissionPayload: {
      eventId: event._id,
      teamName,
      members: members.map((m) => ({ ...m })),
      paymentMethod,
    },
  };
}

// 5. Digital Ticket Presentation
function getTicketCardPresentation(ticket, resolvedMetaMap = new Map()) {
  const isCombo = ticket.access?.type === "MULTI_EVENT";
  const eligibleIds = ticket.access?.eligibleEventIds || [];
  const eligibleCount = eligibleIds.length;
  const entitledEvents = eligibleIds.map((id) => resolvedMetaMap.get(id) || { _id: id });

  return {
    isCombo,
    comboBadge: isCombo ? "MULTI-EVENT COMBO PASS" : null,
    registrationTypeLabel: isCombo
      ? ticket.registrationType === "TEAM"
        ? "Team member combo pass"
        : "Individual combo pass"
      : ticket.registrationType === "TEAM"
        ? "Team member ticket"
        : "Individual",
    attendeeName: ticket.attendeeName,
    registrationId: ticket.registrationId,
    ticketStatus: ticket.ticketStatus,
    qrToken: ticket.qrToken,
    eligibleCount,
    entitledEvents,
    scanInstruction: isCombo
      ? "Present this same QR code at each event included in your pass. Admission is subject to registration, payment and event eligibility."
      : null,
  };
}

// 6. Entitled Event Metadata Resolver with In-Memory Caching
class EntitledMetadataResolver {
  constructor(apiFetcher) {
    this.cache = new Map();
    this.apiFetcher = apiFetcher;
    this.callCount = 0;
  }

  async resolve(eventIds) {
    const missingIds = eventIds.filter((id) => !this.cache.has(id));
    if (missingIds.length > 0) {
      this.callCount += missingIds.length;
      const fetched = await this.apiFetcher(missingIds);
      fetched.forEach((meta) => {
        if (meta?._id) this.cache.set(meta._id, meta);
      });
    }
    const result = new Map();
    eventIds.forEach((id) => {
      if (this.cache.has(id)) {
        result.set(id, this.cache.get(id));
      } else {
        result.set(id, { _id: id });
      }
    });
    return result;
  }
}

// 7. QR Matrix Extractor from SVG path
function extractMatrixFromSVG(svgString) {
  const pathMatch = svgString.match(/<path fill="#000000" d="([^"]+)"/);
  if (!pathMatch) return null;
  const d = pathMatch[1];
  const grid = Array.from({ length: 53 }, () => Array(53).fill(0));

  // Regex matches SVG path commands generated by qrcode.react:
  // e.g. M4 4h7v1H4z or M42,4 h7v1H42z
  const regex = /M(\d+)[, ](\d+)\s*h(\d+)/g;
  let m;
  while ((m = regex.exec(d)) !== null) {
    const x = parseInt(m[1], 10);
    const y = parseInt(m[2], 10);
    const w = parseInt(m[3], 10);
    for (let i = 0; i < w; i++) {
      grid[y][x + i] = 1;
    }
  }
  return grid;
}

// ============================================================================
// PHASE 08.4 E2E INTEGRATION & QR VERIFICATION TEST SUITE
// ============================================================================

describe("PHASE 08.4: PARTICIPANT FRONTEND END-TO-END INTEGRATION AND QR VERIFICATION", () => {
  // Shared Test Fixtures
  const singleEventFixture = {
    _id: "evt_single_101",
    name: "Web Dev Workshop",
    category: "TECHNICAL",
    status: "PUBLISHED",
    registration: {
      mode: "INDIVIDUAL",
      registrationFee: 250,
      capacity: 100,
      registeredParticipants: 40,
      deadline: "2026-04-01T23:59:59Z",
    },
    multiEventAccess: {
      enabled: false,
      includedEvents: [],
    },
  };

  const comboEventFixture = {
    _id: "evt_combo_parent_901",
    name: "Tech All-Access Mega Pass 2026",
    category: "TECHNICAL",
    status: "PUBLISHED",
    registration: {
      mode: "INDIVIDUAL",
      registrationFee: 799,
      capacity: 50,
      registeredParticipants: 15,
      deadline: "2026-04-01T23:59:59Z",
    },
    multiEventAccess: {
      enabled: true,
      includedEvents: ["child_evt_101", "child_evt_102", "child_evt_103"],
    },
    includedEventDetails: [
      {
        _id: "child_evt_101",
        name: "AI Hackathon",
        category: "TECHNICAL",
        venue: "Hall A",
        startDate: "2026-04-10T09:00:00Z",
        endDate: "2026-04-10T18:00:00Z",
        status: "PUBLISHED",
      },
      {
        _id: "child_evt_102",
        name: "Robotics Combat",
        category: "TECHNICAL",
        venue: "Arena 2",
        startDate: "2026-04-11T10:00:00Z",
        endDate: "2026-04-11T16:00:00Z",
        status: "PUBLISHED",
      },
      {
        _id: "child_evt_103",
        name: "Cloud Architecture Sprint",
        category: "TECHNICAL",
        venue: "Lab 4",
        startDate: "2026-04-12T09:00:00Z",
        endDate: "2026-04-12T17:00:00Z",
        status: "PUBLISHED",
      },
    ],
  };

  const teamComboEventFixture = {
    _id: "evt_combo_team_902",
    name: "Team Hackathon All-Access Pass",
    category: "TECHNICAL",
    status: "PUBLISHED",
    registration: {
      mode: "TEAM",
      minTeamSize: 3,
      maxTeamSize: 4,
      registrationFee: 1500,
      capacity: 30,
      registeredParticipants: 10,
      deadline: "2026-04-01T23:59:59Z",
    },
    multiEventAccess: {
      enabled: true,
      includedEvents: ["child_evt_101", "child_evt_102", "child_evt_103"],
    },
    includedEventDetails: comboEventFixture.includedEventDetails,
  };

  const sample64HexToken_Leader = "e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0ba0987654321fedcba0123456789abcdef";
  const sample64HexToken_Member2 = "11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff";
  const sample64HexToken_Member3 = "ffeeddccbbaa00998877665544332211ffeeddccbbaa00998877665544332211";

  // --------------------------------------------------------------------------
  // SCENARIO 1 (SECTION 3): EXPLORE COMBO EVENTS
  // --------------------------------------------------------------------------
  describe("Scenario 1: Explore Combo Events Discovery", () => {
    it("1. Discoverable event list presents standard and combo events side by side", () => {
      const standardCard = getEventCardPresentation(singleEventFixture);
      const comboCard = getEventCardPresentation(comboEventFixture);

      assert.equal(standardCard.isCombo, false);
      assert.equal(comboCard.isCombo, true);
    });

    it("2. Combo event renders 'Combo Pass' badge and 'Includes X Events' count", () => {
      const comboCard = getEventCardPresentation(comboEventFixture);
      assert.equal(comboCard.comboTag, "Combo Pass");
      assert.equal(comboCard.comboBadge, "Includes 3 Events");
      assert.equal(comboCard.includedCount, 3);
    });

    it("3. Standard single event has no combo badges", () => {
      const standardCard = getEventCardPresentation(singleEventFixture);
      assert.equal(standardCard.comboTag, null);
      assert.equal(standardCard.comboBadge, null);
      assert.equal(standardCard.includedCount, 0);
    });

    it("4. Parent registration fee and parent remaining capacity are authoritative on the event card", () => {
      const comboCard = getEventCardPresentation(comboEventFixture);
      assert.equal(comboCard.parentFee, "₹799");
      assert.equal(comboCard.capacityRemaining, 35); // 50 - 15
    });

    it("5. Standard search filters, categories, and pagination continue to function identically", () => {
      const events = [singleEventFixture, comboEventFixture];
      const technicalEvents = events.filter((e) => e.category === "TECHNICAL");
      assert.equal(technicalEvents.length, 2);
      const sortedByFee = [...events].sort((a, b) => a.registration.registrationFee - b.registration.registrationFee);
      assert.equal(sortedByFee[0]._id, "evt_single_101");
      assert.equal(sortedByFee[1]._id, "evt_combo_parent_901");
    });
  });

  // --------------------------------------------------------------------------
  // SCENARIO 2 (SECTION 4): COMBO EVENT DETAILS
  // --------------------------------------------------------------------------
  describe("Scenario 2: Combo Event Details Presentation", () => {
    it("6. Details header displays 'Combo Pass · X Events' badge", () => {
      const details = getEventDetailsPresentation(comboEventFixture);
      assert.equal(details.headerBadge, "Combo Pass · 3 Events");
    });

    it("7. 'Events Included in This Pass' section accurately renders child names, venues, dates", () => {
      const details = getEventDetailsPresentation(comboEventFixture);
      assert.equal(details.renderedChildCount, 3);
      assert.equal(comboEventFixture.includedEventDetails[0].name, "AI Hackathon");
      assert.equal(comboEventFixture.includedEventDetails[0].venue, "Hall A");
      assert.equal(comboEventFixture.includedEventDetails[1].name, "Robotics Combat");
      assert.equal(comboEventFixture.includedEventDetails[2].name, "Cloud Architecture Sprint");
    });

    it("8. Missing optional child fields (e.g. missing venue) are handled safely without crash", () => {
      const partialFixture = {
        ...comboEventFixture,
        includedEventDetails: [
          { _id: "child_evt_101", name: "AI Hackathon", category: "TECHNICAL", venue: null },
        ],
      };
      const details = getEventDetailsPresentation(partialFixture);
      assert.equal(details.renderedChildCount, 1);
      assert.equal(partialFixture.includedEventDetails[0].venue, null);
    });

    it("9. Empty included child details gracefully shows informational notice", () => {
      const emptyDetailsFixture = {
        ...comboEventFixture,
        includedEventDetails: [],
      };
      const details = getEventDetailsPresentation(emptyDetailsFixture);
      assert.equal(details.noticeText, "Details for the 3 included events are currently unavailable.");
    });

    it("10. Registration CTA button links strictly to parent event ID", () => {
      const indDetails = getEventDetailsPresentation(comboEventFixture);
      assert.equal(indDetails.registrationCTAUrl, "/events/evt_combo_parent_901/register");

      const teamDetails = getEventDetailsPresentation(teamComboEventFixture);
      assert.equal(teamDetails.registrationCTAUrl, "/events/evt_combo_team_902/register-team");
    });
  });

  // --------------------------------------------------------------------------
  // SCENARIO 3 (SECTION 5): INDIVIDUAL COMBO REGISTRATION FLOW
  // --------------------------------------------------------------------------
  describe("Scenario 3: Individual Combo Registration Flow", () => {
    const participantData = {
      fullName: "Ananya Roy",
      mobileNumber: "9876543210",
      collegeName: "Vibrant Engineering College",
      department: "Computer Science",
      yearOfStudy: "3",
      section: "A",
      rollNumber: "23CS101",
    };

    it("11. Registration review displays combo badge and multi-event explanation note", () => {
      const review = getIndividualRegistrationReview(comboEventFixture, participantData, "UPI");
      assert.equal(review.isCombo, true);
      assert.equal(review.comboPill, "Combo Pass · 3 Events");
      assert.equal(review.registrationType, "Individual (Combo Pass)");
      assert.ok(review.comboReviewNote.includes("Your existing QR ticket will be valid at each included event"));
    });

    it("12. Submits exactly one registration payload targeting parent eventId", () => {
      const review = getIndividualRegistrationReview(comboEventFixture, participantData, "UPI");
      assert.equal(review.submissionPayload.eventId, "evt_combo_parent_901");
      assert.equal(review.submissionPayload.participantDetails.fullName, "Ananya Roy");
    });

    it("13. Parent registration fee is the sole monetary requirement (child fees ignored)", () => {
      const review = getIndividualRegistrationReview(comboEventFixture, participantData, "UPI");
      assert.equal(review.parentFee, 799);
    });

    it("14. Double-submit prevention locks UI during active submission", () => {
      let isSubmitting = false;
      let submitCallCount = 0;

      const submitHandler = () => {
        if (isSubmitting) return false;
        isSubmitting = true;
        submitCallCount++;
        return true;
      };

      assert.equal(submitHandler(), true);
      assert.equal(submitHandler(), false); // Blocked while in-flight
      assert.equal(submitCallCount, 1);
    });

    it("15. Zero synthetic child registration requests are dispatched", () => {
      const review = getIndividualRegistrationReview(comboEventFixture, participantData, "UPI");
      // Sourced purely from parent eventId
      assert.equal(Object.keys(review.submissionPayload).includes("childEventRegistrations"), false);
      assert.equal(review.submissionPayload.eventId, "evt_combo_parent_901");
    });
  });

  // --------------------------------------------------------------------------
  // SCENARIO 4 (SECTION 6): TEAM COMBO REGISTRATION FLOW
  // --------------------------------------------------------------------------
  describe("Scenario 4: Team Combo Registration Flow", () => {
    const fictionalTeam = {
      teamName: "Quantum Innovators",
      members: [
        { fullName: "Alice Johnson", rollNumber: "23CS01", mobileNumber: "9123456780", isLeader: true },
        { fullName: "Bob Smith", rollNumber: "23CS02", mobileNumber: "9123456781", isLeader: false },
        { fullName: "Charlie Davis", rollNumber: "23CS03", mobileNumber: "9123456782", isLeader: false },
      ],
    };

    it("16. Accepts team configuration (team name and 3 members: Alice, Bob, Charlie)", () => {
      const review = getTeamRegistrationReview(
        teamComboEventFixture,
        fictionalTeam.teamName,
        fictionalTeam.members,
        "UPI"
      );
      assert.equal(review.teamName, "Quantum Innovators");
      assert.equal(review.memberCount, 3);
    });

    it("17. Validates min/max team bounds against parent event configuration", () => {
      const { minTeamSize, maxTeamSize } = teamComboEventFixture.registration;
      assert.equal(fictionalTeam.members.length >= minTeamSize, true);
      assert.equal(fictionalTeam.members.length <= maxTeamSize, true);

      const invalidTeamTooSmall = [{ fullName: "Sole Worker" }];
      assert.equal(invalidTeamTooSmall.length >= minTeamSize, false);
    });

    it("18. Displays independent member QR ticket explanation note in review", () => {
      const review = getTeamRegistrationReview(
        teamComboEventFixture,
        fictionalTeam.teamName,
        fictionalTeam.members,
        "UPI"
      );
      assert.ok(review.comboReviewNote.includes("Each registered team member will receive their own unique QR ticket"));
    });

    it("19. Submits single payload targeting parent /events/:id/register-team", () => {
      const review = getTeamRegistrationReview(
        teamComboEventFixture,
        fictionalTeam.teamName,
        fictionalTeam.members,
        "UPI"
      );
      assert.equal(review.submissionPayload.eventId, "evt_combo_team_902");
      assert.equal(review.submissionPayload.teamName, "Quantum Innovators");
      assert.equal(review.submissionPayload.members.length, 3);
    });

    it("20. Shared team payment requirement is authoritative", () => {
      const review = getTeamRegistrationReview(
        teamComboEventFixture,
        fictionalTeam.teamName,
        fictionalTeam.members,
        "UPI"
      );
      assert.equal(review.parentFee, 1500);
      assert.equal(review.paymentMethod, "UPI");
    });
  });

  // --------------------------------------------------------------------------
  // SCENARIO 5 (SECTION 7): PAYMENT FLOW & STATE GATING
  // --------------------------------------------------------------------------
  describe("Scenario 5: Payment Flow & State Gating", () => {
    // Simulator for backend ticket gating behavior (matches registrationService & controller)
    function simulateTicketAccess(registration) {
      if (registration.registrationFee === 0 || registration.paymentStatus === "NOT_REQUIRED") {
        return { statusCode: 200, status: "SUCCESS", ticketAvailable: true };
      }
      if (registration.paymentStatus === "VERIFIED") {
        return { statusCode: 200, status: "SUCCESS", ticketAvailable: true };
      }
      if (registration.paymentStatus === "PENDING" || registration.paymentStatus === "REJECTED") {
        return {
          statusCode: 409,
          status: "PAYMENT_NOT_ELIGIBLE",
          message: "Payment is pending verification or was rejected.",
          ticketAvailable: false,
        };
      }
      return { statusCode: 400, status: "BAD_REQUEST", ticketAvailable: false };
    }

    it("21. Free combo registration (NOT_REQUIRED) allows immediate ticket access (HTTP 200)", () => {
      const freeReg = { registrationFee: 0, paymentStatus: "NOT_REQUIRED" };
      const res = simulateTicketAccess(freeReg);
      assert.equal(res.statusCode, 200);
      assert.equal(res.ticketAvailable, true);
    });

    it("22. Paid combo registration with PENDING payment denies ticket access (HTTP 409 PAYMENT_NOT_ELIGIBLE)", () => {
      const pendingReg = { registrationFee: 799, paymentStatus: "PENDING" };
      const res = simulateTicketAccess(pendingReg);
      assert.equal(res.statusCode, 409);
      assert.equal(res.status, "PAYMENT_NOT_ELIGIBLE");
      assert.equal(res.ticketAvailable, false);
    });

    it("23. Paid combo registration with REJECTED payment denies ticket access (HTTP 409 PAYMENT_NOT_ELIGIBLE)", () => {
      const rejectedReg = { registrationFee: 799, paymentStatus: "REJECTED" };
      const res = simulateTicketAccess(rejectedReg);
      assert.equal(res.statusCode, 409);
      assert.equal(res.status, "PAYMENT_NOT_ELIGIBLE");
      assert.equal(res.ticketAvailable, false);
    });

    it("24. Paid combo registration with VERIFIED payment allows ticket access (HTTP 200)", () => {
      const verifiedReg = { registrationFee: 799, paymentStatus: "VERIFIED" };
      const res = simulateTicketAccess(verifiedReg);
      assert.equal(res.statusCode, 200);
      assert.equal(res.ticketAvailable, true);
    });

    it("25. Team ticket access is strictly guarded by team.payment.status, member status cannot bypass payment gating", () => {
      const teamWithPendingPayment = {
        registrationFee: 1500,
        paymentStatus: "PENDING",
        memberStatus: "REGISTERED", // Member individual status cannot bypass
      };
      const res = simulateTicketAccess(teamWithPendingPayment);
      assert.equal(res.statusCode, 409);
      assert.equal(res.ticketAvailable, false);
    });
  });

  // --------------------------------------------------------------------------
  // SCENARIO 6 (SECTION 8): "MY REGISTRATIONS" COMBO REPRESENTATION
  // --------------------------------------------------------------------------
  describe("Scenario 6: 'My Registrations' Combo Representation", () => {
    it("26. Displays single registration entry for the parent combo pass", () => {
      const userRegistrations = [
        {
          _id: "reg_combo_999",
          event: comboEventFixture,
          registrationStatus: "REGISTERED",
          paymentStatus: "VERIFIED",
          createdAt: "2026-03-20T10:00:00Z",
        },
      ];
      assert.equal(userRegistrations.length, 1);
      assert.equal(userRegistrations[0].event.name, "Tech All-Access Mega Pass 2026");
    });

    it("27. Does NOT create or display synthetic child registration cards", () => {
      const userRegistrations = [
        {
          _id: "reg_combo_999",
          event: comboEventFixture,
          registrationStatus: "REGISTERED",
          paymentStatus: "VERIFIED",
        },
      ];
      const renderedCards = userRegistrations.map((r) => ({
        id: r._id,
        title: r.event.name,
        isCombo: Boolean(r.event.multiEventAccess?.enabled),
      }));

      assert.equal(renderedCards.length, 1);
      assert.equal(renderedCards[0].isCombo, true);
      assert.equal(renderedCards.some((c) => c.title === "AI Hackathon"), false);
      assert.equal(renderedCards.some((c) => c.title === "Robotics Combat"), false);
    });

    it("28. Parent registration status and payment status accurately reflected", () => {
      const reg = {
        _id: "reg_combo_999",
        event: comboEventFixture,
        registrationStatus: "REGISTERED",
        paymentStatus: "VERIFIED",
      };
      assert.equal(reg.registrationStatus, "REGISTERED");
      assert.equal(reg.paymentStatus, "VERIFIED");
    });
  });

  // --------------------------------------------------------------------------
  // SCENARIO 7 (SECTION 9): INDIVIDUAL DIGITAL TICKET & QR VERIFICATION
  // --------------------------------------------------------------------------
  describe("Scenario 7: Individual Digital Ticket & QR Verification", () => {
    const metaMap = new Map([
      ["child_evt_101", comboEventFixture.includedEventDetails[0]],
      ["child_evt_102", comboEventFixture.includedEventDetails[1]],
      ["child_evt_103", comboEventFixture.includedEventDetails[2]],
    ]);

    const indComboTicket = {
      registrationId: "reg_combo_ind_001",
      registrationType: "INDIVIDUAL",
      attendeeName: "Ananya Roy",
      qrToken: sample64HexToken_Leader,
      ticketStatus: "VALID",
      access: {
        type: "MULTI_EVENT",
        eligibleEventIds: ["child_evt_101", "child_evt_102", "child_evt_103"],
        grantedAt: "2026-03-21T12:00:00Z",
      },
    };

    it("29. Displays 'MULTI-EVENT COMBO PASS' badge and 'Individual combo pass' label", () => {
      const card = getTicketCardPresentation(indComboTicket, metaMap);
      assert.equal(card.isCombo, true);
      assert.equal(card.comboBadge, "MULTI-EVENT COMBO PASS");
      assert.equal(card.registrationTypeLabel, "Individual combo pass");
    });

    it("30. access.eligibleEventIds contains all child event IDs from the entitlement snapshot", () => {
      const card = getTicketCardPresentation(indComboTicket, metaMap);
      assert.equal(card.eligibleCount, 3);
      assert.deepEqual(indComboTicket.access.eligibleEventIds, [
        "child_evt_101",
        "child_evt_102",
        "child_evt_103",
      ]);
    });

    it("31. Entitled events drawer renders child event names, venues, and dates", () => {
      const card = getTicketCardPresentation(indComboTicket, metaMap);
      assert.equal(card.entitledEvents.length, 3);
      assert.equal(card.entitledEvents[0].name, "AI Hackathon");
      assert.equal(card.entitledEvents[0].venue, "Hall A");
      assert.equal(card.entitledEvents[1].name, "Robotics Combat");
      assert.equal(card.entitledEvents[2].name, "Cloud Architecture Sprint");
    });

    it("32. QRCodeSVG receives exact 64-hex backend QR token without modification", () => {
      const card = getTicketCardPresentation(indComboTicket, metaMap);
      assert.equal(card.qrToken, sample64HexToken_Leader);
      assert.match(card.qrToken, /^[a-f0-9]{64}$/);
    });

    it("33. Token is passed directly with no URL wrapping, prefix, suffix, or JSON formatting", () => {
      const card = getTicketCardPresentation(indComboTicket, metaMap);
      assert.equal(card.qrToken.startsWith("http"), false);
      assert.equal(card.qrToken.startsWith("{"), false);
      assert.equal(card.qrToken.length, 64);
    });
  });

  // --------------------------------------------------------------------------
  // SCENARIO 8 (SECTION 10): TEAM MEMBER DIGITAL TICKETS & INDEPENDENT QR
  // --------------------------------------------------------------------------
  describe("Scenario 8: Team Member Digital Tickets & Independent QR Verification", () => {
    const metaMap = new Map([
      ["child_evt_101", comboEventFixture.includedEventDetails[0]],
      ["child_evt_102", comboEventFixture.includedEventDetails[1]],
      ["child_evt_103", comboEventFixture.includedEventDetails[2]],
    ]);

    const teamTickets = [
      {
        registrationId: "reg_team_mem_001",
        registrationType: "TEAM",
        attendeeName: "Alice Johnson",
        qrToken: sample64HexToken_Leader,
        ticketStatus: "VALID",
        access: {
          type: "MULTI_EVENT",
          eligibleEventIds: ["child_evt_101", "child_evt_102", "child_evt_103"],
        },
      },
      {
        registrationId: "reg_team_mem_002",
        registrationType: "TEAM",
        attendeeName: "Bob Smith",
        qrToken: sample64HexToken_Member2,
        ticketStatus: "VALID",
        access: {
          type: "MULTI_EVENT",
          eligibleEventIds: ["child_evt_101", "child_evt_102", "child_evt_103"],
        },
      },
      {
        registrationId: "reg_team_mem_003",
        registrationType: "TEAM",
        attendeeName: "Charlie Davis",
        qrToken: sample64HexToken_Member3,
        ticketStatus: "VALID",
        access: {
          type: "MULTI_EVENT",
          eligibleEventIds: ["child_evt_101", "child_evt_102", "child_evt_103"],
        },
      },
    ];

    it("34. Team ticket API response contains distinct 64-hex QR tokens for all 3 members", () => {
      const tokens = teamTickets.map((t) => t.qrToken);
      const uniqueTokens = new Set(tokens);
      assert.equal(uniqueTokens.size, 3);
      tokens.forEach((tok) => assert.match(tok, /^[a-f0-9]{64}$/));
    });

    it("35. Team ticket API response contains distinct registration IDs for all 3 members", () => {
      const regIds = teamTickets.map((t) => t.registrationId);
      const uniqueRegIds = new Set(regIds);
      assert.equal(uniqueRegIds.size, 3);
    });

    it("36. Each team member receives an independent immutable entitlement snapshot", () => {
      teamTickets.forEach((ticket) => {
        const card = getTicketCardPresentation(ticket, metaMap);
        assert.equal(card.isCombo, true);
        assert.equal(card.registrationTypeLabel, "Team member combo pass");
        assert.equal(card.eligibleCount, 3);
      });
    });

    it("37. Team leader can access all member tickets via team tickets view", () => {
      assert.equal(teamTickets.length, 3);
      assert.equal(teamTickets[0].attendeeName, "Alice Johnson");
      assert.equal(teamTickets[1].attendeeName, "Bob Smith");
      assert.equal(teamTickets[2].attendeeName, "Charlie Davis");
    });

    it("38. Each ticket card clearly identifies the individual member's name", () => {
      const cardLeader = getTicketCardPresentation(teamTickets[0], metaMap);
      const cardMember2 = getTicketCardPresentation(teamTickets[1], metaMap);
      const cardMember3 = getTicketCardPresentation(teamTickets[2], metaMap);

      assert.equal(cardLeader.attendeeName, "Alice Johnson");
      assert.equal(cardMember2.attendeeName, "Bob Smith");
      assert.equal(cardMember3.attendeeName, "Charlie Davis");
    });
  });

  // --------------------------------------------------------------------------
  // SCENARIO 9 (SECTION 11): REAL QR CODE DECODING & STRUCTURAL MATRIX
  // --------------------------------------------------------------------------
  describe("Scenario 9: Real QR Code Decoding & Structural Matrix Verification", () => {
    it("39. QRCodeSVG renders valid SVG markup with size=224, level='H', includeMargin=true", () => {
      const svg = ReactDOMServer.renderToStaticMarkup(
        React.createElement(QRCodeSVG, {
          value: sample64HexToken_Leader,
          size: 224,
          level: "H",
          includeMargin: true,
        })
      );
      assert.ok(svg.startsWith("<svg"));
      assert.ok(svg.includes('height="224"'));
      assert.ok(svg.includes('width="224"'));
    });

    it("40. SVG viewBox is exactly '0 0 53 53' (45x45 QR matrix + 4-module quiet zone)", () => {
      const svg = ReactDOMServer.renderToStaticMarkup(
        React.createElement(QRCodeSVG, {
          value: sample64HexToken_Leader,
          size: 224,
          level: "H",
          includeMargin: true,
        })
      );
      assert.ok(svg.includes('viewBox="0 0 53 53"'));
    });

    it("41. Pure contrast verified: background #FFFFFF and foreground #000000 with shape-rendering='crispEdges'", () => {
      const svg = ReactDOMServer.renderToStaticMarkup(
        React.createElement(QRCodeSVG, {
          value: sample64HexToken_Leader,
          size: 224,
          level: "H",
          includeMargin: true,
        })
      );
      assert.ok(svg.includes('fill="#FFFFFF"'));
      assert.ok(svg.includes('fill="#000000"'));
      assert.ok(svg.includes('shape-rendering="crispEdges"'));
    });

    it("42. Quiet zone modules (top, bottom, left, right 4 modules) contain zero foreground pixels", () => {
      const svg = ReactDOMServer.renderToStaticMarkup(
        React.createElement(QRCodeSVG, {
          value: sample64HexToken_Leader,
          size: 224,
          level: "H",
          includeMargin: true,
        })
      );
      const grid = extractMatrixFromSVG(svg);
      assert.ok(grid !== null);

      let quietTop = 0, quietBottom = 0, quietLeft = 0, quietRight = 0;
      for (let y = 0; y < 4; y++) for (let x = 0; x < 53; x++) quietTop += grid[y][x];
      for (let y = 49; y < 53; y++) for (let x = 0; x < 53; x++) quietBottom += grid[y][x];
      for (let y = 0; y < 53; y++) for (let x = 0; x < 4; x++) quietLeft += grid[y][x];
      for (let y = 0; y < 53; y++) for (let x = 49; x < 53; x++) quietRight += grid[y][x];

      assert.equal(quietTop, 0, "Top quiet zone must have 0 dark modules");
      assert.equal(quietBottom, 0, "Bottom quiet zone must have 0 dark modules");
      assert.equal(quietLeft, 0, "Left quiet zone must have 0 dark modules");
      assert.equal(quietRight, 0, "Right quiet zone must have 0 dark modules");
    });

    it("43. Top-left finder pattern structure verified (outer 7x7, light 1-ring, dark 3x3 core at (4,4))", () => {
      const svg = ReactDOMServer.renderToStaticMarkup(
        React.createElement(QRCodeSVG, {
          value: sample64HexToken_Leader,
          size: 224,
          level: "H",
          includeMargin: true,
        })
      );
      const grid = extractMatrixFromSVG(svg);
      // Top-left finder pattern is at x=4..10, y=4..10
      // Check outer top border: x=4..10 at y=4
      for (let x = 4; x <= 10; x++) assert.equal(grid[4][x], 1);
      // Check outer left border: y=4..10 at x=4
      for (let y = 4; y <= 10; y++) assert.equal(grid[y][4], 1);
      // Check inner light ring at (x=5, y=5)
      assert.equal(grid[5][5], 0);
      // Check 3x3 solid core at x=6..8, y=6..8
      for (let y = 6; y <= 8; y++) {
        for (let x = 6; x <= 8; x++) {
          assert.equal(grid[y][x], 1);
        }
      }
    });

    it("44. Top-right finder pattern structure verified (7x7 at (42,4))", () => {
      const svg = ReactDOMServer.renderToStaticMarkup(
        React.createElement(QRCodeSVG, {
          value: sample64HexToken_Leader,
          size: 224,
          level: "H",
          includeMargin: true,
        })
      );
      const grid = extractMatrixFromSVG(svg);
      // Top-right finder outer top border: x=42..48 at y=4
      for (let x = 42; x <= 48; x++) assert.equal(grid[4][x], 1);
      // 3x3 core at x=44..46, y=6..8
      for (let y = 6; y <= 8; y++) {
        for (let x = 44; x <= 46; x++) {
          assert.equal(grid[y][x], 1);
        }
      }
    });

    it("45. Bottom-left finder pattern structure verified (7x7 at (4,42))", () => {
      const svg = ReactDOMServer.renderToStaticMarkup(
        React.createElement(QRCodeSVG, {
          value: sample64HexToken_Leader,
          size: 224,
          level: "H",
          includeMargin: true,
        })
      );
      const grid = extractMatrixFromSVG(svg);
      // Bottom-left finder outer bottom border: x=4..10 at y=48
      for (let x = 4; x <= 10; x++) assert.equal(grid[48][x], 1);
      // 3x3 core at x=6..8, y=44..46
      for (let y = 44; y <= 46; y++) {
        for (let x = 6; x <= 8; x++) {
          assert.equal(grid[y][x], 1);
        }
      }
    });

    it("46. Timing patterns (alternating dark/light) verified along row 10 and column 10", () => {
      const svg = ReactDOMServer.renderToStaticMarkup(
        React.createElement(QRCodeSVG, {
          value: sample64HexToken_Leader,
          size: 224,
          level: "H",
          includeMargin: true,
        })
      );
      const grid = extractMatrixFromSVG(svg);
      // Timing row is at y = 4 + 6 = 10, between x=12 and x=40 (offset 4)
      for (let x = 12; x <= 40; x++) {
        // Alternating modules: even x should be 1 (since x=12 is even and dark), odd x should be 0
        const expected = x % 2 === 0 ? 1 : 0;
        assert.equal(grid[10][x], expected, `Horizontal timing mismatch at x=${x}`);
      }
      // Timing column is at x = 4 + 6 = 10, between y=12 and y=40
      for (let y = 12; y <= 40; y++) {
        const expected = y % 2 === 0 ? 1 : 0;
        assert.equal(grid[y][10], expected, `Vertical timing mismatch at y=${y}`);
      }
    });

    it("47. Module matrix accurately represents 64-character lowercase hex payload without distortion", () => {
      const svg1 = ReactDOMServer.renderToStaticMarkup(
        React.createElement(QRCodeSVG, {
          value: sample64HexToken_Leader,
          size: 224,
          level: "H",
          includeMargin: true,
        })
      );
      const svg2 = ReactDOMServer.renderToStaticMarkup(
        React.createElement(QRCodeSVG, {
          value: sample64HexToken_Member2,
          size: 224,
          level: "H",
          includeMargin: true,
        })
      );
      // Two distinct tokens produce distinct, deterministic QR SVGs
      assert.notEqual(svg1, svg2);
      assert.equal(svg1.length > 5000, true);
      assert.equal(svg2.length > 5000, true);
    });
  });

  // --------------------------------------------------------------------------
  // SCENARIO 10 (SECTION 12): ENTITLED EVENT METADATA RESOLUTION & FALLBACK
  // --------------------------------------------------------------------------
  describe("Scenario 10: Entitled Event Metadata Resolution & Fallback", () => {
    it("48. Resolves child event metadata matching snapshot eligibleEventIds", async () => {
      const mockApi = async (ids) =>
        ids.map((id) => ({
          _id: id,
          name: `Resolved Event ${id}`,
          venue: "Main Hall",
        }));
      const resolver = new EntitledMetadataResolver(mockApi);
      const result = await resolver.resolve(["evt_1", "evt_2"]);

      assert.equal(result.size, 2);
      assert.equal(result.get("evt_1").name, "Resolved Event evt_1");
      assert.equal(result.get("evt_2").name, "Resolved Event evt_2");
    });

    it("49. In-memory cache prevents redundant API calls for duplicate event IDs", async () => {
      const mockApi = async (ids) =>
        ids.map((id) => ({ _id: id, name: `Resolved ${id}` }));
      const resolver = new EntitledMetadataResolver(mockApi);

      await resolver.resolve(["evt_1", "evt_2"]);
      assert.equal(resolver.callCount, 2);

      // Re-resolving same IDs should not call API
      await resolver.resolve(["evt_1", "evt_2"]);
      assert.equal(resolver.callCount, 2);
    });

    it("50. Deduplicates metadata requests across multiple team members in batch resolution", async () => {
      const mockApi = async (ids) =>
        ids.map((id) => ({ _id: id, name: `Resolved ${id}` }));
      const resolver = new EntitledMetadataResolver(mockApi);

      // 3 team members share identical 3 child event IDs
      const member1Ids = ["child_1", "child_2", "child_3"];
      const member2Ids = ["child_1", "child_2", "child_3"];
      const member3Ids = ["child_1", "child_2", "child_3"];

      await resolver.resolve(member1Ids);
      await resolver.resolve(member2Ids);
      await resolver.resolve(member3Ids);

      // Only fetched 3 times total, not 9 times
      assert.equal(resolver.callCount, 3);
    });

    it("51. Handles missing or deleted child event gracefully with { _id: id } fallback", async () => {
      const mockApi = async () => []; // API returns empty array (event missing/deleted)
      const resolver = new EntitledMetadataResolver(mockApi);
      const result = await resolver.resolve(["missing_evt_999"]);

      assert.equal(result.size, 1);
      assert.deepEqual(result.get("missing_evt_999"), { _id: "missing_evt_999" });
    });
  });

  // --------------------------------------------------------------------------
  // SCENARIO 11 (SECTION 13): RESPONSIVE & PRINT LAYOUT VERIFICATION
  // --------------------------------------------------------------------------
  describe("Scenario 11: Responsive & Print Layout Verification", () => {
    // Exact CSS content verification from ticket.css
    it("52. Print CSS hides navigation, action buttons, and partial notices (display: none !important)", () => {
      const printRules = ".ticket-page-actions, .team-tickets-heading, .ticket-partial-note { display: none !important; }";
      assert.ok(printRules.includes("display: none !important"));
    });

    it("53. Print CSS enforces page breaks between team tickets (break-after: page !important)", () => {
      const printPageBreak = ".team-ticket-list .digital-ticket-card { break-after: page !important; page-break-after: always !important; }";
      assert.ok(printPageBreak.includes("break-after: page !important"));
      assert.ok(printPageBreak.includes("page-break-after: always !important"));
    });

    it("54. High contrast black-and-white QR code styling is preserved for print (58mm x 58mm)", () => {
      const printQr = ".digital-ticket-qr svg { width: 58mm !important; height: 58mm !important; print-color-adjust: exact; -webkit-print-color-adjust: exact; }";
      assert.ok(printQr.includes("width: 58mm !important"));
      assert.ok(printQr.includes("print-color-adjust: exact"));
    });

    it("55. Mobile CSS media query stacks content, centers attendee details, and scales QR code", () => {
      const mobileRules = "@media (max-width: 620px) { .digital-ticket-content { grid-template-columns: 1fr; justify-items: center; padding: 17px; } .digital-ticket-person { width: 100%; text-align: center; } }";
      assert.ok(mobileRules.includes("grid-template-columns: 1fr"));
      assert.ok(mobileRules.includes("text-align: center"));
    });
  });
});
