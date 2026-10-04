export const ACCOUNT_TYPES = ["prospect", "client", "former_client", "referral_source", "adverse_party", "vendor", "other"];
export const ENTITY_KINDS = ["company", "individual", "trust", "estate"];
export const REVENUE_BANDS = ["<$1M", "$1M–$10M", "$10M–$50M", "$50M–$100M", "$100M–$500M", ">$500M"];
export const INDUSTRIES = ["Software", "Manufacturing", "Healthcare", "Real Estate", "Professional Services", "Consumer", "Financial Services", "Construction", "Nonprofit", "Life Sciences", "Energy", "Other"];
export const CONTACT_ROLES = ["decision_maker", "influencer", "champion", "gatekeeper", "referral_source", "other"];
export const LIFECYCLES = ["lead", "prospect", "client", "referral_source", "other"];
export const LEAD_SOURCES = ["web", "referral", "event", "webinar", "cold", "partner", "other"];
export const LEAD_STATUSES = ["new", "contacted", "qualified", "unqualified"];
export const FEE_TYPES = ["hourly", "fixed", "retainer", "recurring", "contingency", "value"];
export const EL_STATUSES = ["not_started", "drafted", "sent", "signed"];
export const LOST_REASONS = ["price", "selected competitor", "no decision", "timing", "conflict", "scope change", "other"];
export const ACTIVITY_KINDS = ["call", "email", "meeting", "note", "task"] as const;
export const CAMPAIGN_KINDS = ["event", "webinar", "newsletter", "seminar", "sponsorship", "content", "other"];
export const CAMPAIGN_STATUSES = ["planned", "active", "completed"];
export const MEMBER_STATUSES = ["invited", "registered", "attended", "responded", "no_show"];
export const ENGAGEMENT_STATUSES = ["active", "completed", "on_hold", "terminated"];
export const INVOICE_STATUSES = ["draft", "issued", "sent", "paid", "void"];
export const RISK = ["low", "medium", "high"];
export const ROLES = ["admin", "partner", "manager", "staff", "marketing"];
export const DISCIPLINES = ["accounting", "legal", "advisory", "other"];
export const INDEPENDENCE_QUESTIONS: { key: string; label: string }[] = [
  { key: "financial_interest", label: "Any covered person holds a direct or material indirect financial interest in the client" },
  { key: "family_relationship", label: "Immediate family member of an engagement team member holds a key position at the client" },
  { key: "prior_employment", label: "A partner or manager was employed by the client within the last 2 years" },
  { key: "non_attest_services", label: "Firm provides bookkeeping, valuation, or management functions to the client" },
  { key: "contingent_fees", label: "Any fee arrangement with the client is contingent" },
  { key: "business_relationship", label: "Firm or partners have a joint business relationship with the client" },
];
