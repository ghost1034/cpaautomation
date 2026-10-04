import { useEffect, useMemo, useRef, useState } from "react";
import { Ban, CheckCircle2, Copy, Download, FileCheck2, Mail, Save, Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@/components/firmcrm/lib/query";
import { Link, useNavigate, useParams } from "@/components/firmcrm/lib/navigation";
import { accountsApi, billingApi, engagementsApi } from "@/components/firmcrm/api";
import type { Invoice, InvoiceInput } from "@/components/firmcrm/api/types";
import { Button, Card, Field, Input, OverflowMenu, PageHeader, Select, Spinner, Textarea, type MenuItem } from "@/components/firmcrm/components/ui";
import { NotFound } from "@/components/firmcrm/components/ui/facts";
import { useConfirm, useReasonPrompt } from "@/components/firmcrm/components/ui/Confirm";
import { useToast } from "@/components/firmcrm/components/ui/Toast";
import { InvoiceStatusBadge } from "@/components/firmcrm/components/billing/InvoiceStatusBadge";
import { LineItemsEditor, lineErrors, newLine, type LineDraft } from "@/components/firmcrm/components/billing/LineItemsEditor";
import { InvoicePreview } from "@/components/firmcrm/components/billing/InvoicePreview";
import { SendInvoiceDialog } from "@/components/firmcrm/components/billing/SendInvoiceDialog";
import { TemplateField } from "@/components/firmcrm/components/billing/TemplateField";
import { invoicePlaceholderValues, renderTemplatePreview } from "@/components/firmcrm/components/billing/templatePlaceholders";
import { formatCents, invoiceTotalCents } from "@/components/firmcrm/lib/billingMath";
import { useBillingProfiles } from "./BillingPage";
import { useAuth, useCrmContext } from "@/components/firmcrm/lib/auth";
import { fmtDateTime, titleCase } from "@/components/firmcrm/lib/format";

type Draft = {
  billing_profile_id: number | null; account_id: number | null; engagement_id: number | null;
  billed_to_name: string; billed_to_address: string; billed_to_email: string; billed_to_cc: string;
  issue_date: string; due_date: string; terms_text: string; currency: string; notes: string; lines: LineDraft[];
};

const fromInvoice = (i: Invoice): Draft => ({
  billing_profile_id: i.billing_profile_id, account_id: i.account_id ?? null, engagement_id: i.engagement_id ?? null,
  billed_to_name: i.billed_to_name, billed_to_address: i.billed_to_address ?? "", billed_to_email: i.billed_to_email ?? "", billed_to_cc: i.billed_to_cc ?? "",
  issue_date: i.issue_date ?? "", due_date: i.due_date ?? "", terms_text: i.terms_text ?? "", currency: i.currency, notes: i.notes ?? "",
  lines: (i.lines ?? []).map((l) => newLine({ description: l.description, unit_cost: l.unit_cost, quantity: String(Number(l.quantity)) })),
});
const toBody = (d: Draft): InvoiceInput => ({
  billing_profile_id: d.billing_profile_id!, account_id: d.account_id, engagement_id: d.engagement_id,
  billed_to_name: d.billed_to_name.trim(), billed_to_address: d.billed_to_address.trim() || null, billed_to_email: d.billed_to_email.trim() || null,
  billed_to_cc: d.billed_to_cc.trim() || null, issue_date: d.issue_date || null, due_date: d.due_date || null, terms_text: d.terms_text.trim() || null,
  currency: d.currency.trim().toUpperCase() || "USD", notes: d.notes.trim() || null,
  lines: d.lines.map((l) => ({ description: l.description.trim(), unit_cost: l.unit_cost.replace(/[,\s$]/g, ""), quantity: l.quantity.replace(/[,\s]/g, "") })),
});
const snapshot = (d: Draft | null) => (d ? JSON.stringify({ ...d, lines: d.lines.map((l) => [l.description, l.unit_cost, l.quantity]) }) : "");

export default function InvoiceEditorPage() {
  const params = useParams();
  const id = params.id ? Number(params.id) : null;
  const nav = useNavigate(); const qc = useQueryClient(); const { toast, error } = useToast();
  const confirm = useConfirm(); const reason = useReasonPrompt();
  const { atLeast } = useAuth();
  const { settings, user } = useCrmContext();
  const profiles = useBillingProfiles();
  const invoice = useQuery({ queryKey: ["invoice", id], queryFn: () => billingApi.invoice(id!), enabled: id != null });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseline, setBaselineState] = useState("");
  const baselineRef = useRef("");
  const setBaseline = (value: string) => { baselineRef.current = value; setBaselineState(value); };
  const [busy, setBusy] = useState(false); const [attempted, setAttempted] = useState(false); const [sending, setSending] = useState(false);

  // Initialise the form once per loaded record (or once for a new invoice when profiles arrive).
  const loadedKey = id == null ? "new" : invoice.data ? `${invoice.data.id}:${invoice.data.updated_at}` : null;
  useEffect(() => {
    if (loadedKey == null) return;
    if (id != null && invoice.data) {
      // Adopt the server copy unless the user has edits the server has not seen yet.
      const d = fromInvoice(invoice.data);
      setDraft((cur) => (cur && snapshot(cur) !== baselineRef.current ? cur : d));
      setBaseline(snapshot(d));
      return;
    }
    if (id == null && profiles.data && !draft) {
      const p = profiles.data.find((x) => x.is_default) ?? profiles.data[0];
      const d: Draft = { billing_profile_id: p?.id ?? null, account_id: null, engagement_id: null, billed_to_name: "", billed_to_address: "", billed_to_email: "", billed_to_cc: "",
        issue_date: "", due_date: "", terms_text: p?.default_terms_text ?? "", currency: settings.default_currency || "USD", notes: "", lines: [newLine()] };
      setDraft(d); setBaseline(snapshot(d));
      const accountId = Number(new URLSearchParams(window.location.search).get("accountId"));
      if (accountId) pickAccount(accountId, d);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedKey, profiles.data]);

  const accounts = useQuery({ queryKey: ["accounts", "billing-picker"], queryFn: () => accountsApi.list({ limit: 500 }), select: (p) => [...p.items].sort((a, b) => a.name.localeCompare(b.name)), staleTime: 60_000 });
  const engagements = useQuery({ queryKey: ["engagements", { account_id: draft?.account_id }], queryFn: () => engagementsApi.list({ account_id: draft!.account_id!, limit: 200 }), select: (p) => p.items, enabled: !!draft?.account_id });

  const status = invoice.data?.status ?? "draft";
  const editable = status === "draft" && (id == null || invoice.data?.created_by_id === user.id || atLeast("manager"));
  const dirty = !!draft && snapshot(draft) !== baseline;
  const profile = profiles.data?.find((p) => p.id === draft?.billing_profile_id);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  async function pickAccount(accountId: number | null, base?: Draft) {
    setDraft((d) => { const cur = d ?? base!; return { ...cur, account_id: accountId, engagement_id: null }; });
    if (!accountId) return;
    try {
      const pre = await billingApi.prefill(accountId);
      setDraft((d) => d && ({ ...d, billed_to_name: pre.billed_to_name, billed_to_address: pre.billed_to_address ?? "", billed_to_email: pre.billed_to_email ?? d.billed_to_email }));
    } catch (err) { error(err); }
  }

  const problems = useMemo(() => {
    if (!draft) return [];
    const out: string[] = [];
    if (!draft.billing_profile_id) out.push("Choose a billing profile.");
    if (!draft.billed_to_name.trim()) out.push("Enter who the invoice is billed to.");
    if (!draft.lines.length) out.push("Add at least one line item.");
    if (Object.keys(lineErrors(draft.lines)).length) out.push("Fix the highlighted line items.");
    if (!/^[A-Za-z]{3}$/.test(draft.currency.trim())) out.push("Currency must be a 3-letter code such as USD.");
    return out;
  }, [draft]);

  /** Persist the form (create or update). Returns the saved invoice id, or null when validation fails. */
  async function save(quiet = false): Promise<number | null> {
    if (!draft) return null;
    setAttempted(true);
    if (problems.length) { error(new Error(problems[0])); return null; }
    if (id != null && !dirty) return id;
    setBusy(true);
    try {
      const saved = id == null ? await billingApi.create(toBody(draft)) : await billingApi.update(id, toBody(draft));
      qc.invalidateQueries({ queryKey: ["invoices"] }); qc.invalidateQueries({ queryKey: ["invoice", saved.id] });
      setBaseline(snapshot(draft));
      if (!quiet) toast(id == null ? "Draft invoice created" : "Draft saved");
      if (id == null) nav(`/billing/${saved.id}`, { replace: true });
      return saved.id;
    } catch (err) { error(err); return null; } finally { setBusy(false); }
  }

  const run = async (fn: (invoiceId: number) => Promise<unknown>, message: string, saveFirst = false) => {
    const target = saveFirst ? await save(true) : id;
    if (target == null) return;
    setBusy(true);
    try { await fn(target); qc.invalidateQueries({ queryKey: ["invoice", target] }); qc.invalidateQueries({ queryKey: ["invoices"] }); if (message) toast(message); }
    catch (err) { error(err); } finally { setBusy(false); }
  };
  const fileName = (i: Invoice | undefined) => `${(i?.billed_to_name ?? draft?.billed_to_name ?? "Invoice").replace(/[^\w\s-]/g, "").trim()} Invoice ${i?.number ?? "Draft"}.pdf`;
  const downloadPdf = () => run((target) => billingApi.pdf(target, fileName(invoice.data)), "", status === "draft");
  const issue = async () => {
    if (!(await confirm({ title: "Issue this invoice?", body: "It receives the next invoice number and can no longer be edited.", confirmLabel: "Issue invoice", tone: "primary" }))) return;
    await run((target) => billingApi.issue(target), "Invoice issued", true);
  };
  const openSend = async () => { if (status === "draft" && (await save(true)) == null) return; setSending(true); };
  const voidInvoice = async () => {
    const text = await reason({ title: `Void invoice ${invoice.data?.number ?? ""}?`.trim(), label: "Reason", placeholder: "e.g. Issued in error", confirmLabel: "Void invoice", tone: "danger" });
    if (text !== null) await run((target) => billingApi.void(target, text), "Invoice voided");
  };
  const remove = async () => {
    if (!(await confirm({ title: "Delete this draft?", body: "The draft and its line items are removed permanently.", confirmLabel: "Delete draft" }))) return;
    setBusy(true);
    try { await billingApi.remove(id!); qc.invalidateQueries({ queryKey: ["invoices"] }); toast("Draft deleted"); nav("/billing"); } catch (err) { error(err); } finally { setBusy(false); }
  };
  const duplicate = () => run(async (target) => { const copy = await billingApi.duplicate(target); nav(`/billing/${copy.id}`); }, "Copied to a new draft");

  if (id != null && invoice.isError) return <NotFound what="Invoice" backTo="/billing" backLabel="Back to billing" />;
  if (!draft || profiles.isLoading || (id != null && !invoice.data)) return <Spinner />;
  if (id == null && profiles.data && !profiles.data.length) return <NotFound what="Billing profile" backTo="/billing" backLabel="Set up billing first" />;

  const i = invoice.data;
  const manager = atLeast("manager");
  const menu: MenuItem[] = [
    ...(id != null ? [{ label: "Duplicate as new draft", icon: <Copy />, onSelect: duplicate, disabled: busy }] : []),
    ...(manager && i && ["issued", "sent"].includes(status) ? [{ label: "Void invoice", icon: <Ban />, tone: "danger" as const, onSelect: voidInvoice, disabled: busy }] : []),
    ...(editable && id != null ? [{ label: "Delete draft", icon: <Trash2 />, tone: "danger" as const, onSelect: remove, disabled: busy }] : []),
  ];
  const issuer = i?.issuer_snapshot ? (i.issuer_snapshot as Parameters<typeof InvoicePreview>[0]["issuer"]) : profile;
  const termValues = invoicePlaceholderValues({ ...draft, number: i?.number }, formatCents(invoiceTotalCents(draft.lines), draft.currency), issuer?.issuer_name, profile?.default_terms_days);
  const showErrors = attempted;

  return (
    <div>
      <PageHeader
        title={<>{i?.number ? `Invoice ${i.number}` : id == null ? "New invoice" : "Draft invoice"}{i && <InvoiceStatusBadge status={i.status} />}</>}
        subtitle={<><Link to="/billing">Billing</Link>{i?.account_id && <> · <Link to={`/accounts/${i.account_id}`}>{i.account_name}</Link></>}{i?.void_reason && <> · Voided: {i.void_reason}</>}{dirty && <> · Unsaved changes</>}</>}
        actions={<>
          {editable && <Button onClick={() => save()} disabled={busy || (id != null && !dirty)}><Save size={14} />{id == null ? "Save draft" : "Save"}</Button>}
          <Button onClick={downloadPdf} disabled={busy}><Download size={14} />{status === "draft" ? "Preview PDF" : "Download PDF"}</Button>
          {manager && id != null && status === "draft" && <Button onClick={issue} disabled={busy}><FileCheck2 size={14} />Issue</Button>}
          {manager && id != null && ["draft", "issued", "sent"].includes(status) && <Button variant="primary" onClick={openSend} disabled={busy}><Mail size={14} />{status === "sent" ? "Resend" : "Send"}</Button>}
          {manager && ["issued", "sent"].includes(status) && <Button onClick={() => run((target) => billingApi.markPaid(target), "Marked as paid")} disabled={busy}><CheckCircle2 size={14} />Mark paid</Button>}
          {menu.length > 0 && <OverflowMenu items={menu} size="md" label="More invoice actions" />}
        </>} />

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-7">
          <Card title="Billed to">
            <fieldset disabled={!editable} className="grid grid-cols-2 gap-4">
              <Field label="Billing profile *" hint="Your company details and wire instructions.">
                <Select value={draft.billing_profile_id ?? ""} options={(profiles.data ?? []).map((p) => ({ value: p.id, label: p.label }))} placeholder="Select…"
                  onChange={(e) => { const p = profiles.data?.find((x) => x.id === Number(e.target.value)); setDraft((d) => d && ({ ...d, billing_profile_id: p?.id ?? null, terms_text: d.terms_text === profile?.default_terms_text ? p?.default_terms_text ?? "" : d.terms_text })); }} />
              </Field>
              <Field label="Account" hint="Optional. Fills in the customer details below.">
                <Select value={draft.account_id ?? ""} options={(accounts.data ?? []).map((a) => ({ value: a.id, label: a.name }))} placeholder="No linked account" onChange={(e) => pickAccount(e.target.value ? Number(e.target.value) : null)} />
              </Field>
              <Field label="Engagement" className="col-span-2">
                <Select value={draft.engagement_id ?? ""} disabled={!draft.account_id} options={(engagements.data ?? []).map((e) => ({ value: e.id, label: `${e.name} · ${titleCase(e.status)}` }))}
                  placeholder={draft.account_id ? "No engagement" : "Choose an account first"} onChange={(e) => set("engagement_id", e.target.value ? Number(e.target.value) : null)} />
              </Field>
              <Field label="Customer name *" className="col-span-2" error={showErrors && !draft.billed_to_name.trim() ? "Customer name is required." : undefined}>
                <Input value={draft.billed_to_name} maxLength={200} onChange={(e) => set("billed_to_name", e.target.value)} />
              </Field>
              <Field label="Address" className="col-span-2" hint="One line per row, as it should print.">
                <Textarea rows={3} value={draft.billed_to_address} maxLength={1000} onChange={(e) => set("billed_to_address", e.target.value)} />
              </Field>
              <Field label="Billing email" hint="Default recipient when sending."><Input type="email" value={draft.billed_to_email} onChange={(e) => set("billed_to_email", e.target.value)} /></Field>
              <Field label="CC" hint="Comma-separated."><Input value={draft.billed_to_cc} maxLength={500} onChange={(e) => set("billed_to_cc", e.target.value)} /></Field>
            </fieldset>
          </Card>

          <Card title="Line items">
            <LineItemsEditor lines={draft.lines} onChange={(lines) => set("lines", lines)} currency={draft.currency} readOnly={!editable} showErrors={showErrors} />
          </Card>

          <Card title="Dates and terms">
            <fieldset disabled={!editable} className="grid grid-cols-3 gap-4">
              <Field label="Date of issue" hint="Defaults to the day it is issued."><Input type="date" value={draft.issue_date} onChange={(e) => set("issue_date", e.target.value)} /></Field>
              <Field label="Due date" hint={profile ? `Defaults to ${profile.default_terms_days} days after issue.` : undefined}><Input type="date" value={draft.due_date} onChange={(e) => set("due_date", e.target.value)} /></Field>
              <Field label="Currency"><Input value={draft.currency} maxLength={3} onChange={(e) => set("currency", e.target.value.toUpperCase())} /></Field>
              <TemplateField label="Terms" className="col-span-3" value={draft.terms_text} maxLength={500} onChange={(text) => set("terms_text", text)}
                values={termValues} disabled={!editable} hint="Placeholders are filled in when the invoice is issued." />
              <Field label="Notes" className="col-span-3" hint="Printed under the terms."><Textarea rows={2} value={draft.notes} maxLength={5000} onChange={(e) => set("notes", e.target.value)} /></Field>
            </fieldset>
          </Card>
        </div>

        <div className="space-y-4 xl:sticky xl:top-0 xl:col-span-5">
          <Card title="Preview">
            <InvoicePreview issuer={issuer} number={i?.number} issueDate={draft.issue_date || (status === "draft" ? new Date().toISOString().slice(0, 10) : null)}
              billedToName={draft.billed_to_name} billedToAddress={draft.billed_to_address} lines={draft.lines} currency={draft.currency}
              terms={[renderTemplatePreview(draft.terms_text, termValues), draft.notes].filter(Boolean).join("\n")} />
          </Card>
          {!!i?.deliveries?.length && (
            <Card title="Email history">
              <ul className="space-y-2 text-[13px]">
                {[...i.deliveries].reverse().map((d) => (
                  <li key={d.id} className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><div className="truncate">{d.to_email}{d.cc && <span className="text-crm-sand-500"> · cc {d.cc}</span>}</div>
                      {d.error && <div className={d.status === "failed" ? "text-crm-danger-600" : "text-crm-warn-700"}>{d.error}</div>}</div>
                    <div className="shrink-0 text-right text-[12px] text-crm-sand-500"><div className={d.status === "failed" ? "text-crm-danger-600" : "text-crm-success-700"}>{titleCase(d.status)}</div>{fmtDateTime(d.created_at)}</div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
      {sending && i && <SendInvoiceDialog invoice={i} profile={profile} onClose={() => setSending(false)}
        onSent={() => { qc.invalidateQueries({ queryKey: ["invoice", i.id] }); qc.invalidateQueries({ queryKey: ["invoices"] }); }} />}
    </div>
  );
}
