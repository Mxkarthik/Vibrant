import type { ReactNode } from "react";

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: ReactNode;
  tone?: "blue" | "navy" | "success" | "warning";
}

export default function MetricCard({
  title,
  value,
  subtitle,
  icon,
  tone = "blue",
}: MetricCardProps) {
  return (
    <div className="metric-card">
      <div className="metric-header">
        <span className="metric-title">{title}</span>
        <div className={`metric-icon-wrap metric-icon-${tone}`}>{icon}</div>
      </div>
      <div className="metric-value">{value}</div>
      {subtitle && <div className="metric-subtitle">{subtitle}</div>}
    </div>
  );
}
