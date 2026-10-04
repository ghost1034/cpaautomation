import type { CSSProperties } from "react";
import { Roboto } from "next/font/google";
import type { BillingProfile } from "@/components/firmcrm/api/types";
import { formatCents, invoiceTotalCents, lineAmountCents, parseHundredths } from "@/components/firmcrm/lib/billingMath";
import type { LineDraft } from "./LineItemsEditor";

type Issuer = Partial<Pick<BillingProfile, "issuer_name" | "address_line1" | "address_line2" | "city" | "state" | "postal_code" | "phone" | "email" | "website" | "accent_color" | "bank_name" | "account_name" | "routing_number" | "swift_code">> & { account_number_last4?: string | null };

// Matches the Roboto TTFs embedded in the server-rendered invoice PDF.
const roboto = Roboto({ subsets: ["latin"], weight: ["400", "700"], display: "swap" });

const usDate = (iso: string | null | undefined) => (iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : "");
const label = "text-[7px] font-bold uppercase tracking-[0.04em] text-crm-sand-400";

/** Scaled HTML approximation of the PDF so edits are visible before downloading. The PDF from the server is authoritative. */
export function InvoicePreview({ issuer, number, issueDate, billedToName, billedToAddress, lines, currency, terms }: {
  issuer: Issuer | undefined; number: string | null | undefined; issueDate: string | null | undefined; billedToName: string; billedToAddress: string;
  lines: LineDraft[]; currency: string; terms: string;
}) {
  const accent: CSSProperties = { backgroundColor: issuer?.accent_color ?? "#1683DB" };
  const locality = [[issuer?.city, issuer?.state].filter(Boolean).join(", "), issuer?.postal_code].filter(Boolean).join(" ");
  const total = formatCents(invoiceTotalCents(lines), currency);
  const rows = [...lines, ...Array.from({ length: Math.max(0, 8 - lines.length) }, () => null)];
  const wire = [["Bank Name", issuer?.bank_name], ["Account Name", issuer?.account_name], ["Routing Number", issuer?.routing_number],
                ["Account number", issuer?.account_number_last4 ? `•••• ${issuer.account_number_last4}` : null], ["SWIFT / BIC", issuer?.swift_code]].filter(([, v]) => v);
  return (
    <div className={`${roboto.className} aspect-[8.5/11] w-full overflow-hidden rounded-crm-md border border-crm-sand-150 bg-white text-[8px] leading-[1.35] text-[#1f1f1f] shadow-sm`} aria-label="Invoice preview">
      <div className="mx-[6%] mt-[5%] h-[2.5%]" style={accent} />
      <div className="px-[14%] pt-[5%]">
        <div className="text-[13px]">{issuer?.issuer_name || "Your company"}</div>
        <div className="mt-1 flex gap-4 text-[7px]">
          <div>{[issuer?.address_line1, issuer?.address_line2, locality].filter(Boolean).map((l) => <div key={l}>{l}</div>)}</div>
          <div>{[issuer?.phone, issuer?.email, issuer?.website].filter(Boolean).map((l) => <div key={l}>{l}</div>)}</div>
        </div>
        <div className={`${label} mt-5`}>Billed to</div>
        <div className="mt-1 whitespace-pre-line">{[billedToName || "Customer", billedToAddress].filter(Boolean).join("\n")}</div>
        <div className="mt-4 flex gap-3">
          <div className="w-[22%] shrink-0">
            <div className="text-[20px] leading-none text-[#5f6368]">Invoice</div>
            <div className={`${label} mt-2`}>Invoice number</div><div>{number ?? "DRAFT"}</div>
            <div className={`${label} mt-3`}>Date of issue</div><div>{usDate(issueDate)}</div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="grid grid-cols-[1fr_17%_14%_18%] gap-1 px-1 py-0.5 text-[6.5px] font-bold text-white" style={accent}><span>DESCRIPTION</span><span>UNIT COST</span><span>QTY/HR RATE</span><span>AMOUNT</span></div>
            {rows.map((l, i) => (
              <div key={l?.key ?? `pad-${i}`} className="mt-[2px] grid min-h-[13px] grid-cols-[1fr_17%_14%_18%] gap-1 bg-[#f2f2f2] px-1 py-0.5 text-[6.5px]">
                {l && <><span className="truncate">{l.description}</span><span className="text-right">{formatCents(parseHundredths(l.unit_cost) ?? 0, currency)}</span><span>{l.quantity}</span><span className="text-right">{(() => { const c = lineAmountCents(l.unit_cost, l.quantity); return c == null ? "—" : formatCents(c, currency); })()}</span></>}
              </div>
            ))}
            <div className="mt-2 flex justify-end gap-3 text-[7px]"><span className={label}>Subtotal</span><span>{total}</span></div>
          </div>
        </div>
        <div className="mt-2 flex items-end justify-between gap-4">
          <div className="w-[60%]">
            {wire.length > 0 && <div className="text-[7px] font-bold text-[#5f6368]">Wire Instruction</div>}
            {wire.map(([k, v]) => <div key={k} className="text-[7px] text-[#5f6368]"><div className="bg-[#f2f2f2] px-1">{k}</div><div className="px-1">{v}</div></div>)}
          </div>
          <div className="w-[32%] border-t border-[#5f6368] pt-3 text-center"><div className={label}>Invoice total</div><div className="text-[15px] text-[#5f6368]">{total}</div></div>
        </div>
        {terms && <><div className={`${label} mt-3`}>Terms</div><div className="whitespace-pre-line">{terms}</div></>}
      </div>
      <div className="mx-[6%] mt-[4%] h-[9%]" style={accent} />
    </div>
  );
}
