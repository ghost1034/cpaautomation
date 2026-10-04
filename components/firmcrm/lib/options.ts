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

/* Billing form dropdowns. Values are what the API stores; the PDF omits the country line for "US". */
export const US_STATES: [string, string][] = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"], ["CO", "Colorado"], ["CT", "Connecticut"],
  ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"],
  ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"], ["MD", "Maryland"],
  ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"],
  ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"], ["NC", "North Carolina"],
  ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"],
  ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"],
  ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"], ["AS", "American Samoa"], ["GU", "Guam"],
  ["MP", "Northern Mariana Islands"], ["PR", "Puerto Rico"], ["VI", "U.S. Virgin Islands"],
];
/** "US" stays a code (existing default, hidden on the PDF); other countries store the name that prints on the invoice. */
export const COUNTRIES: { value: string; label: string }[] = [
  { value: "US", label: "United States" },
  ...["Canada", "Mexico", "United Kingdom", "Ireland", "Australia", "New Zealand", "Germany", "France", "Netherlands", "Switzerland",
    "Spain", "Italy", "India", "Singapore", "Hong Kong", "Japan", "Israel", "United Arab Emirates", "Brazil"].map((c) => ({ value: c, label: c })),
];
export const CURRENCIES: { value: string; label: string }[] = [
  ["USD", "US dollar"], ["CAD", "Canadian dollar"], ["EUR", "Euro"], ["GBP", "British pound"], ["AUD", "Australian dollar"],
  ["NZD", "New Zealand dollar"], ["CHF", "Swiss franc"], ["MXN", "Mexican peso"], ["INR", "Indian rupee"], ["SGD", "Singapore dollar"],
  ["HKD", "Hong Kong dollar"], ["ILS", "Israeli shekel"], ["AED", "UAE dirham"],
].map(([code, name]) => ({ value: code, label: `${code} — ${name}` }));
export const PAYMENT_TERMS: { value: number; label: string }[] = [
  { value: 0, label: "Due on receipt" }, ...[7, 10, 15, 30, 45, 60, 90].map((d) => ({ value: d, label: `Net ${d} (${d} days)` })),
];

/** `options` plus the current value when it is not one of them, so legacy or custom values still show and save. */
export function withCurrent<T extends string | number>(options: { value: T; label: string }[], current: unknown, label = (v: T) => String(v)) {
  if (current == null || current === "" || options.some((o) => o.value === current)) return options;
  return [...options, { value: current as T, label: label(current as T) }];
}
