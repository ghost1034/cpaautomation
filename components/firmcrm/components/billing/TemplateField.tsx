import { useRef, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Field, Input, Textarea, cn } from "@/components/firmcrm/components/ui";
import {
  TEMPLATE_PLACEHOLDERS, findUnknownPlaceholders, hasPlaceholder, isRenderable, renderTemplatePreview, type PlaceholderValues,
} from "./templatePlaceholders";

type Control = HTMLInputElement | HTMLTextAreaElement;

/** Insert `token` over the current selection (or at the end when the control never had a caret). Returns the new text and caret. */
export function insertAt(value: string, token: string, start: number | null, end: number | null, maxLength?: number) {
  const from = start ?? value.length;
  const to = end ?? from;
  const next = value.slice(0, from) + token + value.slice(to);
  if (maxLength != null && next.length > maxLength) return null;
  return { value: next, caret: from + token.length };
}

/**
 * Text input for billing templates. Users click a labeled chip to insert a `{placeholder}` at the caret instead of
 * typing it, expand a preview of the rendered text, and are warned about tokens or braces the server will not fill.
 * `values` are the real or sample placeholder values used for the preview line; unset ones show as `[Label]`.
 */
export function TemplateField({ label, value, onChange, values, multiline = false, rows = 6, maxLength, disabled, hint, error, errorId, className, controlProps }: {
  label: string; value: string; onChange: (value: string) => void; values: PlaceholderValues; multiline?: boolean; rows?: number;
  maxLength?: number; disabled?: boolean; hint?: string; error?: string | null; errorId?: string; className?: string;
  controlProps?: Record<string, unknown>;
}) {
  const ref = useRef<Control | null>(null);
  const focused = useRef(false);
  const insert = (key: string) => {
    const el = ref.current;
    const touched = focused.current && el != null;
    const out = insertAt(value, `{${key}}`, touched ? el.selectionStart : null, touched ? el.selectionEnd : null, maxLength);
    if (!out) return;
    onChange(out.value);
    focused.current = true;
    requestAnimationFrame(() => { ref.current?.focus(); ref.current?.setSelectionRange(out.caret, out.caret); });
  };
  const unknown = findUnknownPlaceholders(value);
  const renderable = isRenderable(value);
  const labelled = Object.fromEntries(TEMPLATE_PLACEHOLDERS.map((p) => [p.key, values[p.key] || `[${p.label}]`])) as PlaceholderValues;
  const preview = renderable && hasPlaceholder(value) ? renderTemplatePreview(value, labelled) : null;
  const common = {
    ...controlProps, value, maxLength, disabled,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    onFocus: () => { focused.current = true; },
  };
  let notice: ReactNode = null;
  if (!renderable) notice = <>Unmatched <code>{"{"}</code> or <code>{"}"}</code>. Placeholders won’t be filled.</>;
  else if (unknown.length) notice = <>{unknown.map((k, i) => <span key={k}>{i > 0 && ", "}<code>{`{${k}}`}</code></span>)} {unknown.length === 1 ? "isn’t a recognized field" : "aren’t recognized fields"}.</>;
  return (
    <div className={cn("min-w-0", className)}>
      <Field label={label} hint={hint} error={error} errorId={errorId}>
        {multiline
          ? <Textarea {...common} ref={(el) => { ref.current = el; }} rows={rows} />
          : <Input {...common} ref={(el) => { ref.current = el; }} />}
      </Field>
      {!disabled && (
        <div role="group" aria-label={`Insert field into ${label.replace(/\s*\*\s*$/, "")}`} className="mt-1.5 flex flex-wrap items-center gap-1">
          {TEMPLATE_PLACEHOLDERS.map((p) => (
            <button key={p.key} type="button" title={`{${p.key}}: ${p.description}`} aria-label={`Insert ${p.label}`}
              // Keep the caret/selection in the control while clicking.
              onMouseDown={(e) => e.preventDefault()} onClick={() => insert(p.key)}
              className="h-6 rounded-crm-md border border-crm-sand-200 bg-crm-sand-25 px-2 text-[12px] leading-4 text-crm-sand-700 transition-colors duration-[120ms] hover:border-crm-accent-600 hover:bg-crm-sand-0 hover:text-crm-accent-700">
              + {p.label}
            </button>
          ))}
        </div>
      )}
      {notice && <p className="mt-1.5 text-[12px] leading-4 text-crm-warn-700">{notice}</p>}
      {preview != null && (
        <details className="group mt-1.5">
          <summary className="inline-flex cursor-pointer list-none items-center gap-0.5 text-[12px] font-medium leading-4 text-crm-sand-500 hover:text-crm-sand-700 [&::-webkit-details-marker]:hidden">
            <ChevronRight size={12} className="transition-transform duration-[120ms] group-open:rotate-90" />Preview
          </summary>
          <p className={cn("mt-1 text-[12px] leading-4 text-crm-sand-600", multiline && "line-clamp-4 whitespace-pre-line")}>{preview}</p>
        </details>
      )}
    </div>
  );
}
