/* Schema-driven form: one definition renders create + edit modals consistently.
   Validation (§6.10; records QA P1 #4): `noValidate` on the form, per-field touched/invalid tracking, inline 12px danger-600
   error text, `aria-invalid` + `aria-describedby`. Rules: required, email, number/money min-max. */
import { forwardRef, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type InputHTMLAttributes } from "react";
import { Button, Field, Input, Modal, Select, Textarea, cn } from "./index";
import { useCrmContext } from "@/components/firmcrm/lib/auth";
import { useToast } from "./Toast";
import { TemplateField } from "@/components/firmcrm/components/billing/TemplateField";
import type { PlaceholderValues } from "@/components/firmcrm/components/billing/templatePlaceholders";
import { HEX_FORMAT, applyFormat, type InputFormat } from "@/components/firmcrm/lib/inputFormat";

export type FieldType = "text" | "number" | "money" | "email" | "password" | "date" | "select" | "textarea" | "checkbox" | "tags" | "template" | "color";
export type FieldDef = {
  name: string; label: string; type?: FieldType;
  options?: { value: string | number; label: string }[]; required?: boolean; placeholder?: string; hint?: string; span?: 1 | 2; step?: string;
  /** Numeric bounds for `number` / `money` fields. */
  min?: number; max?: number;
  /** Custom rule; return an error string or null. Runs after the built-in rules. */
  validate?: (value: unknown, values: FormValues) => string | null | undefined;
  /** `template` fields: multi-line editor, max length, and the placeholder values shown in the live preview. */
  multiline?: boolean; maxLength?: number; previewValues?: PlaceholderValues;
  /** Text-like fields: reformat as the user types (phone, ZIP, routing number…). */
  format?: InputFormat;
  inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"]; autoComplete?: string;
};
export type FormValues = Record<string, unknown>;
export type FormErrors = Record<string, string>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isBlank = (v: unknown) => v == null || v === "" || (Array.isArray(v) && v.length === 0);
const labelText = (f: FieldDef) => f.label.replace(/\s*\*\s*$/, "");

/** Built-in rules for one field. Returns the error message or null. */
export function validateField(f: FieldDef, value: unknown, values: FormValues = {}): string | null {
  if (f.type === "checkbox") return f.validate?.(value, values) ?? null;
  if (f.required && isBlank(value)) return `${labelText(f)} is required.`;
  if (!isBlank(value)) {
    if (f.type === "email" && typeof value === "string" && !EMAIL.test(value.trim())) return "Enter a valid email address.";
    if (f.type === "number" || f.type === "money") {
      const n = typeof value === "number" ? value : Number(value);
      if (Number.isNaN(n)) return "Enter a number.";
      if (f.min != null && n < f.min) return `Must be at least ${fmtBound(f, f.min)}.`;
      if (f.max != null && n > f.max) return `Must be at most ${fmtBound(f, f.max)}.`;
    }
  }
  return f.validate?.(value, values) ?? null;
}
const fmtBound = (_f: FieldDef, n: number) => n.toLocaleString("en-US");

/** All built-in rules across a field list. Empty object means valid. */
export function validateFields(fields: FieldDef[], values: FormValues): FormErrors {
  const out: FormErrors = {};
  for (const f of fields) { const e = validateField(f, values[f.name], values); if (e) out[f.name] = e; }
  return out;
}

/**
 * Touched/submitted bookkeeping for hand-built forms (Login, Settings, Convert…). Pass the current values and a rule map;
 * `shown(name)` returns the error only once the field was blurred or `touchAll()` was called (on submit).
 * `fieldProps(name)` spreads `aria-invalid`, `aria-describedby` and `onBlur` onto the control; pair with `<Field error={shown(name)} errorId={errorId(name)}>`.
 */
export function useFieldValidation<V extends Record<string, unknown>>(values: V, rules: Partial<Record<keyof V & string, (value: unknown, all: V) => string | null | undefined>>) {
  const id = useId();
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const errors = useMemo(() => {
    const out: FormErrors = {};
    for (const k of Object.keys(rules)) { const e = rules[k as keyof V & string]?.(values[k], values); if (e) out[k] = e; }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, ...Object.keys(rules)]);
  const touch = useCallback((name: string) => setTouched((t) => (t[name] ? t : { ...t, [name]: true })), []);
  const touchAll = useCallback(() => setSubmitted(true), []);
  const reset = useCallback(() => { setTouched({}); setSubmitted(false); }, []);
  const errorId = useCallback((name: string) => `${id}-${name}-error`, [id]);
  const shown = useCallback((name: string) => (submitted || touched[name] ? errors[name] : undefined), [submitted, touched, errors]);
  const fieldProps = useCallback((name: string) => {
    const e = shown(name);
    return { "aria-invalid": e ? true : undefined, "aria-describedby": e ? errorId(name) : undefined, onBlur: () => touch(name) } as const;
  }, [shown, errorId, touch]);
  return { errors, valid: Object.keys(errors).length === 0, touched, submitted, touch, touchAll, reset, shown, errorId, fieldProps };
}

/* ------------------------------------------------------------------ Money */
const moneyFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const parseMoney = (t: string): number | null => {
  const clean = t.replace(/[^0-9.-]/g, "");
  if (clean === "" || clean === "-" || clean === ".") return null;
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
};
/**
 * Money input (§6.10): `$` prefix adornment, right-aligned tabular, thousands separators shown on blur, raw digits while editing.
 * Controlled by a number (or null); `onValueChange` receives the parsed number.
 */
/** Chips + inline input (§6.10 tag input). Enter/comma/Tab commits, Backspace on empty removes the last chip. */
export function TagInput({ value, onChange, placeholder, id, ...a11y }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; id?: string } & Record<string, unknown>) {
  const [draft, setDraft] = useState("");
  const commit = () => { const t = draft.trim().replace(/,$/, "").trim(); if (t && !value.includes(t)) onChange([...value, t]); setDraft(""); };
  return (
    <div className="field flex h-auto min-h-8 flex-wrap items-center gap-1 py-1" onClick={(e) => (e.currentTarget.querySelector("input") as HTMLInputElement | null)?.focus()}>
      {value.map((t) => (
        <span key={t} className="inline-flex h-5 items-center gap-1 rounded-full border border-crm-sand-150 bg-crm-sand-100 px-2 text-[11px] leading-[14px] font-medium text-crm-sand-700">
          {t}<button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((x) => x !== t))} className="text-crm-sand-500 hover:text-crm-sand-900">×</button>
        </span>))}
      <input {...(a11y as object)} id={id} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={value.length ? "" : placeholder ?? "Type and press Enter"}
             onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(); } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1)); }}
             onBlur={commit} className="min-w-[120px] flex-1 bg-transparent outline-none placeholder:text-crm-sand-400" />
    </div>
  );
}

type NativeInputEvent = Event & { inputType?: string };
/**
 * Text input that runs `format` on every edit and keeps the caret after the same meaningful character, so typing or
 * deleting in the middle of "(555) 123-4567" behaves naturally. `onValueChange` receives the formatted text.
 */
export const FormattedInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string; onValueChange: (value: string) => void; format: InputFormat;
}>(function FormattedInput({ value, onValueChange, format, ...p }, outerRef) {
  const inner = useRef<HTMLInputElement | null>(null);
  const caret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = inner.current;
    if (caret.current != null && el && el.ownerDocument.activeElement === el) el.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });
  return (
    <Input {...p} value={value}
      ref={(el) => { inner.current = el; if (typeof outerRef === "function") outerRef(el); else if (outerRef) outerRef.current = el; }}
      onChange={(e) => {
        const type = (e.nativeEvent as NativeInputEvent).inputType ?? "";
        const deleting = type.startsWith("deleteContentBackward") ? "backward" : type.startsWith("deleteContentForward") ? "forward" : null;
        const out = applyFormat(format, value, e.target.value, e.target.selectionStart ?? e.target.value.length, deleting);
        caret.current = out.caret;
        onValueChange(out.value);
      }} />
  );
});

/** Hex color text field with a native swatch picker. */
export function ColorInput({ value, onValueChange, ...p }: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & { value: string; onValueChange: (value: string) => void }) {
  const valid = /^#[0-9A-F]{6}$/i.test(value);
  return (
    <span className="flex items-center gap-2">
      <input type="color" aria-label="Pick color" value={valid ? value.toLowerCase() : "#000000"} onChange={(e) => onValueChange(e.target.value.toUpperCase())}
             className="h-8 w-10 shrink-0 cursor-pointer rounded-crm-md border border-crm-sand-200 bg-crm-sand-0 p-0.5" />
      <FormattedInput {...p} value={value} onValueChange={onValueChange} format={HEX_FORMAT} maxLength={7} autoComplete="off" spellCheck={false} className="mono" />
    </span>
  );
}

export function MoneyInput({ value, onValueChange, className, onBlur, onFocus, ...p }: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & { value: number | null | undefined; onValueChange: (n: number | null) => void }) {
  const { settings } = useCrmContext();
  const [text, setText] = useState(value == null ? "" : moneyFmt.format(value));
  const [editing, setEditing] = useState(false);
  const last = useRef(value);
  // Sync from outside only while not editing (so typing "1000" is not reformatted mid-keystroke).
  useEffect(() => { if (!editing && last.current !== value) { last.current = value; setText(value == null ? "" : moneyFmt.format(value)); } }, [value, editing]);
  return (
    <span className="relative block">
      <span className="field-prefix" aria-hidden>{settings.default_currency}</span>
      <Input {...p} type="text" inputMode="decimal" autoComplete="off" value={text} className={cn("!pl-12 text-right num", className)}
             onFocus={(e) => { setEditing(true); setText(value == null ? "" : String(value)); onFocus?.(e); }}
             onChange={(e) => { setText(e.target.value); const n = parseMoney(e.target.value); last.current = n; onValueChange(n); }}
             onBlur={(e) => { setEditing(false); setText(value == null ? "" : moneyFmt.format(value)); onBlur?.(e); }} />
    </span>
  );
}

/* ------------------------------------------------------------- SchemaForm */
/**
 * Renders `fields` in the §6.10 2-column grid. Errors appear per field after blur, or for every field once `showAllErrors`
 * is true (FormModal sets it after a rejected submit). `errors` lets a parent inject server-side messages by field name.
 */
export function SchemaForm({ fields, values, onChange, showAllErrors = false, errors: extErrors, idPrefix }: {
  fields: FieldDef[]; values: FormValues; onChange: (v: FormValues) => void; showAllErrors?: boolean; errors?: FormErrors; idPrefix?: string;
}) {
  const autoId = useId();
  const base = idPrefix ?? autoId;
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const set = (k: string, v: unknown) => onChange({ ...values, [k]: v });
  const touch = (k: string) => setTouched((t) => (t[k] ? t : { ...t, [k]: true }));
  const errors = useMemo(() => ({ ...validateFields(fields, values), ...(extErrors ?? {}) }), [fields, values, extErrors]);
  return (
    <div className="grid grid-cols-2 gap-4">
      {fields.map((f) => {
        const v = values[f.name];
        const cls = f.span === 2 || f.type === "textarea" ? "col-span-2" : "";
        const id = `${base}-${f.name}`;
        const errId = `${id}-error`;
        const err = (showAllErrors || touched[f.name] || extErrors?.[f.name]) ? errors[f.name] : undefined;
        const a11y = { id, "aria-invalid": err ? true : undefined, "aria-describedby": err ? errId : undefined, onBlur: () => touch(f.name) } as const;
        if (f.type === "template") return (
          <TemplateField key={f.name} className="col-span-2" label={f.label + (f.required ? " *" : "")} hint={f.hint} error={err} errorId={errId}
            value={(v as string) ?? ""} onChange={(text) => set(f.name, text)} values={f.previewValues ?? {}} multiline={f.multiline} maxLength={f.maxLength} placeholder={f.placeholder}
            controlProps={a11y} />);
        if (f.type === "checkbox") return (
          <label key={f.name} className={`flex items-center gap-2 self-end pb-2 text-[13px] text-crm-sand-900 ${cls}`}>
            <input type="checkbox" checked={!!v} onChange={(e) => set(f.name, e.target.checked)} id={id} />{f.label}
          </label>);
        return (
          <Field key={f.name} label={f.label + (f.required ? " *" : "")} hint={f.hint} className={cls} error={err} errorId={errId}>
            {f.type === "select" ? <Select {...a11y} value={(v as string | number | null) ?? ""} options={f.options ?? []} placeholder={f.placeholder ?? "Select…"} onChange={(e) => set(f.name, e.target.value === "" ? null : isNaN(Number(e.target.value)) || f.options?.some((o) => typeof o.value === "string") ? e.target.value : Number(e.target.value))} />
            : f.type === "textarea" ? <Textarea {...a11y} value={(v as string) ?? ""} onChange={(e) => set(f.name, e.target.value)} placeholder={f.placeholder} />
            : f.type === "tags" ? <TagInput {...a11y} value={Array.isArray(v) ? (v as string[]) : []} onChange={(tags) => set(f.name, tags)} placeholder={f.placeholder} />
            : f.type === "color" ? <ColorInput {...a11y} value={(v as string) ?? ""} onValueChange={(text) => set(f.name, text)} placeholder={f.placeholder} />
            : f.format ? <FormattedInput {...a11y} format={f.format} value={v == null ? "" : String(v)} placeholder={f.placeholder} maxLength={f.maxLength}
                type={f.type === "password" ? "password" : "text"} inputMode={f.inputMode} autoComplete={f.autoComplete ?? (f.type === "password" ? "new-password" : undefined)}
                onValueChange={(text) => set(f.name, text === "" ? null : text)} />
            : f.type === "money" ? <MoneyInput {...a11y} value={typeof v === "number" ? v : v == null || v === "" ? null : Number(v)} onValueChange={(n) => set(f.name, n)} placeholder={f.placeholder ?? "0"} min={f.min} max={f.max} />
            : <Input {...a11y} type={f.type ?? "text"} step={f.step} min={f.min} max={f.max} value={v == null ? "" : String(v)} placeholder={f.placeholder}
                     maxLength={f.maxLength} inputMode={f.inputMode} autoComplete={f.autoComplete ?? (f.type === "password" ? "new-password" : undefined)}
                     onChange={(e) => set(f.name, f.type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value === "" && f.type !== "text" ? null : e.target.value)} />}
          </Field>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------- FormModal */
export function FormModal({ open, onClose, title, fields, initial, values: controlledValues, onValuesChange, onSubmit, submitLabel = "Save", width, size = "wide" }: {
  open: boolean; onClose: () => void; title: string; fields: FieldDef[]; initial: FormValues; values?: FormValues; onValuesChange?: (values: FormValues) => void; onSubmit: (v: FormValues) => Promise<unknown>; submitLabel?: string; width?: string; size?: "default" | "wide";
}) {
  const [localValues, setLocalValues] = useState<FormValues>(initial);
  const values = controlledValues ?? localValues;
  const setValues = onValuesChange ?? setLocalValues;
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const formId = useId();
  const { error } = useToast();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) { setValues(initial); setAttempted(false); } }, [open]);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const errs = validateFields(fields, values);
    if (Object.keys(errs).length) {
      setAttempted(true);
      const first = fields.find((f) => errs[f.name]);
      if (first) e.currentTarget.querySelector<HTMLElement>(`#${CSS.escape(`${formId}-${first.name}`)}`)?.focus();
      return;
    }
    setBusy(true);
    try { await onSubmit(values); onClose(); } catch (err) { error(err); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={title} width={width} size={size}>
      <form onSubmit={submit} noValidate>
        <SchemaForm fields={fields} values={values} onChange={setValues} showAllErrors={attempted} idPrefix={formId} />
        {/* Footer lives inside the form so the primary button submits; styled to match Modal's footer slot. */}
        <div className="-mx-5 -mb-5 mt-5 flex justify-end gap-2 rounded-b-xl border-t border-crm-sand-150 bg-crm-sand-25 px-5 py-3">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy}>{busy ? "Saving…" : submitLabel}</Button>
        </div>
      </form>
    </Modal>
  );
}
