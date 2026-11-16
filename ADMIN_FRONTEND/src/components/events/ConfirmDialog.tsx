import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import Button from "../ui/Button";

interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({ title, description, confirmLabel, cancelLabel = "Keep event", busy = false, onConfirm, onCancel }: ConfirmDialogProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);
  return <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
    <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description">
      <div className="confirm-icon"><AlertTriangle size={19} /></div>
      <h2 id="confirm-title">{title}</h2><p id="confirm-description">{description}</p>
      <div className="dialog-actions"><Button variant="secondary" onClick={onCancel} disabled={busy}>{cancelLabel}</Button><Button variant="primary" className="button-danger" onClick={onConfirm} disabled={busy}>{busy ? "Working..." : confirmLabel}</Button></div>
    </section>
  </div>;
}
