import { useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import type { PaymentDecision, PaymentStatus } from "../../api/payments";
import Button from "../ui/Button";
import { useAccessibleDialog } from "../../hooks/useAccessibleDialog";
import PaymentStatusBadge from "./PaymentStatusBadge";

export interface PaymentActionRecordInfo {
  id: string;
  type: "individual" | "team";
  title: string;
  subtitle: string;
  eventName?: string;
  currentStatus: PaymentStatus | string;
}

interface PaymentActionDialogProps {
  decision: PaymentDecision;
  record: PaymentActionRecordInfo;
  working: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (reason?: string) => void;
}

export default function PaymentActionDialog({
  decision,
  record,
  working,
  error,
  onCancel,
  onConfirm,
}: PaymentActionDialogProps) {
  const [reason, setReason] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const dialogRef = useAccessibleDialog(onCancel, working);

  const isReject = decision === "REJECTED";
  const isVerify = decision === "VERIFIED";
  const isPending = decision === "PENDING";
  const wasRejected = record.currentStatus === "REJECTED";

  const getTitle = () => {
    if (isReject) return "Reject Payment";
    if (isVerify) return "Verify Payment";
    return "Mark Payment as Pending";
  };

  const getConfirmLabel = () => {
    if (working) {
      if (isReject) return "Rejecting…";
      if (isVerify) return "Verifying…";
      return "Updating…";
    }
    if (isReject) return "Confirm Rejection";
    if (isVerify) return "Verify Payment";
    return "Mark as Pending";
  };

  const getConfirmButtonClass = () => {
    if (isReject) return "button-danger";
    if (isVerify) return "payment-verify-button";
    return "payment-pending-button";
  };

  const getIcon = () => {
    if (isReject) return <AlertCircle size={20} className="tone-danger" />;
    if (isVerify) return <CheckCircle2 size={20} className="tone-success" />;
    return <RefreshCw size={20} className="tone-warning" />;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (working) return;

    const trimmed = reason.trim();
    if (isReject) {
      if (!trimmed) {
        setValidationError("A reason is required when rejecting a payment.");
        return;
      }
    }

    setValidationError(null);
    onConfirm(trimmed || undefined);
  };

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget && !working) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        className="confirm-dialog payment-action-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-action-title"
        aria-describedby="payment-action-description"
      >
        <div className="confirm-icon">{getIcon()}</div>
        <h2 id="payment-action-title">{getTitle()}</h2>

        <p id="payment-action-description" className="payment-confirm-note">
          {isReject &&
            `You are rejecting this ${record.type === "team" ? "shared team payment" : "individual payment"}. Rejection releases the participant capacity for this event.`}
          {isVerify &&
            `You are verifying this ${record.type === "team" ? "shared team payment" : "individual payment"}. ${
              wasRejected ? "This will re-acquire event capacity." : ""
            }`}
          {isPending &&
            `You are returning this ${record.type === "team" ? "shared team payment" : "individual payment"} to pending status. ${
              wasRejected ? "This will re-acquire event capacity." : ""
            }`}
        </p>

        <div className="payment-dialog-context">
          <div className="payment-dialog-context-row">
            <span>{record.type === "team" ? "Team Name" : "Participant"}:</span>
            <strong>{record.title}</strong>
          </div>
          <div className="payment-dialog-context-row">
            <span>{record.type === "team" ? "Team ID" : "Registration ID"}:</span>
            <code>{record.id}</code>
          </div>
          {record.eventName && (
            <div className="payment-dialog-context-row">
              <span>Event:</span>
              <strong>{record.eventName}</strong>
            </div>
          )}
          <div className="payment-dialog-context-row">
            <span>Current Status:</span>
            <PaymentStatusBadge status={record.currentStatus} />
          </div>
        </div>

        {error && (
          <div className="payment-notice is-error" role="alert">
            <AlertTriangle size={15} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="payment-dialog-field">
            <label htmlFor="payment-decision-reason">
              {isReject ? "Reason for rejection" : "Note / Reason"}
              {isReject ? (
                <span className="required-mark" aria-hidden="true">*</span>
              ) : (
                <span className="optional-mark"> (optional)</span>
              )}
            </label>
            <textarea
              id="payment-decision-reason"
              value={reason}
              onChange={event => {
                setReason(event.target.value);
                if (validationError && event.target.value.trim()) {
                  setValidationError(null);
                }
              }}
              placeholder={
                isReject
                  ? "Provide a clear reason for rejecting this payment (e.g., payment proof does not match registration amount)..."
                  : "Optional note or reference for this action..."
              }
              className={validationError ? "has-error" : ""}
              disabled={working}
              aria-required={isReject}
              aria-invalid={Boolean(validationError)}
              aria-describedby={validationError ? "payment-reason-error" : undefined}
            />
            {validationError && (
              <div id="payment-reason-error" className="payment-dialog-error" role="alert">
                <AlertCircle size={13} />
                <span>{validationError}</span>
              </div>
            )}
          </div>

          <div className="dialog-actions">
            <Button variant="secondary" type="button" onClick={onCancel} disabled={working}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              className={getConfirmButtonClass()}
              disabled={working}
            >
              {getConfirmLabel()}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
