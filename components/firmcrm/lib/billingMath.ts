/* Invoice arithmetic in integer cents for the live editor preview. Mirrors backend
   `firmcrm.services.billing.compute_line`: amount = unit_cost × quantity, rounded half-up to cents.
   Inputs allow at most two decimals, like the API. The server recomputes and is authoritative. */

const FIXED = /^\d+(\.\d{0,2})?$/;

/** Parse a non-negative amount with up to 2 decimals ("1,250.5" → 125050). Returns null when invalid. */
export function parseHundredths(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const text = String(value).replace(/[,\s$]/g, "");
  if (!FIXED.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  const out = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  return Number.isSafeInteger(out) ? out : null;
}

/** Line amount in cents, or null if either input is invalid (or too large to preview exactly). */
export function lineAmountCents(unitCost: string | number, quantity: string | number): number | null {
  const unit = parseHundredths(unitCost);
  const qty = parseHundredths(quantity);
  if (unit == null || qty == null) return null;
  const product = unit * qty;
  return Number.isSafeInteger(product) ? Math.floor((product + 50) / 100) : null;
}

export function invoiceTotalCents(lines: { unit_cost: string | number; quantity: string | number }[]): number {
  return lines.reduce((sum, line) => sum + (lineAmountCents(line.unit_cost, line.quantity) ?? 0), 0);
}

/** 125050 → "1,250.50" (no sign or currency). */
export function formatHundredths(cents: number): string {
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${whole}.${(abs % 100).toString().padStart(2, "0")}`;
}

/** "$43,000.00" for USD, "EUR 1,000.00" otherwise — matches the PDF. */
export function formatCents(cents: number, currency = "USD"): string {
  return `${cents < 0 ? "-" : ""}${currency === "USD" ? "$" : `${currency} `}${formatHundredths(cents)}`;
}

/** Tidy an amount the user typed ("1250.5" → "1,250.50"); invalid text is returned unchanged so the error stays visible. */
export function tidyAmount(value: string): string {
  const cents = parseHundredths(value);
  return cents == null ? value : formatHundredths(cents);
}

/** Format an API decimal string such as "43000.00". */
export const formatAmount = (value: string | number | null | undefined, currency = "USD") => {
  const text = value == null ? "" : String(value);
  const negative = text.startsWith("-");
  const cents = parseHundredths(negative ? text.slice(1) : text);
  return cents == null ? "—" : formatCents(negative ? -cents : cents, currency);
};
