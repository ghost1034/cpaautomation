'use client'

import * as React from 'react'
import { ChevronLeft, ChevronRight, Download, Eye, EyeOff, Loader2, Search, TableProperties } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useAdmin } from './admin-context'

interface ColumnInfo {
  name: string
  type: string
  nullable: boolean
  primary_key: boolean
  redacted: boolean
}

interface TableResponse {
  table: string
  columns: ColumnInfo[]
  rows: Record<string, unknown>[]
  page: number
  limit: number
  total: number
  pages: number
}

const STATUS_STYLES: Record<string, string> = {
  completed: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  complete: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  succeeded: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  processing: 'bg-blue-50 text-blue-700 ring-blue-600/20',
  running: 'bg-blue-50 text-blue-700 ring-blue-600/20',
  pending: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  draft: 'bg-slate-100 text-slate-700 ring-slate-500/20',
  failed: 'bg-red-50 text-red-700 ring-red-600/20',
  error: 'bg-red-50 text-red-700 ring-red-600/20',
  revoked: 'bg-red-50 text-red-700 ring-red-600/20',
}

function displayValue(value: unknown) {
  if (value === null || value === undefined) return <span className="text-slate-300">—</span>
  if (typeof value === 'boolean') return <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset', value ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' : 'bg-slate-100 text-slate-600 ring-slate-500/20')}>{value ? 'True' : 'False'}</span>
  if (typeof value === 'object') return <code className="block max-w-[320px] truncate text-[11px] text-slate-600">{JSON.stringify(value)}</code>
  const text = String(value)
  const statusStyle = STATUS_STYLES[text.toLowerCase()]
  if (statusStyle) return <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset', statusStyle)}>{text.replace(/_/g, ' ')}</span>
  if (text === '[redacted]') return <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-400"><EyeOff className="size-3" />Redacted</span>
  return <span className="block max-w-[340px] truncate" title={text}>{text}</span>
}

export function AdminDataTable({ tableName }: { tableName: string }) {
  const { download, request } = useAdmin()
  const [data, setData] = React.useState<TableResponse | null>(null)
  const [page, setPage] = React.useState(1)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState('')
  const [search, setSearch] = React.useState('')
  const [debouncedSearch, setDebouncedSearch] = React.useState('')
  const [showSchema, setShowSchema] = React.useState(false)
  const activeSearch = debouncedSearch.trim()

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 300)
    return () => window.clearTimeout(timer)
  }, [search])

  React.useEffect(() => {
    setSearch('')
    setDebouncedSearch('')
  }, [tableName])

  React.useEffect(() => setPage(1), [tableName, activeSearch])

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    const params = new URLSearchParams({ page: String(page), limit: '50' })
    if (activeSearch) params.set('search', activeSearch)
    request<TableResponse>(`/api/admin/console/tables/${encodeURIComponent(tableName)}?${params}`)
      .then((result) => { if (!cancelled) setData(result) })
      .catch((fetchError) => { if (!cancelled) setError(fetchError instanceof Error ? fetchError.message : 'Could not load table') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [activeSearch, page, request, tableName])

  const exportTable = async () => {
    const response = await download(`/api/admin/console/tables/${encodeURIComponent(tableName)}/export`)
    const url = URL.createObjectURL(await response.blob())
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${tableName}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-900/[0.03]">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 md:flex-row md:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><TableProperties className="size-4 text-blue-600" /><h2 className="truncate font-mono text-sm font-semibold text-slate-900">{tableName}</h2>{data && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] tabular-nums text-slate-600">{data.total.toLocaleString()} {activeSearch ? 'matching ' : ''}rows</span>}</div>
          {data && <p className="mt-1 text-xs text-slate-400">{data.columns.length} columns · newest records first</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1 md:flex-none"><Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search all rows…" aria-label="Search table rows" className="h-9 pl-8 text-xs md:w-56" /></div>
          <Button variant="outline" size="sm" className="h-9 text-xs" onClick={() => setShowSchema((value) => !value)}><Eye className="size-3.5" />Schema</Button>
          <Button variant="outline" size="sm" className="h-9 text-xs" onClick={() => void exportTable()}><Download className="size-3.5" />CSV</Button>
        </div>
      </div>

      {showSchema && data && <div className="border-b border-slate-200 bg-slate-50/70 px-5 py-4"><div className="flex flex-wrap gap-2">{data.columns.map((column) => <div key={column.name} className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] shadow-sm"><span className="font-mono font-medium text-slate-800">{column.name}</span><span className="ml-2 text-slate-400">{column.type.toLowerCase()}</span>{column.primary_key && <span className="ml-1 text-blue-600">PK</span>}{column.redacted && <EyeOff className="ml-1 inline size-3 text-amber-500" />}</div>)}</div></div>}

      {loading ? <div className="flex h-72 items-center justify-center"><Loader2 className="size-5 animate-spin text-slate-400" /></div> : error ? <div className="flex h-72 flex-col items-center justify-center px-6 text-center"><p className="font-medium text-slate-800">This table could not be loaded</p><p className="mt-1 text-sm text-slate-500">{error}</p></div> : !data || data.rows.length === 0 ? <div className="flex h-72 flex-col items-center justify-center text-center"><TableProperties className="size-7 text-slate-300" />{activeSearch ? <><p className="mt-3 text-sm font-medium text-slate-700">No rows match “{activeSearch}”</p><p className="mt-1 text-xs text-slate-400">Redacted fields are not searchable.</p></> : <><p className="mt-3 text-sm font-medium text-slate-700">No records in this table</p><p className="mt-1 text-xs text-slate-400">The schema is available even when the table is empty.</p></>}</div> : <div className="overflow-x-auto"><table className="w-full min-w-max border-collapse text-left text-xs"><thead><tr className="border-b border-slate-200 bg-slate-50/60">{data.columns.map((column) => <th key={column.name} className="whitespace-nowrap px-4 py-3 font-medium text-slate-500"><span>{column.name}</span>{column.primary_key && <span className="ml-1.5 rounded bg-blue-50 px-1 py-0.5 text-[9px] font-semibold text-blue-600">PK</span>}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{data.rows.map((row, index) => <tr key={String(row.id ?? index)} className="hover:bg-blue-50/30">{data.columns.map((column) => <td key={column.name} className="max-w-[360px] whitespace-nowrap px-4 py-3 text-slate-600">{displayValue(row[column.name])}</td>)}</tr>)}</tbody></table></div>}

      {data && data.total > 0 && <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3 text-xs text-slate-500"><p>Showing {((data.page - 1) * data.limit + 1).toLocaleString()}–{Math.min(data.page * data.limit, data.total).toLocaleString()} of {data.total.toLocaleString()}</p><div className="flex items-center gap-2"><span className="mr-1 tabular-nums">Page {data.page} of {data.pages}</span><Button variant="outline" size="icon" className="size-8" disabled={data.page <= 1 || loading} onClick={() => setPage((value) => value - 1)}><ChevronLeft className="size-3.5" /></Button><Button variant="outline" size="icon" className="size-8" disabled={data.page >= data.pages || loading} onClick={() => setPage((value) => value + 1)}><ChevronRight className="size-3.5" /></Button></div></div>}
    </section>
  )
}
