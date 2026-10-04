import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@/components/firmcrm/lib/query";
import { useNavigate } from "@/components/firmcrm/lib/navigation";
import { Plus, ArrowRight, Download, AlertTriangle, Archive, ArchiveRestore } from "lucide-react";
import { accountsApi, campaignsApi, dataApi, leadsApi } from "@/components/firmcrm/api";
import { Pagination, usePager } from "@/components/firmcrm/components/ui/Pagination";
import { useAuth } from "@/components/firmcrm/lib/auth";
import type { Lead } from "@/components/firmcrm/api/types";
import { Badge, Button, Empty, Field, Input, Modal, OverflowMenu, PageHeader, Select, cn, statusTone, type MenuItem } from "@/components/firmcrm/components/ui";
import { DataTable, useServerSort, type Column } from "@/components/firmcrm/components/ui/DataTable";
import { FormModal, MoneyInput, type FieldDef, type FormValues } from "@/components/firmcrm/components/ui/Form";
import { useConfirm, useReasonPrompt } from "@/components/firmcrm/components/ui/Confirm";
import { useToast } from "@/components/firmcrm/components/ui/Toast";
import { usePracticeAreas, useUsers, opt, strOpts } from "@/components/firmcrm/lib/hooks";
import { LEAD_SOURCES, LEAD_STATUSES } from "@/components/firmcrm/lib/options";
import { plural, titleCase } from "@/components/firmcrm/lib/format";
import { ArchivedChip, FilterToggle, NameCell, ResultCount, SearchInput, cellMoney, cellText } from "@/components/firmcrm/components/ui/cells";

export default function LeadsPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { toast, error } = useToast();
  const reason = useReasonPrompt(); const confirm = useConfirm();
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [archived, setArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [converting, setConverting] = useState<Lead | null>(null);
  const pager = usePager(50);
  // Server-side ordering so sort + paging agree (flows QA #10); practice area and owner have no API sort field.
  const sorting = useServerSort({ key: "score", dir: "desc" }, { name: "last_name", status: "status", value: "estimated_value", score: "score" }, pager.reset);
  const leads = useQuery({ queryKey: ["leads", status, q, archived, sorting.params, pager.limit, pager.offset], queryFn: () => leadsApi.list({ status: status || undefined, q: q || undefined, include_converted: status === "converted", include_archived: archived, ...sorting.params, limit: pager.limit, offset: pager.offset }) });
  const { atLeast } = useAuth();
  const users = useUsers(); const pas = usePracticeAreas(true); // picker: active practice areas only (flows QA #9)
  const camps = useQuery({ queryKey: ["campaigns"], queryFn: () => campaignsApi.list({ limit: 500 }), select: (p) => p.items });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["leads"] });
  const filtered = Boolean(q || status || archived);
  const clearFilters = () => { setQ(""); setStatus(""); setArchived(false); pager.reset(); };
  // Archive / restore is manager+ (SECURITY.md; flows QA #8) and lives in the row's ⋯ menu with a confirm.
  const archiveM = useMutation({ mutationFn: (l: Lead) => (l.is_archived ? leadsApi.restore(l.id) : leadsApi.archive(l.id)), onSuccess: (l) => { invalidate(); toast(l.is_archived ? "Lead archived" : "Lead restored"); }, onError: error });
  const archiveOrRestore = async (l: Lead) => {
    if (l.is_archived) { archiveM.mutate(l); return; }
    if (await confirm({ title: `Archive ${l.first_name} ${l.last_name}?`, body: "The lead leaves the list and reports but can be restored from “Show archived”.", confirmLabel: "Archive" })) archiveM.mutate(l);
  };
  const rowMenu = (l: Lead): MenuItem[] => [
    ...(atLeast("manager") ? [l.is_archived
      ? { label: "Restore", icon: <ArchiveRestore />, onSelect: () => archiveOrRestore(l) }
      : { label: "Archive", icon: <Archive />, tone: "danger" as const, onSelect: () => archiveOrRestore(l) }] : []),
  ];

  const fields: FieldDef[] = useMemo(() => [
    { name: "first_name", label: "First name", required: true }, { name: "last_name", label: "Last name", required: true },
    { name: "company", label: "Company" }, { name: "title", label: "Title" },
    { name: "email", label: "Email", type: "email" }, { name: "phone", label: "Phone" },
    { name: "source", label: "Source", type: "select", options: strOpts(LEAD_SOURCES) }, { name: "status", label: "Status", type: "select", options: strOpts(LEAD_STATUSES) },
    { name: "practice_area_id", label: "Practice area", type: "select", options: opt(pas.data, (p) => p.name) }, { name: "owner_id", label: "Owner", type: "select", options: opt(users.data, (u) => u.full_name) },
    { name: "campaign_id", label: "Campaign", type: "select", options: opt(camps.data, (c) => c.name) }, { name: "estimated_value", label: "Estimated value", type: "money", min: 0 },
    { name: "score", label: "Score (0–100)", type: "number", min: 0, max: 100 },
    { name: "unqualified_reason", label: "Unqualified reason", hint: "Required when status is unqualified", validate: (v, all) => (all.status === "unqualified" && !(typeof v === "string" && v.trim()) ? "Give a reason when marking a lead unqualified." : null) },
    { name: "need_summary", label: "Need summary", type: "textarea" },
  ], [pas.data, users.data, camps.data]);

  const quickStatus = useMutation({ mutationFn: ({ id, s, why }: { id: number; s: string; why?: string }) => leadsApi.update(id, { status: s, ...(s === "unqualified" ? { unqualified_reason: why ?? "" } : {}) }), onSuccess: (_, v) => { invalidate(); toast(`Lead marked ${titleCase(v.s).toLowerCase()}`); }, onError: error });
  /** Quick-status change; unqualifying asks for a reason in a ReasonDialog (QA #2) instead of prompt(). */
  const changeStatus = async (l: Lead, s: string) => {
    if (s === "unqualified") {
      const why = await reason({ title: `Mark ${l.first_name} ${l.last_name} unqualified`, label: "Reason", hint: "Recorded on the lead and in the audit log.", placeholder: "No budget, wrong fit, went with another firm…", required: true, confirmLabel: "Mark unqualified", tone: "danger" });
      if (why == null) return;
      quickStatus.mutate({ id: l.id, s, why });
      return;
    }
    quickStatus.mutate({ id: l.id, s });
  };
  const statusMenu = (l: Lead): MenuItem[] => LEAD_STATUSES.filter((s) => s !== l.status).map((s) => ({ label: `Mark ${titleCase(s).toLowerCase()}`, tone: s === "unqualified" ? "danger" : undefined, onSelect: () => changeStatus(l, s) }));

  const cols: Column<Lead>[] = [
    // Source rides on the second line so the list fits at 1440 with the inline status control.
    { key: "name", header: "Lead", sort: (l) => l.last_name, render: (l) => <NameCell name={`${l.first_name} ${l.last_name}`} sub={[l.title, l.company, titleCase(l.source)].filter(Boolean).join(" · ")} max={260} chips={l.is_archived && <ArchivedChip />} /> },
    // Status is dot + label (§6.8) with a small ⋯ menu for quick changes (QA #18); converted leads are terminal and get a filled pill.
    { key: "status", header: "Status", sort: (l) => l.status, width: "170px", render: (l) => l.status === "converted"
      ? <Badge tone={statusTone(l.status)}>{titleCase(l.status)}</Badge>
      : <span className="group/status inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <Badge dot tone={statusTone(l.status)}>{titleCase(l.status)}</Badge>
          <OverflowMenu items={statusMenu(l)} label="Change status" align="start" className="opacity-0 transition-opacity duration-[120ms] group-hover/status:opacity-100 focus-within:opacity-100 data-[open]:opacity-100 [tr:hover_&]:opacity-100 [tr:focus-visible_&]:opacity-100" />
        </span> },
    { key: "pa", header: "Practice area", hideBelow: 1280, render: (l) => cellText(l.practice_area_name, 180) },
    { key: "value", header: "Est. value", align: "right", width: "128px", sort: (l) => l.estimated_value ?? 0, render: (l) => cellMoney(l.estimated_value) },
    // Score is a count-like number: 400 weight, neutral (§2.3 reserves green for money/cleared/won; QA #32).
    { key: "score", header: "Score", align: "right", width: "80px", sort: (l) => l.score, render: (l) => <span className="font-normal">{l.score}</span> },
    { key: "owner", header: "Owner", width: "150px", hideBelow: 1180, render: (l) => cellText(l.owner_name) },
    // Created date is in the edit modal; the list is sorted by score and keeps the quick-status + convert controls visible at 1440.
    { key: "actions", header: "", width: "148px", render: (l) => (
      <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        {l.status === "converted"
          ? <Button size="sm" variant="ghost" onClick={() => nav(l.converted_opportunity_id ? `/opportunities/${l.converted_opportunity_id}` : `/accounts/${l.converted_account_id}`)}>View<ArrowRight size={12} /></Button>
          : l.status !== "unqualified" && !l.is_archived && <Button size="sm" onClick={() => setConverting(l)}>Convert<ArrowRight size={12} /></Button>}
        {rowMenu(l).length > 0 && <OverflowMenu items={rowMenu(l)} label="More actions" />}
      </div>) },
  ];
  const empty = filtered
    ? <Empty title="No leads match these filters" hint="Try a broader search or clear the status filter." action={<Button size="sm" onClick={clearFilters}>Clear filters</Button>} />
    : <Empty title="No open leads" hint="New leads from the web form, events, and referrals appear here." />;
  return (
    <div>
      <PageHeader title="Leads" subtitle="Inbound interest before qualification. Qualify, then convert to an account, contact, and opportunity." actions={<Button variant="primary" onClick={() => setCreating(true)}><Plus size={14} />New lead</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput placeholder="Search name, company, email…" value={q} onChange={(e) => { setQ(e.target.value); pager.reset(); }} />
        <Select value={status} onChange={(e) => { setStatus(e.target.value); pager.reset(); }} options={[...strOpts(LEAD_STATUSES), { value: "converted", label: "Converted" }]} placeholder="All statuses" className="!w-[180px]" aria-label="Lead status" />
        <FilterToggle checked={archived} onChange={(v) => { setArchived(v); pager.reset(); }}>Show archived</FilterToggle>
        <ResultCount>{plural(leads.data?.total ?? 0, "lead")}</ResultCount>
        {atLeast("manager") && <Button size="sm" className="ml-auto" onClick={() => dataApi.exportCsv("leads").catch(error)}><Download size={12} />Export CSV</Button>}
      </div>
      <div className="card overflow-hidden">
        <DataTable rows={leads.data?.items} columns={cols} loading={leads.isLoading} twoLine onRowClick={(l) => l.status !== "converted" && !l.is_archived && setEditing(l)} sort={sorting.sort} onSortChange={sorting.onSortChange} empty={empty} />
        <Pagination total={leads.data?.total} limit={pager.limit} offset={pager.offset} onOffset={pager.setOffset} onLimit={pager.setLimit} />
      </div>
      <FormModal open={creating} onClose={() => setCreating(false)} title="New lead" fields={fields} initial={{ source: "web", status: "new", score: 50 }} submitLabel="Create"
        onSubmit={async (v) => { await leadsApi.create(v as Partial<Lead>); invalidate(); toast("Lead created"); }} />
      {editing && <FormModal open onClose={() => setEditing(null)} title={`Edit lead · ${editing.first_name} ${editing.last_name}`} fields={fields} initial={editing as unknown as FormValues}
        onSubmit={async (v) => { const body: Record<string, unknown> = {}; for (const f of fields) body[f.name] = v[f.name] ?? null; await leadsApi.update(editing.id, body as Partial<Lead>); invalidate(); toast("Lead updated"); }} />}
      {converting && <ConvertModal lead={converting} onClose={() => setConverting(null)} onDone={(r) => { setConverting(null); invalidate(); qc.invalidateQueries({ queryKey: ["accounts"] }); toast("Lead converted"); nav(r.opportunity_id ? `/opportunities/${r.opportunity_id}` : `/accounts/${r.account_id}`); }} />}
    </div>
  );
}

function ConvertModal({ lead, onClose, onDone }: { lead: Lead; onClose: () => void; onDone: (r: { account_id: number; opportunity_id: number | null }) => void }) {
  const { error } = useToast();
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [accountQ, setAccountQ] = useState(lead.company ?? "");
  const [existingId, setExistingId] = useState<number | null>(null);
  const [createOpp, setCreateOpp] = useState(true);
  const [oppName, setOppName] = useState(`${lead.company ?? lead.last_name} – ${lead.need_summary?.slice(0, 40) ?? "New engagement"}`);
  const [amount, setAmount] = useState<number | null>(lead.estimated_value ?? null);
  const [close, setClose] = useState("");
  const found = useQuery({ queryKey: ["accounts", "match", accountQ], queryFn: () => accountsApi.list({ q: accountQ, limit: 8 }), enabled: accountQ.length >= 2, select: (p) => p.items });
  // A lead must not be converted onto a party the firm is adverse to (flows QA #14): the picker hides adverse parties and both modes warn.
  const adverse = found.data?.filter((a) => a.account_type === "adverse_party") ?? [];
  const matches = { ...found, data: found.data?.filter((a) => a.account_type !== "adverse_party") };
  const m = useMutation({ mutationFn: () => leadsApi.convert(lead.id, { existing_account_id: mode === "existing" ? existingId : null, create_opportunity: createOpp, opportunity_name: oppName, amount, expected_close: close || null }), onSuccess: onDone, onError: error });
  const newName = lead.company ?? `${lead.first_name} ${lead.last_name}`;
  return (
    <Modal open onClose={onClose} title={`Convert lead · ${lead.first_name} ${lead.last_name}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={m.isPending || (mode === "existing" && !existingId)} onClick={() => m.mutate()}>{m.isPending ? "Converting…" : "Convert"}</Button></>}>
      <div className="space-y-4">
        <div>
          <div className="label">Account</div>
          <div className="space-y-2 text-[13px] text-crm-sand-900">
            <label className="flex items-center gap-2"><input type="radio" name="convert-mode" checked={mode === "new"} onChange={() => setMode("new")} />Create new account <span className="font-medium">{newName}</span></label>
            <label className="flex items-center gap-2"><input type="radio" name="convert-mode" checked={mode === "existing"} onChange={() => setMode("existing")} />Attach to an existing account</label>
          </div>
          {/* Duplicate warning is an inline note (§6.11), not a colored block. */}
          {mode === "new" && matches.data && matches.data.length > 0 && (
            <div className="mt-2 flex items-start gap-1.5 text-[12px] leading-4 text-crm-warn-700">
              <AlertTriangle size={14} className="mt-px shrink-0 text-crm-warn-600" aria-hidden />
              <span>Possible duplicate: {matches.data.length} existing {matches.data.length === 1 ? "account matches" : "accounts match"} “{accountQ}”. Consider attaching to an existing account instead.</span>
            </div>)}
          {adverse.length > 0 && (
            <div className="mt-2 flex items-start gap-1.5 text-[12px] leading-4 text-crm-warn-700" role="status">
              <AlertTriangle size={14} className="mt-px shrink-0 text-crm-warn-600" aria-hidden />
              <span>“{accountQ}” matches {adverse.length === 1 ? "an adverse party" : `${adverse.length} adverse parties`} ({adverse.map((a) => a.name).join(", ")}). Adverse-party accounts are not offered here; check for a conflict before converting.</span>
            </div>)}
        </div>
        {mode === "existing" && (
          <div className="space-y-2">
            <SearchInput className="w-full" value={accountQ} onChange={(e) => setAccountQ(e.target.value)} placeholder="Search accounts…" autoFocus />
            <div className="max-h-[180px] overflow-auto rounded-crm-md border border-crm-sand-150">
              {(matches.data ?? []).map((a) => (
                <label key={a.id} className={cn("flex h-9 cursor-pointer items-center gap-2 px-3 text-[13px] hover:bg-crm-sand-25", existingId === a.id && "bg-crm-accent-50")}>
                  <input type="radio" name="existing-account" checked={existingId === a.id} onChange={() => setExistingId(a.id)} />
                  <span className="truncate">{a.name}</span>
                  <Badge dot tone={statusTone(a.account_type)} className="ml-auto">{titleCase(a.account_type)}</Badge>
                </label>))}
              {accountQ.length >= 2 && matches.data && !matches.data.length && <div className="px-3 py-2 text-[12px] text-crm-sand-500">No accounts match</div>}
              {accountQ.length < 2 && <div className="px-3 py-2 text-[12px] text-crm-sand-500">Type at least two characters to search</div>}
            </div>
          </div>)}
        <label className="flex items-center gap-2 text-[13px] text-crm-sand-900"><input type="checkbox" checked={createOpp} onChange={(e) => setCreateOpp(e.target.checked)} />Also create an opportunity</label>
        {createOpp && <div className="grid grid-cols-2 gap-4">
          <Field label="Opportunity name" className="col-span-2"><Input value={oppName} onChange={(e) => setOppName(e.target.value)} /></Field>
          <Field label="Estimated fees"><MoneyInput value={amount} onValueChange={setAmount} min={0} /></Field>
          <Field label="Expected close"><Input type="date" value={close} onChange={(e) => setClose(e.target.value)} /></Field>
        </div>}
      </div>
    </Modal>
  );
}
