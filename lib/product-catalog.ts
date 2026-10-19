import type { LucideIcon } from 'lucide-react'
import {
  BarChart3,
  Building2,
  Bot,
  Clock3,
  FileCheck2,
  FileSearch2,
  FileSignature,
  Files,
  FolderKanban,
  Globe2,
  GraduationCap,
  Mic,
  PenTool,
} from 'lucide-react'

export type ProductGroupId =
  | 'document-intelligence'
  | 'knowledge-work'
  | 'practice-operations'
  | 'analytics'

export type ProductAccessStrategy =
  | 'available'
  | 'paid-plan'
  | 'pro-plan'
  | 'analytics-setup'
  | 'claw-activation'
  | 'free'

export interface ProductGroup {
  id: ProductGroupId
  name: string
  description: string
  number: string
}

export interface ProductCatalogItem {
  id: string
  name: string
  description: string
  icon: LucideIcon
  groupId: ProductGroupId
  appHref: string
  marketingHref: string
  routePrefixes: string[]
  accessStrategy: ProductAccessStrategy
}

export const PRODUCT_GROUPS: ProductGroup[] = [
  {
    id: 'document-intelligence',
    name: 'Document intelligence',
    description: 'Turn source files into structured, reviewed, actionable work.',
    number: '01',
  },
  {
    id: 'knowledge-work',
    name: 'Knowledge work',
    description: 'Draft, research, and deliver with evidence attached.',
    number: '02',
  },
  {
    id: 'practice-operations',
    name: 'Practice operations',
    description: 'Coordinate teams, time, tasks, signatures, client requests, and learning.',
    number: '03',
  },
  {
    id: 'analytics',
    name: 'Analytics and intelligence',
    description: 'Investigate performance, reconcile data, and monitor changing rules.',
    number: '04',
  },
]

export const PRODUCT_CATALOG: ProductCatalogItem[] = [
  {
    id: 'firmcrm',
    name: 'FirmCRM',
    description: 'Client relationships, pursuits, clearance, and firm growth.',
    icon: Building2,
    groupId: 'practice-operations',
    appHref: '/dashboard/firmcrm',
    marketingHref: '/features#practice-operations',
    routePrefixes: ['/dashboard/firmcrm'],
    accessStrategy: 'pro-plan',
  },
  {
    id: 'uda',
    name: 'Universal Document Analysis',
    description: 'Extract, validate, and automate work from complex documents.',
    icon: FileSearch2,
    groupId: 'document-intelligence',
    appHref: '/dashboard/uda',
    marketingHref: '/features#document-intelligence',
    routePrefixes: [
      '/dashboard/uda',
      '/dashboard/jobs',
      '/dashboard/templates',
      '/dashboard/integrations',
      '/dashboard/automations',
    ],
    accessStrategy: 'available',
  },
  {
    id: 'form-fill',
    name: 'Form Fill',
    description: 'Move source data into PDF and Word forms with AI.',
    icon: Files,
    groupId: 'document-intelligence',
    appHref: '/dashboard/form-fill',
    marketingHref: '/features#document-intelligence',
    routePrefixes: ['/dashboard/form-fill'],
    accessStrategy: 'available',
  },
  {
    id: 'inkwise',
    name: 'Inkwise',
    description: 'Draft grounded professional writing with citations.',
    icon: PenTool,
    groupId: 'knowledge-work',
    appHref: '/dashboard/inkwise',
    marketingHref: '/features#knowledge-work',
    routePrefixes: ['/dashboard/inkwise'],
    accessStrategy: 'available',
  },
  {
    id: 'speech2write',
    name: 'Speech2Write',
    description: 'Private, on-device voice dictation for your Mac.',
    icon: Mic,
    groupId: 'knowledge-work',
    appHref: '/speech2write',
    marketingHref: '/speech2write',
    routePrefixes: ['/speech2write'],
    accessStrategy: 'free',
  },
  {
    id: 'tasklytic',
    name: 'Tasklytic',
    description: 'Projects, forms, time, reporting, and team coordination.',
    icon: FolderKanban,
    groupId: 'practice-operations',
    appHref: '/dashboard/project-management',
    marketingHref: '/features#practice-operations',
    routePrefixes: ['/dashboard/project-management'],
    accessStrategy: 'paid-plan',
  },
  {
    id: 'pbc',
    name: 'Prepared by Client',
    description: 'Secure request lists, evidence collection, and review.',
    icon: FileCheck2,
    groupId: 'document-intelligence',
    appHref: '/dashboard/pbc',
    marketingHref: '/features#knowledge-work',
    routePrefixes: ['/dashboard/pbc'],
    accessStrategy: 'available',
  },
  {
    id: 'esign',
    name: 'E-Signature',
    description: 'Prepare, send, sign, and verify documents.',
    icon: FileSignature,
    groupId: 'practice-operations',
    appHref: '/dashboard/esign',
    marketingHref: '/features#practice-operations',
    routePrefixes: ['/dashboard/esign'],
    accessStrategy: 'available',
  },
  {
    id: 'chrona',
    name: 'Chrona',
    description: 'Reconstruct billable work without manual timers.',
    icon: Clock3,
    groupId: 'practice-operations',
    appHref: '/dashboard/analytics/chrona',
    marketingHref: '/features#practice-operations',
    routePrefixes: ['/dashboard/analytics/chrona'],
    accessStrategy: 'available',
  },
  {
    id: 'analytics-suite',
    name: 'AI Analytics Suite',
    description: 'Variance, reconciliation, fixed assets, and research bots.',
    icon: BarChart3,
    groupId: 'analytics',
    appHref: '/dashboard/analytics',
    marketingHref: '/features#analytics',
    routePrefixes: ['/dashboard/analytics'],
    accessStrategy: 'analytics-setup',
  },
  {
    id: 'taxatlas',
    name: 'TaxAtlas',
    description: 'Global tax rates, law, tariffs, and change monitoring.',
    icon: Globe2,
    groupId: 'analytics',
    appHref: '/dashboard/taxatlas',
    marketingHref: '/features#analytics',
    routePrefixes: ['/dashboard/taxatlas'],
    accessStrategy: 'paid-plan',
  },
  {
    id: 'claw-series',
    name: 'Claw Series',
    description: 'Deployable AI digital workers for accounting and legal work.',
    icon: Bot,
    groupId: 'knowledge-work',
    appHref: '/dashboard/activation',
    marketingHref: '/claw',
    routePrefixes: ['/dashboard/activation'],
    accessStrategy: 'claw-activation',
  },
  {
    id: 'cpe-tracker',
    name: 'CPE Tracker',
    description: 'Track continuing professional education at no cost.',
    icon: GraduationCap,
    groupId: 'practice-operations',
    appHref: '/dashboard/cpe-tracker',
    marketingHref: '/dashboard/cpe-tracker',
    routePrefixes: ['/dashboard/cpe-tracker'],
    accessStrategy: 'free',
  },
]

function matchesRoutePrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

const PRODUCT_ROUTE_MATCHERS = PRODUCT_CATALOG.flatMap((product) =>
  product.routePrefixes.map((prefix) => ({ prefix, product })),
).sort((left, right) => right.prefix.length - left.prefix.length)

export function getProductById(productId: string) {
  return PRODUCT_CATALOG.find((product) => product.id === productId) ?? null
}

export function getProductForPathname(pathname: string) {
  return PRODUCT_ROUTE_MATCHERS.find(({ prefix }) => matchesRoutePrefix(pathname, prefix))?.product ?? null
}

export function isImmersiveDashboardPath(pathname: string) {
  return (
    pathname.startsWith('/dashboard/esign/sign/') ||
    /\/dashboard\/esign\/[^/]+\/(prepare|fields|review|documents|recipients)$/.test(pathname) ||
    /\/dashboard\/esign\/templates\/[^/]+/.test(pathname)
  )
}
