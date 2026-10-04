/* Activity timeline (DESIGN.md §6.14): composer on top, then a railed list of icon discs grouped by day. */
import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@/components/firmcrm/lib/query";
import { Phone, Mail, Calendar, StickyNote, CheckSquare, Check, Trash2, AlignLeft, ArrowRightLeft, ShieldCheck, type LucideIcon } from "lucide-react";
import { format, isToday, isYesterday, parseISO } from "date-fns";
import { Link } from "@/components/firmcrm/lib/navigation";
import { activitiesApi } from "@/components/firmcrm/api";
import type { Activity } from "@/components/firmcrm/api/types";
import { Badge, Button, Input, Spinner, Textarea, cn } from "@/components/firmcrm/components/ui";
import { useToast } from "@/components/firmcrm/components/ui/Toast";
import { useConfirm } from "@/components/firmcrm/components/ui/Confirm";
import { ACTIVITY_KINDS } from "@/components/firmcrm/lib/options";
import { fmtDate, plural } from "@/components/firmcrm/lib/format";
import { useAuth } from "@/components/firmcrm/lib/auth";

const ICON: Record<Activity["kind"], LucideIcon> = { call: Phone, email: Mail, meeting: Calendar, note: StickyNote, task: CheckSquare };
const VERB: Record<Activity["kind"], string> = { call: "logged a call", email: "logged an email", meeting: "logged a meeting", note: "added a note", task: "created a task" };

const dayLabel = (iso: string) => { const d = parseISO(iso); return isToday(d) ? "Today" : isYesterday(d) ? "Yesterday" : format(d, "EEEE, MMM d"); };
const stamp = (iso: string | null | undefined) => (iso ? format(parseISO(iso), "MMM d · h:mm a") : "—");

/** System events merged into the feed by timestamp (§6.14): stage changes (accent disc) and clearance checks (success disc). */
export type TimelineEvent = { id: string; at: string; kind: "stage" | "clearance"; title: ReactNode; body?: ReactNode };
const EVENT_ICON: Record<TimelineEvent["kind"], LucideIcon> = { stage: ArrowRightLeft, clearance: ShieldCheck };
const EVENT_DISC: Record<TimelineEvent["kind"], string> = { stage: "border-crm-accent-200 bg-crm-accent-50 text-crm-accent-600", clearance: "border-crm-success-200 bg-crm-success-50 text-crm-success-600" };
type Item = { key: string; at: string; activity?: Activity; event?: TimelineEvent };

export function ActivityTimeline({ filter, linkTo, extraEvents, limit, readOnly, onViewAll }: { filter: Record<string, number>; linkTo?: boolean; extraEvents?: TimelineEvent[]; limit?: number; readOnly?: boolean; onViewAll?: () => void }) {
  const qc = useQueryClient();
  const { toast, error } = useToast();
  const confirm = useConfirm();
  const { user, atLeast } = useAuth();
  const q = useQuery({ queryKey: ["activities", filter], queryFn: () => activitiesApi.list({ ...filter, limit: 100 }), select: (p) => p.items });
  const [kind, setKind] = useState<Activity["kind"]>("note");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [due, setDue] = useState("");
  const [details, setDetails] = useState(false);
  const invalidate = () => { qc.invalidateQueries({ queryKey: ["activities"] }); qc.invalidateQueries({ queryKey: ["opps"] }); qc.invalidateQueries({ queryKey: ["opp"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); };
  const create = useMutation({
    mutationFn: () => activitiesApi.create({ kind, subject, body: body || null, due_at: kind === "task" && due ? parseISO(due).toISOString() : null, ...filter }),
    onSuccess: () => { setSubject(""); setBody(""); setDue(""); setDetails(false); invalidate(); toast(`${kind} logged`); }, onError: error,
  });
  const complete = useMutation({ mutationFn: (a: Activity) => activitiesApi.update(a.id, { completed: !a.completed_at }), onSuccess: invalidate, onError: error });
  const remove = useMutation({ mutationFn: (id: number) => activitiesApi.remove(id), onSuccess: invalidate, onError: error });

  const grouped = useMemo(() => {
    const items: Item[] = [
      ...(q.data ?? []).map((a) => ({ key: `a${a.id}`, at: a.occurred_at ?? a.created_at, activity: a })),
      ...(extraEvents ?? []).map((e) => ({ key: `e${e.id}`, at: e.at, event: e })),
    ].sort((x, y) => (y.at ?? "").localeCompare(x.at ?? ""));
    const shown = limit ? items.slice(0, limit) : items;
    const out: { day: string; items: Item[] }[] = [];
    for (const it of shown) {
      const day = it.at ? dayLabel(it.at) : "Undated";
      const g = out[out.length - 1];
      if (g && g.day === day) g.items.push(it); else out.push({ day, items: [it] });
    }
    return { groups: out, truncated: items.length > shown.length, total: items.length };
  }, [q.data, extraEvents, limit]);
  const { groups, truncated, total } = grouped;
  const isEmpty = !q.data?.length && !extraEvents?.length;

  return (
    <div>
      {!readOnly && <form onSubmit={(e) => { e.preventDefault(); if (subject.trim()) create.mutate(); }} className="space-y-2">
        <div className="flex items-center gap-1" role="radiogroup" aria-label="Activity kind">
          {ACTIVITY_KINDS.map((k) => { const I = ICON[k]; const on = kind === k; return (
            <button type="button" key={k} role="radio" aria-checked={on} onClick={() => setKind(k)}
                    className={cn("inline-flex h-7 items-center gap-1.5 rounded-crm-md border border-transparent px-2 text-[12px] leading-4 font-medium capitalize transition-colors duration-[120ms]", on ? "bg-crm-sand-100 text-crm-sand-900" : "text-crm-sand-600 hover:bg-crm-sand-100 hover:text-crm-sand-900")}>
              <I size={12} />{k}
            </button>); })}
          <button type="button" onClick={() => setDetails((d) => !d)} aria-pressed={details} title="Add details"
                  className={cn("ml-auto grid h-7 w-7 place-items-center rounded-crm-md text-crm-sand-500 transition-colors duration-[120ms] hover:bg-crm-sand-100 hover:text-crm-sand-900", details && "bg-crm-sand-100 text-crm-sand-900")}>
            <AlignLeft size={14} />
          </button>
        </div>
        <div className="flex gap-2">
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={kind === "task" ? "Task to do…" : "Log a call, note, or meeting…"} required aria-label="Subject" />
          {kind === "task" && <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="!w-[150px]" aria-label="Due date" />}
          <Button variant="primary" size="md" type="submit" disabled={create.isPending || !subject.trim()} className="shrink-0">Log</Button>
        </div>
        {(details || body) && <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Details (optional)" className="!min-h-[56px]" />}
      </form>}

      <div className={readOnly ? "" : "mt-4"}>
        {q.isLoading ? <Spinner /> : isEmpty ? <div className="py-2 text-[12px] leading-4 text-crm-sand-500">No activity yet.</div> : (
          <div className="relative before:absolute before:top-2 before:bottom-2 before:left-[11px] before:w-px before:bg-crm-sand-150">
            {groups.map((g) => (
              <div key={g.day}>
                <div className="relative z-[1] mt-2 mb-0.5 ml-9 text-[11px] leading-4 font-medium text-crm-sand-500">{g.day}</div>
                <ol>
                  {g.items.map((it) => {
                    if (it.event) {
                      const ev = it.event; const E = EVENT_ICON[ev.kind];
                      return (
                        <li key={it.key} className="relative grid grid-cols-[24px_1fr_auto] gap-3 py-2.5">
                          <span className={cn("relative z-[1] grid h-6 w-6 place-items-center rounded-full border", EVENT_DISC[ev.kind])}><E size={12} /></span>
                          <div className="min-w-0">
                            <div className="text-[13px] leading-5 text-crm-sand-900">{ev.title}</div>
                            {ev.body && <div className="mt-0.5 line-clamp-2 text-[12px] leading-4 text-crm-sand-600">{ev.body}</div>}
                          </div>
                          <span className="shrink-0 text-[12px] leading-4 text-crm-sand-500 num">{stamp(ev.at)}</span>
                        </li>);
                    }
                    const a = it.activity!;
                    const I = ICON[a.kind]; const done = !!a.completed_at;
                    const overdue = a.kind === "task" && !done && a.due_at && new Date(a.due_at) < new Date();
                    return (
                      <li key={a.id} className="group relative grid grid-cols-[24px_1fr_auto] gap-3 py-2.5">
                        <span className={cn("relative z-[1] grid h-6 w-6 place-items-center rounded-full border bg-crm-sand-0", done ? "border-crm-success-200 bg-crm-success-50 text-crm-success-600" : "border-crm-sand-150 text-crm-sand-600")}><I size={12} /></span>
                        <div className="min-w-0">
                          <div className={cn("text-[13px] leading-5 text-crm-sand-900", done && "text-crm-sand-400 line-through")}>
                            <span className="font-medium">{a.owner_name ?? "Someone"}</span> <span className="text-crm-sand-500">{VERB[a.kind]}</span>{a.subject && <> <span className="text-crm-sand-300">·</span> {a.subject}</>}
                          </div>
                          {a.body && <div className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-[12px] leading-4 text-crm-sand-600">{a.body}</div>}
                          {(a.kind === "task" && !done) || (linkTo && (a.opportunity_name || a.account_name)) ? (
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] leading-4 text-crm-sand-500">
                              {a.kind === "task" && !done && <Badge dot tone={overdue ? "danger" : a.priority === "high" ? "warn" : "neutral"}>{overdue ? "Overdue" : `Due ${fmtDate(a.due_at)}`}</Badge>}
                              {linkTo && a.opportunity_name && <Link to={`/opportunities/${a.opportunity_id}`} className="text-crm-sand-700">{a.opportunity_name}</Link>}
                              {linkTo && !a.opportunity_name && a.account_name && <Link to={`/accounts/${a.account_id}`} className="text-crm-sand-700">{a.account_name}</Link>}
                            </div>) : null}
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <span className="text-[12px] leading-4 text-crm-sand-500 num">{stamp(a.occurred_at ?? a.created_at)}</span>
                          <div className="flex items-center gap-1 opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 focus-within:opacity-100">
                            {a.kind === "task" && <Button size="sm" variant={done ? "ghost" : "secondary"} onClick={() => complete.mutate(a)} title={done ? "Reopen" : "Complete"}><Check size={12} />{done ? "Reopen" : "Done"}</Button>}
                            {(a.owner_id === user?.id || atLeast("manager")) && <Button size="sm" variant="ghost" aria-label="Delete activity" onClick={async () => { if (await confirm({ title: "Delete this activity?", body: "The entry is removed from the record's timeline.", confirmLabel: "Delete" })) remove.mutate(a.id); }}><Trash2 size={12} /></Button>}
                          </div>
                        </div>
                      </li>);
                  })}
                </ol>
              </div>))}
          </div>)}
      </div>
      {truncated && onViewAll && <button type="button" onClick={onViewAll} className="mt-3 text-[12px] leading-4 text-crm-sand-600 hover:text-crm-sand-900 hover:underline">View all {plural(total, "activity", "activities")}</button>}
    </div>
  );
}
