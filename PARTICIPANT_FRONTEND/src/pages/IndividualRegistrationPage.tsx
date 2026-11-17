import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import axios from "axios";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { getEventDetails, type EventDetails, type EventRegistrationField } from "../api/eventService";
import { createIndividualRegistration, type IndividualRegistrationRequest, type RegistrationReceipt } from "../api/registrationService";
import { existingRegistrationPath, getEventRegistrationState, useMyRegistrations } from "../hooks/useMyRegistrations";
import RegistrationPaymentFields, { PaymentProofPreview } from "../components/registration/RegistrationPaymentFields";
import { useToast } from "../components/toast/ToastContext";
import { scrollToFirstInvalid, getIndividualErrorTitle, getIndividualValidationSummary } from "../utils/registrationToastHelper";

type FieldValue = string | string[];
type ParticipantDetails = IndividualRegistrationRequest["participantDetails"];
type ValidationResult = { request: IndividualRegistrationRequest | null; errors: Record<string, string> };

const initialDetails = (name: string): ParticipantDetails => ({
  fullName: name,
  mobileNumber: "",
  collegeName: "",
  department: "",
  yearOfStudy: "",
  section: "",
  rollNumber: "",
});

const detailFields: Array<{ key: keyof ParticipantDetails; label: string; type?: string; hint?: string }> = [
  { key: "fullName", label: "Full name" },
  { key: "mobileNumber", label: "Mobile number", type: "tel", hint: "10–15 digits, optionally starting with +." },
  { key: "collegeName", label: "College name" },
  { key: "department", label: "Department" },
  { key: "yearOfStudy", label: "Year of study" },
  { key: "section", label: "Section" },
  { key: "rollNumber", label: "Roll number" },
];

export default function IndividualRegistrationPage() {
  const { eventId } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const { registrations, loading: registrationsLoading, error: registrationsError, refresh: refreshRegistrations } = useMyRegistrations({ preserveContentOnRefresh: true });
  const [event, setEvent] = useState<EventDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [eventError, setEventError] = useState<string | null>(null);
  const [details, setDetails] = useState<ParticipantDetails>(() => initialDetails(user?.name || ""));
  const [answers, setAnswers] = useState<Record<string, FieldValue>>({});
  const [paymentMethod, setPaymentMethod] = useState<"" | "UPI" | "CASH">("");
  const [cashReceiverName, setCashReceiverName] = useState("");
  const [paymentProof, setPaymentProof] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [step, setStep] = useState<"form" | "review">("form");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<RegistrationReceipt | null>(null);
  const submitLock = useRef(false);

  useEffect(() => {
    if (user?.name) setDetails((current) => ({ ...current, fullName: current.fullName || user.name }));
  }, [user?.name]);

  useEffect(() => {
    const controller = new AbortController();
    setEvent(null);
    setEventError(null);
    setLoading(true);
    if (!eventId) {
      setEventError("This event link is invalid.");
      setLoading(false);
      return () => controller.abort();
    }
    getEventDetails(eventId, controller.signal)
      .then(setEvent)
      .catch((error: unknown) => {
        if (axios.isCancel(error)) return;
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        setEventError(status === 400 ? "This event link is invalid." : status === 404 ? "This event could not be found or is no longer available." : status === 401 || status === 403 ? "Your participant session may have expired. Sign in again to continue." : "Event details could not be loaded. Please try again.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [eventId]);

  const sortedFields = useMemo(() => [...(event?.registrationFields || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)), [event?.registrationFields]);

  const setDetail = (key: keyof ParticipantDetails, value: string) => {
    setDetails((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: "" }));
  };

  const validate = (): ValidationResult => {
    const nextErrors: Record<string, string> = {};
    detailFields.forEach(({ key, label }) => {
      if (!details[key].trim()) nextErrors[key] = `${label} is required.`;
    });
    if (details.mobileNumber.trim() && !/^\+?[0-9]{10,15}$/.test(details.mobileNumber.trim())) {
      nextErrors.mobileNumber = "Enter a valid mobile number (10–15 digits).";
    }

    const customResponses: IndividualRegistrationRequest["customResponses"] = [];
    sortedFields.forEach((field) => {
      const value = answers[field.fieldKey];
      const isEmpty = value === undefined || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && value.length === 0);
      if (field.required && isEmpty) {
        nextErrors[`custom:${field.fieldKey}`] = `${field.label} is required.`;
        return;
      }
      if (isEmpty) return;

      if (field.fieldType === "CHECKBOX") {
        if (!Array.isArray(value) || value.some((option) => !field.options.includes(option))) {
          nextErrors[`custom:${field.fieldKey}`] = `Choose valid options for ${field.label}.`;
        } else customResponses.push({ fieldKey: field.fieldKey, value });
        return;
      }

      if (typeof value !== "string") {
        nextErrors[`custom:${field.fieldKey}`] = `Enter a valid value for ${field.label}.`;
        return;
      }
      const trimmed = value.trim();
      if ((field.fieldType === "DROPDOWN" || field.fieldType === "RADIO") && !field.options.includes(trimmed)) {
        nextErrors[`custom:${field.fieldKey}`] = `Choose a valid option for ${field.label}.`;
      } else if (field.fieldType === "NUMBER" && !Number.isFinite(Number(trimmed))) {
        nextErrors[`custom:${field.fieldKey}`] = `${field.label} must be a valid number.`;
      } else if (field.fieldType === "DATE" && Number.isNaN(Date.parse(trimmed))) {
        nextErrors[`custom:${field.fieldKey}`] = `${field.label} must be a valid date.`;
      } else if (field.fieldType === "URL" && !isHttpUrl(trimmed)) {
        nextErrors[`custom:${field.fieldKey}`] = `${field.label} must be a valid HTTP or HTTPS URL.`;
      } else {
        customResponses.push({ fieldKey: field.fieldKey, value: field.fieldType === "NUMBER" ? Number(trimmed) : trimmed });
      }
    });

    if (event && event.registration.registrationFee > 0 && !paymentMethod) nextErrors.paymentMethod = "Choose a payment method to continue.";
    if (event && event.registration.registrationFee > 0 && paymentMethod === "UPI") {
      if (!event.paymentQrUrl) nextErrors.paymentMethod = "UPI is unavailable because this event has no configured payment QR. Choose cash or contact the event administrator.";
      if (!paymentProof) nextErrors.paymentDetails = "Select a payment screenshot before continuing.";
    }
    if (event && event.registration.registrationFee > 0 && paymentMethod === "CASH" && !cashReceiverName.trim()) nextErrors.paymentDetails = "Enter the name of the person who received the cash.";
    const request = Object.keys(nextErrors).length ? null : {
      participantDetails: Object.fromEntries(Object.entries(details).map(([key, value]) => [key, value.trim()])) as ParticipantDetails,
      customResponses,
      ...(event && event.registration.registrationFee > 0 ? { paymentMethod: paymentMethod as "UPI" | "CASH" } : {}),
      ...(event && event.registration.registrationFee > 0 && paymentMethod === "CASH" ? { cashReceiverName: cashReceiverName.trim() } : {}),
    };
    return { request, errors: nextErrors };
  };

  const continueToReview = (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    const validation = validate();
    setErrors(validation.errors);
    if (!validation.request) {
      const errorEntries = Object.entries(validation.errors);
      if (errorEntries.length === 1) {
        const [key, msg] = errorEntries[0];
        toast.error(msg, getIndividualErrorTitle(key));
      } else {
        toast.error(getIndividualValidationSummary(validation.errors), "Incomplete Registration");
      }
      scrollToFirstInvalid();
      return;
    }
    setSubmitError(null);
    setStep("review");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const confirmRegistration = async () => {
    if (!eventId || !event || submitLock.current || submitting) return;
    const validation = validate();
    setErrors(validation.errors);
    if (!validation.request) {
      setStep("form");
      toast.error("Please correct the errors in your registration details before submitting.", "Validation Error");
      scrollToFirstInvalid();
      return;
    }
    submitLock.current = true;
    setSubmitting(true);
    setUploadProgress(0);
    setSubmitError(null);
    try {
      const res = await createIndividualRegistration(eventId, validation.request, paymentMethod === "UPI" ? paymentProof || undefined : undefined, setUploadProgress);
      setReceipt(res);
      toast.success("Your registration has been submitted successfully!", "Registration Confirmed");
    } catch (requestError) {
      const msg = getSubmissionError(requestError);
      setSubmitError(msg);
      toast.error(msg, "Registration Failed");
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  };

  if (loading) return <main className="registration-loading"><Link to={`/events/${eventId || ""}`} className="event-detail-back">← Back to Event</Link><div className="event-detail-skeleton"><span /><div><i /><i /><i /></div></div><p>Checking event registration…</p></main>;
  if (eventError || !event) return <RegistrationError message={eventError || "Event information is unavailable."} />;
  if (event.registration.mode === "TEAM") return <RegistrationError message="This event requires team registration. Continue through the team registration workflow." event={event} team />;
  const myRegistrationState = getEventRegistrationState(registrations, event._id);
  if (receipt) return <RegistrationSuccess event={event} receipt={receipt} />;
  if (registrationsLoading) return <main className="registration-loading"><Link to={`/events/${event._id}`} className="event-detail-back">← Back to Event</Link><div className="event-detail-skeleton"><span /><div><i /><i /><i /></div></div><p>Checking your existing registration…</p></main>;
  if (registrationsError) return <RegistrationError message="Your registration status could not be checked. Try again before starting another registration." event={event} onRetry={refreshRegistrations} />;
  if (myRegistrationState.kind !== "NONE") return <ExistingRegistration event={event} state={myRegistrationState} />;

  const eligibility = getIndividualEligibility(event);
  if (!eligibility.available) return <RegistrationError message={eligibility.message} event={event} />;

  return <div className="individual-registration-page">
    <Link to={`/events/${event._id}`} className="event-detail-back">← Back to Event</Link>
    <header className="individual-registration-heading"><p className="participant-eyebrow">VIBRANT2K26 · INDIVIDUAL REGISTRATION</p><h1>Register for {event.name}</h1><p>Enter your participant details, then review them before confirming.</p></header>

    <div className="registration-step-indicator"><span className={step === "form" ? "is-current" : "is-complete"}>1 <b>Your details</b></span><i /><span className={step === "review" ? "is-current" : ""}>2 <b>Review &amp; confirm</b></span></div>

    {step === "form" ? <form className="individual-registration-form" noValidate onSubmit={continueToReview}>
      <section className="registration-form-section"><div className="registration-form-section-title"><div><p className="participant-eyebrow">PARTICIPANT INFORMATION</p><h2>Your details</h2></div><span className="registration-required-note">All fields required</span></div>
        <p className="registration-prefill-note">Your name is prefilled from your account. Confirm or edit it before continuing. Account email: <strong>{user?.email || "Unavailable"}</strong> (email is not stored on this registration record).</p>
        <div className="registration-input-grid">{detailFields.map(({ key, label, type = "text", hint }) => <label className="registration-input" key={key}>
          <span>{label} <i>*</i></span><input type={type} inputMode={key === "mobileNumber" ? "tel" : undefined} autoComplete={key === "fullName" ? "name" : key === "mobileNumber" ? "tel" : "off"} value={details[key]} onChange={(e) => setDetail(key, e.target.value)} aria-invalid={Boolean(errors[key])} aria-describedby={errors[key] ? `${key}-error` : hint ? `${key}-hint` : undefined} />
          {hint && <small id={`${key}-hint`}>{hint}</small>}{errors[key] && <small className="registration-field-error" id={`${key}-error`} role="alert">{errors[key]}</small>}
        </label>)}</div>
      </section>

      {sortedFields.length > 0 && <section className="registration-form-section"><div className="registration-form-section-title"><div><p className="participant-eyebrow">EVENT QUESTIONS</p><h2>Registration fields</h2></div></div><div className="registration-custom-fields">{sortedFields.map((field) => <CustomField key={field.fieldId} field={field} value={answers[field.fieldKey]} error={errors[`custom:${field.fieldKey}`]} onChange={(value) => { setAnswers((current) => ({ ...current, [field.fieldKey]: value })); setErrors((current) => ({ ...current, [`custom:${field.fieldKey}`]: "" })); }} />)}</div></section>}

      {event.registration.registrationFee > 0 && <section className="registration-form-section"><div className="registration-form-section-title"><div><p className="participant-eyebrow">PAYMENT DETAILS</p><h2>Payment method</h2></div></div><p className="registration-prefill-note">Choose how you are paying. Payment remains pending until an administrator verifies it.</p>
        <RegistrationPaymentFields method={paymentMethod} onMethodChange={method => { setPaymentMethod(method); setErrors(current => ({ ...current, paymentMethod: "", paymentDetails: "" })); }} qrUrl={event.paymentQrUrl} amount={event.registration.registrationFee} screenshot={paymentProof} onScreenshotChange={setPaymentProof} cashReceiverName={cashReceiverName} onCashReceiverNameChange={setCashReceiverName} error={errors.paymentMethod || errors.paymentDetails} onError={message => setErrors(current => ({ ...current, paymentDetails: message }))} />
      </section>}

      <div className="registration-form-actions"><Link to={`/events/${event._id}`} className="registration-text-link">Cancel</Link><button className="participant-button" type="submit">Review registration <span aria-hidden="true">→</span></button></div>
    </form> : <section className="registration-review-card"><p className="participant-eyebrow">FINAL REVIEW</p><h2>Confirm your registration</h2><p className="registration-review-intro">Check the details below before submitting your registration.</p>
      {submitError && <div className="registration-submit-error" role="alert"><p>{submitError}</p>{isUnauthorizedError(submitError) && <Link to="/login">Sign in again</Link>}</div>}
      <div className="registration-review-event"><span>Event</span><strong>{event.name}</strong></div>
      <div className="registration-review-grid"><ReviewItem label="Registration type" value="Individual" /><ReviewItem label="Participant" value={details.fullName} /><ReviewItem label="Email" value={user?.email || "Unavailable"} /><ReviewItem label="Mobile number" value={details.mobileNumber} /><ReviewItem label="College" value={details.collegeName} /><ReviewItem label="Department" value={details.department} /><ReviewItem label="Year / section" value={`${details.yearOfStudy} · ${details.section}`} /><ReviewItem label="Roll number" value={details.rollNumber} /><ReviewItem label="Registration fee" value={event.registration.registrationFee === 0 ? "Free" : formatFee(event.registration.registrationFee)} />{event.registration.registrationFee > 0 && <ReviewItem label="Selected payment method" value={paymentMethod === "UPI" ? "UPI" : "Cash"} />}{paymentMethod === "CASH" && <ReviewItem label="Cash received by" value={cashReceiverName} />}</div>
      {paymentMethod === "UPI" && paymentProof && <div className="registration-review-proof"><h3>Payment screenshot</h3><p>{paymentProof.name}</p><PaymentProofPreview file={paymentProof} /></div>}
      {sortedFields.length > 0 && <div className="registration-review-custom"><h3>Event responses</h3>{sortedFields.map((field) => <ReviewItem key={field.fieldId} label={field.label} value={formatAnswer(answers[field.fieldKey])} />)}</div>}
      <div className="registration-review-important"><strong>Important</strong><p>Registration closes on {formatDate(event.registration.deadline)}. {event.registration.registrationFee > 0 ? "Your payment information and proof will be submitted with the registration. Payment remains pending until administrator verification." : "No payment is required for this event."}</p></div>
      {submitting && paymentMethod === "UPI" && <p className="registration-upload-status" role="status">{uploadProgress < 100 ? `Sending registration and screenshot: ${uploadProgress}%` : "Screenshot sent. Saving your registration and payment proof…"}</p>}
      <div className="registration-form-actions"><button type="button" className="registration-secondary-button" onClick={() => setStep("form")} disabled={submitting}>Edit details</button><button type="button" className="participant-button" onClick={() => void confirmRegistration()} disabled={submitting}>{submitting ? "Submitting registration…" : "Submit registration"}</button></div>
    </section>}
  </div>;
}

function CustomField({ field, value, error, onChange }: { field: EventRegistrationField; value?: FieldValue; error?: string; onChange: (value: FieldValue) => void }) {
  const id = `custom-${field.fieldId}`;
  const describedBy = error ? `${id}-error` : undefined;
  const label = <span>{field.label}{field.required && <i> *</i>}</span>;
  const options = field.options || [];
  return <div className={`registration-custom-field${["RADIO", "CHECKBOX"].includes(field.fieldType) ? " is-choice-field" : ""}`}>
    {field.fieldType === "TEXTAREA" ? <label htmlFor={id}>{label}<textarea id={id} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} aria-invalid={Boolean(error)} aria-describedby={describedBy} rows={4} /></label>
      : field.fieldType === "DROPDOWN" ? <label htmlFor={id}>{label}<select id={id} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} aria-invalid={Boolean(error)} aria-describedby={describedBy}><option value="">Select an option</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
        : field.fieldType === "RADIO" ? <fieldset aria-describedby={describedBy}><legend>{label}</legend>{options.map((option) => <label className="registration-choice" key={option}><input type="radio" name={id} checked={value === option} onChange={() => onChange(option)} /><span>{option}</span></label>)}</fieldset>
          : field.fieldType === "CHECKBOX" ? <fieldset aria-describedby={describedBy}><legend>{label}</legend>{options.map((option) => { const checked = Array.isArray(value) && value.includes(option); return <label className="registration-choice" key={option}><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked ? [...(Array.isArray(value) ? value : []), option] : (Array.isArray(value) ? value.filter((item) => item !== option) : []))} /><span>{option}</span></label>; })}</fieldset>
            : <label htmlFor={id}>{label}<input id={id} type={field.fieldType === "NUMBER" ? "number" : field.fieldType === "DATE" ? "date" : field.fieldType === "URL" ? "url" : "text"} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} aria-invalid={Boolean(error)} aria-describedby={describedBy} /></label>}
    {error && <small className="registration-field-error" id={`${id}-error`} role="alert">{error}</small>}
  </div>;
}

function RegistrationError({ message, event, onRetry, team = false }: { message: string; event?: EventDetails; onRetry?: () => void; team?: boolean }) {
  return <section className="registration-availability-error"><span className="discover-state-mark">!</span><p className="participant-eyebrow">REGISTRATION</p><h1>Registration unavailable</h1><p>{message}</p><div>{onRetry && <button type="button" className="registration-secondary-button" onClick={onRetry}>Retry check</button>}{team && event ? <Link className="participant-button" to={`/events/${event._id}/register-team`}>Register Your Team</Link> : <Link className="participant-button" to={event ? `/events/${event._id}` : "/events"}>{event ? "Back to Event" : "Explore Events"}</Link>}<Link to="/events" className="event-detail-secondary-action">Explore more events</Link></div></section>;
}

function ExistingRegistration({ event, state }: { event: EventDetails; state: Exclude<ReturnType<typeof getEventRegistrationState>, { kind: "NONE" }> }) {
  const registered = state.kind === "INDIVIDUAL" || state.kind === "TEAM";
  const label = state.kind === "TEAM" ? "Team Registered" : state.kind === "INDIVIDUAL" ? "Already Registered" : state.kind === "CANCELLED" ? "Previous registration" : "Registration status unavailable";
  const message = state.kind === "TEAM" ? "An active team registration for this event is linked to your account." : state.kind === "INDIVIDUAL" ? "An active individual registration for this event is linked to your account." : state.kind === "CANCELLED" ? "A previous registration record exists. The current registration system may prevent creating another record for this event." : "A team registration record exists, but its status could not be confirmed. No new registration can be started until it is checked.";
  return <section className="registration-availability-error"><span className="discover-state-mark">{registered ? "✓" : "!"}</span><p className="participant-eyebrow">REGISTRATION STATUS</p><h1>{label}</h1><p>{message}</p><div><Link className="participant-button" to={existingRegistrationPath(state)}>{state.kind === "TEAM" && state.registration.isTeamLeader ? "View Team Details" : "View Registration"}</Link><Link className="registration-secondary-button" to={`/events/${event._id}`}>Back to Event</Link></div></section>;
}

function RegistrationSuccess({ event, receipt }: { event: EventDetails; receipt: RegistrationReceipt }) {
  const paymentRequired = event.registration.registrationFee > 0;
  return <section className="registration-success-card"><span className="registration-success-mark" aria-hidden="true">✓</span><p className="participant-eyebrow">VIBRANT2K26 · REGISTRATION</p><h1>You’re registered.</h1><p className="registration-success-lede">Your place for <strong>{event.name}</strong> has been recorded.</p>
    <div className="registration-success-details"><ReviewItem label="Registration reference" value={receipt.id} /><ReviewItem label="Registration status" value={formatStatus(receipt.status)} /><ReviewItem label="Payment status" value={formatStatus(receipt.paymentStatus)} /></div>
    {paymentRequired && <p className="registration-payment-reminder">Payment status: {formatStatus(receipt.paymentStatus)}. Submitted payment information remains pending until administrator verification.</p>}
    <div className="registration-form-actions"><Link className="registration-secondary-button" to={`/events/${event._id}`}>Back to Event</Link><Link className="participant-button" to={`/registrations/${receipt.id}`}>View This Registration</Link></div>
  </section>;
}

function ReviewItem({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value || "—"}</strong></div>; }

function getIndividualEligibility(event: EventDetails) {
  if (event.status !== "PUBLISHED") return { available: false, message: "This event is not currently accepting registrations." };
  if (event.registration.mode !== "INDIVIDUAL") return { available: false, message: "This event requires team registration." };
  const { capacity, registeredParticipants, deadline } = event.registration;
  if (!Number.isFinite(capacity) || !Number.isFinite(registeredParticipants) || (capacity ?? 0) < 1) return { available: false, message: "Registration availability cannot be confirmed for this event." };
  if ((registeredParticipants ?? 0) >= (capacity ?? 0)) return { available: false, message: "This event is fully booked." };
  const deadlineTime = new Date(deadline).getTime();
  if (!Number.isFinite(deadlineTime)) return { available: false, message: "The registration deadline could not be confirmed." };
  if (deadlineTime <= Date.now()) return { available: false, message: "The registration deadline has passed." };
  return { available: true, message: "Registration is open." };
}

function getSubmissionError(error: unknown) {
  if (!axios.isAxiosError(error)) return "We couldn’t submit your registration. Check your connection and try again.";
  const status = error.response?.status;
  const message = typeof error.response?.data?.message === "string" ? error.response.data.message : "";
  if (status === 401) return "Your session has expired. Sign in again before registering.";
  if (status === 403) return "This account is not authorized to register for events from this portal.";
  if (status === 404) return "This event is no longer available.";
  if (status === 409 && /already registered/i.test(message)) return "You already have an active registration for this event.";
  if (status === 409) return "A place is no longer available or registration has closed. Return to the event page and check its current availability.";
  if (status === 400 && /requires team registration/i.test(message)) return "This event requires team registration, which will be available in Phase 6.";
  if (status === 400 && message) return message;
  if (status === 413) return "The payment screenshot must be 5 MB or smaller. Edit details and choose a smaller image.";
  if (status === 502 && message) return message;
  return "We couldn’t submit your registration right now. Please try again.";
}

function isUnauthorizedError(message: string) { return message.toLowerCase().includes("session has expired"); }
function isHttpUrl(value: string) { try { const parsed = new URL(value); return parsed.protocol === "http:" || parsed.protocol === "https:"; } catch { return false; } }
function formatAnswer(value?: FieldValue) { return Array.isArray(value) ? value.join(", ") : value?.trim() || "—"; }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "unavailable" : new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" }).format(date); }
function formatFee(value: number) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value); }
function formatStatus(value: string) { return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()); }
