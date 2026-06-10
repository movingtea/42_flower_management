import { Badge } from "@/components/ui/Badge";
import { getGiftOccasionLabel } from "@/lib/crm-tags";

export function ProductOccasionTagsBadge({
  tags,
}: {
  tags?: string[] | null;
}) {
  if (!tags || tags.length === 0) {
    return <span className="text-zinc-400">—</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <Badge key={tag} variant="info">
          {getGiftOccasionLabel(tag)}
        </Badge>
      ))}
    </div>
  );
}
