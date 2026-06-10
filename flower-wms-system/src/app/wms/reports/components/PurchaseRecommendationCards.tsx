import { Badge } from "@/components/ui/Badge";
import { formatPercent } from "@/lib/format-money";
import { formatSignedPercent } from "@/lib/format-display";
import {
  getTagDescription,
  getTagLabel,
  getTagVariant,
} from "@/lib/purchase-analytics-tags";
import type {
  PurchaseAnalyticsBatchConversionRow,
  PurchaseAnalyticsFlowerTrendRow,
  PurchaseAnalyticsReport,
  PurchaseAnalyticsSupplierRow,
} from "@/lib/purchase-analytics-types";

type SuggestionItem = {
  id: string;
  name: string;
  entityType: "供应商" | "花材" | "批次";
  tagKey: string;
  tagLabel: string;
  reason: string;
};

type SuggestionGroup = {
  title: string;
  items: SuggestionItem[];
};

function buildSupplierSuggestions(rows: PurchaseAnalyticsSupplierRow[]): SuggestionItem[] {
  const items: SuggestionItem[] = [];
  for (const row of rows) {
    for (const tag of row.tags) {
      if (!["STABLE_SUPPLIER", "OBSERVE", "CAUTIOUS_PURCHASE", "HIGH_LOSS_IMPACT"].includes(tag.key)) {
        continue;
      }
      items.push({
        id: `${row.supplierId}:${tag.key}`,
        name: row.supplierName,
        entityType: "供应商",
        tagKey: tag.key,
        tagLabel: getTagLabel(tag),
        reason:
          tag.key === "CAUTIOUS_PURCHASE" || tag.key === "HIGH_LOSS_IMPACT"
            ? `${row.supplierName}：损耗影响率 ${
                row.lossImpactRate === null ? "—" : formatPercent(row.lossImpactRate)
              }，建议观察后续批次状态。`
            : tag.key === "STABLE_SUPPLIER"
              ? `${row.supplierName}：近期采购 ${row.purchaseOrderCount} 单，损耗影响较稳定。`
              : `${row.supplierName}：采购样本较少，建议继续积累数据后再判断。`,
      });
    }
  }
  return items;
}

function buildFlowerSuggestions(rows: PurchaseAnalyticsFlowerTrendRow[]): SuggestionItem[] {
  const items: SuggestionItem[] = [];
  for (const row of rows) {
    for (const tag of row.tags) {
      if (!["PRICE_UP", "PRICE_DOWN", "INSUFFICIENT_DATA", "HIGH_LOSS_IMPACT"].includes(tag.key)) {
        continue;
      }
      let reason = getTagDescription(tag);
      if (tag.key === "PRICE_UP" && row.actualUnitCostChangeRate !== null) {
        reason = `${row.flowerName}：最近采购价上涨 ${formatSignedPercent(row.actualUnitCostChangeRate)}，建议下次采购前重新确认价格。`;
      } else if (tag.key === "PRICE_DOWN" && row.actualUnitCostChangeRate !== null) {
        reason = `${row.flowerName}：最近采购价下降 ${formatSignedPercent(row.actualUnitCostChangeRate)}，可关注补货窗口。`;
      } else if (tag.key === "INSUFFICIENT_DATA") {
        reason = `${row.flowerName}：当前仅有 ${row.purchaseCount} 次采购记录，建议继续观察。`;
      } else if (tag.key === "HIGH_LOSS_IMPACT") {
        reason = `${row.flowerName}：损耗影响率 ${
          row.lossImpactRate === null ? "—" : formatPercent(row.lossImpactRate)
        }，建议谨慎加大采购。`;
      }
      items.push({
        id: `${row.flowerWikiId}:${tag.key}`,
        name: row.flowerName,
        entityType: "花材",
        tagKey: tag.key,
        tagLabel: getTagLabel(tag),
        reason,
      });
    }
  }
  return items;
}

function buildBatchSuggestions(rows: PurchaseAnalyticsBatchConversionRow[]): SuggestionItem[] {
  const items: SuggestionItem[] = [];
  for (const row of rows) {
    for (const tag of row.tags) {
      if (!["PRIORITIZE_USE", "SLOW_MOVING", "GOOD_CONVERSION", "HIGH_LOSS_IMPACT"].includes(tag.key)) {
        continue;
      }
      let reason = getTagDescription(tag);
      if (tag.key === "PRIORITIZE_USE" && row.remainingRate !== null) {
        reason = `批次 ${row.batchNo ?? row.batchId.slice(0, 8)}：剩余率 ${formatPercent(row.remainingRate)}，建议优先消耗。`;
      } else if (tag.key === "SLOW_MOVING") {
        reason = `批次 ${row.batchNo ?? row.batchId.slice(0, 8)}：销售转化率 ${
          row.salesConversionRate === null ? "—" : formatPercent(row.salesConversionRate)
        }，周转偏慢。`;
      } else if (tag.key === "GOOD_CONVERSION") {
        reason = `${row.flowerName} 批次转化表现较好，可作为稳定补货参考。`;
      }
      items.push({
        id: `${row.batchId}:${tag.key}`,
        name: row.batchNo ?? row.flowerName,
        entityType: "批次",
        tagKey: tag.key,
        tagLabel: getTagLabel(tag),
        reason,
      });
    }
  }
  return items;
}

function buildSuggestionGroups(report: PurchaseAnalyticsReport): SuggestionGroup[] {
  const supplierItems = buildSupplierSuggestions(report.supplierRanking).filter((item) =>
    ["STABLE_SUPPLIER", "OBSERVE"].includes(item.tagKey)
  );
  const priceItems = buildFlowerSuggestions(report.flowerPriceTrends).filter((item) =>
    ["PRICE_UP", "PRICE_DOWN"].includes(item.tagKey)
  );
  const prioritizeItems = buildBatchSuggestions(report.batchSalesConversion).filter((item) =>
    item.tagKey === "PRIORITIZE_USE"
  );
  const cautiousItems = [
    ...buildSupplierSuggestions(report.supplierRanking).filter((item) =>
      ["CAUTIOUS_PURCHASE", "HIGH_LOSS_IMPACT"].includes(item.tagKey)
    ),
    ...buildFlowerSuggestions(report.flowerPriceTrends).filter((item) =>
      item.tagKey === "HIGH_LOSS_IMPACT"
    ),
    ...buildBatchSuggestions(report.batchSalesConversion).filter((item) =>
      ["SLOW_MOVING", "HIGH_LOSS_IMPACT"].includes(item.tagKey)
    ),
  ];
  const observeItems = buildFlowerSuggestions(report.flowerPriceTrends).filter((item) =>
    item.tagKey === "INSUFFICIENT_DATA"
  );

  return [
    { title: "建议关注的供应商", items: supplierItems },
    { title: "价格波动花材", items: priceItems },
    { title: "建议优先消耗批次", items: prioritizeItems },
    { title: "谨慎采购项", items: cautiousItems },
    { title: "数据不足，继续观察", items: observeItems },
  ].filter((group) => group.items.length > 0);
}

function SuggestionCard({ item }: { item: SuggestionItem }) {
  return (
    <div className="rounded-lg border border-zinc-100 bg-zinc-50/80 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="font-medium text-zinc-900">{item.name}</p>
        <Badge variant="default">{item.entityType}</Badge>
        <Badge variant={getTagVariant(item.tagKey)}>{item.tagLabel}</Badge>
      </div>
      <p className="text-sm text-zinc-600">{item.reason}</p>
    </div>
  );
}

export function PurchaseRecommendationCards({
  report,
}: {
  report: PurchaseAnalyticsReport;
}) {
  const groups = buildSuggestionGroups(report);

  if (groups.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        当前时间范围内暂无足够数据生成采购建议，完成更多采购与销售后可查看建议。
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <div key={group.title}>
          <h4 className="mb-3 text-sm font-medium text-zinc-800">{group.title}</h4>
          <div className="grid gap-3 lg:grid-cols-2">
            {group.items.map((item) => (
              <SuggestionCard key={item.id} item={item} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
