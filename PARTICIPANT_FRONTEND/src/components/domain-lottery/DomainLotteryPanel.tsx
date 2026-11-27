import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import {
  drawParticipantTheme,
  getParticipantDomainStatus,
  getParticipantMyTheme,
  type ParticipantDomainStatus,
  type ParticipantLockedTheme,
} from "../../api/domainLotteryService";
import "./domain-lottery.css";

type PanelState =
  | { kind: "hidden" }
  | { kind: "loading" }
  | { kind: "error"; message: string; signIn?: boolean }
  | { kind: "ready"; status: ParticipantDomainStatus; assignment: ParticipantLockedTheme | null }
  | { kind: "drawing"; status: ParticipantDomainStatus }
  | { kind: "unresolved"; status: ParticipantDomainStatus; message: string };

interface DomainLotteryPanelProps {
  eventId: string;
}

export default function DomainLotteryPanel({ eventId }: DomainLotteryPanelProps) {
  const [panel, setPanel] = useState<PanelState>({ kind: "hidden" });
  const requestSequence = useRef(0);
  const drawInFlight = useRef(false);
  const activeController = useRef<AbortController | null>(null);
  const currentEventId = useRef(eventId);
  currentEventId.current = eventId;

  const refresh = useCallback(async (showLoading = true) => {
    const sequence = ++requestSequence.current;
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    let failedPath = `/api/participant/events/${encodeURIComponent(eventId)}/domains/status`;
    if (showLoading) setPanel({ kind: "loading" });
    try {
      const status = await getParticipantDomainStatus(eventId, controller.signal);
      if (sequence !== requestSequence.current || controller.signal.aborted) return;
      if (status.eventId !== eventId) {
        setPanel({ kind: "error", message: "Challenge status could not be matched to this event." });
        return;
      }
      if (!status.eventEligible || !status.isEligible) {
        setPanel({ kind: "hidden" });
        return;
      }
      failedPath = `/api/participant/events/${encodeURIComponent(eventId)}/domains/my-theme`;
      const assignment = await getParticipantMyTheme(eventId, controller.signal);
      if (sequence !== requestSequence.current || controller.signal.aborted) return;
      if (assignment.eventId !== eventId) {
        setPanel({ kind: "error", message: "Your challenge response could not be matched to this event." });
        return;
      }
      if (assignment.hasAssignment) {
        if (!assignment.isLocked || !assignment.theme || !assignment.assignedAt) {
          setPanel({ kind: "unresolved", status, message: "Your locked theme could not be confirmed. Refresh status to check again." });
          return;
        }
        setPanel({ kind: "ready", status, assignment });
        return;
      }
      if (status.hasAssignment) {
        setPanel({ kind: "unresolved", status, message: "Your locked theme could not be confirmed. Refresh status to check again." });
        return;
      }
      if (!status.domainsEnabled) {
        setPanel({ kind: "hidden" });
        return;
      }
      setPanel({ kind: "ready", status, assignment: null });
    } catch (error) {
      if (controller.signal.aborted || sequence !== requestSequence.current || axios.isCancel(error)) return;
      const responseStatus = axios.isAxiosError(error) ? error.response?.status : undefined;
      const code = getErrorCode(error);
      logRequestFailure(eventId, failedPath, responseStatus, code);
      if (code === "PARTICIPANT_NOT_REGISTERED" || code === "REGISTRATION_NOT_ELIGIBLE" ||
          code === "TEAM_NOT_ELIGIBLE" || code === "PAYMENT_NOT_VERIFIED" || code === "EVENT_NOT_ELIGIBLE") {
        setPanel({ kind: "hidden" });
      } else if (responseStatus === 401 || code === "AUTHENTICATION_REQUIRED") {
        setPanel({ kind: "error", message: "Your session has expired. Sign in to check your challenge.", signIn: true });
      } else if (responseStatus === 404 && code === "EVENT_NOT_FOUND") {
        setPanel({ kind: "error", message: "This event could not be found. Return to My Registrations and open it again." });
      } else if (responseStatus === 404 && !code) {
        setPanel({ kind: "error", message: "The challenge service is not available on this server yet. Please contact event support." });
      } else if (responseStatus === 403) {
        setPanel({ kind: "error", message: "Your account is not authorized to access this challenge." });
      } else if (code === "DOMAIN_ENTRY_AMBIGUOUS") {
        setPanel({ kind: "error", message: "Your event entry needs review before a challenge can be shown. Please contact event support." });
      } else if (code === "DOMAIN_ASSIGNMENT_INTEGRITY_FAILED") {
        setPanel({ kind: "error", message: "Your saved theme could not be verified. Please contact event support." });
      } else if (responseStatus === 409) {
        setPanel({ kind: "error", message: "The challenge state changed. Refresh and try again." });
      } else if (responseStatus === 503) {
        setPanel({ kind: "error", message: "The challenge service is temporarily unavailable. Please try again." });
      } else if (responseStatus && responseStatus >= 500) {
        setPanel({ kind: "error", message: "The challenge service encountered an error. Please try again later." });
      } else if (responseStatus === 404) {
        setPanel({ kind: "error", message: "The requested challenge resource could not be found." });
      } else {
        setPanel({ kind: "error", message: responseStatus
          ? "Unable to load challenge status. Please try again."
          : "Unable to reach the challenge service. Check your connection and try again." });
      }
    } finally {
      if (activeController.current === controller) activeController.current = null;
    }
  }, [eventId]);

  useEffect(() => {
    void refresh(false);
    return () => {
      requestSequence.current += 1;
      activeController.current?.abort();
    };
  }, [refresh]);

  const handleDraw = async () => {
    if (panel.kind !== "ready" || !panel.status.canDraw || drawInFlight.current) return;
    const status = panel.status;
    const eventAtRequest = eventId;
    const sequence = ++requestSequence.current;
    drawInFlight.current = true;
    setPanel({ kind: "drawing", status });
    try {
      const result = await drawParticipantTheme(eventAtRequest);
      if (sequence !== requestSequence.current || eventAtRequest !== currentEventId.current) return;
      if (result.eventId === eventAtRequest && result.hasAssignment && result.isLocked && result.theme && result.assignedAt) {
        setPanel({ kind: "ready", status: { ...status, canDraw: false, hasAssignment: true }, assignment: result });
        return;
      }
      await reconcile(eventAtRequest, sequence, status);
    } catch (error) {
      if (sequence !== requestSequence.current || eventAtRequest !== currentEventId.current) return;
      const detail = getDrawFailureMessage(error);
      await reconcile(eventAtRequest, sequence, status, detail);
    } finally {
      drawInFlight.current = false;
    }
  };

  const reconcile = async (requestedEventId: string, sequence: number, previousStatus: ParticipantDomainStatus, failureMessage?: string) => {
    try {
      const assignment = await getParticipantMyTheme(requestedEventId);
      if (sequence !== requestSequence.current || requestedEventId !== currentEventId.current) return;
      if (assignment.eventId === requestedEventId && assignment.hasAssignment && assignment.isLocked && assignment.theme && assignment.assignedAt) {
        setPanel({ kind: "ready", status: { ...previousStatus, canDraw: false, hasAssignment: true }, assignment });
        return;
      }
      setPanel({
        kind: "unresolved",
        status: previousStatus,
        message: failureMessage || "We could not confirm the draw. Refresh status before trying again.",
      });
    } catch {
      if (sequence !== requestSequence.current || requestedEventId !== currentEventId.current) return;
      setPanel({
        kind: "unresolved",
        status: previousStatus,
        message: failureMessage || "We could not confirm whether a theme was assigned. Refresh status before trying again.",
      });
    }
  };

  if (panel.kind === "hidden") return null;
  if (panel.kind === "loading") return <section className="domain-lottery domain-lottery-loading" aria-label="Checking challenge eligibility"><span className="domain-lottery-spinner" aria-hidden="true" /><span>Checking challenge availability…</span></section>;
  if (panel.kind === "error") return <section className="domain-lottery domain-lottery-error" role="status"><h2>Challenge unavailable</h2><p>{panel.message}</p><div className="domain-lottery-actions">{panel.signIn && <Link className="domain-lottery-secondary" to="/login">Sign in</Link>}<button className="domain-lottery-secondary" type="button" onClick={() => void refresh()}>Try again</button></div></section>;
  if (panel.kind === "drawing") return <DrawingState status={panel.status} />;
  if (panel.kind === "unresolved") return <section className="domain-lottery domain-lottery-error" role="status"><span className="domain-lottery-eyebrow">CHALLENGE STATUS</span><h2>Assignment not confirmed</h2><p>{panel.message}</p><button className="domain-lottery-secondary" type="button" onClick={() => void refresh()}>Refresh status</button></section>;
  if (panel.assignment) return <LockedTheme status={panel.status} assignment={panel.assignment} />;
  return <AwaitingTheme status={panel.status} onDraw={() => void handleDraw()} onRefresh={() => void refresh()} />;
}

function AwaitingTheme({ status, onDraw, onRefresh }: { status: ParticipantDomainStatus; onDraw: () => void; onRefresh: () => void }) {
  const team = status.entryType === "TEAM";
  const waitingForLeader = team && status.reasonCode === "TEAM_LEADER_REQUIRED";
  const lotteryOpen = status.canDraw || waitingForLeader;
  return <section className="domain-lottery domain-lottery-awaiting" aria-labelledby="domain-lottery-title">
    <div className="domain-lottery-icon domain-lottery-shuffle" aria-hidden="true"><ShuffleIcon /></div>
    <span className="domain-lottery-eyebrow">HACKATHON CHALLENGE</span>
    <h2 id="domain-lottery-title">Your Challenge Awaits</h2>
    <p className="domain-lottery-intro">Draw a random problem statement for your hackathon. Once assigned, your theme cannot be changed.</p>
    <div className="domain-lottery-warning"><LockIcon /><span>This will permanently assign one theme to {team ? "your team" : "your registration"}.</span></div>
    {status.canDraw ? <button className="domain-lottery-primary" type="button" onClick={onDraw}><ShuffleIcon />Pick My Theme</button> : <div className="domain-lottery-unavailable" role="status">
      <strong>{waitingForLeader ? "Your team leader will pick a theme for your team." : status.drawStatus === "OPEN" ? "A theme cannot be picked for this entry right now." : "Theme lottery is currently closed."}</strong>
      {!waitingForLeader && <button type="button" className="domain-lottery-text-button" onClick={onRefresh}>Refresh status</button>}
    </div>}
    <ProgressSteps status={status} lotteryOpen={lotteryOpen} />
    {team && <aside className="domain-lottery-team-notice"><InfoIcon /><div><strong>Team notice</strong><p>{waitingForLeader ? "Only your team leader can pick the theme for your team." : "Only the team leader can pick the theme for your team."}</p></div></aside>}
  </section>;
}

function DrawingState({ status }: { status: ParticipantDomainStatus }) {
  const team = status.entryType === "TEAM";
  return <section className="domain-lottery domain-lottery-drawing" aria-live="assertive" aria-busy="true">
    <div className="domain-lottery-icon domain-lottery-drawing-icon" aria-hidden="true"><ShuffleIcon /></div>
    <h2>Drawing your theme…</h2>
    <p>Please wait while we assign a problem statement to {team ? "your team" : "your registration"}.</p>
    <span className="domain-lottery-spinner" aria-hidden="true" />
  </section>;
}

function LockedTheme({ status, assignment }: { status: ParticipantDomainStatus; assignment: ParticipantLockedTheme }) {
  const team = status.entryType === "TEAM";
  const theme = assignment.theme;
  if (!theme || !assignment.assignedAt) return null;
  return <section className="domain-lottery domain-lottery-locked" aria-labelledby="domain-lottery-locked-title">
    <header className="domain-lottery-success"><span className="domain-lottery-check" aria-hidden="true">✓</span><h2 id="domain-lottery-locked-title">Theme Locked</h2><p>A theme has been permanently assigned to {team ? "your team" : "your registration"}.</p></header>
    <div className="domain-lottery-theme-title">{theme.title}</div>
    <ContentSection title="Problem Statement" icon="▤" content={theme.problemStatement} />
    {theme.instructions.trim() ? <ContentSection title="Instructions" icon="☷" content={theme.instructions} /> : null}
    <div className="domain-lottery-assigned"><CalendarIcon /><div><strong>Assigned On</strong><time dateTime={assignment.assignedAt}>{formatAssignedAt(assignment.assignedAt)}</time></div></div>
    <aside className="domain-lottery-team-notice domain-lottery-permanent"><LockIcon /><p>This theme is permanently assigned to {team ? "your team" : "your registration"} and cannot be changed.</p></aside>
  </section>;
}

function ContentSection({ title, icon, content }: { title: string; icon: string; content: string }) {
  return <section className="domain-lottery-content"><h3><span aria-hidden="true">{icon}</span>{title}</h3><div className="domain-lottery-prose">{content}</div></section>;
}

function ProgressSteps({ status, lotteryOpen }: { status: ParticipantDomainStatus; lotteryOpen: boolean }) {
  return <ol className="domain-lottery-progress" aria-label="Challenge progress">
    <li className="is-complete"><span aria-hidden="true">✓</span><div><strong>Registration</strong><small>Your entry is verified</small></div></li>
    <li className={lotteryOpen ? "is-current" : "is-upcoming"}><span aria-hidden="true">○</span><div><strong>Theme Lottery</strong><small>{lotteryOpen ? "Open · Pick your theme" : status.drawStatus === "OPEN" ? "Open · Awaiting team leader" : "Closed"}</small></div></li>
    <li className="is-upcoming"><span aria-hidden="true">○</span><div><strong>Build &amp; Submit</strong><small>After theme assignment</small></div></li>
  </ol>;
}

function getErrorCode(error: unknown): string | undefined {
  const code = axios.isAxiosError<{ code?: unknown }>(error) ? error.response?.data?.code : undefined;
  return typeof code === "string" && /^[A-Z0-9_]{1,80}$/.test(code) ? code : undefined;
}

function logRequestFailure(eventId: string, path: string, status?: number, code?: string) {
  if (!import.meta.env.DEV) return;
  console.warn("[domain-lottery] Participant API request failed", {
    eventId,
    path,
    httpStatus: status ?? null,
    code: code ?? null,
  });
}

function getDrawFailureMessage(error: unknown): string {
  const code = getErrorCode(error);
  if (code === "DOMAIN_LOTTERY_NOT_OPEN") return "Theme lottery is currently closed. Refresh status before trying again.";
  if (code === "DOMAIN_COMMIT_UNKNOWN" || code === "DOMAIN_COORDINATION_UNAVAILABLE") return "The draw could not be confirmed. Refresh status to check for a saved assignment.";
  if (code === "TEAM_LEADER_REQUIRED") return "Only your team leader can pick the theme for your team.";
  if (code === "PAYMENT_NOT_VERIFIED") return "Your registration payment is not yet eligible for this challenge.";
  if (code === "DOMAIN_ASSIGNMENT_INTEGRITY_FAILED") return "The saved theme could not be verified. Please contact event support.";
  return "We could not confirm the draw. Refresh status before trying again.";
}

function formatAssignedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : new Intl.DateTimeFormat(undefined, {
    day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
  }).format(date);
}

function ShuffleIcon() {
  return <svg viewBox="0 0 24 24" fill="none" focusable="false"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function LockIcon() { return <svg viewBox="0 0 24 24" fill="none" focusable="false"><rect x="5" y="10" width="14" height="11" rx="2" stroke="currentColor" strokeWidth="1.8" /><path d="M8 10V7a4 4 0 1 1 8 0v3m-4 4v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>; }
function InfoIcon() { return <svg viewBox="0 0 24 24" fill="none" focusable="false"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" /><path d="M12 11v5m0-8h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>; }
function CalendarIcon() { return <svg viewBox="0 0 24 24" fill="none" focusable="false"><rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" /><path d="M16 3v4M8 3v4M3 10h18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>; }
