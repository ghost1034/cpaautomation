import { useState } from "react";
import { useQuery, useQueryClient } from "@/components/firmcrm/lib/query";
import { Link, useNavigate } from "@/components/firmcrm/lib/navigation";
import { dataApi, engagementsApi } from "@/components/firmcrm/api";
import { ArrowUpRight, Download, ReceiptText } from "lucide-react";
import { Pagination, usePager } from "@/components/firmcrm/components/ui/Pagination";
import type { Engagement } from "@/components/firmcrm/api/types";
import { Badge, Button, Empty, PageHeader, Select, statusTone } from "@/components/firmcrm/components/ui";
import { DataTable, useServerSort, type Column } from "@/components/firmcrm/components/ui/DataTable";
import { FormModal, type FieldDef, type FormValues } from "@/components/firmcrm/components/ui/Form";
import { useToast } from "@/components/firmcrm/components/ui/Toast";
import { useUsers, partnerOptions, strOpts } from "@/components/firmcrm/lib/hooks";
import { ENGAGEMENT_STATUSES, FEE_TYPES } from "@/components/firmcrm/lib/options";
import { plural, useMoney, titleCase } from "@/components/firmcrm/lib/format";
import { useAuth } from "@/components/firmcrm/lib/auth";
import { NameCell, ResultCount, cellDate, cellMoney, cellText } from "@/components/firmcrm/components/ui/cells";

export default function EngagementsPage() {
  const money = useMoney();
  const qc = useQueryClient(); const nav = useNavigate(); const { toast } = useToast(); const { atLeast } = useAuth();
  const [status, setStatus] = useState("active"); const [editing, setEditing] = useState<Engagement | null>(null);
  const pager = usePager(50); const { error } = useToast();
  // Server-side ordering so sort + paging agree (flows QA #10); practice area and partner have no API sort field.
  const sorting = useServerSort({ key: "start", dir: "desc" }, { name: "name", status: "status", val: "annual_value", start: "start_date" }, pager.reset);
  const engs = useQuery({ queryKey: ["engagements", status, sorting.params, pager.limit, pager.offset], queryFn: () => engagementsApi.list({ status: status || undefined, ...sorting.params, limit: pager.limit, offset: pager.offset }) });
  const users = useUsers();
  const fields: FieldDef[] = [
    { name: "name", label: "Engagement name", required: true, span: 2 }, { name: "external_ref", label: "Matter / PSA reference" },
    { name: "status", label: "Status", type: "select", options: strOpts(ENGAGEMENT_STATUSES) }, { name: "responsible_partner_id", label: "Responsible partner", type: "select", options: partnerOptions(users.data, editing?.responsible_partner_id) },
    { name: "fee_type", label: "Fee type", type: "select", options: strOpts(FEE_TYPES) }, { name: "annual_value", label: "Annual value", type: "money", min: 0 },
    { name: "start_date", label: "Start", type: "date" }, { name: "end_date", label: "End", type: "date" },
    // Adverse parties stay a comma-separated `tags` field; a chip TagInput is a kit follow-up (QA #20).
    { name: "adverse_parties", label: "Adverse parties", type: "tags", span: 2, hint: "Comma-separated. Feeds future conflict searches." },
  ];
  const cols: Column<Engagement>[] = [
    // Reference line carries the matter ref, the client link and the source-opportunity link so the table fits at 1440 with no extra columns.
    // Entity links are sand-700 (§6.3); accent is reserved for action/focus (QA #31).
    { key: "name", header: "Engagement · client", sort: (e) => e.name, render: (e) => <NameCell name={e.name} max={360} sub={<span className="inline-flex items-center gap-1.5">
        {e.external_ref && <span className="mono">{e.external_ref}</span>}
        <Link to={`/accounts/${e.account_id}`} onClick={(ev) => ev.stopPropagation()} className="truncate text-crm-sand-700 hover:text-crm-sand-900 hover:underline" title={e.account_name ?? undefined}>{e.account_name}</Link>
        {e.opportunity_id && <Link to={`/opportunities/${e.opportunity_id}`} onClick={(ev) => ev.stopPropagation()} className="inline-flex shrink-0 items-center gap-0.5 text-crm-sand-700 hover:text-crm-sand-900 hover:underline">Source opp<ArrowUpRight size={11} aria-hidden /></Link>}
      </span>} /> },
    { key: "pa", header: "Practice area", hideBelow: 1280, render: (e) => cellText(e.practice_area_name, 170) },
    { key: "partner", header: "Responsible partner", width: "150px", render: (e) => cellText(e.responsible_partner_name) },
    { key: "status", header: "Status", sort: (e) => e.status, width: "120px", render: (e) => <Badge dot tone={statusTone(e.status)}>{titleCase(e.status)}</Badge> },
    { key: "fee", header: "Fee type", width: "100px", hideBelow: 1280, render: (e) => cellText(titleCase(e.fee_type)) },
    { key: "val", header: "Annual value", align: "right", width: "128px", sort: (e) => e.annual_value, render: (e) => cellMoney(e.annual_value) },
    { key: "start", header: "Start", sort: (e) => e.start_date ?? "", width: "120px", hideBelow: 1180, render: (e) => cellDate(e.start_date) },
    { key: "actions", header: "", width: "96px", render: (e) => (
      <div className="flex justify-end" onClick={(ev) => ev.stopPropagation()} onKeyDown={(ev) => ev.stopPropagation()}>
        <Button size="sm" onClick={() => nav(`/billing/new?engagementId=${e.id}`)}><ReceiptText size={12} />Bill</Button>
      </div>) },
  ];
  const total = engs.data?.items.reduce((s, e) => s + e.annual_value, 0) ?? 0;
  const empty = <Empty title={status ? `No ${status.replace("_", " ")} engagements` : "No engagements yet"} hint="Engagements are created automatically when an opportunity is Closed Won."
                       action={status ? <Button size="sm" onClick={() => { setStatus(""); pager.reset(); }}>Show all statuses</Button> : undefined} />;
  return (
    <div>
      <PageHeader title="Engagements" subtitle="Won work, created automatically at Closed Won. Hand-off point to practice management / PSA." actions={atLeast("manager") && <Button onClick={() => dataApi.exportCsv("engagements").catch(error)}><Download size={14} />Export CSV</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select value={status} onChange={(e) => { setStatus(e.target.value); pager.reset(); }} options={strOpts(ENGAGEMENT_STATUSES)} placeholder="All statuses" className="!w-[180px]" aria-label="Engagement status" />
        <ResultCount>{plural(engs.data?.total ?? 0, "engagement")} · {money(total)} annual value on this page</ResultCount>
      </div>
      <div className="card overflow-hidden">
        <DataTable rows={engs.data?.items} columns={cols} loading={engs.isLoading} twoLine onRowClick={(e) => atLeast("manager") && setEditing(e)} sort={sorting.sort} onSortChange={sorting.onSortChange} empty={empty} />
        <Pagination total={engs.data?.total} limit={pager.limit} offset={pager.offset} onOffset={pager.setOffset} onLimit={pager.setLimit} />
      </div>
      {editing && <FormModal open onClose={() => setEditing(null)} title="Edit engagement" fields={fields} initial={editing as unknown as FormValues}
        onSubmit={async (v) => { const body: Record<string, unknown> = {}; for (const f of fields) body[f.name] = v[f.name] ?? null; await engagementsApi.update(editing.id, body as Partial<Engagement>); qc.invalidateQueries({ queryKey: ["engagements"] }); toast("Saved"); }} />}
    </div>
  );
}
