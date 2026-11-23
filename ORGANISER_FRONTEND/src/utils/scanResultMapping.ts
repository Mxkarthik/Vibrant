/**
 * ============================================================================
 * SCAN RESULT MAPPING AND ATTENDANCE FEEDBACK UTILITIES
 * ============================================================================
 */

import axios from "axios";
import type { MarkAttendanceResponse } from "../api/attendanceService.ts";

export type ScanOutcome = "SUCCESS" | "DUPLICATE" | "REJECTED" | "AMBIGUOUS";

export interface MappedScanResult {
  outcome: ScanOutcome;
  title: string;
  message: string;
  participantName?: string;
  registrationId?: string;
  eventName?: string;
  checkedInAt?: string;
  accessType?: "INDIVIDUAL" | "MULTI_EVENT" | "DIRECT" | string;
  isCombo?: boolean;
  comboProgress?: {
    attendedCount: number;
    totalEligible: number;
    isComplete: boolean;
    displayString: string;
  };
  reasonCode?: string;
  httpStatus?: number;
}

/**
 * Validates whether raw scanned string matches the exact 64-character lowercase hex format.
 */
export function validateQrToken(token: unknown): { isValid: boolean; error?: string } {
  if (typeof token !== "string" || !token.trim()) {
    return { isValid: false, error: "QR code is empty or missing." };
  }
  const cleanToken = token.trim();
  if (cleanToken.length !== 64) {
    return {
      isValid: false,
      error: `Invalid QR code length (${cleanToken.length}/64). Expected exact 64-character token.`,
    };
  }
  if (!/^[a-f0-9]{64}$/.test(cleanToken)) {
    return {
      isValid: false,
      error: "Invalid QR code character format. Expected lowercase hexadecimal token.",
    };
  }
  return { isValid: true };
}

/**
 * Maps a successful HTTP 200 backend response into a structured display result.
 */
export function mapAttendanceSuccess(
  response: MarkAttendanceResponse,
  fallbackEventName?: string
): MappedScanResult {
  const isCombo = response.accessType === "MULTI_EVENT" || Boolean(response.comboProgress);

  let comboProgressFormatted: MappedScanResult["comboProgress"];
  if (response.comboProgress) {
    const { attendedCount, totalEligible, isComplete } = response.comboProgress;
    comboProgressFormatted = {
      attendedCount,
      totalEligible,
      isComplete,
      displayString: `${attendedCount} of ${totalEligible} events attended`,
    };
  }

  return {
    outcome: "SUCCESS",
    title: "Check-in Successful",
    message: response.message || "Attendance recorded successfully.",
    participantName: response.participant?.fullName || "Participant",
    registrationId: response.participant?.registrationId,
    eventName: response.event?.name || fallbackEventName,
    checkedInAt: response.checkedInAt || new Date().toISOString(),
    accessType: response.accessType,
    isCombo,
    comboProgress: comboProgressFormatted,
  };
}

/**
 * Maps backend error codes, HTTP statuses, and network exceptions into clear user feedback.
 */
export function mapAttendanceError(
  error: unknown,
  fallbackEventName?: string
): MappedScanResult {
  // Check for Axios network error / timeout (Ambiguous state)
  if (axios.isAxiosError(error)) {
    const errorMsg = typeof error.message === "string" ? error.message : "";
    const isTimeout =
      error.code === "ECONNABORTED" ||
      errorMsg.toLowerCase().includes("timeout") ||
      (!error.response && Boolean(error.request));

    if (isTimeout && !error.response) {
      return {
        outcome: "AMBIGUOUS",
        title: "Connection Timed Out",
        message:
          "Unable to confirm check-in. The network request timed out. Check attendance status in the dashboard before attempting again.",
        eventName: fallbackEventName,
        reasonCode: "NETWORK_TIMEOUT",
      };
    }

    const status = error.response?.status;
    const data = error.response?.data as any;
    const code = data?.code || "UNKNOWN_ERROR";
    const serverMessage = data?.message;

    // 1. Duplicate check-in detection (HTTP 409 or code ALREADY_CHECKED_IN)
    if (status === 409 || code === "ALREADY_CHECKED_IN") {
      return {
        outcome: "DUPLICATE",
        title: "Already Checked In",
        message:
          serverMessage ||
          "This participant has already checked in for this event.",
        participantName: data?.participant || undefined,
        checkedInAt: data?.checkedInAt || undefined,
        eventName: fallbackEventName,
        reasonCode: "ALREADY_CHECKED_IN",
        httpStatus: status || 409,
      };
    }

    // 2. Specific domain rejection codes
    switch (code) {
      case "EVENT_NOT_ENTITLED":
        return {
          outcome: "REJECTED",
          title: "Ticket Not Entitled",
          message:
            serverMessage ||
            "Ticket is not valid for this event. Participant is not entitled to enter.",
          eventName: fallbackEventName,
          reasonCode: code,
          httpStatus: status,
        };

      case "EVENT_ID_REQUIRED_FOR_COMBO":
        return {
          outcome: "REJECTED",
          title: "Target Event Required",
          message:
            serverMessage ||
            "A specific event destination must be selected to check in combo ticket holders.",
          eventName: fallbackEventName,
          reasonCode: code,
          httpStatus: status,
        };

      case "PAYMENT_PENDING":
        return {
          outcome: "REJECTED",
          title: "Payment Pending",
          message:
            serverMessage ||
            "Registration payment is pending admin verification. Admission cannot be granted.",
          eventName: fallbackEventName,
          reasonCode: code,
          httpStatus: status,
        };

      case "PAYMENT_REJECTED":
        return {
          outcome: "REJECTED",
          title: "Payment Rejected",
          message:
            serverMessage ||
            "Payment for this registration was rejected. Admission is prohibited.",
          eventName: fallbackEventName,
          reasonCode: code,
          httpStatus: status,
        };

      case "PAYMENT_NOT_ELIGIBLE":
        return {
          outcome: "REJECTED",
          title: "Payment Incomplete",
          message:
            serverMessage ||
            "Payment has not been completed or verified for this registration.",
          eventName: fallbackEventName,
          reasonCode: code,
          httpStatus: status,
        };

      case "REGISTRATION_CANCELLED":
        return {
          outcome: "REJECTED",
          title: "Registration Cancelled",
          message:
            serverMessage ||
            "This registration has been cancelled. Ticket is void.",
          eventName: fallbackEventName,
          reasonCode: code,
          httpStatus: status,
        };

      case "TEAM_CANCELLED":
        return {
          outcome: "REJECTED",
          title: "Team Registration Cancelled",
          message:
            serverMessage ||
            "The team associated with this ticket has been cancelled.",
          eventName: fallbackEventName,
          reasonCode: code,
          httpStatus: status,
        };

      case "TEAM_REQUIRED":
        return {
          outcome: "REJECTED",
          title: "Team Details Missing",
          message:
            serverMessage ||
            "Team registration record could not be loaded for verification.",
          eventName: fallbackEventName,
          reasonCode: code,
          httpStatus: status,
        };

      case "PARENT_EVENT_CANCELLED":
        return {
          outcome: "REJECTED",
          title: "Combo Parent Cancelled",
          message:
            serverMessage ||
            "The parent Multi-Event Combo pass for this ticket was cancelled.",
          eventName: fallbackEventName,
          reasonCode: code,
          httpStatus: status,
        };

      case "PARENT_EVENT_INACTIVE":
      case "PARENT_EVENT_UNVERIFIED":
        return {
          outcome: "REJECTED",
          title: "Combo Parent Inactive",
          message:
            serverMessage ||
            "Parent combo event status could not be verified.",
          eventName: fallbackEventName,
          reasonCode: code,
          httpStatus: status,
        };

      case "TARGET_EVENT_CANCELLED":
        return {
          outcome: "REJECTED",
          title: "Event Cancelled",
          message:
            serverMessage ||
            "The selected target event has been cancelled.",
          eventName: fallbackEventName,
          reasonCode: code,
          httpStatus: status,
        };

      case "TARGET_EVENT_INACTIVE":
        return {
          outcome: "REJECTED",
          title: "Event Inactive",
          message:
            serverMessage ||
            "The selected target event is not active for check-in.",
          eventName: fallbackEventName,
          reasonCode: code,
          httpStatus: status,
        };

      case "ORGANISER_NOT_ASSIGNED":
        return {
          outcome: "REJECTED",
          title: "Organiser Not Assigned",
          message:
            serverMessage ||
            "You are not authorized to record attendance for this event.",
          eventName: fallbackEventName,
          reasonCode: code,
          httpStatus: status,
        };

      case "REGISTRATION_NOT_FOUND":
        return {
          outcome: "REJECTED",
          title: "Ticket Not Found",
          message:
            serverMessage ||
            "Invalid QR code. No registration was found matching this ticket.",
          eventName: fallbackEventName,
          reasonCode: code,
          httpStatus: status || 404,
        };

      case "EVENT_NOT_FOUND":
        return {
          outcome: "REJECTED",
          title: "Event Not Found",
          message:
            serverMessage ||
            "Selected event was not found on the server.",
          eventName: fallbackEventName,
          reasonCode: code,
          httpStatus: status || 404,
        };

      case "INVALID_EVENT_ID":
        return {
          outcome: "REJECTED",
          title: "Invalid Event Reference",
          message: serverMessage || "Invalid target event ID provided.",
          eventName: fallbackEventName,
          reasonCode: code,
          httpStatus: status || 400,
        };

      default:
        break;
    }

    // 3. Fallback based on HTTP status
    if (status === 401) {
      return {
        outcome: "REJECTED",
        title: "Session Expired",
        message: "Your login session has expired. Please sign in again.",
        reasonCode: "UNAUTHORIZED",
        httpStatus: 401,
      };
    }
    if (status === 403) {
      return {
        outcome: "REJECTED",
        title: "Access Denied",
        message:
          serverMessage ||
          "You lack administrative or organiser permissions for this event.",
        reasonCode: "FORBIDDEN",
        httpStatus: 403,
      };
    }
    if (status === 404) {
      return {
        outcome: "REJECTED",
        title: "Not Found",
        message: serverMessage || "Registration or ticket token not found.",
        reasonCode: "NOT_FOUND",
        httpStatus: 404,
      };
    }
    if (status === 429) {
      return {
        outcome: "REJECTED",
        title: "Rate Limited",
        message: "Too many scan requests. Please wait a moment before trying again.",
        reasonCode: "RATE_LIMITED",
        httpStatus: 429,
      };
    }
    if (status && status >= 500) {
      return {
        outcome: "REJECTED",
        title: "Server Error",
        message:
          serverMessage ||
          "An internal server error occurred while processing attendance.",
        reasonCode: "SERVER_ERROR",
        httpStatus: status,
      };
    }

    return {
      outcome: "REJECTED",
      title: "Check-in Failed",
      message: serverMessage || error.message || "Failed to mark attendance.",
      eventName: fallbackEventName,
      reasonCode: code,
      httpStatus: status,
    };
  }

  if (error instanceof Error) {
    return {
      outcome: "REJECTED",
      title: "Check-in Error",
      message: error.message,
      eventName: fallbackEventName,
      reasonCode: "CLIENT_ERROR",
    };
  }

  return {
    outcome: "REJECTED",
    title: "Unknown Check-in Error",
    message: "An unexpected error occurred while verifying the ticket.",
    eventName: fallbackEventName,
    reasonCode: "UNKNOWN",
  };
}

/**
 * Triggers audio feedback for scanning events.
 * Gracefully silent if Web Audio API is disabled or unsupported.
 */
export function playScanSound(tone: "SUCCESS" | "REJECTED" | "DUPLICATE"): void {
  try {
    const AudioContextClass =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    if (tone === "SUCCESS") {
      // Pleasant high-pitch double chime
      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880.0, ctx.currentTime + 0.08); // A5
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.25);
    } else {
      // Low-frequency warning buzz
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(180, ctx.currentTime);
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    }
  } catch {
    // Audio feedback is non-essential; silently ignore
  }
}

/**
 * Triggers haptic feedback if supported by device.
 */
export function triggerHapticFeedback(tone: "SUCCESS" | "REJECTED" | "DUPLICATE"): void {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      if (tone === "SUCCESS") {
        navigator.vibrate(60);
      } else {
        navigator.vibrate([100, 60, 100]);
      }
    }
  } catch {
    // Haptics are non-essential; silently ignore
  }
}
