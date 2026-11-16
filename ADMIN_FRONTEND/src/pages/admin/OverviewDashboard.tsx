import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, ArrowRight, CalendarDays, CheckCircle2, CircleDollarSign, Clock3, RefreshCw, Users, UserRoundCog, WalletCards } from "lucide-react";
import { getAdminDashboard, type AdminDashboardData } from "../../api/adminDashboard";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import PageHeader from "../../components/admin/PageHeader";

const numberFormat = new Intl.NumberFormat("en-IN");
const dateFormat = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const kpis = [
  { label: "Total Events", key: "totalEvents", icon: CalendarDays, tone: "blue" },
  { label: "Total Registrations", key: "totalRegistrations", icon: Users, tone: "navy" },
  { label: "Pending Payments", key: "pendingPayments", icon: Clock3, tone: "warning" },
  { label: "Total Organisers", key: "totalOrganisers", icon: UserRoundCog, tone: "success" },
] as const;

export default function OverviewDashboard() {
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const result = await getAdminDashboard();
      setData(result);
    } catch {
      setError("Dashboard information could not be loaded. Check your connection and try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void loadDashboard(); }, [loadDashboard]);

  const pendingPayments = data ? data.payments.pendingIndividual + data.payments.pendingTeams : 0;
  const eventStatuses = data ? [
    { label: "Published", value: data.overview.publishedEvents, color: "published" },
    { label: "Completed", value: data.overview.completedEvents, color: "completed" },
    { label: "Cancelled", value: data.overview.cancelledEvents, color: "cancelled" },
  ] : [];

  return <>
    <PageHeader title="Overview" description="A snapshot of your VIBRANT platform." action={
      <Button variant="secondary" icon={<RefreshCw size={15} className={refreshing ? "is-spinning" : ""} />} onClick={() => void loadDashboard(true)} disabled={loading || refreshing}>
        {refreshing ? "Refreshing" : "Refresh"}
      </Button>
    } />

    {error && <Card className="dashboard-error" role="alert">
      <div><strong>Unable to load overview</strong><p>{error}</p></div>
      <Button variant="secondary" onClick={() => void loadDashboard()}>Try again</Button>
    </Card>}

    {!error && <>
      <section className="kpi-grid" aria-label="Platform overview">
        {kpis.map(item => {
          const value = !data ? null : item.key === "pendingPayments" ? pendingPayments : data.overview[item.key];
          const Icon = item.icon;
          return <Card className="kpi-card" key={item.key}>
            {loading || !data ? <KpiSkeleton /> : <>
              <div className={`kpi-icon tone-${item.tone}`}><Icon size={18} strokeWidth={1.8} /></div>
              <p className="kpi-label">{item.label}</p>
              <p className="kpi-value">{numberFormat.format(value ?? 0)}</p>
              {item.key === "pendingPayments" && <span className="kpi-note">Individual + team</span>}
            </>}
          </Card>;
        })}
      </section>

      <section className="dashboard-main-grid">
        <Card className="dashboard-panel event-stat-panel">
          <PanelHeading icon={<Activity size={17} />} title="Event statistics" subtitle="Status breakdown across all events" />
          {loading || !data ? <PanelSkeleton /> : <>
            <div className="event-total"><strong>{numberFormat.format(data.overview.totalEvents)}</strong><span>Total events</span></div>
            <div className="status-bar" role="img" aria-label={eventStatuses.map(item => `${item.label}: ${item.value}`).join(", ")}>
              {eventStatuses.map(item => <span key={item.label} className={`status-segment ${item.color}`} style={{ width: `${data.overview.totalEvents ? item.value / data.overview.totalEvents * 100 : 0}%` }} />)}
            </div>
            <div className="status-legend">{eventStatuses.map(item => <div className="legend-item" key={item.label}><span className={`legend-dot ${item.color}`} /><span>{item.label}</span><strong>{numberFormat.format(item.value)}</strong></div>)}</div>
          </>}
        </Card>

        <Card className="dashboard-panel payment-panel">
          <PanelHeading icon={<WalletCards size={17} />} title="Payment summary" subtitle="Payment records by registration type" />
          {loading || !data ? <PanelSkeleton /> : <div className="payment-summary">
            <PaymentRow icon={<Users size={16} />} label="Individual registrations" pending={data.payments.pendingIndividual} verified={data.payments.verifiedIndividual} />
            <div className="payment-divider" />
            <PaymentRow icon={<UserRoundCog size={16} />} label="Team registrations" pending={data.payments.pendingTeams} verified={data.payments.verifiedTeams} />
          </div>}
        </Card>
      </section>

      <section className="dashboard-lower-grid">
        <Card className="dashboard-panel attendance-panel">
          <PanelHeading icon={<CheckCircle2 size={17} />} title="Attendance" subtitle="Across active registrations" />
          {loading || !data ? <PanelSkeleton /> : <div className="attendance-content">
            <div className="attendance-rate">{data.attendance.attendancePercentage.toFixed(1)}<span>%</span></div>
            <div className="attendance-detail"><strong>{numberFormat.format(data.attendance.totalCheckedIn)}</strong> checked in <span className="detail-separator">of</span> <strong>{numberFormat.format(data.attendance.totalRegistered)}</strong> eligible registrations</div>
            <div className="attendance-track"><span style={{ width: `${Math.min(100, Math.max(0, data.attendance.attendancePercentage))}%` }} /></div>
          </div>}
        </Card>

        <Card className="dashboard-panel quick-actions-panel">
          <PanelHeading icon={<CircleDollarSign size={17} />} title="Quick actions" subtitle="Go to a workspace" />
          <div className="quick-action-list">
            <QuickAction to="/admin/events" label="Create event" />
            <QuickAction to="/admin/payments" label="Manage payments" />
            <QuickAction to="/admin/participants" label="View participants" />
            <QuickAction to="/admin/organisers" label="Manage organisers" />
          </div>
        </Card>
      </section>

      <Card className="dashboard-panel recent-events-panel">
        <div className="recent-events-heading"><PanelHeading icon={<CalendarDays size={17} />} title="Recent events" subtitle="Recently created across VIBRANT" /><Link to="/admin/events" className="text-link">View events <ArrowRight size={14} /></Link></div>
        {loading || !data ? <RecentEventsSkeleton /> : data.recentEvents.length === 0 ? <div className="recent-empty"><CalendarDays size={19} /><span>No events have been created yet.</span></div> : <div className="recent-events-table-wrap"><table className="recent-events-table"><thead><tr><th>Event</th><th>Category</th><th>Event date</th><th>Venue</th><th>Status</th></tr></thead><tbody>
          {data.recentEvents.map((event, index) => <tr key={`${event.name}-${event.createdAt}-${index}`}>
            <td className="event-name-cell">{event.name}</td><td>{titleCase(event.category)}</td><td>{formatDate(event.startDate)}</td><td className="event-venue-cell">{event.venue}</td><td><span className={`event-status status-${event.status.toLowerCase()}`}>{titleCase(event.status)}</span></td>
          </tr>)}
        </tbody></table></div>}
      </Card>
    </>}
  </>;
}

function PanelHeading({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return <div className="panel-heading"><span className="panel-heading-icon">{icon}</span><div><h2>{title}</h2><p>{subtitle}</p></div></div>;
}

function PaymentRow({ icon, label, pending, verified }: { icon: React.ReactNode; label: string; pending: number; verified: number }) {
  return <div className="payment-row"><div className="payment-type"><span className="payment-type-icon">{icon}</span><strong>{label}</strong></div><div className="payment-counts"><span className="payment-pill pending"><i />{numberFormat.format(pending)} pending</span><span className="payment-pill verified"><i />{numberFormat.format(verified)} verified</span></div></div>;
}

function QuickAction({ to, label }: { to: string; label: string }) {
  return <Link to={to} className="quick-action"><span>{label}</span><ArrowRight size={15} /></Link>;
}

function KpiSkeleton() {
  return <div className="kpi-skeleton" aria-label="Loading metric"><span className="skeleton-block skeleton-icon" /><span className="skeleton-block skeleton-label" /><span className="skeleton-block skeleton-value" /></div>;
}

function PanelSkeleton() {
  return <div className="panel-skeleton" aria-label="Loading dashboard section"><span /><span /><span /></div>;
}

function RecentEventsSkeleton() {
  return <div className="recent-skeleton" aria-label="Loading recent events">{[0, 1, 2].map(item => <span key={item} />)}</div>;
}

function titleCase(value: string) {
  return value.toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase());
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateFormat.format(date);
}
