import { useMemo } from "react";
import { billingApi } from "@/components/firmcrm/api";
import type { BillingProfile, BillingProfileInput } from "@/components/firmcrm/api/types";
import { FormModal, type FieldDef, type FormValues } from "@/components/firmcrm/components/ui/Form";
import { useQueryClient } from "@/components/firmcrm/lib/query";
import { useToast } from "@/components/firmcrm/components/ui/Toast";

const HEX = /^#[0-9a-f]{6}$/i;
const NEW_PROFILE: FormValues = {
  accent_color: "#1683DB", country: "US", default_terms_days: 30, default_terms_text: "Please pay invoice by {due_date}",
  email_subject_template: "Invoice {invoice_number} from {issuer_name}",
  email_message_template: "Hello,\n\nPlease find invoice {invoice_number} for {total} attached, due {due_date}.\n\nThank you,\n{issuer_name}",
};

/** Create or edit a billing profile. The bank account number is write-only: the API only ever returns its last four digits. */
export function BillingProfileForm({ profile, onClose }: { profile: BillingProfile | null; onClose: () => void }) {
  const qc = useQueryClient(); const { toast } = useToast();
  const fields = useMemo<FieldDef[]>(() => [
    { name: "label", label: "Profile name", required: true, placeholder: "Operating account", hint: "Shown when choosing a profile on an invoice." },
    { name: "is_default", label: "Default for new invoices", type: "checkbox" },
    { name: "issuer_name", label: "Company name on invoice", required: true, span: 2 },
    { name: "address_line1", label: "Address line 1", span: 2 }, { name: "address_line2", label: "Address line 2", span: 2 },
    { name: "city", label: "City" }, { name: "state", label: "State" },
    { name: "postal_code", label: "ZIP / postal code" }, { name: "country", label: "Country" },
    { name: "phone", label: "Phone" }, { name: "email", label: "Billing email", type: "email", hint: "Customers' replies go here." },
    { name: "website", label: "Website" },
    { name: "accent_color", label: "Accent color", placeholder: "#1683DB", hint: "Hex color for the invoice bands and table header.",
      validate: (v) => (v && !HEX.test(String(v)) ? "Use a hex color such as #1683DB." : null) },
    { name: "bank_name", label: "Bank name" }, { name: "account_name", label: "Account name" },
    { name: "routing_number", label: "Routing number (ABA)" },
    { name: "account_number", label: "Account number", type: "password",
      placeholder: profile?.account_number_last4 ? `•••• ${profile.account_number_last4} — leave blank to keep` : undefined,
      hint: "Stored encrypted. Printed in full only on invoice PDFs." },
    { name: "swift_code", label: "SWIFT / BIC", hint: "For international wires." },
    { name: "default_terms_days", label: "Payment terms (days)", type: "number", min: 0, max: 365 },
    { name: "default_terms_text", label: "Terms text", span: 2, hint: "Placeholders: {due_date}, {issue_date}, {invoice_number}, {total}." },
    { name: "email_subject_template", label: "Email subject", span: 2, required: true },
    { name: "email_message_template", label: "Email message", type: "textarea", hint: "Also accepts {customer_name} and {issuer_name}." },
    { name: "footer_note", label: "Footer note", type: "textarea", hint: "Optional text printed under the terms, e.g. tax ID or late-fee policy." },
  ], [profile?.account_number_last4]);
  const initial = profile ? ({ ...profile, account_number: "" } as unknown as FormValues) : NEW_PROFILE;
  return (
    <FormModal open onClose={onClose} title={profile ? `Edit ${profile.label}` : "New billing profile"} fields={fields} initial={initial}
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
