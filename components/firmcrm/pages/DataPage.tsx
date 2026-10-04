import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@/components/firmcrm/lib/query";
import { Download, FileUp, FolderOpen, Upload, X } from "lucide-react";
import { dataApi } from "@/components/firmcrm/api";
import type { ImportJob } from "@/components/firmcrm/api/types";
import { Badge, Button, Card, Empty, Field, PageHeader, Select, Spinner, cn } from "@/components/firmcrm/components/ui";
import { Pagination, usePager } from "@/components/firmcrm/components/ui/Pagination";
import { useConfirm } from "@/components/firmcrm/components/ui/Confirm";
import { useToast } from "@/components/firmcrm/components/ui/Toast";
import { fmtDateTime, num, plural, titleCase } from "@/components/firmcrm/lib/format";
import { Dash, FilterToggle } from "@/components/firmcrm/components/ui/cells";

const EXPORTS = ["accounts", "contacts", "leads", "opportunities", "engagements", "activities"];
const IMPORTS = ["accounts", "contacts", "leads"];

/** Five small fact cells (§6.4 pattern at 18px) followed by the exceptions table. */
function JobSummary({ job }: { job: ImportJob }) {
  const exceptions = job.exceptions.filter((e) => e.row).length;
  const cells: { label: string; value: number; warn?: boolean }[] = [
    { label: "Rows", value: job.total_rows }, { label: "Created", value: job.created_rows }, { label: "Updated", value: job.updated_rows },
    { label: "Skipped", value: job.skipped_rows, warn: job.skipped_rows > 0 }, { label: "Exceptions", value: exceptions, warn: exceptions > 0 },
  ];
  return (
    <div className="space-y-3">
      <div className="card grid grid-cols-2 lg:grid-cols-5 overflow-hidden">
        {cells.map((c, i) => (
          <div key={c.label} className={cn("px-4 py-3", i < cells.length - 1 && "border-r border-crm-sand-100")}>
            <div className="text-[12px] leading-4 font-medium text-crm-sand-600">{c.label}</div>
            <div className={cn("mt-1 text-[18px] leading-6 font-semibold num", c.warn ? "text-crm-warn-700" : "text-crm-sand-900")}>{num(c.value)}</div>
          </div>))}
      </div>
      {job.exceptions.length > 0 && (
        <div className="card max-h-[280px] overflow-auto">
          <table className="tbl dense"><thead><tr><th style={{ width: 72 }} className="!text-right">Row</th><th style={{ width: 160 }}>Field</th><th>Problem</th><th>Data</th></tr></thead>
            <tbody>{job.exceptions.map((e, i) => <tr key={i}>
              <td className="text-right num">{e.row || <Dash />}</td><td className="mono text-crm-sand-700">{e.field ?? ""}</td><td className="text-crm-danger-700">{e.message}</td>
              <td><span className="mono block max-w-[320px] truncate text-crm-sand-500" title={JSON.stringify(e.data)}>{Object.entries(e.data ?? {}).map(([k, v]) => `${k}=${v}`).join("; ")}</span></td></tr>)}</tbody></table>
        </div>)}
    </div>
  );
}

const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export default function DataPage() {
  const qc = useQueryClient(); const { toast, error } = useToast(); const confirm = useConfirm();
  const [entity, setEntity] = useState("contacts"); const [file, setFile] = useState<File | null>(null); const [preview, setPreview] = useState<ImportJob | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const pager = usePager(25);
  const jobs = useQuery({ queryKey: ["import-jobs", pager.limit, pager.offset], queryFn: () => dataApi.jobs({ limit: pager.limit, offset: pager.offset }) });
  const run = useMutation({
    mutationFn: (dry: boolean) => dataApi.importCsv(entity, file!, dry),
    onSuccess: (job, dry) => { qc.invalidateQueries({ queryKey: ["import-jobs"] }); if (dry) { setPreview(job); toast(`Dry run: ${job.created_rows} to create, ${job.updated_rows} to update, ${job.skipped_rows} skipped`); } else { setPreview(null); clearFile(); toast(`Imported: ${job.created_rows} created, ${job.updated_rows} updated`); ["accounts", "contacts", "leads"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); } },
    onError: error,
  });
  const canCommit = !!file && !!preview && !run.isPending && preview.dry_run !== false;
  const clearFile = () => { setFile(null); setPreview(null); if (fileInput.current) fileInput.current.value = ""; };
  const commit = async () => {
    if (!preview) return;
    const ok = await confirm({ title: `Commit import of ${plural(preview.created_rows + preview.updated_rows, entity.slice(0, -1), entity)}?`, body: `${num(preview.created_rows)} new and ${num(preview.updated_rows)} updated records are written; rows with exceptions are skipped.`, confirmLabel: "Commit import", tone: "primary" });
    if (ok) run.mutate(false);
  };
  return (
    <div>
      <PageHeader title="Data import and export" subtitle="Bulk CSV in and out. Imports are validated row by row; rows with exceptions are skipped when you commit." />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card title="Export CSV">
          <div className="grid grid-cols-2 gap-2">{EXPORTS.map((e) => <Button key={e} onClick={() => dataApi.exportCsv(e, includeArchived).catch(error)} className="justify-start"><Download size={13} className="text-crm-sand-500" />{titleCase(e)}</Button>)}</div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <FilterToggle checked={includeArchived} onChange={setIncludeArchived}>Include archived records</FilterToggle>
          </div>
          <div className="mt-2 text-[12px] leading-4 text-crm-sand-500">Exports are logged in the audit trail with row counts.</div>
        </Card>
        <Card title="Import CSV" tourId="import-card" className="md:col-span-2">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Entity"><Select value={entity} options={IMPORTS.map((i) => ({ value: i, label: titleCase(i) }))} onChange={(e) => { setEntity(e.target.value); setPreview(null); }} /></Field>
            {/* Secondary "Choose CSV…" + filename text instead of the native file control (§6.10; QA #28). The real input is visually hidden. */}
            <div className="md:col-span-2">
              <span className="label">File</span>
              <div className="flex h-8 items-center gap-2">
                <input ref={fileInput} type="file" accept=".csv,text/csv" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} />
                <Button onClick={() => fileInput.current?.click()}><FolderOpen size={13} className="text-crm-sand-500" />Choose CSV…</Button>
                {file
                  ? <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-crm-sand-900"><span className="truncate font-medium" title={file.name}>{file.name}</span><span className="shrink-0 text-[12px] text-crm-sand-500 num">{fmtBytes(file.size)}</span><button type="button" onClick={clearFile} aria-label="Remove file" className="grid h-6 w-6 shrink-0 place-items-center rounded-crm-md text-crm-sand-500 hover:bg-crm-sand-100 hover:text-crm-sand-900"><X size={12} /></button></span>
                  : <span className="text-[13px] text-crm-sand-400">No file chosen</span>}
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button onClick={() => dataApi.template(entity).catch(error)}><Download size={13} />Template</Button>
            <Button disabled={!file || run.isPending} onClick={() => run.mutate(true)}><FileUp size={13} />Dry run</Button>
            <Button variant="primary" disabled={!canCommit} onClick={commit}><Upload size={13} />Commit import</Button>
            {canCommit && preview.skipped_rows > 0 && <span className="text-[12px] leading-4 text-crm-warn-700"><span className="num">{num(preview.skipped_rows)}</span> {preview.skipped_rows === 1 ? "row" : "rows"} will be skipped</span>}
          </div>
          <div className="mt-2 text-[12px] leading-4 text-crm-sand-500">Matching: accounts by name or alias · contacts by email · leads by email + company. Matches update; others create.</div>
          {preview && (
            <div className="mt-5">
              <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-crm-sand-900">Dry run result{preview.skipped_rows ? <Badge dot tone="warn"><span className="num">{plural(preview.skipped_rows, "row")} would be skipped</span></Badge> : <Badge dot tone="success">Clean</Badge>}</div>
              <JobSummary job={preview} />
            </div>)}
        </Card>
      </div>
      <Card title="Import history" className="mt-4" padded={false}>
        {jobs.isLoading ? <Spinner /> : !jobs.data?.items.length ? <Empty title="No imports yet" hint="Dry runs and committed imports are listed here." /> : <table className="tbl"><thead><tr><th style={{ width: 180 }}>When</th><th style={{ width: 110 }}>Entity</th><th>File</th><th style={{ width: 120 }}>Mode</th><th style={{ width: 160 }} className="max-[1279px]:hidden">By</th><th style={{ width: 88 }} className="!text-right">Rows</th><th style={{ width: 88 }} className="!text-right">Created</th><th style={{ width: 88 }} className="!text-right">Updated</th><th style={{ width: 88 }} className="!text-right">Skipped</th><th style={{ width: 140 }}></th></tr></thead>
          <tbody>{jobs.data.items.map((j) => <tr key={j.id}>
            <td className="num whitespace-nowrap text-crm-sand-600">{fmtDateTime(j.created_at)}</td><td>{titleCase(j.entity)}</td><td><span className="block max-w-[240px] truncate whitespace-nowrap font-medium" title={j.filename}>{j.filename}</span></td>
            <td>{j.dry_run ? <Badge dot tone="neutral">Dry run</Badge> : <Badge dot tone="success">Committed</Badge>}</td><td className="max-[1279px]:hidden">{j.actor_name ?? <Dash />}</td>
            <td className="text-right num">{j.total_rows ? num(j.total_rows) : <Dash />}</td><td className="text-right num">{j.created_rows ? num(j.created_rows) : <Dash />}</td><td className="text-right num">{j.updated_rows ? num(j.updated_rows) : <Dash />}</td>
            <td className={cn("text-right num", j.skipped_rows > 0 && "font-medium text-crm-warn-700")}>{j.skipped_rows ? num(j.skipped_rows) : <Dash />}</td>
            <td className="text-right">{j.exceptions.length > 0 && <Button size="sm" variant="ghost" onClick={() => dataApi.exceptionsCsv(j.id).catch(error)}><Download size={12} />Exceptions</Button>}</td></tr>)}</tbody></table>}
        {/* Pagination returns null at total 0, so the card has no empty footer row (QA #28). */}
        <Pagination total={jobs.data?.total} limit={pager.limit} offset={pager.offset} onOffset={pager.setOffset} />
      </Card>
    </div>
  );
}
