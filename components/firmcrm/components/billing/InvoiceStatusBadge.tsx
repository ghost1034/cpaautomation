import { Badge } from "@/components/firmcrm/components/ui";
import type { InvoiceStatus } from "@/components/firmcrm/api/types";
import { titleCase } from "@/components/firmcrm/lib/format";

const TONE = { draft: "slate", issued: "blue", sent: "amber", paid: "green", void: "red" } as const;

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return <Badge dot tone={TONE[status]}>{titleCase(status)}</Badge>;
}
