/**
 * Helper utilities for participant registration validation and toast notifications
 */

export function scrollToFirstInvalid() {
  // Use requestAnimationFrame to ensure React state has rendered the errors and aria-invalid attributes
  requestAnimationFrame(() => {
    const invalidElement = document.querySelector<HTMLElement>(
      'input[aria-invalid="true"], select[aria-invalid="true"], textarea[aria-invalid="true"], [aria-invalid="true"], .registration-field-error'
    );
    if (invalidElement) {
      invalidElement.scrollIntoView({ behavior: "smooth", block: "center" });
      if (
        invalidElement instanceof HTMLInputElement ||
        invalidElement instanceof HTMLSelectElement ||
        invalidElement instanceof HTMLTextAreaElement ||
        invalidElement instanceof HTMLButtonElement
      ) {
        invalidElement.focus({ preventScroll: true });
      } else {
        const inputInside = invalidElement.querySelector<HTMLElement>("input, select, textarea");
        if (inputInside) {
          inputInside.focus({ preventScroll: true });
        }
      }
    }
  });
}

export function getIndividualErrorTitle(key: string): string {
  if (key === "paymentMethod") return "Payment Method Required";
  if (key === "paymentDetails") return "Payment Details Required";
  if (key === "mobileNumber") return "Invalid Mobile Number";
  if (key === "fullName") return "Full Name Required";
  if (key.startsWith("custom:")) return "Required Response Missing";
  return "Required Field Missing";
}

export function getIndividualValidationSummary(errors: Record<string, string>): string {
  const keys = Object.keys(errors);
  if (keys.includes("paymentMethod")) {
    return "Please select a payment method to proceed with registration.";
  }
  if (keys.includes("paymentDetails")) {
    return errors.paymentDetails || "Please provide the required payment details before continuing.";
  }
  if (keys.includes("mobileNumber") && keys.length === 1) {
    return "Please enter a valid 10–15 digit mobile number.";
  }
  if (keys.length === 2) {
    const msgs = Object.values(errors);
    return `${msgs[0]} Also: ${msgs[1]}`;
  }
  return `Please complete all ${keys.length} required fields before proceeding to review.`;
}

export function getTeamErrorTitle(key: string): string {
  if (key === "teamName") return "Team Name Required";
  if (key === "teamSize") return "Team Size Error";
  if (key === "paymentMethod") return "Payment Method Required";
  if (key === "paymentDetails") return "Payment Proof Required";
  if (key.includes("mobileNumber")) return "Invalid Mobile Number";
  if (key.includes("rollNumber")) return "Duplicate Member Error";
  if (key.startsWith("custom:")) return "Required Response Missing";
  if (key.startsWith("member:0:")) return "Team Leader Details Incomplete";
  if (key.startsWith("member:")) return "Team Member Details Incomplete";
  return "Information Required";
}

export function getTeamValidationSummary(errors: Record<string, string>): string {
  const keys = Object.keys(errors);
  if (keys.includes("teamName") && keys.some((k) => k.startsWith("member:"))) {
    return "Please enter a team name and complete all mandatory member details.";
  }
  if (keys.includes("teamSize")) {
    return errors.teamSize;
  }
  if (keys.includes("paymentMethod")) {
    return "Please select a shared payment method for the team.";
  }
  if (keys.includes("paymentDetails")) {
    return errors.paymentDetails || "Please provide the shared payment details for the team.";
  }
  if (keys.some((k) => k.startsWith("member:0:"))) {
    return "Team leader information is incomplete. Please complete all required fields.";
  }
  return `Please resolve ${keys.length} required team fields before continuing to review.`;
}
