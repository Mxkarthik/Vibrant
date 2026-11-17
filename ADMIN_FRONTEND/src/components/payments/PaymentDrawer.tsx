import { FileBadge, ShieldAlert, X } from "lucide-react";
import type { PaymentDecision, PaymentHistoryEntry } from "../../api/payments";
import Button from "../ui/Button";
import { useAccessibleDialog } from "../../hooks/useAccessibleDialog";
import PaymentStatusBadge, { formatStatus } from "./PaymentStatusBadge";
import PaymentHistoryTimeline from "./PaymentHistoryTimeline";

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
  event?: { name?: string; category?: string; startDate?: string } | null;
  method: string;
  status: string;
  proofUrl?: string | null;
  createdAt?: string;
  teamStatus?: string;
  history?: PaymentHistoryEntry[];
}

interface PaymentDrawerProps {
  record: DrawerPaymentRecord;
  disabled?: boolean;
  onClose: () => void;
  onPreview: (url: string) => void;
  onAction: (decision: PaymentDecision) => void;
}

export default function PaymentDrawer({
  record,
  disabled = false,
  onClose,
  onPreview,
  onAction,
}: PaymentDrawerProps) {
  const dialogRef = useAccessibleDialog(onClose, disabled);
  const proof = record.proofUrl && isSafeImageUrl(record.proofUrl) ? record.proofUrl : null;

  const isCancelled =
    record.type === "team" ? record.teamStatus === "CANCELLED" : false;
  const isNotRequired = record.status === "NOT_REQUIRED";
  const canModify = !isCancelled && !isNotRequired;

  const currentStatus = record.status.toUpperCase();

  return (
    <div
      className="payment-drawer-backdrop"
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget && !disabled) onClose();
      }}
    >
      <aside
        ref={dialogRef}
        className="payment-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-review-title"
      >
        <header>
          <div>
            <p>
              {record.type === "team"
                ? "SHARED TEAM PAYMENT"
                : "INDIVIDUAL PAYMENT"}
            </p>
            <h2 id="payment-review-title">{record.title}</h2>
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

        <div className="payment-drawer-body">
          {/* Section: Payment Overview */}
          <section className="payment-review-section">
            <h3>Payment Details</h3>
            <ReviewDetail label="Status">
              <PaymentStatusBadge status={record.status} />
            </ReviewDetail>
            <ReviewDetail label="Method">
              <span className="payment-method-badge">{formatStatus(record.method)}</span>
            </ReviewDetail>
            <ReviewDetail label={record.type === "team" ? "Team ID" : "Registration ID"}>
              <code className="payment-id-code">{record.id}</code>
            </ReviewDetail>
            <ReviewDetail label="Submitted" value={formatDate(record.createdAt)} />
            {record.type === "team" && (
              <>
                <ReviewDetail label="Team members" value={String(record.memberCount ?? "—")} />
                <ReviewDetail
                  label="Team status"
                  value={formatStatus(record.teamStatus || "REGISTERED")}
                />
              </>
            )}
          </section>

          {/* Section: Participant or Team Leader */}
          {record.type === "individual" ? (
            <section className="payment-review-section">
              <h3>Participant Information</h3>
              <ReviewDetail label="Name" value={record.title} />
              <ReviewDetail label="Email" value={record.email} />
              <ReviewDetail label="Mobile" value={record.mobile} />
              <ReviewDetail label="College" value={record.college} />
              <ReviewDetail label="Department" value={record.department} />
            </section>
          ) : (
            <section className="payment-review-section">
              <h3>Team Leader</h3>
              <ReviewDetail
                label="Name"
                value={record.subtitle ? record.subtitle.split(" · ")[0] : undefined}
              />
              <ReviewDetail label="Email" value={record.email} />
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
            <ReviewDetail label="Date" value={formatDate(record.event?.startDate)} />
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
                No payment proof is available for this record.
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
      </aside>
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
