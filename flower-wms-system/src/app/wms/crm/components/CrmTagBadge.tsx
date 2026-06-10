import { Badge } from "@/components/ui/Badge";
import {
  getCustomerSourceLabel,
  getGiftOccasionLabel,
  getRecipientRelationLabel,
  getReminderStatusLabel,
  getReminderStatusVariant,
  getReminderTypeLabel,
} from "@/lib/crm-tags";

export function CustomerSourceBadge({ source }: { source?: string | null }) {
  return <Badge variant="info">{getCustomerSourceLabel(source)}</Badge>;
}

export function GiftOccasionBadge({
  type,
  label,
}: {
  type?: string | null;
  label?: string | null;
}) {
  return <Badge variant="default">{getGiftOccasionLabel(type, label)}</Badge>;
}

export function RelationBadge({
  type,
  label,
}: {
  type?: string | null;
  label?: string | null;
}) {
  return <Badge variant="default">{getRecipientRelationLabel(type, label)}</Badge>;
}

export function ReminderStatusBadge({ status }: { status?: string | null }) {
  return (
    <Badge variant={getReminderStatusVariant(status)}>
      {getReminderStatusLabel(status)}
    </Badge>
  );
}

export function ReminderTypeBadge({ type }: { type?: string | null }) {
  return <Badge variant="info">{getReminderTypeLabel(type)}</Badge>;
}
