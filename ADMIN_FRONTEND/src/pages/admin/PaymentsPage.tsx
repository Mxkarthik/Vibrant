import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  CreditCard,
  Eye,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import { getAdminEvents, getApiErrorMessage, type EventRecord } from "../../api/events";
import {
  getFinancialSummary,
  getIndividualPayments,
  getTeamPayments,
  updateIndividualPayment,
  updateTeamPayment,
  type FinancialAnalyticsResponse,
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
import PaymentDetailsModal, { type DrawerPaymentRecord } from "../../components/payments/PaymentDetailsModal";
import PaymentActionDialog from "../../components/payments/PaymentActionDialog";
import ProofPreviewModal from "../../components/payments/ProofPreviewModal";

type PaymentType = "individual" | "team";

const numberFormat = new Intl.NumberFormat("en-IN");
const currencyFormat = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const formatCompactInr = (val: number): string => {
  if (val >= 10000000) return `₹${(val / 10000000).toFixed(1)}Cr`;
  if (val >= 100000) return `₹${(val / 100000).toFixed(1)}L`;
  if (val >= 1000) return `₹${(val / 1000).toFixed(1)}k`;
  return `₹${val}`;
};

const formatTime = (date: Date): string => {
  return new Intl.DateTimeFormat("en-IN", {
    timeStyle: "short",
  }).format(date);
};

const initialParams: PaymentListParams = { page: 1, limit: 20, search: "", status: "ALL" };

export default function PaymentsPage() {
  const [type, setType] = useState<PaymentType>("individual");
  const [params, setParams] = useState(initialParams);
  const [searchInput, setSearchInput] = useState("");
  const [records, setRecords] = useState<DrawerPaymentRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Event selection state
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>("");

  // Financial Analytics state
  const [analytics, setAnalytics] = useState<FinancialAnalyticsResponse | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  // Cash receiver view mode (cards vs table)
  const [showReceiverTable, setShowReceiverTable] = useState(false);

  // Selected payment modal and dialog state
  const [selected, setSelected] = useState<DrawerPaymentRecord | null>(null);
  const [decision, setDecision] = useState<PaymentDecision | null>(null);
  const [working, setWorking] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);

  // Load events list for the selector
  const loadEventsList = useCallback(async () => {
    try {
      const res = await getAdminEvents({ limit: 50, sortBy: "startDate", sortOrder: "desc" });
      setEvents(res.events || []);
    } catch {
      // Event selector will show "All Events" if event loading fails
    }
  }, []);

  // Load financial summary analytics
  const loadAnalytics = useCallback(async (eventId?: string) => {
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    try {
      const response = await getFinancialSummary(eventId ? { eventId } : undefined);
      setAnalytics(response);
      setLastUpdated(new Date());
    } catch (requestError) {
      setAnalyticsError(getApiErrorMessage(requestError, "Financial summary could not be loaded."));
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  // Load paginated payment transactions
  const loadPayments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const queryParams: PaymentListParams = {
        ...params,
        ...(selectedEventId ? { eventId: selectedEventId } : {}),
      };

      const response =
        type === "individual"
          ? await getIndividualPayments(queryParams)
          : await getTeamPayments(queryParams);

      const mapped: DrawerPaymentRecord[] =
        type === "individual"
          ? (response.payments as IndividualPaymentRecord[]).map(mapIndividualPayment)
          : (response.payments as TeamPaymentRecord[]).map(mapTeamPayment);

      setRecords(mapped);
      setTotal(response.pagination.total);
      setTotalPages(response.pagination.totalPages);

      // Keep currently viewed modal record synchronized with fresh data
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
  }, [type, params, selectedEventId]);

  useEffect(() => {
    void loadEventsList();
  }, [loadEventsList]);

  useEffect(() => {
    void loadAnalytics(selectedEventId);
  }, [loadAnalytics, selectedEventId]);

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
    await Promise.all([loadPayments(), loadAnalytics(selectedEventId), loadEventsList()]);
  };

  // Background polling: refresh analytics every 15 seconds while page is visible.
  // Pauses when page is hidden (user switches tabs) to avoid unnecessary requests.
  useEffect(() => {
    const POLL_INTERVAL_MS = 15_000;
    let timerId: ReturnType<typeof window.setTimeout> | null = null;

    const schedulePoll = () => {
      timerId = window.setTimeout(async () => {
        if (document.visibilityState === "visible") {
          await Promise.all([loadAnalytics(selectedEventId), loadPayments()]);
        }
        schedulePoll();
      }, POLL_INTERVAL_MS);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        // Resume polling immediately on return
        void loadAnalytics(selectedEventId);
      }
    };

    schedulePoll();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (timerId !== null) window.clearTimeout(timerId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEventId]);

  const handleEventChange = (nextEventId: string) => {
    setSelectedEventId(nextEventId);
    setParams(current => ({ ...current, page: 1 }));
    setSelected(null);
  };

  const changeTab = (next: PaymentType) => {
    setType(next);
    setParams(current => ({ ...current, page: 1 }));
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

  const submitDecision = async (reason?: string, receivedAmount?: number) => {
    if (!selected || !decision) return;

    setWorking(true);
    setDialogError(null);

    const payload = {
      status: decision,
      ...(reason ? { reason } : {}),
      ...(receivedAmount !== undefined ? { receivedAmount } : {}),
    };

    try {
      const result =
        selected.type === "individual"
          ? await updateIndividualPayment(selected.id, payload)
          : await updateTeamPayment(selected.id, payload);

      setNotice({ message: result.message, error: false });
      setDecision(null);
      setDialogError(null);

      // Refresh list, summary, and analytics
      await Promise.all([loadPayments(), loadAnalytics(selectedEventId)]);
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

  const selectedEvent = events.find(e => e._id === selectedEventId);

  return (
    <>
      <PageHeader
        title="Payments"
        description="Monitor collections and payment activity."
        action={
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "11px", color: "#85949e" }}>
              Last updated {formatTime(lastUpdated)}
            </span>
            <Button
              variant="secondary"
              icon={<RefreshCw size={14} className={analyticsLoading || loading ? "is-spinning" : ""} />}
              onClick={() => void refreshAll()}
              disabled={loading || analyticsLoading}
            >
              Refresh
            </Button>
          </div>
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

      {/* Section A — Event Selector */}
      <Card className="payment-event-selector-card">
        <label className="payment-event-selector-label">
          <span>Event</span>
          <div className="payment-event-select-wrap">
            <select
              className="payment-event-select"
              value={selectedEventId}
              onChange={e => handleEventChange(e.target.value)}
              aria-label="Filter by Event"
            >
              <option value="">All Events</option>
              {events.map(event => (
                <option key={event._id} value={event._id}>
                  {event.name} ({event.category})
                </option>
              ))}
            </select>
            <ChevronRight size={16} className="payment-event-select-chevron" style={{ transform: "rotate(90deg)" }} />
          </div>
        </label>
      </Card>

      {/* Section B — Financial Summary Cards */}
      {analyticsError ? (
        <div className="payment-summary-error" role="alert" style={{ marginBottom: "16px" }}>
          <AlertCircle size={15} style={{ verticalAlign: "middle", marginRight: "6px" }} />
          {analyticsError} <button onClick={() => void loadAnalytics(selectedEventId)}>Retry</button>
        </div>
      ) : (
        <>
          <div className="payment-analytics-grid">
            <FinancialSummaryCard
              label="Total verified collection"
              value={analytics ? currencyFormat.format(analytics.summary.totalVerifiedAmount) : undefined}
              note="Confirmed payments"
              count={analytics ? `${numberFormat.format(analytics.summary.verifiedCount)} payments` : undefined}
              icon={<WalletCards size={18} />}
              tone="verified"
              loading={analyticsLoading}
            />
            <FinancialSummaryCard
              label="Pending payments"
              value={analytics ? currencyFormat.format(analytics.summary.pendingExpectedAmount) : undefined}
              note="Awaiting verification"
              count={analytics ? `${numberFormat.format(analytics.summary.pendingCount)} pending` : undefined}
              icon={<Clock3 size={18} />}
              tone="pending"
              loading={analyticsLoading}
            />
            <FinancialSummaryCard
              label="Cash collections"
              value={analytics ? currencyFormat.format(analytics.summary.cashVerifiedAmount) : undefined}
              note="Verified cash payments"
              count={
                analytics
                  ? `${numberFormat.format(
                      analytics.methodBreakdown.find(m => m.method === "CASH")?.count ?? 0
                    )} cash records`
                  : undefined
              }
              icon={<CircleDollarSign size={18} />}
              tone="cash"
              loading={analyticsLoading}
            />
            <FinancialSummaryCard
              label="UPI collections"
              value={analytics ? currencyFormat.format(analytics.summary.upiVerifiedAmount) : undefined}
              note="Verified online payments"
              count={
                analytics
                  ? `${numberFormat.format(
                      analytics.methodBreakdown.find(m => m.method === "UPI")?.count ?? 0
                    )} online records`
                  : undefined
              }
              icon={<CreditCard size={18} />}
              tone="upi"
              loading={analyticsLoading}
            />
            <FinancialSummaryCard
              label="Rejected payments"
              value={analytics ? currencyFormat.format(analytics.summary.rejectedExpectedAmount) : undefined}
              note="Rejected submissions"
              count={analytics ? `${numberFormat.format(analytics.summary.rejectedCount)} rejected` : undefined}
              icon={<X size={18} />}
              tone="rejected"
              loading={analyticsLoading}
            />
            <FinancialSummaryCard
              label="Collection rate"
              value={
                analytics
                  ? analytics.summary.collectionPercentage !== null
                    ? `${analytics.summary.collectionPercentage}%`
                    : "—"
                  : undefined
              }
              note="Verified participant registrations"
              count={
                analytics
                  ? analytics.summary.totalPaidParticipants > 0
                    ? `${numberFormat.format(analytics.summary.verifiedParticipants)} of ${numberFormat.format(analytics.summary.totalPaidParticipants)} registrations`
                    : "No paid registrations"
                  : undefined
              }
              icon={<Activity size={18} />}
              tone="rate"
              loading={analyticsLoading}
            />
          </div>

          {analytics && !analytics.summary.isComplete && analytics.summary.unknownAmountCount > 0 && (
            <div style={{ marginBottom: "16px" }}>
              <span className="payment-incomplete-badge">
                <AlertTriangle size={13} />
                Notice: {analytics.summary.unknownAmountCount} payment record
                {analytics.summary.unknownAmountCount === 1 ? "" : "s"} reference a deleted or unavailable event and cannot be resolved to a fee amount. These are excluded from monetary totals.
              </span>
            </div>
          )}

        </>
      )}

      {/* Section C & D — Middle Split: Collection Breakdown & Cash Receivers */}
      <div className="payment-dashboard-split">
        {/* Section C — Collection Breakdown */}
        <Card className="payment-section-card">
          <div className="payment-section-header">
            <h2>Collection breakdown</h2>
            <p>Verified cash and UPI payments</p>
          </div>

          {analyticsLoading ? (
            <div className="payment-skeleton" style={{ height: "130px" }}>
              <span />
            </div>
          ) : analytics ? (
            <div className="payment-breakdown-content">
              <DonutChart
                totalAmount={analytics.summary.totalVerifiedAmount}
                cashAmount={analytics.summary.cashVerifiedAmount}
                upiAmount={analytics.summary.upiVerifiedAmount}
                otherAmount={analytics.summary.otherVerifiedAmount}
              />
              <div className="payment-breakdown-legend">
                <div className="payment-legend-row">
                  <div className="payment-legend-left">
                    <span className="payment-legend-dot is-cash" />
                    <div>
                      <span className="payment-legend-title">Cash</span>
                      <span className="payment-legend-pct">
                        {analytics.summary.totalVerifiedAmount > 0
                          ? `${(
                              (analytics.summary.cashVerifiedAmount / analytics.summary.totalVerifiedAmount) *
                              100
                            ).toFixed(1)}%`
                          : "0.0%"}
                      </span>
                    </div>
                  </div>
                  <strong className="payment-legend-amount">
                    {currencyFormat.format(analytics.summary.cashVerifiedAmount)}
                  </strong>
                </div>

                <div className="payment-legend-row">
                  <div className="payment-legend-left">
                    <span className="payment-legend-dot is-upi" />
                    <div>
                      <span className="payment-legend-title">UPI</span>
                      <span className="payment-legend-pct">
                        {analytics.summary.totalVerifiedAmount > 0
                          ? `${(
                              (analytics.summary.upiVerifiedAmount / analytics.summary.totalVerifiedAmount) *
                              100
                            ).toFixed(1)}%`
                          : "0.0%"}
                      </span>
                    </div>
                  </div>
                  <strong className="payment-legend-amount">
                    {currencyFormat.format(analytics.summary.upiVerifiedAmount)}
                  </strong>
                </div>

                {analytics.summary.otherVerifiedAmount > 0 && (
                  <div className="payment-legend-row">
                    <div className="payment-legend-left">
                      <span className="payment-legend-dot is-other" />
                      <div>
                        <span className="payment-legend-title">Other</span>
                        <span className="payment-legend-pct">
                          {analytics.summary.totalVerifiedAmount > 0
                            ? `${(
                                (analytics.summary.otherVerifiedAmount / analytics.summary.totalVerifiedAmount) *
                                100
                              ).toFixed(1)}%`
                            : "0.0%"}
                        </span>
                      </div>
                    </div>
                    <strong className="payment-legend-amount">
                      {currencyFormat.format(analytics.summary.otherVerifiedAmount)}
                    </strong>
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </Card>

        {/* Section D — Cash Collection by Receiver */}
        <Card className="payment-section-card">
          <div className="payment-section-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h2>Cash collection by receiver</h2>
              <p>Verified payments grouped by recorded cash receiver</p>
            </div>
            {analytics && analytics.cashReceivers.length > 0 && (
              <button
                type="button"
                className="payment-receiver-view-toggle"
                onClick={() => setShowReceiverTable(!showReceiverTable)}
              >
                {showReceiverTable ? "View visual bars" : "View table breakdown"}
              </button>
            )}
          </div>

          {analyticsLoading ? (
            <div className="payment-skeleton" style={{ height: "130px" }}>
              <span />
            </div>
          ) : !analytics || analytics.cashReceivers.length === 0 ? (
            <div className="payment-state" style={{ minHeight: "150px" }}>
              <CircleDollarSign size={24} style={{ color: "#8ca0ad" }} />
              <p style={{ margin: "8px 0 0", color: "#85949e", fontSize: "11px" }}>
                No cash payment records recorded {selectedEventId ? "for this event" : ""}.
              </p>
            </div>
          ) : showReceiverTable ? (
            <div className="payment-table-wrap">
              <table className="payment-table" style={{ minWidth: "550px" }}>
                <thead>
                  <tr>
                    <th>Cash receiver name</th>
                    <th>Verified cash collection</th>
                    <th>Pending cash</th>
                    <th>Verified records</th>
                    <th>Pending records</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.cashReceivers.map((receiver, idx) => (
                    <tr key={idx}>
                      <td>
                        <strong>{receiver.receiverName}</strong>
                        {receiver.isUnrecorded && (
                          <small style={{ display: "block", color: "#a46c48" }}>Unrecorded receiver</small>
                        )}
                      </td>
                      <td className="payment-amount-cell">{currencyFormat.format(receiver.verifiedAmount)}</td>
                      <td>{currencyFormat.format(receiver.pendingAmount)}</td>
                      <td>{numberFormat.format(receiver.verifiedCount)}</td>
                      <td>{numberFormat.format(receiver.pendingCount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="payment-receiver-list">
              {(() => {
                const maxAmount = Math.max(
                  ...analytics.cashReceivers.map(r => r.verifiedAmount),
                  1
                );
                return analytics.cashReceivers.map((receiver, idx) => {
                  const pct = Math.min(100, Math.max(4, (receiver.verifiedAmount / maxAmount) * 100));
                  return (
                    <div key={idx} className="payment-receiver-item">
                      <div className="payment-receiver-top">
                        <span className="payment-receiver-name">
                          {receiver.receiverName}
                          {receiver.isUnrecorded && (
                            <span style={{ fontSize: "10px", color: "#a46c48", marginLeft: "6px" }}>
                              (Unrecorded)
                            </span>
                          )}
                        </span>
                        <strong className="payment-receiver-amount">
                          {currencyFormat.format(receiver.verifiedAmount)}
                        </strong>
                      </div>
                      <div className="payment-receiver-track">
                        <div className="payment-receiver-fill" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="payment-receiver-sub">
                        <span>{numberFormat.format(receiver.verifiedCount)} payment records</span>
                        {receiver.pendingCount > 0 && (
                          <span style={{ marginLeft: "10px", color: "#b27b20" }}>
                            · {numberFormat.format(receiver.pendingCount)} pending ({currencyFormat.format(receiver.pendingAmount)})
                          </span>
                        )}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          )}
        </Card>
      </div>

      {/* Section E — Event-Wise Financial Breakdown */}
      <Card className="payment-event-breakdown-card">
        <div className="payment-section-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h2>Event financial breakdown</h2>
            <p>
              {selectedEventId
                ? `Showing financial metrics for: ${selectedEvent?.name || "Selected Event"}`
                : "Overview of collections and verification progress across all events"}
            </p>
          </div>
          {selectedEventId && (
            <Button
              variant="secondary"
              onClick={() => handleEventChange("")}
              style={{ fontSize: "11px", minHeight: "30px", padding: "0 10px" }}
            >
              View All Events
            </Button>
          )}
        </div>

        {analyticsLoading ? (
          <div className="payment-skeleton" style={{ height: "120px" }}>
            <span />
          </div>
        ) : !analytics || analytics.eventBreakdown.length === 0 ? (
          <p style={{ color: "#85949e", fontSize: "11px" }}>No events found.</p>
        ) : (
          <div className="payment-table-wrap">
            <table className="payment-event-table">
              <thead>
                <tr>
                  <th>Event name</th>
                  <th>Verified collection</th>
                  <th>Cash collection</th>
                  <th>UPI collection</th>
                  <th>Pending amount</th>
                  <th>Verified count</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {analytics.eventBreakdown.map(ev => {
                  const isCurrent = ev.eventId === selectedEventId;
                  return (
                    <tr key={ev.eventId} className={isCurrent ? "is-selected-event" : ""}>
                      <td>
                        <strong>{ev.eventName}</strong>
                        {ev.category && (
                          <small style={{ display: "block", color: "#85949e", fontSize: "9px" }}>
                            {ev.category}
                          </small>
                        )}
                      </td>
                      <td className="payment-amount-cell">{currencyFormat.format(ev.verifiedAmount)}</td>
                      <td>{currencyFormat.format(ev.cashAmount)}</td>
                      <td>{currencyFormat.format(ev.upiAmount)}</td>
                      <td style={{ color: ev.pendingAmount > 0 ? "#b27b20" : "inherit" }}>
                        {currencyFormat.format(ev.pendingAmount)}
                      </td>
                      <td>{numberFormat.format(ev.verifiedCount)}</td>
                      <td>
                        {isCurrent ? (
                          <span style={{ fontSize: "10px", color: "#16845b", fontWeight: 600 }}>Active</span>
                        ) : (
                          <Button
                            variant="secondary"
                            className="payment-event-action-btn"
                            icon={<SlidersHorizontal size={11} />}
                            onClick={() => handleEventChange(ev.eventId)}
                          >
                            Filter
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Section F — Payment Transactions */}
      <Card className="payment-card">
        <div style={{ padding: "16px 20px 0" }}>
          <h2 style={{ margin: 0, color: "#223746", font: "600 15px/1.3 'DM Sans', sans-serif" }}>
            Payment transactions
          </h2>
        </div>

        <div className="payment-tabs" role="tablist" aria-label="Payment type" style={{ marginTop: "10px" }}>
          <button
            role="tab"
            aria-selected={type === "individual"}
            className={type === "individual" ? "active" : ""}
            onClick={() => changeTab("individual")}
          >
            <CreditCard size={15} /> Individual{" "}
            <span>{analytics ? numberFormat.format(analytics.summary.individualCount) : "—"}</span>
          </button>
          <button
            role="tab"
            aria-selected={type === "team"}
            className={type === "team" ? "active" : ""}
            onClick={() => changeTab("team")}
          >
            <Users size={15} /> Teams{" "}
            <span>{analytics ? numberFormat.format(analytics.summary.teamCount) : "—"}</span>
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
            <option value="ALL">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="VERIFIED">Verified</option>
            <option value="REJECTED">Rejected</option>
            <option value="NOT_REQUIRED">Not required</option>
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
                    <th>Amount</th>
                    <th>Method</th>
                    <th>Status</th>
                    <th>Event</th>
                    <th>Proof</th>
                    <th>Submitted</th>
                    <th>
                      <span className="sr-only">Review</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {records.map(record => {
                    const displayAmount =
                      record.receivedAmount != null
                        ? currencyFormat.format(record.receivedAmount)
                        : record.expectedAmount != null
                        ? currencyFormat.format(record.expectedAmount)
                        : record.status === "NOT_REQUIRED"
                        ? "Free"
                        : "Not recorded";

                    return (
                      <tr key={record.id}>
                        <td>
                          <div className="payment-identity">
                            <strong>{record.title}</strong>
                            <small>{record.subtitle}</small>
                            {record.email && <small>{record.email}</small>}
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
                          <strong className="payment-amount-cell">{displayAmount}</strong>
                        </td>
                        <td>
                          <div className="payment-method-cell">
                            <span className="payment-method-badge">{formatStatus(record.method)}</span>
                            {record.method === "CASH" && (
                              <small className="payment-receiver-subtext">
                                {record.cashReceiverName ? record.cashReceiverName : "Receiver unrecorded"}
                              </small>
                            )}
                          </div>
                        </td>
                        <td>
                          <PaymentStatusBadge status={record.status} />
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
                            aria-label={`Review payment for ${record.title}`}
                          >
                            Review
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
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

      {/* Centered Financial Details Modal */}
      {selected && (
        <PaymentDetailsModal
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
            expectedAmount: selected.expectedAmount,
            eventFee: selected.event?.registrationFee,
            method: selected.method,
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

function FinancialSummaryCard({
  label,
  value,
  note,
  count,
  icon,
  tone,
  loading,
}: {
  label: string;
  value?: string;
  note: string;
  count?: string;
  icon: React.ReactNode;
  tone: "verified" | "pending" | "cash" | "upi" | "rejected" | "rate";
  loading: boolean;
}) {
  return (
    <Card className="payment-analytics-card">
      <div className="payment-analytics-top">
        <span className={`payment-analytics-icon-wrap tone-${tone}`}>{icon}</span>
        {count && <span style={{ fontSize: "10px", color: "#8b9aa4" }}>{count}</span>}
      </div>
      <div>
        <div className="payment-analytics-label">{label}</div>
        {loading ? (
          <span className="payment-summary-skeleton" style={{ width: "90px", height: "24px", marginTop: "5px" }} />
        ) : (
          <div className={`payment-analytics-value tone-${tone}-text`}>
            {value ?? "—"}
          </div>
        )}
      </div>
      <div className="payment-analytics-note">{note}</div>
    </Card>
  );
}

function DonutChart({
  totalAmount,
  cashAmount,
  upiAmount,
  otherAmount = 0,
}: {
  totalAmount: number;
  cashAmount: number;
  upiAmount: number;
  otherAmount?: number;
}) {
  const radius = 45;
  const circumference = 2 * Math.PI * radius; // ~282.74

  if (totalAmount <= 0) {
    return (
      <div className="payment-donut-wrap">
        <svg viewBox="0 0 120 120" className="payment-donut-svg">
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="transparent"
            stroke="#edf1f3"
            strokeWidth="14"
          />
        </svg>
        <div className="payment-donut-center">
          <strong>₹0</strong>
          <small>Collected</small>
        </div>
      </div>
    );
  }

  const cashPct = Math.max(0, Math.min(1, cashAmount / totalAmount));
  const upiPct = Math.max(0, Math.min(1, upiAmount / totalAmount));
  const otherPct = Math.max(0, Math.min(1, otherAmount / totalAmount));

  const cashStroke = cashPct * circumference;
  const upiStroke = upiPct * circumference;
  const otherStroke = otherPct * circumference;

  const cashOffset = 0;
  const upiOffset = -cashStroke;
  const otherOffset = -(cashStroke + upiStroke);

  return (
    <div className="payment-donut-wrap">
      <svg viewBox="0 0 120 120" className="payment-donut-svg">
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="transparent"
          stroke="#edf1f3"
          strokeWidth="14"
        />
        {cashStroke > 0 && (
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="transparent"
            stroke="#234968"
            strokeWidth="14"
            strokeDasharray={`${cashStroke} ${circumference}`}
            strokeDashoffset={cashOffset}
          />
        )}
        {upiStroke > 0 && (
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="transparent"
            stroke="#38b2ac"
            strokeWidth="14"
            strokeDasharray={`${upiStroke} ${circumference}`}
            strokeDashoffset={upiOffset}
          />
        )}
        {otherStroke > 0 && (
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="transparent"
            stroke="#8896a0"
            strokeWidth="14"
            strokeDasharray={`${otherStroke} ${circumference}`}
            strokeDashoffset={otherOffset}
          />
        )}
      </svg>
      <div className="payment-donut-center">
        <strong>{formatCompactInr(totalAmount)}</strong>
        <small>Collected</small>
      </div>
    </div>
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
  const eventFee = record.event?.registrationFee ?? record.event?.registration?.registrationFee ?? null;
  const isCash = record.payment?.method === "CASH";
  const expectedAmount = record.payment?.expectedAmount ?? (isCash ? eventFee : null);
  const receivedAmount =
    record.payment?.receivedAmount ??
    (record.payment?.status === "VERIFIED" && isCash
      ? (record.payment?.expectedAmount ?? eventFee)
      : null);

  return {
    id: record._id,
    type: "individual",
    title: record.participantDetails?.fullName || record.user?.name || "Name unavailable",
    subtitle: record.participantDetails?.collegeName || "College unavailable",
    email: record.user?.email,
    mobile: record.participantDetails?.mobileNumber,
    college: record.participantDetails?.collegeName,
    department: record.participantDetails?.department,
    event: record.event
      ? {
          name: record.event.name,
          category: record.event.category,
          startDate: record.event.startDate,
          registrationFee: eventFee ?? undefined,
        }
      : null,
    method: record.payment?.method || "UNKNOWN",
    status: record.payment?.status || "UNKNOWN",
    proofUrl: record.payment?.proofUrl,
    cashReceiverName: record.payment?.cashReceiverName,
    expectedAmount,
    receivedAmount,
    currency: record.payment?.currency,
    verifiedBy: record.payment?.verifiedBy,
    verifiedAt: record.payment?.verifiedAt,
    createdAt: record.createdAt,
    history: record.payment?.history || [],
  };
}

function mapTeamPayment(record: TeamPaymentRecord): DrawerPaymentRecord {
  const eventFee = record.event?.registrationFee ?? record.event?.registration?.registrationFee ?? null;
  const isCash = record.payment?.method === "CASH";
  const expectedAmount = record.payment?.expectedAmount ?? (isCash ? eventFee : null);
  const receivedAmount =
    record.payment?.receivedAmount ??
    (record.payment?.status === "VERIFIED" && isCash
      ? (record.payment?.expectedAmount ?? eventFee)
      : null);

  return {
    id: record._id,
    type: "team",
    title: record.teamName || "Team unavailable",
    subtitle: `${record.leader?.name || "Leader unavailable"}${
      record.leader?.email ? ` · ${record.leader.email}` : ""
    }`,
    email: record.leader?.email,
    memberCount: record.memberCount,
    event: record.event
      ? {
          name: record.event.name,
          category: record.event.category,
          startDate: record.event.startDate,
          registrationFee: eventFee ?? undefined,
        }
      : null,
    method: record.payment?.method || "UNKNOWN",
    status: record.payment?.status || "UNKNOWN",
    proofUrl: record.payment?.proofUrl,
    cashReceiverName: record.payment?.cashReceiverName,
    expectedAmount,
    receivedAmount,
    currency: record.payment?.currency,
    verifiedBy: record.payment?.verifiedBy,
    verifiedAt: record.payment?.verifiedAt,
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
