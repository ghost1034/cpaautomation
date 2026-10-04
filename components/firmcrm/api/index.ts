import { del, download, get, patch, post, postForm } from "./client";
import type * as T from "./types";

type Q = Record<string, string | number | boolean | undefined>;

export const usersApi = {
  list: (include_inactive = false) => get<T.User[]>("/users", { include_inactive }),
  update: (id: string, body: Partial<T.User>) => patch<T.User>(`/users/${id}`, body),
};
export const refApi = {
  practiceAreas: (active_only = false) => get<T.PracticeArea[]>("/practice-areas", active_only ? { active_only: true } : undefined),
  createPracticeArea: (b: Omit<T.PracticeArea, "id">) => post<T.PracticeArea>("/practice-areas", b),
  updatePracticeArea: (id: number, b: Omit<T.PracticeArea, "id">) => patch<T.PracticeArea>(`/practice-areas/${id}`, b),
  pipelines: () => get<T.Pipeline[]>("/pipelines"),
  updateStage: (id: number, b: Omit<T.Stage, "id" | "pipeline_id">) => patch<T.Stage>(`/stages/${id}`, b),
  addStage: (pipelineId: number, b: Omit<T.Stage, "id" | "pipeline_id">) => post<T.Stage>(`/pipelines/${pipelineId}/stages`, b),
  deleteStage: (id: number) => del(`/stages/${id}`),
};
export const accountsApi = {
  list: (p?: Q) => get<T.Page<T.Account>>("/accounts", p),
  get: (id: number) => get<T.Account>(`/accounts/${id}`),
  duplicates: (name: string) => get<T.Account[]>("/accounts/duplicates", { name }),
  create: (b: Partial<T.Account> & { allow_duplicate?: boolean }) => post<T.Account>("/accounts", b),
  update: (id: number, b: Partial<T.Account>) => patch<T.Account>(`/accounts/${id}`, b),
  archive: (id: number) => post<T.Account>(`/accounts/${id}/archive`),
  restore: (id: number) => post<T.Account>(`/accounts/${id}/restore`),
  purge: (id: number) => del(`/accounts/${id}`),
};
export const contactsApi = {
  list: (p?: Q) => get<T.Page<T.Contact>>("/contacts", p),
  get: (id: number) => get<T.Contact>(`/contacts/${id}`),
  create: (b: Partial<T.Contact>) => post<T.Contact>("/contacts", b),
  update: (id: number, b: Partial<T.Contact>) => patch<T.Contact>(`/contacts/${id}`, b),
  archive: (id: number) => post<T.Contact>(`/contacts/${id}/archive`),
  restore: (id: number) => post<T.Contact>(`/contacts/${id}/restore`),
};
export const leadsApi = {
  list: (p?: Q) => get<T.Page<T.Lead>>("/leads", p),
  get: (id: number) => get<T.Lead>(`/leads/${id}`),
  create: (b: Partial<T.Lead>) => post<T.Lead>("/leads", b),
  update: (id: number, b: Partial<T.Lead>) => patch<T.Lead>(`/leads/${id}`, b),
  convert: (id: number, b: { existing_account_id?: number | null; create_opportunity: boolean; opportunity_name?: string; amount?: number | null; expected_close?: string | null }) =>
    post<{ account_id: number; contact_id: number; opportunity_id: number | null }>(`/leads/${id}/convert`, b),
  archive: (id: number) => post<T.Lead>(`/leads/${id}/archive`),
  restore: (id: number) => post<T.Lead>(`/leads/${id}/restore`),
};
export const oppsApi = {
  list: (p?: Q) => get<T.Page<T.Opportunity>>("/opportunities", p),
  get: (id: number) => get<T.Opportunity>(`/opportunities/${id}`),
  create: (b: Partial<T.Opportunity>) => post<T.Opportunity>("/opportunities", b),
  update: (id: number, b: Partial<T.Opportunity>) => patch<T.Opportunity>(`/opportunities/${id}`, b),
  stage: (id: number, b: { stage_id: number; lost_reason?: string; competitor?: string; note?: string }) => post<T.Opportunity>(`/opportunities/${id}/stage`, b),
  reopen: (id: number, stage_id: number) => post<T.Opportunity>(`/opportunities/${id}/reopen`, { stage_id }),
  history: (id: number) => get<T.StageHistory[]>(`/opportunities/${id}/history`),
  archive: (id: number) => post<T.Opportunity>(`/opportunities/${id}/archive`),
  restore: (id: number) => post<T.Opportunity>(`/opportunities/${id}/restore`),
  purge: (id: number) => del(`/opportunities/${id}`),
};
export const activitiesApi = {
  list: (p?: Q) => get<T.Page<T.Activity>>("/activities", p),
  create: (b: Partial<T.Activity>) => post<T.Activity>("/activities", b),
  update: (id: number, b: Partial<T.Activity> & { completed?: boolean }) => patch<T.Activity>(`/activities/${id}`, b),
  remove: (id: number) => del(`/activities/${id}`),
};
export const conflictsApi = {
  search: (parties: string[]) => post<T.ConflictMatch[]>("/conflict-checks/search", { parties }),
  list: (p?: Q) => get<T.Page<T.ConflictCheck>>("/conflict-checks", p),
  run: (b: { check_type: string; opportunity_id?: number | null; account_id?: number | null; parties: string[]; independence_attestation?: Record<string, boolean> | null }) =>
    post<T.ConflictCheck>("/conflict-checks", b),
  resolve: (id: number, b: { status: string; resolution_note?: string }) => post<T.ConflictCheck>(`/conflict-checks/${id}/resolve`, b),
};
export const engagementsApi = {
  list: (p?: Q) => get<T.Page<T.Engagement>>("/engagements", p),
  update: (id: number, b: Partial<T.Engagement>) => patch<T.Engagement>(`/engagements/${id}`, b),
};
export const billingApi = {
  profiles: (include_archived = false) => get<T.BillingProfile[]>("/billing/profiles", include_archived ? { include_archived } : undefined),
  createProfile: (b: T.BillingProfileInput) => post<T.BillingProfile>("/billing/profiles", b),
  updateProfile: (id: number, b: Partial<T.BillingProfileInput>) => patch<T.BillingProfile>(`/billing/profiles/${id}`, b),
  archiveProfile: (id: number) => post<T.BillingProfile>(`/billing/profiles/${id}/archive`),
  invoices: (p?: Q) => get<T.Page<T.Invoice>>("/billing/invoices", p),
  prefill: (p: { account_id: number } | { engagement_id: number }) => get<T.InvoicePrefill>("/billing/invoices/prefill", p),
  invoice: (id: number) => get<T.Invoice>(`/billing/invoices/${id}`),
  create: (b: T.InvoiceInput) => post<T.Invoice>("/billing/invoices", b),
  update: (id: number, b: Partial<T.InvoiceInput>) => patch<T.Invoice>(`/billing/invoices/${id}`, b),
  remove: (id: number) => del(`/billing/invoices/${id}`),
  issue: (id: number) => post<T.Invoice>(`/billing/invoices/${id}/issue`),
  send: (id: number, b: T.InvoiceSend) => post<T.InvoiceDelivery>(`/billing/invoices/${id}/send`, b),
  markPaid: (id: number) => post<T.Invoice>(`/billing/invoices/${id}/mark-paid`),
  void: (id: number, reason?: string) => post<T.Invoice>(`/billing/invoices/${id}/void`, { reason: reason || null }),
  duplicate: (id: number) => post<T.Invoice>(`/billing/invoices/${id}/duplicate`),
  pdf: (id: number, filename: string) => download(`/billing/invoices/${id}/pdf`, filename),
};
export const campaignsApi = {
  list: (p?: Q) => get<T.Page<T.Campaign>>("/campaigns", p),
  get: (id: number) => get<T.Campaign>(`/campaigns/${id}`),
  create: (b: Partial<T.Campaign>) => post<T.Campaign>("/campaigns", b),
  update: (id: number, b: Partial<T.Campaign>) => patch<T.Campaign>(`/campaigns/${id}`, b),
  archive: (id: number) => post<T.Campaign>(`/campaigns/${id}/archive`),
  restore: (id: number) => post<T.Campaign>(`/campaigns/${id}/restore`),
  members: (id: number) => get<T.CampaignMember[]>(`/campaigns/${id}/members`),
  addMember: (id: number, contact_id: number, status = "invited") => post<T.CampaignMember>(`/campaigns/${id}/members`, { contact_id, status }),
  updateMember: (id: number, mid: number, contact_id: number, status: string) => patch<T.CampaignMember>(`/campaigns/${id}/members/${mid}`, { contact_id, status }),
  removeMember: (id: number, mid: number) => del(`/campaigns/${id}/members/${mid}`),
};
export const reportsApi = {
  dashboard: () => get<T.Dashboard>("/reports/dashboard"),
  pipeline: () => get<T.PipelineSummary>("/reports/pipeline"),
  winLoss: (months = 12) => get<T.WinLoss>("/reports/win-loss", { months }),
  practiceAreas: () => get<Record<string, number | string | null>[]>("/reports/practice-areas"),
  origination: () => get<Record<string, number | string>[]>("/reports/origination"),
  referralSources: () => get<Record<string, number | string | null>[]>("/reports/referral-sources"),
  funnel: (months = 12) => get<{ leads: number; qualified: number; converted: number; opportunities: number; won: number; by_source: Record<string, number | string>[] }>("/reports/funnel", { months }),
  stageVelocity: () => get<{ stage: string; position: number; avg_days: number; n: number }[]>("/reports/stage-velocity"),
  activityLeaderboard: (days = 30) => get<Record<string, number | string>[]>("/reports/activity-leaderboard", { days }),
};
export const adminApi = { audit: (p?: Q) => get<T.Page<T.AuditRow>>("/admin/audit", p) };
export const dataApi = {
  exportCsv: (entity: string, include_archived = false) => download(`/export/${entity}.csv?include_archived=${include_archived}`, `${entity}.csv`),
  template: (entity: string) => download(`/import/template/${entity}.csv`, `${entity}-template.csv`),
  importCsv: (entity: string, file: File, dryRun: boolean) => { const f = new FormData(); f.append("file", file); f.append("dry_run", String(dryRun)); return postForm<T.ImportJob>(`/import/${entity}`, f); },
  jobs: (p?: Q) => get<T.Page<T.ImportJob>>("/import/jobs", p),
  exceptionsCsv: (id: number) => download(`/import/jobs/${id}/exceptions.csv`, `import-${id}-exceptions.csv`),
};
export const wallsApi = {
  list: (p?: Q) => get<T.Page<T.Wall>>("/walls", p),
  forEntity: (entity_type: "account" | "opportunity", id: number) => get<T.Wall | null>(`/walls/for/${entity_type}/${id}`),
  create: (b: { entity_type: "account" | "opportunity"; entity_id: number; reason: string; member_ids: string[] }) => post<T.Wall>("/walls", b),
  addMember: (id: number, user_id: string) => post<T.Wall>(`/walls/${id}/members`, { user_id }),
  removeMember: (id: number, user_id: string) => del<T.Wall>(`/walls/${id}/members/${user_id}`),
  lift: (id: number) => post<T.Wall>(`/walls/${id}/lift`),
};
