import {
  BookOpen, BrainCircuit, Building2, CheckSquare, CreditCard, Database,
  FileSearch2, FileStack, FolderOpen, Kanban, ListTodo, LockKeyhole, Mail,
  Network, NotebookPen, ScanSearch, Scale, Send, Settings2, ShieldCheck,
  Users, Workflow,
} from 'lucide-react'

export const HOME_SECTIONS = [
  ['about-section', 'Who we are'], ['values-section', 'Values'],
  ['service-section', 'Capabilities'], ['process-section', 'Process'],
  ['project-section', 'In practice'], ['integrations-section', 'Integrations'],
  ['testimonials-section', 'Professional voices'], ['pricing-section', 'Pricing'],
  ['team-section', 'People'], ['FAQ-section', 'FAQs'],
] as const

export const HOME_VALUES = [
  { icon: Scale, title: 'Domain-native by design', body: 'Built around the standards, evidence, and review cycles of professional work.' },
  { icon: LockKeyhole, title: 'Your data stays yours', body: 'Encryption, US-based infrastructure, and no customer-data training.' },
  { icon: Workflow, title: 'One connected platform', body: 'Start with one workflow. Connect the rest without adding another point solution.' },
]

export const HOME_CAPABILITIES = [
  { title: 'Document intelligence.', body: 'Extract, validate, and route information from complex financial and legal documents.', image: 'cap1.png', products: ['Universal Document Analysis', 'Form Fill', 'Prepared by Client'], href: '/features#document-intelligence' },
  { title: 'Knowledge work.', body: 'Dictate ideas and ground your writing in sources.', image: 'cap5.png', products: ['Inkwise', 'Speech2Write'], href: '/features#knowledge-work' },
  { title: 'AI analytics.', body: 'Bring structure to reconciliations, reporting, research, and tax decisions.', image: 'cap3.png', products: ['AI Analytics Suite', 'TaxAtlas'], href: '/features#analytics' },
  { title: 'Practice operations.', body: 'Keep your projects, time, signatures, evidence, and professional learning moving.', image: 'cap5.png', products: ['FirmCRM', 'Tasklytic', 'Chrona', 'E-Signature', 'CPE Tracker'], href: '/features#practice-operations' },
  { title: 'AI digital workers.', body: 'Bring repeatable professional workflows to deployable, purpose-built agents.', image: 'cap1.png', products: ['Claw Series'], href: '/claw' },
]

export const HOME_SECURITY = [
  ['cap-20data-201.svg', 'Encryption in transit & at rest'],
  ['cap-20data-202.svg', 'Secure integrations'],
  ['cap-20data-203.svg', 'Role-based access'],
  ['cap-20data-204.svg', 'No shared-model training'],
] as const

export const HOME_STEPS = [
  { icon: FileStack, title: 'Bring the work', body: 'Upload documents, connect a source, or start with a professional workflow.' },
  { icon: Settings2, title: 'Set the standard', body: 'Choose the fields, rules, evidence, and review points that matter.' },
  { icon: BrainCircuit, title: 'Put AI to work', body: 'Let the platform handle extraction, drafting, coordination, or analysis.' },
  { icon: ScanSearch, title: 'Review with confidence', body: 'Check the results and keep professional judgment in the loop.' },
  { icon: Send, title: 'Deliver and repeat', body: 'Export, sign, share, or automate the next run of your workflow.' },
]

export const HOME_PROOF = [
  { title: 'Investment statements, transformed.', label: 'Customer story · Leonardo Family Office', body: 'Quarterly processing across more than 100 portfolio companies, reduced from three days to two hours.', image: 'caseimg1.png', href: '/case-study/LFO', linkLabel: 'Read the case study', metrics: [['95%', 'time reduction'], ['100+', 'portfolio companies'], ['200+', 'hours saved annually']] },
  { title: 'From statements to a finished P&L.', label: 'Product demonstration · Document Analysis', body: 'See source financial documents become a structured profit-and-loss report with Universal Document Analysis.', image: 'case2.png', href: '/demo', linkLabel: 'Watch the demonstrations', videoId: 'tNwpajJZ8zA', metrics: [['Extract', 'source data'], ['Review', 'the results'], ['Export', 'finished work']] },
  { title: 'Grounded writing. Ready for review.', label: 'Product demonstration · Inkwise', body: 'Turn source material into a professional investor report with an AI-assisted writing workflow.', image: 'case3.png', href: '/demo', linkLabel: 'Explore Inkwise demos', videoId: 'OaloCO7Bh28', metrics: [['Sources', 'in context'], ['Drafts', 'with evidence'], ['Review', 'before delivery']] },
]

// Curated OpenConnector providers verified against src/providers/*/definition.ts:
// https://github.com/oomol-lab/open-connector/tree/07167b2b49c94cae8b4e69f08d6a859bcb3d60ce/src/providers
// Keep broker-backed providers distinct from native connections and file formats.
// Catalog presence does not imply that a provider's credentials/OAuth are configured.
export const HOME_INTEGRATIONS = [
  { name: 'Google Drive', detail: 'Import & export', icon: FileStack },
  { name: 'Gmail', detail: 'Attachment workflows', icon: Send },
  { name: 'Slack', detail: 'Hosted Claw', icon: Network },
  { name: 'Dropbox', detail: 'OpenConnector', icon: FolderOpen },
  { name: 'Box', detail: 'OpenConnector', icon: FileStack },
  { name: 'Outlook', detail: 'OpenConnector', icon: Mail },
  { name: 'NetSuite', detail: 'OpenConnector', icon: Building2 },
  { name: 'Xero', detail: 'OpenConnector', icon: BookOpen },
  { name: 'Stripe', detail: 'OpenConnector', icon: CreditCard },
  { name: 'HubSpot', detail: 'OpenConnector', icon: Users },
  { name: 'Airtable', detail: 'OpenConnector', icon: Database },
  { name: 'Notion', detail: 'OpenConnector', icon: NotebookPen },
  { name: 'Asana', detail: 'OpenConnector', icon: CheckSquare },
  { name: 'Trello', detail: 'OpenConnector', icon: Kanban },
  { name: 'ClickUp', detail: 'OpenConnector', icon: ListTodo },
  { name: 'Microsoft Excel', detail: 'File exports', icon: FileSearch2 },
  { name: 'Google Sheets', detail: 'Exported data', icon: Workflow },
  { name: 'PDF & Word', detail: 'Document workflows', icon: ShieldCheck },
]

// Each provider appears in one row; only the animation's seamless copy repeats it.
const integrationsPerRow = Math.ceil(HOME_INTEGRATIONS.length / 3)
export const HOME_INTEGRATION_ROWS = Array.from({ length: 3 }, (_, row) =>
  HOME_INTEGRATIONS.slice(row * integrationsPerRow, (row + 1) * integrationsPerRow),
)

// Existing published customer copy, restored from the pre-redesign homepage.
// Abbreviated identities must remain abbreviated; no stock portrait is assigned.
export const HOME_QUOTES = [
  { name: 'A*** Manufacturing', role: 'D*** Wilton · Supply Chain Director', quote: 'We process thousands of supplier certifications, quality reports, and invoices monthly. The custom extraction feature lets us automatically categorize materials by grade and extract compliance codes for our procurement system.' },
  { name: 'S****** Ventures', role: 'J*** Park · Partner', quote: 'We evaluate hundreds of companies quarterly. Extracting financial metrics, revenue breakdowns, and key performance indicators from pitch decks and financial statements used to take weeks. Now it’s literally done in minutes.' },
  { name: 'N********** Technologies', role: 'A*** Kumar · CLO', quote: 'Our legal team reviews hundreds of vendor agreements monthly. We now extract key terms, pricing structures, and SLA commitments automatically. What used to take 3 hours per contract now takes two minutes.' },
  { kind: 'validation', name: 'Rae Stewart', role: 'Professional validation · Accounting', initials: 'RS', quote: 'Provided extensive validation of our extraction algorithms for healthcare-industry financial documents and compliance requirements.' },
  { kind: 'validation', name: 'Ray Sang', role: 'Professional validation · Finance systems', image: '/ray.jpg', quote: 'Validated our platform’s ability to handle complex technology-sector financial processes and automation workflows.' },
]

export const HOME_PEOPLE = [
  { name: 'Ian Stewart', role: 'Founder & engineer', image: '/ian.jpg', href: 'mailto:ianstewart@cpaautomation.ai', action: 'Contact Ian' },
  { name: 'Ray Sang', role: 'Co-founder & finance systems', image: '/ray.jpg', href: 'mailto:raysang@cpaautomation.ai', action: 'Contact Ray' },
]

export const HOME_FAQS = [
  ['Who is CPAAutomation for?', 'Accounting, finance, and legal professionals who need reliable automation without rebuilding their practice around a generic AI tool.'],
  ['Do I need technical training?', 'No. The products follow familiar professional workflows and are designed to be useful without prompt engineering or custom development.'],
  ['Does CPAAutomation train on customer data?', 'No. Customer data is not used to train shared AI models. Security controls include encryption in transit and at rest.'],
  ['Can I start for free?', 'Yes. Start with the free plan and compare available capacity and features on our pricing page.'],
  ['Can your team build a custom workflow?', 'Yes. Forward-Deployed Consulting embeds technical and business expertise to scope and ship custom AI software.'],
] as const
