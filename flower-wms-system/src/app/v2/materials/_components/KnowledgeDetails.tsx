import { parseStoredCareDocument } from "@/lib/wiki-care";
import type { MaterialScopeConfig } from "./material-scope";
import {
  LOSS_MODE_LABEL,
  decimalText,
  formatMoney,
  formatPercent,
} from "./material-format";
import type { MaterialRow } from "./material-types";

/**
 * Read-only knowledge/details block under the material name. Flower rows show
 * the wiki knowledge fields; consumable rows show brand/model, cost and stock
 * metadata only (no flower-care or usable-rate knowledge).
 */
export function KnowledgeDetails({ item, scope }: { item: MaterialRow; scope: MaterialScopeConfig }) {
  if (!scope.showFlowerFields) {
    return <details className="mt-1 text-xs">
      <summary className="cursor-pointer text-emerald-700">规格与库存</summary>
      <div className="mt-2 space-y-1 rounded-lg bg-zinc-50 p-2 text-zinc-600">
        {item.specification && <div><span className="text-zinc-400">规格：</span>{item.specification}</div>}
        {(item.brand || item.model) && <div><span className="text-zinc-400">品牌 / 型号：</span>{[item.brand, item.model].filter(Boolean).join(" / ")}</div>}
        <div><span className="text-zinc-400">安全库存阈值：</span>{decimalText(item.safetyStockThreshold) ?? "0"}</div>
        <div><span className="text-zinc-400">成本：</span>{formatMoney(item)}</div>
        {item.costNote && <div><span className="text-zinc-400">成本备注：</span>{item.costNote}</div>}
        {item.notes && <div><span className="text-zinc-400">备注：</span>{item.notes}</div>}
      </div>
    </details>;
  }

  const careRows = parseStoredCareDocument(item.maintenanceCare)?.filter((row) => row.value.trim()) ?? [];
  const careText = careRows.length > 0
    ? careRows.map((row) => `${row.label}：${row.value.trim()}`).join("\n")
    : item.maintenance;
  const standardRate = decimalText(item.standardUsableRate);
  const lossText = standardRate !== null && Number.isFinite(Number(standardRate))
    ? `${formatPercent(item.standardUsableRate)}（损耗 ${formatPercent(String(1 - Number(standardRate)))}）`
    : "未设置";

  return <details className="mt-1 text-xs">
    <summary className="cursor-pointer text-emerald-700">知识资料</summary>
    <div className="mt-2 space-y-1 rounded-lg bg-zinc-50 p-2 text-zinc-600">
      <div><span className="text-zinc-400">三级分类（种类 · 颜色 · 商品名）：</span>{[item.flowerVariety, item.color, item.flowerProductName].filter(Boolean).join(" · ") || "未设置"}</div>
      {item.englishName && <div><span className="text-zinc-400">学名 / 英文名：</span>{item.englishName}</div>}
      {item.flowerLanguage && <div><span className="text-zinc-400">花语：</span>{item.flowerLanguage}</div>}
      {item.morphology && <div><span className="text-zinc-400">形态特征：</span>{item.morphology}</div>}
      {careText && <div><span className="text-zinc-400">养护：</span><span className="whitespace-pre-line">{careText}</span></div>}
      <div><span className="text-zinc-400">成本：</span>{formatMoney(item)}</div>
      <div><span className="text-zinc-400">标准可用率 / 损耗率：</span>{lossText}</div>
      <div><span className="text-zinc-400">可用率区间：</span>乐观 {formatPercent(item.optimisticUsableRate)} · 标准 {formatPercent(item.standardUsableRate)} · 保守 {formatPercent(item.conservativeUsableRate)}</div>
      <div><span className="text-zinc-400">默认可用率 / 默认损耗率：</span>{formatPercent(item.defaultUsableRate)} / {formatPercent(item.defaultLossRate)}（{LOSS_MODE_LABEL[item.lossMode] ?? item.lossMode}模式）</div>
      <div><span className="text-zinc-400">供货周期：</span>{item.supplySeason || "—"}<span className="mx-2 text-zinc-300">|</span><span className="text-zinc-400">保质期：</span>{item.defaultShelfLifeDays != null ? `${item.defaultShelfLifeDays} 天` : "—"}</div>
      <div><span className="text-zinc-400">安全库存阈值：</span>{decimalText(item.safetyStockThreshold) ?? "0"}</div>
      {item.costNote && <div><span className="text-zinc-400">成本备注：</span>{item.costNote}</div>}
      {item.lossRateNote && <div><span className="text-zinc-400">损耗说明：</span>{item.lossRateNote}</div>}
      {item.notes && <div><span className="text-zinc-400">备注：</span>{item.notes}</div>}
    </div>
  </details>;
}
