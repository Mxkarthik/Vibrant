import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { getCertificatePdf, getMyRegistrations, type MyRegistration } from "../api/registrationService";

export default function MyCertificatesPage() {
  const [registrations, setRegistrations] = useState<MyRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    getMyRegistrations(controller.signal)
      .then(setRegistrations)
      .catch((requestError: unknown) => {
        if (axios.isCancel(requestError)) return;
        const status = axios.isAxiosError(requestError) ? requestError.response?.status : undefined;
        setError(status === 401
          ? "Your session has expired. Sign in again to view your certificates."
          : status === 403
            ? "This account cannot access participant certificates."
            : "Certificates could not be loaded. Check your connection and try again.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reloadKey]);

  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return registrations.filter((registration) => !query || [registration.event?.name, registration.certificate?.certificateId]
      .some((value) => value?.toLocaleLowerCase().includes(query)));
  }, [registrations, search]);
  const issuedCount = registrations.filter((registration) => registration.certificate?.isIssued && registration.certificate.certificateId).length;

  return <div className="my-certificates-page">
    <header className="my-certificates-heading">
      <div><p className="participant-eyebrow">YOUR ACHIEVEMENTS</p><h1>My certificates</h1><p>Certificates issued for your event registrations.</p></div>
      <button className="participant-refresh-button" type="button" onClick={() => setReloadKey((value) => value + 1)} disabled={loading}>{loading ? "Loading…" : "Refresh"}<span aria-hidden="true">↻</span></button>
    </header>

    <section className="certificate-toolbar" aria-label="Search certificates">
      <label><span aria-hidden="true">⌕</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search event or certificate ID" aria-label="Search certificates" /></label>
      {!loading && !error && <span>{issuedCount} issued</span>}
    </section>

    {error && <section className="certificate-state is-error" role="alert"><span className="discover-state-mark">!</span><h2>Couldn’t load certificates</h2><p>{error}</p><div><button className="participant-button" type="button" onClick={() => setReloadKey((value) => value + 1)}>Try again</button>{error.includes("Sign in") && <Link to="/login">Sign in</Link>}</div></section>}
    {loading && <div className="certificate-list" aria-label="Loading certificates">{[0, 1, 2].map((item) => <div className="certificate-skeleton" key={item}><span /><div><i /><i /><i /></div></div>)}</div>}
    {!loading && !error && registrations.length === 0 && <section className="certificate-state"><span className="discover-state-mark">V</span><h2>No registrations yet</h2><p>Certificates appear here only when an administrator has issued one for your registration.</p><Link className="participant-button" to="/events">Explore Events</Link></section>}
    {!loading && !error && registrations.length > 0 && visible.length === 0 && <section className="certificate-state"><span className="discover-state-mark">⌕</span><h2>No matching records</h2><p>Try a different event name or certificate ID.</p><button type="button" className="registration-secondary-button" onClick={() => setSearch("")}>Clear search</button></section>}
    {!loading && !error && visible.length > 0 && <section className="certificate-list" aria-label="Your certificates">{visible.map((registration) => <CertificateCard key={registration.id} registration={registration} />)}</section>}
  </div>;
}

function CertificateCard({ registration }: { registration: MyRegistration }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);
  const certificate = registration.certificate;
  const issued = Boolean(certificate?.isIssued && certificate.certificateId);
  const event = registration.event;

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const getDocument = async () => {
    if (!certificate?.certificateId) throw new Error("Certificate document unavailable.");
    const blob = await getCertificatePdf(certificate.certificateId);
    if (blob.type && blob.type !== "application/pdf" && blob.type !== "application/octet-stream") throw new Error("The certificate response was not a PDF document.");
    return blob;
  };

  const togglePreview = async () => {
    setMessage(null);
    if (previewUrl) { setPreviewUrl(null); return; }
    setPreviewLoading(true);
    try {
      const blob = await getDocument();
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (requestError) {
      setMessage(certificateError(requestError));
      setMessageIsError(true);
    } finally { setPreviewLoading(false); }
  };

  const download = async () => {
    setDownloading(true);
    setMessage(null);
    try {
      const blob = await getDocument();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `${certificate.certificateId}.pdf`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
      setMessage("The download was requested. Check your browser’s downloads.");
      setMessageIsError(false);
    } catch (requestError) {
      setMessage(certificateError(requestError));
      setMessageIsError(true);
    } finally { setDownloading(false); }
  };

  return <article className="certificate-card">
    <div className="certificate-card-main">
      <div className="certificate-card-title"><div><span className="participant-category">{event?.category || "EVENT"}</span><h2>{event?.name || "Event details unavailable"}</h2></div><span className={`participant-status-badge ${issued ? "badge-success" : "badge-neutral"}`}>{issued ? "Issued" : "Not issued"}</span></div>
      <div className="certificate-facts">
        <Fact label="Participant" value={registration.participantName || "Name unavailable"} />
        <Fact label="Event date" value={event ? formatDate(event.startDate) : "Date unavailable"} />
        <Fact label="Certificate ID" value={issued ? certificate.certificateId! : "Not assigned"} />
        <Fact label="Issue date" value={issued ? formatDate(certificate.issuedAt) : "Not available"} />
        {registration.isTeam && registration.team?.name && <Fact label="Team" value={registration.team.name} />}
      </div>
      {issued ? <div className="certificate-actions"><button type="button" className="registration-secondary-button" onClick={() => void togglePreview()} disabled={previewLoading}>{previewLoading ? "Loading preview…" : previewUrl ? "Hide preview" : "Preview PDF"}</button><button type="button" className="participant-button" onClick={() => void download()} disabled={downloading}>{downloading ? "Preparing…" : "Download certificate"}</button></div>
        : <p className="certificate-not-issued">No certificate has been issued for this registration. Issuance follows the existing event certificate process.</p>}
      {message && <p className={`certificate-feedback${messageIsError ? " is-error" : ""}`} role={messageIsError ? "alert" : "status"}>{message}</p>}
      {previewUrl && <div className="certificate-preview"><iframe title={`Certificate PDF for ${event?.name || "event"}`} src={previewUrl} /><a href={previewUrl} target="_blank" rel="noreferrer">Open PDF in a new tab</a></div>}
    </div>
  </article>;
}

function Fact({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong title={value}>{value}</strong></div>; }
function formatDate(value: string | null) { if (!value) return "Not available"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "Not available" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date); }
function certificateError(error: unknown) {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 404) return "This certificate is no longer available. Refresh the page and try again.";
    if (error.response?.status === 401) return "Your session has expired. Sign in again to access your certificates.";
  }
  return error instanceof Error ? error.message : "The certificate could not be loaded. Please try again.";
}
