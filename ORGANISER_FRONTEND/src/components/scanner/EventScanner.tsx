import { useState, useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BrowserQRCodeReader, IScannerControls } from "@zxing/browser";
import {
  Camera,
  CameraOff,
  Keyboard,
  RefreshCw,
  AlertCircle,
  Video,
  QrCode,
  Search,
  Clock,
  ChevronDown,
  Info,
  CheckCircle2,
  User,
  UserCheck,
} from "lucide-react";
import {
  markAttendanceCheckIn,
  lookupRegistrationForManualCheckIn,
  markManualAttendanceCheckIn,
  type ManualLookupResponse,
} from "../../api/attendanceService.ts";
import { getApiErrorMessage } from "../../api/client.ts";
import {
  validateQrToken,
  mapAttendanceSuccess,
  mapAttendanceError,
  playScanSound,
  triggerHapticFeedback,
  type MappedScanResult,
} from "../../utils/scanResultMapping.ts";
import ScanResultPanel from "./ScanResultPanel.tsx";

export type ScannerLifecycleState =
  | "IDLE"
  | "REQUESTING_CAMERA"
  | "SCANNING"
  | "PROCESSING"
  | "SUCCESS"
  | "REJECTED"
  | "CAMERA_ERROR";

interface EventScannerProps {
  selectedEventId: string;
  selectedEventName: string;
  isComboParent?: boolean;
}

export default function EventScanner({
  selectedEventId,
  selectedEventName,
  isComboParent,
}: EventScannerProps) {
  const queryClient = useQueryClient();

  // Mode tab: Scan QR vs Manual Check-in
  const [activeTab, setActiveTab] = useState<"SCAN" | "MANUAL">("SCAN");

  // Lifecycle state
  const [state, setState] = useState<ScannerLifecycleState>("IDLE");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<MappedScanResult | null>(null);

  // Session scan history (recent results drawer)
  const [recentScans, setRecentScans] = useState<MappedScanResult[]>([]);
  const [recentScansOpen, setRecentScansOpen] = useState(false);

  // Video devices
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");

  // Manual QR token fallback input state (within QR workflow)
  const [manualTokenOpen, setManualTokenOpen] = useState(false);
  const [manualToken, setManualToken] = useState("");
  const [manualTokenError, setManualTokenError] = useState<string | null>(null);

  // Registration ID search and manual check-in state
  const [regIdInput, setRegIdInput] = useState("");
  const [isSearchingRegId, setIsSearchingRegId] = useState(false);
  const [lookupResult, setLookupResult] = useState<ManualLookupResponse["data"] | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const [isSubmittingManual, setIsSubmittingManual] = useState(false);
  const [regIdNotice, setRegIdNotice] = useState<string | null>(null);

  // References to prevent duplicate in-flight processing and manage camera lifecycle
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const codeReaderRef = useRef<BrowserQRCodeReader | null>(null);
  const isProcessingRef = useRef<boolean>(false);
  const activeEventIdRef = useRef<string>(selectedEventId);

  // Synchronize active event reference
  useEffect(() => {
    activeEventIdRef.current = selectedEventId;
  }, [selectedEventId]);

  // Enumerate camera devices
  const loadVideoDevices = useCallback(async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        return;
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((d) => d.kind === "videoinput");
      setVideoDevices(videoInputs);

      // Prefer rear/environment camera on mobile
      if (videoInputs.length > 0 && !selectedDeviceId) {
        const rearCamera = videoInputs.find(
          (d) =>
            d.label.toLowerCase().includes("back") ||
            d.label.toLowerCase().includes("rear") ||
            d.label.toLowerCase().includes("environment")
        );
        setSelectedDeviceId(rearCamera ? rearCamera.deviceId : videoInputs[0].deviceId);
      }
    } catch {
      // Graceful fallback to default camera constraint
    }
  }, [selectedDeviceId]);

  // Clean up camera streams and ZXing controls
  const stopCamera = useCallback(() => {
    if (controlsRef.current) {
      try {
        controlsRef.current.stop();
      } catch {
        // Ignore stop error
      }
      controlsRef.current = null;
    }

    if (videoRef.current && videoRef.current.srcObject) {
      try {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((track) => track.stop());
        videoRef.current.srcObject = null;
      } catch {
        // Ignore stream cleanup error
      }
    }
  }, []);

  // Shared token submission handler for both camera and manual input
  const processTokenSubmission = useCallback(
    async (rawToken: string) => {
      if (isProcessingRef.current) return;
      isProcessingRef.current = true;

      // Combo Pass package parent guard: strictly block attendance submission
      if (isComboParent) {
        isProcessingRef.current = false;
        const errResult: MappedScanResult = {
          outcome: "REJECTED",
          title: "Package Not Scannable",
          message:
            "Attendance cannot be recorded against a Multi-Event Package. Please select a physical event venue from the dropdown.",
          eventName: selectedEventName,
          reasonCode: "COMBO_PARENT_NOT_VENUE",
        };
        setScanResult(errResult);
        setState("REJECTED");
        playScanSound("REJECTED");
        triggerHapticFeedback("REJECTED");
        return;
      }

      // Verify token format before dispatching network request
      const validation = validateQrToken(rawToken);
      if (!validation.isValid) {
        isProcessingRef.current = false;
        const errResult: MappedScanResult = {
          outcome: "REJECTED",
          title: "Invalid QR Code",
          message: validation.error || "The scanned QR code is malformed.",
          eventName: selectedEventName,
          reasonCode: "INVALID_QR_TOKEN",
        };
        setScanResult(errResult);
        setState("REJECTED");
        playScanSound("REJECTED");
        triggerHapticFeedback("REJECTED");
        return;
      }

      const captureEventId = activeEventIdRef.current;
      setState("PROCESSING");
      stopCamera();

      try {
        const response = await markAttendanceCheckIn({
          qrToken: rawToken.trim().toLowerCase(),
          eventId: captureEventId,
        });

        // Guard against race conditions if event was switched mid-request
        if (captureEventId !== activeEventIdRef.current) {
          isProcessingRef.current = false;
          return;
        }

        const successResult = mapAttendanceSuccess(response, selectedEventName);
        setScanResult(successResult);
        setState("SUCCESS");

        // Record in recent session history (prepend up to 10 entries)
        setRecentScans((prev) => [successResult, ...prev.slice(0, 9)]);

        // Sound and haptic confirmation
        playScanSound("SUCCESS");
        triggerHapticFeedback("SUCCESS");

        // Invalidate attendance metrics and participant list queries
        void queryClient.invalidateQueries({
          queryKey: ["attendance", captureEventId],
        });
        void queryClient.invalidateQueries({
          queryKey: ["participants", captureEventId],
        });
      } catch (err: unknown) {
        if (captureEventId !== activeEventIdRef.current) {
          isProcessingRef.current = false;
          return;
        }

        const mappedError = mapAttendanceError(err, selectedEventName);
        setScanResult(mappedError);
        setState("REJECTED");

        // Record in recent session history
        setRecentScans((prev) => [mappedError, ...prev.slice(0, 9)]);

        playScanSound(mappedError.outcome === "DUPLICATE" ? "DUPLICATE" : "REJECTED");
        triggerHapticFeedback(mappedError.outcome === "DUPLICATE" ? "DUPLICATE" : "REJECTED");
      } finally {
        isProcessingRef.current = false;
      }
    },
    [selectedEventName, stopCamera, queryClient]
  );

  // Start continuous QR scanner
  const startCamera = useCallback(async () => {
    if (!selectedEventId || isComboParent) {
      setErrorMessage("Please select a specific event venue before activating the scanner.");
      setState("CAMERA_ERROR");
      return;
    }

    stopCamera();
    setErrorMessage(null);
    setScanResult(null);
    setState("REQUESTING_CAMERA");

    try {
      if (!codeReaderRef.current) {
        codeReaderRef.current = new BrowserQRCodeReader();
      }

      await loadVideoDevices();

      if (!videoRef.current) {
        throw new Error("Video element is not mounted.");
      }

      setState("SCANNING");

      const controls = await codeReaderRef.current.decodeFromVideoDevice(
        selectedDeviceId || undefined,
        videoRef.current,
        (result) => {
          if (result && !isProcessingRef.current) {
            const text = result.getText();
            if (text) {
              void processTokenSubmission(text);
            }
          }
        }
      );

      controlsRef.current = controls;
    } catch (err: any) {
      stopCamera();
      let msg = "Could not access camera. Please ensure camera permissions are granted.";
      if (err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError") {
        msg = "Camera permission denied. Please allow camera access in browser settings to scan QR tickets.";
      } else if (err?.name === "NotFoundError" || err?.name === "DevicesNotFoundError") {
        msg = "No camera hardware detected on this device. You can use manual token entry below.";
      }
      setErrorMessage(msg);
      setState("CAMERA_ERROR");
    }
  }, [selectedEventId, isComboParent, selectedDeviceId, loadVideoDevices, stopCamera, processTokenSubmission]);

  // Reset scanner state for the next participant
  const handleScanNext = useCallback(() => {
    setScanResult(null);
    setErrorMessage(null);
    setManualToken("");
    setManualTokenError(null);
    isProcessingRef.current = false;
    setActiveTab("SCAN");
    void startCamera();
  }, [startCamera]);

  // Manual 64-char QR token submission
  const handleManualTokenSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setManualTokenError(null);

    const validation = validateQrToken(manualToken);
    if (!validation.isValid) {
      setManualTokenError(validation.error || "Invalid token format.");
      return;
    }

    void processTokenSubmission(manualToken);
  };

  // Manual Registration ID search handler (Phase 04B backend integration)
  // Note: requires backend integration (scheduled for Phase 04)
  const handleRegIdSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegIdNotice(null);
    setLookupError(null);
    setLookupResult(null);
    setIdentityConfirmed(false);

    const cleanId = regIdInput.trim();
    if (!cleanId) {
      setLookupError("Please enter a Registration ID.");
      return;
    }

    if (!/^[a-f0-9]{24}$/i.test(cleanId)) {
      setLookupError("Registration ID must be a valid 24-character hexadecimal ID (as shown on the participant's ticket).");
      return;
    }

    if (!selectedEventId || isComboParent) {
      setLookupError("Please select a physical event venue before searching.");
      return;
    }

    setIsSearchingRegId(true);
    try {
      const res = await lookupRegistrationForManualCheckIn({
        registrationId: cleanId,
        eventId: selectedEventId,
      });

      if (res.success && res.data) {
        setLookupResult(res.data);
      } else {
        setLookupError("Registration lookup did not return participant data.");
      }
    } catch (err: unknown) {
      const msg = getApiErrorMessage(err, "Registration not found or not eligible for this event.");
      setLookupError(msg);
    } finally {
      setIsSearchingRegId(false);
    }
  };

  // Explicit confirmation check-in handler for manual workflow
  const handleConfirmManualCheckIn = async () => {
    if (!lookupResult || !identityConfirmed || isSubmittingManual) return;
    if (!selectedEventId || isComboParent) return;

    setIsSubmittingManual(true);
    setState("PROCESSING");

    try {
      const response = await markManualAttendanceCheckIn({
        registrationId: lookupResult.registrationId,
        eventId: selectedEventId,
        identityConfirmed: true,
      });

      const successResult = mapAttendanceSuccess(response, selectedEventName);
      setScanResult(successResult);
      setState("SUCCESS");

      // Record in recent session history
      setRecentScans((prev) => [successResult, ...prev.slice(0, 9)]);

      playScanSound("SUCCESS");
      triggerHapticFeedback("SUCCESS");

      void queryClient.invalidateQueries({
        queryKey: ["attendance", selectedEventId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["participants", selectedEventId],
      });
    } catch (err: unknown) {
      const mappedError = mapAttendanceError(err, selectedEventName);
      setScanResult(mappedError);
      setState("REJECTED");
      setRecentScans((prev) => [mappedError, ...prev.slice(0, 9)]);
      playScanSound(mappedError.outcome === "DUPLICATE" ? "DUPLICATE" : "REJECTED");
      triggerHapticFeedback(mappedError.outcome === "DUPLICATE" ? "DUPLICATE" : "REJECTED");
    } finally {
      setIsSubmittingManual(false);
    }
  };

  // Next participant handler for manual check-in workflow: preserves manual tab and selected event
  const handleManualScanNext = useCallback(() => {
    setScanResult(null);
    setErrorMessage(null);
    setManualToken("");
    setManualTokenError(null);
    setRegIdInput("");
    setLookupResult(null);
    setLookupError(null);
    setIdentityConfirmed(false);
    isProcessingRef.current = false;
    setState("IDLE");
  }, []);

  // Event change listener: stop scanner and clear results to prevent cross-event contamination
  useEffect(() => {
    stopCamera();
    setScanResult(null);
    setErrorMessage(null);
    setRecentScans([]);
    setManualToken("");
    setManualTokenError(null);
    setRegIdInput("");
    setLookupResult(null);
    setLookupError(null);
    setIdentityConfirmed(false);
    isProcessingRef.current = false;
    setState("IDLE");
  }, [selectedEventId, stopCamera]);

  // Combo parent safeguard: stop camera immediately if parent package is selected
  useEffect(() => {
    if (isComboParent) {
      stopCamera();
      setScanResult(null);
      setErrorMessage("Multi-Event Packages are not scanning venues.");
      isProcessingRef.current = false;
      setState("IDLE");
    }
  }, [isComboParent, stopCamera]);

  // Component unmount cleanup
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  return (
    <div className="scanner-container">
      {/* 1. Segmented Control: Scan QR vs Manual Check-in (Matching Visual Reference) */}
      <div className="scanner-mode-tabs" role="tablist" aria-label="Check-in Mode">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "SCAN"}
          className={`scanner-tab-btn ${activeTab === "SCAN" ? "is-active" : ""}`}
          onClick={() => {
            setActiveTab("SCAN");
            if (state === "IDLE" && !scanResult) {
              void startCamera();
            }
          }}
        >
          <QrCode size={16} />
          <span>Scan QR</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "MANUAL"}
          className={`scanner-tab-btn ${activeTab === "MANUAL" ? "is-active" : ""}`}
          onClick={() => {
            stopCamera();
            setActiveTab("MANUAL");
          }}
        >
          <Search size={16} />
          <span>Manual Check-in</span>
        </button>
      </div>

      {/* 2. SCAN QR TAB CONTENT */}
      {activeTab === "SCAN" && (
        <div className="scanner-card">
          {/* If scan result exists, render the redesigned ScanResultPanel */}
          {scanResult && (state === "SUCCESS" || state === "REJECTED") ? (
            <ScanResultPanel
              result={scanResult}
              onReset={handleScanNext}
              selectedEventName={selectedEventName}
            />
          ) : (
            <>
              {/* Modern Camera Viewport */}
              <div className="viewfinder-wrapper">
                <video
                  ref={videoRef}
                  className="viewfinder-video"
                  playsInline
                  muted
                  autoPlay
                  aria-label="QR Code Camera Viewfinder"
                />

                {state === "SCANNING" && (
                  <div className="viewfinder-overlay">
                    <div className="viewfinder-corners">
                      <div className="corner corner-tl" />
                      <div className="corner corner-tr" />
                      <div className="corner corner-bl" />
                      <div className="corner corner-br" />
                      {/* Stylized Center QR Guide Icon */}
                      <QrCode size={52} className="viewfinder-center-guide" />
                    </div>
                    <div className="viewfinder-laser" />
                  </div>
                )}

                {state === "IDLE" && (
                  <div className="viewfinder-placeholder">
                    <QrCode size={54} color="var(--primary)" style={{ opacity: 0.85, marginBottom: "14px" }} />
                    <h3 style={{ fontSize: "17px", fontWeight: 700, color: "#FFFFFF", marginBottom: "6px" }}>
                      Camera Ready
                    </h3>
                    <p style={{ fontSize: "13px", color: "#94A3B8", maxWidth: "320px", margin: "0 auto 18px", lineHeight: 1.4 }}>
                      Tap Activate Camera to start scanning attendee QR tickets.
                    </p>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void startCamera()}
                      disabled={!selectedEventId || isComboParent}
                      style={{ padding: "10px 22px", fontSize: "14px", fontWeight: 700 }}
                    >
                      <Camera size={16} />
                      <span>Activate Camera</span>
                    </button>
                  </div>
                )}

                {state === "REQUESTING_CAMERA" && (
                  <div className="viewfinder-placeholder">
                    <RefreshCw size={36} className="is-spinning" style={{ color: "var(--primary)", margin: "0 auto 12px" }} />
                    <p style={{ fontSize: "14px", color: "#FFFFFF", fontWeight: 600 }}>
                      Requesting camera access…
                    </p>
                  </div>
                )}

                {state === "PROCESSING" && (
                  <div className="viewfinder-placeholder">
                    <RefreshCw size={40} className="is-spinning" style={{ color: "var(--primary)", margin: "0 auto 12px" }} />
                    <h3 style={{ fontSize: "16px", color: "#FFFFFF", marginBottom: "4px" }}>
                      Verifying Attendance…
                    </h3>
                    <p style={{ fontSize: "12px", color: "#94A3B8" }}>
                      Confirming ticket eligibility with server
                    </p>
                  </div>
                )}

                {state === "CAMERA_ERROR" && (
                  <div className="viewfinder-placeholder" style={{ padding: "20px" }}>
                    <AlertCircle size={40} color="var(--error)" style={{ margin: "0 auto 12px" }} />
                    <h3 style={{ fontSize: "15px", color: "#FFFFFF", marginBottom: "8px" }}>
                      Camera Unavailable
                    </h3>
                    <p style={{ fontSize: "13px", color: "#94A3B8", maxWidth: "360px", margin: "0 auto 16px" }}>
                      {errorMessage || "Unable to access camera feed."}
                    </p>
                    <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => void startCamera()}
                      >
                        <RefreshCw size={14} />
                        <span>Retry Camera</span>
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => setManualTokenOpen(true)}
                      >
                        <Keyboard size={14} />
                        <span>Manual Token</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Viewfinder Instructions & Camera Ready Status Pill */}
              <div className="viewfinder-bottom-banner">
                <span className="viewfinder-instruction">
                  Align the QR code within the frame
                </span>
                <div className="viewfinder-status-pill">
                  <span className="status-dot-green" />
                  <span>
                    {state === "SCANNING"
                      ? "Scanning Active"
                      : state === "PROCESSING"
                      ? "Verifying..."
                      : "Camera Ready"}
                  </span>
                </div>
              </div>

              {/* Controls Bar: Pause / Resume / Device Switcher */}
              <div className="scanner-controls-bar">
                {state === "SCANNING" ? (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={stopCamera}
                    style={{ width: "100%", justifyContent: "center" }}
                  >
                    <CameraOff size={15} />
                    <span>Pause Scanner</span>
                  </button>
                ) : state !== "PROCESSING" && state !== "CAMERA_ERROR" ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void startCamera()}
                    disabled={!selectedEventId || isComboParent}
                    style={{ width: "100%", justifyContent: "center" }}
                  >
                    <Camera size={15} />
                    <span>{state === "IDLE" ? "Start Scanner" : "Resume Scanner"}</span>
                  </button>
                ) : null}

                {/* Camera Switcher if multiple video devices exist */}
                {videoDevices.length > 1 && (
                  <div style={{ marginTop: "6px" }}>
                    <label
                      htmlFor="camera-select"
                      style={{
                        fontSize: "12px",
                        color: "var(--secondary)",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        marginBottom: "4px",
                      }}
                    >
                      <Video size={13} />
                      <span>Switch Camera:</span>
                    </label>
                    <select
                      id="camera-select"
                      className="search-input"
                      value={selectedDeviceId}
                      onChange={(e) => {
                        setSelectedDeviceId(e.target.value);
                        if (state === "SCANNING") {
                          stopCamera();
                          setTimeout(() => void startCamera(), 100);
                        }
                      }}
                      style={{ width: "100%", fontSize: "13px", padding: "8px 12px" }}
                    >
                      {videoDevices.map((dev, idx) => (
                        <option key={dev.deviceId || idx} value={dev.deviceId}>
                          {dev.label || `Camera ${idx + 1}`}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* 3. MANUAL CHECK-IN TAB CONTENT (Matching Visual Reference Screen 2) */}
      {activeTab === "MANUAL" && (
        <div className="search-checkin-card">
          {scanResult && (state === "SUCCESS" || state === "REJECTED") ? (
            <ScanResultPanel
              result={scanResult}
              onReset={handleManualScanNext}
              selectedEventName={selectedEventName}
            />
          ) : (
            <>
              <div className="search-card-header">
                <div className="search-icon-box">
                  <Search size={22} />
                </div>
                <div className="search-header-text">
                  <h3>Registration ID Search</h3>
                  <p>Enter the participant's Registration ID to find and check-in.</p>
                </div>
              </div>

              {/* Registration ID Form */}
              <form onSubmit={handleRegIdSearchSubmit}>
                <div className="search-input-group">
                  <input
                    type="text"
                    className="search-id-input"
                    placeholder="e.g. 507f1f77bcf86cd799439011"
                    value={regIdInput}
                    onChange={(e) => {
                      setRegIdInput(e.target.value);
                      setLookupError(null);
                      setRegIdNotice(null);
                    }}
                    disabled={isSearchingRegId || isSubmittingManual}
                    aria-label="Participant Registration ID"
                  />
                  <button
                    type="submit"
                    className="search-submit-btn"
                    aria-label="Search Registration ID"
                    disabled={isSearchingRegId || !regIdInput.trim() || isSubmittingManual}
                  >
                    {isSearchingRegId ? <RefreshCw size={16} className="is-spinning" /> : <Search size={16} />}
                  </button>
                </div>
              </form>

              {/* Helpful Subtitle Notice */}
              <div className="search-info-callout">
                <Info size={15} color="var(--primary)" style={{ flexShrink: 0 }} />
                <span>Enter the 24-character Registration ID from the participant's ticket or receipt.</span>
              </div>

              {/* Notice note for Phase 04 integration compatibility (requires backend integration (scheduled for Phase 04)) */}
              {regIdNotice && (
                <div className="search-status-notice" role="alert">
                  <strong>Notice:</strong> {regIdNotice}
                </div>
              )}

              {/* Inline Error Notice */}
              {lookupError && (
                <div
                  className="search-status-notice"
                  role="alert"
                  style={{
                    marginTop: "12px",
                    background: "#FEF2F2",
                    borderColor: "#FECACA",
                    color: "#991B1B",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "8px",
                  }}
                >
                  <AlertCircle size={16} style={{ flexShrink: 0, marginTop: "2px" }} />
                  <div>
                    <strong>Lookup Failed:</strong> {lookupError}
                  </div>
                </div>
              )}

              {/* Participant Identity Verification Card (Screen 2) */}
              {lookupResult && (
                <div
                  className="participant-verify-card"
                  style={{
                    background: "#FFFFFF",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-md)",
                    padding: "20px",
                    marginTop: "16px",
                    boxShadow: "var(--shadow-sm)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px", flexWrap: "wrap", gap: "8px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <div
                        style={{
                          width: "38px",
                          height: "38px",
                          borderRadius: "50%",
                          background: "var(--primary-light)",
                          color: "var(--primary)",
                          display: "grid",
                          placeItems: "center",
                          fontWeight: 700,
                        }}
                      >
                        <User size={20} />
                      </div>
                      <div>
                        <h4 style={{ margin: 0, fontSize: "16px", fontWeight: 800, color: "var(--navy)" }}>
                          {lookupResult.participant.fullName}
                        </h4>
                        <span style={{ fontSize: "11px", color: "var(--secondary)", fontFamily: "monospace" }}>
                          ID: {lookupResult.registrationId}
                        </span>
                      </div>
                    </div>

                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 700,
                        padding: "4px 10px",
                        borderRadius: "var(--radius-pill)",
                        background: lookupResult.eligibility.canCheckIn ? "#DCFCE7" : "#FEE2E2",
                        color: lookupResult.eligibility.canCheckIn ? "#15803D" : "#B91C1C",
                      }}
                    >
                      {lookupResult.eligibility.canCheckIn ? "✔ Eligible" : lookupResult.eligibility.reasonCode}
                    </span>
                  </div>

                  {/* Attributes Grid */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                      gap: "10px",
                      padding: "12px",
                      background: "#F8FAFC",
                      borderRadius: "var(--radius-sm)",
                      fontSize: "12px",
                      marginBottom: "16px",
                    }}
                  >
                    <div>
                      <span style={{ display: "block", color: "var(--secondary)", fontSize: "10px", textTransform: "uppercase" }}>College</span>
                      <strong style={{ color: "var(--navy)" }}>{lookupResult.participant.collegeName || "Not specified"}</strong>
                    </div>
                    <div>
                      <span style={{ display: "block", color: "var(--secondary)", fontSize: "10px", textTransform: "uppercase" }}>Department</span>
                      <strong style={{ color: "var(--navy)" }}>{lookupResult.participant.department || "Not specified"}</strong>
                    </div>
                    <div>
                      <span style={{ display: "block", color: "var(--secondary)", fontSize: "10px", textTransform: "uppercase" }}>Roll Number</span>
                      <strong style={{ color: "var(--navy)" }}>{lookupResult.participant.rollNumber || "Not specified"}</strong>
                    </div>
                    <div>
                      <span style={{ display: "block", color: "var(--secondary)", fontSize: "10px", textTransform: "uppercase" }}>Mobile</span>
                      <strong style={{ color: "var(--navy)" }}>{lookupResult.participant.maskedMobile || "Not specified"}</strong>
                    </div>
                    <div>
                      <span style={{ display: "block", color: "var(--secondary)", fontSize: "10px", textTransform: "uppercase" }}>Type</span>
                      <strong style={{ color: "var(--navy)" }}>
                        {lookupResult.registration.registrationType}
                        {lookupResult.registration.teamName ? ` (${lookupResult.registration.teamName})` : ""}
                      </strong>
                    </div>
                    <div>
                      <span style={{ display: "block", color: "var(--secondary)", fontSize: "10px", textTransform: "uppercase" }}>Pass / Ticket</span>
                      <strong style={{ color: "var(--navy)" }}>
                        {lookupResult.registration.cohortType === "COMBO"
                          ? `Combo Pass (${lookupResult.registration.comboName || "Multi-Event"})`
                          : "Direct Ticket"}
                      </strong>
                    </div>
                  </div>

                  {/* Status & Eligibility Banner */}
                  {lookupResult.eligibility.canCheckIn ? (
                    <div style={{ marginBottom: "16px" }}>
                      <div
                        style={{
                          background: "#F0FDF4",
                          border: "1px solid #BBF7D0",
                          borderRadius: "var(--radius-sm)",
                          padding: "10px 14px",
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          color: "#166534",
                          fontSize: "12px",
                          fontWeight: 600,
                        }}
                      >
                        <CheckCircle2 size={16} />
                        <span>Eligible for Check-in at {selectedEventName}. Payment is {lookupResult.eligibility.paymentStatus}.</span>
                      </div>

                      {/* Explicit Organiser Identity Confirmation Checkbox */}
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          margin: "14px 0",
                          padding: "10px 12px",
                          background: identityConfirmed ? "var(--primary-light)" : "#FFFFFF",
                          border: identityConfirmed ? "1px solid var(--primary)" : "1px solid var(--border)",
                          borderRadius: "var(--radius-sm)",
                          cursor: "pointer",
                          fontSize: "13px",
                          fontWeight: 600,
                          color: "var(--navy)",
                          transition: "all 0.15s ease",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={identityConfirmed}
                          onChange={(e) => setIdentityConfirmed(e.target.checked)}
                          style={{ width: "16px", height: "16px", accentColor: "var(--primary)", cursor: "pointer" }}
                        />
                        <span>I confirm I have physically verified the participant's photo ID and identity at the gate.</span>
                      </label>

                      {/* Confirm Check-in Button */}
                      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={!identityConfirmed || isSubmittingManual}
                          onClick={handleConfirmManualCheckIn}
                          style={{ flex: 1, minWidth: "180px", padding: "12px" }}
                        >
                          {isSubmittingManual ? (
                            <>
                              <RefreshCw size={14} className="is-spinning" />
                              <span>Admitting Participant…</span>
                            </>
                          ) : (
                            <>
                              <UserCheck size={16} />
                              <span>Confirm Check-in & Admit</span>
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => {
                            setLookupResult(null);
                            setIdentityConfirmed(false);
                          }}
                          disabled={isSubmittingManual}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div
                        style={{
                          background: lookupResult.eligibility.alreadyCheckedIn ? "#FFFBEB" : "#FEF2F2",
                          border: lookupResult.eligibility.alreadyCheckedIn ? "1px solid #FDE68A" : "1px solid #FECACA",
                          borderRadius: "var(--radius-sm)",
                          padding: "12px 14px",
                          color: lookupResult.eligibility.alreadyCheckedIn ? "#92400E" : "#991B1B",
                          fontSize: "13px",
                          marginBottom: "14px",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 700, marginBottom: "4px" }}>
                          {lookupResult.eligibility.alreadyCheckedIn ? <Clock size={16} /> : <AlertCircle size={16} />}
                          <span>{lookupResult.eligibility.alreadyCheckedIn ? "Already Checked In" : "Admission Not Allowed"}</span>
                        </div>
                        <p style={{ margin: 0, fontSize: "12px", lineHeight: 1.4 }}>
                          {lookupResult.eligibility.message}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => {
                          setLookupResult(null);
                          setIdentityConfirmed(false);
                        }}
                        style={{ width: "100%" }}
                      >
                        Search Another Participant
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Operational 64-character QR Token Input Form Fallback */}
              <div
                style={{
                  marginTop: "16px",
                  padding: "16px",
                  background: "#F8FAFC",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                  <Keyboard size={16} color="var(--primary)" />
                  <strong style={{ fontSize: "13px", color: "var(--navy)" }}>
                    Active Token Check-in Fallback:
                  </strong>
                </div>
                <p style={{ fontSize: "12px", color: "var(--secondary)", marginBottom: "12px", lineHeight: 1.4 }}>
                  Enter the participant's 64-character hexadecimal ticket token below for immediate attendance check-in:
                </p>

                <form onSubmit={handleManualTokenSubmit}>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <input
                      type="text"
                      className="search-id-input"
                      placeholder="Paste 64-character hex token…"
                      value={manualToken}
                      onChange={(e) => {
                        setManualToken(e.target.value);
                        setManualTokenError(null);
                      }}
                      disabled={state === "PROCESSING"}
                      style={{ flex: 1, minWidth: "220px", fontSize: "12px" }}
                      maxLength={64}
                      required
                    />
                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={state === "PROCESSING" || !manualToken.trim() || isComboParent}
                      style={{ minWidth: "120px" }}
                    >
                      {state === "PROCESSING" ? (
                        <>
                          <RefreshCw size={14} className="is-spinning" />
                          <span>Verifying…</span>
                        </>
                      ) : (
                        <span>Submit</span>
                      )}
                    </button>
                  </div>

                  {manualTokenError && (
                    <div
                      style={{
                        fontSize: "12px",
                        color: "var(--error)",
                        marginTop: "8px",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                      role="alert"
                    >
                      <AlertCircle size={14} />
                      <span>{manualTokenError}</span>
                    </div>
                  )}
                </form>
              </div>
            </>
          )}
        </div>
      )}

      {/* 4. Manual Token Input Accordion (Available within QR workflow) */}
      {activeTab === "SCAN" && !scanResult && (
        <div className="manual-entry-card">
          <button
            type="button"
            className="manual-entry-toggle"
            onClick={() => setManualTokenOpen((prev) => !prev)}
            aria-expanded={manualTokenOpen}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Keyboard size={16} />
              <span style={{ fontWeight: 700, fontSize: "13px" }}>Hardware Scanner / Manual QR Token</span>
            </div>
            <span style={{ fontSize: "12px", color: "var(--primary)", fontWeight: 600 }}>
              {manualTokenOpen ? "Hide" : "Enter Token"}
            </span>
          </button>

          {manualTokenOpen && (
            <form onSubmit={handleManualTokenSubmit} style={{ marginTop: "14px" }}>
              <p style={{ fontSize: "12px", color: "var(--secondary)", marginBottom: "10px" }}>
                Use this fallback if camera access is restricted or physical USB/Bluetooth 2D barcode readers are used.
              </p>

              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <input
                  type="text"
                  className="search-id-input"
                  placeholder="Paste or type 64-character hex token…"
                  value={manualToken}
                  onChange={(e) => {
                    setManualToken(e.target.value);
                    setManualTokenError(null);
                  }}
                  disabled={state === "PROCESSING"}
                  style={{ flex: 1, minWidth: "200px", fontSize: "12px" }}
                  maxLength={64}
                  required
                />
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={state === "PROCESSING" || !manualToken.trim() || isComboParent}
                >
                  {state === "PROCESSING" ? "Verifying…" : "Submit"}
                </button>
              </div>

              {manualTokenError && (
                <div
                  style={{
                    fontSize: "12px",
                    color: "var(--error)",
                    marginTop: "8px",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                  role="alert"
                >
                  <AlertCircle size={14} />
                  <span>{manualTokenError}</span>
                </div>
              )}
            </form>
          )}
        </div>
      )}

      {/* 5. Recent Scan Results Drawer (Matching Visual Reference Screens 1, 2, 3) */}
      <div className="recent-scans-card">
        <button
          type="button"
          className="recent-scans-toggle"
          onClick={() => setRecentScansOpen((prev) => !prev)}
          aria-expanded={recentScansOpen}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Clock size={16} color="var(--primary)" />
            <span>Recent Scan Results</span>
            {recentScans.length > 0 && (
              <span className="recent-scans-count-badge">{recentScans.length}</span>
            )}
          </div>
          <ChevronDown
            size={16}
            color="var(--secondary)"
            style={{
              transform: recentScansOpen ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.2s ease",
            }}
          />
        </button>

        {recentScansOpen && (
          <div className="recent-scans-content">
            {recentScans.length === 0 ? (
              <p className="recent-scans-empty">No attendee check-ins recorded in this session yet.</p>
            ) : (
              <div className="recent-scans-list">
                {recentScans.map((scan, idx) => (
                  <div key={idx} className="recent-scan-item">
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span
                        style={{
                          width: "8px",
                          height: "8px",
                          borderRadius: "50%",
                          background:
                            scan.outcome === "SUCCESS"
                              ? "var(--success)"
                              : scan.outcome === "DUPLICATE"
                              ? "var(--warning)"
                              : "var(--error)",
                        }}
                      />
                      <div>
                        <strong style={{ display: "block", color: "var(--navy)" }}>
                          {scan.participantName || "Attendee"}
                        </strong>
                        <span style={{ fontSize: "11px", color: "var(--secondary)" }}>
                          {scan.registrationId || scan.eventName || selectedEventName}
                        </span>
                      </div>
                    </div>
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 700,
                        color:
                          scan.outcome === "SUCCESS"
                            ? "var(--success)"
                            : scan.outcome === "DUPLICATE"
                            ? "var(--warning)"
                            : "var(--error)",
                      }}
                    >
                      {scan.outcome === "SUCCESS" ? "Checked In" : scan.outcome}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
