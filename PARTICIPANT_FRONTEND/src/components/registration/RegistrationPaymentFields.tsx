import { useEffect, useRef, useState } from "react";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function syncFileInput(input: HTMLInputElement, file: File | null) {
  const selection = new DataTransfer();
  if (file) selection.items.add(file);
  input.files = selection.files;
}

interface Props {
  method: "" | "UPI" | "CASH";
  onMethodChange: (method: "UPI" | "CASH") => void;
  qrUrl?: string | null;
  amount: number;
  screenshot: File | null;
  onScreenshotChange: (file: File | null) => void;
  cashReceiverName: string;
  onCashReceiverNameChange: (value: string) => void;
  error?: string;
  onError: (message: string) => void;
  shared?: boolean;
}

export default function RegistrationPaymentFields({ method, onMethodChange, qrUrl, amount, screenshot, onScreenshotChange, cashReceiverName, onCashReceiverNameChange, error, onError, shared = false }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // React state owns the File; restore the native filename after review/edit
    // or a UPI/CASH round trip mounts a new input element.
    if (fileInput.current) syncFileInput(fileInput.current, screenshot);
  }, [screenshot, method]);
  return <>
    <div className="registration-payment-options">
      <label className={`registration-payment-option${method === "UPI" ? " is-selected" : ""}${!qrUrl ? " is-unavailable" : ""}`}>
        <input type="radio" name={shared ? "team-payment-method" : "paymentMethod"} checked={method === "UPI"} disabled={!qrUrl} onChange={() => onMethodChange("UPI")} />
        <span><strong>UPI</strong><small>{qrUrl ? "Pay using this event’s QR and submit one payment screenshot." : "Unavailable: the event administrator has not configured a UPI QR image."}</small></span>
      </label>
      <label className={`registration-payment-option${method === "CASH" ? " is-selected" : ""}`}>
        <input type="radio" name={shared ? "team-payment-method" : "paymentMethod"} checked={method === "CASH"} onChange={() => onMethodChange("CASH")} />
        <span><strong>Cash</strong><small>Payment remains pending until it is confirmed by an administrator.</small></span>
      </label>
    </div>
    {method === "UPI" && qrUrl && <div className="registration-event-payment-qr">
      <div className="registration-payment-qr-display">
        <h3>Payment QR</h3>
        <div className="registration-payment-qr-image"><img src={qrUrl} alt="UPI payment QR configured for this event" /></div>
        <strong>{shared ? `Configured fee per registration: ${formatAmount(amount)}` : `Pay ${formatAmount(amount)}`}</strong>
        <p>Scan the QR image configured for this event. Upload one screenshot{shared ? " for the shared team payment" : " of your payment"} below.</p>
      </div>
      <label className="registration-input registration-payment-file"><span>Payment screenshot <i>*</i></span><input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" onChange={event => {
        const file = event.currentTarget.files?.[0];
        if (!file) return;
        if (!ALLOWED_TYPES.has(file.type)) { syncFileInput(event.currentTarget, screenshot); onError("Choose a JPG, JPEG, PNG or WEBP payment screenshot."); return; }
        if (file.size > MAX_FILE_SIZE) { syncFileInput(event.currentTarget, screenshot); onError("Payment screenshots must be 5 MB or smaller."); return; }
        onError(""); onScreenshotChange(file);
      }} /><small>JPG, JPEG, PNG or WEBP · up to 5 MB. Your screenshot uploads when you submit the final registration.</small></label>
      {screenshot && <div className="registration-payment-selected-file"><PaymentProofPreview file={screenshot} /><span>{screenshot.name}</span><button type="button" onClick={() => { if (fileInput.current) fileInput.current.value = ""; onScreenshotChange(null); onError(""); }}>Remove</button></div>}
    </div>}
    {method === "CASH" && <label className="registration-input registration-cash-receiver"><span>Name of the person who received the cash <i>*</i></span><input value={cashReceiverName} maxLength={120} onChange={event => onCashReceiverNameChange(event.target.value)} placeholder="Enter receiver’s name" autoComplete="name" /></label>}
    {error && <p className="registration-field-error" role="alert">{error}</p>}
  </>;
}

export function PaymentProofPreview({ file }: { file: File }) {
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);
  useEffect(() => {
    // Each effect setup owns a URL, including StrictMode's setup/cleanup replay.
    const url = URL.createObjectURL(file);
    setPreview({ file, url });
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return preview?.file === file ? <img src={preview.url} alt="Selected payment screenshot preview" className="registration-payment-proof-preview" /> : null;
}

function formatAmount(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
}
