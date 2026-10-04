import { useCrmContext } from "./auth";
import { useCallback } from "react";
import { format, formatDistanceToNowStrict, parseISO } from "date-fns";

export const formatMoney = (n: number | null | undefined, compact = false, currency = "USD", digits = 0) =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: digits, notation: compact ? "compact" : "standard" }).format(n);
export const pct = (n: number | null | undefined, digits = 0) => (n == null ? "—" : `${(n * 100).toFixed(digits)}%`);
export const num = (n: number | null | undefined) => (n == null ? "—" : new Intl.NumberFormat("en-US").format(n));
export const fmtDate = (s: string | null | undefined) => (s ? format(parseISO(s), "MMM d, yyyy") : "—");
export const fmtDateTime = (s: string | null | undefined) => (s ? format(parseISO(s), "MMM d, yyyy · h:mm a") : "—");
export const ago = (s: string | null | undefined) => (s ? formatDistanceToNowStrict(parseISO(s), { addSuffix: true }) : "—");
export const titleCase = (s: string | null | undefined) => (s ? s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "—");
export const initials = (name: string) => name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
/** "1 invoice", "2 invoices"; pass `many` for irregular plurals. */
export const plural = (n: number | null | undefined, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
export const toDateInput = (s: string | null | undefined) => (s ? s.slice(0, 10) : "");

export function useMoney() {
  const { settings } = useCrmContext();
  const currency = settings.default_currency;
  return useCallback((n: number | null | undefined, compact = false, digits = 0) => formatMoney(n, compact, currency, digits), [currency]);
}
