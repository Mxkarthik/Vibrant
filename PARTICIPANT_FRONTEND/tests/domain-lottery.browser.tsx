import React from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import DomainLotteryPanel from "../src/components/domain-lottery/DomainLotteryPanel";

declare global {
  interface Window {
    __domainLotteryChecks: Array<{ name: string; passed: boolean; detail?: string }>;
    __domainLotteryScenario: "leader" | "member" | "individual" | "existing-race" | "uncertain" | "missing-status";
    __domainLotteryExpectedStatement: string;
    __domainLotteryExpectedInstructions: string;
  }
}

let root = ReactDOM.createRoot(document.getElementById("test-root")!);
root.render(<MemoryRouter><DomainLotteryPanel eventId="child-event-1" /></MemoryRouter>);

function check(name: string, passed: boolean, detail?: string) {
  window.__domainLotteryChecks.push({ name, passed, detail });
}

function waitFor(selector: string, timeout = 8000): Promise<Element> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const poll = () => {
      const element = document.querySelector(selector);
      if (element) return resolve(element);
      if (Date.now() - start > timeout) return reject(new Error(`Timed out waiting for ${selector}`));
      window.setTimeout(poll, 25);
    };
    poll();
  });
}

async function runChecks() {
  window.__domainLotteryChecks = [];
  if (window.__domainLotteryScenario === "missing-status") {
    await waitFor(".domain-lottery-error");
    check("Missing backend status route is identified clearly", document.body.textContent?.includes("The challenge service is not available on this server yet.") === true);
    check("Missing status route never enables drawing", !document.querySelector(".domain-lottery-primary"));
    document.querySelector<HTMLButtonElement>(".domain-lottery-secondary")?.click();
    await new Promise(resolve => window.setTimeout(resolve, 120));
    check("Retry keeps a safe unavailable state", document.body.textContent?.includes("The challenge service is not available on this server yet.") === true);
    document.documentElement.dataset.domainLotteryTestsComplete = "true";
    return;
  }
  if (window.__domainLotteryScenario === "member") {
    await waitFor(".domain-lottery-awaiting");
    check("Unassigned team member sees the leader waiting notice", document.body.textContent?.includes("Your team leader will pick a theme for your team.") === true);
    check("Unassigned team member cannot draw", !document.querySelector(".domain-lottery-primary"));
    check("Member view keeps the team notice", document.body.textContent?.includes("Only your team leader can pick the theme for your team.") === true);
    document.documentElement.dataset.domainLotteryTestsComplete = "true";
    return;
  }
  if (window.__domainLotteryScenario === "individual") {
    await waitFor(".domain-lottery-locked");
    check("Individual assignment uses individual wording", document.body.textContent?.includes("A theme has been permanently assigned to your registration.") === true);
    check("Individual locked theme cannot be redrawn", !document.querySelector(".domain-lottery-primary") && document.body.textContent?.includes("This theme is permanently assigned to your registration and cannot be changed.") === true);
    document.documentElement.dataset.domainLotteryTestsComplete = "true";
    return;
  }
  await waitFor(".domain-lottery-awaiting");
  const action = document.querySelector<HTMLButtonElement>(".domain-lottery-primary");
  check("Eligible team leader sees Pick My Theme", Boolean(action?.textContent?.includes("Pick My Theme") && !action.disabled));
  check("Team leader notice is present", document.body.textContent?.includes("Only the team leader can pick the theme for your team.") === true);
  check("Challenge progress is shown", document.querySelectorAll(".domain-lottery-progress li").length === 3);

  action?.click();
  action?.click();
  await waitFor(".domain-lottery-drawing");
  check("Drawing state appears while the server request is pending", document.body.textContent?.includes("Drawing your theme…") === true);
  await waitFor(".domain-lottery-locked", 12000);

  const statement = document.querySelector<HTMLElement>(".domain-lottery-content");
  const prose = statement?.querySelector<HTMLElement>(".domain-lottery-prose");
  const instructionSection = Array.from(document.querySelectorAll(".domain-lottery-content"))
    .find(section => section.querySelector("h3")?.textContent?.includes("Instructions"));
  const instructionText = instructionSection?.querySelector<HTMLElement>(".domain-lottery-prose");
  const renderedInstructions = instructionText?.textContent || "";
  let instructionDifference = 0;
  while (instructionDifference < renderedInstructions.length && instructionDifference < window.__domainLotteryExpectedInstructions.length && renderedInstructions[instructionDifference] === window.__domainLotteryExpectedInstructions[instructionDifference]) instructionDifference += 1;
  check("Confirmed assignment replaces Pick My Theme with Theme Locked", Boolean(document.body.textContent?.includes("Theme Locked") && !document.querySelector(".domain-lottery-primary")));
  check("Problem statement is complete and preserves paragraph breaks", Boolean(prose?.textContent === window.__domainLotteryExpectedStatement && (prose.textContent.match(/\n/g) || []).length >= 2));
  check("Instructions are complete and preserve line breaks", Boolean(renderedInstructions === window.__domainLotteryExpectedInstructions && (renderedInstructions.match(/\n/g) || []).length >= 2), `rendered=${renderedInstructions.length}; expected=${window.__domainLotteryExpectedInstructions.length}; differenceAt=${instructionDifference}`);
  check("Original assignment timestamp is rendered", document.querySelector("time[datetime='2026-11-27T00:00:00.000Z']") !== null);
  const overflow = Array.from(document.querySelectorAll<HTMLElement>(".domain-lottery, .domain-lottery-prose, .domain-lottery-theme-title"))
    .filter(element => element.scrollWidth > element.clientWidth + 1)
    .map(element => `${element.className}: ${element.scrollWidth}/${element.clientWidth}`);
  check("Challenge content has no horizontal overflow", document.documentElement.scrollWidth <= window.innerWidth + 1 && overflow.length === 0, overflow.join(", "));
  check("Document scrolls vertically for the complete theme", document.documentElement.scrollHeight > window.innerHeight);

  root.unmount();
  root = ReactDOM.createRoot(document.getElementById("test-root")!);
  root.render(<MemoryRouter><DomainLotteryPanel eventId="child-event-1" /></MemoryRouter>);
  await waitFor(".domain-lottery-locked", 12000);
  const refreshedText = Array.from(document.querySelectorAll(".domain-lottery-content .domain-lottery-prose"));
  check("Refresh retrieves the same full assignment", refreshedText[0]?.textContent === window.__domainLotteryExpectedStatement && refreshedText[1]?.textContent === window.__domainLotteryExpectedInstructions);
  check("Refresh retains the original timestamp and hides the draw action", document.querySelector("time[datetime='2026-11-27T00:00:00.000Z']") !== null && !document.querySelector(".domain-lottery-primary"));
  document.documentElement.dataset.domainLotteryTestsComplete = "true";
}

runChecks().catch(error => {
  window.__domainLotteryChecks = [{ name: "Browser test harness completes", passed: false, detail: String(error) }];
  document.documentElement.dataset.domainLotteryTestsComplete = "true";
});
