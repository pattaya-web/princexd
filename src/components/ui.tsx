"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

/* ------------------------------- Layout ------------------------------- */

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 mb-5">
      <div>
        <h1 className="text-[19px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="muted text-[13px] mt-0.5 max-w-2xl">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </header>
  );
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = "",
  padded = true,
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-3 border-b" style={{ borderColor: "var(--border)" }}>
          <div>
            {title && <h2 className="text-[13px] font-semibold">{title}</h2>}
            {subtitle && <p className="dim text-[12px] mt-0.5">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
        </div>
      )}
      <div className={padded ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="text-center py-10 px-4">
      <p className="dim text-[13px] max-w-md mx-auto leading-relaxed">{children}</p>
      {action && <div className="mt-3.5 flex justify-center">{action}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 muted text-[13px]">
      <span className="spinner" />
      {label}
    </span>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div
      className="rounded-lg px-3 py-2.5 text-[12.5px] leading-relaxed"
      style={{
        background: "color-mix(in srgb, var(--critical) 10%, transparent)",
        border: "1px solid color-mix(in srgb, var(--critical) 30%, transparent)",
        color: "var(--critical)",
      }}
    >
      {children}
    </div>
  );
}

export function InfoNote({ children }: { children: ReactNode }) {
  return (
    <div
      className="rounded-lg px-3 py-2.5 text-[12.5px] leading-relaxed"
      style={{ background: "var(--surface-3)", border: "1px solid var(--border)", color: "var(--text-2)" }}
    >
      {children}
    </div>
  );
}

/* -------------------------------- Stats ------------------------------- */

export function StatTile({
  label,
  value,
  hint,
  trend,
  accent,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  trend?: number;
  accent?: string;
}) {
  return (
    <div className="card px-4 py-3.5">
      <div className="label-xs">{label}</div>
      <div className="flex items-baseline gap-2 mt-1.5">
        <span className="text-[24px] font-semibold num tracking-tight" style={accent ? { color: accent } : undefined}>
          {value}
        </span>
        {trend !== undefined && trend !== 0 && (
          <span
            className="text-[12px] font-semibold num"
            style={{ color: trend > 0 ? "var(--good)" : "var(--critical)" }}
          >
            {trend > 0 ? "▲" : "▼"} {Math.abs(trend).toLocaleString("fr-FR")}
          </span>
        )}
      </div>
      {hint && <div className="dim text-[12px] mt-1">{hint}</div>}
    </div>
  );
}

/* -------------------------------- Modal ------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8"
      style={{ background: "rgb(0 0 0 / 0.5)", backdropFilter: "blur(2px)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`card fade-in w-full ${wide ? "max-w-4xl" : "max-w-xl"} my-auto`}>
        <div
          className="flex items-center justify-between gap-3 px-4 py-3 border-b sticky top-0 z-10"
          style={{ borderColor: "var(--border)", background: "var(--surface)", borderTopLeftRadius: "var(--radius)", borderTopRightRadius: "var(--radius)" }}
        >
          <h2 className="text-[14px] font-semibold">{title}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <div className="p-4">{children}</div>
        {footer && (
          <div
            className="flex justify-end gap-2 px-4 py-3 border-t"
            style={{ borderColor: "var(--border)", background: "var(--surface-2)", borderBottomLeftRadius: "var(--radius)", borderBottomRightRadius: "var(--radius)" }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------- Champs ------------------------------ */

export function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="label-xs block mb-1.5">{label}</span>
      {children}
      {hint && <span className="dim text-[11.5px] block mt-1 leading-snug">{hint}</span>}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 text-[13px]"
    >
      <span
        className="relative inline-block rounded-full transition-colors"
        style={{
          width: 34,
          height: 19,
          background: checked ? "var(--accent)" : "var(--border-strong)",
        }}
      >
        <span
          className="absolute rounded-full transition-transform"
          style={{
            width: 15,
            height: 15,
            top: 2,
            left: 2,
            background: "#fff",
            transform: checked ? "translateX(15px)" : "none",
          }}
        />
      </span>
      {label && <span>{label}</span>}
    </button>
  );
}

export function CopyButton({ text, label = "Copier" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn btn-sm btn-ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch {
          setDone(false);
        }
      }}
    >
      {done ? "✓ Copié" : label}
    </button>
  );
}

/* -------------------------------- Toasts ------------------------------ */

interface Toast {
  id: number;
  msg: string;
  kind: "ok" | "err";
}

const ToastCtx = createContext<(msg: string, kind?: "ok" | "err") => void>(() => {});

export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);

  const push = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, msg, kind }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), kind === "err" ? 7000 : 3200);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
        {items.map((t) => (
          <div
            key={t.id}
            className="card fade-in px-3.5 py-2.5 text-[13px] leading-snug"
            style={
              t.kind === "err"
                ? {
                    borderColor: "color-mix(in srgb, var(--critical) 40%, transparent)",
                    color: "var(--critical)",
                  }
                : undefined
            }
            role="status"
          >
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* --------------------------------- Tabs ------------------------------- */

export function Tabs<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; count?: number }[];
}) {
  return (
    <div className="flex gap-1 p-1 rounded-[10px] overflow-x-auto" style={{ background: "var(--surface-3)" }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className="px-3 h-[28px] rounded-[7px] text-[12.5px] font-medium transition-colors whitespace-nowrap"
            style={{
              background: active ? "var(--surface)" : "transparent",
              color: active ? "var(--text)" : "var(--text-2)",
              boxShadow: active ? "var(--shadow)" : "none",
            }}
          >
            {o.label}
            {o.count !== undefined && <span className="dim ml-1.5 num">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
