"use client";

import { Badge } from "@/components/ui/Badge";
import {
  getProductDecisionTagLabel,
  getProductDecisionTagVariant,
  type ProductDecisionTagLike,
} from "@/lib/product-decision-tags";

export function ProductDecisionTags({
  tags,
  limit,
  title,
}: {
  tags: ProductDecisionTagLike[];
  limit?: number;
  title?: string;
}) {
  if (!tags || tags.length === 0) {
    return <span className="text-zinc-400">—</span>;
  }

  const visible = limit ? tags.slice(0, limit) : tags;

  return (
    <div className="space-y-1">
      {title ? <p className="text-xs font-medium text-zinc-500">{title}</p> : null}
      <div className="flex flex-wrap gap-1.5">
        {visible.map((tag) => (
          <span key={tag.key} title={tag.reason}>
            <Badge variant={getProductDecisionTagVariant(tag)}>
              {getProductDecisionTagLabel(tag)}
            </Badge>
          </span>
        ))}
        {limit && tags.length > limit ? (
          <span className="text-xs text-zinc-400">+{tags.length - limit}</span>
        ) : null}
      </div>
    </div>
  );
}
