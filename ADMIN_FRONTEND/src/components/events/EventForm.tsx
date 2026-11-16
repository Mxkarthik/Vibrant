import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, ArrowLeft, Image, Save } from "lucide-react";
import type { CreateEventPayload, EventCategory, EventRecord, RegistrationField, RegistrationMode } from "../../api/events";
import { createEvent, getApiErrorMessage, updateEvent } from "../../api/events";
import Button from "../ui/Button";
import Card from "../ui/Card";
import PageHeader from "../admin/PageHeader";
import RegistrationFieldBuilder from "./RegistrationFieldBuilder";

const categories: EventCategory[] = ["TECHNICAL", "CULTURAL", "SPORTS", "WORKSHOP", "COMPETITION"];
const localValue = (value?: string) => value ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";

interface FormValues {
  name: string; description: string; category: EventCategory | ""; poster: string; venue: string;
  startDate: string; endDate: string; deadline: string; mode: RegistrationMode; fee: string;
  capacity: string; minTeamSize: string; maxTeamSize: string;
}

function valuesFromEvent(event?: EventRecord): FormValues {
  return {
    name: event?.name ?? "", description: event?.description ?? "", category: event?.category ?? "",
    poster: event?.poster ?? "", venue: event?.venue ?? "", startDate: localValue(event?.startDate),
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
  const editing = mode === "edit";

  useEffect(() => {
    setValues(valuesFromEvent(event));
    setFields(event?.registrationFields ?? []);
  }, [event]);

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => setValues(current => ({ ...current, [key]: value }));
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
        poster: values.poster.trim() || null, venue: values.venue.trim(),
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
  const posterUrl = values.poster.trim();

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
          <label className="form-field span-two"><span>Poster URL <small>Optional</small></span><input type="url" value={values.poster} onChange={e => { set("poster", e.target.value); setPosterFailed(false); }} placeholder="https://example.com/event-poster.jpg" /><small>Use a publicly accessible image URL.</small></label>
          {posterUrl && !posterFailed && <div className="poster-preview span-two"><img src={posterUrl} alt="Event poster preview" onError={() => setPosterFailed(true)} /><span><Image size={14} /> Poster preview</span></div>}
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

      <div className="event-form-footer"><span><b>*</b> Required fields. New events are published when created.</span><div><Button type="button" variant="secondary" onClick={() => navigate(editing && event ? `/admin/events/${event._id}` : "/admin/events")} disabled={submitting}>Discard</Button><Button type="submit" variant="primary" icon={<Save size={15} />} disabled={submitting}>{submitting ? "Saving…" : editing ? "Save changes" : "Create event"}</Button></div></div>
    </form>
  </>;
}

function SectionHeading({ number, title, description }: { number: string; title: string; description: string }) {
  return <div className="form-section-heading"><span>{number}</span><div><h2>{title}</h2><p>{description}</p></div></div>;
}
