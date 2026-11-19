import { FileBadge, ShieldAlert, X, CreditCard, CircleDollarSign, ShieldCheck, UserRound } from "lucide-react";
import type { PaymentDecision, PaymentHistoryEntry } from "../../api/payments";
import Button from "../ui/Button";
import { useAccessibleDialog } from "../../hooks/useAccessibleDialog";
import PaymentStatusBadge, { formatStatus } from "./PaymentStatusBadge";
import PaymentHistoryTimeline from "./PaymentHistoryTimeline";

const currencyFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export interface DrawerPaymentRecord {
  id: string;
  type: "individual" | "team";
  title: string;
  subtitle: string;
  email?: string;
  mobile?: string;
  college?: string;
  department?: string;
  memberCount?: number;
  event?: { name?: string; category?: string; startDate?: string; registrationFee?: number } | null;
  method: string;
  status: string;
  proofUrl?: string | null;
  cashReceiverName?: string | null;
  expectedAmount?: number | null;
  receivedAmount?: number | null;
  currency?: string | null;
  verifiedBy?: string | { _id?: string; name?: string; email?: string } | null;
  verifiedAt?: string | null;
  createdAt?: string;
  teamStatus?: string;
  history?: PaymentHistoryEntry[];
}

interface PaymentDetailsModalProps {
  record: DrawerPaymentRecord;
  disabled?: boolean;
  onClose: () => void;
  onPreview: (url: string) => void;
  onAction: (decision: PaymentDecision) => void;
}

export default function PaymentDetailsModal({
  record,
  disabled = false,
  onClose,
  onPreview,
  onAction,
}: PaymentDetailsModalProps) {
  const dialogRef = useAccessibleDialog(onClose, disabled);
  const proof = record.proofUrl && isSafeImageUrl(record.proofUrl) ? record.proofUrl : null;

  const isCancelled = record.type === "team" ? record.teamStatus === "CANCELLED" : false;
  const isNotRequired = record.status === "NOT_REQUIRED";
  const canModify = !isCancelled && !isNotRequired;

  const currentStatus = (record.status || "").toUpperCase();

  const effectiveExpected =
    record.expectedAmount ?? record.event?.registrationFee ?? null;
  const effectiveReceived =
    record.receivedAmount ??
    (record.status === "VERIFIED"
      ? (record.method === "CASH"
          ? (record.expectedAmount ?? record.event?.registrationFee ?? null)
          : record.expectedAmount)
      : null);

  const verifierText = () => {
    if (!record.verifiedBy) return record.status === "VERIFIED" ? "Verified" : "Not verified";
    if (typeof record.verifiedBy === "object") {
      return `${record.verifiedBy.name || "Admin"}${record.verifiedBy.email ? ` (${record.verifiedBy.email})` : ""}`;
    }
    return String(record.verifiedBy);
  };

  const formatMoney = (val?: number | null) => {
    if (val === undefined || val === null) return "Not recorded";
    return currencyFormatter.format(val);
  };

  return (
    <div
      className="payment-details-backdrop"
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget && !disabled) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="payment-details-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-modal-title"
      >
        <header className="payment-modal-header">
          <div>
            <p className="payment-modal-eyebrow">
              {record.type === "team" ? "SHARED TEAM PAYMENT" : "INDIVIDUAL PAYMENT"}
            </p>
            <h2 id="payment-modal-title">{record.title}</h2>
            <small>{record.subtitle}</small>
          </div>
          <button
            className="payment-close"
            onClick={onClose}
            disabled={disabled}
            aria-label="Close payment details"
          >
            <X size={18} />
          </button>
        </header>

        <div className="payment-modal-body">
          {/* Section: Financial & Payment Details */}
          <section className="payment-review-section">
            <div className="payment-section-title">
              <CreditCard size={15} />
              <h3>Financial & Payment Details</h3>
            </div>

            <div className="payment-financial-card">
              <div className="payment-financial-grid">
                <div className="payment-financial-item">
                  <span>Expected Amount</span>
                  <strong className={effectiveExpected == null ? "is-unrecorded" : ""}>
                    {formatMoney(effectiveExpected)}
                  </strong>
                </div>
                <div className="payment-financial-item">
                  <span>Received Amount</span>
                  <strong className={effectiveReceived == null ? "is-unrecorded" : "is-verified-amount"}>
                    {formatMoney(effectiveReceived)}
                  </strong>
                </div>
                <div className="payment-financial-item">
                  <span>Payment Method</span>
                  <span className="payment-method-badge">{formatStatus(record.method)}</span>
                </div>
                <div className="payment-financial-item">
                  <span>Payment Status</span>
                  <PaymentStatusBadge status={record.status} />
                </div>
              </div>

              {record.method === "CASH" && (
                <div className="payment-receiver-callout">
                  <CircleDollarSign size={15} />
                  <div>
                    <small>Recorded Cash Receiver</small>
                    <strong>{record.cashReceiverName ? record.cashReceiverName : "Not recorded"}</strong>
                    <span style={{ display: "block", fontSize: "11px", color: "#234968", marginTop: "2px" }}>
                      Cash received: {formatMoney(effectiveReceived ?? effectiveExpected)} (Event registration fee)
                    </span>
                  </div>
                </div>
              )}

              <div className="payment-verifier-row">
                <div className="payment-verifier-info">
                  <ShieldCheck size={14} />
                  <span>
                    <strong>Verified By: </strong>
                    {verifierText()}
                  </span>
                </div>
                {record.verifiedAt && (
                  <span className="payment-verifier-date">
                    {formatDate(record.verifiedAt)}
                  </span>
                )}
              </div>
            </div>

            <div className="payment-review-details-sub">
              <ReviewDetail label={record.type === "team" ? "Team ID" : "Registration ID"}>
                <code className="payment-id-code">{record.id}</code>
              </ReviewDetail>
              <ReviewDetail label="Submitted Date" value={formatDate(record.createdAt)} />
              {record.type === "team" && (
                <>
                  <ReviewDetail label="Team members" value={String(record.memberCount ?? "—")} />
                  <ReviewDetail
                    label="Team status"
                    value={formatStatus(record.teamStatus || "REGISTERED")}
                  />
                </>
              )}
            </div>
          </section>

          {/* Section: Participant or Team Leader */}
          {record.type === "individual" ? (
            <section className="payment-review-section">
              <div className="payment-section-title">
                <UserRound size={15} />
                <h3>Participant Information</h3>
              </div>
              <ReviewDetail label="Full Name" value={record.title} />
              <ReviewDetail label="Email" value={record.email} />
              <ReviewDetail label="Mobile" value={record.mobile} />
              <ReviewDetail label="College" value={record.college} />
              <ReviewDetail label="Department" value={record.department} />
            </section>
          ) : (
            <section className="payment-review-section">
              <div className="payment-section-title">
                <UserRound size={15} />
                <h3>Team Leader & Members</h3>
              </div>
              <ReviewDetail
                label="Leader Name"
                value={record.subtitle ? record.subtitle.split(" · ")[0] : undefined}
              />
              <ReviewDetail label="Leader Email" value={record.email} />
              <ReviewDetail
                label="Team Status"
                value={formatStatus(record.teamStatus || "UNKNOWN")}
              />
            </section>
          )}

          {/* Section: Event Information */}
          <section className="payment-review-section">
            <h3>Event Information</h3>
            <ReviewDetail label="Event" value={record.event?.name} />
            <ReviewDetail label="Category" value={record.event?.category} />
            <ReviewDetail label="Event Date" value={formatDate(record.event?.startDate)} />
          </section>

          {/* Section: Payment Proof */}
          <section className="payment-review-section">
            <h3>Payment Proof</h3>
            {proof ? (
              <button
                type="button"
                className="payment-proof-large"
                onClick={() => onPreview(proof)}
                aria-label="Enlarge payment proof image"
              >
                <img
                  src={proof}
                  alt="Payment proof screenshot"
                  onError={event => {
                    event.currentTarget.style.display = "none";
                    const fallback = event.currentTarget.nextElementSibling;
                    if (fallback instanceof HTMLElement) fallback.style.display = "flex";
                  }}
                />
                <span className="payment-proof-fallback-msg" style={{ display: "none" }}>
                  Payment proof image failed to load.
                </span>
                <span>Open full image</span>
              </button>
            ) : (
              <p className="payment-no-proof">
                <FileBadge size={17} />
                No payment proof uploaded for this record.
              </p>
            )}
          </section>

          {/* Section: Payment Decision History */}
          <section className="payment-review-section">
            <h3>Payment Decision History</h3>
            <PaymentHistoryTimeline history={record.history} />
          </section>

          {/* Section: Actions */}
          <section className="payment-review-section payment-actions-section">
            <h3>Available Actions</h3>
            {canModify ? (
              <div className="payment-review-actions">
                {currentStatus === "PENDING" && (
                  <>
                    <Button
                      variant="secondary"
                      className="payment-reject-button"
                      disabled={disabled}
                      onClick={() => onAction("REJECTED")}
                    >
                      Reject payment
                    </Button>
                    <Button
                      variant="primary"
                      className="payment-verify-button"
                      disabled={disabled}
                      onClick={() => onAction("VERIFIED")}
                    >
                      Verify payment
                    </Button>
                  </>
                )}

                {currentStatus === "VERIFIED" && (
                  <>
                    <Button
                      variant="secondary"
                      className="payment-pending-button"
                      disabled={disabled}
                      onClick={() => onAction("PENDING")}
                    >
                      Mark as Pending
                    </Button>
                    <Button
                      variant="secondary"
                      className="payment-reject-button"
                      disabled={disabled}
                      onClick={() => onAction("REJECTED")}
                    >
                      Reject payment
                    </Button>
                  </>
                )}

                {currentStatus === "REJECTED" && (
                  <>
                    <Button
                      variant="secondary"
                      className="payment-pending-button"
                      disabled={disabled}
                      onClick={() => onAction("PENDING")}
                    >
                      Mark as Pending
                    </Button>
                    <Button
                      variant="primary"
                      className="payment-verify-button"
                      disabled={disabled}
                      onClick={() => onAction("VERIFIED")}
                    >
                      Verify payment
                    </Button>
                  </>
                )}
              </div>
            ) : (
              <div className="payment-readonly-note">
                <ShieldAlert size={15} />
                <span>
                  {isCancelled
                    ? `This ${record.type === "team" ? "team" : "registration"} is cancelled and payment status cannot be updated.`
                    : "This payment is marked as not required and cannot be modified."}
                </span>
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}

function ReviewDetail({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="payment-review-detail">
      <span>{label}</span>
      <strong>{children || value || "—"}</strong>
    </div>
  );
}

function isSafeImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function formatDate(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
        ...(value.includes("T") ? { timeStyle: "short" as const } : {}),
      }).format(date);
}
