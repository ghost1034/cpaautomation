// Typed API client using generated OpenAPI types
import { getCurrentAuthToken } from './firebase'
import type { paths } from './api-types'
import { buildEsignReportQuery } from './esign/reportFilters'
import { formatApiErrorMessage, getBillingLimitDetail, type BillingLimitDetail } from './billingLimit'

type ApiPaths = paths
type ApiResponse<T> = T extends { responses: { 200: { content: { 'application/json': infer U } } } } ? U : never
type ApiRequest<T> = T extends { requestBody: { content: { 'application/json': infer U } } } ? U : never

export class ApiError extends Error {
  status: number
  body: any
  billingLimit: BillingLimitDetail | null

  constructor(status: number, message: unknown, body?: any) {
    super(formatApiErrorMessage(status, body, typeof message === 'string' ? message : `HTTP ${status}`))
    this.name = 'ApiError'
    this.status = status
    this.body = body
    this.billingLimit = getBillingLimitDetail(body)
  }
}

// AccountingClaw activation (explicitly typed; not part of the generated OpenAPI types)
export interface ActivateResult {
  success: boolean
  message?: string | null
  activation_key: string | null
  key_prefix: string
  already_active: boolean
  created_at: string
}

export interface ActivationStatus {
  success: boolean
  message?: string | null
  has_key: boolean
  key_prefix: string | null
  created_at: string | null
  last_resolved_at: string | null
  last_resolved_install_type: string | null
  revoked: boolean
}

export interface HostedClawConfig {
  active_product: 'accountingclaw' | 'legalclaw'
  model_alias: string
  personal_instructions: string
  timezone: string
  memory_enabled: boolean
  revision: number
}

export interface HostedClawStatus {
  feature_enabled: boolean
  entitled: boolean
  allowed_products: Array<'accountingclaw' | 'legalclaw'>
  allowed_model_aliases: string[]
  linked: boolean
  workspace_name: string | null
  slack_user_id: string | null
  slack_reauthorization_required: boolean
  config: HostedClawConfig | null
  runtime_status: string
  runtime_last_activity_at: string | null
}

export interface EsignContext {
  firm: { id: string; name: string }
  profile: { id: string | null; name: string; capabilities: Record<string, boolean>; admin_override: boolean }
  features: Record<string, boolean>
  administrative_capabilities: Record<string, boolean>
}

export interface EsignAiFieldPlacementProposal {
  id: string
  target_id?: string | null
  target_source?: string | null
  document_id: string
  participant_id: string
  field_type: import('./api-types').components['schemas']['EsignAiFieldPlacementProposal']['field_type']
  dependency_ids?: string[]
  page_number: number
  pos_x: number
  pos_y: number
  width: number
  height: number
  required: boolean
  label?: string | null
  properties?: Record<string, unknown>
}

export interface EsignAiFieldPlacementRun {
  id: string
  target_type: 'envelope' | 'template'
  target_id: string
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'applied' | 'discarded'
  scope: 'all_documents' | 'active_document'
  selected_document_ids: string[]
  base_revision: number
  instructions?: string | null
  proposals: EsignAiFieldPlacementProposal[]
  warnings: string[]
  issues?: EsignAiFieldPlacementIssue[]
  error?: string | null
  page_usage: number
  progress: number
  created_at: string
  updated_at: string
}

export interface EsignAiFieldPlacementIssue {
  document_id: string
  page_number: number
  target_id?: string | null
  label: string
  code: 'unassigned' | 'unsupported' | 'unresolved'
  reason: string
}

export interface EsignAiFieldPlacementAction {
  run: EsignAiFieldPlacementRun
  draft_revision: number
  fields_added: number
}

export interface EsignAdminOverview {
  envelopes: number
  users: number
  send_failures: number
  expiring_envelopes: number
  webhook_failures: number
  custody_issues: number
}

export interface EsignPermissionProfile {
  id: string; name: string; capabilities: Record<string, boolean>; built_in_key?: string | null; locked: boolean
}

export interface EsignWebhookConfiguration {
  id: string; envelope_id?: string | null; endpoint_url: string; enabled: boolean
  event_filters: string[]; include_completed_documents: boolean; secret?: string
}

export interface EsignPowerFormSubmission {
  id: string; status: string; initiating_email: string; envelope_id?: string | null
  verified_at?: string | null; created_at: string; attempt_count: number; last_error?: string | null
}

export interface EsignPowerFormUpgradePreview {
  compatible: boolean; current_version: number; target_version: number
  added_roles: string[]; removed_roles: string[]; changed_roles: string[]
  current_field_count: number; target_field_count: number; warnings: string[]
}

export interface EsignReportFilters {
  start: string; end: string; source?: string; status?: string; templateVersionId?: string
  senderUserId?: string; sourceId?: string
}

export interface EsignReportPoint { date: string; sent: number; completed: number }
export interface EsignWebhookAttempt {
  id: string; attempt_number: number; started_at: string; completed_at?: string | null
  duration_ms?: number | null; result: string; http_status?: number | null
  response_excerpt?: string | null; error?: string | null
}
export interface EsignCustodyIssue { asset_type: string; asset_id: string; recorded_owner_id: string; created_at?: string | null }
export interface EsignAuditFilters { eventType?: string; actorEmail?: string; targetType?: string; start?: string; end?: string }
export interface EsignAdminAuditEvent {
  id: string; event_type: string; actor_email?: string | null; target_type?: string | null
  target_id?: string | null; details?: Record<string, unknown> | null; created_at: string
}

function inferUploadContentType(file: File): string {
  if (file.type) return file.type
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf')) return 'application/pdf'
  if (name.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (name.endsWith('.pptx')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  if (name.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  if (name.endsWith('.zip')) return 'application/zip'
  if (name.endsWith('.csv')) return 'text/csv'
  return 'application/octet-stream'
}

export class ApiClient {
  private baseURL: string

  constructor(baseURL: string = '') {
    this.baseURL = baseURL
  }

  private async getAuthToken(): Promise<string | null> {
    return getCurrentAuthToken()
  }

  async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const token = await this.getAuthToken()
    
    const response = await fetch(`${this.baseURL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
        ...options.headers,
      },
    })

    if (!response.ok) {
      let body: any = null
      let message = `HTTP ${response.status}`
      try {
        body = await response.json()
        message = body?.detail || body?.message || message
      } catch {
        try {
          const text = await response.text()
          if (text) message = text
        } catch {
          // ignore
        }
      }
      throw new ApiError(response.status, message, body)
    }

    return response.json()
  }

  // User endpoints
  async getCurrentUser(): Promise<ApiResponse<ApiPaths['/api/users/me']['get']>> {
    return this.request('/api/users/me')
  }

  async checkPhoneNumberAvailability(phoneNumber: string): Promise<ApiResponse<ApiPaths['/api/users/phone-availability']['get']>> {
    const searchParams = new URLSearchParams({ phone_number: phoneNumber })
    return this.request(`/api/users/phone-availability?${searchParams.toString()}`)
  }

  async reconcilePhoneNumber(): Promise<ApiResponse<ApiPaths['/api/users/me/phone/reconcile']['post']>> {
    return this.request('/api/users/me/phone/reconcile', { method: 'POST' })
  }

  async syncUserProfile(profileData?: { display_name?: string; photo_url?: string }): Promise<ApiResponse<ApiPaths['/api/users/me/sync']['post']>> {
    return this.request('/api/users/me/sync', {
      method: 'POST',
      body: JSON.stringify(profileData || {})
    })
  }

  async markWelcomeTourSeen(): Promise<ApiResponse<ApiPaths['/api/users/me/welcome-tour-seen']['post']>> {
    return this.request('/api/users/me/welcome-tour-seen', {
      method: 'POST'
    })
  }

  async updateProfile(
    data: ApiRequest<ApiPaths['/api/users/me']['put']>
  ): Promise<ApiResponse<ApiPaths['/api/users/me']['put']>> {
    return this.request('/api/users/me', {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async deleteUserAccount(): Promise<{ message: string }> {
    return this.request('/api/users/me', {
      method: 'DELETE'
    })
  }

  // AccountingClaw activation endpoints
  async activate(code: string): Promise<ActivateResult> {
    return this.request('/api/activation/activate', {
      method: 'POST',
      body: JSON.stringify({ code }),
    })
  }

  async getActivation(): Promise<ActivationStatus> {
    return this.request('/api/activation/me')
  }

  async getHostedClawStatus(): Promise<HostedClawStatus> {
    return this.request('/api/hosted-claw/status')
  }

  async updateHostedClawConfig(data: Partial<HostedClawConfig>): Promise<HostedClawConfig> {
    return this.request('/api/hosted-claw/config', {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }

  async startHostedSlackInstall(): Promise<{ authorize_url: string; expires_in_seconds: number }> {
    return this.request('/api/hosted-claw/slack/install', { method: 'POST' })
  }

  async consumeHostedSlackLink(token: string): Promise<{ linked: boolean; workspace_name: string | null }> {
    return this.request('/api/hosted-claw/slack/link', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
  }

  async stopHostedClaw(): Promise<{ ok: boolean; message: string }> {
    return this.request('/api/hosted-claw/stop', { method: 'POST' })
  }

  async newHostedClawSession(): Promise<{ ok: boolean; message: string }> {
    return this.request('/api/hosted-claw/session/new', { method: 'POST' })
  }

  async resetHostedClawProduct(): Promise<{ ok: boolean; message: string }> {
    return this.request('/api/hosted-claw/session/reset', { method: 'POST' })
  }

  async unlinkHostedSlack(): Promise<{ ok: boolean; message: string }> {
    return this.request('/api/hosted-claw/slack/link', { method: 'DELETE' })
  }

  async deleteHostedClaw(): Promise<{ ok: boolean; message: string }> {
    return this.request('/api/hosted-claw', { method: 'DELETE' })
  }

  // Template endpoints
  async getTemplates(): Promise<ApiResponse<ApiPaths['/api/templates']['get']>> {
    return this.request('/api/templates')
  }

  async createTemplate(
    data: ApiRequest<ApiPaths['/api/templates']['post']>
  ): Promise<ApiResponse<ApiPaths['/api/templates']['post']>> {
    return this.request('/api/templates', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async getTemplate(templateId: string): Promise<ApiResponse<ApiPaths['/api/templates/{template_id}']['get']>> {
    return this.request(`/api/templates/${templateId}`)
  }


  async updateTemplate(
    templateId: string,
    data: ApiRequest<ApiPaths['/api/templates/{template_id}']['put']>
  ): Promise<ApiResponse<ApiPaths['/api/templates/{template_id}']['put']>> {
    return this.request(`/api/templates/${templateId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async deleteTemplate(templateId: string): Promise<ApiResponse<ApiPaths['/api/templates/{template_id}']['delete']>> {
    return this.request(`/api/templates/${templateId}`, {
      method: 'DELETE',
    })
  }

  async getPublicTemplates(): Promise<ApiResponse<ApiPaths['/api/templates/public/all']['get']>> {
    return this.request('/api/templates/public/all')
  }

  // Stripe endpoints
  async createCheckoutSession(
    data: ApiRequest<ApiPaths['/api/stripe/create-checkout-session']['post']>
  ): Promise<ApiResponse<ApiPaths['/api/stripe/create-checkout-session']['post']>> {
    return this.request('/api/stripe/create-checkout-session', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async createPortalSession(
    data: ApiRequest<ApiPaths['/api/stripe/create-portal-session']['post']>
  ): Promise<ApiResponse<ApiPaths['/api/stripe/create-portal-session']['post']>> {
    return this.request('/api/stripe/create-portal-session', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async getSubscriptionStatus(): Promise<ApiResponse<ApiPaths['/api/stripe/subscription-status']['get']>> {
    return this.request('/api/stripe/subscription-status')
  }

  // Job-based workflow endpoints
  async initiateJob(request: ApiRequest<ApiPaths['/api/jobs/initiate']['post']>): Promise<ApiResponse<ApiPaths['/api/jobs/initiate']['post']>> {
    return this.request('/api/jobs/initiate', {
      method: 'POST',
      body: JSON.stringify(request),
    })
  }

  async getJobDetails(jobId: string, runId?: string): Promise<ApiResponse<ApiPaths['/api/jobs/{job_id}']['get']>> {
    const params = new URLSearchParams()
    if (runId) params.set('run_id', runId)
    const query = params.toString()
    return this.request(`/api/jobs/${jobId}${query ? `?${query}` : ''}`)
  }

  async listJobs(params?: { limit?: number; offset?: number; status?: string; include_field_status?: boolean }): Promise<ApiResponse<ApiPaths['/api/jobs']['get']>> {
    const searchParams = new URLSearchParams()
    if (params?.limit) searchParams.set('limit', params.limit.toString())
    if (params?.offset) searchParams.set('offset', params.offset.toString())
    if (params?.status) searchParams.set('status', params.status)
    if (params?.include_field_status) searchParams.set('include_field_status', params.include_field_status.toString())
    
    const query = searchParams.toString()
    return this.request(`/api/jobs${query ? `?${query}` : ''}`)
  }

  async getJobProgress(jobId: string, runId?: string): Promise<ApiResponse<ApiPaths['/api/jobs/{job_id}/progress']['get']>> {
    const params = new URLSearchParams()
    if (runId) params.set('run_id', runId)
    const query = params.toString()
    return this.request(`/api/jobs/${jobId}/progress${query ? `?${query}` : ''}`)
  }

  async getJobFiles(jobId: string, options?: { processable?: boolean; runId?: string }): Promise<ApiResponse<ApiPaths['/api/jobs/{job_id}/files']['get']>> {
    const searchParams = new URLSearchParams()
    if (options?.processable) {
      searchParams.set('processable', 'true')
    }
    if (options?.runId) {
      searchParams.set('run_id', options.runId)
    }

    const query = searchParams.toString()
    return this.request(`/api/jobs/${jobId}/files${query ? `?${query}` : ''}`)
  }

  async getJobFilesAllRuns(jobId: string, options?: { processable?: boolean }): Promise<JobFilesAllRunsResponse> {
    const searchParams = new URLSearchParams()
    if (options?.processable) {
      searchParams.set('processable', 'true')
    }
    const query = searchParams.toString()
    return this.request(`/api/jobs/${jobId}/files:all${query ? `?${query}` : ''}`)
  }

  // Job Runs endpoints
  async getJobRuns(jobId: string): Promise<ApiResponse<ApiPaths['/api/jobs/{job_id}/runs']['get']>> {
    return this.request(`/api/jobs/${jobId}/runs`)
  }

  async createJobRun(jobId: string, request: ApiRequest<ApiPaths['/api/jobs/{job_id}/runs']['post']>): Promise<ApiResponse<ApiPaths['/api/jobs/{job_id}/runs']['post']>> {
    return this.request(`/api/jobs/${jobId}/runs`, {
      method: 'POST',
      body: JSON.stringify(request)
    })
  }

  async getJobRun(jobId: string, runId: string): Promise<ApiResponse<ApiPaths['/api/jobs/{job_id}/runs/{run_id}']['get']>> {
    return this.request(`/api/jobs/${jobId}/runs/${runId}`)
  }

  async addFilesToJob(
    jobId: string,
    files: File[],
    onProgress?: (filePath: string, progress: number) => void,
    onFileComplete?: (fileData: any, filePath: string) => void,
    runId?: string
  ): Promise<{ files: any[] }> {
    const token = await this.getAuthToken()

    const uploadedFiles: any[] = []

    const normalizeRelPath = (p: string) => p.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')

    const params = new URLSearchParams()
    if (runId) params.set('run_id', runId)
    const queryString = params.toString()

    // Step 1: Initiate uploads to get signed PUT URLs
    const initiateResult: any = await this.request(`/api/jobs/${jobId}/files:initiate${queryString ? `?${queryString}` : ''}`, {
      method: 'POST',
      body: JSON.stringify({
        files: files.map((file) => {
          const filePath = (file as any).webkitRelativePath || file.name
          return {
            filename: file.name,
            path: filePath,
            size: file.size,
            type: inferUploadContentType(file),
          }
        })
      })
    })

    const initiatedByPath = new Map<string, { id: string; original_path: string; upload_url: string }>()
    for (const f of initiateResult?.files || []) {
      initiatedByPath.set(f.original_path, f)
      initiatedByPath.set(normalizeRelPath(f.original_path), f)
    }

    // Step 2: Upload bytes directly to GCS (signed URL), then complete to finalize + page count
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const filePath = (file as any).webkitRelativePath || file.name
      const normalizedPath = normalizeRelPath(filePath)
      console.log(`Uploading file ${i + 1}/${files.length}: ${filePath}`)

      if (onProgress) onProgress(filePath, 0)

      const initiated = initiatedByPath.get(filePath) || initiatedByPath.get(normalizedPath)
      if (!initiated?.upload_url || !initiated?.id) {
        throw new Error(`Missing upload URL for ${filePath}`)
      }

      // PUT to signed URL with progress
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable && onProgress) {
            const progress = (event.loaded / event.total) * 100
            onProgress(filePath, progress)
          }
        })
        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve()
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`))
          }
        })
        xhr.addEventListener('error', () => reject(new Error('Network error during upload')))
        xhr.open('PUT', initiated.upload_url)
        // Must match content_type used when signing the URL
        xhr.setRequestHeader('Content-Type', inferUploadContentType(file))
        xhr.send(file)
      })

      // Complete upload (server validates size, counts pages, enqueues ZIP unpack)
      const completeResponse = await fetch(`${this.baseURL}/api/jobs/${jobId}/files:complete${queryString ? `?${queryString}` : ''}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ file_ids: [initiated.id] })
      })

      if (!completeResponse.ok) {
        const error = await completeResponse.json().catch(() => ({ message: 'Upload completion failed' }))
        throw new Error(error.detail || error.message || 'Upload completion failed')
      }

      const completeResult: any = await completeResponse.json()
      const completedFile = completeResult?.files?.[0]
      if (completedFile) {
        uploadedFiles.push(completedFile)
        if (onFileComplete) onFileComplete(completedFile, filePath)
      }

      if (onProgress) onProgress(filePath, 100)
    }

    return { files: uploadedFiles }
  }

  async removeFileFromJob(jobId: string, fileId: string, runId?: string): Promise<void> {
    const params = new URLSearchParams()
    if (runId) params.set('run_id', runId)
    const queryString = params.toString()
    await this.request(`/api/jobs/${jobId}/files/${fileId}${queryString ? `?${queryString}` : ''}`, {
      method: 'DELETE',
    })
  }

  async downloadJobFile(jobId: string, fileId: string): Promise<{ blob: Blob; filename: string }> {
    const token = await this.getAuthToken()

    const response = await fetch(`${this.baseURL}/api/jobs/${jobId}/files/${fileId}:download`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'File download failed' }))
      throw new Error(error.detail || error.message || 'File download failed')
    }

    const blob = await response.blob()
    const filename = response.headers.get('Content-Disposition')?.match(/filename=(.+)/)?.[1] || 'download'
    return { blob, filename: filename.replace(/"/g, '') }
  }

  async downloadJobFilesZip(jobId: string, fileIds: string[]): Promise<{ blob: Blob; filename: string }> {
    const token = await this.getAuthToken()

    const response = await fetch(`${this.baseURL}/api/jobs/${jobId}/files:download-zip`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ file_ids: fileIds })
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'ZIP download failed' }))
      throw new Error(error.detail || error.message || 'ZIP download failed')
    }

    const blob = await response.blob()
    const filename = response.headers.get('Content-Disposition')?.match(/filename=(.+)/)?.[1] || 'files.zip'
    return { blob, filename: filename.replace(/"/g, '') }
  }

  /**
   * Get auth token for SSE connections (public method)
   */
  async getAuthTokenForSSE(): Promise<string> {
    const token = await getCurrentAuthToken()
    if (!token) throw new Error('Not authenticated')
    return token
  }

  async deleteJob(jobId: string): Promise<void> {
    await this.request(`/api/jobs/${jobId}`, {
      method: 'DELETE',
    })
  }

  async updateJobDetails(jobId: string, data: { name: string }): Promise<{ message: string }> {
    return this.request(`/api/jobs/${jobId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }

  async updateJobName(jobId: string, name: string): Promise<{ message: string }> {
    return this.updateJobDetails(jobId, { name })
  }

  async getJobResults(jobId: string, params?: { limit?: number; offset?: number; runId?: string }): Promise<JobResultsResponse> {
    const searchParams = new URLSearchParams()
    if (params?.limit) searchParams.set('limit', params.limit.toString())
    if (params?.offset) searchParams.set('offset', params.offset.toString())
    if (params?.runId) searchParams.set('run_id', params.runId)
    
    const query = searchParams.toString()
    return this.request(`/api/jobs/${jobId}/results${query ? `?${query}` : ''}`)
  }

  async createJobResultRow(jobId: string, payload: { runId?: string; attachToTaskId?: string; values: Record<string, any> }): Promise<{ task_id: string; row_id: string }> {
    return this.request(`/api/jobs/${jobId}/results/rows`, {
      method: 'POST',
      body: JSON.stringify({
        run_id: payload.runId,
        attach_to_task_id: payload.attachToTaskId,
        values: payload.values,
      }),
    })
  }

  async updateJobResultRow(jobId: string, taskId: string, rowId: string, values: Record<string, any>): Promise<{ message: string }> {
    return this.request(`/api/jobs/${jobId}/results/tasks/${taskId}/rows/${rowId}`, {
      method: 'PATCH',
      body: JSON.stringify({ values }),
    })
  }

  async deleteJobResultRow(jobId: string, taskId: string, rowId: string): Promise<{ message: string }> {
    return this.request(`/api/jobs/${jobId}/results/tasks/${taskId}/rows/${rowId}`, {
      method: 'DELETE',
    })
  }

  async submitJob(jobId: string, runId?: string): Promise<{ message: string; job_run_id: string }> {
    const params = new URLSearchParams()
    if (runId) params.set('run_id', runId)
    const query = params.toString()
    return this.request(`/api/jobs/${jobId}/submit${query ? `?${query}` : ''}`, {
      method: 'POST'
    })
  }

  async updateJobConfigStep(jobId: string, configStep: string, runId?: string): Promise<{ message: string }> {
    const params = new URLSearchParams()
    if (runId) params.set('run_id', runId)
    const query = params.toString()
    return this.request(`/api/jobs/${jobId}/config-step${query ? `?${query}` : ''}`, {
      method: 'PUT',
      body: JSON.stringify({ config_step: configStep })
    })
  }

  async updateJobFields(jobId: string, fields: any[], templateId?: string, processingModes?: Record<string, string>, runId?: string, description?: string): Promise<{ message: string }> {
    const params = new URLSearchParams()
    if (runId) params.set('run_id', runId)
    const query = params.toString()
    return this.request(`/api/jobs/${jobId}/fields${query ? `?${query}` : ''}`, {
      method: 'PUT',
      body: JSON.stringify({ 
        fields, 
        template_id: templateId, 
        processing_modes: processingModes,
        description
      })
    })
  }

  async getDataTypes(): Promise<DataType[]> {
    return this.request('/api/data-types')
  }

  async verifyJobAccess(jobId: string): Promise<void> {
    // This will throw if user doesn't have access
    await this.getJobDetails(jobId)
  }

  // Google Integration endpoints
  async getGoogleAuthUrl(scopes: string = 'combined'): Promise<{ auth_url: string; state: string }> {
    return this.request(`/api/integrations/google/auth-url?scopes=${encodeURIComponent(scopes)}`)
  }

  async exchangeGoogleCode(code: string, state: string): Promise<{ success: boolean; provider: string; scopes: string[]; user_email: string; expires_at: string | null }> {
    return this.request('/api/integrations/google/exchange', {
      method: 'POST',
      body: JSON.stringify({ code, state })
    })
  }

  async getGoogleIntegrationStatus(): Promise<{ connected: boolean; scopes: string[]; expires_at: string | null; is_expired: boolean }> {
    return this.request('/api/integrations/google/status')
  }

  async disconnectGoogleIntegration(): Promise<{ success: boolean; message: string }> {
    return this.request('/api/integrations/google/disconnect', {
      method: 'DELETE'
    })
  }

  async refreshGoogleToken(): Promise<{ success: boolean; expires_at: string | null }> {
    return this.request('/api/integrations/google/refresh', {
      method: 'POST'
    })
  }

  async getGmailAttachments(query: string, mimeTypes: string, limit: number = 50): Promise<{ attachments: any[] }> {
    const params = new URLSearchParams({
      query,
      mimeTypes,
      limit: limit.toString()
    })
    return this.request(`/api/integrations/gmail/attachments?${params}`)
  }

  // OpenConnector integration broker endpoints
  async getConnectorCatalog(params: { search?: string; category?: string; page?: number; pageSize?: number } = {}): Promise<import('./connector-types').ConnectorCatalogResponse> {
    const searchParams = new URLSearchParams()
    if (params.search) searchParams.set('search', params.search)
    if (params.category) searchParams.set('category', params.category)
    if (params.page) searchParams.set('page', String(params.page))
    if (params.pageSize) searchParams.set('page_size', String(params.pageSize))
    const qs = searchParams.toString()
    return this.request(`/api/connector/catalog${qs ? `?${qs}` : ''}`)
  }

  async getConnectorProvider(service: string): Promise<import('./connector-types').ConnectorProviderDetail> {
    return this.request(`/api/connector/catalog/${encodeURIComponent(service)}`)
  }

  async listConnectorConnections(): Promise<import('./connector-types').ConnectorConnectionsResponse> {
    return this.request('/api/connector/connections')
  }

  async createConnectorConnection(data: import('./connector-types').CreateConnectorConnectionRequest): Promise<import('./connector-types').CreateConnectorConnectionResponse> {
    return this.request('/api/connector/connections', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async getConnectorConnection(connectionId: string): Promise<import('./connector-types').ConnectorConnectionStatusResponse> {
    return this.request(`/api/connector/connections/${encodeURIComponent(connectionId)}`)
  }

  async deleteConnectorConnection(connectionId: string): Promise<import('./connector-types').ConnectorConnectionStatusResponse> {
    return this.request(`/api/connector/connections/${encodeURIComponent(connectionId)}`, {
      method: 'DELETE',
    })
  }

  async testConnectorConnection(connectionId: string): Promise<import('./connector-types').ConnectorConnectionStatusResponse> {
    return this.request(`/api/connector/connections/${encodeURIComponent(connectionId)}/test`, {
      method: 'POST',
    })
  }

  async executeConnectorAction(actionId: string, input: Record<string, unknown> = {}, connectionId?: string): Promise<import('./connector-types').ConnectorExecuteResponse> {
    return this.request(`/api/connector/actions/${encodeURIComponent(actionId)}`, {
      method: 'POST',
      body: JSON.stringify({ input, connection_id: connectionId }),
    })
  }

  async listConnectorTokens(): Promise<import('./connector-types').ConnectorTokensResponse> {
    return this.request('/api/connector/tokens')
  }

  async createConnectorToken(name?: string): Promise<import('./connector-types').CreateConnectorTokenResponse> {
    return this.request('/api/connector/tokens', {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
  }

  async revokeConnectorToken(tokenId: string): Promise<import('./connector-types').ConnectorTokensResponse> {
    return this.request(`/api/connector/tokens/${encodeURIComponent(tokenId)}`, {
      method: 'DELETE',
    })
  }

  // File Import endpoints (Epic 3)
  async importDriveFiles(jobId: string, fileIds: string[]): Promise<{ success: boolean; import_job_id: string; message: string; file_count: number }> {
    return this.request(`/api/jobs/${jobId}/files:gdrive`, {
      method: 'POST',
      body: JSON.stringify({ file_ids: fileIds })
    })
  }

  async importGmailAttachments(jobId: string, attachments: Array<{ messageId: string; attachmentId: string; filename: string; mimeType?: string }>): Promise<{ success: boolean; import_job_id: string; message: string; attachment_count: number }> {
    return this.request(`/api/jobs/${jobId}/files:gmail`, {
      method: 'POST',
      body: JSON.stringify({ attachments })
    })
  }

  async getImportStatus(jobId: string): Promise<{ total_files: number; by_source: Record<string, number>; by_status: Record<string, number>; files: Array<{ id: string; filename: string; source_type: string; status: string; file_size: number; updated_at: string | null }> }> {
    return this.request(`/api/jobs/${jobId}/import-status`)
  }

  // Job Export endpoints
  async exportJobCSV(jobId: string, runId?: string): Promise<{ blob: Blob; filename: string }> {
    const token = await this.getAuthToken()
    const params = new URLSearchParams()
    if (runId) params.set('run_id', runId)
    const query = params.toString()
    
    const response = await fetch(`${this.baseURL}/api/jobs/${jobId}/export/csv${query ? `?${query}` : ''}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'CSV export failed' }))
      throw new Error(error.detail || error.message || 'CSV export failed')
    }

    const blob = await response.blob()
    const filename = response.headers.get('Content-Disposition')?.match(/filename=(.+)/)?.[1] || 'export.csv'
    return { blob, filename: filename.replace(/"/g, '') }
  }

  async exportJobExcel(jobId: string, runId?: string): Promise<{ blob: Blob; filename: string }> {
    const token = await this.getAuthToken()
    const params = new URLSearchParams()
    if (runId) params.set('run_id', runId)
    const query = params.toString()
    
    const response = await fetch(`${this.baseURL}/api/jobs/${jobId}/export/excel${query ? `?${query}` : ''}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Excel export failed' }))
      throw new Error(error.detail || error.message || 'Excel export failed')
    }

    const blob = await response.blob()
    const filename = response.headers.get('Content-Disposition')?.match(/filename=(.+)/)?.[1] || 'export.xlsx'
    return { blob, filename: filename.replace(/"/g, '') }
  }

  // Contact endpoint
  async submitContact(
    data: ApiRequest<ApiPaths['/api/contact']['post']>
  ): Promise<ApiResponse<ApiPaths['/api/contact']['post']>> {
    return this.request('/api/contact', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }

  async getJobRunExportRefs(jobId: string, runId: string): Promise<{ gdrive?: { csv?: { external_id?: string; status?: string }; xlsx?: { external_id?: string; status?: string } } }> {
    return this.request(`/api/jobs/${jobId}/runs/${runId}/export-refs`)
  }

  // Google Drive Export endpoints
  async exportJobToGoogleDriveCSV(jobId: string, folderId?: string, runId?: string): Promise<{
    success: boolean;
    message: string;
    drive_file_id: string;
    drive_file_name: string;
    web_view_link: string;
    web_content_link: string;
  }> {
    const token = await this.getAuthToken()
    const params = new URLSearchParams();
    if (folderId) {
      params.append('folder_id', folderId);
    }
    if (runId) {
      params.append('run_id', runId);
    }
    
    const url = `${this.baseURL}/api/jobs/${jobId}/export/gdrive/csv${params.toString() ? `?${params.toString()}` : ''}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Google Drive CSV export failed' }));
      throw new Error(error.detail || 'Google Drive CSV export failed');
    }

    return await response.json();
  }

  async exportJobToGoogleDriveExcel(jobId: string, folderId?: string, runId?: string): Promise<{
    success: boolean;
    message: string;
    drive_file_id: string;
    drive_file_name: string;
    web_view_link: string;
    web_content_link: string;
  }> {
    const token = await this.getAuthToken()
    const params = new URLSearchParams();
    if (folderId) {
      params.append('folder_id', folderId);
    }
    if (runId) {
      params.append('run_id', runId);
    }
    
    const url = `${this.baseURL}/api/jobs/${jobId}/export/gdrive/excel${params.toString() ? `?${params.toString()}` : ''}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Google Drive Excel export failed' }));
      throw new Error(error.detail || 'Google Drive Excel export failed');
    }

    return await response.json();
  }

  // ===================================================================
  // Form Fill endpoints
  // ===================================================================

  async listFormFillTemplates(): Promise<FormFillTemplateListResponse> {
    return this.request('/api/form-fill/templates')
  }

  async deleteFormFillTemplate(templateId: string): Promise<{ message: string }> {
    return this.request(`/api/form-fill/templates/${templateId}`, {
      method: 'DELETE'
    })
  }

  async getFormFillExtractionSourcePreview(params: {
    jobId: string
    runId: string
    taskId?: string
    sourceScope?: 'task' | 'all'
  }): Promise<FormFillExtractionSourcePreview> {
    const searchParams = new URLSearchParams({
      job_id: params.jobId,
      run_id: params.runId,
    })
    if (params.taskId) searchParams.set('task_id', params.taskId)
    if (params.sourceScope) searchParams.set('source_scope', params.sourceScope)
    return this.request(`/api/form-fill/extraction-source-preview?${searchParams.toString()}`)
  }

  async createFormFillRun(params: CreateFormFillRunParams): Promise<FormFillRunCreateResponse> {
    const token = await this.getAuthToken()
    const formData = new FormData()

    params.sourceFiles?.forEach((file) => formData.append('source_files', file))
    if (params.targetFile) formData.append('target_file', params.targetFile)
    if (params.templateId) formData.append('template_id', params.templateId)
    if (params.outputFormat) formData.append('output_format', params.outputFormat)
    if (params.repeatMode) formData.append('repeat_mode', params.repeatMode)
    if (params.allowDocxTableExpansion !== undefined) {
      formData.append('allow_docx_table_expansion', params.allowDocxTableExpansion ? 'true' : 'false')
    }
    if (params.fillChronologically !== undefined) {
      formData.append('fill_chronologically', params.fillChronologically ? 'true' : 'false')
    }
    if (params.saveTemplateName) formData.append('save_template_name', params.saveTemplateName)
    if (params.saveTemplateDescription) formData.append('save_template_description', params.saveTemplateDescription)
    if (params.sourceJobId) formData.append('source_job_id', params.sourceJobId)
    if (params.sourceRunId) formData.append('source_run_id', params.sourceRunId)
    if (params.sourceTaskId) formData.append('source_task_id', params.sourceTaskId)
    if (params.sourceScope) formData.append('source_scope', params.sourceScope)

    const response = await fetch(`${this.baseURL}/api/form-fill/runs`, {
      method: 'POST',
      headers: {
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: formData,
    })

    if (!response.ok) {
      let body: any = null
      let message = `HTTP ${response.status}`
      try {
        body = await response.json()
        message = body?.detail || body?.message || message
      } catch {
        try {
          const text = await response.text()
          if (text) message = text
        } catch {
          // ignore
        }
      }
      throw new ApiError(response.status, message, body)
    }

    return response.json()
  }

  async listFormFillRuns(params?: { limit?: number; offset?: number; status?: string }): Promise<FormFillRunListResponse> {
    const searchParams = new URLSearchParams()
    if (params?.limit !== undefined) searchParams.append('limit', String(params.limit))
    if (params?.offset !== undefined) searchParams.append('offset', String(params.offset))
    if (params?.status) searchParams.append('status', params.status)
    const query = searchParams.toString()
    return this.request(`/api/form-fill/runs${query ? `?${query}` : ''}`)
  }

  async getFormFillRun(runId: string): Promise<FormFillRun> {
    return this.request(`/api/form-fill/runs/${runId}`)
  }

  async downloadFormFillRun(runId: string): Promise<{ blob: Blob; filename: string }> {
    const token = await this.getAuthToken()
    const response = await fetch(`${this.baseURL}/api/form-fill/runs/${runId}/download`, {
      method: 'GET',
      headers: {
        ...(token && { Authorization: `Bearer ${token}` }),
      },
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Form Fill download failed' }))
      throw new Error(error.detail || error.message || 'Form Fill download failed')
    }

    const blob = await response.blob()
    const filename = response.headers.get('Content-Disposition')?.match(/filename=(.+)/)?.[1] || 'filled-document'
    return { blob, filename: filename.replace(/"/g, '') }
  }

  async downloadFormFillSourceFile(runId: string, fileId: string): Promise<{ blob: Blob; filename: string }> {
    const token = await this.getAuthToken()
    const response = await fetch(`${this.baseURL}/api/form-fill/runs/${runId}/source-files/${fileId}/download`, {
      method: 'GET',
      headers: {
        ...(token && { Authorization: `Bearer ${token}` }),
      },
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Source file download failed' }))
      throw new Error(error.detail || error.message || 'Source file download failed')
    }

    const blob = await response.blob()
    const filename = response.headers.get('Content-Disposition')?.match(/filename=(.+)/)?.[1] || 'source-file'
    return { blob, filename: filename.replace(/"/g, '') }
  }

  async downloadFormFillTarget(runId: string): Promise<{ blob: Blob; filename: string }> {
    const token = await this.getAuthToken()
    const response = await fetch(`${this.baseURL}/api/form-fill/runs/${runId}/target/download`, {
      method: 'GET',
      headers: {
        ...(token && { Authorization: `Bearer ${token}` }),
      },
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Target file download failed' }))
      throw new Error(error.detail || error.message || 'Target file download failed')
    }

    const blob = await response.blob()
    const filename = response.headers.get('Content-Disposition')?.match(/filename=(.+)/)?.[1] || 'target-document'
    return { blob, filename: filename.replace(/"/g, '') }
  }

  // ===================================================================
  // CPE Tracker endpoints
  // ===================================================================

  async getCpeStates(): Promise<CpeStatesListResponse> {
    return this.request('/api/cpe/states')
  }

  async listCpeSheets(): Promise<CpeSheetsListResponse> {
    return this.request('/api/cpe/sheets')
  }

  async createCpeSheet(templateId: string, name?: string): Promise<CreateCpeSheetResponse> {
    return this.request('/api/cpe/sheets', {
      method: 'POST',
      body: JSON.stringify({ template_id: templateId, name })
    })
  }

  async deleteCpeSheet(jobId: string): Promise<{ message: string }> {
    return this.request(`/api/cpe/sheets/${jobId}`, {
      method: 'DELETE'
    })
  }

  async startCpeSheet(jobId: string): Promise<StartCpeSheetResponse> {
    return this.request(`/api/cpe/sheets/${jobId}/start`, {
      method: 'POST'
    })
  }

  // ===================================================================
  // Inkwise endpoints
  // ===================================================================

  async listInkwiseDocuments(params?: { page?: number; limit?: number }): Promise<InkwisePaginatedDocuments> {
    const searchParams = new URLSearchParams()
    if (params?.page) searchParams.set('page', params.page.toString())
    if (params?.limit) searchParams.set('limit', params.limit.toString())
    const query = searchParams.toString()
    return this.request(`/api/inkwise/documents${query ? `?${query}` : ''}`)
  }

  async createInkwiseDocument(data: InkwiseDocumentCreateRequest): Promise<InkwiseDocument> {
    return this.request('/api/inkwise/documents', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async getInkwiseDocument(documentId: string): Promise<InkwiseDocument> {
    return this.request(`/api/inkwise/documents/${documentId}`)
  }

  async updateInkwiseDocument(documentId: string, data: InkwiseDocumentUpdateRequest): Promise<InkwiseDocument> {
    return this.request(`/api/inkwise/documents/${documentId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async deleteInkwiseDocument(documentId: string): Promise<{ message: string }> {
    return this.request(`/api/inkwise/documents/${documentId}`, {
      method: 'DELETE',
    })
  }

  async moveInkwiseDocument(documentId: string, folderId: string | null): Promise<InkwiseDocument> {
    return this.request(`/api/inkwise/documents/${documentId}:move`, {
      method: 'POST',
      body: JSON.stringify({ folder_id: folderId }),
    })
  }

  async listInkwiseDocumentFolders(): Promise<InkwiseDocumentFolderListResponse> {
    return this.request('/api/inkwise/documents/folders')
  }

  async createInkwiseDocumentFolder(data: InkwiseDocumentFolderCreateRequest): Promise<InkwiseDocumentFolder> {
    return this.request('/api/inkwise/documents/folders', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateInkwiseDocumentFolder(folderId: string, data: InkwiseDocumentFolderUpdateRequest): Promise<InkwiseDocumentFolder> {
    return this.request(`/api/inkwise/documents/folders/${folderId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async deleteInkwiseDocumentFolder(folderId: string): Promise<{ message: string }> {
    return this.request(`/api/inkwise/documents/folders/${folderId}`, {
      method: 'DELETE',
    })
  }

  async listInkwiseDocumentRevisions(documentId: string): Promise<InkwiseDocumentRevisionListResponse> {
    return this.request(`/api/inkwise/documents/${documentId}/revisions`)
  }

  async getInkwiseDocumentRevision(documentId: string, revisionId: string): Promise<InkwiseDocumentRevision> {
    return this.request(`/api/inkwise/documents/${documentId}/revisions/${revisionId}`)
  }

  async restoreInkwiseDocumentRevision(documentId: string, revisionId: string): Promise<InkwiseDocument> {
    return this.request(`/api/inkwise/documents/${documentId}/revisions/${revisionId}:restore`, {
      method: 'POST',
    })
  }

  async getInkwiseDocumentSources(documentId: string): Promise<InkwiseDocumentBoundSources> {
    return this.request(`/api/inkwise/documents/${documentId}/sources`)
  }

  async bindInkwiseSources(documentId: string, sourceIds: string[]): Promise<InkwiseBindSourcesResponse> {
    return this.request(`/api/inkwise/documents/${documentId}/sources:bind`, {
      method: 'POST',
      body: JSON.stringify({ source_ids: sourceIds }),
    })
  }

  async unbindInkwiseSources(documentId: string, sourceIds: string[]): Promise<InkwiseBindSourcesResponse> {
    return this.request(`/api/inkwise/documents/${documentId}/sources:unbind`, {
      method: 'POST',
      body: JSON.stringify({ source_ids: sourceIds }),
    })
  }

  async exportInkwiseDocument(documentId: string, type: 'pdf' | 'docx'): Promise<{ blob: Blob; filename: string }> {
    const token = await this.getAuthToken()
    const response = await fetch(`${this.baseURL}/api/inkwise/documents/${documentId}/export?type=${type}`, {
      method: 'GET',
      headers: {
        ...(token && { Authorization: `Bearer ${token}` }),
      },
    })

    if (!response.ok) {
      let body: any = null
      let message = `HTTP ${response.status}`
      try {
        body = await response.json()
        message = body?.detail || body?.message || message
      } catch {
        // ignore
      }
      throw new ApiError(response.status, message, body)
    }

    const blob = await response.blob()
    const filename = response.headers.get('Content-Disposition')?.match(/filename="?([^";]+)"?/)?.[1] || `inkwise.${type}`
    return { blob, filename }
  }

  async exportInkwiseDocumentToDrive(documentId: string, data: InkwiseDriveExportRequest): Promise<InkwiseDriveExportResponse> {
    return this.request(`/api/inkwise/documents/${documentId}/export:gdrive`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async listInkwiseSources(params?: { page?: number; limit?: number }): Promise<InkwisePaginatedSources> {
    const searchParams = new URLSearchParams()
    if (params?.page) searchParams.set('page', params.page.toString())
    if (params?.limit) searchParams.set('limit', params.limit.toString())
    const query = searchParams.toString()
    return this.request(`/api/inkwise/sources${query ? `?${query}` : ''}`)
  }

  async getInkwiseSource(sourceId: string): Promise<InkwiseSource> {
    return this.request(`/api/inkwise/sources/${sourceId}`)
  }

  async updateInkwiseSource(sourceId: string, data: InkwiseSourceUpdateRequest): Promise<InkwiseSource> {
    return this.request(`/api/inkwise/sources/${sourceId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async initInkwiseSourceUpload(data: InkwiseSourceUploadInitRequest): Promise<InkwiseSourceUploadInitResponse> {
    return this.request('/api/inkwise/sources/upload:init', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async captureInkwiseWebpage(data: InkwiseWebpageCaptureRequest): Promise<InkwiseSource> {
    return this.request('/api/inkwise/sources/webpage:capture', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async importInkwiseDriveSources(fileIds: string[]): Promise<InkwiseSourceImportResponse> {
    return this.request('/api/inkwise/sources/import:gdrive', {
      method: 'POST',
      body: JSON.stringify({ file_ids: fileIds }),
    })
  }

  async completeInkwiseSourceUpload(sourceId: string, checksumSha256?: string): Promise<InkwiseSourceImportResponse> {
    return this.request(`/api/inkwise/sources/${sourceId}/upload:complete`, {
      method: 'POST',
      body: JSON.stringify({ checksum_sha256: checksumSha256 ?? null }),
    })
  }

  async previewInkwiseSource(sourceId: string): Promise<InkwiseSignedUrlResponse> {
    return this.request(`/api/inkwise/sources/${sourceId}/preview`)
  }

  async previewInkwiseSourceAsset(sourceId: string, data: InkwiseAssetPreviewRequest): Promise<InkwiseSignedUrlResponse> {
    return this.request(`/api/inkwise/sources/${sourceId}/asset-preview`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async downloadInkwiseSource(sourceId: string): Promise<InkwiseSignedUrlResponse> {
    return this.request(`/api/inkwise/sources/${sourceId}/download`)
  }

  async deleteInkwiseSource(sourceId: string): Promise<{ message: string }> {
    return this.request(`/api/inkwise/sources/${sourceId}`, {
      method: 'DELETE',
    })
  }

  async ingestInkwiseSource(sourceId: string): Promise<InkwiseSourceIngestion> {
    return this.request(`/api/inkwise/sources/${sourceId}/ingest`, {
      method: 'POST',
    })
  }

  async listInkwiseSourceIngestions(sourceId?: string): Promise<InkwiseSourceIngestionListResponse> {
    const query = sourceId ? `?source_id=${sourceId}` : ''
    return this.request(`/api/inkwise/source-ingestions${query}`)
  }

  async listInkwiseTemplates(params?: { page?: number; limit?: number }): Promise<InkwisePaginatedTemplates> {
    const searchParams = new URLSearchParams()
    if (params?.page) searchParams.set('page', params.page.toString())
    if (params?.limit) searchParams.set('limit', params.limit.toString())
    const query = searchParams.toString()
    return this.request(`/api/inkwise/templates${query ? `?${query}` : ''}`)
  }

  async createInkwiseTemplate(data: InkwiseTemplateCreateRequest): Promise<InkwiseTemplate> {
    return this.request('/api/inkwise/templates', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async getInkwiseTemplate(templateId: string): Promise<InkwiseTemplate> {
    return this.request(`/api/inkwise/templates/${templateId}`)
  }

  async updateInkwiseTemplate(templateId: string, data: InkwiseTemplateUpdateRequest): Promise<InkwiseTemplate> {
    return this.request(`/api/inkwise/templates/${templateId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async deleteInkwiseTemplate(templateId: string): Promise<{ message: string }> {
    return this.request(`/api/inkwise/templates/${templateId}`, {
      method: 'DELETE',
    })
  }

  async listInkwiseSystemTemplateCategories(): Promise<{ items: InkwiseSystemTemplateCategory[] }> {
    return this.request('/api/inkwise/system-template-categories')
  }

  async listInkwiseSystemTemplates(categoryId?: number): Promise<{ items: InkwiseSystemTemplate[] }> {
    const query = categoryId ? `?category_id=${categoryId}` : ''
    return this.request(`/api/inkwise/system-templates${query}`)
  }

  async getInkwiseSystemTemplate(systemTemplateId: string): Promise<InkwiseSystemTemplate> {
    return this.request(`/api/inkwise/system-templates/${systemTemplateId}`)
  }

  async listInkwiseChatThreads(documentId?: string): Promise<InkwiseChatThreadsResponse> {
    const query = documentId ? `?document_id=${documentId}` : ''
    return this.request(`/api/inkwise/chat/threads${query}`)
  }

  async createInkwiseChatThread(data: InkwiseChatThreadCreateRequest): Promise<InkwiseChatThread> {
    return this.request('/api/inkwise/chat/threads', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async deleteInkwiseChatThread(threadId: string): Promise<{ message: string }> {
    return this.request(`/api/inkwise/chat/threads/${threadId}`, {
      method: 'DELETE',
    })
  }

  async listInkwiseChatMessages(threadId: string, params?: { page?: number; limit?: number }): Promise<InkwisePaginatedChatMessages> {
    const searchParams = new URLSearchParams()
    if (params?.page) searchParams.set('page', params.page.toString())
    if (params?.limit) searchParams.set('limit', params.limit.toString())
    const query = searchParams.toString()
    return this.request(`/api/inkwise/chat/threads/${threadId}/messages${query ? `?${query}` : ''}`)
  }

  async streamInkwiseChatMessage(
    threadId: string,
    data: InkwiseChatSendRequest,
    onEvent: (evt: InkwiseSseEvent) => void,
    opts?: { signal?: AbortSignal }
  ): Promise<void> {
    return this.streamSse(`/api/inkwise/chat/threads/${threadId}/messages:stream`, data, onEvent, opts)
  }

  async streamInkwiseRetryChatMessage(
    threadId: string,
    messageId: string,
    data: InkwiseRetryRequest,
    onEvent: (evt: InkwiseSseEvent) => void,
    opts?: { signal?: AbortSignal }
  ): Promise<void> {
    return this.streamSse(`/api/inkwise/chat/threads/${threadId}/messages/${messageId}:retry`, data, onEvent, opts)
  }

  async createInkwisePrediction(
    documentId: string,
    data: InkwisePredictionRequest,
    opts?: { signal?: AbortSignal }
  ): Promise<InkwisePredictionResponse> {
    return this.request(`/api/inkwise/documents/${documentId}/predictions`, {
      method: 'POST',
      signal: opts?.signal,
      body: JSON.stringify(data),
    })
  }

  async streamInkwiseWritingTool(
    data: InkwiseWritingToolRequest,
    onEvent: (evt: InkwiseSseEvent) => void,
    opts?: { signal?: AbortSignal }
  ): Promise<void> {
    return this.streamSse('/api/inkwise/writing-tools:stream', data, onEvent, opts)
  }

  async streamInkwiseRetryWritingTool(
    attemptId: string,
    data: InkwiseRetryRequest,
    onEvent: (evt: InkwiseSseEvent) => void,
    opts?: { signal?: AbortSignal }
  ): Promise<void> {
    return this.streamSse(`/api/inkwise/writing-tools/${attemptId}:retry`, data, onEvent, opts)
  }

  private getStreamingBaseURL(): string {
    if (process.env.NEXT_PUBLIC_API_URL) {
      return process.env.NEXT_PUBLIC_API_URL
    }

    if (this.baseURL) {
      return this.baseURL
    }

    if (typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)) {
      return 'http://localhost:8000'
    }

    return ''
  }

  private emitSseEvent(rawEvent: string, onEvent: (evt: InkwiseSseEvent) => void): void {
    if (!rawEvent.trim()) return

    let event = 'message'
    const dataLines: string[] = []
    for (const line of rawEvent.split('\n')) {
      if (!line || line.startsWith(':')) continue
      if (line.startsWith('event:')) {
        event = line.slice(6).trim()
        continue
      }
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart())
      }
    }

    const dataStr = dataLines.join('\n')
    let parsed: any = dataStr
    try {
      parsed = JSON.parse(dataStr)
    } catch {
      // keep string
    }

    onEvent({ event, data: parsed })
  }

  private async streamSse(
    path: string,
    body: unknown,
    onEvent: (evt: InkwiseSseEvent) => void,
    opts?: { signal?: AbortSignal }
  ): Promise<void> {
    const token = await this.getAuthToken()
    const response = await fetch(`${this.getStreamingBaseURL()}${path}`, {
      method: 'POST',
      signal: opts?.signal,
      headers: {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      let bodyJson: any = null
      let message = `HTTP ${response.status}`
      try {
        bodyJson = await response.json()
        message = bodyJson?.detail || bodyJson?.message || message
      } catch {
        // ignore
      }
      throw new ApiError(response.status, message, bodyJson)
    }

    if (!response.body) return
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      buffer = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

      while (true) {
        const idx = buffer.indexOf('\n\n')
        if (idx === -1) break
        const raw = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        this.emitSseEvent(raw, onEvent)
      }
    }

    buffer += decoder.decode()
    buffer = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    if (buffer.trim()) {
      this.emitSseEvent(buffer, onEvent)
    }
  }

  // ===========================================================================
  // Analytics — firms / team
  // ===========================================================================

  async getCurrentAnalyticsFirm(): Promise<ApiResponse<ApiPaths['/api/analytics/firm']['get']>> {
    return this.request('/api/analytics/firm')
  }

  async getAnalyticsFirmOnboardingStatus(): Promise<
    ApiResponse<ApiPaths['/api/analytics/firm/onboarding-status']['get']>
  > {
    return this.request('/api/analytics/firm/onboarding-status')
  }

  async createAnalyticsFirm(
    data: ApiRequest<ApiPaths['/api/analytics/firm/create']['post']>
  ): Promise<ApiResponse<ApiPaths['/api/analytics/firm/create']['post']>> {
    return this.request('/api/analytics/firm/create', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async joinAnalyticsFirm(
    data: ApiRequest<ApiPaths['/api/analytics/firm/join']['post']>
  ): Promise<ApiResponse<ApiPaths['/api/analytics/firm/join']['post']>> {
    return this.request('/api/analytics/firm/join', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async generateAnalyticsFirmInviteCode(): Promise<
    ApiResponse<ApiPaths['/api/analytics/firm/invite-code']['post']>
  > {
    return this.request('/api/analytics/firm/invite-code', { method: 'POST' })
  }

  async updateAnalyticsFirm(
    data: ApiRequest<ApiPaths['/api/analytics/firm']['put']>
  ): Promise<ApiResponse<ApiPaths['/api/analytics/firm']['put']>> {
    return this.request('/api/analytics/firm', {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async removeAnalyticsFirmMember(memberUserId: string): Promise<{ success: boolean }> {
    return this.request(`/api/analytics/firm/members/${encodeURIComponent(memberUserId)}`, {
      method: 'DELETE',
    })
  }

  async updateAnalyticsFirmMember(
    memberUserId: string,
    data: ApiRequest<ApiPaths['/api/analytics/firm/members/{member_user_id}']['put']>
  ): Promise<ApiResponse<ApiPaths['/api/analytics/firm/members/{member_user_id}']['put']>> {
    return this.request(`/api/analytics/firm/members/${encodeURIComponent(memberUserId)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async listFirmAuditLogs(
    limit = 50
  ): Promise<ApiResponse<ApiPaths['/api/analytics/firm/audit-logs']['get']>> {
    const params = new URLSearchParams({ limit: String(limit) })
    return this.request(`/api/analytics/firm/audit-logs?${params.toString()}`)
  }

  async exportFirmData(): Promise<ApiResponse<ApiPaths['/api/analytics/firm/export']['post']>> {
    return this.request('/api/analytics/firm/export', { method: 'POST' })
  }

  async purgeFirm(): Promise<ApiResponse<ApiPaths['/api/analytics/firm']['delete']>> {
    return this.request('/api/analytics/firm', { method: 'DELETE' })
  }

  // ===========================================================================
  // Analytics — clients
  // ===========================================================================

  async listAnalyticsClients(): Promise<ApiResponse<ApiPaths['/api/analytics/clients']['get']>> {
    return this.request('/api/analytics/clients')
  }

  async createAnalyticsClient(
    data: ApiRequest<ApiPaths['/api/analytics/clients']['post']>
  ): Promise<ApiResponse<ApiPaths['/api/analytics/clients']['post']>> {
    return this.request('/api/analytics/clients', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async getAnalyticsClient(
    clientId: string
  ): Promise<ApiResponse<ApiPaths['/api/analytics/clients/{client_id}']['get']>> {
    return this.request(`/api/analytics/clients/${encodeURIComponent(clientId)}`)
  }

  async updateAnalyticsClient(
    clientId: string,
    data: ApiRequest<ApiPaths['/api/analytics/clients/{client_id}']['put']>
  ): Promise<ApiResponse<ApiPaths['/api/analytics/clients/{client_id}']['put']>> {
    return this.request(`/api/analytics/clients/${encodeURIComponent(clientId)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async deleteAnalyticsClient(clientId: string): Promise<{ success: boolean }> {
    return this.request(`/api/analytics/clients/${encodeURIComponent(clientId)}`, {
      method: 'DELETE',
    })
  }

  // ===========================================================================
  // Analytics — research (IRS / GAAP) chat sessions
  // ===========================================================================

  async listAnalyticsResearchSessions(
    bot: 'irs' | 'gaap'
  ): Promise<ApiResponse<ApiPaths['/api/analytics/research/sessions/{bot}']['get']>> {
    return this.request(`/api/analytics/research/sessions/${bot}`)
  }

  async getAnalyticsResearchSession(
    bot: 'irs' | 'gaap',
    sessionId: string
  ): Promise<ApiResponse<ApiPaths['/api/analytics/research/sessions/{bot}/{session_id}']['get']>> {
    return this.request(`/api/analytics/research/sessions/${bot}/${encodeURIComponent(sessionId)}`)
  }

  async updateAnalyticsResearchSession(
    bot: 'irs' | 'gaap',
    sessionId: string,
    data: ApiRequest<ApiPaths['/api/analytics/research/sessions/{bot}/{session_id}']['put']>
  ): Promise<ApiResponse<ApiPaths['/api/analytics/research/sessions/{bot}/{session_id}']['put']>> {
    return this.request(`/api/analytics/research/sessions/${bot}/${encodeURIComponent(sessionId)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async deleteAnalyticsResearchSession(
    bot: 'irs' | 'gaap',
    sessionId: string
  ): Promise<{ success: boolean }> {
    return this.request(`/api/analytics/research/sessions/${bot}/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    })
  }

  // ===========================================================================
  // Analytics — document extraction
  // ===========================================================================

  /**
   * LLM-extract a summary + structured fields from uploaded document text.
   * Used by the research bots before chat to build context. (The AI assistant
   * is ephemeral and does not persist sessions.)
   */
  async extractAnalyticsDocument(
    data: ApiRequest<ApiPaths['/api/analytics/assistant/document-extract']['post']>
  ): Promise<ApiResponse<ApiPaths['/api/analytics/assistant/document-extract']['post']>> {
    return this.request('/api/analytics/assistant/document-extract', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  // ===========================================================================
  // Analytics — waterfall (revenue-recognition / deferral schedules)
  // ===========================================================================

  /** LLM-extract waterfall fields (subtype, party, amount, dates) from document text. */
  async extractAnalyticsWaterfall(
    data: ApiRequest<ApiPaths['/api/analytics/waterfall/extract']['post']>
  ): Promise<ApiResponse<ApiPaths['/api/analytics/waterfall/extract']['post']>> {
    return this.request('/api/analytics/waterfall/extract', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async listAnalyticsWaterfalls(): Promise<ApiResponse<ApiPaths['/api/analytics/waterfall']['get']>> {
    return this.request('/api/analytics/waterfall')
  }

  async createAnalyticsWaterfall(
    data: ApiRequest<ApiPaths['/api/analytics/waterfall']['post']>
  ): Promise<ApiResponse<ApiPaths['/api/analytics/waterfall']['post']>> {
    return this.request('/api/analytics/waterfall', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async getAnalyticsWaterfall(
    analysisId: string
  ): Promise<ApiResponse<ApiPaths['/api/analytics/waterfall/{analysis_id}']['get']>> {
    return this.request(`/api/analytics/waterfall/${encodeURIComponent(analysisId)}`)
  }

  async updateAnalyticsWaterfall(
    analysisId: string,
    data: ApiRequest<ApiPaths['/api/analytics/waterfall/{analysis_id}']['put']>
  ): Promise<ApiResponse<ApiPaths['/api/analytics/waterfall/{analysis_id}']['put']>> {
    return this.request(`/api/analytics/waterfall/${encodeURIComponent(analysisId)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async deleteAnalyticsWaterfall(analysisId: string): Promise<{ success: boolean }> {
    return this.request(`/api/analytics/waterfall/${encodeURIComponent(analysisId)}`, {
      method: 'DELETE',
    })
  }

  // ===========================================================================
  // Analytics — amortization (assets, leases, loans, intangibles, MACRS)
  // ===========================================================================

  /** LLM-extract asset details from document text. */
  async extractAnalyticsAmortization(
    data: ApiRequest<ApiPaths['/api/analytics/amortization/extract']['post']>
  ): Promise<ApiResponse<ApiPaths['/api/analytics/amortization/extract']['post']>> {
    return this.request('/api/analytics/amortization/extract', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  /** LLM ASC/GAAP compliance check on a form. */
  async complianceCheckAnalyticsAmortization(
    data: ApiRequest<ApiPaths['/api/analytics/amortization/compliance']['post']>
  ): Promise<ApiResponse<ApiPaths['/api/analytics/amortization/compliance']['post']>> {
    return this.request('/api/analytics/amortization/compliance', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  /** Deterministic schedule generation (SL, DDB, loan, leases, MACRS). No LLM. */
  async generateAnalyticsAmortizationSchedule(
    data: ApiRequest<ApiPaths['/api/analytics/amortization/schedule']['post']>
  ): Promise<ApiResponse<ApiPaths['/api/analytics/amortization/schedule']['post']>> {
    return this.request('/api/analytics/amortization/schedule', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async listAnalyticsAmortizations(): Promise<
    ApiResponse<ApiPaths['/api/analytics/amortization']['get']>
  > {
    return this.request('/api/analytics/amortization')
  }

  async createAnalyticsAmortization(
    data: ApiRequest<ApiPaths['/api/analytics/amortization']['post']>
  ): Promise<ApiResponse<ApiPaths['/api/analytics/amortization']['post']>> {
    return this.request('/api/analytics/amortization', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async getAnalyticsAmortization(
    amortizationId: string
  ): Promise<ApiResponse<ApiPaths['/api/analytics/amortization/{amortization_id}']['get']>> {
    return this.request(`/api/analytics/amortization/${encodeURIComponent(amortizationId)}`)
  }

  async updateAnalyticsAmortization(
    amortizationId: string,
    data: ApiRequest<ApiPaths['/api/analytics/amortization/{amortization_id}']['put']>
  ): Promise<ApiResponse<ApiPaths['/api/analytics/amortization/{amortization_id}']['put']>> {
    return this.request(`/api/analytics/amortization/${encodeURIComponent(amortizationId)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async deleteAnalyticsAmortization(amortizationId: string): Promise<{ success: boolean }> {
    return this.request(`/api/analytics/amortization/${encodeURIComponent(amortizationId)}`, {
      method: 'DELETE',
    })
  }

  async listAnalyticsJournalEntries(
    amortizationId?: string
  ): Promise<ApiResponse<ApiPaths['/api/analytics/amortization/journal-entries/list']['get']>> {
    const qs = amortizationId
      ? `?amortization_id=${encodeURIComponent(amortizationId)}`
      : ''
    return this.request(`/api/analytics/amortization/journal-entries/list${qs}`)
  }

  async createAnalyticsJournalEntry(
    data: ApiRequest<ApiPaths['/api/analytics/amortization/journal-entries']['post']>
  ): Promise<ApiResponse<ApiPaths['/api/analytics/amortization/journal-entries']['post']>> {
    return this.request('/api/analytics/amortization/journal-entries', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  // ===========================================================================
  // Analytics — reconciliation (two-source matching with LLM-generated rules)
  // ===========================================================================

  /** LLM-generate matching rule passes from the column headers of both sources. */
  async generateReconciliationRules(
    data: ApiRequest<ApiPaths['/api/analytics/reconciliation/rules/generate']['post']>
  ): Promise<ApiResponse<ApiPaths['/api/analytics/reconciliation/rules/generate']['post']>> {
    return this.request('/api/analytics/reconciliation/rules/generate', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  /** LLM-refine rules with natural-language instructions to produce one more pass. */
  async generateAdditionalReconciliationPass(
    data: ApiRequest<ApiPaths['/api/analytics/reconciliation/rules/additional']['post']>
  ): Promise<ApiResponse<ApiPaths['/api/analytics/reconciliation/rules/additional']['post']>> {
    return this.request('/api/analytics/reconciliation/rules/additional', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  /** LLM-execute the rule passes against both sources, returning match groups. */
  async performReconciliationMatch(
    data: ApiRequest<ApiPaths['/api/analytics/reconciliation/match']['post']>
  ): Promise<ApiResponse<ApiPaths['/api/analytics/reconciliation/match']['post']>> {
    return this.request('/api/analytics/reconciliation/match', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  /** Deterministic-ish basic reconciliation (no rule definitions needed). */
  async reconcileBasic(
    data: ApiRequest<ApiPaths['/api/analytics/reconciliation/basic']['post']>
  ): Promise<ApiResponse<ApiPaths['/api/analytics/reconciliation/basic']['post']>> {
    return this.request('/api/analytics/reconciliation/basic', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async listAnalyticsReconciliations(): Promise<
    ApiResponse<ApiPaths['/api/analytics/reconciliation']['get']>
  > {
    return this.request('/api/analytics/reconciliation')
  }

  async createAnalyticsReconciliation(
    data: ApiRequest<ApiPaths['/api/analytics/reconciliation']['post']>
  ): Promise<ApiResponse<ApiPaths['/api/analytics/reconciliation']['post']>> {
    return this.request('/api/analytics/reconciliation', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async getAnalyticsReconciliation(
    reconciliationId: string
  ): Promise<ApiResponse<ApiPaths['/api/analytics/reconciliation/{reconciliation_id}']['get']>> {
    return this.request(`/api/analytics/reconciliation/${encodeURIComponent(reconciliationId)}`)
  }

  async updateAnalyticsReconciliation(
    reconciliationId: string,
    data: ApiRequest<ApiPaths['/api/analytics/reconciliation/{reconciliation_id}']['put']>
  ): Promise<ApiResponse<ApiPaths['/api/analytics/reconciliation/{reconciliation_id}']['put']>> {
    return this.request(`/api/analytics/reconciliation/${encodeURIComponent(reconciliationId)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async deleteAnalyticsReconciliation(reconciliationId: string): Promise<{ success: boolean }> {
    return this.request(`/api/analytics/reconciliation/${encodeURIComponent(reconciliationId)}`, {
      method: 'DELETE',
    })
  }

  /** Manually pair selected unmatched rows into a new approved match group. */
  async manualMatchReconciliation(
    reconciliationId: string,
    data: ApiRequest<
      ApiPaths['/api/analytics/reconciliation/{reconciliation_id}/manual-match']['post']
    >
  ): Promise<
    ApiResponse<ApiPaths['/api/analytics/reconciliation/{reconciliation_id}/manual-match']['post']>
  > {
    return this.request(
      `/api/analytics/reconciliation/${encodeURIComponent(reconciliationId)}/manual-match`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    )
  }

  async approveReconciliationGroup(
    reconciliationId: string,
    groupId: string
  ): Promise<
    ApiResponse<
      ApiPaths['/api/analytics/reconciliation/{reconciliation_id}/match-groups/{group_id}/approve']['post']
    >
  > {
    return this.request(
      `/api/analytics/reconciliation/${encodeURIComponent(reconciliationId)}/match-groups/${encodeURIComponent(groupId)}/approve`,
      { method: 'POST' }
    )
  }

  async rejectReconciliationGroup(
    reconciliationId: string,
    groupId: string
  ): Promise<
    ApiResponse<
      ApiPaths['/api/analytics/reconciliation/{reconciliation_id}/match-groups/{group_id}/reject']['post']
    >
  > {
    return this.request(
      `/api/analytics/reconciliation/${encodeURIComponent(reconciliationId)}/match-groups/${encodeURIComponent(groupId)}/reject`,
      { method: 'POST' }
    )
  }

  /**
   * Update an unmatched transaction's exception status / note. Manually typed —
   * regenerate `api-types` once the backend is running to fold this into the
   * generated `ApiPaths`. Returns the full reconciliation record.
   */
  async updateReconciliationException(
    reconciliationId: string,
    txnId: string,
    data: {
      source: 'A' | 'B'
      exceptionStatus?: 'open' | 'investigating' | 'resolved' | 'waived'
      exceptionNote?: string
    }
  ): Promise<
    ApiResponse<
      ApiPaths['/api/analytics/reconciliation/{reconciliation_id}']['get']
    >
  > {
    return this.request(
      `/api/analytics/reconciliation/${encodeURIComponent(reconciliationId)}/exceptions/${encodeURIComponent(txnId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(data),
      }
    )
  }

  // ===========================================================================
  // Analytics — variance (flux analysis on `analyses` rows, type='variance')
  // ===========================================================================

  /** LLM-suggest materiality thresholds ($ + %) from a raw GL sample. */
  async suggestVarianceThreshold(
    data: ApiRequest<ApiPaths['/api/analytics/variance/threshold']['post']>
  ): Promise<ApiResponse<ApiPaths['/api/analytics/variance/threshold']['post']>> {
    return this.request('/api/analytics/variance/threshold', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  /** LLM-generate per-row variance explanations for flagged rows. */
  async analyzeVariance(
    data: ApiRequest<ApiPaths['/api/analytics/variance/analyze']['post']>
  ): Promise<ApiResponse<ApiPaths['/api/analytics/variance/analyze']['post']>> {
    return this.request('/api/analytics/variance/analyze', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  /** LLM-generate a markdown variance memo. */
  async generateVarianceMemo(
    data: ApiRequest<ApiPaths['/api/analytics/variance/memo']['post']>
  ): Promise<ApiResponse<ApiPaths['/api/analytics/variance/memo']['post']>> {
    return this.request('/api/analytics/variance/memo', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async listAnalyticsVariances(): Promise<
    ApiResponse<ApiPaths['/api/analytics/variance']['get']>
  > {
    return this.request('/api/analytics/variance')
  }

  async createAnalyticsVariance(
    data: ApiRequest<ApiPaths['/api/analytics/variance']['post']>
  ): Promise<ApiResponse<ApiPaths['/api/analytics/variance']['post']>> {
    return this.request('/api/analytics/variance', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async getAnalyticsVariance(
    analysisId: string
  ): Promise<ApiResponse<ApiPaths['/api/analytics/variance/{analysis_id}']['get']>> {
    return this.request(`/api/analytics/variance/${encodeURIComponent(analysisId)}`)
  }

  async updateAnalyticsVariance(
    analysisId: string,
    data: ApiRequest<ApiPaths['/api/analytics/variance/{analysis_id}']['put']>
  ): Promise<ApiResponse<ApiPaths['/api/analytics/variance/{analysis_id}']['put']>> {
    return this.request(`/api/analytics/variance/${encodeURIComponent(analysisId)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async deleteAnalyticsVariance(analysisId: string): Promise<{ success: boolean }> {
    return this.request(`/api/analytics/variance/${encodeURIComponent(analysisId)}`, {
      method: 'DELETE',
    })
  }

  // ===========================================================================
  // Analytics — comments (generic per-entity threads with @mentions)
  // ===========================================================================

  async listAnalyticsComments(
    entityType: string,
    entityId: string
  ): Promise<ApiResponse<ApiPaths['/api/analytics/comments']['get']>> {
    const params = new URLSearchParams({ entity_type: entityType, entity_id: entityId })
    return this.request(`/api/analytics/comments?${params.toString()}`)
  }

  async createAnalyticsComment(
    data: ApiRequest<ApiPaths['/api/analytics/comments']['post']>
  ): Promise<ApiResponse<ApiPaths['/api/analytics/comments']['post']>> {
    return this.request('/api/analytics/comments', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateAnalyticsComment(
    commentId: string,
    data: ApiRequest<ApiPaths['/api/analytics/comments/{comment_id}']['patch']>
  ): Promise<ApiResponse<ApiPaths['/api/analytics/comments/{comment_id}']['patch']>> {
    return this.request(`/api/analytics/comments/${encodeURIComponent(commentId)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }

  async deleteAnalyticsComment(commentId: string): Promise<{ success: boolean }> {
    return this.request(`/api/analytics/comments/${encodeURIComponent(commentId)}`, {
      method: 'DELETE',
    })
  }

  // ===========================================================================
  // Analytics — streaming (research bots + AI assistant)
  // ===========================================================================

  async streamAnalyticsResearch(
    bot: 'irs' | 'gaap',
    data: ApiRequest<ApiPaths['/api/analytics/research/irs/stream']['post']>,
    handlers: AnalyticsStreamHandlers,
    opts?: { signal?: AbortSignal }
  ): Promise<void> {
    return this.streamAnalyticsSse(`/api/analytics/research/${bot}/stream`, data, handlers, opts)
  }

  async streamAnalyticsAssistant(
    data: ApiRequest<ApiPaths['/api/analytics/assistant/stream']['post']>,
    handlers: AnalyticsStreamHandlers,
    opts?: { signal?: AbortSignal }
  ): Promise<void> {
    return this.streamAnalyticsSse('/api/analytics/assistant/stream', data, handlers, opts)
  }

  private async streamAnalyticsSse(
    path: string,
    body: unknown,
    handlers: AnalyticsStreamHandlers,
    opts?: { signal?: AbortSignal }
  ): Promise<void> {
    const token = await this.getAuthToken()
    const response = await fetch(`${this.getStreamingBaseURL()}${path}`, {
      method: 'POST',
      signal: opts?.signal,
      headers: {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      let bodyJson: any = null
      let message = `HTTP ${response.status}`
      try {
        bodyJson = await response.json()
        message = bodyJson?.detail || bodyJson?.message || message
      } catch {
        // ignore
      }
      throw new ApiError(response.status, message, bodyJson)
    }

    if (!response.body) return
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    const emit = (rawEvent: string) => {
      if (!rawEvent.trim()) return
      const dataLines: string[] = []
      for (const line of rawEvent.split('\n')) {
        if (!line || line.startsWith(':')) continue
        if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
      }
      const dataStr = dataLines.join('\n')
      if (!dataStr) return
      if (dataStr === '[DONE]') return
      try {
        const parsed = JSON.parse(dataStr)
        if (typeof parsed?.text === 'string') {
          handlers.onChunk?.(parsed.text)
        } else if (parsed?.usage) {
          handlers.onUsage?.(parsed.usage as AnalyticsStreamUsage)
        } else if (parsed?.session) {
          handlers.onSession?.(parsed.session as AnalyticsStreamSession)
        } else if (parsed?.grounding) {
          handlers.onGrounding?.(parsed.grounding as AnalyticsStreamGrounding)
        } else if (parsed?.error) {
          handlers.onError?.(String(parsed.error))
        }
      } catch {
        // non-JSON keepalive — ignore
      }
    }

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      buffer = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

      while (true) {
        const idx = buffer.indexOf('\n\n')
        if (idx === -1) break
        const raw = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        emit(raw)
      }
    }

    buffer += decoder.decode()
    buffer = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    if (buffer.trim()) emit(buffer)
  }

  // ===========================================================================
  // Chrona — paired time-tracking devices + dashboard
  // ===========================================================================

  async listChronaDevices(): Promise<ApiResponse<ApiPaths['/api/chrona/devices']['get']>> {
    return this.request('/api/chrona/devices')
  }

  async generateChronaPairingCode(
    data: ApiRequest<ApiPaths['/api/chrona/pairing-codes']['post']>
  ): Promise<ApiResponse<ApiPaths['/api/chrona/pairing-codes']['post']>> {
    return this.request('/api/chrona/pairing-codes', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async listChronaPairingCodes(): Promise<
    ApiResponse<ApiPaths['/api/chrona/pairing-codes']['get']>
  > {
    return this.request('/api/chrona/pairing-codes')
  }

  async renameChronaDevice(
    deviceId: string,
    data: ApiRequest<ApiPaths['/api/chrona/devices/{device_id}']['patch']>
  ): Promise<ApiResponse<ApiPaths['/api/chrona/devices/{device_id}']['patch']>> {
    return this.request(`/api/chrona/devices/${encodeURIComponent(deviceId)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }

  async revokeChronaDevice(
    deviceId: string,
    options?: { purge?: boolean }
  ): Promise<ApiResponse<ApiPaths['/api/chrona/devices/{device_id}']['delete']>> {
    const params = new URLSearchParams()
    if (options?.purge) params.set('purge', 'true')
    const qs = params.toString()
    return this.request(`/api/chrona/devices/${encodeURIComponent(deviceId)}${qs ? `?${qs}` : ''}`, {
      method: 'DELETE',
    })
  }

  async getChronaSummary(options: {
    from: string
    to: string
    deviceId?: string
  }): Promise<ApiResponse<ApiPaths['/api/chrona/dashboard/summary']['get']>> {
    const params = new URLSearchParams({ from: options.from, to: options.to })
    if (options.deviceId) params.set('device_id', options.deviceId)
    return this.request(`/api/chrona/dashboard/summary?${params.toString()}`)
  }

  async getChronaTimeline(options: {
    deviceId: string
    day: string
  }): Promise<ApiResponse<ApiPaths['/api/chrona/dashboard/timeline']['get']>> {
    const params = new URLSearchParams({ device_id: options.deviceId, day: options.day })
    return this.request(`/api/chrona/dashboard/timeline?${params.toString()}`)
  }

  async exportChronaCSV(options: {
    from: string
    to: string
    deviceId?: string
  }): Promise<{ blob: Blob; filename: string }> {
    const token = await this.getAuthToken()
    const params = new URLSearchParams({ from: options.from, to: options.to })
    if (options.deviceId) params.set('device_id', options.deviceId)

    const response = await fetch(`${this.baseURL}/api/chrona/dashboard/export.csv?${params.toString()}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'CSV export failed' }))
      throw new Error(error.detail || error.message || 'CSV export failed')
    }

    const blob = await response.blob()
    const filename = response.headers.get('Content-Disposition')?.match(/filename=(.+)/)?.[1] || 'chrona_export.csv'
    return { blob, filename: filename.replace(/"/g, '') }
  }

  // ==========================================================================
  // E-Signature endpoints
  // ==========================================================================

  private async requestMultipart<T>(path: string, formData: FormData, method: 'POST' | 'PUT' = 'POST'): Promise<T> {
    const token = await this.getAuthToken()
    const response = await fetch(`${this.baseURL}${path}`, {
      method,
      headers: {
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: formData,
    })

    if (!response.ok) {
      let body: any = null
      let message = `HTTP ${response.status}`
      try {
        body = await response.json()
        message = body?.detail || body?.message || message
      } catch {
        try {
          const text = await response.text()
          if (text) message = text
        } catch {
          // ignore
        }
      }
      throw new ApiError(response.status, message, body)
    }

    return response.json()
  }

  async createEsignEnvelope(params: {
    title?: string
    message?: string
    signingType?: string
    expiresInDays?: number
    reminderIntervalHours?: number
    templateId?: string
    brandId?: string
    files?: File[]
  }): Promise<EsignEnvelopeCreateResponse> {
    const formData = new FormData()
    if (params.title) formData.append('title', params.title)
    if (params.message) formData.append('message', params.message)
    if (params.signingType) formData.append('signing_type', params.signingType)
    if (params.expiresInDays !== undefined) formData.append('expires_in_days', String(params.expiresInDays))
    if (params.reminderIntervalHours !== undefined) {
      formData.append('reminder_interval_hours', String(params.reminderIntervalHours))
    }
    if (params.templateId) formData.append('template_id', params.templateId)
    if (params.brandId) formData.append('brand_id', params.brandId)
    params.files?.forEach((file) => formData.append('files', file))
    return this.requestMultipart('/api/esign/envelopes', formData)
  }

  async listEsignEnvelopes(params: {
    limit?: number
    offset?: number
    status?: string
    sourceType?: 'manual' | 'bulk' | 'powerform'
    sourceId?: string
    templateVersionId?: string
    q?: string
    sortBy?: 'updated_at' | 'created_at' | 'sent_at' | 'completed_at' | 'title'
    sortDir?: 'asc' | 'desc'
    scope?: 'mine' | 'shared' | 'firm'
    ownerUserId?: string
  } = {}): Promise<EsignEnvelopeListResponse> {
    const searchParams = new URLSearchParams({
      limit: String(params.limit ?? 25),
      offset: String(params.offset ?? 0),
    })
    if (params.status) searchParams.set('status', params.status)
    if (params.sourceType) searchParams.set('source_type', params.sourceType)
    if (params.sourceId) searchParams.set('source_id', params.sourceId)
    if (params.templateVersionId) searchParams.set('template_version_id', params.templateVersionId)
    if (params.q) searchParams.set('q', params.q)
    if (params.sortBy) searchParams.set('sort_by', params.sortBy)
    if (params.sortDir) searchParams.set('sort_dir', params.sortDir)
    if (params.scope) searchParams.set('scope', params.scope)
    if (params.ownerUserId) searchParams.set('owner_user_id', params.ownerUserId)
    return this.request(`/api/esign/envelopes?${searchParams.toString()}`)
  }

  async getEsignContext(): Promise<EsignContext> {
    return this.request('/api/esign/context')
  }

  async getEsignAdminOverview(): Promise<EsignAdminOverview> {
    return this.request('/api/esign/admin/overview')
  }

  async getEsignAdminSettings(): Promise<Record<string, any>> {
    return this.request('/api/esign/admin/settings')
  }

  async updateEsignAdminSettings(payload: Record<string, any>): Promise<Record<string, any>> {
    return this.request('/api/esign/admin/settings', { method: 'PUT', body: JSON.stringify(payload) })
  }

  async listEsignPermissionProfiles(): Promise<{ profiles: EsignPermissionProfile[] }> {
    return this.request('/api/esign/admin/permission-profiles')
  }

  async createEsignPermissionProfile(payload: { name: string; capabilities: Record<string, boolean> }): Promise<EsignPermissionProfile> {
    return this.request('/api/esign/admin/permission-profiles', { method: 'POST', body: JSON.stringify(payload) })
  }

  async assignEsignPermissionProfile(userId: string, profileId: string): Promise<Record<string, any>> {
    return this.request(`/api/esign/admin/users/${userId}/permission-profile`, { method: 'PUT', body: JSON.stringify({ profile_id: profileId }) })
  }

  async listEsignBrands(): Promise<{ brands: Record<string, any>[] }> {
    return this.request('/api/esign/admin/brands')
  }

  async createEsignBrand(payload: Record<string, any>): Promise<Record<string, any>> {
    return this.request('/api/esign/admin/brands', { method: 'POST', body: JSON.stringify(payload) })
  }

  async listEsignFirmWebhooks(): Promise<{ configurations: EsignWebhookConfiguration[] }> {
    return this.request('/api/esign/admin/webhooks')
  }

  async createEsignFirmWebhook(payload: { endpoint_url: string; enabled?: boolean; event_filters?: string[]; include_completed_documents?: boolean }): Promise<EsignWebhookConfiguration> {
    return this.request('/api/esign/admin/webhooks', { method: 'POST', body: JSON.stringify(payload) })
  }

  async listEsignWebhookDeliveries(status?: string): Promise<{ deliveries: Record<string, any>[] }> {
    return this.request(`/api/esign/admin/webhook-deliveries${status ? `?status=${encodeURIComponent(status)}` : ''}`)
  }

  async replayEsignWebhook(deliveryId: string): Promise<Record<string, any>> {
    return this.request(`/api/esign/admin/webhook-deliveries/${deliveryId}/replay`, { method: 'POST' })
  }

  async getEsignEnvelopeAccess(envelopeId: string): Promise<{ owner_id: string; grants: Record<string, any>[] }> {
    return this.request(`/api/esign/envelopes/${envelopeId}/access`)
  }

  async grantEsignEnvelopeAccess(envelopeId: string, userId: string, accessLevel: 'view' | 'manage'): Promise<Record<string, any>> {
    return this.request(`/api/esign/envelopes/${envelopeId}/access`, { method: 'PUT', body: JSON.stringify({ user_id: userId, access_level: accessLevel }) })
  }

  async transferEsignEnvelope(envelopeId: string, successorUserId: string, retainPreviousOwnerView = true): Promise<Record<string, any>> {
    return this.request(`/api/esign/envelopes/${envelopeId}/transfer`, { method: 'POST', body: JSON.stringify({ successor_user_id: successorUserId, retain_previous_owner_view: retainPreviousOwnerView }) })
  }

  async getEsignEnvelope(envelopeId: string): Promise<EsignEnvelopeResponse> {
    return this.request(`/api/esign/envelopes/${envelopeId}`)
  }

  async updateEsignEnvelope(envelopeId: string, payload: EsignEnvelopeUpdateRequest): Promise<EsignEnvelopeResponse> {
    return this.request(`/api/esign/envelopes/${envelopeId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  }

  async updateEsignEnvelopeDeliverySettings(
    envelopeId: string,
    payload: EsignEnvelopeDeliverySettingsUpdateRequest,
  ): Promise<EsignEnvelopeResponse> {
    return this.request(`/api/esign/envelopes/${envelopeId}/delivery-settings`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
  }

  async deleteEsignEnvelope(envelopeId: string): Promise<{ message: string }> {
    return this.request(`/api/esign/envelopes/${envelopeId}`, {
      method: 'DELETE',
    })
  }

  async addEsignDocuments(envelopeId: string, files: File[]): Promise<EsignEnvelopeResponse> {
    const formData = new FormData()
    files.forEach((file) => formData.append('files', file))
    return this.requestMultipart(`/api/esign/envelopes/${envelopeId}/documents`, formData)
  }

  async deleteEsignDocument(envelopeId: string, documentId: string): Promise<EsignEnvelopeResponse> {
    return this.request(`/api/esign/envelopes/${envelopeId}/documents/${documentId}`, {
      method: 'DELETE',
    })
  }

  async reorderEsignDocuments(envelopeId: string, documentIds: string[]): Promise<EsignEnvelopeResponse> {
    return this.request(`/api/esign/envelopes/${envelopeId}/documents/order`, {
      method: 'PATCH',
      body: JSON.stringify({ document_ids: documentIds }),
    })
  }

  async inspectEsignPdfWidgets(envelopeId: string, documentId: string): Promise<EsignPdfWidgetInspectionResponse> {
    return this.request(`/api/esign/envelopes/${envelopeId}/documents/${documentId}/pdf-widgets`)
  }

  async convertEsignPdfWidgets(
    envelopeId: string,
    documentId: string,
    payload: EsignPdfWidgetConversionRequest,
  ): Promise<EsignEnvelopeResponse> {
    return this.request(`/api/esign/envelopes/${envelopeId}/documents/${documentId}/convert-pdf-fields`, {
      method: 'POST', body: JSON.stringify(payload),
    })
  }

  async replaceEsignRecipients(
    envelopeId: string,
    recipients: EsignRecipientInput[],
    templateId?: string,
    expectedRevision?: number,
  ): Promise<EsignEnvelopeResponse> {
    const query = templateId ? `?template_id=${encodeURIComponent(templateId)}` : ''
    return this.request(`/api/esign/envelopes/${envelopeId}/recipients${query}`, {
      method: 'PUT',
      body: JSON.stringify({ recipients, expected_revision: expectedRevision }),
    })
  }

  async replaceEsignFields(envelopeId: string, fields: EsignFieldInput[], expectedRevision?: number): Promise<EsignEnvelopeResponse> {
    return this.request(`/api/esign/envelopes/${envelopeId}/fields`, {
      method: 'PUT',
      body: JSON.stringify({ fields, expected_revision: expectedRevision }),
    })
  }

  async createEsignAiFieldPlacementRun(
    targetType: 'envelope' | 'template', targetId: string,
    payload: { scope: 'all_documents' | 'active_document'; document_id?: string; instructions?: string; expected_revision: number },
  ): Promise<EsignAiFieldPlacementRun> {
    const collection = targetType === 'envelope' ? 'envelopes' : 'templates'
    return this.request(`/api/esign/${collection}/${targetId}/ai-field-placement-runs`, { method: 'POST', body: JSON.stringify(payload) })
  }

  async listEsignAiFieldPlacementRuns(targetType: 'envelope' | 'template', targetId: string): Promise<{ runs: EsignAiFieldPlacementRun[] }> {
    const collection = targetType === 'envelope' ? 'envelopes' : 'templates'
    return this.request(`/api/esign/${collection}/${targetId}/ai-field-placement-runs`)
  }

  async getEsignAiFieldPlacementRun(runId: string): Promise<EsignAiFieldPlacementRun> {
    return this.request(`/api/esign/ai-field-placement-runs/${runId}`)
  }

  async applyEsignAiFieldPlacementRun(runId: string, acceptedProposalIds: string[], currentRevision: number): Promise<EsignAiFieldPlacementAction> {
    return this.request(`/api/esign/ai-field-placement-runs/${runId}/apply`, {
      method: 'POST', body: JSON.stringify({ accepted_proposal_ids: acceptedProposalIds, current_revision: currentRevision }),
    })
  }

  async discardEsignAiFieldPlacementRun(runId: string): Promise<EsignAiFieldPlacementAction> {
    return this.request(`/api/esign/ai-field-placement-runs/${runId}/discard`, { method: 'POST', body: '{}' })
  }

  async correctEsignFields(envelopeId: string, payload: { fields: EsignFieldInput[]; reason: string; expected_routing_version: number }): Promise<EsignEnvelopeResponse> {
    return this.request(`/api/esign/envelopes/${envelopeId}/corrections/fields`, {
      method: 'PUT', body: JSON.stringify(payload),
    })
  }

  async replaceActiveEsignDocument(envelopeId: string, documentId: string, file: File, reason: string, expectedRoutingVersion: number): Promise<EsignEnvelopeResponse> {
    const form = new FormData()
    form.append('file', file)
    form.append('reason', reason)
    form.append('expected_routing_version', String(expectedRoutingVersion))
    return this.requestMultipart(`/api/esign/envelopes/${envelopeId}/corrections/documents/${documentId}`, form, 'PUT')
  }

  async searchEsignAnchors(
    envelopeId: string,
    payload: { anchor: string; case_sensitive?: boolean; whole_word?: boolean; document_ids?: string[]; page_numbers?: number[]; match_mode?: 'first' | 'all'; relative_position?: 'auto' | 'center' | 'right' | 'left' | 'below' | 'above'; cross_axis_alignment?: 'auto' | 'start' | 'center' | 'end'; horizontal_alignment?: 'left' | 'center' | 'right' | 'after'; offset_x?: number; offset_y?: number; offset_unit?: 'point' | 'mm' | 'inch'; field_width?: number; field_height?: number },
  ): Promise<EsignAnchorSearchResponse> {
    return this.request(`/api/esign/envelopes/${envelopeId}/anchor-search`, {
      method: 'POST', body: JSON.stringify(payload),
    })
  }

  async searchEsignTemplateAnchors(
    templateId: string,
    payload: { anchor: string; case_sensitive?: boolean; whole_word?: boolean; document_ids?: string[]; page_numbers?: number[]; match_mode?: 'first' | 'all'; relative_position?: 'auto' | 'center' | 'right' | 'left' | 'below' | 'above'; cross_axis_alignment?: 'auto' | 'start' | 'center' | 'end'; horizontal_alignment?: 'left' | 'center' | 'right' | 'after'; offset_x?: number; offset_y?: number; offset_unit?: 'point' | 'mm' | 'inch'; field_width?: number; field_height?: number },
  ): Promise<EsignAnchorSearchResponse> {
    return this.request(`/api/esign/templates/${templateId}/anchor-search`, {
      method: 'POST', body: JSON.stringify(payload),
    })
  }

  async sendEsignEnvelope(envelopeId: string): Promise<EsignEnvelopeResponse> {
    return this.request(`/api/esign/envelopes/${envelopeId}/send`, { method: 'POST', body: '{}' })
  }

  async voidEsignEnvelope(envelopeId: string, reason: string): Promise<EsignEnvelopeResponse> {
    return this.request(`/api/esign/envelopes/${envelopeId}/void`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    })
  }

  async cloneAndVoidEsignEnvelope(
    envelopeId: string,
    reason: string,
    expectedRoutingVersion: number,
  ): Promise<{ original: EsignEnvelopeResponse; clone: EsignEnvelopeResponse }> {
    return this.request(`/api/esign/envelopes/${envelopeId}/clone-and-void`, {
      method: 'POST',
      body: JSON.stringify({ reason, expected_routing_version: expectedRoutingVersion }),
    })
  }

  async remindEsignEnvelope(envelopeId: string): Promise<{ reminded: string[] }> {
    return this.request(`/api/esign/envelopes/${envelopeId}/remind`, { method: 'POST', body: '{}' })
  }

  async saveEsignEnvelopeAsTemplate(
    envelopeId: string,
    name: string,
    description?: string
  ): Promise<EsignTemplateResponse> {
    return this.request(`/api/esign/envelopes/${envelopeId}/save-as-template`, {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    })
  }

  async getEsignAuditTrail(envelopeId: string): Promise<EsignAuditTrailResponse> {
    return this.request(`/api/esign/envelopes/${envelopeId}/audit`)
  }

  async getEsignDocumentDownload(envelopeId: string, documentId: string): Promise<EsignDownloadResponse> {
    return this.request(`/api/esign/envelopes/${envelopeId}/documents/${documentId}/download`)
  }

  async getEsignSealedDownload(envelopeId: string): Promise<EsignDownloadResponse> {
    return this.request(`/api/esign/envelopes/${envelopeId}/sealed/download`)
  }

  async getEsignCertificateDownload(envelopeId: string): Promise<EsignDownloadResponse> {
    return this.request(`/api/esign/envelopes/${envelopeId}/certificate/download`)
  }

  async getEsignInbox(params: { q?: string; state?: 'pending' | 'completed' } = {}): Promise<EsignInboxResponse> {
    const searchParams = new URLSearchParams()
    if (params.q) searchParams.set('q', params.q)
    if (params.state) searchParams.set('state', params.state)
    const query = searchParams.toString()
    return this.request(`/api/esign/inbox${query ? `?${query}` : ''}`)
  }

  async getEsignSigningSession(envelopeId: string): Promise<EsignSigningSessionResponse> {
    return this.request(`/api/esign/sign/${envelopeId}`)
  }

  async recordEsignConsent(envelopeId: string, expectedRoutingVersion: number): Promise<EsignConsentResponse> {
    return this.request(`/api/esign/sign/${envelopeId}/consent`, {
      method: 'POST', body: JSON.stringify({ expected_routing_version: expectedRoutingVersion }),
    })
  }

  async saveEsignSigningProgress(
    envelopeId: string,
    fieldValues: { field_id: string; value?: string | null }[],
    expectedRoutingVersion: number,
    marks?: apiComponents['schemas']['EsignMarkBundle'],
  ): Promise<{ saved_count: number }> {
    return this.request(`/api/esign/sign/${envelopeId}/progress`, {
      method: 'PUT',
      body: JSON.stringify({ field_values: fieldValues, expected_routing_version: expectedRoutingVersion, marks }),
    })
  }

  async uploadEsignSignerAttachment(envelopeId: string, fieldId: string, file: File): Promise<EsignSignerAttachmentResponse> {
    const formData = new FormData()
    formData.append('field_id', fieldId)
    formData.append('file', file)
    return this.requestMultipart(`/api/esign/sign/${envelopeId}/attachments`, formData)
  }

  async deleteEsignSignerAttachment(envelopeId: string, attachmentId: string): Promise<{ message: string }> {
    return this.request(`/api/esign/sign/${envelopeId}/attachments/${attachmentId}`, { method: 'DELETE' })
  }

  async submitEsignSignature(envelopeId: string, payload: EsignSubmitRequest): Promise<EsignSubmitResponse> {
    return this.request(`/api/esign/sign/${envelopeId}/submit`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }

  async declineEsignEnvelope(envelopeId: string, reason: string, expectedRoutingVersion: number): Promise<EsignSubmitResponse> {
    return this.request(`/api/esign/sign/${envelopeId}/decline`, {
      method: 'POST',
      body: JSON.stringify({ reason, expected_routing_version: expectedRoutingVersion }),
    })
  }

  async correctEsignRecipients(envelopeId: string, payload: EsignCorrectionRequest): Promise<EsignEnvelopeResponse> {
    return this.request(`/api/esign/envelopes/${envelopeId}/corrections`, {
      method: 'POST', body: JSON.stringify(payload),
    })
  }

  async reassignEsignRecipient(envelopeId: string, payload: EsignReassignRequest): Promise<EsignRecipientResponse> {
    return this.request(`/api/esign/sign/${envelopeId}/reassign`, {
      method: 'POST', body: JSON.stringify(payload),
    })
  }

  async approveEsignEnvelope(envelopeId: string, expectedRoutingVersion: number): Promise<EsignSubmitResponse> {
    return this.request(`/api/esign/sign/${envelopeId}/approve`, {
      method: 'POST', body: JSON.stringify({ expected_routing_version: expectedRoutingVersion }),
    })
  }

  async updateEsignManagedRecipients(envelopeId: string, payload: EsignManagedRecipientsRequest): Promise<EsignManagedRecipientsResponse> {
    return this.request(`/api/esign/sign/${envelopeId}/managed-recipients`, {
      method: 'PATCH', body: JSON.stringify(payload),
    })
  }

  async completeEsignManagerStep(envelopeId: string, expectedRoutingVersion: number): Promise<EsignSubmitResponse> {
    return this.request(`/api/esign/sign/${envelopeId}/manager-complete`, {
      method: 'POST', body: JSON.stringify({ expected_routing_version: expectedRoutingVersion }),
    })
  }

  async configureEsignWitness(envelopeId: string, payload: EsignWitnessRequest): Promise<EsignGuestInvitationResponse> {
    return this.request(`/api/esign/sign/${envelopeId}/witness`, {
      method: 'PUT', body: JSON.stringify(payload),
    })
  }

  async startEsignInPerson(envelopeId: string, payload: EsignInPersonStartRequest): Promise<EsignGuestInvitationResponse> {
    return this.request(`/api/esign/sign/${envelopeId}/in-person/start`, {
      method: 'POST', body: JSON.stringify(payload),
    })
  }

  async verifyEsignDocument(params: { envelopeId?: string; file?: File }): Promise<EsignVerifyResponse> {
    const formData = new FormData()
    if (params.envelopeId) formData.append('envelope_id', params.envelopeId)
    if (params.file) formData.append('file', params.file)
    return this.requestMultipart('/api/esign/verify', formData)
  }

  async createEsignTemplate(params: {
    name: string
    description?: string
    title?: string
    message?: string
    signingType?: string
    recipientRoles?: EsignTemplateRoleInput[]
    brandId?: string
    files: File[]
  }): Promise<EsignTemplateResponse> {
    const formData = new FormData()
    formData.append('name', params.name)
    if (params.description) formData.append('description', params.description)
    if (params.title) formData.append('title', params.title)
    if (params.message) formData.append('message', params.message)
    if (params.signingType) formData.append('signing_type', params.signingType)
    if (params.recipientRoles) formData.append('recipient_roles', JSON.stringify(params.recipientRoles))
    if (params.brandId) formData.append('brand_id', params.brandId)
    params.files.forEach((file) => formData.append('files', file))
    return this.requestMultipart('/api/esign/templates', formData)
  }

  async listEsignTemplates(includeArchived = false): Promise<EsignTemplateListResponse> {
    return this.request(`/api/esign/templates${includeArchived ? '?include_archived=true' : ''}`)
  }

  async getEsignTemplate(templateId: string): Promise<EsignTemplateResponse> {
    return this.request(`/api/esign/templates/${templateId}`)
  }

  async updateEsignTemplate(templateId: string, payload: EsignTemplateUpdateRequest): Promise<EsignTemplateResponse> {
    return this.request(`/api/esign/templates/${templateId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  }

  async deleteEsignTemplate(templateId: string): Promise<{ message: string }> {
    return this.request(`/api/esign/templates/${templateId}`, { method: 'DELETE' })
  }

  async getEsignTemplateDocumentDownload(templateId: string, documentId: string): Promise<EsignDownloadResponse> {
    return this.request(`/api/esign/templates/${templateId}/documents/${documentId}/download`)
  }

  async addEsignTemplateDocuments(templateId: string, files: File[]): Promise<EsignTemplateResponse> {
    const form = new FormData(); files.forEach(file => form.append('files', file))
    return this.requestMultipart(`/api/esign/templates/${templateId}/documents`, form)
  }

  async deleteEsignTemplateDocument(templateId: string, documentId: string): Promise<EsignTemplateResponse> {
    return this.request(`/api/esign/templates/${templateId}/documents/${documentId}`, { method: 'DELETE' })
  }

  async publishEsignTemplate(templateId: string, expectedRevision?: number): Promise<EsignTemplateVersionResponse> {
    const query = expectedRevision ? `?expected_revision=${expectedRevision}` : ''
    return this.request(`/api/esign/templates/${templateId}/versions${query}`, { method: 'POST', body: '{}' })
  }

  async listEsignTemplateVersions(templateId: string): Promise<EsignTemplateVersionListResponse> {
    return this.request(`/api/esign/templates/${templateId}/versions`)
  }

  async createEsignTemplateDraftFromVersion(versionId: string): Promise<EsignTemplateResponse> {
    return this.request(`/api/esign/template-versions/${versionId}/draft`, { method: 'POST', body: '{}' })
  }

  async downloadEsignBulkSample(versionId: string): Promise<Blob> {
    const token = await this.getAuthToken()
    const response = await fetch(`${this.baseURL}/api/esign/template-versions/${versionId}/bulk-sample.csv`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!response.ok) throw new ApiError(response.status, 'Could not download the CSV sample')
    return response.blob()
  }

  async downloadEsignBulkErrors(jobId: string): Promise<Blob> {
    const token = await this.getAuthToken()
    const response = await fetch(`${this.baseURL}/api/esign/bulk-jobs/${jobId}/errors.csv`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!response.ok) throw new ApiError(response.status, 'Could not download row errors')
    return response.blob()
  }

  async createEsignBulkJob(templateVersionId: string, file: File, defaultSchedule?: { at: string; timezone: string }): Promise<EsignBulkJobResponse> {
    const form = new FormData()
    form.append('template_version_id', templateVersionId)
    form.append('file', file)
    if (defaultSchedule) { form.append('default_schedule_at', defaultSchedule.at); form.append('default_schedule_timezone', defaultSchedule.timezone) }
    return this.requestMultipart('/api/esign/bulk-jobs', form)
  }

  async listEsignBulkJobs(): Promise<EsignBulkJobListResponse> {
    return this.request('/api/esign/bulk-jobs')
  }

  async getEsignBulkJob(jobId: string): Promise<EsignBulkJobResponse> {
    return this.request(`/api/esign/bulk-jobs/${jobId}`)
  }

  async confirmEsignBulkJob(jobId: string): Promise<EsignBulkJobResponse> {
    return this.request(`/api/esign/bulk-jobs/${jobId}/confirm`, { method: 'POST', body: '{}' })
  }

  async cancelEsignBulkJob(jobId: string): Promise<EsignBulkJobResponse> {
    return this.request(`/api/esign/bulk-jobs/${jobId}/cancel`, { method: 'POST', body: '{}' })
  }

  async retryEsignBulkJob(jobId: string): Promise<EsignBulkJobResponse> {
    return this.request(`/api/esign/bulk-jobs/${jobId}/retry`, { method: 'POST', body: '{}' })
  }

  async createEsignPowerForm(payload: EsignPowerFormCreateRequest): Promise<EsignPowerFormResponse> {
    return this.request('/api/esign/powerforms', { method: 'POST', body: JSON.stringify(payload) })
  }

  async listEsignPowerForms(): Promise<EsignPowerFormListResponse> {
    return this.request('/api/esign/powerforms')
  }

  async setEsignPowerFormState(id: string, state: 'active' | 'paused' | 'revoked'): Promise<EsignPowerFormResponse> {
    return this.request(`/api/esign/powerforms/${id}/state/${state}`, { method: 'POST', body: '{}' })
  }

  async rotateEsignPowerForm(id: string): Promise<EsignPowerFormResponse> {
    return this.request(`/api/esign/powerforms/${id}/rotate`, { method: 'POST', body: '{}' })
  }

  async listEsignPowerFormSubmissions(id: string): Promise<{ submissions: EsignPowerFormSubmission[] }> {
    return this.request(`/api/esign/powerforms/${id}/submissions`)
  }

  async retryEsignPowerFormSubmission(id: string, submissionId: string): Promise<EsignPowerFormSubmission> {
    return this.request(`/api/esign/powerforms/${id}/submissions/${submissionId}/retry`, { method: 'POST', body: '{}' })
  }

  async previewEsignPowerFormUpgrade(id: string, versionId: string): Promise<EsignPowerFormUpgradePreview> {
    return this.request(`/api/esign/powerforms/${id}/upgrade/${versionId}/preview`)
  }

  async upgradeEsignPowerForm(id: string, versionId: string): Promise<EsignPowerFormResponse> {
    return this.request(`/api/esign/powerforms/${id}/upgrade/${versionId}`, { method: 'POST', body: '{}' })
  }

  private esignReportQuery(params: EsignReportFilters): URLSearchParams {
    return buildEsignReportQuery(params)
  }

  async getEsignReportSummary(params: EsignReportFilters): Promise<EsignReportSummary> {
    const query = this.esignReportQuery(params)
    return this.request(`/api/esign/reports/summary?${query}`)
  }

  async getEsignReportTimeSeries(params: EsignReportFilters): Promise<{ points: EsignReportPoint[] }> {
    return this.request(`/api/esign/reports/time-series?${this.esignReportQuery(params)}`)
  }

  async downloadEsignReportDetails(params: EsignReportFilters): Promise<Blob> {
    const token = await this.getAuthToken(); const query = this.esignReportQuery(params)
    const response = await fetch(`${this.baseURL}/api/esign/reports/details.csv?${query}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    if (!response.ok) throw new ApiError(response.status, 'Could not export report details')
    return response.blob()
  }

  async scheduleEsignEnvelope(envelopeId: string, payload: EsignScheduleRequest): Promise<EsignEnvelopeResponse> {
    return this.request(`/api/esign/envelopes/${envelopeId}/schedule`, { method: 'POST', body: JSON.stringify(payload) })
  }

  async unscheduleEsignEnvelope(envelopeId: string): Promise<EsignEnvelopeResponse> {
    return this.request(`/api/esign/envelopes/${envelopeId}/unschedule`, { method: 'POST', body: '{}' })
  }

  async retryFailedEsignSend(envelopeId: string): Promise<EsignEnvelopeResponse> {
    return this.request(`/api/esign/envelopes/${envelopeId}/retry-send`, { method: 'POST', body: '{}' })
  }

  async recoverFailedEsignSendDraft(envelopeId: string): Promise<EsignEnvelopeResponse> {
    return this.request(`/api/esign/envelopes/${envelopeId}/recover-draft`, { method: 'POST', body: '{}' })
  }

  async revokeEsignEnvelopeAccess(envelopeId: string, userId: string): Promise<{ success: boolean }> {
    return this.request(`/api/esign/envelopes/${envelopeId}/access/${encodeURIComponent(userId)}`, { method: 'DELETE' })
  }

  async updateEsignPermissionProfile(profileId: string, payload: { name: string; capabilities: Record<string, boolean> }): Promise<EsignPermissionProfile> {
    return this.request(`/api/esign/admin/permission-profiles/${profileId}`, { method: 'PUT', body: JSON.stringify(payload) })
  }

  async updateEsignBrand(brandId: string, payload: Record<string, any>): Promise<Record<string, any>> {
    return this.request(`/api/esign/admin/brands/${brandId}`, { method: 'PUT', body: JSON.stringify(payload) })
  }

  async uploadEsignBrandAsset(file: File): Promise<{ id: string; content_type: string; sha256: string; file_size_bytes: number }> {
    const form = new FormData(); form.append('file', file)
    return this.requestMultipart('/api/esign/admin/brand-assets', form)
  }

  async updateEsignWebhook(id: string, payload: { endpoint_url: string; enabled: boolean; event_filters: string[]; include_completed_documents: boolean }): Promise<EsignWebhookConfiguration> {
    return this.request(`/api/esign/admin/webhooks/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
  }

  async rotateEsignWebhookSecret(id: string): Promise<{ id: string; secret: string; overlap_expires_at: string }> {
    return this.request(`/api/esign/admin/webhooks/${id}/rotate-secret`, { method: 'POST', body: '{}' })
  }

  async testEsignWebhook(id: string): Promise<{ delivery_id: string; status: string }> {
    return this.request(`/api/esign/admin/webhooks/${id}/test`, { method: 'POST', body: '{}' })
  }

  async disableEsignWebhook(id: string): Promise<{ success: boolean }> {
    return this.request(`/api/esign/admin/webhooks/${id}`, { method: 'DELETE' })
  }

  async getEsignWebhookAttempts(deliveryId: string): Promise<{ attempts: EsignWebhookAttempt[] }> {
    return this.request(`/api/esign/admin/webhook-deliveries/${deliveryId}/attempts`)
  }

  async getEsignCustodyReview(): Promise<{ assets: EsignCustodyIssue[] }> {
    return this.request('/api/esign/admin/custody-review')
  }

  async remediateEsignCustody(payload: { asset_type: EsignCustodyIssue['asset_type']; asset_id: string; successor_user_id: string }): Promise<Record<string, string>> {
    return this.request('/api/esign/admin/custody-review/remediate', { method: 'POST', body: JSON.stringify(payload) })
  }

  async getEsignAdminAudit(filters: EsignAuditFilters = {}): Promise<{ events: EsignAdminAuditEvent[] }> {
    const query = new URLSearchParams()
    if (filters.eventType) query.set('event_type', filters.eventType)
    if (filters.actorEmail) query.set('actor_email', filters.actorEmail)
    if (filters.targetType) query.set('target_type', filters.targetType)
    if (filters.start) query.set('start', filters.start)
    if (filters.end) query.set('end', filters.end)
    return this.request(`/api/esign/admin/audit?${query}`)
  }

  async downloadEsignAdminAudit(filters: EsignAuditFilters = {}): Promise<Blob> {
    const token = await this.getAuthToken(); const query = new URLSearchParams()
    if (filters.eventType) query.set('event_type', filters.eventType)
    if (filters.actorEmail) query.set('actor_email', filters.actorEmail)
    if (filters.targetType) query.set('target_type', filters.targetType)
    if (filters.start) query.set('start', filters.start)
    if (filters.end) query.set('end', filters.end)
    const response = await fetch(`${this.baseURL}/api/esign/admin/audit.csv?${query}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    if (!response.ok) throw new ApiError(response.status, 'Could not export audit events')
    return response.blob()
  }

}

export interface AnalyticsStreamUsage {
  prompt_tokens?: number | null
  output_tokens?: number | null
  total_tokens?: number | null
  pages?: number | null
}

/** The newly-created (or continued) chat session a stream's transcript was saved to. */
export interface AnalyticsStreamSession {
  id: string
  title?: string | null
}

export type AnalyticsUploadedDoc = components['schemas']['UploadedDoc']

/** Web search grounding metadata (e.g. Google Search sources backing a response). */
export interface AnalyticsStreamGrounding {
  sources: { domain?: string; title?: string; url?: string }[]
}

export interface AnalyticsStreamHandlers {
  onChunk?: (text: string) => void
  onUsage?: (usage: AnalyticsStreamUsage) => void
  /** Fired once after persistence with the session id (+ generated title). */
  onSession?: (session: AnalyticsStreamSession) => void
  /** Fired when the stream emits web-search grounding sources. */
  onGrounding?: (grounding: AnalyticsStreamGrounding) => void
  onError?: (message: string) => void
}

// ---------------------------------------------------------------------------
// E-Signature types (from generated OpenAPI schemas)
// ---------------------------------------------------------------------------
import type { components as apiComponents } from './api-types'

export type EsignEnvelopeResponse = apiComponents['schemas']['EsignEnvelopeResponse']
export type EsignEnvelopeCreateResponse = apiComponents['schemas']['EsignEnvelopeCreateResponse']
export type EsignEnvelopeListResponse = apiComponents['schemas']['EsignEnvelopeListResponse']
export type EsignEnvelopeListItem = apiComponents['schemas']['EsignEnvelopeListItem']
export type EsignEnvelopeUpdateRequest = apiComponents['schemas']['EsignEnvelopeUpdateRequest']
export type EsignEnvelopeDeliverySettingsUpdateRequest = apiComponents['schemas']['EsignEnvelopeDeliverySettingsUpdateRequest']
export type EsignRecipientInput = apiComponents['schemas']['EsignRecipientInput']
export type EsignRecipientResponse = apiComponents['schemas']['EsignRecipientResponse']
export type EsignFieldInput = apiComponents['schemas']['EsignFieldInput']
export type EsignFieldResponse = apiComponents['schemas']['EsignFieldResponse']
export type EsignAnchorSearchResponse = apiComponents['schemas']['EsignAnchorSearchResponse']
export type EsignDocumentResponse = apiComponents['schemas']['EsignDocumentResponse']
export type EsignAuditTrailResponse = apiComponents['schemas']['EsignAuditTrailResponse']
export type EsignEventResponse = apiComponents['schemas']['EsignEventResponse']
export type EsignDownloadResponse = apiComponents['schemas']['EsignDownloadResponse']
export type EsignInboxResponse = apiComponents['schemas']['EsignInboxResponse']
export type EsignInboxItem = apiComponents['schemas']['EsignInboxItem']
export type EsignSigningSessionResponse = apiComponents['schemas']['EsignSigningSessionResponse']
export type EsignSigningDocument = apiComponents['schemas']['EsignSigningDocument']
export type EsignSignerAttachmentResponse = apiComponents['schemas']['EsignSignerAttachmentResponse']
export type EsignConsentResponse = apiComponents['schemas']['EsignConsentResponse']
export type EsignSubmitRequest = apiComponents['schemas']['EsignSubmitRequest']
export type EsignFieldValueInput = apiComponents['schemas']['EsignFieldValueInput']
export type EsignFieldProperties = apiComponents['schemas']['EsignFieldProperties']
export type EsignPdfWidget = apiComponents['schemas']['EsignPdfWidget']
export type EsignPdfWidgetInspectionResponse = apiComponents['schemas']['EsignPdfWidgetInspectionResponse']
export type EsignPdfWidgetConversionRequest = apiComponents['schemas']['EsignPdfWidgetConversionRequest']
export type EsignSubmitResponse = apiComponents['schemas']['EsignSubmitResponse']
export type EsignSignatureInput = apiComponents['schemas']['EsignSignatureInput']
export type EsignCorrectionRequest = apiComponents['schemas']['EsignCorrectionRequest']
export type EsignReassignRequest = apiComponents['schemas']['EsignReassignRequest']
export type EsignManagedRecipientsRequest = apiComponents['schemas']['EsignManagedRecipientsRequest']
export type EsignManagedRecipientsResponse = apiComponents['schemas']['EsignManagedRecipientsResponse']
export type EsignWitnessRequest = apiComponents['schemas']['EsignWitnessRequest']
export type EsignInPersonStartRequest = apiComponents['schemas']['EsignInPersonStartRequest']
export type EsignGuestInvitationResponse = apiComponents['schemas']['EsignGuestInvitationResponse']
export type EsignVerifyResponse = apiComponents['schemas']['EsignVerifyResponse']
export type EsignTemplateResponse = apiComponents['schemas']['EsignTemplateResponse'] & { archived_at?: string | null }
export type EsignTemplateListResponse = Omit<apiComponents['schemas']['EsignTemplateListResponse'], 'templates'> & { templates: EsignTemplateResponse[] }
export type EsignTemplateRoleInput = apiComponents['schemas']['EsignTemplateRoleInput']
export type EsignTemplateUpdateRequest = apiComponents['schemas']['EsignTemplateUpdateRequest']
export type EsignTemplateFieldInput = apiComponents['schemas']['EsignTemplateFieldInput']
export type EsignTemplateVersionResponse = apiComponents['schemas']['EsignTemplateVersionResponse']
export type EsignTemplateVersionListResponse = apiComponents['schemas']['EsignTemplateVersionListResponse']
export type EsignBulkJobResponse = apiComponents['schemas']['EsignBulkJobResponse']
export type EsignBulkJobListResponse = apiComponents['schemas']['EsignBulkJobListResponse']
export type EsignPowerFormCreateRequest = apiComponents['schemas']['EsignPowerFormCreateRequest']
export type EsignPowerFormResponse = apiComponents['schemas']['EsignPowerFormResponse']
export type EsignPowerFormListResponse = apiComponents['schemas']['EsignPowerFormListResponse']
export type EsignReportSummary = apiComponents['schemas']['EsignReportSummary']
export type EsignScheduleRequest = apiComponents['schemas']['EsignScheduleRequest']

export const apiClient = new ApiClient()

// Export commonly used types
export type UserResponse = ApiResponse<ApiPaths['/api/users/me']['get']>
export type TemplatesResponse = ApiResponse<ApiPaths['/api/templates']['get']>
export type SubscriptionStatus = ApiResponse<ApiPaths['/api/stripe/subscription-status']['get']>

// Job-related types
export type JobInitiateResponse = ApiResponse<ApiPaths['/api/jobs/initiate']['post']>
export type JobDetailsResponse = ApiResponse<ApiPaths['/api/jobs/{job_id}']['get']>
export type JobListResponse = ApiResponse<ApiPaths['/api/jobs']['get']>
export type JobProgressResponse = ApiResponse<ApiPaths['/api/jobs/{job_id}/progress']['get']>
export type JobFilesResponse = ApiResponse<ApiPaths['/api/jobs/{job_id}/files']['get']>
export type JobResultsResponse = {
  total: number
  files_processed_count: number
  results: Array<{
    task_id: string
    source_files: string[]
    processing_mode: string
    extracted_data: Record<string, any>
    result_set_index?: number
  }>
}

// Job Runs types
export type JobRunListResponse = ApiResponse<ApiPaths['/api/jobs/{job_id}/runs']['get']>
export type JobRunCreateRequest = ApiRequest<ApiPaths['/api/jobs/{job_id}/runs']['post']>
export type JobRunCreateResponse = ApiResponse<ApiPaths['/api/jobs/{job_id}/runs']['post']>
export type JobRunDetailsResponse = ApiResponse<ApiPaths['/api/jobs/{job_id}/runs/{run_id}']['get']>

// Import types from generated OpenAPI schema
import { components } from './api-types'

export type JobStatus = components['schemas']['JobStatus']
export type ProcessingMode = components['schemas']['ProcessingMode']
export type FileUploadInfo = components['schemas']['FileUploadInfo']
// These models exist in the backend but are not currently referenced by any OpenAPI endpoint.
// Keep local definitions so the frontend can type its internal workflow state.
export type TaskDefinition = {
  path: string
  mode: ProcessingMode
  file_count?: number
}

export type JobFieldConfig = {
  field_name: string
  data_type_id: string
  ai_prompt: string
  display_order?: number
}
export type JobListItem = components['schemas']['JobListItem']
export type JobFileInfo = components['schemas']['JobFileInfo']
export type FileStatus = components['schemas']['FileStatus']

// All-runs file info (for CPE tracker) - manual type until OpenAPI is regenerated
export interface JobFileAllRunsInfo {
  id: string
  original_path: string
  original_filename: string
  file_size_bytes: number
  status: FileStatus
  job_run_id: string
  run_created_at?: string
  run_status?: string
}

export interface JobFilesAllRunsResponse {
  files: JobFileAllRunsInfo[]
}

// Job Runs component types
export type JobRunListItem = components['schemas']['JobRunListItem']

// Frontend-specific types for the multi-step workflow
export interface FrontendUploadFile {
  file: File
  path: string
  uploadUrl?: string
  uploaded: boolean
  error?: string
}

// Backend file structure (what the workflow maps from backend JobFileInfo).
export interface UploadedFile {
  original_filename: string
  original_path: string
  size_bytes: number
  status: 'ready' | 'extracting' | 'extracted' | 'failed'
}

export interface WorkflowStep {
  id: string
  title: string
  description: string
  completed: boolean
  current: boolean
}

export interface JobWorkflowState {
  currentStep: number
  jobId?: string
  files: UploadedFile[]
  fields: JobFieldConfig[]
  taskDefinitions: TaskDefinition[]
  jobName?: string
  templateId?: string
}

// Data types interface matching backend DataTypeResponse
export interface DataType {
  id: string
  display_name: string
  description: string
  base_json_type: string
  json_format?: string
  display_order: number
}

// Export field configuration type from the generated types
export type FieldConfig = {
  name: string
  data_type: string
  prompt: string
}

export interface FormFillTemplate {
  id: string
  name: string
  description?: string | null
  original_filename: string
  file_type: string
  allow_docx_table_expansion: boolean
  fill_chronologically: boolean
  file_size_bytes: number
  page_count?: number | null
  created_at: string
  updated_at: string
}

export interface FormFillTemplateListResponse {
  templates: FormFillTemplate[]
}

export interface FormFillExtractionSourcePreview {
  job_id: string
  run_id: string
  task_id?: string | null
  source_scope?: 'task' | 'all'
  source_files: string[]
  columns: string[]
  rows: any[][]
}

export interface FormFillRun {
  id: string
  status: string
  source_mode: string
  source_filename?: string | null
  source_file_type?: string | null
  source_files: FormFillSourceFile[]
  source_payload?: Record<string, any> | null
  source_job_id?: string | null
  source_run_id?: string | null
  source_task_id?: string | null
  target_mode: string
  target_template_id?: string | null
  target_filename: string
  target_file_type: string
  target_page_count?: number | null
  allow_docx_table_expansion: boolean
  fill_chronologically: boolean
  output_format: string
  repeat_mode: 'single' | 'source_rows' | 'all_sources' | string
  total_outputs: number
  completed_outputs: number
  failed_outputs: number
  usage_basis?: string | null
  usage_pages?: number | null
  processing_strategy?: string | null
  warnings: string[]
  fill_plan?: Record<string, any> | null
  outputs: FormFillOutput[]
  result_filename?: string | null
  result_file_type?: string | null
  error_message?: string | null
  created_at: string
  updated_at: string
  completed_at?: string | null
}

export interface FormFillSourceFile {
  id: string
  original_filename: string
  file_type: string
  file_size_bytes: number
  display_order: number
}

export interface FormFillOutput {
  id: string
  record_index: number
  record_label: string
  status: string
  warnings: string[]
  fill_plan?: Record<string, any> | null
  result_filename?: string | null
  result_file_type?: string | null
  error_message?: string | null
  created_at: string
  updated_at: string
  completed_at?: string | null
}

export interface FormFillRunCreateResponse {
  run: FormFillRun
  message: string
}

export interface FormFillRunListResponse {
  runs: FormFillRun[]
  total: number
  limit: number
  offset: number
}

export interface CreateFormFillRunParams {
  sourceFiles?: File[]
  targetFile?: File
  templateId?: string
  outputFormat?: 'pdf' | 'docx'
  repeatMode?: 'single' | 'source_rows' | 'all_sources'
  allowDocxTableExpansion?: boolean
  fillChronologically?: boolean
  saveTemplateName?: string
  saveTemplateDescription?: string
  sourceJobId?: string
  sourceRunId?: string
  sourceTaskId?: string
  sourceScope?: 'task' | 'all'
}

// CPE Tracker types
export interface CpeStateResponse {
  template_id: string
  name: string
}

export interface CpeStatesListResponse {
  states: CpeStateResponse[]
}

export interface CpeSheetListItem {
  job_id: string
  name: string
  state_name?: string
  status: string
  config_step: string
  created_at: string
  latest_run_id?: string
}

export interface CpeSheetsListResponse {
  sheets: CpeSheetListItem[]
  total: number
}

export interface CreateCpeSheetResponse {
  job_id: string
  run_id: string
  message: string
}

export interface StartCpeSheetResponse {
  active_run_id: string
  message: string
}

export type InkwiseSseEvent = {
  event: string
  data: any
}

export interface InkwiseEvidenceLocator {
  kind?: string
  page_start?: number | null
  page_end?: number | null
  page_numbers?: number[] | null
  [key: string]: any
}

export type InkwiseCitationStyle = 'default' | 'apa' | 'mla' | 'chicago' | 'bluebook' | 'none'

export interface InkwiseBibliographicMetadata {
  citation_type?: 'book' | 'article' | 'case' | 'statute' | 'webpage' | 'report' | 'other' | null
  authors?: string[]
  editors?: string[]
  title?: string | null
  short_title?: string | null
  container_title?: string | null
  publisher?: string | null
  edition?: string | null
  volume?: string | null
  issue?: string | null
  pages?: string | null
  year?: string | null
  month?: string | null
  day?: string | null
  url?: string | null
  accessed_date?: string | null
  court?: string | null
  reporter?: string | null
  reporter_volume?: string | null
  first_page?: string | null
  pin_cite?: string | null
  docket_number?: string | null
}

export interface InkwiseCitationHighlight {
  start: number
  end: number
}

export interface InkwiseCitationReference {
  id: string
  highlight?: InkwiseCitationHighlight | null
  page_number?: number | null
  locator_json?: InkwiseEvidenceLocator | null
}

export interface InkwiseCitation {
  evidence_id?: string
  source_id?: string
  source_title?: string
  page_number?: number
  modality?: string | null
  segment_type?: string | null
  segment_id?: string | null
  segment_title?: string | null
  locator_json?: InkwiseEvidenceLocator | null
  preview_bucket?: string | null
  preview_object?: string | null
  excerpt?: string
  highlights?: InkwiseCitationHighlight[] | null
  references?: InkwiseCitationReference[] | null
  bibliographic_metadata?: InkwiseBibliographicMetadata | null
  score?: number | null
}

export interface InkwiseGroundedSegment {
  text: string
  citation_ids?: string[]
}

export interface InkwiseDocument {
  id: string
  user_id: string
  folder_id?: string | null
  title: string
  content_json: Record<string, any> | null
  content_html: string | null
  init_prompt: string | null
  language?: string | null
  citation_style: InkwiseCitationStyle
  version: number
  created_at: string
  updated_at: string
}

export interface InkwiseDocumentRevision {
  id: string
  document_id: string
  user_id: string
  revision_number: number
  title: string
  content_json: Record<string, any> | null
  content_html: string | null
  init_prompt: string | null
  language?: string | null
  citation_style: InkwiseCitationStyle
  document_version: number
  source_kind: string
  source_meta?: Record<string, any> | null
  created_at: string
}

export interface InkwiseDocumentRevisionListResponse {
  document_id: string
  items: InkwiseDocumentRevision[]
}

export interface InkwiseDocumentFolder {
  id: string
  user_id: string
  name: string
  created_at: string
  updated_at: string
}

export interface InkwiseDocumentFolderListResponse {
  items: InkwiseDocumentFolder[]
}

export interface InkwisePaginatedDocuments {
  items: InkwiseDocument[]
  page: number
  limit: number
  total: number
}

export interface InkwiseDocumentCreateRequest {
  title?: string | null
  folder_id?: string | null
  content_json?: Record<string, any> | null
  content_html?: string | null
  init_prompt?: string | null
  language?: string | null
  citation_style?: InkwiseCitationStyle | null
}

export interface InkwiseDocumentUpdateRequest extends InkwiseDocumentCreateRequest {
  version: number
}

export interface InkwiseSource {
  id: string
  type: string
  title: string
  original_filename: string | null
  original_path?: string | null
  content_type: string
  size_bytes: number
  checksum_sha256: string | null
  source_url?: string | null
  external_source?: string | null
  external_id?: string | null
  external_meta?: Record<string, any> | null
  bibliographic_metadata?: InkwiseBibliographicMetadata | null
  status: string
  failure_code?: string | null
  failure_detail?: string | null
  created_at: string
  updated_at: string
}

export interface InkwisePaginatedSources {
  items: InkwiseSource[]
  page: number
  limit: number
  total: number
}

export interface InkwiseSourceUploadInitRequest {
  original_filename: string
  content_type: string
  size_bytes: number
  title?: string | null
  original_path?: string | null
}

export interface InkwiseSourceUpdateRequest {
  title?: string | null
  bibliographic_metadata?: InkwiseBibliographicMetadata | null
}

export interface InkwiseWebpageCaptureRequest {
  source_url: string
  title?: string | null
  bibliographic_metadata?: InkwiseBibliographicMetadata | null
}

export interface InkwiseSourceUploadInitResponse {
  source: InkwiseSource
  upload: {
    method: string
    url: string
    headers: Record<string, string>
    expires_at: string
  }
}

export interface InkwiseSourceImportResponse {
  sources: InkwiseSource[]
  expanded_archives: number
  message: string
}

export interface InkwiseSignedUrlResponse {
  url: string
  expires_at: string
}

export interface InkwiseAssetPreviewRequest {
  bucket?: string | null
  object_name: string
  disposition_filename?: string | null
}

export interface InkwiseSourceIngestion {
  id: string
  source_id: string
  pipeline: string
  status: string
  extraction_engine?: string | null
  canonical_pdf_gcs_bucket?: string | null
  canonical_pdf_gcs_object?: string | null
  normalizer_version?: string | null
  embedding_model?: string | null
  embedding_dimension?: number | null
  embedding_location?: string | null
  started_at?: string | null
  finished_at?: string | null
  page_count?: number | null
  usage_basis?: string | null
  usage_tokens?: number | null
  segment_count?: number | null
  provider_document_name?: string | null
  preview_manifest_bucket?: string | null
  preview_manifest_object?: string | null
  error_json?: Record<string, any> | null
  created_at: string
}

export interface InkwiseSourceIngestionListResponse {
  source_id?: string | null
  ingestions: InkwiseSourceIngestion[]
}

export interface InkwiseDocumentFolderCreateRequest {
  name: string
}

export interface InkwiseDocumentFolderUpdateRequest {
  name: string
}

export interface InkwiseBoundSource {
  binding_id: string
  source: InkwiseSource
  is_active: boolean
  grounded_chat_ready: boolean
  grounded_chat_reason?: string | null
}

export interface InkwiseDocumentBoundSources {
  document_id: string
  sources: InkwiseBoundSource[]
}

export interface InkwiseBindSourcesResponse {
  document_id: string
  bound_source_ids: string[]
}

export interface InkwiseTemplate {
  id: string
  user_id: string
  title: string
  description?: string | null
  content_json: Record<string, any>
  created_at: string
  updated_at: string
}

export interface InkwisePaginatedTemplates {
  items: InkwiseTemplate[]
  page: number
  limit: number
  total: number
}

export interface InkwiseTemplateCreateRequest {
  title: string
  description?: string | null
  content_json: Record<string, any>
}

export interface InkwiseTemplateUpdateRequest {
  title?: string | null
  description?: string | null
  content_json?: Record<string, any> | null
}

export interface InkwiseSystemTemplateCategory {
  id: number
  name: string
}

export interface InkwiseSystemTemplate {
  id: string
  category_id: number
  title: string
  description?: string | null
  content_json: Record<string, any>
}

export interface InkwiseChatThread {
  id: string
  user_id: string
  document_id: string
  mode?: string | null
  title?: string | null
  created_at: string
}

export interface InkwiseChatThreadsResponse {
  document_id?: string | null
  threads: InkwiseChatThread[]
}

export interface InkwiseChatThreadCreateRequest {
  document_id: string
  title?: string | null
}

export interface InkwiseChatMessage {
  id: string
  thread_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  content_with_citations?: string | null
  citations_json?: {
    retrieval_run_id?: string | null
    citations?: InkwiseCitation[]
    segments?: InkwiseGroundedSegment[]
    content_with_citations?: string | null
    [key: string]: any
  } | null
  provider: string
  provider_meta?: Record<string, any> | null
  created_at: string
}

export interface InkwisePaginatedChatMessages {
  items: InkwiseChatMessage[]
  page: number
  limit: number
  total: number
}

export interface InkwiseChatSendRequest {
  content: string
  source_ids?: string[] | null
  draft_selection_text?: string | null
  draft_selection_label?: string | null
}

export interface InkwiseRetryRequest {
  fresh_retrieval?: boolean
}

export interface InkwisePredictionRequest {
  document_prefix_text: string
}

export interface InkwisePredictionResponse {
  suggestion_text: string
  content_with_citations?: string | null
  segments?: InkwiseGroundedSegment[]
  grounded: boolean
  retrieval_run_id?: string | null
  attempt_id?: string | null
  evidence_count?: number
  evidence?: InkwiseCitation[]
  citations?: InkwiseCitation[]
  provider: string
  model: string
}

export interface InkwiseDriveExportRequest {
  type: 'pdf' | 'docx'
  folder_id?: string | null
}

export interface InkwiseDriveExportResponse {
  id: string
  name: string
  webViewLink?: string | null
  webContentLink?: string | null
}

export type InkwiseWritingAction =
  | 'coherent'
  | 'concise'
  | 'detailed'
  | 'humanize'
  | 'other'

export interface InkwiseWritingToolRequest {
  action: InkwiseWritingAction
  document_id?: string | null
  source_ids?: string[] | null
  selection_text?: string | null
  surrounding_text?: string | null
  instruction: string
}
