'use client'

import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Building2, Users, Target, Kanban, ShieldCheck, ShieldUser, Briefcase, Megaphone, BarChart3, Settings, LayoutDashboard, CheckSquare, Database, Search, Receipt } from 'lucide-react'
import { useDashboardModuleChrome } from '@/components/layout/dashboard-module-chrome'
import { Link, useLocation, useNavigate } from '../../lib/navigation'
import { useAuth, useCrmContext } from '../../lib/auth'
import { useQuery } from '../../lib/query'
import { accountsApi, contactsApi, oppsApi } from '../../api'

const NAV = [
  ['/', 'Dashboard', LayoutDashboard], ['/tasks', 'My tasks', CheckSquare], ['/leads', 'Leads', Target],
  ['/opportunities', 'Opportunities', Kanban], ['/clearance', 'Clearance', ShieldCheck], ['/engagements', 'Engagements', Briefcase],
  ['/billing', 'Billing', Receipt], ['/accounts', 'Accounts', Building2], ['/contacts', 'Contacts', Users], ['/campaigns', 'Campaigns', Megaphone],
  ['/reports', 'Reports', BarChart3], ['/data', 'Data', Database], ['/admin', 'Administration', ShieldUser], ['/settings', 'Settings', Settings],
] as const
export default function Shell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const { atLeast } = useAuth()
  const { firm_name } = useCrmContext()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const search = useQuery({ queryKey: ['search', q], enabled: q.trim().length >= 2, queryFn: async () => {
    const [accounts, contacts, opportunities] = await Promise.all([accountsApi.list({q,limit:5}), contactsApi.list({q,limit:5}), oppsApi.list({q,limit:5,status:'all'})])
    return [...accounts.items.map(a=>({name:a.name,path:`/accounts/${a.id}`})), ...contacts.items.map(c=>({name:c.full_name,path:`/contacts/${c.id}`})), ...opportunities.items.map(o=>({name:o.name,path:`/opportunities/${o.id}`}))]
  } })
  const label = NAV.find(([path]) => path === pathname || (path !== '/' && pathname.startsWith(`${path}/`)))?.[1] ?? 'Record'
  const chrome = useMemo(() => ({ breadcrumbs: [{label:'FirmCRM',href:'/dashboard/firmcrm'},{label}], openCommandPalette: () => input.current?.focus() }), [label])
  useDashboardModuleChrome(chrome)
  return <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden lg:flex-row">
    <aside className="w-full shrink-0 border-b border-crm-sand-150 p-3 lg:w-[210px] lg:overflow-y-auto lg:border-b-0 lg:border-r">
      <div className="px-2 py-3"><div className="text-lg font-semibold">FirmCRM</div><div className="truncate text-xs text-crm-sand-600">{firm_name}</div></div>
      <nav aria-label="FirmCRM" className="flex gap-1 overflow-x-auto lg:flex-col">{NAV.filter(([path]) => !['/data','/admin'].includes(path) || atLeast('manager')).map(([path,name,Icon]) => <Link key={path} to={path} aria-current={pathname === path ? 'page' : undefined} className={`flex shrink-0 items-center gap-2 rounded-crm-md px-3 py-2 text-[13px] hover:no-underline ${pathname === path || (path !== '/' && pathname.startsWith(`${path}/`)) ? 'bg-crm-sand-100 font-semibold text-crm-sand-900' : 'text-crm-sand-600 hover:bg-crm-sand-100'}`}><Icon size={16} strokeWidth={1.5}/>{name}</Link>)}</nav>
    </aside>
    <main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 lg:p-6">
      <div className="mb-6 flex items-center justify-end gap-3"><div className="relative w-[320px] max-w-[70%]"><Search size={14} className="absolute left-2 top-2 text-crm-sand-500"/><input ref={input} className="field pl-7" value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>{if(e.key==='Escape')setQ('')}} aria-label="Search CRM" placeholder="Search accounts, contacts, opportunities…"/>{q.trim().length >= 2 && <div className="absolute right-0 z-crm-dropdown mt-1 w-full rounded-crm-md border border-crm-sand-150 bg-crm-sand-0 shadow-crm-menu">{search.isPending ? <p className="p-3">Searching…</p> : search.isError ? <p className="p-3" role="alert">{search.error.message}</p> : !search.data?.length ? <p className="p-3">No matches</p> : search.data.map(item=><button key={item.path} className="block w-full truncate px-3 py-2 text-left hover:bg-crm-sand-50" onClick={()=>{setQ('');nav(item.path)}}>{item.name}</button>)}</div>}</div></div>
      {children}
    </main>
  </div>
}
