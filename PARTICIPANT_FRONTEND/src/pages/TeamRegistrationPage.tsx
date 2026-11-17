import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import axios from "axios";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { getEventDetails, type EventDetails, type EventRegistrationField } from "../api/eventService";
import { createTeamRegistration, type CreatedTeamReceipt, type TeamMemberRegistrationRequest } from "../api/teamService";
import { existingRegistrationPath, getEventRegistrationState, useMyRegistrations } from "../hooks/useMyRegistrations";
import RegistrationPaymentFields, { PaymentProofPreview } from "../components/registration/RegistrationPaymentFields";

type Answer = string | string[];
type TeamMemberForm = TeamMemberRegistrationRequest;
type ParticipantDetails = TeamMemberRegistrationRequest["participantDetails"];
type FormErrors = Record<string, string>;

const requiredMemberFields: Array<{ key: keyof ParticipantDetails; label: string; type?: string; hint?: string }> = [
  { key: "fullName", label: "Full name" },
  { key: "mobileNumber", label: "Mobile number", type: "tel", hint: "10–15 digits, optionally starting with +." },
  { key: "collegeName", label: "College name" },
  { key: "department", label: "Department" },
  { key: "yearOfStudy", label: "Year of study" },
  { key: "section", label: "Section" },
  { key: "rollNumber", label: "Roll number" },
];

const blankMember = (name = ""): TeamMemberForm => ({
  participantDetails: { fullName: name, mobileNumber: "", collegeName: "", department: "", yearOfStudy: "", section: "", rollNumber: "" },
  customResponses: [],
});

export default function TeamRegistrationPage() {
  const { eventId } = useParams();
  const { user } = useAuth();
  const { registrations, loading: registrationsLoading, error: registrationsError, refresh: refreshRegistrations } = useMyRegistrations();
  const [event, setEvent] = useState<EventDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [teamName, setTeamName] = useState("");
  const [members, setMembers] = useState<TeamMemberForm[]>(() => [blankMember(user?.name || "")]);
  const [answers, setAnswers] = useState<Array<Record<string, Answer>>>([{}]);
  const [paymentMethod, setPaymentMethod] = useState<"" | "UPI" | "CASH">("");
  const [cashReceiverName, setCashReceiverName] = useState("");
  const [paymentProof, setPaymentProof] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errors, setErrors] = useState<FormErrors>({});
  const [step, setStep] = useState<"form" | "review">("form");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<CreatedTeamReceipt | null>(null);
  const submitLock = useRef(false);

  useEffect(() => {
    if (user?.name) setMembers((current) => current.map((member, index) => index === 0 && !member.participantDetails.fullName ? { ...member, participantDetails: { ...member.participantDetails, fullName: user.name } } : member));
  }, [user?.name]);

  useEffect(() => {
    const controller = new AbortController();
    setEvent(null);
    setLoadError(null);
    setLoading(true);
    if (!eventId) {
      setLoadError("This event link is invalid.");
      setLoading(false);
      return () => controller.abort();
    }
    getEventDetails(eventId, controller.signal)
      .then(setEvent)
      .catch((error: unknown) => {
        if (axios.isCancel(error)) return;
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        setLoadError(status === 400 ? "This event link is invalid." : status === 404 ? "This event is unavailable." : status === 401 || status === 403 ? "Your participant session may have expired. Sign in again to continue." : "Event details could not be loaded. Please try again.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [eventId]);

  const fields = useMemo(() => [...(event?.registrationFields || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)), [event?.registrationFields]);
  const registration = event?.registration;
  const minTeamSize = registration?.minTeamSize ?? 1;
  const maxTeamSize = registration?.maxTeamSize ?? 0;
  const capacityDataValid = Number.isFinite(registration?.capacity) && Number.isFinite(registration?.registeredParticipants) && (registration?.capacity ?? 0) > 0;
  const remainingCapacity = capacityDataValid ? Math.max(0, (registration?.capacity ?? 0) - (registration?.registeredParticipants ?? 0)) : 0;
  const effectiveMax = Math.min(maxTeamSize, remainingCapacity);

  const setMemberDetail = (index: number, key: keyof ParticipantDetails, value: string) => {
    setMembers((current) => current.map((member, memberIndex) => memberIndex === index ? { ...member, participantDetails: { ...member.participantDetails, [key]: value } } : member));
    setErrors((current) => ({ ...current, [`member:${index}:${key}`]: "" }));
  };

  const setCustomAnswer = (memberIndex: number, field: EventRegistrationField, value: Answer) => {
    setAnswers((current) => current.map((memberAnswers, index) => index === memberIndex ? { ...memberAnswers, [field.fieldKey]: value } : memberAnswers));
    setErrors((current) => ({ ...current, [`custom:${memberIndex}:${field.fieldKey}`]: "" }));
  };

  const addMember = () => {
    if (members.length >= effectiveMax) return;
    setMembers((current) => [...current, blankMember()]);
    setAnswers((current) => [...current, {}]);
    setErrors({});
  };

  const removeMember = (index: number) => {
    if (index === 0) return;
    setMembers((current) => current.filter((_, memberIndex) => memberIndex !== index));
    setAnswers((current) => current.filter((_, memberIndex) => memberIndex !== index));
    setErrors({});
  };

  const validate = () => {
    const nextErrors: FormErrors = {};
    if (!teamName.trim()) nextErrors.teamName = "Team name is required.";
    if (!event || !registration) nextErrors.event = "Event details are unavailable.";
    if (registration && (members.length < (registration.minTeamSize || 1) || members.length > (registration.maxTeamSize || 1))) {
      nextErrors.teamSize = `Team size must be between ${registration.minTeamSize} and ${registration.maxTeamSize} members, including the leader.`;
    }
    if (members.length > remainingCapacity) nextErrors.teamSize = "There are not enough remaining places for this team.";

    const mobileKeys = new Set<string>();
    const rollCollegeKeys = new Set<string>();
    members.forEach((member, memberIndex) => {
      const participant = member.participantDetails;
      requiredMemberFields.forEach(({ key, label }) => {
        if (!participant[key].trim()) nextErrors[`member:${memberIndex}:${key}`] = `${label} is required.`;
      });
      const mobile = participant.mobileNumber.trim();
      if (mobile && !/^\+?[0-9]{10,15}$/.test(mobile)) nextErrors[`member:${memberIndex}:mobileNumber`] = "Enter a valid 10–15 digit mobile number.";
      if (mobile) {
        const mobileKey = mobile.replace(/\D/g, "");
        if (mobileKeys.has(mobileKey)) nextErrors[`member:${memberIndex}:mobileNumber`] = "Each team member must have a distinct mobile number.";
        mobileKeys.add(mobileKey);
      }
      const rollKey = `${participant.collegeName.trim().toLocaleLowerCase()}\u0000${participant.rollNumber.trim().toLocaleLowerCase()}`;
      if (participant.collegeName.trim() && participant.rollNumber.trim()) {
        if (rollCollegeKeys.has(rollKey)) nextErrors[`member:${memberIndex}:rollNumber`] = "This student is already listed on the team.";
        rollCollegeKeys.add(rollKey);
      }

      fields.forEach((field) => {
        const value = answers[memberIndex]?.[field.fieldKey];
        const empty = value === undefined || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && value.length === 0);
        const key = `custom:${memberIndex}:${field.fieldKey}`;
        if (field.required && empty) {
          nextErrors[key] = `${field.label} is required for ${participant.fullName.trim() || `member ${memberIndex + 1}`}.`;
          return;
        }
        if (empty) return;
        if (field.fieldType === "CHECKBOX") {
          if (!Array.isArray(value) || value.some((option) => !field.options.includes(option))) nextErrors[key] = `Choose valid options for ${field.label}.`;
          return;
        }
        if (typeof value !== "string") { nextErrors[key] = `Enter a valid value for ${field.label}.`; return; }
        const trimmed = value.trim();
        if (["DROPDOWN", "RADIO"].includes(field.fieldType) && !field.options.includes(trimmed)) nextErrors[key] = `Choose a valid option for ${field.label}.`;
        else if (field.fieldType === "NUMBER" && !Number.isFinite(Number(trimmed))) nextErrors[key] = `${field.label} must be a valid number.`;
        else if (field.fieldType === "DATE" && Number.isNaN(Date.parse(trimmed))) nextErrors[key] = `${field.label} must be a valid date.`;
        else if (field.fieldType === "URL" && !isHttpUrl(trimmed)) nextErrors[key] = `${field.label} must be a valid HTTP or HTTPS URL.`;
      });
    });

    if (registration && registration.registrationFee > 0 && !paymentMethod) nextErrors.paymentMethod = "Choose a shared payment method.";
    if (registration && registration.registrationFee > 0 && paymentMethod === "UPI") {
      if (!event?.paymentQrUrl) nextErrors.paymentMethod = "UPI is unavailable because this event has no configured payment QR. Choose cash or contact the event administrator.";
      if (!paymentProof) nextErrors.paymentDetails = "Select one screenshot for the shared team payment before continuing.";
    }
    if (registration && registration.registrationFee > 0 && paymentMethod === "CASH" && !cashReceiverName.trim()) nextErrors.paymentDetails = "Enter the name of the person who received the shared cash payment.";
    const requestMembers: TeamMemberRegistrationRequest[] = members.map((member, index) => ({
      participantDetails: Object.fromEntries(Object.entries(member.participantDetails).map(([key, value]) => [key, value.trim()])) as ParticipantDetails,
      customResponses: fields.flatMap((field) => {
        const value = answers[index]?.[field.fieldKey];
        if (value === undefined || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && value.length === 0)) return [];
        return [{ fieldKey: field.fieldKey, value: Array.isArray(value) ? value : field.fieldType === "NUMBER" ? Number(value.trim()) : value.trim() }];
      }),
    }));
    return {
      errors: nextErrors,
      request: Object.keys(nextErrors).length ? null : {
        teamName: teamName.trim(),
        members: requestMembers,
        paymentMethod: registration?.registrationFee === 0 ? "NONE" as const : paymentMethod as "UPI" | "CASH",
        ...(registration?.registrationFee && registration.registrationFee > 0 && paymentMethod === "CASH" ? { cashReceiverName: cashReceiverName.trim() } : {}),
      },
    };
  };

  const continueToReview = (formEvent: FormEvent) => {
    formEvent.preventDefault();
    const result = validate();
    setErrors(result.errors);
    if (!result.request) return;
    setSubmitError(null);
    setStep("review");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const confirmTeam = async () => {
    if (!eventId || !event || submitLock.current || submitting) return;
    const result = validate();
    setErrors(result.errors);
    if (!result.request) { setStep("form"); return; }
    submitLock.current = true;
    setSubmitting(true);
    setUploadProgress(0);
    setSubmitError(null);
    try {
      setReceipt(await createTeamRegistration(eventId, result.request, paymentMethod === "UPI" ? paymentProof || undefined : undefined, setUploadProgress));
    } catch (error: unknown) {
      setSubmitError(getTeamSubmitError(error));
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  };

  if (loading) return <main className="registration-loading"><Link to={`/events/${eventId || ""}`} className="event-detail-back">← Back to Event</Link><div className="event-detail-skeleton"><span /><div><i /><i /><i /></div></div><p>Checking team registration…</p></main>;
  if (loadError || !event || !registration) return <TeamRegistrationUnavailable message={loadError || "Event information is unavailable."} />;
  if (registration.mode !== "TEAM") return <TeamRegistrationUnavailable event={event} message="This event uses individual registration. Continue with the individual registration form instead." individual />;
  const myRegistrationState = getEventRegistrationState(registrations, event._id);
  if (receipt) return <TeamRegistrationSuccess event={event} receipt={receipt} leaderName={user?.name || members[0]?.participantDetails.fullName || "Team leader"} />;
  if (registrationsLoading) return <main className="registration-loading"><Link to={`/events/${event._id}`} className="event-detail-back">← Back to Event</Link><div className="event-detail-skeleton"><span /><div><i /><i /><i /></div></div><p>Checking your existing registration…</p></main>;
  if (registrationsError) return <TeamRegistrationUnavailable event={event} message="Your registration status could not be checked. Try again before starting another team registration." onRetry={refreshRegistrations} />;
  if (myRegistrationState.kind !== "NONE") return <TeamAlreadyRegistered event={event} state={myRegistrationState} />;
  const eligibility = getTeamEligibility(event);
  if (!eligibility.available) return <TeamRegistrationUnavailable event={event} message={eligibility.message} />;

  return <div className="team-registration-page">
    <Link to={`/events/${event._id}`} className="event-detail-back">← Back to Event</Link>
    <header className="individual-registration-heading"><p className="participant-eyebrow">VIBRANT2K26 · TEAM REGISTRATION</p><h1>Build your team for {event.name}</h1><p>You’ll be the team leader. Add every member’s details; this event’s registration fields apply to each member.</p></header>
    <div className="registration-step-indicator"><span className={step === "form" ? "is-current" : "is-complete"}>1 <b>Team details</b></span><i /><span className={step === "review" ? "is-current" : ""}>2 <b>Review &amp; confirm</b></span></div>

    {step === "form" ? <form className="individual-registration-form" noValidate onSubmit={continueToReview}>
      <section className="registration-form-section"><div className="registration-form-section-title"><div><p className="participant-eyebrow">TEAM INFORMATION</p><h2>Team details</h2></div><span className="registration-required-note">{members.length} / {registration.maxTeamSize} members</span></div>
        <label className="registration-input team-name-input"><span>Team name <i>*</i></span><input value={teamName} onChange={(e) => { setTeamName(e.target.value); setErrors((current) => ({ ...current, teamName: "" })); }} aria-invalid={Boolean(errors.teamName)} />{errors.teamName && <small className="registration-field-error" role="alert">{errors.teamName}</small>}</label>
        <p className="registration-prefill-note">Team size includes you as the leader. This event requires {registration.minTeamSize}–{registration.maxTeamSize} members. {remainingCapacity} event places remain.</p>
        {errors.teamSize && <p className="registration-field-error" role="alert">{errors.teamSize}</p>}
      </section>

      {members.map((member, index) => <section className="registration-form-section team-member-section" key={`member-${index}`}>
        <div className="registration-form-section-title"><div><p className="participant-eyebrow">{index === 0 ? "TEAM LEADER" : `TEAM MEMBER ${index + 1}`}</p><h2>{index === 0 ? "You" : `Member ${index + 1}`}</h2></div>{index > 0 && <button className="team-remove-member" type="button" onClick={() => removeMember(index)}>Remove member</button>}</div>
        {index === 0 && <p className="registration-prefill-note">Your account identifies you as the leader. Name is prefilled; account email: <strong>{user?.email || "Unavailable"}</strong> (email is not stored on the team registration).</p>}
        <div className="registration-input-grid">{requiredMemberFields.map(({ key, label, type = "text", hint }) => <label className="registration-input" key={key}>
          <span>{label} <i>*</i></span><input type={type} inputMode={key === "mobileNumber" ? "tel" : undefined} autoComplete={index === 0 && key === "fullName" ? "name" : index === 0 && key === "mobileNumber" ? "tel" : "off"} value={member.participantDetails[key]} onChange={(e) => setMemberDetail(index, key, e.target.value)} aria-invalid={Boolean(errors[`member:${index}:${key}`])} />
          {hint && <small>{hint}</small>}{errors[`member:${index}:${key}`] && <small className="registration-field-error" role="alert">{errors[`member:${index}:${key}`]}</small>}
        </label>)}</div>
        {fields.length > 0 && <div className="team-member-custom-fields"><h3>Event questions for {index === 0 ? "the leader" : `member ${index + 1}`}</h3><div className="registration-custom-fields">{fields.map((field) => <TeamCustomField key={field.fieldId} field={field} inputId={`member-${index}-${field.fieldId}`} value={answers[index]?.[field.fieldKey]} error={errors[`custom:${index}:${field.fieldKey}`]} onChange={(value) => setCustomAnswer(index, field, value)} />)}</div></div>}
      </section>)}

      <div className="team-add-member-row"><p>{members.length < minTeamSize ? `Add ${minTeamSize - members.length} more member${minTeamSize - members.length === 1 ? "" : "s"} to meet the minimum.` : `${members.length} team members added.`}</p><button type="button" className="registration-secondary-button" onClick={addMember} disabled={members.length >= effectiveMax}>+ Add team member</button></div>

      {registration.registrationFee > 0 && <section className="registration-form-section"><div className="registration-form-section-title"><div><p className="participant-eyebrow">SHARED PAYMENT</p><h2>Payment method</h2></div></div><p className="registration-prefill-note">Choose one method for the team. Submit one screenshot or cash receiver name for the shared payment.</p><RegistrationPaymentFields method={paymentMethod} onMethodChange={method => { setPaymentMethod(method); setErrors(current => ({ ...current, paymentMethod: "", paymentDetails: "" })); }} qrUrl={event.paymentQrUrl} amount={registration.registrationFee} screenshot={paymentProof} onScreenshotChange={setPaymentProof} cashReceiverName={cashReceiverName} onCashReceiverNameChange={setCashReceiverName} error={errors.paymentMethod || errors.paymentDetails} onError={message => setErrors(current => ({ ...current, paymentDetails: message }))} shared /></section>}

      <div className="registration-form-actions"><Link to={`/events/${event._id}`} className="registration-text-link">Cancel</Link><button type="submit" className="participant-button">Review team registration <span aria-hidden="true">→</span></button></div>
    </form> : <section className="registration-review-card"><p className="participant-eyebrow">FINAL REVIEW</p><h2>Confirm team registration</h2><p className="registration-review-intro">Confirm the team name, leader, and each member before submitting.</p>{submitError && <div className="registration-submit-error" role="alert"><p>{submitError}</p>{submitError.includes("session has expired") && <Link to="/login">Sign in again</Link>}</div>}
      <div className="registration-review-event"><span>Event</span><strong>{event.name}</strong></div>
      <div className="registration-review-grid"><ReviewItem label="Team name" value={teamName} /><ReviewItem label="Registration type" value="Team" /><ReviewItem label="Team size" value={`${members.length} members`} /><ReviewItem label="Configured fee per registration" value={registration.registrationFee === 0 ? "Free" : formatFee(registration.registrationFee)} />{registration.registrationFee > 0 && <ReviewItem label="Shared payment method" value={paymentMethod === "UPI" ? "UPI" : "Cash"} />}{paymentMethod === "CASH" && <ReviewItem label="Cash received by" value={cashReceiverName} />}</div>
      {paymentMethod === "UPI" && paymentProof && <div className="registration-review-proof"><h3>Shared payment screenshot</h3><PaymentProofPreview file={paymentProof} /></div>}
      <div className="team-review-members"><h3>Team roster</h3>{members.map((member, index) => <article key={`review-${index}`}><span className="team-review-index">{index === 0 ? "L" : index + 1}</span><div><strong>{member.participantDetails.fullName || `Member ${index + 1}`}{index === 0 && <em>Leader</em>}</strong><p>{member.participantDetails.collegeName} · {member.participantDetails.department} · {member.participantDetails.rollNumber}</p></div></article>)}</div>
      {fields.length > 0 && <p className="registration-prefill-note">Event-specific responses for each member will be saved with their individual team registration record.</p>}
      <div className="registration-review-important"><strong>Important</strong><p>Registration closes on {formatDate(registration.deadline)}. {registration.registrationFee > 0 ? "Payment information and one shared proof will be submitted with the team registration. Payment remains pending until administrator verification." : "No payment is required for this event."}</p></div>
      {submitting && paymentMethod === "UPI" && <p className="registration-upload-status" role="status">{uploadProgress < 100 ? `Sending team registration and screenshot: ${uploadProgress}%` : "Screenshot sent. Saving your team registration and shared payment proof…"}</p>}
      <div className="registration-form-actions"><button type="button" className="registration-secondary-button" onClick={() => setStep("form")} disabled={submitting}>Edit team</button><button type="button" className="participant-button" onClick={() => void confirmTeam()} disabled={submitting}>{submitting ? "Submitting team registration…" : "Submit team registration"}</button></div>
    </section>}
  </div>;
}

function TeamCustomField({ field, inputId, value, error, onChange }: { field: EventRegistrationField; inputId: string; value?: Answer; error?: string; onChange: (value: Answer) => void }) {
  const describedBy = error ? `${inputId}-error` : undefined;
  const label = <span>{field.label}{field.required && <i> *</i>}</span>;
  const options = field.options || [];
  return <div className={`registration-custom-field${["RADIO", "CHECKBOX"].includes(field.fieldType) ? " is-choice-field" : ""}`}>
    {field.fieldType === "TEXTAREA" ? <label htmlFor={inputId}>{label}<textarea id={inputId} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} aria-invalid={Boolean(error)} aria-describedby={describedBy} rows={4} /></label>
      : field.fieldType === "DROPDOWN" ? <label htmlFor={inputId}>{label}<select id={inputId} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} aria-invalid={Boolean(error)} aria-describedby={describedBy}><option value="">Select an option</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
        : field.fieldType === "RADIO" ? <fieldset aria-describedby={describedBy}><legend>{label}</legend>{options.map((option) => <label className="registration-choice" key={option}><input type="radio" name={inputId} checked={value === option} onChange={() => onChange(option)} /><span>{option}</span></label>)}</fieldset>
          : field.fieldType === "CHECKBOX" ? <fieldset aria-describedby={describedBy}><legend>{label}</legend>{options.map((option) => { const selected = Array.isArray(value) && value.includes(option); return <label className="registration-choice" key={option}><input type="checkbox" checked={selected} onChange={(e) => onChange(e.target.checked ? [...(Array.isArray(value) ? value : []), option] : Array.isArray(value) ? value.filter((item) => item !== option) : [])} /><span>{option}</span></label>; })}</fieldset>
            : <label htmlFor={inputId}>{label}<input id={inputId} type={field.fieldType === "NUMBER" ? "number" : field.fieldType === "DATE" ? "date" : field.fieldType === "URL" ? "url" : "text"} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} aria-invalid={Boolean(error)} aria-describedby={describedBy} /></label>}
    {error && <small className="registration-field-error" id={`${inputId}-error`} role="alert">{error}</small>}
  </div>;
}

function TeamRegistrationUnavailable({ message, event, individual = false, onRetry }: { message: string; event?: EventDetails; individual?: boolean; onRetry?: () => void }) { return <section className="registration-availability-error"><span className="discover-state-mark">!</span><p className="participant-eyebrow">TEAM REGISTRATION</p><h1>Registration unavailable</h1><p>{message}</p><div>{onRetry && <button type="button" className="registration-secondary-button" onClick={onRetry}>Retry check</button>}{individual && event ? <Link className="participant-button" to={`/events/${event._id}/register`}>Register Individually</Link> : <Link className="participant-button" to={event ? `/events/${event._id}` : "/events"}>{event ? "Back to Event" : "Explore Events"}</Link>}<Link className="event-detail-secondary-action" to="/events">Explore more events</Link></div></section>; }

function TeamAlreadyRegistered({ event, state }: { event: EventDetails; state: Exclude<ReturnType<typeof getEventRegistrationState>, { kind: "NONE" }> }) {
  const active = state.kind === "TEAM" || state.kind === "INDIVIDUAL";
  const label = state.kind === "TEAM" ? "Team Registered" : state.kind === "INDIVIDUAL" ? "Already Registered" : state.kind === "CANCELLED" ? "Previous registration" : "Registration status unavailable";
  const message = state.kind === "TEAM" ? "An active team registration for this event is linked to your account." : state.kind === "INDIVIDUAL" ? "An active individual registration already exists for this event." : state.kind === "CANCELLED" ? "A previous registration record exists. The current registration system may prevent creating another record for this event." : "A team registration record exists, but its status could not be confirmed. No new team registration can be started until it is checked.";
  return <section className="registration-availability-error"><span className="discover-state-mark">{active ? "✓" : "!"}</span><p className="participant-eyebrow">TEAM REGISTRATION STATUS</p><h1>{label}</h1><p>{message}</p><div><Link className="participant-button" to={existingRegistrationPath(state)}>{state.kind === "TEAM" && state.registration.isTeamLeader ? "View Team Details" : "View Registration"}</Link><Link className="registration-secondary-button" to={`/events/${event._id}`}>Back to Event</Link></div></section>;
}

function TeamRegistrationSuccess({ event, receipt, leaderName }: { event: EventDetails; receipt: CreatedTeamReceipt; leaderName: string }) { return <section className="registration-success-card"><span className="registration-success-mark" aria-hidden="true">✓</span><p className="participant-eyebrow">VIBRANT2K26 · TEAM REGISTRATION</p><h1>Your team is registered.</h1><p className="registration-success-lede"><strong>{receipt.teamName}</strong> is registered for {event.name}.</p><div className="registration-success-details"><ReviewItem label="Team registration reference" value={receipt.id} /><ReviewItem label="Team leader" value={leaderName} /><ReviewItem label="Member count" value={`${receipt.memberCount} members`} /><ReviewItem label="Registration status" value={formatStatus(receipt.status)} /><ReviewItem label="Shared payment status" value={formatStatus(receipt.paymentStatus)} /></div>{receipt.paymentStatus === "PENDING" && <p className="registration-payment-reminder">Shared payment status: Pending. Submitted information awaits administrator verification.</p>}<div className="registration-form-actions"><Link className="registration-secondary-button" to={`/events/${event._id}`}>Back to Event</Link><Link className="participant-button" to={`/teams/${receipt.id}`}>View Team Details</Link></div></section>; }

function ReviewItem({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value || "—"}</strong></div>; }
function getTeamEligibility(event: EventDetails) {
  if (event.status !== "PUBLISHED") return { available: false, message: "This event is not accepting registrations." };
  if (event.registration.mode !== "TEAM") return { available: false, message: "This event requires individual registration." };
  const { capacity, registeredParticipants, deadline, minTeamSize, maxTeamSize } = event.registration;
  if (!Number.isFinite(capacity) || !Number.isFinite(registeredParticipants) || !Number.isFinite(minTeamSize) || !Number.isFinite(maxTeamSize) || (capacity ?? 0) < 1 || (minTeamSize ?? 0) < 1 || (maxTeamSize ?? 0) < (minTeamSize ?? 0)) return { available: false, message: "Team registration availability cannot be confirmed." };
  const remaining = (capacity ?? 0) - (registeredParticipants ?? 0);
  if (remaining < (minTeamSize ?? 1)) return { available: false, message: remaining <= 0 ? "This event is fully booked." : "There are not enough remaining event places for the minimum team size." };
  const deadlineTime = new Date(deadline).getTime();
  if (!Number.isFinite(deadlineTime)) return { available: false, message: "The team registration deadline could not be confirmed." };
  if (deadlineTime <= Date.now()) return { available: false, message: "The team registration deadline has passed." };
  return { available: true, message: "Team registration is open." };
}
function getTeamSubmitError(error: unknown) { if (!axios.isAxiosError(error)) return "Team registration could not be submitted. Check your connection and try again."; const status = error.response?.status; const message = typeof error.response?.data?.message === "string" ? error.response.data.message : ""; if (status === 401) return "Your session has expired. Sign in again before registering."; if (status === 403) return "This account is not authorized to create teams from this portal."; if (status === 404) return "This event is no longer available."; if (status === 409) return message || "A member, team name, or event place is no longer available. Review the team and try again."; if (status === 400 && message) return message; if (status === 413) return "The payment screenshot must be 5 MB or smaller. Edit team and choose a smaller image."; if (status === 502 && message) return message; return "Team registration could not be submitted right now. Please try again."; }
function isHttpUrl(value: string) { try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:"; } catch { return false; } }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "unavailable" : new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" }).format(date); }
function formatFee(value: number) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value); }
function formatStatus(value: string) { return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()); }
