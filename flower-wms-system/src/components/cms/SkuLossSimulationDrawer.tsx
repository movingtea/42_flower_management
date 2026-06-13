"use client";

import type { SkuMarginEstimate } from "@/services/product-margin";
import { AdminDrawer } from "@/components/admin/AdminDrawer";
import { DrawerFooterActions } from "@/components/admin/DrawerFooterActions";
import { SkuLossSimulationContent } from "@/components/cms/SkuLossSimulationContent";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skuLabel: string;
  price: string;
  stock: number | null;
  estimate: SkuMarginEstimate;
  onApplySuggestedPrice?: (price: string) => void;
};

export function SkuLossSimulationDrawer({
  open,
  onOpenChange,
  skuLabel,
  price,
  stock,
  estimate,
  onApplySuggestedPrice,
}: Props) {
  const firstSuggested = estimate.suggestedPrices[0]?.price;

  return (
    <AdminDrawer
      open={open}
      onOpenChange={onOpenChange}
      title="损耗模拟"
      description={`${skuLabel} · 售价 ¥${price || "—"} · 库存 ${stock ?? "—"}`}
      size="lg"
      closeOnOverlayClick
      footer={
        <DrawerFooterActions
          onCancel={() => onOpenChange(false)}
          cancelLabel="关闭"
          hideConfirm={!onApplySuggestedPrice || !firstSuggested}
          confirmLabel="应用建议售价"
          onConfirm={() => {
            if (firstSuggested) onApplySuggestedPrice?.(firstSuggested);
            onOpenChange(false);
          }}
        />
      }
    >
      <SkuLossSimulationContent estimate={estimate} />
    </AdminDrawer>
  );
}
