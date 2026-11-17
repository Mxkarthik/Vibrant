import { useState } from "react";
import { AlertCircle, X } from "lucide-react";
import { useAccessibleDialog } from "../../hooks/useAccessibleDialog";

interface ProofPreviewModalProps {
  url: string;
  onClose: () => void;
}

export default function ProofPreviewModal({ url, onClose }: ProofPreviewModalProps) {
  const [loadError, setLoadError] = useState(false);
  const dialogRef = useAccessibleDialog(onClose);

  return (
    <div
      className="proof-preview-backdrop"
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="proof-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Payment proof preview"
      >
        <button className="payment-close" onClick={onClose} aria-label="Close image preview">
          <X size={19} />
        </button>

        {loadError ? (
          <div className="payment-proof-error-state" role="alert">
            <AlertCircle size={24} />
            <p>Payment proof image could not be loaded or is inaccessible.</p>
          </div>
        ) : (
          <img
            src={url}
            alt="Full payment proof"
            onError={() => setLoadError(true)}
          />
        )}
      </section>
    </div>
  );
}
