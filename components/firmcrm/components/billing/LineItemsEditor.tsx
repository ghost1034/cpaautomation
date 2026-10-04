import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button, Input, cn } from "@/components/firmcrm/components/ui";
import { formatCents, invoiceTotalCents, lineAmountCents, parseHundredths } from "@/components/firmcrm/lib/billingMath";

export type LineDraft = { key: string; description: string; unit_cost: string; quantity: string };

let seq = 0;
export const newLine = (l: Partial<LineDraft> = {}): LineDraft => ({ key: `line-${++seq}`, description: "", unit_cost: "", quantity: "1", ...l });

/** Problems that block saving, keyed by line key. */
export function lineErrors(lines: LineDraft[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of lines) {
    if (!l.description.trim()) out[l.key] = "Add a description.";
    else if (parseHundredths(l.unit_cost) == null) out[l.key] = "Unit cost must be a non-negative amount with up to 2 decimals.";
    else if (!(Number(parseHundredths(l.quantity)) > 0)) out[l.key] = "Quantity must be greater than 0 with up to 2 decimals.";
  }
  return out;
}

export function LineItemsEditor({ lines, onChange, currency, readOnly, showErrors }: {
  lines: LineDraft[]; onChange: (lines: LineDraft[]) => void; currency: string; readOnly?: boolean; showErrors?: boolean;
}) {
  const errors = showErrors ? lineErrors(lines) : {};
  const update = (key: string, patch: Partial<LineDraft>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const move = (i: number, d: -1 | 1) => { const next = [...lines]; [next[i], next[i + d]] = [next[i + d], next[i]]; onChange(next); };
  const amount = (l: LineDraft) => { const c = lineAmountCents(l.unit_cost, l.quantity); return c == null ? "—" : formatCents(c, currency); };
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-[13px]">
          <thead>
            <tr className="border-b border-crm-sand-150 text-left text-[12px] text-crm-sand-600">
              <th className="py-2 pr-2 font-medium">Description</th>
              <th className="w-[140px] py-2 pr-2 text-right font-medium">Unit cost</th>
              <th className="w-[96px] py-2 pr-2 text-right font-medium">Qty / hours</th>
              <th className="w-[128px] py-2 pr-2 text-right font-medium">Amount</th>
              {!readOnly && <th className="w-[92px]" aria-label="Row actions" />}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.key} className="border-b border-crm-sand-100 align-top">
                {readOnly ? <>
                  <td className="py-2 pr-2 whitespace-pre-wrap">{l.description}</td>
                  <td className="num py-2 pr-2 text-right">{formatCents(parseHundredths(l.unit_cost) ?? 0, currency)}</td>
                  <td className="num py-2 pr-2 text-right">{l.quantity}</td>
                </> : <>
                  <td className="py-1.5 pr-2">
                    <Input aria-label={`Line ${i + 1} description`} value={l.description} maxLength={500} placeholder="e.g. General training sessions and prep hours"
                           aria-invalid={errors[l.key] ? true : undefined} onChange={(e) => update(l.key, { description: e.target.value })} />
                    {errors[l.key] && <span className="mt-1 block text-[12px] text-crm-danger-600">{errors[l.key]}</span>}
                  </td>
                  <td className="py-1.5 pr-2"><Input aria-label={`Line ${i + 1} unit cost`} inputMode="decimal" className="num text-right" value={l.unit_cost} placeholder="0.00" onChange={(e) => update(l.key, { unit_cost: e.target.value })} /></td>
                  <td className="py-1.5 pr-2"><Input aria-label={`Line ${i + 1} quantity`} inputMode="decimal" className="num text-right" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} /></td>
                </>}
                <td className={cn("num py-2 pr-2 text-right", readOnly ? "" : "pt-3")}>{amount(l)}</td>
                {!readOnly && (
                  <td className="py-1.5 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={12} /></Button>
                    <Button size="sm" variant="ghost" aria-label="Move down" disabled={i === lines.length - 1} onClick={() => move(i, 1)}><ArrowDown size={12} /></Button>
                    <Button size="sm" variant="ghost" aria-label="Remove line" onClick={() => onChange(lines.filter((x) => x.key !== l.key))}><Trash2 size={12} /></Button>
                  </td>
                )}
              </tr>
            ))}
            {!lines.length && <tr><td colSpan={5} className="py-6 text-center text-crm-sand-500">No line items yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-start justify-between gap-4">
        {!readOnly ? <Button size="sm" onClick={() => onChange([...lines, newLine()])}><Plus size={12} />Add line</Button> : <span />}
        <dl className="num min-w-[220px] text-[13px]">
          <div className="flex justify-between gap-6 py-1 text-crm-sand-600"><dt>Subtotal</dt><dd>{formatCents(invoiceTotalCents(lines), currency)}</dd></div>
          <div className="flex justify-between gap-6 border-t border-crm-sand-150 py-1 text-[15px] font-semibold text-crm-sand-900"><dt>Invoice total</dt><dd>{formatCents(invoiceTotalCents(lines), currency)}</dd></div>
        </dl>
      </div>
    </div>
  );
}
