import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, ArrowLeft, Image, Save } from "lucide-react";
import type { CreateEventPayload, EventCategory, EventRecord, RegistrationField, RegistrationMode } from "../../api/events";
import { createEvent, getApiErrorMessage, updateEvent, uploadEventPaymentQr, uploadEventPoster } from "../../api/events";
import Button from "../ui/Button";
import Card from "../ui/Card";
import PageHeader from "../admin/PageHeader";
import RegistrationFieldBuilder from "./RegistrationFieldBuilder";
import "./eventPoster.css";

const categories: EventCategory[] = ["TECHNICAL", "CULTURAL", "SPORTS", "WORKSHOP", "COMPETITION"];
const MAX_POSTER_SIZE = 5 * 1024 * 1024;
const ALLOWED_POSTER_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const localValue = (value?: string) => value ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";

interface FormValues {
  name: string; description: string; category: EventCategory | ""; poster: string; paymentQrUrl: string; venue: string;
  startDate: string; endDate: string; deadline: string; mode: RegistrationMode; fee: string;
  capacity: string; minTeamSize: string; maxTeamSize: string;
}

function valuesFromEvent(event?: EventRecord): FormValues {
  return {
    name: event?.name ?? "", description: event?.description ?? "", category: event?.category ?? "",
    poster: event?.poster ?? "", paymentQrUrl: event?.paymentQrUrl ?? "", venue: event?.venue ?? "", startDate: localValue(event?.startDate),
    endDate: localValue(event?.endDate), deadline: localValue(event?.registration.deadline),
    mode: event?.registration.mode ?? "INDIVIDUAL", fee: String(event?.registration.registrationFee ?? 0),
    capacity: String(event?.registration.capacity ?? ""), minTeamSize: String(event?.registration.minTeamSize ?? 2),
    maxTeamSize: String(event?.registration.maxTeamSize ?? 5),
  };
}

export default function EventForm({ mode, event }: { mode: "create" | "edit"; event?: EventRecord }) {
  const navigate = useNavigate();
  const [values, setValues] = useState<FormValues>(() => valuesFromEvent(event));
  const [fields, setFields] = useState<RegistrationField[]>(event?.registrationFields ?? []);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posterFailed, setPosterFailed] = useState(false);
  const [posterPreview, setPosterPreview] = useState(event?.poster ?? "");
  const [posterUploadError, setPosterUploadError] = useState<string | null>(null);
  const [posterUploading, setPosterUploading] = useState(false);
  const [posterProgress, setPosterProgress] = useState(0);
  const [posterFile, setPosterFile] = useState<File | null>(null);
  const [posterDragging, setPosterDragging] = useState(false);
  const [qrUploadError, setQrUploadError] = useState<string | null>(null);
  const [qrUploading, setQrUploading] = useState(false);
  const [qrProgress, setQrProgress] = useState(0);
  const [qrFileError, setQrFileError] = useState<string | null>(null);
  const qrInput = useRef<HTMLInputElement>(null);
  const posterInput = useRef<HTMLInputElement>(null);
  const localPosterPreview = useRef<string | null>(null);
  const editing = mode === "edit";

  useEffect(() => {
    if (localPosterPreview.current) URL.revokeObjectURL(localPosterPreview.current);
    localPosterPreview.current = null;
    setValues(valuesFromEvent(event));
    setFields(event?.registrationFields ?? []);
    setPosterPreview(event?.poster ?? "");
    setPosterFile(null);
    setPosterUploadError(null);
    setPosterFailed(false);
    setQrUploadError(null);
    setQrFileError(null);
  }, [event]);

  useEffect(() => () => {
    if (localPosterPreview.current) URL.revokeObjectURL(localPosterPreview.current);
  }, []);

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => setValues(current => ({ ...current, [key]: value }));
  const uploadPoster = async (file: File) => {
    if (!ALLOWED_POSTER_TYPES.has(file.type)) {
      setPosterUploadError("Choose a JPG, PNG or WEBP image.");
      return;
    }
    if (file.size > MAX_POSTER_SIZE) {
      setPosterUploadError("Poster images must be 5 MB or smaller.");
      return;
    }

    if (localPosterPreview.current) URL.revokeObjectURL(localPosterPreview.current);
    const previewUrl = URL.createObjectURL(file);
    localPosterPreview.current = previewUrl;
    setPosterFile(file);
    setPosterPreview(previewUrl);
    setPosterFailed(false);
    setPosterUploadError(null);
    setPosterProgress(0);
    setPosterUploading(true);
    try {
      const result = await uploadEventPoster(file, setPosterProgress);
      set("poster", result.secureUrl);
      setPosterPreview(result.secureUrl);
      setPosterFile(null);
      URL.revokeObjectURL(previewUrl);
      localPosterPreview.current = null;
    } catch (requestError) {
      setPosterUploadError(getApiErrorMessage(requestError, "The poster could not be uploaded. Please try again."));
    } finally {
      setPosterUploading(false);
    }
  };

  const removePoster = () => {
    if (localPosterPreview.current) URL.revokeObjectURL(localPosterPreview.current);
    localPosterPreview.current = null;
    set("poster", "");
    setPosterPreview("");
    setPosterFile(null);
    setPosterUploadError(null);
    setPosterFailed(false);
    if (posterInput.current) posterInput.current.value = "";
  };

  const discardPosterReplacement = () => {
    if (localPosterPreview.current) URL.revokeObjectURL(localPosterPreview.current);
    localPosterPreview.current = null;
    setPosterFile(null);
    setPosterPreview(values.poster);
    setPosterUploadError(null);
    setPosterFailed(false);
    if (posterInput.current) posterInput.current.value = "";
  };
  const uploadPaymentQr = async (file: File) => {
    if (!ALLOWED_POSTER_TYPES.has(file.type)) { setQrFileError("Choose a JPG, PNG or WEBP image."); return; }
    if (file.size > MAX_POSTER_SIZE) { setQrFileError("Payment QR images must be 5 MB or smaller."); return; }
    setQrFileError(null); setQrUploadError(null); setQrUploading(true); setQrProgress(0);
    try {
      const result = await uploadEventPaymentQr(file, setQrProgress);
      set("paymentQrUrl", result.secureUrl);
    } catch (requestError) {
      setQrUploadError(getApiErrorMessage(requestError, "The payment QR image could not be uploaded. The existing saved QR will be kept."));
    } finally { setQrUploading(false); }
  };
  const fieldError = () => {
    const keys = fields.map(field => field.fieldKey.trim().toLowerCase());
    if (keys.some(key => !/^[a-z][a-z0-9_]*$/.test(key))) return "Each field key must begin with a letter and contain only letters, numbers, and underscores.";
    if (new Set(keys).size !== keys.length) return "Registration field keys must be unique.";
    if (fields.some(field => ["DROPDOWN", "RADIO", "CHECKBOX"].includes(field.fieldType) && field.options.length === 0)) return "Add at least one option to each choice field.";
    if (fields.some(field => ["DROPDOWN", "RADIO", "CHECKBOX"].includes(field.fieldType) && new Set(field.options).size !== field.options.length)) return "Choice field options must be unique.";
    return null;
  };

  const submit = async (eventSubmit: FormEvent<HTMLFormElement>) => {
    eventSubmit.preventDefault();
    setError(null);
    const validationError = !editing ? fieldError() : null;
    if (validationError) { setError(validationError); return; }
    setSubmitting(true);
    try {
      const common = {
        name: values.name.trim(), description: values.description.trim(), category: values.category as EventCategory,
        poster: values.poster.trim() || null, paymentQrUrl: values.paymentQrUrl.trim() || null, venue: values.venue.trim(),
        startDate: new Date(values.startDate).toISOString(), endDate: new Date(values.endDate).toISOString(),
      };
      if (editing && event) {
        const result = await updateEvent(event._id, {
          ...common,
          registration: {
            deadline: new Date(values.deadline).toISOString(),
            capacity: Number(values.capacity),
            registrationFee: Number(values.fee),
          },
        });
        navigate(`/admin/events/${event._id}`, { replace: true, state: { notice: result.message } });
      } else {
        const payload: CreateEventPayload = {
          ...common,
          registration: {
            mode: values.mode, deadline: new Date(values.deadline).toISOString(),
            capacity: Number(values.capacity), registrationFee: Number(values.fee),
            ...(values.mode === "TEAM" ? { minTeamSize: Number(values.minTeamSize), maxTeamSize: Number(values.maxTeamSize) } : {}),
          },
          registrationFields: fields.map((field, order) => ({ ...field, fieldKey: field.fieldKey.trim(), label: field.label.trim(), order })),
        };
        const result = await createEvent(payload);
        navigate(`/admin/events/${result.event._id}`, { replace: true, state: { notice: "Event created successfully. It is now published." } });
      }
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, editing ? "The event could not be updated." : "The event could not be created."));
    } finally {
      setSubmitting(false);
    }
  };

  const registrationCount = event?.registration.registeredParticipants ?? 0;
  return <>
    <PageHeader title={editing ? "Edit event" : "Create event"} description={editing ? "Update the event details supported by the current system." : "Set up the event, registration rules and participant fields."} action={<Button variant="quiet" icon={<ArrowLeft size={15} />} onClick={() => navigate(editing && event ? `/admin/events/${event._id}` : "/admin/events")}>Back</Button>} />
    {editing && <div className="event-edit-note"><AlertCircle size={15} /><span>Registration mode, team sizes and custom registration fields cannot be changed after event creation. {registrationCount ? `Capacity cannot be set below ${registrationCount} existing registrations.` : ""}</span></div>}
    {error && <div className="event-form-error" role="alert"><AlertCircle size={17} /><span>{error}</span></div>}
    <form className="event-form" onSubmit={submit}>
      <Card className="event-form-section">
        <SectionHeading number="01" title="Basic information" description="The essential details shown to your campus community." />
        <div className="event-form-grid">
          <label className="form-field span-two"><span>Event name <b>*</b></span><input value={values.name} onChange={e => set("name", e.target.value)} required maxLength={120} placeholder="e.g. Innovation & Technology Summit" /></label>
          <label className="form-field span-two"><span>Description <b>*</b></span><textarea value={values.description} onChange={e => set("description", e.target.value)} required rows={4} placeholder="Describe the event and what participants can expect." /></label>
          <label className="form-field"><span>Category <b>*</b></span><select value={values.category} onChange={e => set("category", e.target.value as EventCategory)} required><option value="" disabled>Select category</option>{categories.map(category => <option key={category} value={category}>{category.charAt(0) + category.slice(1).toLowerCase()}</option>)}</select></label>
          <label className="form-field"><span>Venue <b>*</b></span><input value={values.venue} onChange={e => set("venue", e.target.value)} required placeholder="Building, room or location" /></label>
          <div className="form-field span-two event-poster-field">
            <span>Event poster <small>Optional</small></span>
            {posterPreview && !posterFailed && <div className="poster-preview"><img src={posterPreview} alt="Event poster preview" onError={() => setPosterFailed(true)} /><div><strong>{posterUploading ? "Uploading poster…" : posterFile ? "Selected poster" : "Current poster"}</strong><small>{posterUploading ? `${posterProgress}% uploaded` : posterFile?.name || "Visible on the event listing and details page"}</small></div><Button type="button" variant="quiet" onClick={removePoster} disabled={posterUploading || submitting} aria-label="Remove event poster">Remove</Button></div>}
            {posterFailed && <div className="poster-upload-error" role="alert"><span>The poster preview could not be loaded. Select a replacement image or remove it.</span><Button type="button" variant="quiet" onClick={removePoster} disabled={posterUploading || submitting}>Remove poster</Button></div>}
            <label className={`poster-upload-dropzone${posterDragging ? " is-dragging" : ""}${posterUploading || submitting ? " is-disabled" : ""}`} onDragOver={event => { event.preventDefault(); if (!posterUploading && !submitting) setPosterDragging(true); }} onDragLeave={() => setPosterDragging(false)} onDrop={event => { event.preventDefault(); setPosterDragging(false); if (!posterUploading && !submitting && event.dataTransfer.files[0]) void uploadPoster(event.dataTransfer.files[0]); }}>
              <input ref={posterInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose event poster image" disabled={posterUploading || submitting} onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void uploadPoster(file); event.currentTarget.value = ""; }} />
              <Image size={18} /><strong>{posterPreview ? "Choose a replacement or drop it here" : "Choose an image or drop it here"}</strong><small>JPG, PNG or WEBP · up to 5 MB</small>
            </label>
            {posterUploading && <div className="poster-upload-progress" role="status"><span><i style={{ width: `${posterProgress}%` }} /></span><small>{posterProgress ? `${posterProgress}%` : "Preparing upload…"}</small></div>}
            {posterUploadError && <div className="poster-upload-error" role="alert"><span>{posterUploadError}{editing && values.poster ? " The currently saved poster will be kept unless you remove it." : ""}</span>{posterFile && !posterUploading && <Button type="button" variant="quiet" onClick={() => void uploadPoster(posterFile)} disabled={submitting}>Retry upload</Button>}{posterFile && !posterUploading && values.poster && <Button type="button" variant="quiet" onClick={discardPosterReplacement} disabled={submitting}>Discard replacement</Button>}</div>}
          </div>
          <div className="form-field span-two event-poster-field">
            <span>Event UPI payment QR <small>Required for UPI registrations</small></span>
            {values.paymentQrUrl && <div className="poster-preview payment-qr-preview"><img src={values.paymentQrUrl} alt="Configured event UPI payment QR" /><div><strong>{qrUploading ? "Uploading replacement…" : "Saved event payment QR"}</strong><small>Participants in this event will see this image when they choose UPI.</small></div></div>}
            <label className={`poster-upload-dropzone${qrUploading || submitting ? " is-disabled" : ""}`}>
              <input ref={qrInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose event UPI QR image" disabled={qrUploading || submitting} onChange={e => { const file = e.currentTarget.files?.[0]; if (file) void uploadPaymentQr(file); e.currentTarget.value = ""; }} />
              <Image size={18} /><strong>{values.paymentQrUrl ? "Choose a replacement QR image" : "Upload this event’s UPI QR image"}</strong><small>JPG, PNG or WEBP · up to 5 MB</small>
            </label>
            {qrUploading && <div className="poster-upload-progress" role="status"><span><i style={{ width: `${qrProgress}%` }} /></span><small>{qrProgress ? `${qrProgress}%` : "Preparing upload…"}</small></div>}
            {(qrFileError || qrUploadError) && <div className="poster-upload-error" role="alert">{qrFileError || qrUploadError}</div>}
            {!values.paymentQrUrl && <small>UPI registration will be unavailable until this event has a QR image. Cash registration remains available.</small>}
          </div>
        </div>
      </Card>

      <Card className="event-form-section">
        <SectionHeading number="02" title="Schedule" description="Set the event dates and registration deadline." />
        <div className="event-form-grid three-columns">
          <label className="form-field"><span>Starts <b>*</b></span><input type="datetime-local" value={values.startDate} onChange={e => set("startDate", e.target.value)} required /></label>
          <label className="form-field"><span>Ends <b>*</b></span><input type="datetime-local" value={values.endDate} onChange={e => set("endDate", e.target.value)} required min={values.startDate || undefined} /></label>
          <label className="form-field"><span>Registration deadline <b>*</b></span><input type="datetime-local" value={values.deadline} onChange={e => set("deadline", e.target.value)} required max={values.startDate || undefined} /></label>
        </div>
      </Card>

      <Card className="event-form-section">
        <SectionHeading number="03" title="Registration configuration" description="Choose how participants register and set capacity and fee." />
        <div className="event-form-grid three-columns">
          <label className="form-field"><span>Registration mode <b>*</b></span><select value={values.mode} onChange={e => set("mode", e.target.value as RegistrationMode)} disabled={editing}><option value="INDIVIDUAL">Individual</option><option value="TEAM">Team</option></select>{editing && <small>Fixed after creation.</small>}</label>
          <label className="form-field"><span>Registration fee <b>*</b></span><div className="input-prefix"><span>₹</span><input type="number" min="0" step="0.01" value={values.fee} onChange={e => set("fee", e.target.value)} required /></div></label>
          <label className="form-field"><span>Capacity <b>*</b></span><input type="number" min={Math.max(1, registrationCount)} step="1" value={values.capacity} onChange={e => set("capacity", e.target.value)} required /></label>
          {values.mode === "TEAM" && <>
            <label className="form-field"><span>Minimum team size <b>*</b></span><input type="number" min="1" step="1" value={values.minTeamSize} onChange={e => set("minTeamSize", e.target.value)} required disabled={editing} /></label>
            <label className="form-field"><span>Maximum team size <b>*</b></span><input type="number" min={values.minTeamSize || 1} step="1" value={values.maxTeamSize} onChange={e => set("maxTeamSize", e.target.value)} required disabled={editing} /></label>
          </>}
        </div>
      </Card>

      <Card className="event-form-section">
        <SectionHeading number="04" title="Registration fields" description={editing ? "These participant questions are fixed after event creation." : "Add any event-specific questions for each participant."} />
        <RegistrationFieldBuilder fields={fields} onChange={setFields} readOnly={editing} />
      </Card>

      <div className="event-form-footer"><span><b>*</b> Required fields. New events are published when created.</span><div><Button type="button" variant="secondary" onClick={() => navigate(editing && event ? `/admin/events/${event._id}` : "/admin/events")} disabled={submitting || posterUploading || qrUploading}>Discard</Button><Button type="submit" variant="primary" icon={<Save size={15} />} disabled={submitting || posterUploading || qrUploading}>{posterUploading || qrUploading ? "Uploading image…" : submitting ? "Saving…" : editing ? "Save changes" : "Create event"}</Button></div></div>
    </form>
  </>;
}

function SectionHeading({ number, title, description }: { number: string; title: string; description: string }) {
  return <div className="form-section-heading"><span>{number}</span><div><h2>{title}</h2><p>{description}</p></div></div>;
}
