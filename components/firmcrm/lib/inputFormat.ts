/* As-you-type formatters for form inputs. Each takes the raw control text and returns the display/stored text, so they
   are idempotent: formatting an already formatted value returns it unchanged. `FormattedInput` keeps the caret in place. */

export type InputFormat = {
  format: (raw: string) => string;
  /** Characters that carry meaning (vs. inserted separators); the caret is restored after the same count of them. */
  sig?: RegExp;
};

const ALNUM = /[0-9A-Za-z]/;
const DIGIT = /\d/;

/** US/NANP numbers as "(555) 123-4567", "+1 (555) 123-4567" or with " x12" extension. Other "+" numbers are left as typed. */
export function formatPhone(raw: string): string {
  const t = raw.trimStart();
  if (t.startsWith("+") && !t.startsWith("+1")) return raw;
  let d = raw.replace(/\D/g, "");
  let prefix = "";
  if (t.startsWith("+1") || (d.length > 10 && d[0] === "1")) { prefix = "+1 "; d = d.slice(1); }
  if (!d) return prefix.trim();
  const [a, b, c, ext] = [d.slice(0, 3), d.slice(3, 6), d.slice(6, 10), d.slice(10)];
  let out = d.length <= 3 ? `(${a}` : d.length <= 6 ? `(${a}) ${b}` : `(${a}) ${b}-${c}`;
  if (ext) out += ` x${ext}`;
  return prefix + out;
}

/** US ZIP: "12345" or "12345-6789". */
export function formatZip(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 9);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

/** Non-US postal codes: uppercase, single spaces ("k1a 0b6" → "K1A 0B6"). */
export const formatPostal = (raw: string) => raw.toUpperCase().replace(/\s+/g, " ").trimStart();

export const formatRouting = (raw: string) => raw.replace(/\D/g, "").slice(0, 9);

export const formatSwift = (raw: string) => raw.replace(/[^0-9A-Za-z]/g, "").toUpperCase().slice(0, 11);

export function formatHexColor(raw: string): string {
  const hex = raw.replace(/[^0-9A-Fa-f]/g, "").toUpperCase().slice(0, 6);
  return raw.trim() === "" ? "" : `#${hex}`;
}

/** Amount entry: digits, one decimal point and up to 2 decimals; commas are dropped and re-added on blur. */
export function formatDecimalInput(raw: string): string {
  const clean = raw.replace(/[^\d.]/g, "");
  const dot = clean.indexOf(".");
  return dot < 0 ? clean : `${clean.slice(0, dot)}.${clean.slice(dot + 1).replace(/\./g, "").slice(0, 2)}`;
}

/** Comma-separated email list, normalized to "a@x.com, b@y.com". */
export const formatEmailList = (raw: string) => raw.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean).join(", ");

/** ABA routing number checksum (3-7-1 weights). */
export function isValidRouting(value: string): boolean {
  if (!/^\d{9}$/.test(value)) return false;
  const d = [...value].map(Number);
  return (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])) % 10 === 0;
}

export const SWIFT_PATTERN = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/;

export const PHONE_FORMAT: InputFormat = { format: formatPhone, sig: DIGIT };
export const ZIP_FORMAT: InputFormat = { format: formatZip, sig: DIGIT };
export const POSTAL_FORMAT: InputFormat = { format: formatPostal };
export const ROUTING_FORMAT: InputFormat = { format: formatRouting, sig: DIGIT };
export const SWIFT_FORMAT: InputFormat = { format: formatSwift };
export const HEX_FORMAT: InputFormat = { format: formatHexColor, sig: /[0-9A-Fa-f]/ };
export const DECIMAL_FORMAT: InputFormat = { format: formatDecimalInput, sig: /[\d.]/ };

const countSig = (s: string, sig: RegExp) => [...s].filter((ch) => sig.test(ch)).length;

/**
 * Format `raw` (the control text after an edit) and work out where the caret belongs. `prev` is the text before the
 * edit: deleting only a separator (e.g. the ")" in a phone number) would be undone by reformatting, so the meaningful
 * character next to it is removed instead.
 */
export function applyFormat(spec: InputFormat, prev: string, raw: string, caret: number, deleting: "backward" | "forward" | null) {
  const sig = spec.sig ?? ALNUM;
  let text = raw; let pos = caret;
  if (deleting && countSig(raw, sig) === countSig(prev, sig) && raw.length < prev.length) {
    const chars = [...raw];
    let i = deleting === "backward" ? pos - 1 : pos;
    while (i >= 0 && i < chars.length && !sig.test(chars[i])) i += deleting === "backward" ? -1 : 1;
    if (i >= 0 && i < chars.length) { chars.splice(i, 1); text = chars.join(""); if (deleting === "backward") pos = i; }
  }
  const before = countSig(text.slice(0, pos), sig);
  const value = spec.format(text);
  let seen = 0; let out = 0;
  while (out < value.length && seen < before) { if (sig.test(value[out])) seen++; out++; }
  return { value, caret: out };
}
