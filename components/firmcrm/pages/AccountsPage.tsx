import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@/components/firmcrm/lib/query";
import { useNavigate } from "@/components/firmcrm/lib/navigation";
import { Plus, Download } from "lucide-react";
import { accountsApi, dataApi } from "@/components/firmcrm/api";
import { Pagination, usePager } from "@/components/firmcrm/components/ui/Pagination";
import { useAuth } from "@/components/firmcrm/lib/auth";
import type { Account } from "@/components/firmcrm/api/types";
import { Badge, Button, Empty, PageHeader, Select, statusTone } from "@/components/firmcrm/components/ui";
import { ArchivedChip, Dash, FilterToggle, NameCell, ResultCount, SearchInput, cellCount, cellDate, cellMoney, cellText } from "@/components/firmcrm/components/ui/cells";
import { DataTable, useServerSort, type Column } from "@/components/firmcrm/components/ui/DataTable";
import { FormModal, type FieldDef } from "@/components/firmcrm/components/ui/Form";
import { useConfirm } from "@/components/firmcrm/components/ui/Confirm";
import { useToast } from "@/components/firmcrm/components/ui/Toast";
import { ApiError } from "@/components/firmcrm/api/client";
import { useUsers, opt, partnerOptions, strOpts } from "@/components/firmcrm/lib/hooks";
import { ACCOUNT_TYPES, ENTITY_KINDS, INDUSTRIES, REVENUE_BANDS, RISK } from "@/components/firmcrm/lib/options";
import { titleCase } from "@/components/firmcrm/lib/format";

export function useAccountFields(): FieldDef[] {
  const users = useUsers();
  return useMemo(() => [
    { name: "name", label: "Account name", required: true, span: 2 },
    { name: "account_type", label: "Type", type: "select", options: strOpts(ACCOUNT_TYPES) }, { name: "entity_kind", label: "Entity kind", type: "select", options: strOpts(ENTITY_KINDS) },
    { name: "industry", label: "Industry", type: "select", options: strOpts(INDUSTRIES) }, { name: "revenue_band", label: "Revenue band", type: "select", options: REVENUE_BANDS.map((r) => ({ value: r, label: r })) },
    { name: "owner_id", label: "Relationship partner / owner", type: "select", options: opt(users.data, (u) => u.full_name) },
    { name: "originating_partner_id", label: "Originating partner", type: "select", options: partnerOptions(users.data) },
    { name: "website", label: "Website" }, { name: "phone", label: "Phone" },
    { name: "address", label: "Street address", span: 2 },
    { name: "city", label: "City" }, { name: "state", label: "State" },
    { name: "postal_code", label: "ZIP / postal code" },
    { name: "risk_rating", label: "Risk rating", type: "select", options: strOpts(RISK) }, { name: "is_public_company", label: "Public company / SEC registrant (independence)", type: "checkbox" },
    { name: "aliases", label: "Aliases / former names", span: 2, hint: "Comma-separated. Used by conflict search." },
    { name: "tags", label: "Tags", type: "tags", span: 2 },
    { name: "description", label: "Notes", type: "textarea" },
  ], [users.data]);
}

export default function AccountsPage() {
  const nav = useNavigate(); const qc = useQueryClient(); const { toast } = useToast(); const confirm = useConfirm();
  // Set when the user declines the duplicate gate: FormModal's post-submit onClose() is swallowed once so the form stays open with its values.
  const keepOpen = useRef(false);
  const [q, setQ] = useState(""); const [type, setType] = useState(""); const [creating, setCreating] = useState(false); const [archived, setArchived] = useState(false);
  const pager = usePager(50); const { atLeast } = useAuth(); const { error } = useToast();
  // Server-side ordering so sort + paging agree (flows QA #10); columns without an API field are not sortable.
  const sorting = useServerSort({ key: "name", dir: "asc" }, { name: "name", type: "account_type", pipe: "open_pipeline", last: "last_activity_at" }, pager.reset);
  const accounts = useQuery({ queryKey: ["accounts", q, type, archived, sorting.params, pager.limit, pager.offset], queryFn: () => accountsApi.list({ q: q || undefined, account_type: type || undefined, include_archived: archived, ...sorting.params, limit: pager.limit, offset: pager.offset }) });
  const fields = useAccountFields();
  const filtered = Boolean(q || type || archived);
  const clearFilters = () => { setQ(""); setType(""); setArchived(false); pager.reset(); };
  const cols: Column<Account>[] = [
    { key: "name", header: "Account", sort: (a) => a.name, render: (a) => <NameCell name={a.name} sub={[a.industry, a.city ? `${a.city}, ${a.state}` : null].filter(Boolean).join(" · ")} chips={a.is_archived && <ArchivedChip />} /> },
    { key: "type", header: "Type", sort: (a) => a.account_type, width: "140px", render: (a) => <Badge dot tone={statusTone(a.account_type)}>{titleCase(a.account_type)}</Badge> },
    // Originating partner lives in the detail facts grid; the list keeps the relationship partner only so it fits at 1440.
    { key: "owner", header: "Relationship partner", width: "160px", hideBelow: 1280, render: (a) => cellText(a.owner_name) },
    { key: "pipe", header: "Open pipeline", align: "right", width: "128px", sort: (a) => a.open_pipeline, render: (a) => cellMoney(a.open_pipeline) },
    { key: "contacts", header: "Contacts", align: "right", width: "96px", render: (a) => cellCount(a.contact_count) },
    { key: "eng", header: "Engagements", align: "right", width: "112px", render: (a) => cellCount(a.engagement_count) },
    { key: "risk", header: "Risk", width: "100px", render: (a) => a.risk_rating ? <Badge dot tone={statusTone(a.risk_rating)}>{titleCase(a.risk_rating)}</Badge> : <Dash /> },
    { key: "last", header: "Last activity", sort: (a) => a.last_activity_at ?? "", width: "120px", hideBelow: 1180, render: (a) => cellDate(a.last_activity_at) },
  ];
  // §6.16 empty state with hint + "Clear filters" (QA #27).
  const empty = filtered
    ? <Empty title="No accounts match these filters" hint="Try a broader search or clear the type filter." action={<Button size="sm" onClick={clearFilters}>Clear filters</Button>} />
    : <Empty title="No accounts yet" hint="Create an account or convert a lead to get started." />;
  return (
    <div>
      <PageHeader title="Accounts" subtitle="Clients, prospects, referral sources, and adverse parties" actions={<Button variant="primary" onClick={() => setCreating(true)}><Plus size={14} />New account</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput placeholder="Search name, alias, industry…" value={q} onChange={(e) => { setQ(e.target.value); pager.reset(); }} />
        <Select value={type} onChange={(e) => { setType(e.target.value); pager.reset(); }} options={strOpts(ACCOUNT_TYPES)} placeholder="All types" className="!w-[180px]" aria-label="Account type" />
        <FilterToggle checked={archived} onChange={(v) => { setArchived(v); pager.reset(); }}>Show archived</FilterToggle>
        <ResultCount>{accounts.data?.total ?? 0} accounts</ResultCount>
        {atLeast("manager") && <Button size="sm" className="ml-auto" onClick={() => dataApi.exportCsv("accounts", archived).catch(error)}><Download size={12} />Export CSV</Button>}
      </div>
      <div className="card overflow-hidden">
        <DataTable rows={accounts.data?.items} columns={cols} loading={accounts.isLoading} twoLine onRowClick={(a) => nav(`/accounts/${a.id}`)} sort={sorting.sort} onSortChange={sorting.onSortChange} empty={empty} />
        <Pagination total={accounts.data?.total} limit={pager.limit} offset={pager.offset} onOffset={pager.setOffset} onLimit={pager.setLimit} />
      </div>
      <FormModal open={creating} onClose={() => { if (keepOpen.current) { keepOpen.current = false; return; } setCreating(false); }} title="New account" fields={fields} initial={{ account_type: "prospect", entity_kind: "company", country: "US", tags: [] }} submitLabel="Create"
        onSubmit={async (v) => {
          let a: Account;
          try { a = await accountsApi.create(v as Partial<Account>); }
          catch (e) {
            if (!(e instanceof ApiError && e.code === "duplicate")) throw e;
            // User copy, not the API message (QA #3); cancelling keeps the form open without an error toast.
            const ok = await confirm({ title: "Possible duplicate account", body: "An account with this name already exists. Create a second record anyway?", confirmLabel: "Create anyway", tone: "primary" });
            if (!ok) { keepOpen.current = true; return; }
            a = await accountsApi.create({ ...(v as Partial<Account>), allow_duplicate: true });
          }
          qc.invalidateQueries({ queryKey: ["accounts"] }); toast("Account created"); nav(`/accounts/${a.id}`); }} />
    </div>
  );
}
