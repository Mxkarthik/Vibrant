import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { getMyRegistrations, type MyRegistration } from "../api/registrationService";
import { REGISTRATIONS_CHANGED } from "../api/registrationStateEvents";

export function useMyRegistrations({ preserveContentOnRefresh = false }: { preserveContentOnRefresh?: boolean } = {}) {
  const [registrations, setRegistrations] = useState<MyRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [revision, setRevision] = useState(0);
  const hasLoaded = useRef(false);

  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    // A focus refresh must not remove a registration form's open file picker.
    // The initial ownership check still blocks the form until it succeeds.
    setLoading(!preserveContentOnRefresh || !hasLoaded.current);
    setError(null);
    getMyRegistrations(controller.signal)
      .then(records => {
        if (controller.signal.aborted) return;
        hasLoaded.current = true;
        setRegistrations(records);
      })
      .catch((requestError: unknown) => {
        if (!axios.isCancel(requestError)) {
          setRegistrations([]);
          setError(requestError);
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision, preserveContentOnRefresh]);

  useEffect(() => {
    const refreshFromMessage = () => refresh();
    const refreshWhenFocused = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener(REGISTRATIONS_CHANGED, refreshFromMessage);
    window.addEventListener("focus", refreshWhenFocused);
    document.addEventListener("visibilitychange", refreshWhenFocused);
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("vibrant-registration-state") : null;
    channel?.addEventListener("message", refreshFromMessage);
    return () => {
      window.removeEventListener(REGISTRATIONS_CHANGED, refreshFromMessage);
      window.removeEventListener("focus", refreshWhenFocused);
      document.removeEventListener("visibilitychange", refreshWhenFocused);
      channel?.removeEventListener("message", refreshFromMessage);
      channel?.close();
    };
  }, [refresh]);

  return { registrations, loading, error, refresh };
}

export type EventRegistrationState =
  | { kind: "NONE" }
  | { kind: "INDIVIDUAL" | "TEAM" | "CANCELLED" | "UNKNOWN_TEAM"; registration: MyRegistration };

export function getEventRegistrationState(registrations: MyRegistration[], eventId: string): EventRegistrationState {
  const records = registrations.filter((registration) => registration.event?.id === eventId);
  const active = records.find((registration) => registration.status === "REGISTERED" && (!registration.isTeam || registration.teamStatus === "REGISTERED"));
  if (active) return { kind: active.isTeam ? "TEAM" : "INDIVIDUAL", registration: active };

  const unknownTeam = records.find((registration) => registration.status === "REGISTERED" && registration.isTeam && registration.teamStatus !== "CANCELLED");
  if (unknownTeam) return { kind: "UNKNOWN_TEAM", registration: unknownTeam };

  const cancelled = records.find((registration) => registration.status === "CANCELLED" || registration.teamStatus === "CANCELLED");
  if (cancelled) return { kind: "CANCELLED", registration: cancelled };
  return { kind: "NONE" };
}

export function existingRegistrationPath(state: EventRegistrationState): string {
  if (state.kind === "NONE") return "/my-registrations";
  const registration = state.registration;
  if (registration.isTeam && registration.isTeamLeader && registration.teamId) return `/teams/${registration.teamId}`;
  return `/registrations/${registration.id}`;
}
