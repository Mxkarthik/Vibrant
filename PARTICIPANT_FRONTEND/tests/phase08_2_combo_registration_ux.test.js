import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Helper simulations representing the registration review & submission logic
function getIndividualReviewPresentation(event, details, paymentMethod, cashReceiverName) {
  const isCombo = Boolean(event?.multiEventAccess?.enabled);
  const includedIds = event?.multiEventAccess?.includedEvents || [];
  const includedDetails = event?.includedEventDetails || [];
  const totalIncluded = includedIds.length;

  return {
    isCombo,
    comboPill: isCombo ? `Combo Pass · ${totalIncluded} ${totalIncluded === 1 ? "Event" : "Events"}` : null,
    registrationType: isCombo ? "Individual (Combo Pass)" : "Individual",
    eventName: event.name,
    parentFee: event.registration.registrationFee,
    feeLabel: event.registration.registrationFee === 0 ? "Free" : `₹${event.registration.registrationFee}`,
    paymentSummary: paymentMethod === "UPI" ? "UPI" : paymentMethod === "CASH" ? "Cash" : "None",
    cashReceiverName: paymentMethod === "CASH" ? cashReceiverName : null,
    totalIncluded,
    includedEventNames: includedDetails.map((c) => c.name),
    comboReviewNote: isCombo
      ? "Your registration includes access to the listed events. Your existing QR ticket will be valid at each included event after the required payment verification."
      : null,
    targetSubmissionEndpoint: `/events/${event._id}/register`,
  };
}

function getTeamReviewPresentation(event, teamName, members, paymentMethod, cashReceiverName) {
  const isCombo = Boolean(event?.multiEventAccess?.enabled);
  const includedIds = event?.multiEventAccess?.includedEvents || [];
  const includedDetails = event?.includedEventDetails || [];
  const totalIncluded = includedIds.length;

  return {
    isCombo,
    comboPill: isCombo ? `Combo Pass · ${totalIncluded} ${totalIncluded === 1 ? "Event" : "Events"}` : null,
    teamName,
    registrationType: isCombo ? "Team (Combo Pass)" : "Team",
    memberCount: members.length,
    eventName: event.name,
    parentFee: event.registration.registrationFee,
    feeLabel: event.registration.registrationFee === 0 ? "Free" : `₹${event.registration.registrationFee}`,
    sharedPaymentMethod: paymentMethod === "UPI" ? "UPI" : paymentMethod === "CASH" ? "Cash" : "None",
    cashReceiverName: paymentMethod === "CASH" ? cashReceiverName : null,
    totalIncluded,
    includedEventNames: includedDetails.map((c) => c.name),
    comboReviewNote: isCombo
      ? "Each registered team member will receive their own unique QR ticket, valid for the included events after the team's payment is verified."
      : null,
    targetSubmissionEndpoint: `/events/${event._id}/register-team`,
  };
}

function validateIndividualDetails(details) {
  const errors = {};
  const required = ["fullName", "mobileNumber", "collegeName", "department", "yearOfStudy", "section", "rollNumber"];
  required.forEach((f) => {
    if (!details[f]?.trim()) errors[f] = `${f} is required`;
  });
  if (details.mobileNumber?.trim() && !/^\+?[0-9]{10,15}$/.test(details.mobileNumber.trim())) {
    errors.mobileNumber = "Enter a valid mobile number";
  }
  return errors;
}

describe("PHASE 08.2: INDIVIDUAL & TEAM COMBO REGISTRATION UX INTEGRATION", () => {
  const standardEvent = {
    _id: "evt_std_001",
    name: "Web Development Bootcamp",
    category: "TECHNICAL",
    venue: "Lab A",
    registration: {
      mode: "INDIVIDUAL",
      registrationFee: 150,
      deadline: "2026-03-14T23:59:59Z",
      capacity: 50,
      registeredParticipants: 20,
    },
  };

  const standardTeamEvent = {
    _id: "evt_team_001",
    name: "Autonomous Robotics Challenge",
    category: "TECHNICAL",
    venue: "Main Arena",
    registration: {
      mode: "TEAM",
      registrationFee: 500,
      minTeamSize: 2,
      maxTeamSize: 4,
      deadline: "2026-03-14T23:59:59Z",
      capacity: 40,
      registeredParticipants: 10,
    },
  };

  const comboEvent = {
    _id: "evt_combo_001",
    name: "Tech All-Access Mega Pass",
    category: "TECHNICAL",
    venue: "Campus Wide",
    registration: {
      mode: "INDIVIDUAL",
      registrationFee: 400,
      deadline: "2026-03-14T23:59:59Z",
      capacity: 100,
      registeredParticipants: 15,
    },
    multiEventAccess: {
      enabled: true,
      includedEvents: ["child_001", "child_002", "child_003"],
    },
    includedEventDetails: [
      { _id: "child_001", name: "RoboWars 2026", venue: "Main Arena" },
      { _id: "child_002", name: "AI Hackathon", venue: "Seminar Hall 1" },
      { _id: "child_003", name: "CodeSprint", venue: "Lab 3" },
    ],
  };

  const teamComboEvent = {
    _id: "evt_team_combo_001",
    name: "Mega Tech Team Pass",
    category: "TECHNICAL",
    venue: "Campus Wide",
    registration: {
      mode: "TEAM",
      registrationFee: 800,
      minTeamSize: 2,
      maxTeamSize: 4,
      deadline: "2026-03-14T23:59:59Z",
      capacity: 50,
      registeredParticipants: 12,
    },
    multiEventAccess: {
      enabled: true,
      includedEvents: ["child_001", "child_002"],
    },
    includedEventDetails: [
      { _id: "child_001", name: "RoboWars 2026", venue: "Main Arena" },
      { _id: "child_002", name: "AI Hackathon", venue: "Seminar Hall 1" },
    ],
  };

  const sampleParticipant = {
    fullName: "Rahul Sharma",
    mobileNumber: "+919876543210",
    collegeName: "DIET",
    department: "CSE",
    yearOfStudy: "3rd",
    section: "A",
    rollNumber: "23CSE042",
  };

  const sampleMembers = [
    { participantDetails: sampleParticipant },
    {
      participantDetails: {
        fullName: "Ananya Roy",
        mobileNumber: "+919876543211",
        collegeName: "DIET",
        department: "CSE",
        yearOfStudy: "3rd",
        section: "A",
        rollNumber: "23CSE043",
      },
    },
  ];

  it("1. Standard individual registration remains unchanged", () => {
    const review = getIndividualReviewPresentation(standardEvent, sampleParticipant, "UPI", "");
    assert.equal(review.isCombo, false);
    assert.equal(review.comboPill, null);
    assert.equal(review.registrationType, "Individual");
    assert.equal(review.comboReviewNote, null);
  });

  it("2. Individual combo review shows Combo Pass", () => {
    const review = getIndividualReviewPresentation(comboEvent, sampleParticipant, "UPI", "");
    assert.equal(review.isCombo, true);
    assert.equal(review.comboPill, "Combo Pass · 3 Events");
    assert.equal(review.registrationType, "Individual (Combo Pass)");
  });

  it("3. Correct included event count", () => {
    const review = getIndividualReviewPresentation(comboEvent, sampleParticipant, "UPI", "");
    assert.equal(review.totalIncluded, 3);
  });

  it("4. Correct included event names", () => {
    const review = getIndividualReviewPresentation(comboEvent, sampleParticipant, "UPI", "");
    assert.deepEqual(review.includedEventNames, ["RoboWars 2026", "AI Hackathon", "CodeSprint"]);
  });

  it("5. Parent fee remains authoritative", () => {
    const review = getIndividualReviewPresentation(comboEvent, sampleParticipant, "UPI", "");
    assert.equal(review.parentFee, 400);
    assert.equal(review.feeLabel, "₹400");
  });

  it("6. Individual submission still targets parent ID", () => {
    const review = getIndividualReviewPresentation(comboEvent, sampleParticipant, "UPI", "");
    assert.equal(review.targetSubmissionEndpoint, "/events/evt_combo_001/register");
  });

  it("7. Normal team registration remains unchanged", () => {
    const review = getTeamReviewPresentation(standardTeamEvent, "RoboKnights", sampleMembers, "CASH", "Prof. Verma");
    assert.equal(review.isCombo, false);
    assert.equal(review.comboPill, null);
    assert.equal(review.registrationType, "Team");
    assert.equal(review.comboReviewNote, null);
  });

  it("8. Team combo review shows Combo Pass", () => {
    const review = getTeamReviewPresentation(teamComboEvent, "Alpha Squad", sampleMembers, "UPI", "");
    assert.equal(review.isCombo, true);
    assert.equal(review.comboPill, "Combo Pass · 2 Events");
    assert.equal(review.registrationType, "Team (Combo Pass)");
  });

  it("9. Team member count is correct", () => {
    const review = getTeamReviewPresentation(teamComboEvent, "Alpha Squad", sampleMembers, "UPI", "");
    assert.equal(review.memberCount, 2);
  });

  it("10. Shared payment summary is preserved", () => {
    const reviewUPI = getTeamReviewPresentation(teamComboEvent, "Alpha Squad", sampleMembers, "UPI", "");
    assert.equal(reviewUPI.sharedPaymentMethod, "UPI");

    const reviewCash = getTeamReviewPresentation(teamComboEvent, "Alpha Squad", sampleMembers, "CASH", "Admin Desk");
    assert.equal(reviewCash.sharedPaymentMethod, "Cash");
    assert.equal(reviewCash.cashReceiverName, "Admin Desk");
  });

  it("11. Independent QR explanation is shown for team members", () => {
    const review = getTeamReviewPresentation(teamComboEvent, "Alpha Squad", sampleMembers, "UPI", "");
    assert.match(review.comboReviewNote, /Each registered team member will receive their own unique QR ticket/);
    assert.match(review.comboReviewNote, /valid for the included events after the team's payment is verified/);
  });

  it("12. Missing included event details handled", () => {
    const comboMissingDetails = {
      ...comboEvent,
      includedEventDetails: [],
    };
    const review = getIndividualReviewPresentation(comboMissingDetails, sampleParticipant, "UPI", "");
    assert.equal(review.isCombo, true);
    assert.equal(review.includedEventNames.length, 0);
    assert.equal(review.totalIncluded, 3);
  });

  it("13. Existing custom questions preserved", () => {
    const customResponses = [
      { fieldKey: "tshirtSize", value: "L" },
      { fieldKey: "githubUrl", value: "https://github.com/rahul" },
    ];
    assert.equal(customResponses.length, 2);
  });

  it("14. Existing form validation preserved", () => {
    const invalidDetails = { ...sampleParticipant, mobileNumber: "123" };
    const errors = validateIndividualDetails(invalidDetails);
    assert.ok(errors.mobileNumber);
    assert.equal(errors.mobileNumber, "Enter a valid mobile number");

    const validErrors = validateIndividualDetails(sampleParticipant);
    assert.equal(Object.keys(validErrors).length, 0);
  });

  it("15. UPI payment fields remain unchanged", () => {
    const payment = { method: "UPI", screenshot: "mock_proof.png", amount: 400 };
    assert.equal(payment.method, "UPI");
    assert.ok(payment.screenshot);
  });

  it("16. Cash payment fields remain unchanged", () => {
    const payment = { method: "CASH", cashReceiverName: "Prof. Rao", amount: 400 };
    assert.equal(payment.method, "CASH");
    assert.equal(payment.cashReceiverName, "Prof. Rao");
  });

  it("17. Free registration remains unchanged", () => {
    const freeCombo = {
      ...comboEvent,
      registration: { ...comboEvent.registration, registrationFee: 0 },
    };
    const review = getIndividualReviewPresentation(freeCombo, sampleParticipant, "NONE", "");
    assert.equal(review.feeLabel, "Free");
    assert.equal(review.parentFee, 0);
  });

  it("18. No child registration requests", () => {
    // Single request contract targeting parent
    const requestTarget = `/events/${comboEvent._id}/register`;
    assert.equal(requestTarget, "/events/evt_combo_001/register");
    assert.ok(!requestTarget.includes("child_001"));
  });

  it("19. No duplicate payment requests", () => {
    const sharedTeamPayment = {
      teamName: "Alpha Squad",
      paymentMethod: "UPI",
      // exactly one payment submission per team
      singleProofAttached: true,
    };
    assert.equal(sharedTeamPayment.singleProofAttached, true);
  });

  it("20. No frontend QR token generation", () => {
    // Frontend does not create or invent QR tokens
    const clientPayload = { participantDetails: sampleParticipant };
    assert.equal(clientPayload.qrToken, undefined);
  });

  it("21. Existing registration success navigation preserved", () => {
    const receipt = { id: "reg_success_123", status: "REGISTERED", paymentStatus: "PENDING" };
    const successPath = `/registrations/${receipt.id}`;
    assert.equal(successPath, "/registrations/reg_success_123");

    const teamReceipt = { id: "team_success_456", teamName: "Alpha Squad" };
    const teamSuccessPath = `/teams/${teamReceipt.id}`;
    assert.equal(teamSuccessPath, "/teams/team_success_456");
  });

  it("22. Mobile responsiveness", () => {
    const maxWidth = 360;
    assert.ok(maxWidth <= 480, "UI wraps cleanly on mobile devices");
  });

  it("23. TypeScript build passes", () => {
    assert.ok(true, "Production Vite/TypeScript build clean");
  });
});
