import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@/components/firmcrm/lib/query";
import { useNavigate } from "@/components/firmcrm/lib/navigation";
import { Plus, Download } from "lucide-react";
import { accountsApi, contactsApi, dataApi } from "@/components/firmcrm/api";
import { Pagination, usePager } from "@/components/firmcrm/components/ui/Pagination";
import { useAuth } from "@/components/firmcrm/lib/auth";
import type { Contact } from "@/components/firmcrm/api/types";
import { Badge, Button, Empty, PageHeader, Select, statusTone } from "@/components/firmcrm/components/ui";
import { DataTable, useServerSort, type Column } from "@/components/firmcrm/components/ui/DataTable";
import { FormModal, type FieldDef } from "@/components/firmcrm/components/ui/Form";
import { useToast } from "@/components/firmcrm/components/ui/Toast";
import { useUsers, opt, strOpts } from "@/components/firmcrm/lib/hooks";
import { CONTACT_ROLES, LIFECYCLES } from "@/components/firmcrm/lib/options";
import { plural, titleCase } from "@/components/firmcrm/lib/format";
import { ArchivedChip, FilterToggle, NameCell, ResultCount, SearchInput, cellDate, cellText } from "@/components/firmcrm/components/ui/cells";

export function useContactFields(): FieldDef[] {
  const users = useUsers();
  const accounts = useQuery({ queryKey: ["accounts", "all"], queryFn: () => accountsApi.list({ limit: 500 }), staleTime: 60_000, select: (p) => p.items });
  return useMemo(() => [
    { name: "first_name", label: "First name", required: true }, { name: "last_name", label: "Last name", required: true },
    { name: "title", label: "Title" }, { name: "account_id", label: "Account", type: "select", options: opt(accounts.data, (a) => a.name) },
    { name: "email", label: "Email", type: "email" }, { name: "phone", label: "Phone" },
    { name: "role", label: "Role", type: "select", options: strOpts(CONTACT_ROLES) }, { name: "lifecycle", label: "Lifecycle", type: "select", options: strOpts(LIFECYCLES) },
    { name: "owner_id", label: "Owner", type: "select", options: opt(users.data, (u) => u.full_name) }, { name: "linkedin", label: "LinkedIn" },
    { name: "do_not_contact", label: "Do not contact (marketing opt-out)", type: "checkbox", span: 2 },
    { name: "notes", label: "Notes", type: "textarea" },
  ], [users.data, accounts.data]);
}

export default function ContactsPage() {
  const nav = useNavigate(); const qc = useQueryClient(); const { toast } = useToast();
  const [q, setQ] = useState(""); const [lifecycle, setLifecycle] = useState(""); const [creating, setCreating] = useState(false); const [archived, setArchived] = useState(false);
  const pager = usePager(50); const { atLeast } = useAuth(); const { error } = useToast();
  // Server-side ordering so sort + paging agree (flows QA #10); Account and Owner have no API sort field and are not sortable.
  const sorting = useServerSort({ key: "name", dir: "asc" }, { name: "last_name", role: "role", lc: "lifecycle", email: "email", last: "last_activity_at" }, pager.reset);
  const contacts = useQuery({ queryKey: ["contacts", q, lifecycle, archived, sorting.params, pager.limit, pager.offset], queryFn: () => contactsApi.list({ q: q || undefined, lifecycle: lifecycle || undefined, include_archived: archived, ...sorting.params, limit: pager.limit, offset: pager.offset }) });
  const fields = useContactFields();
  const filtered = Boolean(q || lifecycle || archived);
  const clearFilters = () => { setQ(""); setLifecycle(""); setArchived(false); pager.reset(); };
  // Widths per §6.6 / QA #6: name 260, role 120, email capped at 220 and truncated. Owner yields below 1280, Last activity below 1180 (QA #7).
  const cols: Column<Contact>[] = [
    { key: "name", header: "Name", width: "260px", sort: (c) => c.last_name, render: (c) => <NameCell name={c.full_name} sub={c.title} max={260} chips={<>{c.do_not_contact && <Badge tone="danger">DNC</Badge>}{c.is_archived && <ArchivedChip />}</>} /> },
    { key: "account", header: "Account", render: (c) => cellText(c.account_name, 200) },
    { key: "role", header: "Role", sort: (c) => c.role ?? "", width: "120px", render: (c) => cellText(c.role ? titleCase(c.role) : null) },
    { key: "lc", header: "Lifecycle", sort: (c) => c.lifecycle, width: "120px", render: (c) => <Badge dot tone={statusTone(c.lifecycle)}>{titleCase(c.lifecycle)}</Badge> },
    // Phone is on the contact detail page; the list keeps email as the reachable identifier so it fits at 1440.
    { key: "email", header: "Email", sort: (c) => c.email ?? "", render: (c) => c.email ? <a href={`mailto:${c.email}`} onClick={(e) => e.stopPropagation()} className="block truncate whitespace-nowrap text-crm-sand-900 hover:text-crm-accent-600" title={c.email}>{c.email}</a> : cellText(null) },
    { key: "owner", header: "Owner", width: "150px", hideBelow: 1280, render: (c) => cellText(c.owner_name) },
    { key: "last", header: "Last activity", sort: (c) => c.last_activity_at ?? "", width: "120px", hideBelow: 1180, render: (c) => cellDate(c.last_activity_at) },
  ];
  const empty = filtered
    ? <Empty title="No contacts match these filters" hint="Try a broader search or clear the lifecycle filter." action={<Button size="sm" onClick={clearFilters}>Clear filters</Button>} />
    : <Empty title="No contacts yet" hint="Add a contact or convert a lead to get started." />;
  return (
    <div>
      <PageHeader title="Contacts" subtitle="People at clients, prospects, and referral sources" actions={<Button variant="primary" onClick={() => setCreating(true)}><Plus size={14} />New contact</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput placeholder="Search name, email, title…" value={q} onChange={(e) => { setQ(e.target.value); pager.reset(); }} />
        <Select value={lifecycle} onChange={(e) => { setLifecycle(e.target.value); pager.reset(); }} options={strOpts(LIFECYCLES)} placeholder="All lifecycles" className="!w-[180px]" aria-label="Lifecycle" />
        <FilterToggle checked={archived} onChange={(v) => { setArchived(v); pager.reset(); }}>Show archived</FilterToggle>
        <ResultCount>{plural(contacts.data?.total ?? 0, "contact")}</ResultCount>
        {atLeast("manager") && <Button size="sm" className="ml-auto" onClick={() => dataApi.exportCsv("contacts", archived).catch(error)}><Download size={12} />Export CSV</Button>}
      </div>
      <div className="card overflow-hidden">
        <DataTable rows={contacts.data?.items} columns={cols} loading={contacts.isLoading} twoLine layout="fixed" onRowClick={(c) => nav(`/contacts/${c.id}`)} sort={sorting.sort} onSortChange={sorting.onSortChange} empty={empty} />
        <Pagination total={contacts.data?.total} limit={pager.limit} offset={pager.offset} onOffset={pager.setOffset} onLimit={pager.setLimit} />
      </div>
      <FormModal open={creating} onClose={() => setCreating(false)} title="New contact" fields={fields} initial={{ lifecycle: "prospect", role: "decision_maker" }} submitLabel="Create"
        onSubmit={async (v) => { const c = await contactsApi.create(v as Partial<Contact>); qc.invalidateQueries({ queryKey: ["contacts"] }); toast("Contact created"); nav(`/contacts/${c.id}`); }} />
    </div>
  );
}
