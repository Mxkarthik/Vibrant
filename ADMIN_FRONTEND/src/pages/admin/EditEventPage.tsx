import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { AlertCircle } from "lucide-react";
import { getApiErrorMessage, getEvent, type EventRecord } from "../../api/events";
import Button from "../../components/ui/Button";
import EventForm from "../../components/events/EventForm";
import { LoadingScreen } from "../../auth/RouteGuards";

export default function EditEventPage() {
  const { id = "" } = useParams();
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    setLoading(true);
    getEvent(id).then(value => { if (current) setEvent(value); }).catch(requestError => { if (current) setError(getApiErrorMessage(requestError, "Event details could not be loaded.")); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [id]);
  if (loading) return <LoadingScreen />;
  if (error || !event) return <div className="events-error"><div><AlertCircle size={17} /><strong>{error ?? "Event not found"}</strong></div><Button variant="secondary" onClick={() => window.location.assign("/admin/events")}>Back to events</Button></div>;
  return <EventForm key={event._id} mode="edit" event={event} />;
}
