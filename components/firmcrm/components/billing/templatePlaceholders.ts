import { addDays, format, parseISO } from "date-fns";

/* Placeholders accepted in billing text templates (terms, email subject and message).
   Mirrors the keys filled by backend `firmcrm.services.billing.render_template`; keep the two lists in sync. */

export type PlaceholderKey = "invoice_number" | "customer_name" | "total" | "issue_date" | "due_date" | "issuer_name";
export type PlaceholderValues = Partial<Record<PlaceholderKey, string>>;

export const TEMPLATE_PLACEHOLDERS: { key: PlaceholderKey; label: string; description: string }[] = [
  { key: "invoice_number", label: "Invoice number", description: "Assigned when the invoice is issued" },
  { key: "customer_name", label: "Customer name", description: "The billed-to name on the invoice" },
  { key: "total", label: "Total", description: "Invoice total with currency" },
  { key: "issue_date", label: "Issue date", description: "Date of issue, MM/DD/YYYY" },
  { key: "due_date", label: "Due date", description: "Date payment is due, MM/DD/YYYY" },
  { key: "issuer_name", label: "Your company name", description: "Company name from the billing profile" },
];

const KNOWN = new Set<string>(TEMPLATE_PLACEHOLDERS.map((p) => p.key));
// Python str.format syntax: `{{`/`}}` are escaped braces, `{name}` is a field. Anything else (`{`, `{}`, `{0}`) makes
// the backend print the whole template verbatim.
const PART = /\{\{|\}\}|\{([A-Za-z_]\w*)\}/g;

/** Example values for previews where no invoice exists yet (billing profile form). */
export const SAMPLE_VALUES: Required<PlaceholderValues> = {
  invoice_number: "1042", customer_name: "Acme Holdings", total: "$4,250.00",
  issue_date: "03/01/2026", due_date: "03/31/2026", issuer_name: "Your firm",
};

/** "2026-03-31" → "03/31/2026", matching the PDF and emails. Blank stays blank. */
export const formatTemplateDate = (iso: string | null | undefined) =>
  iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : "";

/**
 * Placeholder values for a real invoice. Unset dates are projected the way issuing does (issue date = today, due date =
 * issue date + profile terms), so drafts preview what will be sent. The number stays unset until it is allocated.
 */
export function invoicePlaceholderValues(invoice: { number?: string | null; billed_to_name?: string | null; issue_date?: string | null; due_date?: string | null },
  total: string, issuerName: string | null | undefined, termsDays: number | null | undefined): PlaceholderValues {
  const issued = invoice.issue_date || format(new Date(), "yyyy-MM-dd");
  const due = invoice.due_date || (termsDays != null ? format(addDays(parseISO(issued), termsDays), "yyyy-MM-dd") : "");
  return {
    invoice_number: invoice.number ?? undefined, customer_name: invoice.billed_to_name ?? undefined, total,
    issue_date: formatTemplateDate(issued), due_date: formatTemplateDate(due), issuer_name: issuerName ?? undefined,
  };
}

/** False when stray braces make the backend skip substitution and print the template exactly as typed. */
export const isRenderable = (template: string) => !/[{}]/.test(template.replace(PART, ""));

/** Client-side `render_template`: fills placeholders that have a value; unknown or unset ones stay as typed. */
export function renderTemplatePreview(template: string, values: PlaceholderValues): string {
  if (!isRenderable(template)) return template;
  return template.replace(PART, (raw, key?: string) => {
    if (!key) return raw[0];
    const value = KNOWN.has(key) ? values[key as PlaceholderKey] : undefined;
    return value || `{${key}}`;
  });
}

const fields = (template: string) => [...template.matchAll(PART)].map(([, key]) => key).filter((k): k is string => !!k);

/** Distinct `{tokens}` in the text that are not supported placeholders. */
export const findUnknownPlaceholders = (template: string) => [...new Set(fields(template).filter((k) => !KNOWN.has(k)))];

export const hasPlaceholder = (template: string) => fields(template).some((k) => KNOWN.has(k));
