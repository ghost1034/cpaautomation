import { SharedClientPanel } from "../components/crm/SharedClientPanel";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@/components/firmcrm/lib/query";
import { Link, useNavigate, useParams } from "@/components/firmcrm/lib/navigation";
import { Archive, ArchiveRestore, Lock, Pencil, Plus, ShieldCheck } from "lucide-react";
import { useAuth } from "@/components/firmcrm/lib/auth";
import { accountsApi, billingApi, contactsApi, conflictsApi, engagementsApi, oppsApi } from "@/components/firmcrm/api";
import type { Account, Contact, Engagement, Invoice, Opportunity } from "@/components/firmcrm/api/types";
import { InvoiceStatusBadge } from "@/components/firmcrm/components/billing/InvoiceStatusBadge";
import { formatAmount } from "@/components/firmcrm/lib/billingMath";
import { Badge, Button, Card, DL, Empty, OverflowMenu, PageHeader, Spinner, Tabs, statusTone, type MenuItem } from "@/components/firmcrm/components/ui";
import { DataTable, type Column } from "@/components/firmcrm/components/ui/DataTable";
import { FormModal, type FormValues } from "@/components/firmcrm/components/ui/Form";
import { useConfirm } from "@/components/firmcrm/components/ui/Confirm";
import { useToast } from "@/components/firmcrm/components/ui/Toast";
import { ActivityTimeline } from "@/components/firmcrm/components/crm/ActivityTimeline";
import { WallPanel, useWall } from "@/components/firmcrm/components/crm/WallPanel";
import { useAccountFields } from "./AccountsPage";
import { Dash, NameCell, cellDate, cellMoney, cellText } from "@/components/firmcrm/components/ui/cells";
import { FactsGrid, NotFound, type Fact } from "@/components/firmcrm/components/ui/facts";
import { useContactFields } from "./ContactsPage";
import { NewOpportunityModal } from "./OpportunitiesPage";
import { ClearanceList } from "./ClearancePage";
import { fmtDate, useMoney, titleCase } from "@/components/firmcrm/lib/format";

type Tab = "overview" | "contacts" | "opportunities" | "activities" | "engagements" | "invoices" | "clearance";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default function AccountDetailPage() {
  const money = useMoney();
  const id = Number(useParams().id);
  const nav = useNavigate(); const qc = useQueryClient(); const { toast, error } = useToast(); const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>("overview");
  const [editing, setEditing] = useState(false); const [newContact, setNewContact] = useState(false); const [newOpp, setNewOpp] = useState(false);
  const acc = useQuery({ queryKey: ["account", id], queryFn: () => accountsApi.get(id) });
  // Dependent queries wait for the record so a 404 (deleted or walled) does not fan out into more 404s.
  const loaded = !!acc.data;
  const contacts = useQuery({ queryKey: ["contacts", { account_id: id }], queryFn: () => contactsApi.list({ account_id: id, limit: 200 }), select: (p) => p.items, enabled: loaded });
  const opps = useQuery({ queryKey: ["opps", { account_id: id }], queryFn: () => oppsApi.list({ account_id: id, status: "all", limit: 200 }), select: (p) => p.items, enabled: loaded });
  const engs = useQuery({ queryKey: ["engagements", { account_id: id }], queryFn: () => engagementsApi.list({ account_id: id, limit: 200 }), select: (p) => p.items, enabled: loaded });
  const invoices = useQuery({ queryKey: ["invoices", { account_id: id }], queryFn: () => billingApi.invoices({ account_id: id, limit: 200 }), select: (p) => p.items, enabled: loaded });
  const checks = useQuery({ queryKey: ["checks", { account_id: id }], queryFn: () => conflictsApi.list({ account_id: id, limit: 100 }), select: (p) => p.items, enabled: loaded });
  const { atLeast } = useAuth();
  const archiveM = useMutation({ mutationFn: () => (acc.data!.is_archived ? accountsApi.restore(id) : accountsApi.archive(id)), onSuccess: (a) => { qc.invalidateQueries({ queryKey: ["account", id] }); qc.invalidateQueries({ queryKey: ["accounts"] }); toast(a.is_archived ? "Account archived" : "Account restored"); }, onError: error });
  const accFields = useAccountFields(); const contactFields = useContactFields();
  const runCheck = useMutation({ mutationFn: () => conflictsApi.run({ check_type: "conflict", account_id: id, parties: [acc.data!.name, ...(acc.data!.aliases?.split(",").map((s) => s.trim()).filter(Boolean) ?? [])] }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["checks"] }); setTab("clearance"); toast("Clearance check recorded"); }, onError: error });
  const wall = useWall("account", id, loaded);
  if (acc.isError) return <NotFound what="Account" backTo="/accounts" backLabel="Back to accounts" />;
  if (acc.isLoading || !acc.data) return <Spinner />;
  const a = acc.data;

  const archiveOrRestore = async () => {
    if (a.is_archived) { archiveM.mutate(); return; }
    const ok = await confirm({ title: "Archive this account?", body: "It leaves lists but stays searchable for conflict checks and can be restored.", confirmLabel: "Archive" });
    if (ok) archiveM.mutate();
  };
  // §6.3: Edit + one primary inline; the rest in an overflow menu (QA #13).
  const menu: MenuItem[] = [
    { label: "Run conflict check", icon: <ShieldCheck />, onSelect: () => runCheck.mutate(), disabled: runCheck.isPending },
    ...(atLeast("manager") ? [a.is_archived
      ? { label: "Restore account", icon: <ArchiveRestore />, onSelect: archiveOrRestore, disabled: archiveM.isPending }
      : { label: "Archive account", icon: <Archive />, tone: "danger" as const, onSelect: archiveOrRestore, disabled: archiveM.isPending }] : []),
  ];

  const activeEngs = engs.data?.filter((e) => e.status === "active") ?? [];
  const openOpps = opps.data?.filter((o) => o.status === "open") ?? [];
  const riskTone = a.risk_rating === "high" ? "text-crm-danger-700" : a.risk_rating === "medium" ? "text-crm-warn-700" : "text-crm-sand-900";
  const facts: Fact[] = [
    { label: "Open pipeline", value: money(a.open_pipeline), sub: opps.data ? plural(openOpps.length, "open opportunity", "open opportunities") : "—" },
    { label: "Active engagements", value: engs.data ? activeEngs.length : <Dash />, sub: engs.data ? `${engs.data.length} total` : "—" },
    { label: "Annual engagement value", value: engs.data ? money(activeEngs.reduce((s, e) => s + e.annual_value, 0)) : <Dash />, sub: "Active engagements" },
    { label: "Client since", value: a.client_since ? fmtDate(a.client_since) : <Dash />, sub: `Created ${fmtDate(a.created_at)}`, size: "text" },
    { label: "Relationship partner", value: a.owner_name ?? <Dash />, sub: a.originating_partner_name ? `Originating: ${a.originating_partner_name}` : "No originating partner", size: "text" },
    { label: "Risk", value: a.risk_rating ? <span className={riskTone}>{titleCase(a.risk_rating)}</span> : <Dash />, sub: a.is_public_company ? "Public company · independence" : titleCase(a.entity_kind), size: "text" },
  ];

  const contactCols: Column<Contact>[] = [
    { key: "name", header: "Name", width: "260px", render: (c) => <NameCell name={c.full_name} sub={c.title} max={260} /> },
    { key: "role", header: "Role", width: "120px", render: (c) => cellText(c.role ? titleCase(c.role) : null) }, { key: "email", header: "Email", maxWidth: "220px", render: (c) => cellText(c.email, 220) }, { key: "phone", header: "Phone", hideBelow: 1280, render: (c) => c.phone ? <span className="num whitespace-nowrap">{c.phone}</span> : <Dash /> },
    { key: "lc", header: "Lifecycle", width: "140px", render: (c) => <Badge dot tone={statusTone(c.lifecycle)}>{titleCase(c.lifecycle)}</Badge> }, { key: "last", header: "Last activity", width: "120px", hideBelow: 1180, render: (c) => cellDate(c.last_activity_at) },
  ];
  const oppCols: Column<Opportunity>[] = [
    { key: "name", header: "Opportunity", width: "280px", render: (o) => <NameCell name={o.name} /> }, { key: "stage", header: "Stage", width: "140px", render: (o) => <Badge dot tone={statusTone(o.status === "open" ? "open" : o.status)}>{o.stage_name}</Badge> },
    { key: "pa", header: "Practice area", hideBelow: 1280, render: (o) => cellText(o.practice_area_name, 180) }, { key: "amt", header: "Amount", align: "right", width: "128px", render: (o) => cellMoney(o.amount) },
    { key: "prob", header: "Prob.", align: "right", width: "80px", render: (o) => <span className="font-normal">{o.probability}%</span> }, { key: "close", header: "Expected close", width: "120px", hideBelow: 1180, render: (o) => cellDate(o.expected_close) }, { key: "owner", header: "Owner", width: "160px", hideBelow: 1280, render: (o) => cellText(o.owner_name) },
  ];
  const invoiceCols: Column<Invoice>[] = [
    { key: "number", header: "Invoice", width: "120px", render: (i) => <span className="mono">{i.number ?? <span className="text-crm-sand-500">Draft</span>}</span> },
    { key: "eng", header: "Engagement", render: (i) => cellText(i.engagement_name) },
    { key: "issue", header: "Issued", width: "120px", render: (i) => cellDate(i.issue_date) },
    { key: "due", header: "Due", width: "120px", render: (i) => cellDate(i.due_date) },
    { key: "total", header: "Total", align: "right", width: "140px", render: (i) => <span className="num">{formatAmount(i.total, i.currency)}</span> },
    { key: "status", header: "Status", width: "110px", render: (i) => <InvoiceStatusBadge status={i.status} /> },
  ];
  const engCols: Column<Engagement>[] = [
    { key: "name", header: "Engagement", width: "280px", render: (e) => <NameCell name={e.name} sub={e.external_ref ? <span className="mono">{e.external_ref}</span> : null} /> },
    { key: "pa", header: "Practice area", hideBelow: 1280, render: (e) => cellText(e.practice_area_name, 180) }, { key: "partner", header: "Responsible partner", width: "160px", hideBelow: 1280, render: (e) => cellText(e.responsible_partner_name) },
    { key: "status", header: "Status", width: "140px", render: (e) => <Badge dot tone={statusTone(e.status)}>{titleCase(e.status)}</Badge> }, { key: "val", header: "Annual value", align: "right", width: "128px", render: (e) => cellMoney(e.annual_value) },
    { key: "start", header: "Start", width: "120px", hideBelow: 1180, render: (e) => cellDate(e.start_date) },
  ];
  return (
    <div>
      <PageHeader
        title={<>{a.name}<Badge tone={statusTone(a.account_type)}>{titleCase(a.account_type)}</Badge>{a.is_archived && <Badge>Archived</Badge>}{wall.data && <Badge tone="danger"><Lock size={10} />Restricted</Badge>}{a.is_public_company && <Badge>Public company</Badge>}</>}
        subtitle={<>{a.industry ?? "No industry"} · {titleCase(a.entity_kind)} · {a.city ? `${a.city}, ${a.state}` : "No location"} · Relationship partner <span className="text-crm-sand-700">{a.owner_name ?? "unassigned"}</span></>}
        actions={<>
          <Button onClick={() => setEditing(true)}><Pencil size={14} />Edit</Button>
          {!a.is_archived && <Button variant="primary" onClick={() => setNewOpp(true)}><Plus size={14} />New opportunity</Button>}
          <OverflowMenu items={menu} size="md" label="More actions" />
        </>} />
      <FactsGrid facts={facts} />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "overview", label: "Overview" }, { key: "contacts", label: "Contacts", count: contacts.data?.length }, { key: "opportunities", label: "Opportunities", count: opps.data?.length }, { key: "activities", label: "Activity" }, { key: "engagements", label: "Engagements", count: engs.data?.length }, { key: "invoices", label: "Invoices", count: invoices.data?.length }, { key: "clearance", label: "Clearance", count: checks.data?.length }]} />
      <div className="mt-5">
        {tab === "overview" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 items-start gap-4">
            <Card title="Details" className="lg:col-span-8"><DL columns={3} items={[
              { label: "Website", value: a.website ? <a href={a.website} target="_blank" rel="noreferrer">{a.website}</a> : null }, { label: "Phone", value: a.phone }, { label: "Revenue band", value: a.revenue_band },
              { label: "Originating partner", value: a.originating_partner_name }, { label: "Aliases", value: a.aliases }, { label: "Tags", value: a.tags?.length ? <div className="flex flex-wrap gap-1">{a.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div> : null },
              { label: "Notes", value: a.description, span: 2 }, { label: "Created", value: fmtDate(a.created_at) }]} /></Card>
            <div className="lg:col-span-4 space-y-4">
              <SharedClientPanel account={a} contacts={contacts.data ?? []} />
          {a.shared_client_id ? <Card title="Access"><p className="text-crm-sand-600">Linked client identities are visible firm-wide and cannot have an account wall. Individual opportunities can still have ethical walls.</p></Card> : <WallPanel entityType="account" id={id} entityName={a.name} />}
              <Card title="Recent activity" actions={<Button size="sm" variant="ghost" onClick={() => setTab("activities")}>View all</Button>}><ActivityTimeline filter={{ account_id: id }} limit={5} readOnly linkTo onViewAll={() => setTab("activities")} /></Card>
            </div>
          </div>)}
        {tab === "contacts" && <Card title="Contacts" padded={false} actions={<Button size="sm" onClick={() => setNewContact(true)}><Plus size={12} />Add contact</Button>}><DataTable rows={contacts.data} columns={contactCols} loading={contacts.isLoading} twoLine onRowClick={(c) => nav(`/contacts/${c.id}`)} empty="No contacts on this account" /></Card>}
        {tab === "opportunities" && <Card title="Opportunities" padded={false}><DataTable rows={opps.data} columns={oppCols} loading={opps.isLoading} onRowClick={(o) => nav(`/opportunities/${o.id}`)} empty="No opportunities on this account" /></Card>}
        {tab === "activities" && <Card title="Activity timeline"><ActivityTimeline filter={{ account_id: id }} linkTo /></Card>}
        {tab === "engagements" && <Card title="Engagements" padded={false}>
          {engs.data && engs.data.length === 0
            ? <Empty title="No engagements yet" hint="Engagements are created automatically when an opportunity on this account is Closed Won." />
            : <DataTable rows={engs.data} columns={engCols} loading={engs.isLoading} twoLine empty="No engagements yet" />}
        </Card>}
        {tab === "invoices" && <Card title="Invoices" padded={false} actions={!a.is_archived && <Button size="sm" onClick={() => nav(`/billing/new?accountId=${id}`)}><Plus size={12} />New invoice</Button>}>
          <DataTable rows={invoices.data} columns={invoiceCols} loading={invoices.isLoading} onRowClick={(i) => nav(`/billing/${i.id}`)} empty="No invoices for this account" />
        </Card>}
        {tab === "clearance" && <><p className="mb-4 text-[13px] leading-5 text-crm-sand-600">Manage the screening list and add companies in <Link to="/clearance">Clearance → Conflict companies</Link>.</p><ClearanceList checks={checks.data} loading={checks.isLoading} /></>}
      </div>
      <FormModal open={editing} onClose={() => setEditing(false)} title="Edit account" fields={accFields} initial={a as unknown as FormValues}
        onSubmit={async (v) => { const body: Record<string, unknown> = {}; for (const f of accFields) body[f.name] = v[f.name] ?? null; await accountsApi.update(id, body as Partial<Account>); qc.invalidateQueries({ queryKey: ["account", id] }); qc.invalidateQueries({ queryKey: ["accounts"] }); toast("Account updated"); }} />
      <FormModal open={newContact} onClose={() => setNewContact(false)} title="Add contact" fields={contactFields.filter((f) => f.name !== "account_id")} initial={{ lifecycle: a.account_type === "client" ? "client" : "prospect", role: "decision_maker" }} submitLabel="Create"
        onSubmit={async (v) => { await contactsApi.create({ ...(v as Partial<Contact>), account_id: id }); qc.invalidateQueries({ queryKey: ["contacts"] }); qc.invalidateQueries({ queryKey: ["account", id] }); toast("Contact added"); }} />
      {newOpp && <NewOpportunityModal accountId={id} onClose={() => setNewOpp(false)} />}
    </div>
  );
}
