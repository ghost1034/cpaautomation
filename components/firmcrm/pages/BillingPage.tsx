import { useState } from "react";
import { Archive, Pencil, Plus } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@/components/firmcrm/lib/query";
import { useNavigate } from "@/components/firmcrm/lib/navigation";
import { billingApi } from "@/components/firmcrm/api";
import type { BillingProfile, Invoice } from "@/components/firmcrm/api/types";
import { Badge, Button, Card, DL, Empty, PageHeader, Select, Tabs } from "@/components/firmcrm/components/ui";
import { NameCell, ResultCount, SearchInput, cellDate } from "@/components/firmcrm/components/ui/cells";
import { DataTable, useServerSort, type Column } from "@/components/firmcrm/components/ui/DataTable";
import { Pagination, usePager } from "@/components/firmcrm/components/ui/Pagination";
import { useConfirm } from "@/components/firmcrm/components/ui/Confirm";
import { useToast } from "@/components/firmcrm/components/ui/Toast";
import { InvoiceStatusBadge } from "@/components/firmcrm/components/billing/InvoiceStatusBadge";
import { BillingProfileForm } from "@/components/firmcrm/components/billing/BillingProfileForm";
import { formatAmount } from "@/components/firmcrm/lib/billingMath";
import { plural } from "@/components/firmcrm/lib/format";
import { strOpts } from "@/components/firmcrm/lib/hooks";
import { INVOICE_STATUSES } from "@/components/firmcrm/lib/options";
import { useAuth } from "@/components/firmcrm/lib/auth";

type Tab = "invoices" | "profiles";

export const useBillingProfiles = () => useQuery({ queryKey: ["billing-profiles"], queryFn: () => billingApi.profiles(), staleTime: 60_000 });

export default function BillingPage() {
  const [tab, setTab] = useState<Tab>("invoices");
  const profiles = useBillingProfiles();
  const { atLeast } = useAuth();
  const nav = useNavigate();
  const canCreate = (profiles.data?.length ?? 0) > 0;
  return (
    <div>
      <PageHeader title="Billing" subtitle="Create invoices for accounts, download them as PDF and email them to customers."
        actions={tab === "invoices" && <Button variant="primary" disabled={!canCreate} title={canCreate ? undefined : "Create a billing profile first"} onClick={() => nav("/billing/new")}><Plus size={14} />New invoice</Button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "invoices", label: "Invoices" }, { key: "profiles", label: "Billing profiles", count: profiles.data?.length }]} />
      <div className="mt-5">
        {tab === "invoices"
          ? (profiles.data && !profiles.data.length
            ? <Card><Empty title="Set up billing first" hint={atLeast("manager") ? "Add a billing profile with your company address and wire instructions; it appears on every invoice." : "Ask a manager to add a billing profile with the firm's address and wire instructions."}
                action={atLeast("manager") ? <Button variant="primary" onClick={() => setTab("profiles")}>Add billing profile</Button> : undefined} /></Card>
            : <InvoiceList />)
          : <ProfileList profiles={profiles.data} />}
      </div>
    </div>
  );
}

function InvoiceList() {
  const nav = useNavigate();
  const [status, setStatus] = useState(""); const [q, setQ] = useState("");
  const pager = usePager(50);
  const sorting = useServerSort({ key: "created", dir: "desc" }, { number: "number", customer: "billed_to_name", issue: "issue_date", due: "due_date", total: "total", status: "status" }, pager.reset);
  const invoices = useQuery({ queryKey: ["invoices", status, q, sorting.params, pager.limit, pager.offset],
    queryFn: () => billingApi.invoices({ status: status || undefined, q: q.trim() || undefined, ...sorting.params, limit: pager.limit, offset: pager.offset }) });
  const cols: Column<Invoice>[] = [
    { key: "number", header: "Invoice", sort: (i) => i.number, width: "120px", render: (i) => <span className="mono">{i.number ?? <span className="text-crm-sand-500">Draft</span>}</span> },
    { key: "customer", header: "Billed to", sort: (i) => i.billed_to_name, render: (i) => <NameCell name={i.billed_to_name} max={360} sub={i.engagement_name ?? (i.account_name && i.account_name !== i.billed_to_name ? i.account_name : undefined)} /> },
    { key: "issue", header: "Issued", sort: (i) => i.issue_date, width: "120px", render: (i) => cellDate(i.issue_date) },
    { key: "due", header: "Due", sort: (i) => i.due_date, width: "120px", hideBelow: 1180, render: (i) => cellDate(i.due_date) },
    { key: "total", header: "Total", sort: (i) => i.total, align: "right", width: "140px", render: (i) => <span className="num">{formatAmount(i.total, i.currency)}</span> },
    { key: "status", header: "Status", sort: (i) => i.status, width: "110px", render: (i) => <InvoiceStatusBadge status={i.status} /> },
  ];
  return <>
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <SearchInput value={q} onChange={(e) => { setQ(e.target.value); pager.reset(); }} placeholder="Search customer or number…" aria-label="Search invoices" className="!w-[260px]" />
      <Select value={status} onChange={(e) => { setStatus(e.target.value); pager.reset(); }} options={strOpts(INVOICE_STATUSES)} placeholder="All statuses" className="!w-[160px]" aria-label="Invoice status" />
      <ResultCount>{plural(invoices.data?.total ?? 0, "invoice")}</ResultCount>
    </div>
    <div className="card overflow-hidden">
      <DataTable rows={invoices.data?.items} columns={cols} loading={invoices.isLoading} twoLine onRowClick={(i) => nav(`/billing/${i.id}`)} sort={sorting.sort} onSortChange={sorting.onSortChange}
        empty={<Empty title={status || q ? "No matching invoices" : "No invoices yet"} hint={status || q ? undefined : "Create one from here or from an account's Invoices tab."} />} />
      <Pagination total={invoices.data?.total} limit={pager.limit} offset={pager.offset} onOffset={pager.setOffset} onLimit={pager.setLimit} />
    </div>
  </>;
}

function ProfileList({ profiles }: { profiles: BillingProfile[] | undefined }) {
  const { atLeast } = useAuth(); const canEdit = atLeast("manager");
  const [editing, setEditing] = useState<BillingProfile | "new" | null>(null);
  const qc = useQueryClient(); const confirm = useConfirm(); const { toast, error } = useToast();
  const archive = useMutation({ mutationFn: (id: number) => billingApi.archiveProfile(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ["billing-profiles"] }); toast("Billing profile archived"); }, onError: error });
  return <>
    <div className="mb-4 flex items-center justify-between gap-3">
      <p className="text-[13px] text-crm-sand-600">Your company details and wire instructions as printed on invoices. Issued invoices keep the details they were issued with.</p>
      {canEdit && <Button variant="primary" onClick={() => setEditing("new")}><Plus size={14} />New profile</Button>}
    </div>
    {profiles && !profiles.length && <Card><Empty title="No billing profiles" hint={canEdit ? "Add your company address and bank details to start invoicing." : "A manager can add one."} /></Card>}
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {profiles?.map((p) => (
        <Card key={p.id} title={<span className="flex items-center gap-2"><i className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: p.accent_color }} aria-hidden />{p.label}{p.is_default && <Badge tone="blue">Default</Badge>}</span>}
          actions={canEdit && <>
            <Button size="sm" variant="ghost" onClick={() => setEditing(p)}><Pencil size={12} />Edit</Button>
            <Button size="sm" variant="ghost" onClick={async () => { if (await confirm({ title: `Archive ${p.label}?`, body: "It can no longer be chosen for new invoices. Existing invoices are unchanged.", confirmLabel: "Archive" })) archive.mutate(p.id); }}><Archive size={12} />Archive</Button>
          </>}>
          <DL columns={2} items={[
            { label: "Company", value: p.issuer_name },
            { label: "Contact", value: [p.phone, p.email].filter(Boolean).join(" · ") || null },
            { label: "Address", value: [p.address_line1, p.address_line2, [[p.city, p.state].filter(Boolean).join(", "), p.postal_code].filter(Boolean).join(" ")].filter(Boolean).join("\n") || null, span: 2 },
            { label: "Account name", value: p.account_name }, { label: "Bank", value: p.bank_name },
            { label: "Routing number", value: p.routing_number }, { label: "Account number", value: p.account_number_last4 ? `•••• ${p.account_number_last4}` : null },
            { label: "Terms", value: plural(p.default_terms_days, "day") },
          ]} />
        </Card>
      ))}
    </div>
    {editing && <BillingProfileForm profile={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
  </>;
}
