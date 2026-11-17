import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import RegistrationPaymentFields, { PaymentProofPreview } from "../src/components/registration/RegistrationPaymentFields";
import { createIndividualRegistration, uploadIndividualPaymentProof } from "../src/api/registrationService";
import { createTeamRegistration, uploadTeamPaymentProof } from "../src/api/teamService";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "../src/auth/AuthContext";
import IndividualRegistrationPage from "../src/pages/IndividualRegistrationPage";
import TeamRegistrationPage from "../src/pages/TeamRegistrationPage";
import "../src/styles/participant-app.css";

// Isolated fixtures: these requests go only to the local test server, never MongoDB or Cloudinary.
const pngBytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII="), char => char.charCodeAt(0));
const proof = new File([pngBytes], "payment.png", { type: "image/png" });
const results: Array<{ name: string; passed: boolean; detail?: string }> = [];
const check = (name: string, passed: boolean, detail?: string) => results.push({ name, passed, detail });
const pause = () => new Promise(resolve => setTimeout(resolve, 40));
const container = document.getElementById("test-root")!;
const root = createRoot(container);
let selected: File | null = null;
let lastError = "";
function Fields({ qr = "/qr-a.png", shared = false }: { qr?: string; shared?: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  return <RegistrationPaymentFields method="UPI" onMethodChange={() => {}} qrUrl={qr} amount={100} screenshot={file} onScreenshotChange={value => { selected = value; setFile(value); }} cashReceiverName="" onCashReceiverNameChange={() => {}} onError={value => { lastError = value; }} error={lastError} shared={shared} />;
}
async function render(element: React.ReactNode) {
  await act(async () => { root.render(<React.StrictMode>{element}</React.StrictMode>); });
  await pause();
}
async function choose(file: File, input = container.querySelector<HTMLInputElement>('input[type="file"]')!) {
  const transfer = new DataTransfer(); transfer.items.add(file); input.files = transfer.files;
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  await pause();
}
async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 80; attempt++) { if (predicate()) return; await pause(); }
  throw Error("Registration page did not reach the expected state");
}
async function fullRegistrationFlow(shared: boolean) {
  const route = shared ? "/events/team/register-team" : "/events/individual/register";
  await render(<AuthProvider key={route}><MemoryRouter initialEntries={[route]}><Routes><Route path={shared ? "/events/:eventId/register-team" : "/events/:eventId/register"} element={shared ? <TeamRegistrationPage /> : <IndividualRegistrationPage />} /></Routes></MemoryRouter></AuthProvider>);
  await waitFor(() => Boolean(container.querySelector(".individual-registration-form")));
  const clickButton = async (label: string, clicks = 1) => {
    const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.trim() === label);
    if (!button) throw Error(`Missing button: ${label}`);
    await act(async () => { for (let index = 0; index < clicks; index++) button.click(); });
    await pause();
  };
  const fill = async (input: HTMLInputElement, value: string) => {
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  };
  if (shared) {
    await fill(container.querySelector<HTMLInputElement>(".team-name-input input")!, "Test Team");
    await clickButton("+ Add team member");
  }
  const fields = [...container.querySelectorAll<HTMLInputElement>(".registration-input-grid input")];
  for (const [index, input] of fields.entries()) {
    const member = Math.floor(index / 7) + 1;
    await fill(input, [`Test Member ${member}`, `999999999${member}`, "Test College", "Test", "2", "A", `TEST${member}`][index % 7]);
  }
  await act(async () => { container.querySelector<HTMLInputElement>('input[type="radio"]')!.click(); });
  const review = async () => { await act(async () => { container.querySelector<HTMLFormElement>("form")!.requestSubmit(); }); await pause(); };
  await review();
  check(`${shared ? "Team" : "Individual"}: missing screenshot blocks review`, container.textContent!.includes(shared ? "Select one screenshot" : "Select a payment screenshot"));
  const openedInput = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  // Closing a native file picker returns focus before its change event is delivered.
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  await pause();
  check(`${shared ? "Team" : "Individual"}: file input survives picker focus refresh`, openedInput.isConnected);
  await choose(proof, openedInput);
  await new Promise(resolve => setTimeout(resolve, 250));
  check(`${shared ? "Team" : "Individual"}: selection reaches parent validation after focus`, Boolean(container.querySelector(".registration-payment-proof-preview")) && container.textContent!.includes("payment.png"));
  if (!container.querySelector(".registration-payment-proof-preview")) return;
  await review();
  check(`${shared ? "Team" : "Individual"}: review shows filename and preview`, Boolean(container.querySelector(".registration-review-proof img")) && container.querySelector(".registration-review-proof")!.textContent!.includes("payment.png"));
  await clickButton(shared ? "Edit team" : "Edit details");
  check(`${shared ? "Team" : "Individual"}: file remains on returning to edit`, container.textContent!.includes("payment.png") && Boolean(container.querySelector(".registration-payment-proof-preview")));
  check("Native file input restores filename after editing", container.querySelector<HTMLInputElement>('input[type="file"]')?.files?.[0]?.name === "payment.png");
  await fill(container.querySelector<HTMLInputElement>(".registration-input-grid input")!, "Updated Test Member");
  check("Editing registration details preserves screenshot", Boolean(container.querySelector(".registration-payment-proof-preview")));
  const radios = () => container.querySelectorAll<HTMLInputElement>('input[type="radio"]');
  await act(async () => { radios()[1].click(); });
  check("CASH hides screenshot requirement", !container.querySelector('input[type="file"]'));
  await fill(container.querySelector<HTMLInputElement>(".registration-cash-receiver input")!, "Test Cash Receiver");
  await review();
  check("CASH review uses receiver and no screenshot", container.textContent!.includes("Test Cash Receiver") && !container.querySelector(".registration-review-proof"));
  await clickButton(shared ? "Edit team" : "Edit details");
  await act(async () => { radios()[0].click(); });
  check("UPI screenshot survives method round trip", container.textContent!.includes("payment.png") && Boolean(container.querySelector(".registration-payment-proof-preview")));
  check("Native file input restores filename after method change", container.querySelector<HTMLInputElement>('input[type="file"]')?.files?.[0]?.name === "payment.png");
  await review();
  await clickButton(shared ? "Submit team registration" : "Submit registration", 2);
  await waitFor(() => Boolean(container.querySelector(".registration-success-card")));
  check(`${shared ? "Team" : "Individual"}: real page submission succeeds and stays pending`, container.textContent!.includes("Pending"));
}
async function run() {
  await render(<PaymentProofPreview file={proof} />);
  const image = container.querySelector("img")!;
  check("StrictMode preview remains readable", image.complete && image.naturalWidth > 0, image.src);
  for (const shared of [false, true]) {
    await render(<Fields key={String(shared)} shared={shared} />);
    await choose(proof);
    check(`${shared ? "Team" : "Individual"} File selection preserved`, selected === proof);
    check("File picker retains selected filename", container.querySelector<HTMLInputElement>('input[type="file"]')?.files?.[0]?.name === "payment.png");
    check(`${shared ? "Team" : "Individual"} screenshot preview loads`, (container.querySelector<HTMLImageElement>(".registration-payment-proof-preview")?.naturalWidth || 0) > 0);
    const replacement = new File([pngBytes], "replacement.png", { type: "image/png" });
    await choose(replacement);
    check("Screenshot replacement preserves File and preview", selected === replacement && (container.querySelector<HTMLImageElement>(".registration-payment-proof-preview")?.naturalWidth || 0) > 0);
    await act(async () => { container.querySelector<HTMLButtonElement>(".registration-payment-selected-file button")!.click(); });
    check("Screenshot removal clears selection", selected === null && !container.querySelector(".registration-payment-proof-preview"));
    await choose(proof);
    check("Same screenshot can be reselected after removal", selected === proof);
    await choose(new File(["invalid"], "bad.txt", { type: "text/plain" }));
    check("Invalid image selection rejected", lastError.includes("JPG"));
    check("Invalid replacement preserves valid file", selected === proof && container.querySelector<HTMLInputElement>('input[type="file"]')?.files?.[0]?.name === "payment.png");
    await choose(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }));
    check("Oversized image selection rejected", lastError.includes("5 MB"));
    check("Oversized replacement preserves valid file", selected === proof && container.querySelector<HTMLInputElement>('input[type="file"]')?.files?.[0]?.name === "payment.png");
  }
  for (const qr of ["/qr-a.png", "/qr-b.png"]) {
    await render(<Fields key={qr} qr={qr} />);
    const qrImage = container.querySelector<HTMLImageElement>('img[alt="UPI payment QR configured for this event"]')!;
    check("Correct event QR image is rendered", qrImage.getAttribute("src") === qr);
    const size = qrImage.getBoundingClientRect();
    check("QR is large and contained", size.width >= Math.min(240, innerWidth - 40) && size.width <= 340 && Math.abs(size.width - size.height) < 1 && getComputedStyle(qrImage).objectFit === "contain", `${innerWidth}px viewport: ${size.width} × ${size.height}`);
    check("No page overflow", document.documentElement.scrollWidth <= innerWidth);
  }
  await render(<Fields qr="" />);
  const radios = container.querySelectorAll<HTMLInputElement>('input[type="radio"]');
  check("Missing QR disables UPI and preserves CASH", radios[0].disabled && !radios[1].disabled);
  const details = { fullName: "Test User", mobileNumber: "9999999999", collegeName: "Test College", department: "Test", section: "A", yearOfStudy: "2", rollNumber: "TEST1" };
  const receipt = await createIndividualRegistration("individual", { participantDetails: details, customResponses: [], paymentMethod: "UPI" }, proof);
  check("Individual multipart submission returns pending receipt", receipt.paymentStatus === "PENDING");
  const team = await createTeamRegistration("team", { teamName: "Test Team", members: [{ participantDetails: details, customResponses: [] }], paymentMethod: "UPI" }, proof);
  check("Team multipart submission returns pending receipt", team.paymentStatus === "PENDING");
  await uploadIndividualPaymentProof("individual", proof);
  await uploadTeamPaymentProof("team", proof);
  check("Existing proof upload services accept same file", true);
  await fullRegistrationFlow(false);
  await fullRegistrationFlow(true);
}
run().catch(error => check("Browser test execution", false, String(error))).finally(() => {
  const output = document.createElement("pre"); output.id = "test-results"; output.textContent = JSON.stringify(results); document.body.appendChild(output);
});
