import { useMoneyChartProps } from "../components/crm/charts";
import { useCrmContext } from "../lib/auth";
import { useQuery } from "@/components/firmcrm/lib/query";
import { Link, useNavigate } from "@/components/firmcrm/lib/navigation";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { format, isBefore, isToday, parseISO, startOfDay } from "date-fns";
import { oppsApi, reportsApi } from "@/components/firmcrm/api";
import { Badge, Card, Empty, PageHeader, Stat, cn } from "@/components/firmcrm/components/ui";
import { CHART, ChartFrame, ChartLegend, WinLossBar, barChartProps, barProps, gridProps, tooltipProps, xAxisProps, } from "@/components/firmcrm/components/crm/charts";
import { fmtDate, useMoney, num, pct, plural } from "@/components/firmcrm/lib/format";
import { useAuth } from "@/components/firmcrm/lib/auth";

/* Skeleton rows for table loads (§6.6): no spinners. */
function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-3 px-5 py-4" role="status" aria-live="polite" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <span className="skeleton w-[30%]" /><span className="skeleton w-[20%]" /><span className="skeleton w-[15%]" /><span className="skeleton ml-auto w-[10%]" />
        </div>
      ))}
    </div>
  );
}

function Dash() { return <span className="text-crm-sand-300">—</span>; }

/* Compact money for tiles: one decimal ($3.1M), unlike the 0-decimal shared helper. */

/* Due-date cell: overdue in danger, today in warn, otherwise tertiary. */
function Due({ iso }: { iso: string | null }) {
  if (!iso) return <span className="text-[12px] leading-4 text-crm-sand-400">No date</span>;
  const d = parseISO(iso);
  const today = isToday(d);
  const over = !today && isBefore(d, startOfDay(new Date()));
  return (
    <span className={cn("whitespace-nowrap text-[12px] leading-4 num", over ? "font-medium text-crm-danger-600" : today ? "font-medium text-crm-warn-700" : "text-crm-sand-500")}>
      {today ? "Today" : format(d, "MMM d")}
    </span>
  );
}

export default function DashboardPage() {
  const money = useMoney();
  const { yAxisMoneyProps, moneyTooltipFormatter } = useMoneyChartProps();
  const { settings } = useCrmContext();
  const compact = (n: number | null | undefined) => money(n, true, 1);
  const { user } = useAuth();
  const nav = useNavigate();
  const d = useQuery({ queryKey: ["dashboard"], queryFn: reportsApi.dashboard });
  const stale = useQuery({ queryKey: ["opps", "stale"], queryFn: () => oppsApi.list({ stale_only: true, limit: 8 }), select: (p) => p.items });

  const greeting = `Good ${new Date().getHours() < 12 ? "morning" : "afternoon"}, ${user?.full_name.split(" ")[0] ?? ""}`.trim();
  const title = <span className="text-[28px] leading-[34px] tracking-[-0.02em]">{greeting}</span>;

  if (d.isLoading || !d.data) {
    return (
      <div className="space-y-6">
        <PageHeader title={title} subtitle="Firm-wide business development snapshot" />
        <div className="grid grid-cols-2 gap-4 min-[960px]:grid-cols-3 min-[1280px]:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card min-h-[104px] px-5 pt-4 pb-3.5"><span className="skeleton w-2/5" /><span className="skeleton mt-4 h-6 w-3/5" /></div>
          ))}
        </div>
        <div className="card"><TableSkeleton /></div>
      </div>
    );
  }

  const k = d.data.kpis;
  const stages = d.data.pipeline.stages;
  const pipe = d.data.pipeline;
  const wl = d.data.win_loss;
  const asOf = format(new Date(), "MMM d, yyyy · h:mm a");

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        subtitle={<>Firm-wide business development snapshot<span className="mx-1.5 text-crm-sand-300">·</span>Data as of <span className="num">{asOf}</span></>}
      />

      {/* KPI row (§6.5). Deltas and sparklines are omitted until the payload carries prior-period values and trailing series
          for every tile — one tile with a spark reads as the odd one out, and stage amounts are not a time series. */}
      <div data-tour="kpis" className="grid grid-cols-2 items-stretch gap-4 min-[960px]:grid-cols-3 min-[1280px]:grid-cols-6">
        <Stat label="Open pipeline" value={compact(k.open_pipeline)} sub={plural(k.open_count ?? 0, "opportunity", "opportunities")} />
        <Stat label="Weighted pipeline" value={compact(k.weighted_pipeline)} sub="probability-adjusted" />
        <Stat label="Won QTD" value={compact(k.won_qtd)} delta={k.won_qtd_delta_pct} sub={`${plural(k.won_qtd_count ?? 0, "win", "wins")} · ${compact(k.won_mtd)} MTD${k.won_qtd_delta_pct != null ? " · vs. prior quarter to date" : ""}`} />
        <Stat label="Closing ≤ 30 days" value={compact(k.closing_30_amount)} sub={plural(k.closing_30_count ?? 0, "opportunity", "opportunities")} />
        <Stat label="Stale opportunities" value={num(k.stale_count)} sub={`no activity ≥ ${plural(settings.stale_opportunity_days, "day")}`} tone={k.stale_count ? "warn" : "default"} />
        <Stat label="Pending clearances" value={num(k.pending_clearances)} sub={`${plural(k.new_leads, "new lead")} · ${plural(k.clients, "client")}`} tone={k.pending_clearances ? "warn" : "default"} />
      </div>

      {/* Main row: 8 / 4 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <Card
          title="Pipeline by stage"
          tourId="pipeline-chart"
          className="lg:col-span-8"
          actions={<>
            <ChartLegend items={[{ label: "Amount", color: CHART.accent }, { label: "Weighted", color: CHART.accentSoft }]} />
            <Link to="/opportunities" className="ml-3 text-[12px] font-medium">Open board →</Link>
          </>}
        >
          <ChartFrame height={232}>
            <ResponsiveContainer>
              <BarChart data={stages} {...barChartProps}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="stage" {...xAxisProps} />
                <YAxis {...yAxisMoneyProps} />
                <Tooltip {...tooltipProps} formatter={moneyTooltipFormatter} />
                <Bar dataKey="amount" name="Amount" fill={CHART.accent} {...barProps} />
                <Bar dataKey="weighted" name="Weighted" fill={CHART.accentSoft} {...barProps} />
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>

          <div className="-mx-5 -mb-5 mt-4 overflow-hidden rounded-b-lg border-t border-crm-sand-150">
            <table className="tbl dense [&_td:first-child]:pl-5 [&_td:last-child]:pr-5 [&_th:first-child]:pl-5 [&_th:last-child]:pr-5">
              <thead><tr><th>Stage</th><th className="!text-right">Count</th><th className="!text-right">Amount</th><th className="!text-right">Weighted</th><th className="!text-right">Stale</th></tr></thead>
              <tbody>
                {stages.map((s) => (
                  <tr key={s.stage_id}>
                    <td>{s.stage}</td>
                    <td className="text-right num">{num(s.count)}</td>
                    <td className="text-right num font-medium">{money(s.amount)}</td>
                    <td className="text-right num font-medium">{money(s.weighted)}</td>
                    <td className="text-right num">{s.stale ? num(s.stale) : <Dash />}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="text-right num">{num(pipe.total_count)}</td>
                  <td className="text-right num">{money(pipe.total_amount)}</td>
                  <td className="text-right num">{money(pipe.total_weighted)}</td>
                  <td className="text-right num">{pipe.stale_count ? num(pipe.stale_count) : <Dash />}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>

        <div className="lg:col-span-4 flex flex-col gap-4">
          <Card title="My open tasks" actions={<Link to="/tasks" className="text-[12px] font-medium">All →</Link>}>
            {d.data.my_tasks.length === 0 ? (
              <div className="text-[12px] leading-4 text-crm-sand-500">No open tasks.</div>
            ) : (
              <ul className="-mt-2">
                {d.data.my_tasks.map((t) => {
                  const to = t.opportunity_id ? `/opportunities/${t.opportunity_id}` : t.account_id ? `/accounts/${t.account_id}` : "/tasks";
                  const high = t.priority === "high";
                  const meta = t.opportunity_name ?? t.account_name ?? null;
                  return (
                    <li key={t.id} className="grid grid-cols-[16px_1fr_auto] items-start gap-2.5 border-b border-crm-sand-100 py-2 last:border-b-0">
                      <span className="mt-0.5 h-4 w-4 rounded-[3px] border border-crm-sand-300 bg-crm-sand-0" aria-hidden />
                      <div className="min-w-0">
                        <button type="button" className="block w-full truncate text-left text-[13px] font-medium text-crm-sand-900 hover:underline" onClick={() => nav(to)}>{t.subject}</button>
                        {(high || meta) && (
                          <div className="flex min-w-0 items-center gap-1.5 text-[12px] leading-4 text-crm-sand-500">
                            {high && <Badge dot tone="danger">High</Badge>}
                            {meta && <span className="truncate">{meta}</span>}
                          </div>
                        )}
                      </div>
                      <div className="pt-0.5 text-right"><Due iso={t.due_at} /></div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card title="Win / loss" actions={<span className="text-crm-sand-500">Trailing 6 months</span>}>
            <div className="grid grid-cols-3 gap-3">
              <div><div className="text-[18px] leading-6 font-semibold tracking-[-0.015em] text-crm-success-600 num">{pct(wl.win_rate)}</div><div className="text-[12px] leading-4 text-crm-sand-500">Win rate</div></div>
              <div><div className="text-[18px] leading-6 font-semibold tracking-[-0.015em] num">{num(wl.won_count)}</div><div className="text-[12px] leading-4 text-crm-sand-500">Won</div></div>
              <div><div className="text-[18px] leading-6 font-semibold tracking-[-0.015em] num">{num(wl.lost_count)}</div><div className="text-[12px] leading-4 text-crm-sand-500">Lost</div></div>
            </div>
            <WinLossBar won={wl.won_count} lost={wl.lost_count} className="mt-3.5" />
            <div className="mt-2.5 flex justify-between text-[12px] leading-4 text-crm-sand-600">
              <span>Avg. won <b className="font-medium text-crm-sand-900 num">{money(wl.avg_won_amount)}</b></span>
              <span>Avg. <b className="font-medium text-crm-sand-900 num">{wl.avg_days_to_close == null ? "—" : plural(Math.round(wl.avg_days_to_close), "day")}</b> to close</span>
            </div>
          </Card>
        </div>
      </div>

      {/* Stale table */}
      <Card
        title="Stale opportunities"
        padded={false}
        actions={<span className="text-crm-sand-500">No activity in 21 or more days<span className="mx-1.5 text-crm-sand-300">·</span><span className="num">{num(k.stale_count)} of {num((k.open_count ?? 0))}</span></span>}
      >
        {stale.isLoading ? <TableSkeleton /> : !stale.data?.length ? <Empty title="No stale opportunities" hint={`Every open pursuit has had activity in the last ${plural(settings.stale_opportunity_days, "day")}.`} /> : (
          <>
            <table className="tbl [&_td:first-child]:pl-5 [&_td:last-child]:pr-5 [&_th:first-child]:pl-5 [&_th:last-child]:pr-5">
              <thead>
                <tr>
                  <th className="min-w-[240px]">Opportunity</th><th>Account</th><th className="w-[140px]">Stage</th><th className="w-[160px]">Owner</th>
                  <th className="w-[128px] !text-right">Amount</th><th className="!text-right">Days in stage</th><th className="w-[120px] !text-right">Last activity</th>
                </tr>
              </thead>
              <tbody>
                {stale.data.map((o) => (
                  <tr key={o.id} className="clickable" onClick={() => nav(`/opportunities/${o.id}`)}>
                    <td className="font-medium"><div className="max-w-[380px] truncate" title={o.name}>{o.name}</div></td>
                    <td className="whitespace-nowrap"><div className="max-w-[220px] truncate">{o.account_name}</div></td>
                    <td><Badge dot tone={o.clearance_status === "pending" ? "warn" : "info"}>{o.stage_name}</Badge></td>
                    <td className="whitespace-nowrap">{o.owner_name}</td>
                    <td className="whitespace-nowrap text-right num font-medium">{money(o.amount)}</td>
                    <td className={cn("text-right num", o.days_in_stage >= 21 && "font-medium text-crm-warn-700")}>{num(o.days_in_stage)}</td>
                    <td className="whitespace-nowrap text-right num text-crm-sand-600">{fmtDate(o.last_activity_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex h-11 items-center justify-between border-t border-crm-sand-150 px-5 text-[12px] leading-4 text-crm-sand-500">
              <span className="num">1–{stale.data.length} of {num(k.stale_count)}</span>
              <Link to="/opportunities" className="font-medium">View all opportunities →</Link>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
