import type { ReactNode } from "react";

export default function PageHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="page-header">
    <div><p className="page-eyebrow">VIBRANT ADMIN</p><h1>{title}</h1><p className="page-description">{description}</p></div>
    {action && <div className="page-header-action">{action}</div>}
  </div>;
}
