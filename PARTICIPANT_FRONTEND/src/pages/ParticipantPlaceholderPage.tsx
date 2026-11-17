import { Link, useParams } from "react-router-dom";

const content = {
  events: { title: "Explore Events", eyebrow: "FIND YOUR NEXT MOMENT", description: "Event discovery is coming in a later phase. Your registered events are already available on the dashboard." },
  registrations: { title: "My Registrations", eyebrow: "YOUR VIBRANT HISTORY", description: "A complete registration view is coming in a later phase. The dashboard shows your latest registration activity." },
  profile: { title: "My Profile", eyebrow: "YOUR PARTICIPANT DETAILS", description: "Profile management is coming in a later phase." },
  event: { title: "Event details", eyebrow: "VIBRANT2K26 EVENT", description: "Event details will be available when event discovery is introduced." },
} as const;

export default function ParticipantPlaceholderPage({ type }: { type: keyof typeof content }) {
  const { eventId } = useParams();
  const page = content[type];
  return <section className="participant-placeholder-page">
    <p className="participant-eyebrow">{page.eyebrow}</p>
    <h1>{page.title}</h1>
    <p>{page.description}</p>
    {type === "event" && eventId && <span className="participant-placeholder-note">Event reference: {eventId}</span>}
    <Link className="participant-button" to={type === "registrations" ? "/dashboard" : "/events"}>{type === "registrations" ? "Back to dashboard" : "Explore Events"}</Link>
  </section>;
}
