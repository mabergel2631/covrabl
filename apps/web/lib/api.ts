// Covrabl API backend
export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE?.trim() ||
  "https://covrabl-api.up.railway.app";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("pv_token");
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}${path}`;
  const token = getToken();

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  const data = text ? safeJsonParse(text) : null;

  if (!res.ok) {
    // Invalid token — clear session and redirect to login
    if (res.status === 401 && token) {
      // Only show "session expired" if the user was recently active (within 5 min).
      // Otherwise it's a stale token from a previous visit — just redirect cleanly.
      const lastActive = parseInt(localStorage.getItem("pv_last_active") || "0", 10);
      const recentlyActive = Date.now() - lastActive < 5 * 60 * 1000;
      localStorage.removeItem("pv_token");
      localStorage.removeItem("pv_role");
      localStorage.removeItem("pv_plan");
      localStorage.removeItem("pv_last_active");
      if (typeof window !== "undefined") {
        window.location.href = recentlyActive ? "/login?expired=1" : "/login";
        return undefined as never;
      }
    }
    const message =
      (data && (data.detail || data.message)) ||
      `${res.status} ${res.statusText}`;
    const err: any = new Error(typeof message === "string" ? message : JSON.stringify(message));
    err.status = res.status;
    err.data = data;
    throw err;
  }

  // Track last successful authenticated request
  if (token && typeof localStorage !== "undefined") {
    localStorage.setItem("pv_last_active", Date.now().toString());
  }

  return data as T;
}

function safeJsonParse(text: string) {
  try { return JSON.parse(text); } catch { return null; }
}

// ── Types ────────────────────────────────────────────

export type KeyContact = {
  name?: string | null;
  company?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type Policy = {
  id: number;
  user_id: number;
  scope: "personal" | "business";
  policy_type: string;
  carrier: string;
  policy_number: string;
  nickname?: string | null;
  business_name?: string | null;
  coverage_amount?: number | null;
  deductible?: number | null;
  premium_amount?: number | null;
  renewal_date?: string | null;
  exposure_id?: number | null;
  exposure_name?: string | null;
  status?: string;
  created_at: string;
  key_contacts?: Record<string, KeyContact>;
  key_details?: Record<string, string>;
  shared_with?: string[];
  // Deductible tracking
  deductible_type?: string | null;  // annual, per_incident
  deductible_period_start?: string | null;
  deductible_applied?: number | null;  // cents applied to deductible
  // COI summary (only present when certificates exist for this policy)
  coi_summary?: { status: string; count: number } | null;
  // Permission: null/undefined = owner, "view" = view-only shared, "edit" = edit shared
  permission?: string | null;
  // Version chain
  replaces_policy_id?: number | null;
};

export type PolicyCreate = {
  scope: "personal" | "business";
  policy_type: string;
  carrier: string;
  policy_number: string;
  nickname?: string | null;
  business_name?: string | null;
  coverage_amount?: number | null;
  deductible?: number | null;
  premium_amount?: number | null;
  renewal_date?: string | null;
  exposure_id?: number | null;
  status?: string;
  replaces_policy_id?: number | null;
  // Deductible tracking
  deductible_type?: string | null;
  deductible_period_start?: string | null;
  deductible_applied?: number | null;
};

export type PolicyUpdate = Partial<PolicyCreate>;

export type Contact = {
  id: number;
  policy_id: number;
  role: string;
  name?: string | null;
  company?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  created_at: string;
};

export type ContactCreate = {
  role: string;
  name?: string | null;
  company?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
};

export type DocMeta = {
  id: number;
  policy_id: number;
  filename: string;
  content_type: string;
  object_key: string;
  doc_type: string;
  extraction_status: string;
  created_at: string;
};

// ── Auth API ─────────────────────────────────────────

export type AuthMe = {
  id: number;
  email: string;
  role: string;
  plan: string;
  trial_active: boolean;
  trial_days_left: number;
};

export const authApi = {
  me() {
    return request<AuthMe>("/auth/me");
  },
  register(email: string, password: string, role: 'individual' | 'broker' = 'individual') {
    return request<{ access_token: string; token_type: string }>("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, role }),
    });
  },
  setRole(role: 'broker') {
    return request<{ ok: boolean; role: string }>("/auth/set-role", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
  },
  login(email: string, password: string) {
    return request<{ access_token: string; token_type: string }>("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  },
  forgotPassword(email: string) {
    return request<{ ok: boolean; message: string }>("/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
  },
  resetPassword(token: string, password: string) {
    return request<{ ok: boolean }>("/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
  },
  changePassword(currentPassword: string, newPassword: string) {
    return request<{ ok: boolean }>("/auth/change-password", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    });
  },
  deleteAccount(password: string) {
    return request<{ ok: boolean }>("/auth/me", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
  },
};

// ── Policies API ─────────────────────────────────────

export type PolicyVersionEntry = {
  id: number;
  carrier: string;
  policy_type: string;
  policy_number: string;
  nickname?: string | null;
  status: string;
  renewal_date?: string | null;
  created_at: string;
  replaces_policy_id?: number | null;
};

export type ActiveByTypeEntry = {
  id: number;
  carrier: string;
  policy_type: string;
  policy_number: string;
  nickname: string | null;
  scope: string;
};

export const policiesApi = {
  list(status?: string): Promise<Policy[]> {
    const qs = status ? `?status=${status}` : '';
    return request<Policy[]>(`/policies${qs}`);
  },
  get(id: number): Promise<Policy> {
    return request<Policy>(`/policies/${id}`);
  },
  create(payload: PolicyCreate): Promise<Policy> {
    return request<Policy>("/policies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  update(id: number, payload: PolicyUpdate): Promise<Policy> {
    return request<Policy>(`/policies/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  remove(id: number): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/policies/${id}`, { method: "DELETE" });
  },
  businessNames(): Promise<string[]> {
    return request<string[]>("/policies/business-names");
  },
  renameBusinessGroup(oldName: string, newName: string): Promise<{ ok: boolean; updated: number }> {
    return request<{ ok: boolean; updated: number }>("/policies/business-names/rename", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ old_name: oldName, new_name: newName }),
    });
  },
  businessGroupStats(name: string): Promise<{ policy_count: number; certificate_count: number }> {
    return request<{ policy_count: number; certificate_count: number }>(`/policies/business-names/${encodeURIComponent(name)}/stats`);
  },
  deleteBusinessGroup(name: string): Promise<{ ok: boolean; policies_deleted: number }> {
    return request<{ ok: boolean; policies_deleted: number }>("/policies/business-names/delete", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  },
  activeByType(): Promise<ActiveByTypeEntry[]> {
    return request<ActiveByTypeEntry[]>("/policies/active-by-type");
  },
  versions(id: number): Promise<PolicyVersionEntry[]> {
    return request<PolicyVersionEntry[]>(`/policies/${id}/versions`);
  },
  cleanupDrafts(): Promise<{ cleaned: number }> {
    return request<{ cleaned: number }>("/policies/cleanup-drafts", { method: "DELETE" });
  },
};

// ── Contacts API ─────────────────────────────────────

export const contactsApi = {
  list(policyId: number): Promise<Contact[]> {
    return request<Contact[]>(`/policies/${policyId}/contacts`);
  },
  create(policyId: number, payload: ContactCreate): Promise<Contact> {
    return request<Contact>(`/policies/${policyId}/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  update(policyId: number, contactId: number, payload: Partial<ContactCreate>): Promise<Contact> {
    return request<Contact>(`/policies/${policyId}/contacts/${contactId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  remove(policyId: number, contactId: number): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/policies/${policyId}/contacts/${contactId}`, { method: "DELETE" });
  },
};

// ── Documents API ────────────────────────────────────

export const documentsApi = {
  list(policyId: number): Promise<DocMeta[]> {
    return request<DocMeta[]>(`/documents/by-policy/${policyId}`);
  },
  initUpload(policyId: number, filename: string, contentType: string, docType: string = "policy") {
    return request<{ upload_url: string; object_key: string }>("/documents/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ policy_id: policyId, filename, content_type: contentType, doc_type: docType }),
    });
  },
  finalize(policyId: number, filename: string, contentType: string, objectKey: string, docType: string = "policy") {
    return request<{ ok: boolean; document_id: number }>("/documents/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ policy_id: policyId, filename, content_type: contentType, object_key: objectKey, doc_type: docType }),
    });
  },
  extract(documentId: number) {
    return request<{ ok: boolean; document_id: number; extraction: ExtractionData; potential_renewals?: PotentialRenewal[] }>(`/documents/${documentId}/extract`, {
      method: "POST",
    });
  },
  download(documentId: number) {
    return request<{ download_url: string }>(`/documents/${documentId}/download`);
  },
  confirmExtraction(documentId: number, data: ExtractionData) {
    return request<{ ok: boolean }>(`/documents/${documentId}/extract/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },
  importFromUrl(policyId: number, url: string, docType: string = "policy"): Promise<{ ok: boolean; document_id: number }> {
    return request<{ ok: boolean; document_id: number }>("/files/import-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ policy_id: policyId, url, doc_type: docType }),
    });
  },
};

export type PotentialRenewal = {
  id: number;
  carrier: string;
  policy_type: string;
  policy_number: string;
  renewal_date: string | null;
  premium_amount: number | null;
  nickname: string | null;
};

export type ExtractedContact = {
  role: string;
  name?: string | null;
  company?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type ExtractedCoverageItem = {
  item_type: string;
  description: string;
  limit?: string | null;
};

export type ExtractionData = {
  carrier?: string | null;
  policy_number?: string | null;
  policy_type?: string | null;
  scope?: string | null;
  coverage_amount?: number | null;
  deductible?: number | null;
  premium_amount?: number | null;
  renewal_date?: string | null;
  contacts: ExtractedContact[];
  coverage_items?: ExtractedCoverageItem[];
  details?: ExtractedDetail[];
  replaces_policy_id?: number | null;
};

export type ExtractedDetail = {
  field_name: string;
  field_value: string;
};

// ── Coverage Items API ──────────────────────────────

export type CoverageItem = {
  id: number;
  policy_id: number;
  item_type: string;
  description: string;
  limit?: string | null;
  created_at: string;
};

export type CoverageItemCreate = {
  item_type: string;
  description: string;
  limit?: string | null;
};

export type CoverageItemUpdate = Partial<CoverageItemCreate>;

export const coverageApi = {
  list(policyId: number): Promise<CoverageItem[]> {
    return request<CoverageItem[]>(`/policies/${policyId}/coverage`);
  },
  create(policyId: number, payload: CoverageItemCreate): Promise<CoverageItem> {
    return request<CoverageItem>(`/policies/${policyId}/coverage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  update(policyId: number, itemId: number, payload: CoverageItemUpdate): Promise<CoverageItem> {
    return request<CoverageItem>(`/policies/${policyId}/coverage/${itemId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  remove(policyId: number, itemId: number): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/policies/${policyId}/coverage/${itemId}`, { method: "DELETE" });
  },
};

// ── Policy Details API ──────────────────────────────

export type PolicyDetail = {
  id: number;
  policy_id: number;
  field_name: string;
  field_value: string;
  created_at: string;
};

export type PolicyDetailCreate = {
  field_name: string;
  field_value: string;
};

export const policyDetailsApi = {
  list(policyId: number): Promise<PolicyDetail[]> {
    return request<PolicyDetail[]>(`/policies/${policyId}/details`);
  },
  create(policyId: number, payload: PolicyDetailCreate): Promise<PolicyDetail> {
    return request<PolicyDetail>(`/policies/${policyId}/details`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  update(policyId: number, detailId: number, payload: Partial<PolicyDetailCreate>): Promise<PolicyDetail> {
    return request<PolicyDetail>(`/policies/${policyId}/details/${detailId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  remove(policyId: number, detailId: number): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/policies/${policyId}/details/${detailId}`, { method: "DELETE" });
  },
};

// ── Renewals API ────────────────────────────────────

export type RenewalItem = {
  id: number;
  carrier: string;
  policy_type: string;
  policy_number: string;
  nickname?: string | null;
  renewal_date: string;
  coverage_amount?: number | null;
};

export type RenewalChange = {
  id: number;
  field_key: string;
  old_value: string | null;
  new_value: string | null;
  delta_type: string;
  severity: string;
  created_at: string;
};

export type RenewalPolicySummary = {
  id: number;
  carrier: string;
  policy_type: string;
  policy_number: string;
  nickname?: string | null;
  renewal_date: string;
  days_until_renewal: number;
  coverage_amount?: number | null;
  deductible?: number | null;
  premium_amount?: number | null;
  agent_name?: string | null;
  agent_phone?: string | null;
  changes: RenewalChange[];
};

export type RenewalSummaryResult = {
  policies: RenewalPolicySummary[];
  total_renewing: number;
  total_with_changes: number;
};

export const renewalsApi = {
  upcoming(days: number = 30): Promise<RenewalItem[]> {
    return request<RenewalItem[]>(`/renewals/upcoming?days=${days}`);
  },
  summary(): Promise<RenewalSummaryResult> {
    return request<RenewalSummaryResult>("/renewals/summary");
  },
};

// ── Premiums API ────────────────────────────────────

export type Premium = {
  id: number;
  policy_id: number;
  amount: number; // cents
  frequency: string;
  due_date: string;
  paid_date?: string | null;
  payment_method?: string | null;
  notes?: string | null;
  created_at: string;
};

export type PremiumCreate = {
  amount: number;
  frequency: string;
  due_date: string;
  paid_date?: string | null;
  payment_method?: string | null;
  notes?: string | null;
};

export const premiumsApi = {
  list(policyId: number): Promise<Premium[]> {
    return request<Premium[]>(`/policies/${policyId}/premiums`);
  },
  create(policyId: number, payload: PremiumCreate): Promise<Premium> {
    return request<Premium>(`/policies/${policyId}/premiums`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  update(policyId: number, premiumId: number, payload: Partial<PremiumCreate>): Promise<Premium> {
    return request<Premium>(`/policies/${policyId}/premiums/${premiumId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  remove(policyId: number, premiumId: number): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/policies/${policyId}/premiums/${premiumId}`, { method: "DELETE" });
  },
  annualSpend(): Promise<{ annual_spend_cents: number }> {
    return request<{ annual_spend_cents: number }>("/premiums/annual-spend");
  },
};

// ── Claims API ──────────────────────────────────────

export type Claim = {
  id: number;
  policy_id: number;
  claim_number: string;
  status: string;
  date_filed: string;
  date_resolved?: string | null;
  amount_claimed?: number | null;
  amount_paid?: number | null;
  description: string;
  notes?: string | null;
  created_at: string;
};

export type ClaimCreate = {
  claim_number: string;
  status: string;
  date_filed: string;
  description: string;
  date_resolved?: string | null;
  amount_claimed?: number | null;
  amount_paid?: number | null;
  notes?: string | null;
};

export type ClaimExtraction = {
  claim_number: string;
  status: string;
  date_filed: string | null;
  date_resolved: string | null;
  amount_claimed: number | null;
  amount_paid: number | null;
  description: string;
  notes: string | null;
};

export const claimsApi = {
  list(policyId: number): Promise<Claim[]> {
    return request<Claim[]>(`/policies/${policyId}/claims`);
  },
  create(policyId: number, payload: ClaimCreate): Promise<Claim> {
    return request<Claim>(`/policies/${policyId}/claims`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  update(policyId: number, claimId: number, payload: Partial<ClaimCreate>): Promise<Claim> {
    return request<Claim>(`/policies/${policyId}/claims/${claimId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  remove(policyId: number, claimId: number): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/policies/${policyId}/claims/${claimId}`, { method: "DELETE" });
  },
  async extractFromPdf(policyId: number, file: File): Promise<{ ok: boolean; extraction: ClaimExtraction }> {
    const formData = new FormData();
    formData.append("file", file);
    const url = `${API_BASE}/policies/${policyId}/claims/extract`;
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(url, { method: "POST", headers, body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Extraction failed");
    return data;
  },
};

// ── Reminders API ───────────────────────────────────

export type RenewalReminder = {
  id: number;
  policy_id: number;
  remind_at: string;
  dismissed: boolean;
  carrier?: string | null;
  policy_type?: string | null;
  nickname?: string | null;
  renewal_date?: string | null;
  created_at: string;
};

export type SmartAlert = {
  type: string;
  severity: string;
  policy_id: number;
  title: string;
  description: string;
  action: string;
};

export const remindersApi = {
  active(): Promise<RenewalReminder[]> {
    return request<RenewalReminder[]>("/reminders/active");
  },
  smart(): Promise<SmartAlert[]> {
    return request<SmartAlert[]>("/reminders/smart");
  },
  dismiss(reminderId: number): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/reminders/${reminderId}/dismiss`, { method: "PUT" });
  },
};

// ── Audit API ───────────────────────────────────────

export type AuditLogEntry = {
  id: number;
  user_id: number;
  action: string;
  entity_type: string;
  entity_id: number;
  details?: string | null;
  created_at: string;
};

export type AuditLogPage = {
  items: AuditLogEntry[];
  total: number;
  page: number;
  limit: number;
};

export const auditApi = {
  list(page: number = 1, limit: number = 20): Promise<AuditLogPage> {
    return request<AuditLogPage>(`/audit?page=${page}&limit=${limit}`);
  },
};

// ── Sharing API ─────────────────────────────────────

export type PolicyShareType = {
  id: number;
  policy_id: number;
  owner_id: number;
  shared_with_email: string;
  permission: string;
  role_label?: string | null;
  expires_at?: string | null;
  accepted: boolean;
  created_at: string;
};

export type ShareCreate = {
  shared_with_email: string;
  permission: string;
  role_label?: string | null;
  expires_at?: string | null;
};

export type SharedPolicy = {
  share_id: number;
  permission: string;
  policy: Policy;
};

export type PendingShare = {
  share_id: number;
  permission: string;
  owner_id: number;
  policy: { id: number; carrier: string; policy_type: string; nickname?: string | null };
};

export type BulkShareCreate = {
  policy_ids: number[];
  shared_with_email: string;
  permission: string;
  role_label?: string | null;
  expires_at?: string | null;
};

export type BulkShareResult = {
  created: number;
  skipped: number;
  total: number;
};

export const sharingApi = {
  share(policyId: number, payload: ShareCreate): Promise<PolicyShareType> {
    return request<PolicyShareType>(`/policies/${policyId}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  listShares(policyId: number): Promise<PolicyShareType[]> {
    return request<PolicyShareType[]>(`/policies/${policyId}/shares`);
  },
  sharedWithMe(): Promise<SharedPolicy[]> {
    return request<SharedPolicy[]>("/policies/shared-with-me");
  },
  pending(): Promise<PendingShare[]> {
    return request<PendingShare[]>("/shares/pending");
  },
  accept(shareId: number): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/shares/${shareId}/accept`, { method: "PUT" });
  },
  revoke(shareId: number): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/shares/${shareId}`, { method: "DELETE" });
  },
  shareBulk(payload: BulkShareCreate): Promise<BulkShareResult> {
    return request<BulkShareResult>("/policies/share-bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
};

// ── Compare API ─────────────────────────────────────

export type PolicyBundle = {
  policy: { id: number; scope: string; policy_type: string; carrier: string; policy_number: string; nickname?: string | null; coverage_amount?: number | null; deductible?: number | null; renewal_date?: string | null };
  contacts: { id: number; role: string; name?: string | null; company?: string | null; phone?: string | null; email?: string | null }[];
  coverage_items: { id: number; item_type: string; description: string; limit?: string | null }[];
  details: { id: number; field_name: string; field_value: string }[];
  premiums: { id: number; amount: number; frequency: string; due_date: string; paid_date?: string | null }[];
};

export type DataSufficiency = {
  policy_id: number;
  carrier: string;
  has_documents: boolean;
  has_coverage_items: boolean;
  has_details: boolean;
  document_char_count: number;
  coverage_item_count: number;
  detail_count: number;
  sufficiency: 'full' | 'partial' | 'minimal';
  warning: string | null;
};

export type ComparisonFinding = {
  category: string;
  severity: 'critical' | 'important' | 'informational';
  title: string;
  description: string;
  policies_affected: number[];
  recommendation: string | null;
};

export type CompareAnalysis = {
  summary: string;
  data_sufficiency: DataSufficiency[];
  findings: ComparisonFinding[];
  limitations: string[];
};

export const compareApi = {
  compare(ids: number[]): Promise<PolicyBundle[]> {
    return request<PolicyBundle[]>(`/policies/compare?ids=${ids.join(",")}`);
  },
  analyze(ids: number[]): Promise<CompareAnalysis> {
    return request<CompareAnalysis>('/policies/compare/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ policy_ids: ids }),
    });
  },
};

// ── Export API ───────────────────────────────────────

async function downloadFile(path: string, filename: string) {
  const url = `${API_BASE}${path}`;
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Export failed: ${res.status}`);
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export const exportApi = {
  allPolicies() { return downloadFile("/export/policies", "policies.csv"); },
  singlePolicy(policyId: number) { return downloadFile(`/export/policies/${policyId}`, `policy_${policyId}.csv`); },
};

// ── Gap Analysis API ─────────────────────────────────

export type CoverageGap = {
  id: string;
  name: string;
  severity: "high" | "medium" | "low" | "info";
  description: string;
  recommendation: string;
  category: string;
  policy_id?: number;
};

export type CoverageSummary = {
  total_policies: number;
  policy_types: string[];
  total_coverage: number;
  total_annual_premium: number;
  coverage_by_type: Record<string, { coverage: number; premium: number; count: number }>;
  covered_categories: string[];
  missing_categories: string[];
};

export type GapAnalysisResult = {
  gaps: CoverageGap[];
  summary: CoverageSummary;
  policy_count: number;
};

export type BusinessEntityDetail = {
  business_name: string;
  policies: {
    id: number;
    carrier: string;
    policy_type: string;
    policy_number: string;
    nickname?: string | null;
    business_name?: string | null;
    coverage_amount?: number | null;
    deductible?: number | null;
    premium_amount?: number | null;
    status?: string;
    renewal_date?: string | null;
  }[];
  gaps: CoverageGap[];
  summary: CoverageSummary;
  contacts: {
    id: number;
    policy_id: number;
    role: string;
    name?: string | null;
    company?: string | null;
    phone?: string | null;
    email?: string | null;
    notes?: string | null;
  }[];
  certificates: {
    id: number;
    policy_id: number;
    direction: string;
    counterparty_name: string;
    counterparty_type: string;
    carrier?: string | null;
    coverage_types?: string | null;
    coverage_amount?: number | null;
    status: string;
    expiration_date?: string | null;
  }[];
};

export const gapsApi = {
  analyze(): Promise<GapAnalysisResult> {
    return request<GapAnalysisResult>("/gaps");
  },
  summary(): Promise<CoverageSummary> {
    return request<CoverageSummary>("/gaps/summary");
  },
  forPolicy(policyId: number): Promise<{ gaps: CoverageGap[]; policy_id: number }> {
    return request<{ gaps: CoverageGap[]; policy_id: number }>(`/gaps/policy/${policyId}`);
  },
  forBusiness(businessName: string): Promise<BusinessEntityDetail> {
    return request<BusinessEntityDetail>(`/gaps/business/${encodeURIComponent(businessName)}`);
  },
};

// ── ICE Emergency Card API ─────────────────────────────

export type EmergencyCardData = {
  id: number;
  access_code: string;
  holder_name: string;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  has_pin: boolean;
  include_coverage_amounts: boolean;
  include_deductibles: boolean;
  expires_at?: string | null;
  is_active: boolean;
  created_at: string;
  share_url: string;
};

export type EmergencyCardCreate = {
  holder_name: string;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  pin?: string | null;
  include_coverage_amounts?: boolean;
  include_deductibles?: boolean;
  expires_at?: string | null;
};

export type EmergencyCardPublic = {
  requires_pin: boolean;
  holder_name: string;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  policies?: {
    id: number;
    policy_type: string;
    carrier: string;
    policy_number: string;
    claims_phone?: string | null;
    agent_name?: string | null;
    agent_phone?: string | null;
    coverage_amount?: number | null;
    deductible?: number | null;
  }[];
  last_updated?: string;
};

export const iceApi = {
  get(): Promise<{ card: EmergencyCardData | null }> {
    return request<{ card: EmergencyCardData | null }>("/emergency-card");
  },
  create(payload: EmergencyCardCreate): Promise<{ id: number; access_code: string; share_url: string }> {
    return request<{ id: number; access_code: string; share_url: string }>("/emergency-card", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  update(payload: Partial<EmergencyCardCreate> & { remove_pin?: boolean; is_active?: boolean }): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>("/emergency-card", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  regenerate(): Promise<{ access_code: string; share_url: string }> {
    return request<{ access_code: string; share_url: string }>("/emergency-card/regenerate", { method: "POST" });
  },
  delete(): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>("/emergency-card", { method: "DELETE" });
  },
  // Public endpoints (no auth)
  getPublic(accessCode: string): Promise<EmergencyCardPublic> {
    return request<EmergencyCardPublic>(`/ice/${accessCode}`);
  },
  verifyPin(accessCode: string, pin: string): Promise<EmergencyCardPublic> {
    return request<EmergencyCardPublic>(`/ice/${accessCode}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
  },
  getOfflineBundle(accessCode: string): Promise<EmergencyCardPublic & { cache_timestamp: string; can_cache: boolean }> {
    return request<EmergencyCardPublic & { cache_timestamp: string; can_cache: boolean }>(`/ice/${accessCode}/offline-bundle`);
  },
};

// ── Premium History API ─────────────────────────────────

export type PremiumHistoryEntry = {
  id: number;
  amount: number;
  effective_date: string;
  source: string;
  notes?: string | null;
  change_pct?: number | null;
  created_at: string;
  carrier?: string | null;
  policy_id?: number;
};

export type PremiumHistoryResult = {
  history: PremiumHistoryEntry[];
  total_change_pct: number;
  entry_count: number;
};

export const premiumHistoryApi = {
  list(policyId: number): Promise<PremiumHistoryResult> {
    return request<PremiumHistoryResult>(`/policies/${policyId}/premium-history`);
  },
  add(policyId: number, amount: number, effective_date: string, notes?: string): Promise<{ id: number }> {
    return request<{ id: number }>(`/policies/${policyId}/premium-history`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount, effective_date, notes }),
    });
  },
  update(policyId: number, entryId: number, payload: { amount?: number; effective_date?: string; notes?: string }): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/policies/${policyId}/premium-history/${entryId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  remove(policyId: number, entryId: number): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/policies/${policyId}/premium-history/${entryId}`, { method: "DELETE" });
  },
};

// ── Delta Alerts API ─────────────────────────────────────

export type PolicyDelta = {
  id: number;
  policy_id: number;
  document_id?: number | null;
  field_key: string;
  old_value?: string | null;
  new_value?: string | null;
  delta_type: string;
  severity: string;
  is_acknowledged: boolean;
  created_at: string;
  policy_carrier?: string | null;
  policy_type?: string | null;
  explanation?: string | null;
};

export type DeltaListResponse = {
  items: PolicyDelta[];
  total: number;
  unacknowledged_count: number;
};

export type DeltaExplanation = {
  explanation: string;
  possible_reasons: string[];
};

export const deltasApi = {
  list(params?: { acknowledged?: boolean; severity?: string; page?: number; limit?: number }): Promise<DeltaListResponse> {
    const query = new URLSearchParams();
    if (params?.acknowledged !== undefined) query.set("acknowledged", String(params.acknowledged));
    if (params?.severity) query.set("severity", params.severity);
    if (params?.page) query.set("page", String(params.page));
    if (params?.limit) query.set("limit", String(params.limit));
    const qs = query.toString();
    return request<DeltaListResponse>(`/deltas${qs ? `?${qs}` : ""}`);
  },
  listForPolicy(policyId: number): Promise<{ items: PolicyDelta[]; total: number }> {
    return request<{ items: PolicyDelta[]; total: number }>(`/policies/${policyId}/deltas`);
  },
  acknowledge(deltaId: number): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/deltas/${deltaId}/acknowledge`, { method: "PUT" });
  },
  acknowledgeAll(): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/deltas/acknowledge-all`, { method: "PUT" });
  },
  explain(deltaId: number): Promise<DeltaExplanation> {
    return request<DeltaExplanation>(`/deltas/${deltaId}/explain`, { method: "POST" });
  },
  delete(deltaId: number): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/deltas/${deltaId}`, { method: "DELETE" });
  },
  deleteAcknowledged(): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/deltas/clear-acknowledged`, { method: "DELETE" });
  },
};

// ── Coverage Score API ─────────────────────────────────────

export type ScoreComponent = {
  name: string;
  score: number;
  max: number;
  detail: string;
};

export type ScoreRecommendation = {
  priority: "high" | "medium" | "low";
  text: string;
  detail: string;
  rec_key?: string;
  dismissed?: boolean;
};

export type CategoryResult = {
  score: number;
  weight: number;
  category_dismissed?: boolean;
  components: ScoreComponent[];
  recommendations: ScoreRecommendation[];
};

export type PolicyHealthItem = {
  policy_id: number;
  type: string;
  carrier: string;
  days_left?: number;
};

export type PolicyHealth = {
  expiring_soon: PolicyHealthItem[];
  missing_documents: PolicyHealthItem[];
  recently_updated: boolean;
};

export type CoverageScoresResult = {
  overall_score: number;
  confidence: "low" | "moderate" | "high";
  policies_analyzed: number;
  expected_policy_types: string[];
  not_visible: string[];
  exposure_band: string;
  categories: Record<string, CategoryResult>;
  policy_health: PolicyHealth;
};

export const scoresApi = {
  get(): Promise<CoverageScoresResult> {
    return request<CoverageScoresResult>("/coverage-scores");
  },
  recalculate(): Promise<CoverageScoresResult> {
    return request<CoverageScoresResult>("/coverage-scores/recalculate", { method: "POST" });
  },
  byScope(): Promise<{ personal: CoverageScoresResult | null; business: CoverageScoresResult | null }> {
    return request<{ personal: CoverageScoresResult | null; business: CoverageScoresResult | null }>("/coverage-scores/by-scope");
  },
  dismiss(recKey: string, scope?: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>("/coverage-scores/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rec_key: recKey, scope }),
    });
  },
  restore(recKey: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>("/coverage-scores/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rec_key: recKey }),
    });
  },
  dismissCategory(category: string, scope?: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>("/coverage-scores/dismiss-category", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, scope }),
    });
  },
  restoreCategory(category: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>("/coverage-scores/restore-category", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category }),
    });
  },
  recalculateScope(scope: string): Promise<CoverageScoresResult> {
    return request<CoverageScoresResult>(`/coverage-scores/recalculate/${scope}`, { method: "POST" });
  },
};

// ── Email Ingestion API ─────────────────────────────────────

export type InboundAddress = {
  id: number;
  email: string;
  alias: string;
  is_active: boolean;
  created_at: string;
};

export type PolicyDraftData = {
  id: number;
  carrier?: string | null;
  policy_number?: string | null;
  policy_type?: string | null;
  matched_policy_id?: number | null;
  original_filename?: string | null;
  extraction_data?: Record<string, unknown>;
  status: string;
  created_at: string;
};

export const inboundApi = {
  getAddress(): Promise<{ address: InboundAddress | null }> {
    return request<{ address: InboundAddress | null }>("/inbound/address");
  },
  createAddress(): Promise<InboundAddress> {
    return request<InboundAddress>("/inbound/address", { method: "POST" });
  },
  updateAddress(isActive: boolean): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/inbound/address?is_active=${isActive}`, { method: "PUT" });
  },
  deleteAddress(): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>("/inbound/address", { method: "DELETE" });
  },
  listDrafts(status?: string): Promise<{ items: PolicyDraftData[]; total: number }> {
    const qs = status ? `?status=${status}` : "";
    return request<{ items: PolicyDraftData[]; total: number }>(`/inbound/drafts${qs}`);
  },
  getDraft(draftId: number): Promise<PolicyDraftData> {
    return request<PolicyDraftData>(`/inbound/drafts/${draftId}`);
  },
  approveDraft(draftId: number, payload?: { policy_type?: string; scope?: string }): Promise<{ ok: boolean; policy_id: number; action: string }> {
    return request<{ ok: boolean; policy_id: number; action: string }>(`/inbound/drafts/${draftId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
  },
  rejectDraft(draftId: number): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/inbound/drafts/${draftId}/reject`, { method: "POST" });
  },
  countPending(): Promise<{ count: number }> {
    return request<{ count: number }>("/inbound/drafts/count");
  },
};

// ── Exposures API ───────────────────────────────────────

export type Exposure = {
  id: number;
  user_id: number;
  name: string;
  exposure_type?: string | null;
  description?: string | null;
  created_at: string;
  policy_count?: number;
  total_coverage?: number;
};

export type ExposureCreate = {
  name: string;
  exposure_type?: string | null;
  description?: string | null;
};

export type ExposureDetail = Exposure & {
  policies: {
    id: number;
    carrier: string;
    policy_type: string;
    policy_number: string;
    nickname?: string | null;
    coverage_amount?: number | null;
    deductible?: number | null;
    premium_amount?: number | null;
    status?: string;
    renewal_date?: string | null;
  }[];
  gaps: CoverageGap[];
  summary: CoverageSummary;
};

export const exposuresApi = {
  list(): Promise<Exposure[]> {
    return request<Exposure[]>("/exposures");
  },
  get(id: number): Promise<ExposureDetail> {
    return request<ExposureDetail>(`/exposures/${id}`);
  },
  create(payload: ExposureCreate): Promise<Exposure> {
    return request<Exposure>("/exposures", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  update(id: number, payload: Partial<ExposureCreate>): Promise<Exposure> {
    return request<Exposure>(`/exposures/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  remove(id: number): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/exposures/${id}`, { method: "DELETE" });
  },
};

// ── Admin API ─────────────────────────────────────────────

export type AdminStats = {
  total_users: number;
  recent_signups: number;
  plans: Record<string, number>;
  total_policies: number;
  pending_drafts: number;
  total_documents: number;
  storage_estimate_mb: number;
  active_sessions_approx: number;
  mrr_breakdown: Record<string, { count: number; mrr_cents: number }>;
};

export type AdminUser = {
  id: number;
  email: string;
  role: string;
  plan: string;
  is_suspended: boolean;
  trial_ends_at: string | null;
  policy_count: number;
  created_at: string | null;
};

export type AdminUserList = {
  items: AdminUser[];
  total: number;
  page: number;
  limit: number;
};

export type AdminUserDetail = {
  id: number;
  email: string;
  role: string;
  plan: string;
  is_suspended: boolean;
  trial_ends_at: string | null;
  created_at: string | null;
  policies: {
    id: number;
    carrier: string;
    policy_type: string;
    policy_number: string;
    status: string;
    created_at: string | null;
  }[];
  recent_documents: {
    id: number;
    filename: string;
    doc_type: string;
    created_at: string | null;
  }[];
  drafts: {
    id: number;
    carrier: string | null;
    policy_number: string | null;
    policy_type: string | null;
    original_filename: string;
    status: string;
    created_at: string | null;
  }[];
};

export type AdminActivity = {
  type: "upload" | "draft";
  user_email: string;
  filename?: string;
  doc_type?: string;
  carrier?: string | null;
  policy_type?: string | null;
  original_filename?: string;
  status?: string;
  created_at: string | null;
};

export type AdminSignup = {
  date: string;
  count: number;
};

export type AdminAuditLogEntry = {
  id: number;
  user_id: number;
  user_email: string;
  action: string;
  entity_type: string;
  entity_id: number;
  details: string | null;
  created_at: string | null;
};

export type AdminAuditLogPage = {
  items: AdminAuditLogEntry[];
  total: number;
  page: number;
  limit: number;
};

export type AdminAuditFilters = {
  actions: string[];
  entity_types: string[];
};

export type AdminEmailLogEntry = {
  id: number;
  recipient: string;
  email_type: string;
  subject: string;
  status: string;
  error: string | null;
  created_at: string | null;
};

export type AdminEmailLogPage = {
  items: AdminEmailLogEntry[];
  total: number;
  page: number;
  limit: number;
};

export type AdminDraftEntry = {
  id: number;
  user_id: number;
  user_email: string;
  carrier: string | null;
  policy_number: string | null;
  policy_type: string | null;
  original_filename: string | null;
  status: string;
  created_at: string | null;
};

export type AdminDraftPage = {
  items: AdminDraftEntry[];
  total: number;
  page: number;
  limit: number;
};

export type AdminAnnouncement = {
  id: number;
  title: string;
  message: string;
  type: string;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_by: number;
  created_at: string | null;
};

export const adminApi = {
  // Overview
  stats(): Promise<AdminStats> {
    return request<AdminStats>("/admin/stats");
  },
  signups(days = 30): Promise<AdminSignup[]> {
    return request<AdminSignup[]>(`/admin/signups?days=${days}`);
  },
  recentActivity(limit = 30): Promise<AdminActivity[]> {
    return request<AdminActivity[]>(`/admin/recent-activity?limit=${limit}`);
  },

  // Users
  users(page = 1, limit = 50, search = ""): Promise<AdminUserList> {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (search) params.set("search", search);
    return request<AdminUserList>(`/admin/users?${params}`);
  },
  userDetail(userId: number): Promise<AdminUserDetail> {
    return request<AdminUserDetail>(`/admin/users/${userId}`);
  },
  updateUserRole(userId: number, role: string) {
    return request<{ ok: boolean; role: string }>(`/admin/users/${userId}/role`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
  },
  updateUserPlan(userId: number, plan: string) {
    return request<{ ok: boolean; plan: string }>(`/admin/users/${userId}/plan`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan }),
    });
  },
  extendTrial(userId: number, days: number) {
    return request<{ ok: boolean; trial_ends_at: string }>(`/admin/users/${userId}/extend-trial`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days }),
    });
  },
  suspendUser(userId: number, suspended: boolean) {
    return request<{ ok: boolean; is_suspended: boolean }>(`/admin/users/${userId}/suspend`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suspended }),
    });
  },
  sendPasswordReset(userId: number) {
    return request<{ ok: boolean }>(`/admin/users/${userId}/send-reset`, {
      method: "POST",
    });
  },
  deleteUser(userId: number) {
    return request<{ ok: boolean }>(`/admin/users/${userId}`, {
      method: "DELETE",
    });
  },

  // Audit logs
  auditLogs(params: { page?: number; limit?: number; user_email?: string; action?: string; entity_type?: string; date_from?: string; date_to?: string } = {}): Promise<AdminAuditLogPage> {
    const q = new URLSearchParams();
    if (params.page) q.set("page", String(params.page));
    if (params.limit) q.set("limit", String(params.limit));
    if (params.user_email) q.set("user_email", params.user_email);
    if (params.action) q.set("action", params.action);
    if (params.entity_type) q.set("entity_type", params.entity_type);
    if (params.date_from) q.set("date_from", params.date_from);
    if (params.date_to) q.set("date_to", params.date_to);
    return request<AdminAuditLogPage>(`/admin/audit-logs?${q}`);
  },
  auditLogFilters(): Promise<AdminAuditFilters> {
    return request<AdminAuditFilters>("/admin/audit-logs/filters");
  },

  // Email logs
  emailLogs(params: { page?: number; limit?: number; email_type?: string; recipient?: string } = {}): Promise<AdminEmailLogPage> {
    const q = new URLSearchParams();
    if (params.page) q.set("page", String(params.page));
    if (params.limit) q.set("limit", String(params.limit));
    if (params.email_type) q.set("email_type", params.email_type);
    if (params.recipient) q.set("recipient", params.recipient);
    return request<AdminEmailLogPage>(`/admin/emails?${q}`);
  },

  // Drafts
  drafts(params: { page?: number; limit?: number; status?: string } = {}): Promise<AdminDraftPage> {
    const q = new URLSearchParams();
    if (params.page) q.set("page", String(params.page));
    if (params.limit) q.set("limit", String(params.limit));
    if (params.status) q.set("status", params.status);
    return request<AdminDraftPage>(`/admin/drafts?${q}`);
  },
  approveDraft(draftId: number, body: { scope: string; policy_type?: string }) {
    return request<{ ok: boolean; policy_id: number; action: string }>(`/admin/drafts/${draftId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  rejectDraft(draftId: number) {
    return request<{ ok: boolean }>(`/admin/drafts/${draftId}/reject`, {
      method: "POST",
    });
  },

  // Announcements
  announcements(): Promise<AdminAnnouncement[]> {
    return request<AdminAnnouncement[]>("/admin/announcements");
  },
  createAnnouncement(data: { title: string; message: string; type?: string; is_active?: boolean; starts_at?: string | null; ends_at?: string | null }) {
    return request<AdminAnnouncement>("/admin/announcements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },
  updateAnnouncement(id: number, data: Partial<{ title: string; message: string; type: string; is_active: boolean; starts_at: string | null; ends_at: string | null }>) {
    return request<AdminAnnouncement>(`/admin/announcements/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },
  deleteAnnouncement(id: number) {
    return request<{ ok: boolean }>(`/admin/announcements/${id}`, {
      method: "DELETE",
    });
  },
};

// Public (no auth) — for announcement banners
export function fetchActiveAnnouncements(): Promise<{ id: number; title: string; message: string; type: string }[]> {
  return request("/announcements/active");
}

// ── Agent / Advisor API ─────────────────────────────────────

export type AgentClient = {
  id: number;
  email: string;
  policy_count: number;
  protection_score: number | null;
  next_renewal: string | null;
};

export type AgentOverview = {
  total_clients: number;
  total_policies: number;
  avg_protection_score: number | null;
  upcoming_renewals: number;
};

export type AgentClientPolicy = {
  id: number;
  carrier: string;
  policy_type: string;
  policy_number: string;
  nickname?: string | null;
  coverage_amount?: number | null;
  deductible?: number | null;
  premium_amount?: number | null;
  renewal_date?: string | null;
  exposure_id?: number | null;
  exposure_name?: string | null;
  status?: string;
};

export type AgentClientSummary = {
  client: { id: number; email: string };
  protection_score: number | null;
  policies: AgentClientPolicy[];
  gaps: CoverageGap[];
  summary: CoverageSummary;
  upcoming_renewals: { policy_id: number; carrier: string; policy_type: string; renewal_date: string }[];
};

export const agentApi = {
  clients(): Promise<AgentClient[]> {
    return request<AgentClient[]>("/agent/clients");
  },
  overview(): Promise<AgentOverview> {
    return request<AgentOverview>("/agent/overview");
  },
  clientSummary(clientId: number): Promise<AgentClientSummary> {
    return request<AgentClientSummary>(`/agent/clients/${clientId}/summary`);
  },
};

// ── Certificates ──────────────────────────────────────

export type Certificate = {
  id: number;
  user_id: number;
  direction: string;
  policy_id: number | null;
  counterparty_name: string;
  counterparty_type: string;
  counterparty_email: string | null;
  carrier: string | null;
  policy_number: string | null;
  coverage_types: string | null;
  coverage_amount: number | null;
  additional_insured: boolean;
  waiver_of_subrogation: boolean;
  minimum_coverage: number | null;
  effective_date: string | null;
  expiration_date: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  policy_carrier: string | null;
  policy_type: string | null;
};

export type CertificateCreate = {
  direction: string;
  policy_id?: number | null;
  counterparty_name: string;
  counterparty_type: string;
  counterparty_email?: string | null;
  carrier?: string | null;
  policy_number?: string | null;
  coverage_types?: string | null;
  coverage_amount?: number | null;
  additional_insured?: boolean;
  waiver_of_subrogation?: boolean;
  minimum_coverage?: number | null;
  effective_date?: string | null;
  expiration_date?: string | null;
  status?: string;
  notes?: string | null;
};

export const certificatesApi = {
  list(direction?: string, policyId?: number): Promise<Certificate[]> {
    const params = new URLSearchParams();
    if (direction) params.set("direction", direction);
    if (policyId) params.set("policy_id", String(policyId));
    const q = params.toString();
    return request<Certificate[]>(`/certificates${q ? `?${q}` : ""}`);
  },
  get(id: number): Promise<Certificate> {
    return request<Certificate>(`/certificates/${id}`);
  },
  create(payload: CertificateCreate): Promise<Certificate> {
    return request<Certificate>("/certificates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  update(id: number, payload: Partial<CertificateCreate>): Promise<Certificate> {
    return request<Certificate>(`/certificates/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  remove(id: number): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/certificates/${id}`, { method: "DELETE" });
  },
  async extractFromPdf(file: File): Promise<{ ok: boolean; extraction: COIExtraction }> {
    const formData = new FormData();
    formData.append("file", file);
    const url = `${API_BASE}/certificates/extract-pdf`;
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(url, { method: "POST", headers, body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Extraction failed");
    return data;
  },
};

// ── Profile API ─────────────────────────────────────

export type UserProfile = {
  id: number;
  user_id: number;
  full_name?: string | null;
  phone?: string | null;
  address_street?: string | null;
  address_city?: string | null;
  address_state?: string | null;
  address_zip?: string | null;
  is_homeowner: boolean;
  is_renter: boolean;
  has_dependents: boolean;
  has_vehicle: boolean;
  owns_business: boolean;
  high_net_worth: boolean;
  created_at: string;
  updated_at: string;
};

export type UserProfileUpdate = {
  full_name?: string | null;
  phone?: string | null;
  address_street?: string | null;
  address_city?: string | null;
  address_state?: string | null;
  address_zip?: string | null;
  is_homeowner?: boolean;
  is_renter?: boolean;
  has_dependents?: boolean;
  has_vehicle?: boolean;
  owns_business?: boolean;
  high_net_worth?: boolean;
};

export type ProfileContact = {
  id: number;
  user_id: number;
  contact_type: string;
  name: string;
  relationship?: string | null;
  company?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  created_at: string;
};

export type ProfileContactCreate = {
  contact_type: string;
  name: string;
  relationship?: string | null;
  company?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
};

export type IcePrefill = {
  holder_name: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
};

export const profileApi = {
  get(): Promise<{ profile: UserProfile; contacts: ProfileContact[] }> {
    return request<{ profile: UserProfile; contacts: ProfileContact[] }>("/profile");
  },
  update(payload: UserProfileUpdate): Promise<UserProfile> {
    return request<UserProfile>("/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  listContacts(type?: string): Promise<ProfileContact[]> {
    const qs = type ? `?type=${type}` : "";
    return request<ProfileContact[]>(`/profile/contacts${qs}`);
  },
  createContact(payload: ProfileContactCreate): Promise<ProfileContact> {
    return request<ProfileContact>("/profile/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  updateContact(id: number, payload: Partial<ProfileContactCreate>): Promise<ProfileContact> {
    return request<ProfileContact>(`/profile/contacts/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  removeContact(id: number): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/profile/contacts/${id}`, { method: "DELETE" });
  },
  getIcePrefill(): Promise<IcePrefill> {
    return request<IcePrefill>("/profile/prefill/ice");
  },
};

// ── Billing API ─────────────────────────────────────

export type PlanInfo = {
  id: string;
  name: string;
  tagline?: string;
  description: string;
  max_active_policies: number;
  features: string[];
  monthly_price: number;
  annual_price: number;
};

export type BillingStatus = {
  plan: string;
  max_active_policies: number;
  max_extractions: number;
  extractions_used: number;
  has_subscription: boolean;
  trial_active: boolean;
  trial_days_left: number;
  stripe_configured: boolean;
};

export const billingApi = {
  status(): Promise<BillingStatus> {
    return request<BillingStatus>("/billing/status");
  },
  plans(): Promise<{ plans: PlanInfo[] }> {
    return request<{ plans: PlanInfo[] }>("/billing/plans");
  },
  checkout(plan: string, interval: string): Promise<{ checkout_url: string }> {
    return request<{ checkout_url: string }>("/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan, interval }),
    });
  },
  portal(): Promise<{ portal_url: string }> {
    return request<{ portal_url: string }>("/billing/portal", { method: "POST" });
  },
};

// ── Feature gating ──────────────────────────────────

export type UpgradeError = {
  error: "upgrade_required";
  feature: string;
  required_plan: string;
  current_plan: string;
  message: string;
};

export function parseUpgradeError(err: any): UpgradeError | null {
  const data = err?.data?.detail ?? err?.data;
  if (data && data.error === "upgrade_required") return data as UpgradeError;
  return null;
}

const PLAN_TIER: Record<string, number> = {
  free: 0,
  trial: 2,
  basic: 2,
  pro: 2,
  business: 3,
};

const FEATURE_ACCESS: Record<string, number> = {
  deltas: 2,
  premiums: 2,
  premium_history: 2,
  certificates: 3,
  lease_compliance: 3,
  business_grouping: 3,
  sharing: 3,
};

const TIER_PLAN_NAME: Record<number, string> = { 0: "free", 2: "pro", 3: "business" };

export function checkFeatureAccess(plan: string, feature: string): { allowed: boolean; requiredPlan: string } {
  // TEMPORARILY DISABLED — all features open until public launch
  return { allowed: true, requiredPlan: "" };
  const userTier = PLAN_TIER[plan] ?? 0;
  const requiredTier = FEATURE_ACCESS[feature] ?? 0;
  return {
    allowed: userTier >= requiredTier,
    requiredPlan: TIER_PLAN_NAME[requiredTier] ?? "pro",
  };
}

export type COIExtraction = {
  counterparty_name: string;
  counterparty_type: string;
  counterparty_email: string | null;
  carrier: string | null;
  policy_number: string | null;
  coverage_types: string | null;
  coverage_amount: number | null;
  additional_insured: boolean;
  waiver_of_subrogation: boolean;
  effective_date: string | null;
  expiration_date: string | null;
  notes: string | null;
  insured_name: string | null;
  producer_name: string | null;
  producer_phone: string | null;
  producer_email: string | null;
};

// ── Lease Compliance API ────────────────────────────

export type LeaseRequirementItem = {
  category: string;
  requirement_type: string;
  required_value: string | null;
  label: string;
  notes: string | null;
};

export type ComplianceResultItem = {
  requirement_label: string;
  category: string;
  requirement_type: string;
  status: "pass" | "fail" | "unclear";
  required_value: string | null;
  actual_value: string | null;
  note: string;
};

export type LeaseRequirementTenant = {
  tenant_name: string | null;
  tenant_email: string | null;
  pass_count: number;
  fail_count: number;
  unclear_count: number;
  submitted_at: string | null;
  created_at: string | null;
  check_id: number;
  has_document: boolean;
};

export type LeaseRequirement = {
  id: number;
  user_id: number;
  policy_id: number | null;
  label: string;
  role: "tenant" | "landlord";
  counterparty_name: string | null;
  counterparty_email: string | null;
  property_address: string | null;
  lease_clause_text: string | null;
  requirements_json: string;
  access_code: string;
  status: string;
  created_at: string;
  updated_at: string;
  latest_check: {
    id: number;
    pass_count: number;
    fail_count: number;
    unclear_count: number;
    checked_against: string;
    tenant_name?: string | null;
    created_at: string;
  } | null;
  tenants?: LeaseRequirementTenant[];
};

export type LeaseRequirementCreate = {
  label: string;
  role: "tenant" | "landlord";
  policy_id?: number | null;
  counterparty_name?: string | null;
  counterparty_email?: string | null;
  property_address?: string | null;
  lease_clause_text?: string | null;
  requirements_json: string;
};

export type ComplianceCheckResult = {
  id: number;
  results?: ComplianceResultItem[];
  results_json?: string;
  pass_count: number;
  fail_count: number;
  unclear_count: number;
  checked_against: string;
  tenant_name?: string | null;
  tenant_email?: string | null;
  has_document?: boolean;
  created_at: string;
};

export type LeaseExtraction = {
  property_address: string | null;
  landlord_name: string | null;
  tenant_name: string | null;
  requirements: LeaseRequirementItem[];
  certificate_holder_text: string | null;
  notice_address: string | null;
  deadline: string | null;
  raw_summary: string | null;
};

export type BrokerEmail = {
  subject: string;
  body: string;
  broker_name: string | null;
  broker_email: string | null;
};

export type LeasePublicData = {
  label: string;
  role: string;
  counterparty_name: string | null;
  property_address: string | null;
  requirements: LeaseRequirementItem[];
  created_at: string;
};

export const leaseComplianceApi = {
  extract(text: string): Promise<{ ok: boolean; extraction: LeaseExtraction }> {
    return request<{ ok: boolean; extraction: LeaseExtraction }>("/lease-compliance/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  },
  async extractPdf(file: File): Promise<{ ok: boolean; extraction: LeaseExtraction }> {
    const formData = new FormData();
    formData.append("file", file);
    const url = `${API_BASE}/lease-compliance/extract-pdf`;
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(url, { method: "POST", headers, body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Extraction failed");
    return data;
  },
  create(payload: LeaseRequirementCreate): Promise<LeaseRequirement> {
    return request<LeaseRequirement>("/lease-compliance/requirements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  list(role?: string, policyId?: number): Promise<LeaseRequirement[]> {
    const params: string[] = [];
    if (role) params.push(`role=${role}`);
    if (policyId != null) params.push(`policy_id=${policyId}`);
    const qs = params.length ? `?${params.join("&")}` : "";
    return request<LeaseRequirement[]>(`/lease-compliance/requirements${qs}`);
  },
  get(id: number): Promise<LeaseRequirement> {
    return request<LeaseRequirement>(`/lease-compliance/requirements/${id}`);
  },
  update(id: number, payload: Partial<LeaseRequirementCreate> & { status?: string }): Promise<LeaseRequirement> {
    return request<LeaseRequirement>(`/lease-compliance/requirements/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  remove(id: number): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/lease-compliance/requirements/${id}`, { method: "DELETE" });
  },
  runCheck(id: number, against: string, options?: { certificateId?: number; policyId?: number }): Promise<ComplianceCheckResult> {
    return request<ComplianceCheckResult>(`/lease-compliance/requirements/${id}/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ against, certificate_id: options?.certificateId, policy_id: options?.policyId }),
    });
  },
  listChecks(id: number): Promise<ComplianceCheckResult[]> {
    return request<ComplianceCheckResult[]>(`/lease-compliance/requirements/${id}/checks`);
  },
  brokerEmail(id: number): Promise<BrokerEmail> {
    return request<BrokerEmail>(`/lease-compliance/requirements/${id}/broker-email`, {
      method: "POST",
    });
  },
  sendToTenant(id: number, tenantEmail: string, tenantName?: string, notes?: string, fromName?: string): Promise<{ ok: boolean; public_url: string }> {
    return request<{ ok: boolean; public_url: string }>(`/lease-compliance/requirements/${id}/send-to-tenant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenant_email: tenantEmail, tenant_name: tenantName, notes, from_name: fromName }),
    });
  },
  sendDeficiencyNotice(id: number, tenantEmail: string, tenantName?: string, notes?: string, fromName?: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/lease-compliance/requirements/${id}/send-deficiency`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenant_email: tenantEmail, tenant_name: tenantName, notes, from_name: fromName }),
    });
  },
  getPublic(code: string): Promise<LeasePublicData> {
    return request<LeasePublicData>(`/lease-compliance/public/${code}`);
  },
  async submitCoiPublic(code: string, file: File, tenantName: string, tenantEmail: string, tenantNotes?: string): Promise<{ ok: boolean; id: number; status: string }> {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("tenant_name", tenantName);
    formData.append("tenant_email", tenantEmail);
    if (tenantNotes) formData.append("tenant_notes", tenantNotes);
    const url = `${API_BASE}/lease-compliance/public/${code}/submit-coi`;
    const res = await fetch(url, { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Submission failed");
    return data;
  },
  async pollPublicCheckStatus(checkId: number): Promise<{ id: number; status: string; ok?: boolean; results?: ComplianceResultItem[]; pass_count?: number; fail_count?: number; unclear_count?: number; error?: string }> {
    const url = `${API_BASE}/lease-compliance/public/checks/${checkId}/status`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Status check failed");
    return data;
  },
  async downloadCoiDocument(checkId: number): Promise<Blob> {
    const url = `${API_BASE}/lease-compliance/checks/${checkId}/document`;
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error("Document not found");
    return res.blob();
  },
  async checkDocument(reqId: number, file: File): Promise<{ ok: boolean; id: number; status: string }> {
    const formData = new FormData();
    formData.append("file", file);
    const url = `${API_BASE}/lease-compliance/requirements/${reqId}/check-document`;
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(url, { method: "POST", headers, body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Document check failed");
    return data;
  },
  async pollCheckStatus(checkId: number): Promise<{ id: number; status: string; ok?: boolean; results?: ComplianceResultItem[]; pass_count?: number; fail_count?: number; unclear_count?: number; checked_against?: string; has_document?: boolean; error?: string }> {
    return request(`/lease-compliance/checks/${checkId}/status`);
  },
  sendToLandlord(id: number, landlordEmail: string, landlordName?: string, notes?: string, fromName?: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/lease-compliance/requirements/${id}/send-to-landlord`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ landlord_email: landlordEmail, landlord_name: landlordName, notes, from_name: fromName }),
    });
  },
};

// ── Chat API ────────────────────────────────────────

export type ChatConversation = {
  id: number;
  title: string | null;
  created_at: string;
  updated_at: string;
};

export type ChatMessageData = {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export const chatApi = {
  listConversations(): Promise<ChatConversation[]> {
    return request<ChatConversation[]>("/chat/conversations");
  },
  getMessages(conversationId: number): Promise<ChatMessageData[]> {
    return request<ChatMessageData[]>(`/chat/conversations/${conversationId}/messages`);
  },
  deleteConversation(conversationId: number): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/chat/conversations/${conversationId}`, { method: "DELETE" });
  },
  sendMessageStream(
    message: string,
    conversationId: number | null,
    onText: (text: string) => void,
    onConversationId: (id: number) => void,
    onDone: () => void,
    onError: (err: string) => void,
    policyId?: number | null,
    comparePolicyIds?: number[] | null,
  ): AbortController {
    const controller = new AbortController();
    const token = getToken();
    const url = `${API_BASE}/chat/send`;

    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        message,
        conversation_id: conversationId,
        ...(policyId ? { policy_id: policyId } : {}),
        ...(comparePolicyIds && comparePolicyIds.length > 0 ? { compare_policy_ids: comparePolicyIds } : {}),
      }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.detail || `${res.status} ${res.statusText}`);
        }
        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;
            try {
              const event = JSON.parse(jsonStr);
              if (event.type === "conversation_id") {
                onConversationId(event.id);
              } else if (event.type === "text") {
                onText(event.content);
              } else if (event.type === "error") {
                onError(event.content);
              } else if (event.type === "done") {
                onDone();
              }
            } catch {
              // skip malformed JSON
            }
          }
        }
        // Process remaining buffer
        if (buffer.startsWith("data: ")) {
          try {
            const event = JSON.parse(buffer.slice(6).trim());
            if (event.type === "done") onDone();
          } catch { /* ignore */ }
        }
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          onError(err.message || "Connection failed");
        }
      });

    return controller;
  },
};
