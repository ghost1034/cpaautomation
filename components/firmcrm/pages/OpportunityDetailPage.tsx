import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@/components/firmcrm/lib/query";
import { Link, useNavigate, useParams } from "@/components/firmcrm/lib/navigation";
import { Archive, ArchiveRestore, Check, ChevronDown, Lock, Pencil, RotateCcw, ShieldCheck, ShieldOff, Trash2 } from "lucide-react";
import type { TimelineEvent } from "@/components/firmcrm/components/crm/ActivityTimeline";
import { conflictsApi, oppsApi } from "@/components/firmcrm/api";
import type { Opportunity, Stage } from "@/components/firmcrm/api/types";
import { Badge, Button, Card, DL, Drawer, Field, Input, OverflowMenu, PageHeader, Select, Spinner, Textarea, cn, statusTone, type MenuItem } from "@/components/firmcrm/components/ui";
import { FormModal, type FormValues } from "@/components/firmcrm/components/ui/Form";
import { useToast } from "@/components/firmcrm/components/ui/Toast";
import { useConfirm } from "@/components/firmcrm/components/ui/Confirm";
import { ActivityTimeline } from "@/components/firmcrm/components/crm/ActivityTimeline";
import { WallPanel, useWall } from "@/components/firmcrm/components/crm/WallPanel";
import { StageRail } from "@/components/firmcrm/components/crm/StageRail";
import { isPastDue } from "@/components/firmcrm/components/crm/KanbanCard";
import { ClearanceList } from "./ClearancePage";
import { useOpportunityFields } from "./OpportunitiesPage";
import { usePipelines, strOpts } from "@/components/firmcrm/lib/hooks";
import { EL_STATUSES, INDEPENDENCE_QUESTIONS, LOST_REASONS } from "@/components/firmcrm/lib/options";
import { fmtDate, fmtDateTime, plural, useMoney, titleCase } from "@/components/firmcrm/lib/format";
import { useAuth } from "@/components/firmcrm/lib/auth";

export function CloseLostModal({ opp, stageId, onClose }: { opp: Opportunity; stageId: number; onClose: () => void }) {
  const qc = useQueryClient(); const { toast, error } = useToast();
  const [reason, setReason] = useState("price"); const [competitor, setCompetitor] = useState(opp.competitor ?? ""); const [note, setNote] = useState("");
  const m = useMutation({ mutationFn: () => oppsApi.stage(opp.id, { stage_id: stageId, lost_reason: reason, competitor: competitor || undefined, note: note || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["opps"] }); qc.invalidateQueries({ queryKey: ["opp", opp.id] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); toast("Marked lost"); onClose(); }, onError: error });
  return (
    <Drawer open onClose={onClose} title="Mark lost" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="danger-solid" onClick={() => m.mutate()} disabled={m.isPending}>Mark lost</Button></>}>
      <div className="space-y-4">
        <p className="text-[13px] leading-5 text-crm-sand-600"><span className="font-medium text-crm-sand-900">{opp.name}</span> will be closed as lost. The reason is recorded in the stage history and win/loss reporting.</p>
        <Field label="Lost reason *"><Select value={reason} onChange={(e) => setReason(e.target.value)} options={strOpts(LOST_REASONS)} /></Field>
        <Field label="Competitor (if any)"><Input value={competitor} onChange={(e) => setCompetitor(e.target.value)} /></Field>
        <Field label="Notes"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Drawer>
  );
}

function RunCheckModal({ opp, onClose }: { opp: Opportunity; onClose: () => void }) {
  const qc = useQueryClient(); const { toast, error } = useToast();
  const type = opp.clearance_type ?? "conflict";
  const [parties, setParties] = useState([opp.account_name ?? "", ...(opp.adverse_parties ?? [])].filter(Boolean).join("\n"));
  const [att, setAtt] = useState<Record<string, boolean>>(Object.fromEntries(INDEPENDENCE_QUESTIONS.map((q) => [q.key, false])));
  const m = useMutation({ mutationFn: () => conflictsApi.run({ check_type: type, opportunity_id: opp.id, parties: parties.split("\n").map((s) => s.trim()).filter(Boolean), independence_attestation: type === "independence" ? att : null }),
    onSuccess: (c) => { qc.invalidateQueries({ queryKey: ["checks"] }); qc.invalidateQueries({ queryKey: ["opp", opp.id] }); qc.invalidateQueries({ queryKey: ["opps"] }); toast(c.status === "clear" ? "No matches — auto-cleared" : `${c.matches.length} potential match(es) — pending review`); onClose(); }, onError: error });
  return (
    <Drawer open onClose={onClose} title={`Run ${type} check`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => m.mutate()} disabled={m.isPending}>Run check</Button></>}>
      <div className="space-y-4">
        <Field label="Parties to search (one per line)" hint="Client, affiliates, principals, and adverse parties. Matched against conflict companies, accounts, aliases, contacts, and recorded adverse parties."><Textarea value={parties} onChange={(e) => setParties(e.target.value)} className="min-h-[110px] font-mono text-[12px]" /></Field>
        <p className="text-[12px] leading-4 text-crm-sand-600">Maintain the screening list in <Link to="/clearance">Clearance → Conflict companies</Link>.</p>
        {type === "independence" && (
          <div>
            <div className="label">Independence attestation (engagement team)</div>
            <div className="space-y-2 rounded-crm-md border border-crm-sand-150 p-3">{INDEPENDENCE_QUESTIONS.map((q) => <label key={q.key} className="flex items-start gap-2.5 text-[13px] leading-5 text-crm-sand-900"><input type="checkbox" className="mt-[3px] shrink-0" checked={att[q.key]} onChange={(e) => setAtt({ ...att, [q.key]: e.target.checked })} />{q.label}</label>)}</div>
            <div className="mt-1.5 text-[12px] leading-4 text-crm-sand-500">Any “yes” routes the check to partner review.</div>
          </div>)}
      </div>
    </Drawer>
  );
}

/* ---------------------------------------------------------------- Key facts */
function Fact({ label, children, sub, className }: { label: string; children: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 border-r border-crm-sand-100 px-5 py-3.5 last:border-r-0", className)}>
      <div className="text-[12px] leading-4 font-medium text-crm-sand-600">{label}</div>
      <div className="mt-1 min-w-0">{children}</div>
      {sub && <div className="mt-0.5 text-[12px] leading-4 text-crm-sand-500">{sub}</div>}
    </div>
  );
}
const inlineCtl = "h-8 rounded-crm-md border border-transparent bg-transparent text-crm-sand-900 transition-[border-color,box-shadow] duration-[120ms] hover:border-crm-sand-200 focus:border-crm-accent-600 focus:shadow-[0_0_0_3px_var(--firmcrm-color-accent-100)] focus:outline-none disabled:cursor-default disabled:hover:border-transparent";

export default function OpportunityDetailPage() {
  const money = useMoney();
  const id = Number(useParams().id);
  const qc = useQueryClient(); const nav = useNavigate(); const { toast, error } = useToast(); const { atLeast, hasRole } = useAuth();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false); const [losing, setLosing] = useState<number | null>(null); const [checking, setChecking] = useState(false);
  const opp = useQuery({ queryKey: ["opp", id], queryFn: () => oppsApi.get(id) });
  // Dependent queries wait for the record so a 404 (deleted or walled) does not fan out into three more 404s.
  const hist = useQuery({ queryKey: ["opp", id, "history"], queryFn: () => oppsApi.history(id), enabled: !!opp.data });
  const checks = useQuery({ queryKey: ["checks", { opportunity_id: id }], queryFn: () => conflictsApi.list({ opportunity_id: id, limit: 100 }), select: (p) => p.items, enabled: !!opp.data });
  const pipelines = usePipelines();
  const fields = useOpportunityFields(opp.data?.account_id);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["opp", id] }); qc.invalidateQueries({ queryKey: ["opps"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); qc.invalidateQueries({ queryKey: ["account"] }); };
  const move = useMutation({ mutationFn: (stage_id: number) => oppsApi.stage(id, { stage_id }), onSuccess: (o) => { refresh(); toast(o.status === "won" ? "Closed won — engagement created" : `Moved to ${o.stage_name}`); }, onError: error });
  const reopen = useMutation({ mutationFn: (stage_id: number) => oppsApi.reopen(id, stage_id), onSuccess: () => { refresh(); toast("Reopened"); }, onError: error });
  const remove = useMutation({ mutationFn: () => oppsApi.purge(id), onSuccess: () => { refresh(); nav("/opportunities"); }, onError: error });
  const archiveM = useMutation({ mutationFn: () => (opp.data!.is_archived ? oppsApi.restore(id) : oppsApi.archive(id)), onSuccess: (o) => { refresh(); toast(o.is_archived ? "Archived" : "Restored"); }, onError: error });
  const quick = useMutation({ mutationFn: (b: Partial<Opportunity>) => oppsApi.update(id, b), onSuccess: refresh, onError: error });
  const wall = useWall("opportunity", id, !!opp.data);
  if (opp.isError) return <div className="card max-w-[560px] p-6 text-[13px] leading-5"><div className="font-semibold text-crm-sand-900">Opportunity not found</div><div className="mt-1 text-crm-sand-500">It may have been removed, or access is restricted by an ethical wall.</div><Link to="/opportunities" className="mt-3 inline-block text-[12px] font-medium">← Back to opportunities</Link></div>;
  if (opp.isLoading || !opp.data) return <DetailSkeleton />;
  const o = opp.data;
  const stages = pipelines.data?.find((p) => p.id === o.pipeline_id)?.stages ?? [];
  const openStages = stages.filter((s) => !s.is_won && !s.is_lost);
  const won = stages.find((s) => s.is_won); const lost = stages.find((s) => s.is_lost);
  const gateOk = !o.clearance_type || o.clearance_status === "clear" || o.clearance_status === "waived";
  const elOk = o.engagement_letter_status === "signed";
  const isOpen = o.status === "open";
  const clearanceLabel = o.clearance_type === "independence" ? "Independence" : "Conflict";
  const stageGate = (s: Stage) => (!gateOk && /clearance|conflict|independence/i.test(s.name) ? `${clearanceLabel} check ${o.clearance_status ?? "not run"} — must be cleared or waived before Closed Won` : null);
  const terminalGate = !isOpen ? null : !gateOk ? `${clearanceLabel} check required` : !elOk ? "Engagement letter must be signed" : null;
  const dot = <span className="mx-1.5 text-crm-sand-300">·</span>;
  const pastDue = isPastDue(o);
  // §6.3: destructive / secondary record actions live in the ⋯ menu; Edit · Mark lost · Closed won stay inline.
  const menuItems: MenuItem[] = [
    ...(atLeast("manager") && !isOpen ? [{
      label: o.is_archived ? "Restore" : "Archive", icon: o.is_archived ? <ArchiveRestore /> : <Archive />,
      onSelect: async () => {
        if (o.is_archived) { archiveM.mutate(); return; }
        if (await confirm({ title: "Archive this opportunity?", body: "It leaves boards and lists but stays on the account record and in reporting.", confirmLabel: "Archive", tone: "primary" })) archiveM.mutate();
      },
    }] : []),
    ...(hasRole("admin") && o.status !== "won" ? [{
      label: "Delete permanently", icon: <Trash2 />, tone: "danger" as const,
      onSelect: async () => { if (await confirm({ title: "Delete this opportunity permanently?", body: "Prefer Archive. Activities, checks, and stage history are removed and cannot be recovered.", confirmLabel: "Delete" })) remove.mutate(); },
    }] : []),
  ];
  // §6.14: stage changes and clearance checks join the activity feed by timestamp.
  const timelineEvents: TimelineEvent[] = [
    ...(hist.data ?? []).map((h) => ({
      id: `h${h.id}`, at: h.changed_at, kind: "stage" as const,
      title: <><span className="font-medium">{h.changed_by_name ?? "System"}</span> <span className="text-crm-sand-500">{h.from_stage_name ? "moved to" : "created in"}</span> {h.to_stage_name}</>,
      body: h.from_stage_name ? <>from {h.from_stage_name}{h.days_in_previous != null && <> · <span className="num">{h.days_in_previous.toFixed(0)}d</span> in stage</>}</> : undefined,
    })),
    ...(checks.data ?? []).flatMap((c) => [
      { id: `c${c.id}`, at: c.created_at, kind: "clearance" as const,
        title: <><span className="font-medium">{c.requested_by_name ?? "Someone"}</span> <span className="text-crm-sand-500">ran {c.check_type === "independence" ? "an independence" : "a conflict"} check</span> <span className="mono text-crm-sand-500">#{c.id}</span></>,
        body: c.matches.length ? `${c.matches.length} potential match${c.matches.length === 1 ? "" : "es"} — pending review` : "No matches — auto-cleared" },
      ...(c.resolved_at && c.status !== "pending" ? [{ id: `r${c.id}`, at: c.resolved_at, kind: "clearance" as const,
        title: <><span className="font-medium">{c.resolved_by_name ?? "Someone"}</span> <span className="text-crm-sand-500">resolved check</span> <span className="mono text-crm-sand-500">#{c.id}</span> <span className="text-crm-sand-300">·</span> {titleCase(c.status)}</>,
        body: c.resolution_note ?? undefined }] : []),
    ]),
  ];
  return (
    <div className="max-w-[1344px]">
      <PageHeader
        title={<>
          <span className="min-w-0 truncate">{o.name}</span>
          <Badge tone={statusTone(isOpen ? "open" : o.status)}>{isOpen ? o.stage_name : titleCase(o.status)}</Badge>
          {o.is_stale && <Badge tone="warn">Stale</Badge>}
          {o.is_archived && <Badge tone="danger">Archived</Badge>}
          {wall.data && <Badge tone="danger"><Lock size={11} />Restricted</Badge>}
        </>}
        subtitle={<><Link to={`/accounts/${o.account_id}`}>{o.account_name}</Link>{dot}{o.practice_area_name ?? "No practice area"}{dot}Owner {o.owner_name ?? "—"}{dot}Created <span className="num">{fmtDate(o.created_at)}</span>{o.is_recurring && <>{dot}Recurring engagement</>}</>}
        actions={<>
          <Button onClick={() => setEditing(true)}><Pencil size={14} />Edit</Button>
          {isOpen && lost && <Button variant="danger" onClick={() => setLosing(lost.id)}>Mark lost</Button>}
          {!isOpen && atLeast("manager") && openStages.length > 0 && <Button variant="primary" onClick={() => reopen.mutate(openStages[Math.min(openStages.length - 1, 3)].id)}><RotateCcw size={14} />Reopen</Button>}
          {isOpen && won && <Button variant="primary" disabled={!gateOk || !elOk} title={terminalGate ?? undefined} onClick={() => move.mutate(won.id)} data-tour="closed-won"><Check size={14} />Closed won</Button>}
          {menuItems.length > 0 && <OverflowMenu size="md" items={menuItems} />}
        </>} />

      <div data-tour="stage-rail"><StageRail className="mb-4" stages={openStages} currentStageId={o.stage_id} status={o.status} lostReason={o.lost_reason} daysInStage={o.days_in_stage}
                 gate={stageGate} terminalGate={terminalGate} canMove={isOpen} onMove={(sid) => move.mutate(sid)} /></div>

      {/* Key facts (§6.4) */}
      <div className="card mb-4 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 overflow-hidden">
        <Fact label="Amount" sub={<>{titleCase(o.fee_type)}{o.is_recurring && o.fee_type !== "recurring" ? " · recurring" : ""}</>}>
          <div className="text-[24px] leading-7 font-semibold tracking-[-0.02em] text-crm-sand-900 num">{money(o.amount)}</div>
        </Fact>
        <Fact label="Probability" sub={<>→ <span className="num">{money(o.weighted_amount)}</span> weighted</>}>
          <div className="-ml-1.5 flex items-center">
            <input type="number" min={0} max={100} step={5} key={o.probability} defaultValue={o.probability} disabled={!isOpen} aria-label="Probability (%)"
                   onBlur={(e) => { const v = Math.max(0, Math.min(100, Number(e.target.value))); if (v !== o.probability) quick.mutate({ probability: v }); }}
                   onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                   className={cn(inlineCtl, "w-[72px] px-1.5 text-right text-[24px] leading-7 font-semibold tracking-[-0.02em] num [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none")} />
            <span className="text-[18px] leading-6 font-semibold text-crm-sand-500">%</span>
          </div>
        </Fact>
        <Fact label="Expected close" sub={<span className="num">{plural(o.days_in_stage, "day")} in stage</span>}>
          <div className={cn("text-[20px] leading-7 font-semibold tracking-[-0.015em] num", pastDue ? "text-crm-danger-600" : "text-crm-sand-900")} title={pastDue ? "Expected close date has passed" : undefined}>{fmtDate(o.expected_close)}</div>
        </Fact>
        <Fact label="Engagement letter" sub={elOk ? "Gate satisfied" : isOpen ? "Required before Closed Won" : undefined}>
          <div className="relative -ml-1.5 inline-flex items-center">
            <select value={o.engagement_letter_status} disabled={!isOpen} onChange={(e) => quick.mutate({ engagement_letter_status: e.target.value as Opportunity["engagement_letter_status"] })} aria-label="Engagement letter status"
                    className={cn(inlineCtl, "appearance-none pr-7 pl-1.5 text-[20px] leading-7 font-semibold tracking-[-0.015em]", isOpen && "cursor-pointer")}>
              {EL_STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
            </select>
            {isOpen && <ChevronDown size={14} className="pointer-events-none absolute right-2 text-crm-sand-500" />}
          </div>
        </Fact>
        <Fact label="Owner">
          <div className="truncate text-[20px] leading-7 font-semibold tracking-[-0.015em] text-crm-sand-900" title={o.owner_name ?? undefined}>{o.owner_name ?? <span className="text-crm-sand-300">—</span>}</div>
        </Fact>
        <Fact label="Originating partner">
          <div className="truncate text-[20px] leading-7 font-semibold tracking-[-0.015em] text-crm-sand-900" title={o.originating_partner_name ?? undefined}>{o.originating_partner_name ?? <span className="text-crm-sand-300">—</span>}</div>
        </Fact>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-8 space-y-4">
          <Card title="Details"><DL columns={3} items={[
            { label: "Primary contact", value: o.primary_contact_id ? <Link to={`/contacts/${o.primary_contact_id}`}>{o.primary_contact_name}</Link> : null },
            { label: "Next step", value: o.next_step }, { label: "Proposal due", value: o.proposal_due ? <span className="num">{fmtDate(o.proposal_due)}</span> : null },
            { label: "Competitor", value: o.competitor }, { label: "Last activity", value: o.last_activity_at ? <span className="num">{fmtDateTime(o.last_activity_at)}</span> : null },
            ...(!isOpen ? [{ label: "Closed", value: <span className="num">{fmtDateTime(o.closed_at)}</span> }] : []),
            { label: "Adverse / related parties", value: o.adverse_parties?.length ? <span className="flex flex-wrap gap-1.5">{o.adverse_parties.map((p) => <Badge key={p} tone="danger">{p}</Badge>)}</span> : null, span: 3 },
            { label: "Description", value: o.description ? <span className="whitespace-pre-wrap">{o.description}</span> : null, span: 3 },
          ]} /></Card>
          <Card title="Activity">
            {hist.isLoading || checks.isLoading ? <Spinner /> : <ActivityTimeline filter={{ opportunity_id: id }} extraEvents={timelineEvents} />}
          </Card>
        </div>
        <div className="lg:col-span-4 space-y-4">
          <Card tourId="clearance-card" title={<span className="inline-flex items-center gap-1.5"><ShieldCheck size={14} className="text-crm-sand-500" />{clearanceLabel} clearance</span>}
                actions={isOpen && <Button size="sm" onClick={() => setChecking(true)}>Run check</Button>}>
            {!o.clearance_type ? <div className="mb-3 text-[12px] leading-4 text-crm-sand-500">This practice area has no mandatory clearance gate. You may still run an ad-hoc conflict check.</div> : (
              <div className="mb-3 flex items-start gap-2 text-[13px] leading-5">
                <Badge dot tone={gateOk ? "success" : o.clearance_status === "conflict" ? "danger" : "warn"} className="mt-0.5 shrink-0">{titleCase(o.clearance_status ?? "not run")}</Badge>
                {o.clearance_status === "waived" && <ShieldOff size={12} className="mt-1 shrink-0 text-crm-success-600" aria-label="Waived" />}
                <span className="text-crm-sand-600">{gateOk ? "Gate satisfied." : o.clearance_status ? "Closed Won is blocked until cleared or waived." : "No check run yet. Required before Closed Won."}</span>
              </div>)}
            <ClearanceList checks={checks.data} loading={checks.isLoading} compact />
          </Card>
          <WallPanel entityType="opportunity" id={id} entityName={o.name} />
        </div>
      </div>
      <FormModal open={editing} onClose={() => setEditing(false)} title="Edit opportunity" fields={fields} initial={o as unknown as FormValues}
        onSubmit={async (v) => { const body: Record<string, unknown> = {}; for (const f of fields) if (f.name !== "account_id") body[f.name] = v[f.name] ?? null; await oppsApi.update(id, body as Partial<Opportunity>); refresh(); toast("Saved"); }} />
      {losing && <CloseLostModal opp={o} stageId={losing} onClose={() => setLosing(null)} />}
      {checking && <RunCheckModal opp={o} onClose={() => setChecking(false)} />}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="max-w-[1344px]" aria-busy="true" aria-label="Loading opportunity">
      <div className="mb-6 space-y-2"><span className="skeleton h-5 w-[320px]" /><span className="skeleton w-[240px]" /></div>
      <div className="card mb-4 h-[88px]" />
      <div className="card mb-4 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="space-y-2.5 border-r border-crm-sand-100 px-5 py-3.5 last:border-r-0"><span className="skeleton w-2/5" /><span className="skeleton h-4 w-4/5" /></div>)}</div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4"><div className="lg:col-span-8 card h-[240px]"><Spinner /></div><div className="lg:col-span-4 card h-[160px]"><Spinner /></div></div>
    </div>
  );
}
