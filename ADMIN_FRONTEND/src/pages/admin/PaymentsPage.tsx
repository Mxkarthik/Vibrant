import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CreditCard,
  Eye,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { getAdminDashboard, type AdminDashboardData } from "../../api/adminDashboard";
import { getApiErrorMessage } from "../../api/events";
import {
  getIndividualPayments,
  getTeamPayments,
  updateIndividualPayment,
  updateTeamPayment,
  type IndividualPaymentRecord,
  type PaymentDecision,
  type PaymentListParams,
  type PaymentStatusFilter,
  type TeamPaymentRecord,
} from "../../api/payments";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import PageHeader from "../../components/admin/PageHeader";
import PaymentStatusBadge, { formatStatus } from "../../components/payments/PaymentStatusBadge";
import PaymentDrawer, { type DrawerPaymentRecord } from "../../components/payments/PaymentDrawer";
import PaymentActionDialog from "../../components/payments/PaymentActionDialog";
import ProofPreviewModal from "../../components/payments/ProofPreviewModal";

type PaymentType = "individual" | "team";

const numberFormat = new Intl.NumberFormat("en-IN");
const initialParams: PaymentListParams = { page: 1, limit: 20, search: "", status: "PENDING" };

export default function PaymentsPage() {
  const [type, setType] = useState<PaymentType>("individual");
  const [params, setParams] = useState(initialParams);
  const [searchInput, setSearchInput] = useState("");
  const [records, setRecords] = useState<DrawerPaymentRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<AdminDashboardData["payments"] | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DrawerPaymentRecord | null>(null);
  const [decision, setDecision] = useState<PaymentDecision | null>(null);
  const [working, setWorking] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setSummaryError(null);
    try {
      const dashboard = await getAdminDashboard();
      setSummary(dashboard.payments);
    } catch (requestError) {
      setSummaryError(getApiErrorMessage(requestError, "Payment summary could not be loaded."));
    }
  }, []);

  const loadPayments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response =
        type === "individual"
          ? await getIndividualPayments(params)
          : await getTeamPayments(params);

      const mapped: DrawerPaymentRecord[] =
        type === "individual"
          ? (response.payments as IndividualPaymentRecord[]).map(mapIndividualPayment)
          : (response.payments as TeamPaymentRecord[]).map(mapTeamPayment);

      setRecords(mapped);
      setTotal(response.pagination.total);
      setTotalPages(response.pagination.totalPages);

      // If a record is currently open in the drawer, keep its data fresh with latest history and status
      setSelected(current => {
        if (!current) return null;
        const matching = mapped.find(r => r.id === current.id);
        return matching || current;
      });
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Payment records could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [type, params]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    void loadPayments();
  }, [loadPayments]);

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setParams(current => ({ ...current, search: searchInput.trim(), page: 1 })),
      300
    );
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setProofPreview(null);
        if (!working) {
          setDecision(null);
          setDialogError(null);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [working]);

  const refreshAll = async () => {
    await Promise.all([loadPayments(), loadSummary()]);
  };

  const changeTab = (next: PaymentType) => {
    setType(next);
    setParams(initialParams);
    setSearchInput("");
    setSelected(null);
    setDecision(null);
    setDialogError(null);
    setNotice(null);
  };

  const setStatus = (status: PaymentStatusFilter) =>
    setParams(current => ({ ...current, status, page: 1 }));

  const handleActionInitiate = (targetDecision: PaymentDecision) => {
    setDialogError(null);
    setDecision(targetDecision);
  };

  const submitDecision = async (reason?: string) => {
    if (!selected || !decision) return;

    setWorking(true);
    setDialogError(null);

    const payload = {
      status: decision,
      ...(reason ? { reason } : {}),
    };

    try {
      const result =
        selected.type === "individual"
          ? await updateIndividualPayment(selected.id, payload)
          : await updateTeamPayment(selected.id, payload);

      setNotice({ message: result.message, error: false });
      setDecision(null);
      setDialogError(null);

      // Refresh list and summary to get updated history and metrics
      await Promise.all([loadPayments(), loadSummary()]);
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "Payment status could not be updated. Please try again."
      );
      setDialogError(message);
      setNotice({ message, error: true });
    } finally {
      setWorking(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Payments"
        description="Review individual and shared team payment submissions with full decision history."
        action={
          <Button
            variant="secondary"
            icon={<RefreshCw size={14} />}
            onClick={() => void refreshAll()}
            disabled={loading}
          >
            Refresh
          </Button>
        }
      />

      {notice && (
        <div
          className={`payment-notice ${notice.error ? "is-error" : ""}`}
          role={notice.error ? "alert" : "status"}
        >
          {notice.error ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}
          <span>{notice.message}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss message">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="payment-summary-grid">
        <SummaryCard
          title="Pending individual"
          value={summary?.pendingIndividual}
          loading={!summary && !summaryError}
          error={summaryError}
          icon={<Clock3 size={17} />}
          tone="warning"
        />
        <SummaryCard
          title="Pending team"
          value={summary?.pendingTeams}
          loading={!summary && !summaryError}
          error={summaryError}
          icon={<Users size={17} />}
          tone="warning"
        />
        <SummaryCard
          title="Verified individual"
          value={summary?.verifiedIndividual}
          loading={!summary && !summaryError}
          error={summaryError}
          icon={<ShieldCheck size={17} />}
          tone="success"
        />
        <SummaryCard
          title="Verified team"
          value={summary?.verifiedTeams}
          loading={!summary && !summaryError}
          error={summaryError}
          icon={<CheckCircle2 size={17} />}
          tone="success"
        />
      </div>

      {summaryError && (
        <div className="payment-summary-error" role="alert">
          {summaryError}{" "}
          <button onClick={() => void loadSummary()}>Retry</button>
        </div>
      )}

      <Card className="payment-card">
        <div className="payment-tabs" role="tablist" aria-label="Payment type">
          <button
            role="tab"
            aria-selected={type === "individual"}
            className={type === "individual" ? "active" : ""}
            onClick={() => changeTab("individual")}
          >
            <CreditCard size={15} /> Individual{" "}
            <span>{summary ? numberFormat.format(summary.pendingIndividual) : "—"}</span>
          </button>
          <button
            role="tab"
            aria-selected={type === "team"}
            className={type === "team" ? "active" : ""}
            onClick={() => changeTab("team")}
          >
            <Users size={15} /> Teams{" "}
            <span>{summary ? numberFormat.format(summary.pendingTeams) : "—"}</span>
          </button>
        </div>

        <div className="payment-toolbar">
          <label className="payment-search">
            <Search size={15} />
            <input
              value={searchInput}
              onChange={event => setSearchInput(event.target.value)}
              placeholder={
                type === "individual"
                  ? "Search participant, email, event…"
                  : "Search team, leader, event…"
              }
              aria-label="Search payments"
            />
          </label>
          <select
            aria-label="Filter payment status"
            value={params.status}
            onChange={event => setStatus(event.target.value as PaymentStatusFilter)}
          >
            <option value="PENDING">Pending</option>
            <option value="VERIFIED">Verified</option>
            <option value="REJECTED">Rejected</option>
            <option value="NOT_REQUIRED">Not required</option>
            <option value="ALL">All statuses</option>
          </select>
        </div>

        {error ? (
          <div className="payment-state">
            <AlertCircle size={21} />
            <h2>Payment records could not be loaded</h2>
            <p>{error}</p>
            <Button variant="secondary" onClick={() => void loadPayments()}>
              Try again
            </Button>
          </div>
        ) : loading ? (
          <PaymentSkeleton />
        ) : !records.length ? (
          <div className="payment-state">
            <span className="payment-state-icon">
              <CreditCard size={20} />
            </span>
            <h2>
              {params.status === "PENDING" && !params.search
                ? "No pending payments"
                : "No matching payments"}
            </h2>
            <p>
              {params.status === "PENDING" && !params.search
                ? "New payment submissions will appear here for review."
                : "Try another status or search term."}
            </p>
          </div>
        ) : (
          <>
            <div className="payment-table-wrap">
              <table className="payment-table">
                <thead>
                  <tr>
                    <th>{type === "individual" ? "Participant" : "Team"}</th>
                    <th>Event</th>
                    <th>Method</th>
                    <th>Status</th>
                    <th>Proof</th>
                    <th>Submitted</th>
                    <th>
                      <span className="sr-only">Review</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {records.map(record => (
                    <tr key={record.id}>
                      <td>
                        <div className="payment-identity">
                          <strong>{record.title}</strong>
                          <small>{record.subtitle}</small>
                          {record.email && <small>{record.email}</small>}
                          {record.mobile && <small>{record.mobile}</small>}
                          {record.type === "team" && (
                            <small>
                              {record.memberCount ?? "—"} members ·{" "}
                              {record.teamStatus === "CANCELLED"
                                ? "Team cancelled"
                                : "Shared payment"}
                            </small>
                          )}
                        </div>
                      </td>
                      <td>
                        <strong className="payment-event-name">
                          {record.event?.name || "Event unavailable"}
                        </strong>
                        <small className="payment-event-meta">
                          {record.event?.category || ""}
                          {record.event?.startDate
                            ? ` · ${formatDate(record.event.startDate)}`
                            : ""}
                        </small>
                      </td>
                      <td>
                        <MethodBadge method={record.method} />
                      </td>
                      <td>
                        <PaymentStatusBadge status={record.status} />
                      </td>
                      <td>
                        {record.proofUrl && isSafeImageUrl(record.proofUrl) ? (
                          <ProofThumbnail
                            url={record.proofUrl}
                            onOpen={() => setProofPreview(record.proofUrl!)}
                          />
                        ) : (
                          <span className="payment-proof-missing">
                            {record.method === "UPI" ? "Not uploaded" : "—"}
                          </span>
                        )}
                      </td>
                      <td>{formatDate(record.createdAt)}</td>
                      <td>
                        <Button
                          variant="secondary"
                          icon={<Eye size={14} />}
                          onClick={() => {
                            setDialogError(null);
                            setSelected(record);
                          }}
                        >
                          Review
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="payment-pagination">
              <span>
                {numberFormat.format(total)} records · Page {params.page} of{" "}
                {Math.max(1, totalPages)}
              </span>
              <div>
                <label>
                  Rows{" "}
                  <select
                    aria-label="Rows per page"
                    value={params.limit}
                    onChange={event =>
                      setParams(current => ({
                        ...current,
                        limit: Number(event.target.value),
                        page: 1,
                      }))
                    }
                  >
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </label>
                <Button
                  variant="secondary"
                  icon={<ChevronLeft size={14} />}
                  onClick={() =>
                    setParams(current => ({
                      ...current,
                      page: Math.max(1, current.page - 1),
                    }))
                  }
                  disabled={params.page <= 1 || loading}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  onClick={() =>
                    setParams(current => ({ ...current, page: current.page + 1 }))
                  }
                  disabled={params.page >= totalPages || loading}
                >
                  Next <ChevronRight size={14} />
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>

      {/* Review Drawer */}
      {selected && (
        <PaymentDrawer
          record={selected}
          disabled={working}
          onClose={() => {
            setSelected(null);
            setDecision(null);
            setDialogError(null);
          }}
          onPreview={setProofPreview}
          onAction={handleActionInitiate}
        />
      )}

      {/* Reversible Action & Rejection Dialog */}
      {decision && selected && (
        <PaymentActionDialog
          decision={decision}
          record={{
            id: selected.id,
            type: selected.type,
            title: selected.title,
            subtitle: selected.subtitle,
            eventName: selected.event?.name,
            currentStatus: selected.status,
          }}
          working={working}
          error={dialogError}
          onCancel={() => {
            if (!working) {
              setDecision(null);
              setDialogError(null);
            }
          }}
          onConfirm={submitDecision}
        />
      )}

      {/* Full Size Payment Proof Preview */}
      {proofPreview && (
        <ProofPreviewModal
          url={proofPreview}
          onClose={() => setProofPreview(null)}
        />
      )}
    </>
  );
}

function SummaryCard({
  title,
  value,
  loading,
  error,
  icon,
  tone,
}: {
  title: string;
  value?: number;
  loading: boolean;
  error: string | null;
  icon: React.ReactNode;
  tone: "warning" | "success";
}) {
  return (
    <Card className="payment-summary-card">
      <span className={`payment-summary-icon tone-${tone}`}>{icon}</span>
      <div>
        <small>{title}</small>
        {loading ? (
          <span className="payment-summary-skeleton" />
        ) : error ? (
          <strong className="summary-unavailable">Unavailable</strong>
        ) : (
          <strong>{numberFormat.format(value ?? 0)}</strong>
        )}
      </div>
    </Card>
  );
}

function ProofThumbnail({ url, onOpen }: { url: string; onOpen: () => void }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="payment-proof-missing">Unavailable</span>;
  return (
    <button
      type="button"
      className="payment-proof-thumb"
      onClick={onOpen}
      aria-label="Open payment proof thumbnail"
    >
      <img
        src={url}
        alt="Payment proof thumbnail"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </button>
  );
}

function MethodBadge({ method }: { method: string }) {
  return <span className="payment-method-badge">{formatStatus(method)}</span>;
}

function PaymentSkeleton() {
  return (
    <div className="payment-skeleton" aria-label="Loading payments">
      {[0, 1, 2, 3, 4].map(row => (
        <span key={row} />
      ))}
    </div>
  );
}

function mapIndividualPayment(record: IndividualPaymentRecord): DrawerPaymentRecord {
  return {
    id: record._id,
    type: "individual",
    title: record.participantDetails?.fullName || record.user?.name || "Name unavailable",
    subtitle: record.participantDetails?.collegeName || "College unavailable",
    email: record.user?.email,
    mobile: record.participantDetails?.mobileNumber,
    college: record.participantDetails?.collegeName,
    department: record.participantDetails?.department,
    event: record.event,
    method: record.payment?.method || "UNKNOWN",
    status: record.payment?.status || "UNKNOWN",
    proofUrl: record.payment?.proofUrl,
    createdAt: record.createdAt,
    history: record.payment?.history || [],
  };
}

function mapTeamPayment(record: TeamPaymentRecord): DrawerPaymentRecord {
  return {
    id: record._id,
    type: "team",
    title: record.teamName || "Team unavailable",
    subtitle: `${record.leader?.name || "Leader unavailable"}${
      record.leader?.email ? ` · ${record.leader.email}` : ""
    }`,
    email: record.leader?.email,
    memberCount: record.memberCount,
    event: record.event,
    method: record.payment?.method || "UNKNOWN",
    status: record.payment?.status || "UNKNOWN",
    proofUrl: record.payment?.proofUrl,
    createdAt: record.createdAt,
    teamStatus: record.status,
    history: record.payment?.history || [],
  };
}

function isSafeImageUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
        ...(value.includes("T") ? { timeStyle: "short" as const } : {}),
      }).format(date);
}
