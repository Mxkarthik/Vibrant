import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AlertCircle, Camera, CameraOff, CheckCircle2, KeyRound, LockKeyhole } from "lucide-react";
import { getApiErrorMessage } from "../../api/events";
import { submitAttendanceToken } from "../../api/attendance";
import Button from "../ui/Button";

type Feedback = { type: "success" | "duplicate" | "invalid" | "unauthorized" | "error"; message: string; participant?: string; checkedInAt?: string };
type Barcode = { rawValue?: string };
type BarcodeDetectorLike = { detect: (source: HTMLVideoElement) => Promise<Barcode[]> };
type BarcodeDetectorConstructor = new (options: { formats: string[] }) => BarcodeDetectorLike;

export default function AttendanceScanner({ enabled, onCheckedIn }: { enabled: boolean; onCheckedIn: () => void }) {
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualToken, setManualToken] = useState("");
  const [processing, setProcessing] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const processingRef = useRef(false);
  const startingRef = useRef(false);

  const stopCamera = useCallback(() => {
    runningRef.current = false;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  }, []);

  const scanToken = useCallback(async (token: string) => {
    const trimmed = token.trim();
    if (processingRef.current) return;
    if (!trimmed || trimmed.length > 256) {
      setFeedback({ type: "invalid", message: "This QR code does not contain a valid VIBRANT registration token." });
      return;
    }
    processingRef.current = true;
    setProcessing(true); setFeedback(null); stopCamera();
    try {
      const result = await submitAttendanceToken(trimmed);
      setFeedback({ type: "success", message: result.message, participant: result.participant?.fullName, checkedInAt: result.checkedInAt });
      setManualToken("");
      onCheckedIn();
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      const message = getApiErrorMessage(error, "Attendance could not be recorded.");
      const lowerMessage = message.toLowerCase();
      const type: Feedback["type"] = status === 409 || lowerMessage.includes("already been checked in")
        ? "duplicate"
        : status === 404 || lowerMessage.includes("invalid qr") || lowerMessage.includes("invalid qr code")
          ? "invalid"
          : status === 401 || status === 403
            ? "unauthorized"
            : "error";
      setFeedback({ type, message });
      setManualToken("");
    } finally { processingRef.current = false; setProcessing(false); }
  }, [onCheckedIn, stopCamera]);

  const startCamera = async () => {
    if (startingRef.current || cameraActive) return;
    setCameraError(null); setFeedback(null);
    const detectorConstructor = (window as Window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
    if (!detectorConstructor) {
      setCameraError("QR scanning is not supported by this browser. Use the manual token field below.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera access is unavailable here. Use the manual token field below.");
      return;
    }
    startingRef.current = true; setCameraStarting(true);
    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) { stopCamera(); return; }
      video.srcObject = stream;
      await video.play();
      const detector = new detectorConstructor({ formats: ["qr_code"] });
      runningRef.current = true; setCameraActive(true);
      const scanFrame = async () => {
        if (!runningRef.current || !videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          const token = codes.find(code => typeof code.rawValue === "string" && code.rawValue.length)?.rawValue;
          if (token) { stopCamera(); void scanToken(token); return; }
        } catch {
          stopCamera();
          setCameraError("The camera could not read a QR code. Try again or enter the token manually.");
          return;
        }
        if (runningRef.current) timerRef.current = window.setTimeout(() => { void scanFrame(); }, 180);
      };
      void scanFrame();
    } catch (error) {
      stopCamera();
      const name = (error as { name?: string })?.name;
      setCameraError(name === "NotAllowedError" || name === "PermissionDeniedError"
        ? "Camera permission was denied. Allow camera access or enter the token manually."
        : name === "NotFoundError"
          ? "No camera was found on this device. Enter the token manually."
          : "Camera could not be started. Use the manual token field below.");
    } finally { startingRef.current = false; setCameraStarting(false); }
  };

  useEffect(() => () => stopCamera(), [stopCamera]);

  const submitManual = (event: FormEvent) => { event.preventDefault(); void scanToken(manualToken); };
  return <section className="attendance-scanner" aria-label="QR attendance check-in">
    <div className="scanner-heading"><span className="scanner-icon"><Camera size={16} /></span><div><h2>Quick check-in</h2><p>{enabled ? "Scan a participant QR code or enter its token." : "Check-in is available while the event is published."}</p></div>{cameraActive && <span className="camera-live"><i /> Camera active</span>}</div>
    {enabled && <div className="scanner-controls">
      <div className="scanner-camera-area">{cameraActive ? <video ref={videoRef} className="scanner-video" muted autoPlay playsInline aria-label="Camera QR scanner" /> : <div className="scanner-camera-placeholder"><CameraOff size={20} /><span>Camera preview is off</span></div>}</div>
      <div className="scanner-actions"><Button variant={cameraActive ? "secondary" : "primary"} icon={cameraActive ? <CameraOff size={14} /> : <Camera size={14} />} onClick={() => cameraActive ? stopCamera() : void startCamera()} disabled={processing || cameraStarting}>{cameraActive ? "Stop camera" : cameraStarting ? "Starting camera…" : "Start camera"}</Button>
        <form className="manual-token-form" onSubmit={submitManual}><label htmlFor="attendance-token"><KeyRound size={14} />Manual token</label><div><input id="attendance-token" type="password" value={manualToken} onChange={event => setManualToken(event.target.value)} autoComplete="off" spellCheck={false} placeholder="Enter registration token" disabled={processing} /><Button variant="secondary" type="submit" disabled={processing || !manualToken.trim()}>{processing ? "Checking…" : "Check in"}</Button></div></form>
      </div>
    </div>}
    {cameraError && <p className="scanner-message scanner-error" role="status"><AlertCircle size={14} />{cameraError}</p>}
    {!enabled && <p className="scanner-message"><LockKeyhole size={14} />Choose a published event to enable check-in.</p>}
    {feedback && <div className={`scanner-feedback feedback-${feedback.type}`} role={feedback.type === "error" || feedback.type === "unauthorized" ? "alert" : "status"}>{feedback.type === "success" ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}<div><strong>{feedback.type === "success" ? "Checked in" : feedback.type === "duplicate" ? "Already checked in" : feedback.type === "invalid" ? "Invalid QR code" : feedback.type === "unauthorized" ? "Access denied" : "Check-in failed"}</strong><p>{feedback.message}{feedback.participant ? ` · ${feedback.participant}` : ""}{feedback.checkedInAt ? ` · ${formatTime(feedback.checkedInAt)}` : ""}</p></div><button onClick={() => setFeedback(null)} aria-label="Dismiss check-in message">×</button></div>}
  </section>;
}

function formatTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(date); }
