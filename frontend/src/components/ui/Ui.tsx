"use client";

import { ErrorToasts } from "@/context/ToastContext";
import { useEffect, type ReactNode } from "react";

export const Skeleton = ({ rows = 4 }: { rows?: number }) => (
  <div className="skeleton-wrap" aria-busy="true">
    {Array.from({ length: rows }, (_, i) => (
      <div key={i} className="skeleton" style={{ width: `${100 - i * 8}%` }} />
    ))}
  </div>
);

export const EmptyState = ({ title, hint }: { title: string; hint?: string }) => (
  <div className="empty">
    <div className="empty-icon">◌</div>
    <strong>{title}</strong>
    {hint && <p>{hint}</p>}
  </div>
);

export const ErrorState = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
  <div className="empty error">
    <strong>Something went wrong</strong>
    <p>This could not be loaded.</p>
    <ErrorToasts errors={message} />
    {onRetry && (
      <button className="btn btn-outline" onClick={onRetry}>
        Retry
      </button>
    )}
  </div>
);

export function Modal({
  title,
  onClose,
  children,
  wide,
  className,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className={`modal${wide ? " modal-wide" : ""}${className ? ` ${className}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="muted">{message}</p>
      <div className="actions-row">
        <button className="btn btn-outline" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={onConfirm} disabled={busy}>
          {busy ? "Please wait…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export const StatusBadge = ({ status }: { status: "PENDING" | "CREATED" | "PARTIAL" }) => (
  <span className={`badge badge-${status.toLowerCase()}`}>
    {status === "CREATED" ? "Budget Created" : status === "PARTIAL" ? "Partially Budgeted" : "Budget Pending"}
  </span>
);
