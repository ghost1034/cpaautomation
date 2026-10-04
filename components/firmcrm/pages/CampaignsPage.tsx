import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@/components/firmcrm/lib/query";
import { Plus, X } from "lucide-react";
import { campaignsApi, contactsApi } from "@/components/firmcrm/api";
import type { Campaign } from "@/components/firmcrm/api/types";
import { Badge, Button, Card, DL, Empty, PageHeader, Select, Spinner, statusTone } from "@/components/firmcrm/components/ui";
import { DataTable, useServerSort, type Column } from "@/components/firmcrm/components/ui/DataTable";
import { FormModal, type FieldDef, type FormValues } from "@/components/firmcrm/components/ui/Form";
import { useToast } from "@/components/firmcrm/components/ui/Toast";
import { usePracticeAreas, useUsers, opt, strOpts } from "@/components/firmcrm/lib/hooks";
import { CAMPAIGN_KINDS, CAMPAIGN_STATUSES, MEMBER_STATUSES } from "@/components/firmcrm/lib/options";
import { fmtDate, useMoney, plural, pct, titleCase } from "@/components/firmcrm/lib/format";
import { useAuth } from "@/components/firmcrm/lib/auth";
import { ArchivedChip, Dash, FilterToggle, NameCell, ResultCount, SearchInput, cellCount, cellMoney } from "@/components/firmcrm/components/ui/cells";

const Money = ({ n }: { n: number | null | undefined }) => {
  const money = useMoney();
  return n ? <span className="num font-medium">{money(n)}</span> : <Dash />;
};

export default function CampaignsPage() {
  const qc = useQueryClient(); const { toast, error } = useToast();
  const [creating, setCreating] = useState(false); const [selected, setSelected] = useState<Campaign | null>(null); const [editing, setEditing] = useState(false);
  const [addQ, setAddQ] = useState("");
  const [archived, setArchived] = useState(false);
  // Server-side ordering (flows QA #10); the attribution metrics are computed per row and have no API sort field.
  const sorting = useServerSort({ key: "name", dir: "asc" }, { name: "name", status: "status", cost: "actual_cost" });
  const camps = useQuery({ queryKey: ["campaigns", archived, sorting.params], queryFn: () => campaignsApi.list({ include_archived: archived, ...sorting.params, limit: 500 }), select: (p) => p.items });
  const { atLeast } = useAuth();
  const archiveM = useMutation({ mutationFn: (c: Campaign) => (c.is_archived ? campaignsApi.restore(c.id) : campaignsApi.archive(c.id)), onSuccess: (c) => { inv(); setSelected(c); toast(c.is_archived ? "Campaign archived" : "Campaign restored"); }, onError: error });
  const users = useUsers(); const pas = usePracticeAreas(true); // picker: active practice areas only (flows QA #9)
  const members = useQuery({ queryKey: ["campaign-members", selected?.id], queryFn: () => campaignsApi.members(selected!.id), enabled: !!selected });
  const candidates = useQuery({ queryKey: ["contacts", "pick", addQ], queryFn: () => contactsApi.list({ q: addQ, limit: 8 }), enabled: addQ.length >= 2, select: (p) => p.items });
  const fields: FieldDef[] = useMemo(() => [
    { name: "name", label: "Campaign name", required: true, span: 2 },
    { name: "kind", label: "Type", type: "select", options: strOpts(CAMPAIGN_KINDS) }, { name: "status", label: "Status", type: "select", options: strOpts(CAMPAIGN_STATUSES) },
    { name: "start_date", label: "Start", type: "date" }, { name: "end_date", label: "End", type: "date" },
    { name: "budget", label: "Budget", type: "money", min: 0 }, { name: "actual_cost", label: "Actual cost", type: "money", min: 0 },
    { name: "owner_id", label: "Owner", type: "select", options: opt(users.data, (u) => u.full_name) }, { name: "practice_area_id", label: "Practice area", type: "select", options: opt(pas.data, (p) => p.name) },
    { name: "description", label: "Description", type: "textarea" },
  ], [users.data, pas.data]);
  const inv = () => { qc.invalidateQueries({ queryKey: ["campaigns"] }); qc.invalidateQueries({ queryKey: ["campaign-members"] }); };
  // Member changes confirm with a short success toast (QA #29).
  const add = useMutation({ mutationFn: (c: { id: number; full_name: string }) => campaignsApi.addMember(selected!.id, c.id), onSuccess: (_, c) => { inv(); setAddQ(""); toast(`${c.full_name} added`); }, onError: error });
  const upd = useMutation({ mutationFn: ({ mid, cid, s }: { mid: number; cid: number; s: string }) => campaignsApi.updateMember(selected!.id, mid, cid, s), onSuccess: (_, v) => { inv(); toast(`Marked ${titleCase(v.s).toLowerCase()}`); }, onError: error });
  const rm = useMutation({ mutationFn: (m: { id: number; contact_name: string }) => campaignsApi.removeMember(selected!.id, m.id), onSuccess: (_, m) => { inv(); toast(`${m.contact_name} removed`); }, onError: error });
  const cols: Column<Campaign>[] = [
    { key: "name", header: "Campaign", sort: (c) => c.name, render: (c) => <NameCell name={c.name} max={selected ? 240 : 320} sub={`${titleCase(c.kind)} · ${fmtDate(c.start_date)}`} chips={c.is_archived && <ArchivedChip />} /> },
    { key: "status", header: "Status", sort: (c) => c.status, width: "120px", render: (c) => <Badge dot tone={statusTone(c.status)}>{titleCase(c.status)}</Badge> },
    { key: "members", header: "Members", align: "right", width: "96px", hideBelow: selected ? 1280 : undefined, render: (c) => cellCount(c.member_count) },
    { key: "attended", header: "Attended", align: "right", width: "96px", hideBelow: 1280, render: (c) => cellCount(c.attended_count) },
    { key: "leads", header: "Leads", align: "right", width: "80px", hideBelow: 1180, render: (c) => cellCount(c.leads_generated) },
    { key: "pipe", header: "Influenced pipeline", align: "right", width: "144px", render: (c) => cellMoney(c.influenced_pipeline) },
    { key: "won", header: "Won", align: "right", width: "128px", render: (c) => cellMoney(c.won_amount) },
    { key: "cost", header: "Cost", align: "right", width: "112px", hideBelow: 1280, sort: (c) => c.actual_cost, render: (c) => cellMoney(c.actual_cost) },
    { key: "roi", header: "ROI", align: "right", width: "80px", render: (c) => c.actual_cost ? <span className="font-normal">{(c.won_amount / c.actual_cost).toFixed(1)}x</span> : <Dash /> },
  ];
  const sel = camps.data?.find((c) => c.id === selected?.id) ?? selected;
  // With the side panel open the table has ~3/5 of the width; secondary metrics move into the panel's facts grid.
  const visibleCols = sel ? cols.filter((c) => !["attended", "leads", "cost", "roi", "won"].includes(c.key)) : cols;
  return (
    <div>
      <PageHeader title="Campaigns" subtitle="Events, webinars, and newsletters, with attribution to leads, pipeline, and won work" actions={<Button variant="primary" onClick={() => setCreating(true)}><Plus size={14} />New campaign</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <FilterToggle checked={archived} onChange={setArchived}>Show archived</FilterToggle>
        <ResultCount>{plural(camps.data?.length ?? 0, "campaign")}</ResultCount>
      </div>
      <div className={sel ? "grid grid-cols-1 xl:grid-cols-5 gap-4" : ""}>
        <div className={sel ? "xl:col-span-3 card overflow-hidden self-start" : "card overflow-hidden"}><DataTable rows={camps.data} columns={visibleCols} loading={camps.isLoading} twoLine onRowClick={setSelected} sort={sorting.sort} onSortChange={sorting.onSortChange} empty="No campaigns yet" /></div>
        {sel && (
          <div className="xl:col-span-2 space-y-4">
            <Card title={<span className="flex items-center gap-2"><span className="block max-w-[300px] truncate" title={sel.name}>{sel.name}</span>{sel.is_archived && <ArchivedChip />}</span>}
                  actions={<><Button size="sm" onClick={() => setEditing(true)}>Edit</Button>{atLeast("manager") && <Button size="sm" variant="ghost" onClick={() => archiveM.mutate(sel)}>{sel.is_archived ? "Restore" : "Archive"}</Button>}<Button size="sm" variant="ghost" onClick={() => setSelected(null)} aria-label="Close panel"><X size={14} /></Button></>}>
              <DL columns={2} items={[
                { label: "Status", value: <Badge dot tone={statusTone(sel.status)}>{titleCase(sel.status)}</Badge> }, { label: "Type", value: titleCase(sel.kind) }, { label: "Dates", value: <span className="num">{fmtDate(sel.start_date)} – {fmtDate(sel.end_date)}</span> },
                { label: "Budget", value: <Money n={sel.budget} /> }, { label: "Actual cost", value: <Money n={sel.actual_cost} /> },
                { label: "Attendance rate", value: <span className="num">{pct(sel.member_count ? sel.attended_count / sel.member_count : null)}</span> }, { label: "Leads generated", value: <span className="num">{sel.leads_generated}</span> },
                { label: "Influenced pipeline", value: <Money n={sel.influenced_pipeline} /> }, { label: "Won", value: <Money n={sel.won_amount} /> },
                { label: "Description", value: sel.description }]} />
            </Card>
            <Card title={<>Members<span className="mono ml-1.5 text-[11px] text-crm-sand-500">{members.data?.length ?? 0}</span></>} padded={false}>
              <div className="relative border-b border-crm-sand-150 p-3">
                <SearchInput className="w-full" value={addQ} onChange={(e) => setAddQ(e.target.value)} placeholder="Add contact by name or email…" />
                {addQ.length >= 2 && candidates.data && (
                  <div className="absolute top-full right-3 left-3 z-crm-dropdown mt-1.5 overflow-hidden rounded-crm-lg border border-crm-sand-150 bg-crm-sand-0 shadow-crm-menu">
                    {candidates.data.map((c) => <button key={c.id} type="button" disabled={add.isPending} onClick={() => add.mutate({ id: c.id, full_name: c.full_name })} className="flex h-9 w-full items-center justify-between px-3 text-left text-[13px] hover:bg-crm-sand-50 disabled:opacity-50"><span className="truncate">{c.full_name}</span><span className="ml-3 truncate text-[12px] text-crm-sand-500">{c.account_name}</span></button>)}
                    {!candidates.data.length && <div className="px-3 py-2 text-[12px] text-crm-sand-500">No contacts match</div>}
                  </div>)}
              </div>
              {members.isLoading ? <Spinner /> : !members.data?.length ? <Empty title="No members yet" hint="Add contacts by name or email above." /> : (
                <table className="tbl"><tbody>{members.data.map((m) => (
                  <tr key={m.id} className="row-2line">
                    <td><NameCell name={m.contact_name} sub={m.account_name} /></td>
                    {/* Standard 32px / 13px field (§6.10; QA #29). */}
                    <td className="w-[156px]"><Select value={m.status} options={strOpts(MEMBER_STATUSES)} onChange={(e) => upd.mutate({ mid: m.id, cid: m.contact_id, s: e.target.value })} className="!h-8 text-[13px]" aria-label="Member status" /></td>
                    <td className="w-[48px] !pl-0 text-right"><Button size="sm" variant="ghost" onClick={() => rm.mutate({ id: m.id, contact_name: m.contact_name ?? "Member" })} aria-label="Remove member" className="!px-1.5"><X size={14} /></Button></td>
                  </tr>))}</tbody></table>)}
            </Card>
          </div>)}
      </div>
      <FormModal open={creating} onClose={() => setCreating(false)} title="New campaign" fields={fields} initial={{ kind: "event", status: "planned", budget: 0, actual_cost: 0 }} submitLabel="Create"
        onSubmit={async (v) => { await campaignsApi.create(v as Partial<Campaign>); inv(); toast("Campaign created"); }} />
      {editing && sel && <FormModal open onClose={() => setEditing(false)} title="Edit campaign" fields={fields} initial={sel as unknown as FormValues}
        onSubmit={async (v) => { const body: Record<string, unknown> = {}; for (const f of fields) body[f.name] = v[f.name] ?? null; await campaignsApi.update(sel.id, body as Partial<Campaign>); inv(); toast("Saved"); }} />}
    </div>
  );
}
