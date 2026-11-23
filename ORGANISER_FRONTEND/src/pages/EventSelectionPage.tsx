import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Calendar,
  MapPin,
  Search,
  RefreshCw,
  Layers,
  QrCode,
  BarChart2,
  AlertCircle,
  Clock,
  X,
  ChevronDown,
  ChevronUp,
  Info,
  CheckCircle2,
} from "lucide-react";
import {
  getEvents,
  filterAccessibleEvents,
  type AccessibleEventRecord,
} from "../api/eventService";
import { useAuth } from "../auth/AuthContext";
import { getApiErrorMessage } from "../api/client";
import { setActiveEventId } from "../utils/activeEventStorage";

type EventFilterType = "ALL" | "EVENTS" | "PACKAGES";

export default function EventSelectionPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<EventFilterType>("ALL");
  const [expandedPackageId, setExpandedPackageId] = useState<string | null>(null);

  // Sourced from existing query contracts
  const {
    data: rawEvents = [],
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["events", user?.id],
    queryFn: getEvents,
    staleTime: 60000,
  });

  // Role and organizer assignment filtering
  const accessibleEvents = useMemo(() => {
    return filterAccessibleEvents(rawEvents, user);
  }, [rawEvents, user]);

  // Fast lookup map for child event details
  const eventLookupMap = useMemo(() => {
    const map = new Map<string, AccessibleEventRecord>();
    for (const evt of accessibleEvents) {
      map.set(evt._id, evt);
    }
    return map;
  }, [accessibleEvents]);

  // Accurate classification: combo parents strictly identified by multiEventAccess.enabled === true
  const isComboPackage = (evt: AccessibleEventRecord): boolean => {
    return Boolean(evt.multiEventAccess?.enabled);
  };

  // Filter tab counts
  const counts = useMemo(() => {
    const all = accessibleEvents.length;
    let events = 0;
    let packages = 0;

    for (const evt of accessibleEvents) {
      if (isComboPackage(evt)) {
        packages++;
      } else {
        events++;
      }
    }

    return { all, events, packages };
  }, [accessibleEvents]);

  // Client-side search and segmented filter over accessible events
  const filteredEvents = useMemo(() => {
    return accessibleEvents.filter((evt) => {
      // 1. Segmented filter
      if (filterType === "EVENTS" && isComboPackage(evt)) {
        return false;
      }
      if (filterType === "PACKAGES" && !isComboPackage(evt)) {
        return false;
      }

      // 2. Search query over existing fields
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;

      const nameMatch = evt.name?.toLowerCase().includes(q);
      const descMatch = evt.description?.toLowerCase().includes(q);
      const venueMatch = evt.venue?.toLowerCase().includes(q);
      const categoryMatch = evt.category?.toLowerCase().includes(q);

      return Boolean(nameMatch || descMatch || venueMatch || categoryMatch);
    });
  }, [accessibleEvents, filterType, searchQuery]);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "";
    try {
      return new Date(dateStr).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  const handleOpenScanner = (eventId: string) => {
    setActiveEventId(eventId);
    navigate(`/events/${eventId}/scanner`);
  };

  const handleOpenDashboard = (eventId: string) => {
    setActiveEventId(eventId);
    navigate(`/events/${eventId}/dashboard`);
  };

  const togglePackageExpand = (packageId: string) => {
    setExpandedPackageId((prev) => (prev === packageId ? null : packageId));
  };

  return (
    <div className="container events-page-container">
      {/* 1. Modern Page Header */}
      <div className="events-header">
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
          <div>
            <h1 className="events-header-title">Events</h1>
            <p className="events-header-subtitle">
              Select an individual event venue to open scanner or manage attendance.
            </p>
          </div>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void refetch()}
            disabled={isFetching}
            aria-label="Refresh events list"
            style={{ padding: "8px 14px", fontSize: "13px" }}
          >
            <RefreshCw size={13} className={isFetching ? "is-spinning" : ""} />
            <span>{isFetching ? "Refreshing…" : "Refresh"}</span>
          </button>
        </div>
      </div>

      {/* 2. Rounded Search Input */}
      <div className="events-search-bar">
        <div className="events-search-box">
          <Search size={16} className="events-search-icon" />
          <input
            type="text"
            className="events-search-input"
            placeholder="Search events…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search events by title, venue, or category"
          />
          {searchQuery && (
            <button
              type="button"
              className="events-search-clear"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search input"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {/* 3. All / Events / Packages Segmented Filter */}
      <div className="events-filter-pills" role="tablist" aria-label="Event Filter">
        <button
          type="button"
          role="tab"
          aria-selected={filterType === "ALL"}
          className={`events-filter-pill ${filterType === "ALL" ? "is-active" : ""}`}
          onClick={() => setFilterType("ALL")}
        >
          <span>All</span>
          <span className="pill-count">{counts.all}</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={filterType === "EVENTS"}
          className={`events-filter-pill ${filterType === "EVENTS" ? "is-active" : ""}`}
          onClick={() => setFilterType("EVENTS")}
        >
          <span>Events</span>
          <span className="pill-count">{counts.events}</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={filterType === "PACKAGES"}
          className={`events-filter-pill ${filterType === "PACKAGES" ? "is-active" : ""}`}
          onClick={() => setFilterType("PACKAGES")}
        >
          <span>Packages</span>
          <span className="pill-count">{counts.packages}</span>
        </button>
      </div>

      {/* 4. Loading Skeleton */}
      {isLoading && (
        <div className="events-list">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="modern-event-card"
              style={{
                minHeight: "120px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <RefreshCw size={24} className="is-spinning" style={{ color: "var(--primary)" }} />
            </div>
          ))}
        </div>
      )}

      {/* 5. Error Banner */}
      {isError && (
        <div
          style={{
            background: "var(--error-bg)",
            border: "1px solid var(--error-border)",
            borderRadius: "var(--radius-md)",
            padding: "20px",
            marginBottom: "24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            color: "var(--error)",
          }}
          role="alert"
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <AlertCircle size={20} style={{ flexShrink: 0 }} />
            <div>
              <strong style={{ display: "block", fontSize: "14px" }}>Failed to load events.</strong>
              <span style={{ fontSize: "13px" }}>{getApiErrorMessage(error, "Please check your network connection.")}</span>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void refetch()}
            style={{ flexShrink: 0 }}
          >
            Retry
          </button>
        </div>
      )}

      {/* 6. Empty State */}
      {!isLoading && !isError && filteredEvents.length === 0 && (
        <div
          style={{
            background: "var(--white)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            padding: "48px 20px",
            textAlign: "center",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <Calendar size={36} style={{ color: "var(--muted)", margin: "0 auto 12px" }} />
          <h2 style={{ fontSize: "16px", fontWeight: 700, color: "var(--navy)", marginBottom: "6px" }}>
            No Events Found
          </h2>
          <p style={{ fontSize: "13px", color: "var(--secondary)", maxWidth: "380px", margin: "0 auto 18px" }}>
            {searchQuery || filterType !== "ALL"
              ? "No events match your current search or filter criteria. Try resetting your filters."
              : "You are not assigned to any published events. Please contact the Lead Administrator."}
          </p>
          {(searchQuery || filterType !== "ALL") && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setSearchQuery("");
                setFilterType("ALL");
              }}
            >
              Clear Filters
            </button>
          )}
        </div>
      )}

      {/* 7. Modern Event Cards List (Matching Visual Reference Screen 4) */}
      {!isLoading && !isError && filteredEvents.length > 0 && (
        <div className="events-list">
          {filteredEvents.map((evt) => {
            const isPkg = isComboPackage(evt);
            const isExpanded = expandedPackageId === evt._id;
            const childIds = evt.multiEventAccess?.includedEvents || [];

            return (
              <div
                key={evt._id}
                className="modern-event-card"
                data-testid={`event-card-${evt._id}`}
              >
                {/* Card Top Row */}
                <div className="modern-event-card-top">
                  <div className="modern-event-card-main">
                    <div className={`modern-event-icon-box ${isPkg ? "is-package" : ""}`}>
                      {isPkg ? <Layers size={22} /> : <Calendar size={22} />}
                    </div>

                    <div className="modern-event-content">
                      <div className="modern-event-title-row">
                        <h2 className="modern-event-name">{evt.name}</h2>
                        {isPkg ? (
                          <span className="modern-event-tag tag-package">Combo</span>
                        ) : (
                          <span className="modern-event-tag tag-individual">Event</span>
                        )}
                      </div>

                      <div className="modern-event-meta">
                        {evt.startDate && (
                          <span className="modern-event-meta-item">
                            <Clock size={12} />
                            <span>{formatDate(evt.startDate)}</span>
                          </span>
                        )}

                        {evt.venue && !isPkg && (
                          <span className="modern-event-meta-item">
                            <MapPin size={12} />
                            <span>{evt.venue}</span>
                          </span>
                        )}

                        {evt.category && (
                          <span className="modern-event-meta-item">
                            <span>{evt.category}</span>
                          </span>
                        )}

                        {isPkg && (
                          <span className="modern-event-meta-item" style={{ color: "#D97706", fontWeight: 600 }}>
                            Includes {childIds.length} Child Events
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Optional Event Description */}
                {evt.description && (
                  <p className="modern-event-description">{evt.description}</p>
                )}

                {/* Combo Pass Package Explanatory Callout */}
                {isPkg && (
                  <div className="modern-event-package-callout">
                    <Info size={16} style={{ flexShrink: 0, marginTop: "1px" }} />
                    <div>
                      <strong>Multi-Event Package:</strong> This is a registration package, not a physical venue.
                      Attendance cannot be recorded against this parent package directly.
                    </div>
                  </div>
                )}

                {/* Expandable Included Child Venues (For Combo Packages) */}
                {isPkg && isExpanded && (
                  <div className="modern-event-child-venues">
                    <div className="modern-event-child-header">
                      <CheckCircle2 size={14} color="var(--primary)" />
                      <span>Included Event Venues ({childIds.length}):</span>
                    </div>

                    {childIds.length === 0 ? (
                      <p style={{ fontSize: "12px", color: "var(--secondary)", margin: 0 }}>
                        No child venues configured for this package.
                      </p>
                    ) : (
                      childIds.map((cId) => {
                        const childEvt = eventLookupMap.get(cId);
                        const isAccessible = Boolean(childEvt);

                        return (
                          <div key={cId} className="modern-event-child-item">
                            <div>
                              <strong style={{ color: "var(--navy)", display: "block" }}>
                                {childEvt ? childEvt.name : `Event Venue (${cId.slice(-6)})`}
                              </strong>
                              {childEvt?.venue && (
                                <span style={{ fontSize: "11px", color: "var(--secondary)" }}>
                                  {childEvt.venue}
                                </span>
                              )}
                            </div>

                            {isAccessible && childEvt ? (
                              <button
                                type="button"
                                className="btn btn-primary"
                                onClick={() => handleOpenScanner(childEvt._id)}
                                style={{ padding: "6px 12px", fontSize: "12px", fontWeight: 700 }}
                              >
                                <QrCode size={13} />
                                <span>Open Scanner</span>
                              </button>
                            ) : (
                              <span style={{ fontSize: "11px", color: "var(--secondary)", fontStyle: "italic" }}>
                                Not Assigned
                              </span>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

                {/* Card Action Footer */}
                <div className="modern-event-actions-bar">
                  {!isPkg ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => handleOpenScanner(evt._id)}
                        style={{ padding: "9px 18px", fontSize: "13px", fontWeight: 700 }}
                      >
                        <QrCode size={15} />
                        <span>Open Scanner</span>
                      </button>

                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => handleOpenDashboard(evt._id)}
                        style={{ padding: "9px 16px", fontSize: "13px" }}
                      >
                        <BarChart2 size={14} />
                        <span>Dashboard</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => togglePackageExpand(evt._id)}
                        style={{ padding: "9px 16px", fontSize: "13px", fontWeight: 600 }}
                      >
                        <span>{isExpanded ? "Hide Venues" : "View Package Details"}</span>
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>

                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => handleOpenDashboard(evt._id)}
                        style={{ padding: "9px 16px", fontSize: "13px" }}
                      >
                        <BarChart2 size={14} />
                        <span>Dashboard</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
