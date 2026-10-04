import { Fragment, forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type RefObject, type SelectHTMLAttributes, type TextareaHTMLAttributes, useEffect, useId, useRef, useState } from "react";
import { X, Inbox, ArrowUpRight, ArrowDownRight, MoreHorizontal } from "lucide-react";
import { useFocusTrap } from "./useFocusTrap";

export function cn(...c: (string | false | null | undefined)[]) { return c.filter(Boolean).join(" "); }

/* ------------------------------------------------------------------ Buttons */
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" | "danger-solid"; size?: "sm" | "md" | "lg" };
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "secondary", size = "md", className, ...p }, ref) {
  const base = "inline-flex items-center justify-center gap-1.5 rounded-crm-md border font-medium whitespace-nowrap transition-colors duration-[120ms] disabled:opacity-50 disabled:cursor-not-allowed";
  const sizes = { sm: "h-7 px-2.5 text-[12px] leading-4", md: "h-8 px-3 text-[13px] leading-5", lg: "h-9 px-3.5 text-[13px] leading-5" };
  const variants = {
    primary: "bg-crm-accent-600 text-white border-crm-accent-600 hover:bg-crm-accent-700 hover:border-crm-accent-700 active:bg-crm-accent-800",
    secondary: "bg-crm-sand-0 text-crm-sand-900 border-crm-sand-200 hover:bg-crm-sand-25 hover:border-crm-sand-300 active:bg-crm-sand-50",
    ghost: "bg-transparent text-crm-sand-700 border-transparent hover:bg-crm-sand-100 hover:text-crm-sand-900 active:bg-crm-sand-150",
    danger: "bg-crm-sand-0 text-crm-danger-600 border-crm-sand-200 hover:bg-crm-danger-50 hover:border-crm-danger-200 active:text-crm-danger-700",
    "danger-solid": "bg-crm-danger-600 text-white border-crm-danger-600 hover:bg-crm-danger-700 hover:border-crm-danger-700 active:bg-crm-danger-700",
  };
  return <button ref={ref} type="button" className={cn(base, sizes[size], variants[variant], className)} {...p} />;
});

/* ------------------------------------------------------------------- Inputs */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(p, ref) {
  return <input ref={ref} {...p} className={cn("field", p.type === "number" && "num", p.className)} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(p, ref) {
  return <textarea ref={ref} {...p} className={cn("field", p.className)} />;
});
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string | number; label: string }[]; placeholder?: string }>(function Select({ options, placeholder, ...p }, ref) {
  return (
    <select ref={ref} {...p} className={cn("field", p.className)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
});
/** Label + control + hint. Pass `error` (and the `errorId` the control's `aria-describedby` points at) to show inline 12px danger-600 text in place of the hint (§6.10). */
export function Field({ label, children, hint, className, error, errorId }: { label: string; children: ReactNode; hint?: string; className?: string; error?: string | null; errorId?: string }) {
  const required = label.trim().endsWith("*");
  const text = required ? label.trim().slice(0, -1).trim() : label;
  return (
    <label className={cn("block", className)}>
      <span className="label">{text}{required && <span className="ml-1 text-crm-danger-600">*</span>}</span>
      {children}
      {error ? <FieldError id={errorId}>{error}</FieldError> : hint && <span className="mt-1 block text-[12px] leading-4 text-crm-sand-500">{hint}</span>}
    </label>
  );
}
/** Inline field error: 12px danger-600, 4px above (§6.10). Give it an `id` and point the control's `aria-describedby` at it. */
export function FieldError({ id, children, className }: { id?: string; children: ReactNode; className?: string }) {
  return <span id={id} role="alert" className={cn("field-error", className)}>{children}</span>;
}

/* ------------------------------------------------------------------- Badges */
type Tone = "slate" | "green" | "red" | "amber" | "blue" | "teal" | "purple" | "neutral" | "success" | "danger" | "warn" | "info" | "accent";
const CANON: Record<Tone, "neutral" | "success" | "danger" | "warn" | "info" | "accent"> = {
  slate: "neutral", neutral: "neutral", green: "success", success: "success", red: "danger", danger: "danger",
  amber: "warn", warn: "warn", blue: "info", info: "info", teal: "accent", purple: "accent", accent: "accent",
};
const PILL: Record<string, string> = {
  neutral: "bg-crm-sand-100 border-crm-sand-150 text-crm-sand-700",
  success: "bg-crm-success-50 border-crm-success-200 text-crm-success-700",
  danger: "bg-crm-danger-50 border-crm-danger-200 text-crm-danger-700",
  warn: "bg-crm-warn-50 border-crm-warn-200 text-crm-warn-700",
  info: "bg-crm-info-50 border-crm-info-200 text-crm-info-700",
  accent: "bg-crm-accent-50 border-crm-accent-200 text-crm-accent-700",
};
const DOT: Record<string, string> = { neutral: "bg-crm-sand-400", success: "bg-crm-success-600", danger: "bg-crm-danger-600", warn: "bg-crm-warn-600", info: "bg-crm-info-600", accent: "bg-crm-accent-600" };
export function Badge({ tone = "slate", dot = false, children, className, title }: { tone?: Tone; dot?: boolean; children: ReactNode; className?: string; title?: string }) {
  const t = CANON[tone] ?? "neutral";
  if (dot) {
    return (
      <span title={title} className={cn("inline-flex items-center gap-1.5 text-[12px] leading-4 font-medium text-crm-sand-900 whitespace-nowrap", className)}>
        <i className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", DOT[t])} aria-hidden />{children}
      </span>
    );
  }
  return <span title={title} className={cn("inline-flex h-5 items-center gap-1 rounded-full border px-2 text-[11px] leading-[14px] font-medium whitespace-nowrap", PILL[t], className)}>{children}</span>;
}
export function statusTone(s: string | null | undefined): Tone {
  switch (s) {
    case "won": case "client": case "clear": case "signed": case "active": case "attended": case "completed": case "waived": return "green";
    case "lost": case "conflict": case "adverse_party": case "unqualified": case "terminated": case "high": return "red";
    case "pending": case "sent": case "contacted": case "on_hold": case "medium": case "drafted": return "amber";
    case "prospect": case "new": case "open": case "registered": case "qualified": return "blue";
    // referral_source / converted are states, not alarms — neutral (§6.8); accent is reserved for action/focus/current (§2.3).
    default: return "slate";
  }
}

/* -------------------------------------------------------------------- Cards */
export function Card({ title, actions, children, className, padded = true, tourId }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean; tourId?: string }) {
  const hasHeader = Boolean(title || actions);
  return (
    <section className={cn("card", !padded && "overflow-hidden", className)} data-tour={tourId}>
      {hasHeader && (
        <header className="flex items-center justify-between gap-4 px-5 pt-3.5 pb-3">
          <h3 className="min-w-0 truncate text-[15px] leading-[22px] font-semibold tracking-[-0.01em] text-crm-sand-900">{title}</h3>
          <div className="flex shrink-0 items-center gap-2 text-[12px] leading-4">{actions}</div>
        </header>
      )}
      <div className={padded ? (hasHeader ? "px-5 pb-5" : "p-5") : ""}>{children}</div>
    </section>
  );
}

/* -------------------------------------------------------------------- Modal */
/** Legacy Tailwind `width` values snap to the §6.11 widths; any other class string passes through unchanged. */
const MODAL_WIDTH: Record<string, string> = { "max-w-lg": "max-w-[560px]", "max-w-xl": "max-w-[560px]", "max-w-2xl": "max-w-[720px]", "max-w-3xl": "max-w-[720px]" };

export type OverlayProps = {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode;
  /** Focus this element on open instead of the first field (e.g. a confirm dialog's Cancel button). */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Suppress the close (×) button; Escape still closes. */
  hideClose?: boolean;
};

/**
 * Centered dialog (§6.11). Default 560px; `size="wide"` 720px. The legacy `width` class prop still works.
 * Capped to the viewport; the body scrolls between the fixed header and footer.
 * Focus: first field on open (else close button), Tab trapped inside, restored to the opener on close; Escape closes.
 */
export function Modal({ open, onClose, title, children, footer, width, size = "default", initialFocus, hideClose }: OverlayProps & { width?: string; size?: "default" | "wide" }) {
  const panel = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useFocusTrap(open, panel, { onClose, initialFocus, closeButton: closeBtn });
  if (!open) return null;
  const w = width ? (MODAL_WIDTH[width] ?? width) : size === "wide" ? "max-w-[720px]" : "max-w-[560px]";
  return (
    <div className="fade-in fixed inset-0 z-crm-modal flex items-start justify-center bg-[rgba(26,25,22,0.32)] p-4 pt-[8vh]" onMouseDown={onClose}>
      <div ref={panel} className={cn("modal-in flex max-h-full w-full flex-col rounded-crm-xl border border-crm-sand-150 bg-crm-sand-0 shadow-crm-modal outline-none", w)} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-crm-sand-150 px-5 py-4">
          <h2 id={titleId} className="min-w-0 truncate text-[15px] leading-[22px] font-semibold tracking-[-0.01em] text-crm-sand-900">{title}</h2>
          {!hideClose && <button ref={closeBtn} type="button" onClick={onClose} aria-label="Close" className="grid h-7 w-7 shrink-0 place-items-center rounded-crm-md text-crm-sand-500 hover:bg-crm-sand-100 hover:text-crm-sand-900"><X size={16} /></button>}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <footer className="flex shrink-0 justify-end gap-2 rounded-b-xl border-t border-crm-sand-150 bg-crm-sand-25 px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- Drawer */
/**
 * Right-anchored panel (§6.11) for Run check / Mark lost / quick edit when the record should stay visible.
 * 480px wide, full height, hairline left border, shadow-crm-modal, 200ms translateX(16px→0). Same props and focus handling as Modal.
 */
export function Drawer({ open, onClose, title, children, footer, initialFocus, hideClose, width = "w-[480px]" }: OverlayProps & { width?: string }) {
  const panel = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useFocusTrap(open, panel, { onClose, initialFocus, closeButton: closeBtn });
  if (!open) return null;
  return (
    <div className="fade-in fixed inset-0 z-crm-drawer flex justify-end bg-[rgba(26,25,22,0.32)]" onMouseDown={onClose}>
      <div ref={panel} className={cn("drawer-in flex h-full max-w-full flex-col border-l border-crm-sand-150 bg-crm-sand-0 shadow-crm-modal outline-none", width)} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-crm-sand-150 px-5 py-4">
          <h2 id={titleId} className="min-w-0 truncate text-[15px] leading-[22px] font-semibold tracking-[-0.01em] text-crm-sand-900">{title}</h2>
          {!hideClose && <button ref={closeBtn} type="button" onClick={onClose} aria-label="Close" className="grid h-7 w-7 shrink-0 place-items-center rounded-crm-md text-crm-sand-500 hover:bg-crm-sand-100 hover:text-crm-sand-900"><X size={16} /></button>}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <footer className="flex shrink-0 justify-end gap-2 border-t border-crm-sand-150 bg-crm-sand-25 px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- OverflowMenu */
export type MenuItem = { label: string; onSelect: () => void; tone?: "danger"; icon?: ReactNode; disabled?: boolean };

/**
 * "⋯" ghost icon button (28px) with a popover menu styled like the search results (§6.2): sand-0, hairline, radius-lg,
 * shadow-crm-menu, 36px items, hover sand-50. Arrow keys move, Enter selects, Escape closes, outside click closes.
 * Sets `data-open` on the root so a hover-revealed parent can keep it visible while open.
 */
export function OverflowMenu({ items, label = "More actions", align = "end", side = "bottom", size = "sm", className, buttonClassName }: {
  items: MenuItem[]; label?: string; align?: "start" | "end"; side?: "bottom" | "top"; size?: "sm" | "md"; className?: string; buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>("[role=menuitem]:not([disabled])")?.focus());
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const close = (refocus = true) => { setOpen(false); if (refocus) btn.current?.focus(); };
  const onKey = (e: React.KeyboardEvent) => {
    const nodes = Array.from(list.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([disabled])") ?? []);
    const i = nodes.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); nodes[(i + 1) % nodes.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); nodes[(i - 1 + nodes.length) % nodes.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); nodes[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); nodes[nodes.length - 1]?.focus(); }
    else if (e.key === "Tab") { close(false); }
  };
  return (
    <div ref={root} className={cn("relative inline-flex", className)} data-open={open || undefined} onKeyDown={onKey}>
      <button ref={btn} type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
              onClick={() => setOpen((o) => !o)}
              onKeyDown={(e) => { if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); setOpen(true); } }}
              className={cn("grid place-items-center rounded-crm-md border border-transparent text-crm-sand-700 transition-colors duration-[120ms] hover:bg-crm-sand-100 hover:text-crm-sand-900 active:bg-crm-sand-150", size === "sm" ? "h-7 w-7" : "h-8 w-8", open && "bg-crm-sand-100 text-crm-sand-900", buttonClassName)}>
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div ref={list} id={menuId} role="menu" aria-label={label}
             className={cn("menu-in absolute z-crm-dropdown min-w-[180px] rounded-crm-lg border border-crm-sand-150 bg-crm-sand-0 py-1 shadow-crm-menu", align === "end" ? "right-0" : "left-0", side === "bottom" ? "top-full mt-1.5" : "bottom-full mb-1.5")}>
          {items.map((it, idx) => (
            <button key={idx} type="button" role="menuitem" disabled={it.disabled} onClick={() => { close(false); btn.current?.focus(); it.onSelect(); }}
                    className={cn("flex h-9 w-full items-center gap-2.5 px-3 text-left text-[13px] leading-5 whitespace-nowrap outline-none transition-colors duration-[120ms] hover:bg-crm-sand-50 focus-visible:bg-crm-sand-50 disabled:cursor-not-allowed disabled:opacity-50",
                      it.tone === "danger" ? "text-crm-danger-600" : "text-crm-sand-900")}>
              {it.icon && <span className={cn("grid w-4 shrink-0 place-items-center [&_svg]:h-3.5 [&_svg]:w-3.5", it.tone === "danger" ? "text-crm-danger-600" : "text-crm-sand-500")}>{it.icon}</span>}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- Empty/Loading */
/** Empty state (§6.16): icon disc, title, optional hint, optional `action` slot (a `secondary` `sm` Button, e.g. "Clear filters"). */
export function Empty({ title = "Nothing here yet", hint, action, icon }: { title?: string; hint?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[360px] flex-col items-center justify-center px-6 py-12 text-center">
      <div className="grid h-8 w-8 place-items-center rounded-full bg-crm-sand-100 text-crm-sand-500">{icon ?? <Inbox size={16} />}</div>
      <div className="mt-3 text-[13px] font-medium text-crm-sand-900">{title}</div>
      {hint && <div className="mt-1 text-[12px] leading-4 text-crm-sand-500">{hint}</div>}
      {action && <div className="mt-4 flex items-center gap-2">{action}</div>}
    </div>
  );
}
/** Loading placeholder. Renders skeleton bars (no spinner) per the design system. */
export function Spinner() {
  return (
    <div className="w-full max-w-[320px] space-y-3 px-5 py-5" role="status" aria-live="polite" aria-label="Loading">
      <span className="skeleton w-3/5" /><span className="skeleton w-2/5" /><span className="skeleton w-[30%]" />
    </div>
  );
}

/* ---------------------------------------------------------------- Sparkline */
export function Sparkline({ data, tone = "accent", className }: { data: number[]; tone?: "accent" | "warn" | "success" | "danger"; className?: string }) {
  if (!data.length) return null;
  const W = 100, H = 28, pad = 2;
  const min = Math.min(...data), max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => [data.length === 1 ? W : (i / (data.length - 1)) * W, pad + (1 - (v - min) / span) * (H - pad * 2)] as const);
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  const area = `${line} L${W} ${H} L0 ${H} Z`;
  const stroke = { accent: "stroke-crm-accent-600", warn: "stroke-crm-warn-600", success: "stroke-crm-success-600", danger: "stroke-crm-danger-600" }[tone];
  const fill = { accent: "fill-crm-accent-600", warn: "fill-crm-warn-600", success: "fill-crm-success-600", danger: "fill-crm-danger-600" }[tone];
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={cn("block h-6 w-full overflow-visible", className)} aria-hidden>
      <path d={area} className={cn(fill, "opacity-[0.08]")} stroke="none" />
      <path d={line} className={cn(stroke, "fill-none")} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <path d={`M${lx.toFixed(2)} ${ly.toFixed(2)} L${lx.toFixed(2)} ${ly.toFixed(2)}`} className={stroke} strokeWidth={5} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* --------------------------------------------------------------------- Stat */
/**
 * KPI tile: label → 24px numeral → delta/context line → optional baseline sparkline.
 * `delta` is a percentage (8.2 → "+8.2%"). `deltaGood` overrides the direction-is-good default
 * (e.g. a rising stale count is bad). `sub` renders as the context phrase after the delta.
 */
export function Stat({ label, value, sub, tone, delta, deltaGood, spark, className }: {
  label: string; value: ReactNode; sub?: ReactNode; tone?: "default" | "warn" | "good"; delta?: number | null; deltaGood?: boolean; spark?: number[]; className?: string;
}) {
  const good = delta == null ? undefined : deltaGood ?? delta >= 0;
  const deltaCls = delta == null || delta === 0 ? "text-crm-sand-500" : good ? "text-crm-success-600" : "text-crm-danger-600";
  const Arrow = delta != null && delta < 0 ? ArrowDownRight : ArrowUpRight;
  return (
    <div className={cn("card flex min-h-[128px] flex-col px-5 pt-4 pb-3.5", className)}>
      <div className="text-[12px] leading-4 font-medium text-crm-sand-600 whitespace-nowrap truncate">{label}</div>
      <div className={cn("mt-2 text-[24px] leading-7 font-semibold tracking-[-0.02em] num", tone === "warn" && "text-crm-warn-700", tone === "good" && "text-crm-success-700")}>{value}</div>
      {(delta != null || sub) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[12px] leading-4 text-crm-sand-500">
          {delta != null && (
            <span className={cn("inline-flex items-center gap-0.5 font-medium num", deltaCls)}>
              {delta !== 0 && <Arrow size={12} strokeWidth={2} />}{delta === 0 ? "—" : `${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)}%`}
            </span>
          )}
          {sub && <span className="whitespace-nowrap">{sub}</span>}
        </div>
      )}
      {spark && spark.length > 1 && <Sparkline data={spark} tone={tone === "warn" ? "warn" : "accent"} className="mt-auto pt-2.5 box-content" />}
    </div>
  );
}

/* --------------------------------------------------------------------- Tabs */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string; count?: number }[]; value: T; onChange: (k: T) => void }) {
  return (
    <div className="flex gap-5 border-b border-crm-sand-150" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={value === t.key} onClick={() => onChange(t.key)}
                className={cn("-mb-px h-9 border-b-2 px-0.5 text-[13px] font-medium transition-colors duration-[120ms]", value === t.key ? "border-crm-sand-900 text-crm-sand-900" : "border-transparent text-crm-sand-600 hover:text-crm-sand-900")}>
          {t.label}{t.count !== undefined && <span className="mono ml-1.5 text-[11px] text-crm-sand-500">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- PageHeader */
export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-[20px] leading-7 font-semibold tracking-[-0.015em] text-crm-sand-900">{title}</h1>
        {subtitle && <div className="mt-1 text-[12px] leading-4 text-crm-sand-500 [&_a]:text-crm-sand-700 [&_a:hover]:text-crm-sand-900">{subtitle}</div>}
      </div>
      <div className="flex items-center gap-2">{actions}</div>
    </div>
  );
}

/* ----------------------------------------------------------------------- DL */
/** Key-facts grid (Stripe detail-page pattern): label over value, auto-filling columns. Items may span columns. */
export function DL({ items, columns }: { items: { label: string; value: ReactNode; span?: number }[]; columns?: number }) {
  return (
    <dl className="crm-details-grid grid gap-x-6 gap-y-4 text-[13px]" style={{ gridTemplateColumns: columns ? `repeat(${columns}, minmax(0, 1fr))` : "repeat(auto-fill, minmax(200px, 1fr))" }}>
      {items.map((i) => (
        <Fragment key={i.label}>
          <div className="min-w-0" style={i.span ? { gridColumn: `span ${i.span} / span ${i.span}` } : undefined}>
            <dt className="text-[12px] leading-4 font-medium text-crm-sand-600">{i.label}</dt>
            <dd className="mt-0.5 min-w-0 break-words text-crm-sand-900">{i.value ?? <span className="text-crm-sand-300">—</span>}</dd>
          </div>
        </Fragment>
      ))}
    </dl>
  );
}
