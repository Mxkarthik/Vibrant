import { useEffect, useState } from "react";
import axios from "axios";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type Props = {
  title: string;
  amount: number | null;
  method: string;
  status: string;
  proofUrl: string | null;
  eventQrUrl?: string | null;
  cashReceiverName?: string | null;
  onUpload: (file: File, onProgress: (percent: number) => void) => Promise<{ proofUrl: string }>;
  onUploaded: (proofUrl: string) => void;
};

export default function PaymentProofPanel({ title, amount, method, status, proofUrl, eventQrUrl, cashReceiverName, onUpload, onUploaded }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const canUpload = method === "UPI" && status === "PENDING" && !proofUrl;
  const chooseFile = (candidate?: File) => {
    setError(null);
    setMessage(null);
    setFile(null);
    if (!candidate) return;
    if (!ALLOWED_TYPES.has(candidate.type)) { setError("Choose a JPG, PNG, or WEBP image."); return; }
    if (candidate.size > MAX_FILE_SIZE) { setError("The image must be 5 MB or smaller."); return; }
    setFile(candidate);
  };

  const submit = async () => {
    if (!file || !canUpload || uploading) return;
    setUploading(true);
    setProgress(0);
    setError(null);
    setMessage(null);
    try {
      const result = await onUpload(file, setProgress);
      onUploaded(result.proofUrl);
      setFile(null);
      setMessage("Payment proof submitted. It is awaiting administrator review; this upload does not verify payment.");
    } catch (uploadError: unknown) {
      setError(getUploadError(uploadError));
    } finally {
      setUploading(false);
    }
  };

  return <section className="payment-proof-panel" aria-labelledby="payment-proof-heading">
    <div className="payment-proof-heading"><div><p className="participant-eyebrow">PAYMENT</p><h2 id="payment-proof-heading">{title}</h2></div><span className={`participant-status-badge ${statusTone(status)}`}>{formatStatus(status)}</span></div>
    <div className="payment-proof-summary">
      <PaymentFact label="Amount" value={amount === null ? "Not available" : amount === 0 ? "Free" : formatAmount(amount)} />
      <PaymentFact label="Payment method" value={formatStatus(method)} />
      <PaymentFact label="Payment status" value={formatStatus(status)} />
      {method === "CASH" && cashReceiverName && <PaymentFact label="Cash received by" value={cashReceiverName} />}
    </div>

    {status === "NOT_REQUIRED" && <p className="payment-proof-note is-neutral">No payment is required for this registration.</p>}
    {status === "PENDING" && method === "UPI" && (eventQrUrl ? <div className="payment-proof-event-qr"><img src={eventQrUrl} alt="UPI payment QR for this event" /><p>Scan this event’s configured QR to pay. Payment remains pending until an administrator verifies it.</p></div> : <p className="payment-proof-note">This event has no configured UPI payment QR. Contact the event administrator for instructions.</p>)}
    {status === "PENDING" && method === "CASH" && <p className="payment-proof-note">Cash payment remains pending until an administrator verifies it. Contact the event administrator for collection details if needed.</p>}
    {status === "PENDING" && method === "UPI" && amount === null && <p className="payment-proof-note is-neutral">The payable amount is not recorded on this registration. Confirm the exact amount with the event administrator before paying.</p>}
    {status === "VERIFIED" && <p className="payment-proof-note is-success">An administrator has verified this payment.</p>}
    {status === "REJECTED" && <p className="payment-proof-note is-error">An administrator rejected this submission. No rejection reason is stored, and the current backend does not allow another proof upload. Contact the event administrator for next steps.</p>}
    {!['PENDING', 'VERIFIED', 'REJECTED', 'NOT_REQUIRED'].includes(status) && <p className="payment-proof-note is-neutral">The payment status is {formatStatus(status)}. Contact the event administrator if you need help.</p>}

    {proofUrl && <div className="payment-proof-existing"><p>Submitted proof</p><a href={proofUrl} target="_blank" rel="noreferrer"><img src={proofUrl} alt="Uploaded payment proof" onError={(event) => { event.currentTarget.alt = "Payment proof image is unavailable"; }} /><span>Open proof image ↗</span></a><small>{status === "PENDING" ? "Awaiting administrator review." : "This image is the proof associated with the payment record."}</small></div>}
    {canUpload && <div className="payment-proof-upload">
      <label className="payment-proof-file-label">Payment proof image<input type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" disabled={uploading} onChange={(event) => { const selected = event.currentTarget.files?.[0]; event.currentTarget.value = ""; chooseFile(selected); }} /></label>
      <small>JPG, PNG, or WEBP · 5 MB maximum</small>
      {previewUrl && <div className="payment-proof-selected"><img src={previewUrl} alt="Selected payment proof preview" /><div><strong>{file?.name}</strong><button type="button" onClick={() => chooseFile()} disabled={uploading}>Remove</button></div></div>}
      {uploading && <div className="payment-upload-progress" role="progressbar" aria-label="Uploading payment proof" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div>}
      {error && <p className="payment-proof-feedback is-error" role="alert">{error}</p>}
      {message && <p className="payment-proof-feedback is-success" role="status">{message}</p>}
      <button className="participant-button" type="button" onClick={() => void submit()} disabled={!file || uploading}>{uploading ? `Uploading${progress ? ` · ${progress}%` : "…"}` : "Submit payment proof"}</button>
    </div>}
  </section>;
}

function PaymentFact({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function formatStatus(value: string) { return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatAmount(value: number) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value); }
function statusTone(value: string) { return value === "VERIFIED" ? "badge-success" : value === "PENDING" ? "badge-warning" : value === "REJECTED" ? "badge-danger" : "badge-neutral"; }
function getUploadError(error: unknown) {
  if (!axios.isAxiosError(error)) return "Payment proof could not be uploaded. Check your connection and try again.";
  const status = error.response?.status;
  const message = typeof error.response?.data?.message === "string" ? error.response.data.message : "";
  if (status === 401) return "Your session has expired. Sign in again before submitting proof.";
  if (status === 403) return "This account is not allowed to submit proof for this payment.";
  if (status === 400) return message || "This payment cannot accept proof right now.";
  if (status === 409) return message || "Proof has already been submitted for this payment.";
  if (status === 413) return "The image is larger than the 5 MB upload limit.";
  return "Payment proof could not be uploaded. Please try again later.";
}
