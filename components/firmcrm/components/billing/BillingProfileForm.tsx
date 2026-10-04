import { useMemo, useState } from "react";
import { billingApi } from "@/components/firmcrm/api";
import type { BillingProfile, BillingProfileInput } from "@/components/firmcrm/api/types";
import { FormModal, type FieldDef, type FormValues } from "@/components/firmcrm/components/ui/Form";
import { useQueryClient } from "@/components/firmcrm/lib/query";
import { useToast } from "@/components/firmcrm/components/ui/Toast";
import { SAMPLE_VALUES } from "./templatePlaceholders";
import { COUNTRIES, PAYMENT_TERMS, US_STATES, withCurrent } from "@/components/firmcrm/lib/options";
import { PHONE_FORMAT, POSTAL_FORMAT, ROUTING_FORMAT, SWIFT_FORMAT, SWIFT_PATTERN, ZIP_FORMAT, isValidRouting } from "@/components/firmcrm/lib/inputFormat";

const HEX = /^#[0-9a-f]{6}$/i;
const STATE_OPTIONS = US_STATES.map(([code, name]) => ({ value: code, label: `${name} (${code})` }));
const isUS = (country: unknown) => !country || ["US", "USA", "United States"].includes(String(country));
const NEW_PROFILE: FormValues = {
  accent_color: "#1683DB", country: "US", default_terms_days: 30, default_terms_text: "Please pay invoice by {due_date}",
  email_subject_template: "Invoice {invoice_number} from {issuer_name}",
  email_message_template: "Hello,\n\nPlease find invoice {invoice_number} for {total} attached, due {due_date}.\n\nThank you,\n{issuer_name}",
};

/** Create or edit a billing profile. The bank account number is write-only: the API only ever returns its last four digits. */
export function BillingProfileForm({ profile, onClose }: { profile: BillingProfile | null; onClose: () => void }) {
  const qc = useQueryClient(); const { toast } = useToast();
  const issuerName = profile?.issuer_name;
  const initial = useMemo(() => (profile ? ({ ...profile, account_number: "" } as unknown as FormValues) : NEW_PROFILE), [profile]);
  const [values, setValues] = useState<FormValues>(initial);
  // State, ZIP and their formatting follow the selected country; the dropdowns keep any legacy free-text value.
  const us = isUS(values.country);
  const { state, country, default_terms_days: termsDays } = values;
  const fields = useMemo<FieldDef[]>(() => {
    const sample = { ...SAMPLE_VALUES, issuer_name: issuerName || SAMPLE_VALUES.issuer_name };
    return [
      { name: "label", label: "Profile name", required: true, placeholder: "e.g. Operating account", hint: "Shown when choosing a profile on an invoice." },
      { name: "is_default", label: "Default for new invoices", type: "checkbox" },
      { name: "issuer_name", label: "Company name on invoice", required: true, span: 2, placeholder: "e.g. Smith & Associates CPAs, LLP", autoComplete: "organization" },
      { name: "address_line1", label: "Address line 1", span: 2, placeholder: "Street address, e.g. 123 Main Street", autoComplete: "address-line1" },
      { name: "address_line2", label: "Address line 2", span: 2, placeholder: "Suite, floor, etc. (optional)", autoComplete: "address-line2" },
      { name: "country", label: "Country", type: "select", options: withCurrent(COUNTRIES, country), placeholder: "Select country…" },
      { name: "city", label: "City", placeholder: "e.g. Springfield", autoComplete: "address-level2" },
      us ? { name: "state", label: "State", type: "select", options: withCurrent(STATE_OPTIONS, state), placeholder: "Select state…" }
        : { name: "state", label: "State / province / region", placeholder: "e.g. Ontario", maxLength: 40, autoComplete: "address-level1" },
      us ? { name: "postal_code", label: "ZIP code", placeholder: "12345 or 12345-6789", format: ZIP_FORMAT, inputMode: "numeric", autoComplete: "postal-code",
             validate: (v) => (v && !/^\d{5}(-\d{4})?$/.test(String(v)) ? "Enter a 5-digit ZIP or ZIP+4." : null) }
        : { name: "postal_code", label: "Postal code", placeholder: "e.g. K1A 0B6", format: POSTAL_FORMAT, maxLength: 20, autoComplete: "postal-code" },
      { name: "phone", label: "Phone", placeholder: "(555) 123-4567", format: PHONE_FORMAT, inputMode: "tel", maxLength: 40, autoComplete: "tel" },
      { name: "email", label: "Billing email", type: "email", placeholder: "billing@yourfirm.com", hint: "Customers' replies go here.", autoComplete: "email" },
      { name: "website", label: "Website", placeholder: "www.yourfirm.com", inputMode: "url", maxLength: 255, autoComplete: "url" },
      { name: "accent_color", label: "Accent color", type: "color", placeholder: "#1683DB", hint: "Color of the invoice bands and table header.",
        validate: (v) => (v && !HEX.test(String(v)) ? "Use a hex color such as #1683DB." : null) },
      { name: "bank_name", label: "Bank name", placeholder: "e.g. First National Bank" },
      { name: "account_name", label: "Account name", placeholder: "Name on the bank account" },
      { name: "routing_number", label: "Routing number (ABA)", placeholder: "9 digits, e.g. 021000021", format: ROUTING_FORMAT, inputMode: "numeric", autoComplete: "off",
        validate: (v) => (!v ? null : String(v).length !== 9 ? "Routing numbers are 9 digits." : isValidRouting(String(v)) ? null : "This isn’t a valid ABA routing number. Check for a typo.") },
      { name: "account_number", label: "Account number", type: "password", inputMode: "numeric", maxLength: 40,
        placeholder: profile?.account_number_last4 ? `•••• ${profile.account_number_last4} — leave blank to keep` : "Bank account number",
        hint: "Stored encrypted. Printed in full only on invoice PDFs." },
      { name: "swift_code", label: "SWIFT / BIC", placeholder: "8 or 11 characters, e.g. CHASUS33", format: SWIFT_FORMAT, autoComplete: "off", hint: "For international wires.",
        validate: (v) => (v && !SWIFT_PATTERN.test(String(v)) ? "SWIFT/BIC codes are 8 or 11 letters and digits, e.g. CHASUS33." : null) },
      { name: "default_terms_days", label: "Payment terms", type: "select", required: true, placeholder: "Select terms…",
        options: withCurrent(PAYMENT_TERMS, termsDays, (d) => `Net ${d} (${d} days)`), hint: "Sets the due date when an invoice is issued." },
      { name: "default_terms_text", label: "Terms text", type: "template", maxLength: 500, previewValues: sample, hint: "Printed above the payment details on new invoices." },
      { name: "email_subject_template", label: "Email subject", type: "template", required: true, maxLength: 300, previewValues: sample },
      { name: "email_message_template", label: "Email message", type: "template", multiline: true, maxLength: 5000, previewValues: sample, hint: "The invoice PDF is attached automatically." },
      { name: "footer_note", label: "Footer note", type: "textarea", placeholder: "e.g. EIN 12-3456789 · A 1.5% monthly late fee applies after 30 days.",
        hint: "Optional text printed under the terms, e.g. tax ID or late-fee policy." },
    ];
  }, [profile?.account_number_last4, issuerName, us, state, country, termsDays]);
  return (
    <FormModal open onClose={onClose} title={profile ? `Edit ${profile.label}` : "New billing profile"} fields={fields} initial={initial}
      values={values} onValuesChange={setValues}
      submitLabel={profile ? "Save" : "Create"}
      onSubmit={async (v) => {
        const body: Record<string, unknown> = {};
        for (const f of fields) body[f.name] = v[f.name] === "" ? null : v[f.name] ?? null;
        body.is_default = !!v.is_default;
        // A blank account number on edit means "keep the stored one".
        if (profile && !v.account_number) delete body.account_number;
        if (profile) await billingApi.updateProfile(profile.id, body as Partial<BillingProfileInput>);
        else await billingApi.createProfile(body as BillingProfileInput);
        qc.invalidateQueries({ queryKey: ["billing-profiles"] });
        toast(profile ? "Billing profile saved" : "Billing profile created");
      }} />
  );
}
