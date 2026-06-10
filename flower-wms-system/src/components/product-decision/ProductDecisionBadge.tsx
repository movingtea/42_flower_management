"use client";

import { Badge } from "@/components/ui/Badge";
import {
  resolveProductHealthStatus,
  type ProductHealthStatusKey,
} from "@/lib/product-decision-tags";

export function ProductDecisionHealthBadge({
  status,
  statusLabel,
}: {
  status: ProductHealthStatusKey;
  statusLabel?: string | null;
}) {
  const resolved = resolveProductHealthStatus(status, statusLabel);
  return <Badge variant={resolved.variant}>{resolved.label}</Badge>;
}
