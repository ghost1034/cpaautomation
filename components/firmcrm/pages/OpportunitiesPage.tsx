import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@/components/firmcrm/lib/query";
import { useNavigate } from "@/components/firmcrm/lib/navigation";
import { Plus, LayoutGrid, List, ShieldCheck, Download, Trophy, XCircle } from "lucide-react";
import { accountsApi, contactsApi, dataApi, oppsApi } from "@/components/firmcrm/api";
import { Pagination, usePager } from "@/components/firmcrm/components/ui/Pagination";
import { useAuth } from "@/components/firmcrm/lib/auth";
import type { Opportunity, Stage } from "@/components/firmcrm/api/types";
import { Badge, Button, Empty, Input, PageHeader, Select, cn, statusTone } from "@/components/firmcrm/components/ui";
import { DataTable, useServerSort, type Column } from "@/components/firmcrm/components/ui/DataTable";
import { ArchivedChip, FilterToggle, NameCell, cellMoney, cellText } from "@/components/firmcrm/components/ui/cells";
import { useMediaQuery } from "@/components/firmcrm/components/ui/useMediaQuery";
import { FormModal, type FieldDef, type FormValues } from "@/components/firmcrm/components/ui/Form";
import { useToast } from "@/components/firmcrm/components/ui/Toast";
import { ClearanceShield, KanbanCard, StaleChip, isPastDue } from "@/components/firmcrm/components/crm/KanbanCard";
import { paLabel, usePipelines, usePracticeAreas, useUsers, opt, partnerOptions, strOpts } from "@/components/firmcrm/lib/hooks";
import { EL_STATUSES, FEE_TYPES } from "@/components/firmcrm/lib/options";
import { fmtDate, useMoney, titleCase } from "@/components/firmcrm/lib/format";
import { CloseLostModal } from "./OpportunityDetailPage";

export function useOpportunityFields(accountId?: number, contactAccountId = accountId): FieldDef[] {
  const users = useUsers(); const pas = usePracticeAreas(true); // picker: active practice areas only (flows QA #9)
  const accounts = useQuery({ queryKey: ["accounts", "all"], queryFn: () => accountsApi.list({ limit: 500 }), staleTime: 60_000, select: (p) => p.items });
  const contacts = useQuery({ queryKey: ["contacts", "acct", contactAccountId], queryFn: () => contactsApi.list({ account_id: contactAccountId, limit: 200 }), enabled: !!contactAccountId, select: (p) => p.items });
  const referrers = useQuery({ queryKey: ["contacts", "referrers"], queryFn: () => contactsApi.list({ role: "referral_source", limit: 200 }), staleTime: 60_000, select: (p) => p.items });
  return useMemo(() => [
    { name: "name", label: "Opportunity name", required: true, span: 2 },
    ...(accountId ? [] : [{ name: "account_id", label: "Account", type: "select", options: opt(accounts.data?.filter((a) => a.account_type !== "adverse_party"), (a) => a.name), required: true } as FieldDef]),
    { name: "primary_contact_id", label: "Primary contact", type: "select", options: opt(contacts.data, (c) => c.full_name) },
    { name: "practice_area_id", label: "Practice area", type: "select", options: opt(pas.data, (p) => `${p.name}${p.clearance_type ? ` (${p.clearance_type} check)` : ""}`) },
    { name: "amount", label: "Estimated fees", type: "money", min: 0, required: true }, { name: "fee_type", label: "Fee type", type: "select", options: strOpts(FEE_TYPES) },
    { name: "is_recurring", label: "Recurring / annual engagement", type: "checkbox" }, { name: "expected_close", label: "Expected close", type: "date" },
    { name: "owner_id", label: "Pursuit owner", type: "select", options: opt(users.data, (u) => u.full_name) },
    { name: "originating_partner_id", label: "Originating partner (credit)", type: "select", options: partnerOptions(users.data) },
    { name: "responsible_partner_id", label: "Responsible partner", type: "select", options: partnerOptions(users.data) },
    { name: "referral_contact_id", label: "Referred by", type: "select", options: opt(referrers.data, (c) => `${c.full_name}${c.account_name ? ` (${c.account_name})` : ""}`) },
    { name: "proposal_due", label: "Proposal due", type: "date" }, { name: "engagement_letter_status", label: "Engagement letter", type: "select", options: strOpts(EL_STATUSES) },
    { name: "adverse_parties", label: "Adverse / related parties", type: "tags", span: 2, hint: "Comma-separated. Feeds conflict search." },
    { name: "competitor", label: "Competitor" }, { name: "next_step", label: "Next step" },
    { name: "description", label: "Description", type: "textarea" },
  ], [accountId, accounts.data, contacts.data, pas.data, users.data, referrers.data]);
}

export function NewOpportunityModal({ accountId, onClose }: { accountId?: number; onClose: () => void }) {
  const qc = useQueryClient(); const nav = useNavigate(); const { toast } = useToast();
  const initial = { account_id: accountId, fee_type: "hourly", engagement_letter_status: "not_started", adverse_parties: [], is_recurring: false };
  const [values, setValues] = useState<FormValues>(initial);
  const fields = useOpportunityFields(accountId, Number(values.account_id) || undefined);
  return (
    <FormModal open onClose={onClose} title="New opportunity" fields={fields} initial={initial} values={values} onValuesChange={(next) => setValues((previous) => next.account_id !== previous.account_id ? { ...next, primary_contact_id: null } : next)} submitLabel="Create"
      onSubmit={async (v) => { const o = await oppsApi.create({ ...(v as Partial<Opportunity>), account_id: accountId ?? (v.account_id as number) }); qc.invalidateQueries({ queryKey: ["opps"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); toast("Opportunity created"); nav(`/opportunities/${o.id}`); }} />
  );
}

const isClearanceStage = (s: Stage) => /clearance|conflict|independence/i.test(s.name);

/** Segmented board/table toggle (§6.3 action cluster). */
function ViewToggle({ view, onChange }: { view: "board" | "table"; onChange: (v: "board" | "table") => void }) {
  const btn = (v: "board" | "table", Icon: typeof LayoutGrid, label: string) => (
    <button type="button" onClick={() => onChange(v)} aria-pressed={view === v} aria-label={label} title={label}
            className={cn("grid h-8 w-8 place-items-center border border-crm-sand-200 transition-colors duration-[120ms] first:rounded-l-md last:-ml-px last:rounded-r-md", view === v ? "bg-crm-sand-100 text-crm-sand-900" : "bg-crm-sand-0 text-crm-sand-600 hover:text-crm-sand-900")}>
      <Icon size={14} />
    </button>
  );
  return <div className="inline-flex h-8">{btn("board", LayoutGrid, "Board view")}{btn("table", List, "Table view")}</div>;
}

/** Won / Lost docked drop strip under the open-stage columns (§6.7). */
function DropStrip({ stages, dragOver, onDragOver, onDragLeave, onDrop }: {
  stages: Stage[]; dragOver: number | null; onDragOver: (s: Stage, e: React.DragEvent) => void; onDragLeave: () => void; onDrop: (s: Stage, e: React.DragEvent) => void;
}) {
  const won = stages.find((s) => s.is_won); const lost = stages.find((s) => s.is_lost);
  const zone = (s: Stage | undefined, kind: "won" | "lost") => {
    if (!s) return <div />;
    const over = dragOver === s.id;
    const Icon = kind === "won" ? Trophy : XCircle;
    return (
      <div data-tour={kind === "won" ? "drop-won" : undefined} onDragOver={(e) => onDragOver(s, e)} onDragLeave={onDragLeave} onDrop={(e) => onDrop(s, e)}
           className={cn("flex min-h-14 flex-wrap items-center justify-center gap-2 px-3 py-3 rounded-crm-lg border border-dashed text-[12px] leading-4 font-medium transition-colors duration-[120ms]",
             !over && "border-crm-sand-300 text-crm-sand-500",
             over && kind === "won" && "border-solid border-crm-success-600 bg-crm-success-50 text-crm-success-700",
             over && kind === "lost" && "border-solid border-crm-danger-600 bg-crm-danger-50 text-crm-danger-700")}>
        <Icon size={16} strokeWidth={1.75} className="shrink-0" />
        <span className="whitespace-nowrap">Drop to mark {kind === "won" ? "Won" : "Lost"}</span>
        <span className={cn("font-normal", over ? (kind === "won" ? "text-crm-success-600" : "text-crm-danger-600") : "text-crm-sand-500")}>
          {kind === "won" ? "· requires cleared check and signed engagement letter" : "· you will be asked for a reason"}
        </span>
      </div>
    );
  };
  return <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">{zone(won, "won")}{zone(lost, "lost")}</div>;
}

export default function OpportunitiesPage() {
  const money = useMoney();
  const nav = useNavigate(); const qc = useQueryClient(); const { toast, error } = useToast();
  const [view, setView] = useState<"board" | "table">("board");
  const [status, setStatus] = useState("open"); const [ownerId, setOwnerId] = useState(""); const [paId, setPaId] = useState(""); const [q, setQ] = useState("");
  const [archived, setArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [losing, setLosing] = useState<{ opp: Opportunity; stage: Stage } | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const pipelines = usePipelines(); const users = useUsers(); const pas = usePracticeAreas();
  const pipeline = pipelines.data?.[0];
  const pager = usePager(100); const { atLeast } = useAuth();
  // Column budget: with table-layout fixed the name column takes what the fixed columns leave. Below 1280 the card is <1000px,
  // so Practice area and Weighted step out (≤1280) and Owner follows (≤1180) to keep the name column ≥240px (§6.6).
  const narrow = useMediaQuery("(max-width: 1280px)"); const narrower = useMediaQuery("(max-width: 1180px)");
  // Server-side ordering for the paged table (flows QA #10); Weighted, Practice area and Owner have no API sort field.
  const sorting = useServerSort({ key: "close", dir: "asc" }, { name: "name", stage: "stage", amount: "amount", prob: "probability", close: "expected_close" }, pager.reset);
  const opps = useQuery({ queryKey: ["opps", { status, ownerId, paId, q, archived, view, sort: sorting.params, limit: pager.limit, offset: pager.offset }], queryFn: () => oppsApi.list({ status, owner_id: ownerId || undefined, practice_area_id: paId || undefined, q: q || undefined, include_archived: archived, ...(view === "table" ? sorting.params : {}), limit: view === "board" ? 1000 : pager.limit, offset: view === "board" ? 0 : pager.offset }) });
  const rows = opps.data?.items;
  const filtered = Boolean(q || ownerId || paId || archived || status !== "open");
  const clearFilters = () => { setQ(""); setOwnerId(""); setPaId(""); setArchived(false); setStatus("open"); pager.reset(); };
  const move = useMutation({
    mutationFn: ({ id, stage_id }: { id: number; stage_id: number }) => oppsApi.stage(id, { stage_id }),
    onSuccess: (o) => { qc.invalidateQueries({ queryKey: ["opps"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); toast(`Moved to ${o.stage_name}`); }, onError: error,
  });
  const onDragOver = (s: Stage, e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (dragOver !== s.id) setDragOver(s.id); };
  const onDrop = (stage: Stage, e: React.DragEvent) => {
    e.preventDefault(); setDragOver(null);
    const id = Number(e.dataTransfer.getData("text/plain"));
    const o = rows?.find((x) => x.id === id);
    if (!o || o.stage_id === stage.id) return;
    if (stage.is_lost) { setLosing({ opp: o, stage }); return; }
    move.mutate({ id, stage_id: stage.id });
  };
  /* §6.6 table: two-line name cell (name / account) so rows are 52px; fixed widths on every other column so the
     name column absorbs the remainder. Days in stage and the stale chip live under the stage badge. */
  const cols: Column<Opportunity>[] = ([
    { key: "name", header: "Opportunity", sort: (o) => o.name, render: (o) => <NameCell name={o.name} sub={o.account_name} chips={<>{o.is_archived && <ArchivedChip />}<ClearanceShield o={o} size={13} /></>} max={360} /> },
    { key: "stage", header: "Stage", width: "140px", nowrap: true, sort: (o) => o.stage_position ?? 0, render: (o) => (
      <div className="min-w-0">
        <div className="flex h-5 items-center"><Badge dot tone={statusTone(o.status === "open" ? "open" : o.status)}>{o.stage_name}</Badge></div>
        <div className="flex h-5 items-center text-[12px] leading-4 text-crm-sand-500 num">{o.is_stale ? <StaleChip o={o} /> : o.status === "open" ? `${o.days_in_stage}d in stage` : null}</div>
      </div>) },
    { key: "pa", header: "Practice area", width: "160px", hide: narrow, render: (o) => cellText(o.practice_area_name, 128) },
    { key: "amount", header: "Amount", width: "128px", align: "right", nowrap: true, sort: (o) => o.amount, render: (o) => cellMoney(o.amount) },
    { key: "weighted", header: "Weighted", width: "128px", align: "right", nowrap: true, hide: narrow, render: (o) => cellMoney(o.weighted_amount) },
    { key: "prob", header: "Prob.", width: "64px", align: "right", nowrap: true, sort: (o) => o.probability, render: (o) => <span className="font-normal">{o.probability}%</span> },
    { key: "close", header: "Expected close", width: "120px", align: "right", nowrap: true, sort: (o) => o.expected_close ?? "", render: (o) => <span className={cn("num", isPastDue(o) ? "font-medium text-crm-danger-600" : "font-normal")}>{fmtDate(o.expected_close)}</span> },
    { key: "owner", header: "Owner", width: "160px", hide: narrower, render: (o) => cellText(o.owner_name, 128) },
  ] as (Column<Opportunity> & { hide?: boolean })[]).filter((c) => !c.hide);
  const total = rows?.reduce((s, o) => s + o.amount, 0) ?? 0;
  const weighted = rows?.reduce((s, o) => s + o.weighted_amount, 0) ?? 0;
  const visibleStages = pipeline?.stages.filter((s) => status === "open" ? !s.is_won && !s.is_lost : status === "all" ? true : status === "won" ? s.is_won : s.is_lost) ?? [];
  const dot = <span className="mx-1.5 text-crm-sand-300">·</span>;
  return (
    <div className="flex flex-col">
      <PageHeader title="Opportunities"
        subtitle={<><b className="font-medium text-crm-sand-700 num">{opps.data?.total ?? 0}</b> {status === "all" ? "" : `${status} `}{(opps.data?.total ?? 0) === 1 ? "opportunity" : "opportunities"}{view === "table" && opps.data && opps.data.total > pager.limit ? ` (showing ${rows?.length})` : ""}{dot}<b className="font-medium text-crm-sand-700 num">{money(total)}</b> total{dot}<b className="font-medium text-crm-sand-700 num">{money(weighted)}</b> weighted</>}
        actions={<>
          <ViewToggle view={view} onChange={setView} />
          {atLeast("manager") && <Button onClick={() => dataApi.exportCsv("opportunities").catch(error)}><Download size={14} />Export</Button>}
          <Button variant="primary" onClick={() => setCreating(true)}><Plus size={14} />New opportunity</Button>
        </>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input placeholder="Filter by name or account…" value={q} onChange={(e) => setQ(e.target.value)} className="!w-[240px]" aria-label="Filter opportunities" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: "open", label: "Open" }, { value: "won", label: "Won" }, { value: "lost", label: "Lost" }, { value: "all", label: "All" }]} className="!w-[112px]" aria-label="Status" />
        <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} options={opt(users.data, (u) => u.full_name)} placeholder="All owners" className="!w-[160px]" aria-label="Owner" />
        <Select value={paId} onChange={(e) => setPaId(e.target.value)} options={opt(pas.data, paLabel)} placeholder="All practice areas" className="!w-[184px]" aria-label="Practice area" />
        <FilterToggle checked={archived} onChange={(v) => { setArchived(v); pager.reset(); }}>Show archived</FilterToggle>
      </div>
      {opps.isLoading || !pipeline ? (
        view === "table" ? <div className="card shrink-0 overflow-hidden [&_table]:table-fixed"><DataTable rows={undefined} columns={cols} loading twoLine /></div> : <BoardSkeleton />
      ) : view === "table" ? (
        <div className="card shrink-0 overflow-hidden [&_table]:table-fixed"><DataTable rows={rows} columns={cols} twoLine onRowClick={(o) => nav(`/opportunities/${o.id}`)} sort={sorting.sort} onSortChange={sorting.onSortChange}
          empty={filtered
            ? <Empty title="No opportunities match these filters" hint="Try a broader search, another status, or clear the filters." action={<Button size="sm" onClick={clearFilters}>Clear filters</Button>} />
            : <Empty title="No open opportunities" hint="Convert a lead or create an opportunity to start the pipeline." />} /><Pagination total={opps.data?.total} limit={pager.limit} offset={pager.offset} onOffset={pager.setOffset} onLimit={pager.setLimit} /></div>
      ) : (
        <>
          {/* Board (§6.7): columns flex to fill; horizontal scroll only when stages × min-width exceeds the width.
              min-width is 216px, not the spec's 220: at 1440 the region is 1160px and 5×220 + 4×16 = 1164 would force a 4px scroll.
              The board scrolls with the page (main is overflow-auto) rather than clipping each column independently. */}
          <div className="flex items-stretch gap-4 overflow-x-auto pb-2">
            {visibleStages.map((s) => {
              const items = (rows ?? []).filter((o) => o.stage_id === s.id);
              const sum = items.reduce((a, o) => a + o.amount, 0);
              const over = dragOver === s.id;
              return (
                <section key={s.id} className="flex min-w-[216px] flex-1 basis-0 flex-col" aria-label={`${s.name} stage`}>
                  <header className="mb-3 flex h-9 shrink-0 items-baseline gap-2 border-b border-crm-sand-150 pr-1 pl-1.5">
                    {/* Icon is inline (vertical-align) so the h3 keeps a text baseline and the count/sum line up across columns. */}
                    <h3 className="whitespace-nowrap text-[13px] leading-5 font-semibold text-crm-sand-900">{isClearanceStage(s) && <ShieldCheck size={14} className="mr-1.5 inline-block align-[-2px] text-crm-sand-500" strokeWidth={1.75} aria-hidden />}{s.name}</h3>
                    <span className="mono text-crm-sand-500">{items.length}</span>
                    <span className="ml-auto text-[12px] leading-4 font-medium text-crm-sand-600 num">{money(sum)}</span>
                    <span className="mono text-[11px] text-crm-sand-500">{s.probability}%</span>
                  </header>
                  <div onDragOver={(e) => onDragOver(s, e)} onDragLeave={() => setDragOver(null)} onDrop={(e) => onDrop(s, e)}
                       className={cn("flex min-h-[120px] flex-1 flex-col gap-2 rounded-crm-lg p-0.5 transition-colors duration-[120ms]", over && "bg-crm-accent-50 shadow-[inset_0_0_0_1px_var(--firmcrm-color-accent-300)]")}>
                    {items.map((o) => <KanbanCard key={o.id} o={o} onOpen={(x) => nav(`/opportunities/${x.id}`)} />)}
                    {items.length === 0 && <div className="grid h-[72px] place-items-center rounded-crm-lg border border-dashed border-crm-sand-200 text-[12px] text-crm-sand-500">{over ? "Release to move here" : "No opportunities"}</div>}
                  </div>
                </section>);
            })}
          </div>
          {status === "open" && <DropStrip stages={pipeline.stages} dragOver={dragOver} onDragOver={onDragOver} onDragLeave={() => setDragOver(null)} onDrop={onDrop} />}
        </>)}
      {creating && <NewOpportunityModal onClose={() => setCreating(false)} />}
      {losing && <CloseLostModal opp={losing.opp} stageId={losing.stage.id} onClose={() => setLosing(null)} />}
      <div className="mt-3 text-[11px] leading-[14px] text-crm-sand-500">{titleCase(status)} view · drag cards between stages. Closed Won requires a cleared clearance check (where applicable) and a signed engagement letter.</div>
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex gap-4" aria-busy="true" aria-label="Loading board">
      {Array.from({ length: 5 }).map((_, c) => (
        <div key={c} className="flex min-w-[216px] flex-1 basis-0 flex-col">
          <div className="mb-3 flex h-9 items-center border-b border-crm-sand-150 px-1.5"><span className="skeleton w-2/5" /></div>
          <div className="flex flex-col gap-2 p-0.5">
            {Array.from({ length: 2 + (c % 2) }).map((_, i) => (
              <div key={i} className="space-y-2.5 rounded-crm-lg border border-crm-sand-150 bg-crm-sand-0 p-3"><span className="skeleton w-4/5" /><span className="skeleton w-2/5" /><span className="skeleton w-3/5" /></div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
