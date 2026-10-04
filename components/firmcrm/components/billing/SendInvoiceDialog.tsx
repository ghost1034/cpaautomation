import { useState } from "react";
import { billingApi } from "@/components/firmcrm/api";
import type { BillingProfile, Invoice } from "@/components/firmcrm/api/types";
import { Button, Field, Input, Modal, Textarea } from "@/components/firmcrm/components/ui";
import { useFieldValidation } from "@/components/firmcrm/components/ui/Form";
import { useToast } from "@/components/firmcrm/components/ui/Toast";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const splitEmails = (s: string) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);

/** Email the invoice PDF. Sending a draft issues it first; a failed delivery is recorded and leaves the status unchanged. */
export function SendInvoiceDialog({ invoice, profile, onClose, onSent }: { invoice: Invoice; profile: BillingProfile | undefined; onClose: () => void; onSent: () => void }) {
  const { toast, error } = useToast();
  const [values, setValues] = useState({
    to: invoice.billed_to_email ?? "", cc: invoice.billed_to_cc ?? "",
    subject: profile?.email_subject_template ?? "Invoice {invoice_number} from {issuer_name}",
    message: profile?.email_message_template ?? "",
  });
  const [busy, setBusy] = useState(false);
  const v = useFieldValidation(values, {
    to: (x) => (!x ? "Recipient is required." : EMAIL.test(String(x).trim()) ? null : "Enter a valid email address."),
    cc: (x) => (splitEmails(String(x ?? "")).every((e) => EMAIL.test(e)) ? null : "Separate valid addresses with commas."),
    subject: (x) => (x ? null : "Subject is required."),
  });
  const set = (k: keyof typeof values) => (e: { target: { value: string } }) => setValues((s) => ({ ...s, [k]: e.target.value }));
  const submit = async () => {
    v.touchAll();
    if (!v.valid) return;
    setBusy(true);
    try {
      const delivery = await billingApi.send(invoice.id, { to: values.to.trim(), cc: splitEmails(values.cc), subject: values.subject, message: values.message || null });
      onSent();
      if (delivery.status === "sent") { toast(`Invoice sent to ${delivery.to_email}`); onClose(); }
      else error(new Error(delivery.error ?? "Email delivery failed. The invoice was not marked as sent."));
    } catch (err) { error(err); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Send invoice ${invoice.number ?? ""}`.trim()} size="wide"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit} disabled={busy}>{busy ? "Sending…" : "Send invoice"}</Button></>}>
      {invoice.status === "draft" && <p className="mb-4 rounded-crm-md border border-crm-warn-200 bg-crm-warn-50 px-3 py-2 text-[13px] text-crm-warn-700">Sending issues this draft: it gets the next invoice number and can no longer be edited.</p>}
      <div className="grid grid-cols-2 gap-4">
        <Field label="To *" error={v.shown("to")} errorId={v.errorId("to")}><Input type="email" value={values.to} onChange={set("to")} {...v.fieldProps("to")} /></Field>
        <Field label="CC" hint="Comma-separated" error={v.shown("cc")} errorId={v.errorId("cc")}><Input value={values.cc} onChange={set("cc")} {...v.fieldProps("cc")} /></Field>
        <Field label="Subject *" className="col-span-2" error={v.shown("subject")} errorId={v.errorId("subject")}><Input value={values.subject} onChange={set("subject")} {...v.fieldProps("subject")} /></Field>
        <Field label="Message" className="col-span-2" hint="{invoice_number}, {total}, {due_date}, {customer_name} and {issuer_name} are filled in when sent. The PDF is attached.">
          <Textarea rows={7} value={values.message} onChange={set("message")} />
        </Field>
      </div>
    </Modal>
  );
}
