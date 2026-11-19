import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { requireV2Store } from "@/v2/auth";
import { v2db } from "@/v2/db";
import { formatDateTimeInAppTimezone } from "@/lib/datetime";
import { formatCurrency, formatPercent } from "@/lib/format-money";
import {
  REPORT_PRESETS,
  REPORT_PRESET_LABELS,
  REPORT_TABS,
  REPORT_TAB_LABELS,
  resolveReportRange,
  type ReportTab,
} from "@/v2/domain/reporting";
import {
  loadCostSnapshotReport,
  loadInventoryReport,
  loadLossReport,
  loadOverviewReport,
  loadProductMarginReport,
  loadPurchaseReport,
  loadSalesTrendReport,
  type CostSnapshotReport,
  type InventoryReportData,
  type LossReportData,
  type OverviewReport,
  type ProductMarginReport,
  type PurchaseReportData,
  type SalesTrendReport,
} from "@/v2/services/reporting";
import { StatusBadge, V2ModulePage, button, card, input } from "../_components/V2Ui";
import {
  buildReportHref,
  parseReportFilters,
  type ReportFilters,
  type ReportSearchParams,
} from "./report-params";
import {
  RatioBar,
  ReportEmptyRow,
  ReportHead,
  ReportSection,
  ReportStat,
  ReportTable,
} from "./report-ui";

export const dynamic = "force-dynamic";

const COMMERCIAL_LABEL: Record<string, string> = {
  DRAFT: "草稿",
  PENDING_CONFIRMATION: "待确认",
  PENDING_PAYMENT: "待支付",
  CONFIRMED: "已确认",
  CANCELLED: "已取消",
  CLOSED: "已关闭",
};

const LOSS_REASON_LABEL: Record<string, string> = {
  RECEIPT_REJECTED: "验收拒收",
  CARE_DAMAGE: "养护损伤",
  EXPIRED: "过期",
  PRODUCTION_ERROR: "制作差异",
  DELIVERY_DAMAGE: "配送损伤",
  STOCKTAKE_DIFFERENCE: "盘点差异",
  OTHER: "其他",
};

const PURCHASE_STATE_LABEL: Record<string, string> = {
  ORDERED: "已下单",
  PARTIALLY_RECEIVED: "部分验收",
  RECEIVED: "已验收",
  CLOSED: "已关闭",
};

function PresetLinks({ filters }: { filters: ReportFilters }) {
  return (
    <div className="flex flex-wrap gap-2">
      {REPORT_PRESETS.map((preset) => {
        const active = !filters.startDate && !filters.endDate && filters.preset === preset;
        return (
          <Link
            key={preset}
            href={buildReportHref(filters, { preset, startDate: undefined, endDate: undefined })}
            className={`rounded-lg border px-3 py-2 text-sm font-medium ${
              active
                ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                : "border-stone-300 bg-white text-stone-600 hover:bg-stone-50"
            }`}
          >
            {REPORT_PRESET_LABELS[preset]}
          </Link>
        );
      })}
    </div>
  );
}

function ReportTabs({ filters }: { filters: ReportFilters }) {
  return (
    <nav className="flex flex-wrap gap-1 border-b border-stone-200 pb-1" aria-label="报表分类">
      {REPORT_TABS.map((tab) => (
        <Link
          key={tab}
          href={buildReportHref(filters, { tab })}
          aria-current={filters.tab === tab ? "page" : undefined}
          className={`rounded-t-lg px-4 py-2 text-sm font-medium ${
            filters.tab === tab
              ? "border border-b-white border-stone-200 bg-white text-emerald-800"
              : "text-stone-500 hover:bg-white hover:text-stone-800"
          }`}
        >
          {REPORT_TAB_LABELS[tab]}
        </Link>
      ))}
    </nav>
  );
}

function RangeFilters({ filters, rangeLabel }: { filters: ReportFilters; rangeLabel: string }) {
  return (
    <section className={`${card} space-y-4`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PresetLinks filters={filters} />
        <p className="text-xs text-stone-500">当前范围：{rangeLabel}</p>
      </div>
      <form method="get" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="tab" value={filters.tab} />
        <label className="text-xs font-medium text-stone-600">
          开始日期
          <input
            type="date"
            name="startDate"
            defaultValue={filters.startDate ?? ""}
            className={`${input} mt-1 w-40`}
          />
        </label>
        <label className="text-xs font-medium text-stone-600">
          结束日期
          <input
            type="date"
            name="endDate"
            defaultValue={filters.endDate ?? ""}
            className={`${input} mt-1 w-40`}
          />
        </label>
        {filters.tab === "products" && (
          <label className="text-xs font-medium text-stone-600">
            低毛利阈值（0–1）
            <input
              type="number"
              min="0"
              max="1"
              step="0.01"
              name="threshold"
              defaultValue={filters.threshold}
              className={`${input} mt-1 w-28`}
            />
          </label>
        )}
        <button className={button}>应用范围</button>
        <Link
          href={buildReportHref(filters, { startDate: undefined, endDate: undefined, preset: "thisMonth" })}
          className="rounded-lg border border-stone-300 px-4 py-2 text-sm text-stone-600 hover:bg-white"
        >
          重置
        </Link>
      </form>
    </section>
  );
}

function OverviewSection({ data }: { data: OverviewReport }) {
  const summary = data.summary;
  return (
    <div className="space-y-6">
      {summary.missingSnapshotOrderCount > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p>
            有 {summary.missingSnapshotOrderCount} 笔本范围内已交付订单缺少成本快照，这些订单未计入营收、成本和毛利。
            本页只读，不自动补算；请打开对应订单核对成本。
          </p>
          <Link href="/v2/orders" className="mt-2 inline-block font-medium text-amber-800 underline">
            查看已交付订单
          </Link>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ReportStat
          label="交付营收"
          value={formatCurrency(summary.revenue)}
          hint={`已交付订单 ${summary.paidOrderCount} 笔`}
          tone="success"
        />
        <ReportStat label="总成本" value={formatCurrency(summary.totalCost)} hint="成本快照与调整后金额" />
        <ReportStat
          label="毛利"
          value={formatCurrency(summary.grossProfit)}
          hint={`毛利率 ${formatPercent(summary.grossMargin)}`}
          tone={summary.grossProfit >= 0 ? "success" : "danger"}
        />
        <ReportStat
          label="客单价"
          value={formatCurrency(summary.averageOrderValue)}
          hint={`单均毛利 ${formatCurrency(summary.averageGrossProfitPerOrder)}`}
        />
        <ReportStat
          label="已交付订单"
          value={summary.completedOrderCount}
          hint={`取消 ${summary.cancelledOrderCount} / 退款 ${summary.refundedOrderCount}`}
        />
        <ReportStat
          label="花材成本"
          value={formatCurrency(data.costStructure.materialCost)}
          hint={`占总成本 ${formatPercent(data.costStructure.ratios.materialCost)}`}
        />
        <ReportStat
          label="包装成本"
          value={formatCurrency(data.costStructure.packagingCost)}
          hint={`占总成本 ${formatPercent(data.costStructure.ratios.packagingCost)}`}
        />
        <ReportStat
          label="配送成本"
          value={formatCurrency(data.costStructure.deliveryCost)}
          hint={`占总成本 ${formatPercent(data.costStructure.ratios.deliveryCost)}`}
        />
      </div>

      <ReportSection title="成本结构" description="各成本项占总成本比例；总成本为 0 时占比安全显示为 0。">
        <div className="space-y-3">
          {[
            ["花材成本", data.costStructure.materialCost, data.costStructure.ratios.materialCost],
            ["包装成本", data.costStructure.packagingCost, data.costStructure.ratios.packagingCost],
            ["耗材成本", data.costStructure.consumableCost, data.costStructure.ratios.consumableCost],
            ["配送成本", data.costStructure.deliveryCost, data.costStructure.ratios.deliveryCost],
            ["平台费用", data.costStructure.platformCost, data.costStructure.ratios.platformCost],
            ["花艺师成本", data.costStructure.laborCost, data.costStructure.ratios.laborCost],
            ["损耗成本", data.costStructure.attributedLossCost, data.costStructure.ratios.attributedLossCost],
          ].map(([label, amount, ratioValue]) => (
            <div key={String(label)}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="font-medium text-stone-700">{label}</span>
                <span className="text-stone-500">
                  {formatCurrency(amount)} · {formatPercent(ratioValue)}
                </span>
              </div>
              <RatioBar value={Number(ratioValue)} />
            </div>
          ))}
        </div>
      </ReportSection>

      <ReportSection title="最近成本快照" description="汇总可追溯到订单明细；点击订单号查看用料、收款和交付。">
        <ReportTable minWidth={900}>
          <ReportHead>
            <tr>
              <th className="px-4 py-3">订单号</th>
              <th className="px-4 py-3">快照时间</th>
              <th className="px-4 py-3">收入</th>
              <th className="px-4 py-3">总成本</th>
              <th className="px-4 py-3">毛利</th>
              <th className="px-4 py-3">毛利率</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3">明细</th>
            </tr>
          </ReportHead>
          <tbody className="divide-y divide-zinc-100">
            {data.recentSnapshots.length === 0 ? (
              <ReportEmptyRow colSpan={8} text="当前范围没有已交付成本快照。" />
            ) : (
              data.recentSnapshots.map((row) => (
                <tr key={row.orderId} className="hover:bg-stone-50">
                  <td className="px-4 py-3 font-medium">{row.orderNumber}</td>
                  <td className="px-4 py-3">{formatDateTimeInAppTimezone(row.closedAt)}</td>
                  <td className="px-4 py-3">{formatCurrency(row.revenue)}</td>
                  <td className="px-4 py-3">{formatCurrency(row.totalCost)}</td>
                  <td className="px-4 py-3">{formatCurrency(row.grossProfit)}</td>
                  <td className="px-4 py-3">{formatPercent(row.grossMargin)}</td>
                  <td className="px-4 py-3">{COMMERCIAL_LABEL[row.commercialState] ?? row.commercialState}</td>
                  <td className="px-4 py-3">
                    <Link href={`/v2/orders?orderId=${encodeURIComponent(row.orderId)}`} className="text-emerald-700 hover:underline">
                      订单详情
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </ReportTable>
      </ReportSection>
    </div>
  );
}

function SalesSection({ data, filters }: { data: SalesTrendReport; filters: ReportFilters }) {
  const totalRevenue = data.dailySales.reduce((sum, row) => sum + row.revenue, 0);
  const totalOrders = data.dailySales.reduce((sum, row) => sum + row.orderCount, 0);
  const totalCost = data.dailySales.reduce((sum, row) => sum + row.totalCost, 0);
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ReportStat label="区间营收" value={formatCurrency(totalRevenue)} hint={`${totalOrders} 笔已交付订单`} tone="success" />
        <ReportStat label="区间成本" value={formatCurrency(totalCost)} />
        <ReportStat label="区间毛利" value={formatCurrency(totalRevenue - totalCost)} />
        <ReportStat label="区间毛利率" value={formatPercent(totalRevenue === 0 ? 0 : (totalRevenue - totalCost) / totalRevenue)} />
      </div>
      <ReportSection title="销售趋势" description="按上海时区自然日汇总；无订单日期显示 0，点击日期可追溯到当日成本快照。">
        <ReportTable minWidth={880}>
          <ReportHead>
            <tr>
              <th className="px-4 py-3">日期</th>
              <th className="px-4 py-3">营收</th>
              <th className="px-4 py-3">订单数</th>
              <th className="px-4 py-3">总成本</th>
              <th className="px-4 py-3">毛利</th>
              <th className="px-4 py-3">毛利率</th>
              <th className="px-4 py-3">明细</th>
            </tr>
          </ReportHead>
          <tbody className="divide-y divide-zinc-100">
            {data.dailySales.map((row) => (
              <tr key={row.date} className="hover:bg-stone-50">
                <td className="px-4 py-3 font-medium">{row.date}</td>
                <td className="px-4 py-3">{formatCurrency(row.revenue)}</td>
                <td className="px-4 py-3">{row.orderCount}</td>
                <td className="px-4 py-3">{formatCurrency(row.totalCost)}</td>
                <td className="px-4 py-3">{formatCurrency(row.grossProfit)}</td>
                <td className="px-4 py-3">{formatPercent(row.grossMargin)}</td>
                <td className="px-4 py-3">
                  <Link
                    href={buildReportHref(filters, { tab: "cost", startDate: row.date, endDate: row.date })}
                    className="text-emerald-700 hover:underline"
                  >
                    当日快照
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </ReportTable>
      </ReportSection>
    </div>
  );
}

function ProductsSection({ data }: { data: ProductMarginReport }) {
  const productRevenue = data.products.reduce((sum, row) => sum + row.revenue, 0);
  const productCost = data.products.reduce((sum, row) => sum + row.allocatedCost, 0);
  const productProfit = productRevenue - productCost;
  const productMargin = productRevenue === 0 ? 0 : productProfit / productRevenue;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ReportStat label="商品营收" value={formatCurrency(productRevenue)} hint={`${data.products.length} 个商品行 / ${data.summary.paidOrderCount} 笔订单`} />
        <ReportStat label="分摊总成本" value={formatCurrency(productCost)} />
        <ReportStat label="商品毛利" value={formatCurrency(productProfit)} tone={productProfit >= 0 ? "success" : "danger"} />
        <ReportStat label="商品毛利率" value={formatPercent(productMargin)} />
      </div>
      <ReportSection
        title="商品毛利排行"
        description="成本按订单项金额比例分摊到商品行，分摊尾差归入订单最后一项；商品营收为订单项金额，不含配送费等订单级收入。按 SKU 汇总，单笔订单请在成本快照、低毛利订单或订单详情核对。"
      >
        <ReportTable minWidth={860}>
          <ReportHead>
            <tr>
              <th className="px-4 py-3">商品</th>
              <th className="px-4 py-3">SKU</th>
              <th className="px-4 py-3">销量</th>
              <th className="px-4 py-3">营收</th>
              <th className="px-4 py-3">分摊成本</th>
              <th className="px-4 py-3">毛利</th>
              <th className="px-4 py-3">毛利率</th>
            </tr>
          </ReportHead>
          <tbody className="divide-y divide-zinc-100">
            {data.products.length === 0 ? (
              <ReportEmptyRow colSpan={7} text="当前范围没有商品毛利数据。" />
            ) : (
              data.products.slice(0, 50).map((row) => (
                <tr key={`${row.skuId ?? row.productName}:${row.skuName}`} className="hover:bg-stone-50">
                  <td className="px-4 py-3 font-medium">{row.productName}</td>
                  <td className="px-4 py-3">{row.skuName}</td>
                  <td className="px-4 py-3">{row.quantity}</td>
                  <td className="px-4 py-3">{formatCurrency(row.revenue)}</td>
                  <td className="px-4 py-3">{formatCurrency(row.allocatedCost)}</td>
                  <td className="px-4 py-3">{formatCurrency(row.grossProfit)}</td>
                  <td className="px-4 py-3">{formatPercent(row.grossMargin)}</td>
                </tr>
              ))
            )}
          </tbody>
        </ReportTable>
        {data.products.length > 50 && (
          <p className="mt-2 text-xs text-stone-500">
            商品行较多，表格只显示前 50 行（共 {data.products.length} 行）；上方汇总仍按全部商品行计算。
          </p>
        )}
      </ReportSection>

      <ReportSection
        title="低毛利订单"
        description={`毛利率低于 ${formatPercent(data.lowMarginThreshold)} 的已交付订单（阈值可在上方调整）。`}
      >
        <ReportTable minWidth={980}>
          <ReportHead>
            <tr>
              <th className="px-4 py-3">订单号</th>
              <th className="px-4 py-3">交付时间</th>
              <th className="px-4 py-3">营收</th>
              <th className="px-4 py-3">总成本</th>
              <th className="px-4 py-3">毛利</th>
              <th className="px-4 py-3">毛利率</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3">操作</th>
            </tr>
          </ReportHead>
          <tbody className="divide-y divide-zinc-100">
            {data.lowMarginOrders.length === 0 ? (
              <ReportEmptyRow colSpan={8} text="当前阈值下没有低毛利订单。" />
            ) : (
              data.lowMarginOrders.slice(0, 50).map((row) => (
                <tr key={row.orderId} className="hover:bg-stone-50">
                  <td className="px-4 py-3 font-medium">{row.orderNumber}</td>
                  <td className="px-4 py-3">{formatDateTimeInAppTimezone(row.closedAt)}</td>
                  <td className="px-4 py-3">{formatCurrency(row.revenue)}</td>
                  <td className="px-4 py-3">{formatCurrency(row.totalCost)}</td>
                  <td className="px-4 py-3">{formatCurrency(row.grossProfit)}</td>
                  <td className="px-4 py-3 text-amber-700">{formatPercent(row.grossMargin)}</td>
                  <td className="px-4 py-3">{COMMERCIAL_LABEL[row.commercialState] ?? row.commercialState}</td>
                  <td className="px-4 py-3">
                    <Link href={`/v2/orders?orderId=${encodeURIComponent(row.orderId)}`} className="text-emerald-700 hover:underline">
                      查看订单详情
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </ReportTable>
      </ReportSection>
      {data.lowMarginOrders.length > 50 && (
        <p className="text-xs text-stone-500">
          低毛利订单较多，表格只显示前 50 笔（共 {data.lowMarginOrders.length} 笔）。
        </p>
      )}
      <p className="text-xs text-stone-400">当前阈值：{formatPercent(data.lowMarginThreshold)}；成本归属方式：按订单项金额比例分摊。</p>
    </div>
  );
}

function InventorySection({ data }: { data: InventoryReportData }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ReportStat label="启用物料数" value={data.materialCount} hint="当前门店启用的物料" />
        <ReportStat label="低库存" value={data.lowStockCount} tone={data.lowStockCount > 0 ? "warning" : "success"} />
        <ReportStat label="无实存" value={data.outOfStockCount} tone={data.outOfStockCount > 0 ? "danger" : "success"} />
        <ReportStat label="库存价值" value={formatCurrency(data.totalInventoryValue)} hint={`${data.expiringBatchCount} 个批次 7 天内到期`} />
      </div>
      <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
        库存预警是当前时点快照，不随上方日期范围变化；损耗、使用和采购分析按日期范围统计。
      </div>
      <ReportSection title="库存预警" description="安全库存大于 0 时实存低于安全库存预警；否则实存为 0 时预警。">
        <ReportTable minWidth={960}>
          <ReportHead>
            <tr>
              <th className="px-4 py-3">物料</th>
              <th className="px-4 py-3">实存</th>
              <th className="px-4 py-3">冻结</th>
              <th className="px-4 py-3">预留</th>
              <th className="px-4 py-3">可用</th>
              <th className="px-4 py-3">安全库存</th>
              <th className="px-4 py-3">库存价值</th>
              <th className="px-4 py-3">批次数</th>
              <th className="px-4 py-3">预警</th>
              <th className="px-4 py-3">明细</th>
            </tr>
          </ReportHead>
          <tbody className="divide-y divide-zinc-100">
            {data.alerts.length === 0 ? (
              <ReportEmptyRow colSpan={10} text="当前没有库存预警。" />
            ) : (
              data.alerts.map((row) => (
                <tr key={row.materialId} className="hover:bg-stone-50">
                  <td className="px-4 py-3">
                    <div className="font-medium">{row.name}</div>
                    <div className="text-xs text-stone-500">{row.code}</div>
                    <div className="text-xs text-stone-500">{row.reason}</div>
                  </td>
                  <td className="px-4 py-3">{row.onHandQty}</td>
                  <td className="px-4 py-3">{row.frozenQty}</td>
                  <td className="px-4 py-3">{row.reservedQty}</td>
                  <td className="px-4 py-3 font-medium">{row.availableQty}</td>
                  <td className="px-4 py-3">{row.threshold > 0 ? row.threshold : "—"}</td>
                  <td className="px-4 py-3">{formatCurrency(row.inventoryValue)}</td>
                  <td className="px-4 py-3">{row.batchCount}</td>
                  <td className="px-4 py-3">
                    <StatusBadge
                      tone={row.alertLevel === "OUT_OF_STOCK" ? "danger" : row.alertLevel === "LOW" ? "warning" : "info"}
                    >
                      {row.alertLevel === "OUT_OF_STOCK" ? "无实存" : row.alertLevel === "LOW" ? "低库存" : "临期"}
                    </StatusBadge>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/v2/inventory/${row.materialId}`} className="text-emerald-700 hover:underline">
                      库存详情
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </ReportTable>
      </ReportSection>

      <ReportSection title="效期批次" description="当前 7 天内到期或已过期且仍有实存的批次。">
        <ReportTable minWidth={820}>
          <ReportHead>
            <tr>
              <th className="px-4 py-3">批次</th>
              <th className="px-4 py-3">物料</th>
              <th className="px-4 py-3">到期日</th>
              <th className="px-4 py-3">实存</th>
              <th className="px-4 py-3">单位成本</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3">明细</th>
            </tr>
          </ReportHead>
          <tbody className="divide-y divide-zinc-100">
            {data.expiring.length === 0 ? (
              <ReportEmptyRow colSpan={7} text="当前没有临期或过期批次。" />
            ) : (
              data.expiring.map((row) => (
                <tr key={row.batchId} className="hover:bg-stone-50">
                  <td className="px-4 py-3 font-medium">{row.batchNo}</td>
                  <td className="px-4 py-3">{row.materialName}</td>
                  <td className="px-4 py-3">{formatDateTimeInAppTimezone(row.usableUntil)}</td>
                  <td className="px-4 py-3">{row.onHandQty} {row.baseUnit}</td>
                  <td className="px-4 py-3">{formatCurrency(row.unitCost)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={row.expired ? "danger" : "warning"}>{row.expired ? "已过期" : "临期"}</StatusBadge>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/v2/inventory/${row.materialId}`} className="text-emerald-700 hover:underline">
                      批次明细
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </ReportTable>
      </ReportSection>
    </div>
  );
}

function LossSection({ data }: { data: LossReportData }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ReportStat label="报损数量" value={data.loss.totalQuantity} hint={`${data.loss.details.length} 条报损记录`} tone="warning" />
        <ReportStat label="估算损耗金额" value={formatCurrency(data.loss.estimatedCost)} />
        <ReportStat label="损耗模型增加成本" value={formatCurrency(data.lossModelImpact.lossModelExtraCost)} tone="warning" />
        <ReportStat
          label="损耗成本占营收"
          value={formatPercent(data.lossModelImpact.lossModelExtraCostRatioToRevenue)}
          hint={`区间营收 ${formatCurrency(data.revenue)}`}
        />
      </div>

      {(data.truncation.lossRecords || data.truncation.materialUsages) && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          日期范围过大，超过单次报表加载上限：
          {data.truncation.lossRecords && `报损记录仅加载最近 ${data.truncation.lossRecordLimit} 条`}
          {data.truncation.lossRecords && data.truncation.materialUsages && "；"}
          {data.truncation.materialUsages && `制作领用仅加载最近 ${data.truncation.materialUsageLimit} 条`}
          。下方汇总与损耗模型只覆盖已加载数据，请缩小日期范围后再以完整数据判断。
        </div>
      )}

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        损耗模型是基于物料可用率的经营估算，不等同于真实报损；真实报损以下方明细为准。
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <ReportSection title="按原因汇总" description="报损记录按原因聚合，金额按批次单位成本或标准成本估算。">
          <ReportTable minWidth={560}>
            <ReportHead>
              <tr>
                <th className="px-4 py-3">原因</th>
                <th className="px-4 py-3">数量</th>
                <th className="px-4 py-3">估算金额</th>
                <th className="px-4 py-3">记录数</th>
              </tr>
            </ReportHead>
            <tbody className="divide-y divide-zinc-100">
              {data.loss.byReason.length === 0 ? (
                <ReportEmptyRow colSpan={4} text="当前范围没有报损记录。" />
              ) : (
                data.loss.byReason.map((row) => (
                  <tr key={row.reason}>
                    <td className="px-4 py-3">{LOSS_REASON_LABEL[row.reason] ?? row.reason}</td>
                    <td className="px-4 py-3">{row.quantity}</td>
                    <td className="px-4 py-3">{formatCurrency(row.estimatedCost)}</td>
                    <td className="px-4 py-3">{row.recordCount}</td>
                  </tr>
                ))
              )}
            </tbody>
          </ReportTable>
        </ReportSection>

        <ReportSection
          title="物料使用排行"
          description={`按制作完成时间统计实际领用、损耗和成本；表格显示前 15 种物料（共 ${data.loss.materialCount} 种）。`}
        >
          <ReportTable minWidth={620}>
            <ReportHead>
              <tr>
                <th className="px-4 py-3">物料</th>
                <th className="px-4 py-3">领用</th>
                <th className="px-4 py-3">损耗</th>
                <th className="px-4 py-3">使用成本</th>
                <th className="px-4 py-3">订单数</th>
              </tr>
            </ReportHead>
            <tbody className="divide-y divide-zinc-100">
              {data.loss.materialUsage.length === 0 ? (
                <ReportEmptyRow colSpan={5} text="当前范围没有制作领用数据。" />
              ) : (
                data.loss.materialUsage.slice(0, 15).map((row) => (
                  <tr key={row.materialId}>
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/v2/inventory/${row.materialId}`} className="text-emerald-700 hover:underline">
                        {row.materialName}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{row.quantityUsed} {row.baseUnit}</td>
                    <td className="px-4 py-3">{row.quantityLost}</td>
                    <td className="px-4 py-3">{formatCurrency(row.totalCost)}</td>
                    <td className="px-4 py-3">{row.orderCount}</td>
                  </tr>
                ))
              )}
            </tbody>
          </ReportTable>
        </ReportSection>
      </div>

      <ReportSection title="损耗明细" description="汇总可追溯到报损记录、批次与订单。">
        <ReportTable minWidth={900}>
          <ReportHead>
            <tr>
              <th className="px-4 py-3">发生时间</th>
              <th className="px-4 py-3">物料</th>
              <th className="px-4 py-3">批次</th>
              <th className="px-4 py-3">原因</th>
              <th className="px-4 py-3">数量</th>
              <th className="px-4 py-3">估算金额</th>
              <th className="px-4 py-3">订单</th>
            </tr>
          </ReportHead>
          <tbody className="divide-y divide-zinc-100">
            {data.loss.details.length === 0 ? (
              <ReportEmptyRow colSpan={7} text="当前范围没有报损明细。" />
            ) : (
              data.loss.details.slice(0, 80).map((row) => (
                <tr key={row.id} className="hover:bg-stone-50">
                  <td className="px-4 py-3">{formatDateTimeInAppTimezone(row.occurredAt)}</td>
                  <td className="px-4 py-3">{row.materialName}</td>
                  <td className="px-4 py-3">{row.batchNo ?? "—"}</td>
                  <td className="px-4 py-3">{LOSS_REASON_LABEL[row.reason] ?? row.reason}</td>
                  <td className="px-4 py-3">{row.quantity}</td>
                  <td className="px-4 py-3">{formatCurrency(row.estimatedCost)}</td>
                  <td className="px-4 py-3">
                    {row.orderId ? (
                      <Link href={`/v2/orders?orderId=${encodeURIComponent(row.orderId)}`} className="text-emerald-700 hover:underline">
                        {row.orderNumber ?? "查看订单"}
                      </Link>
                    ) : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </ReportTable>
        {data.loss.details.length > 80 && (
          <p className="mt-2 text-xs text-stone-500">
            报损明细较多，表格只显示最近 80 条（当前范围已加载 {data.loss.details.length} 条）。
          </p>
        )}
      </ReportSection>

      <ReportSection title="损耗模型影响 Top 10" description="按“使用成本 ÷ 可用率”估算调整后成本；仅用于经营判断。">
        <ReportTable minWidth={760}>
          <ReportHead>
            <tr>
              <th className="px-4 py-3">物料</th>
              <th className="px-4 py-3">使用数量</th>
              <th className="px-4 py-3">原始成本</th>
              <th className="px-4 py-3">损耗后成本</th>
              <th className="px-4 py-3">增加成本</th>
              <th className="px-4 py-3">可用率</th>
            </tr>
          </ReportHead>
          <tbody className="divide-y divide-zinc-100">
            {data.lossModelImpact.topMaterials.length === 0 ? (
              <ReportEmptyRow colSpan={6} text="当前范围没有可分析的销售出库数据。" />
            ) : (
              data.lossModelImpact.topMaterials.map((row) => (
                <tr key={row.materialId}>
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/v2/inventory/${row.materialId}`} className="text-emerald-700 hover:underline">
                      {row.materialName}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{row.usedQty}</td>
                  <td className="px-4 py-3">{formatCurrency(row.rawCost)}</td>
                  <td className="px-4 py-3">{formatCurrency(row.lossAdjustedCost)}</td>
                  <td className="px-4 py-3 text-amber-700">{formatCurrency(row.lossModelExtraCost)}</td>
                  <td className="px-4 py-3">{formatPercent(row.usableRate)}</td>
                </tr>
              ))
            )}
          </tbody>
        </ReportTable>
      </ReportSection>
    </div>
  );
}

function PurchaseSection({ data }: { data: PurchaseReportData }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ReportStat label="采购单" value={data.orderCount} hint={`${data.lineCount} 条采购明细`} />
        <ReportStat label="订购货值" value={formatCurrency(data.orderedValue)} hint={`含运费、包装费等费用后 ${formatCurrency(data.orderedValueWithFees)}`} />
        <ReportStat label="已验收金额" value={formatCurrency(data.receivedValue)} hint={`验收数量 ${data.receivedQty}`} tone="success" />
        <ReportStat label="拒收率" value={formatPercent(data.rejectionRate)} hint={`拒收数量 ${data.rejectedQty}`} tone={data.rejectionRate > 0 ? "warning" : "success"} />
      </div>
      <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
        采购分析按下单时间筛选，只包含已下单及之后状态；验收金额来自验收明细，可追溯到采购单和批次。
      </div>

      <ReportSection
        title="采购成本贡献"
        description="货值与采购费用分列；运费、包装费和其他费用按采购单计入一次，不含在订购货值内。"
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <ReportStat label="货值" value={formatCurrency(data.orderedValue)} />
          <ReportStat label="运费" value={formatCurrency(data.freightTotal)} />
          <ReportStat label="包装费" value={formatCurrency(data.packagingTotal)} />
          <ReportStat label="其他费用" value={formatCurrency(data.otherFeeTotal)} />
          <ReportStat label="含费用总额" value={formatCurrency(data.orderedValueWithFees)} tone="info" />
        </div>
      </ReportSection>

      <ReportSection title="供应商表现" description="按已验收金额排序；点击供应商可查看对应采购单。">
        <ReportTable minWidth={860}>
          <ReportHead>
            <tr>
              <th className="px-4 py-3">供应商</th>
              <th className="px-4 py-3">采购单</th>
              <th className="px-4 py-3">订购数量</th>
              <th className="px-4 py-3">验收数量</th>
              <th className="px-4 py-3">拒收数量</th>
              <th className="px-4 py-3">验收金额</th>
              <th className="px-4 py-3">拒收率</th>
              <th className="px-4 py-3">明细</th>
            </tr>
          </ReportHead>
          <tbody className="divide-y divide-zinc-100">
            {data.suppliers.length === 0 ? (
              <ReportEmptyRow colSpan={8} text="当前范围没有采购数据。" />
            ) : (
              data.suppliers.map((row) => (
                <tr key={row.supplierId} className="hover:bg-stone-50">
                  <td className="px-4 py-3 font-medium">{row.supplierName}</td>
                  <td className="px-4 py-3">{row.orderCount}</td>
                  <td className="px-4 py-3">{row.orderedQty}</td>
                  <td className="px-4 py-3">{row.receivedQty}</td>
                  <td className="px-4 py-3">{row.rejectedQty}</td>
                  <td className="px-4 py-3">{formatCurrency(row.receivedValue)}</td>
                  <td className="px-4 py-3">{formatPercent(row.rejectedRate)}</td>
                  <td className="px-4 py-3">
                    <Link href={`/v2/purchase-orders?supplierId=${encodeURIComponent(row.supplierId)}`} className="text-emerald-700 hover:underline">
                      查看采购单
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </ReportTable>
      </ReportSection>

      <div className="grid gap-6 xl:grid-cols-2">
        <ReportSection title="物料价格趋势" description="按验收月份、物料加权平均单位成本；仅统计已验收数量。">
          <ReportTable minWidth={620}>
            <ReportHead>
              <tr>
                <th className="px-4 py-3">月份</th>
                <th className="px-4 py-3">物料</th>
                <th className="px-4 py-3">验收数量</th>
                <th className="px-4 py-3">平均单价</th>
              </tr>
            </ReportHead>
            <tbody className="divide-y divide-zinc-100">
              {data.priceTrend.length === 0 ? (
                <ReportEmptyRow colSpan={4} text="当前范围没有验收价格数据。" />
              ) : (
                data.priceTrend.map((row) => (
                  <tr key={`${row.materialId}:${row.month}`}>
                    <td className="px-4 py-3">{row.month}</td>
                    <td className="px-4 py-3">
                      <Link href={`/v2/inventory/${row.materialId}`} className="text-emerald-700 hover:underline">
                        <div className="font-medium">{row.materialName}</div>
                      </Link>
                      <div className="text-xs text-stone-500">{row.materialCode}</div>
                    </td>
                    <td className="px-4 py-3">{row.receivedQty} {row.baseUnit}</td>
                    <td className="px-4 py-3">{formatCurrency(row.averageUnitCost)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </ReportTable>
        </ReportSection>

        <ReportSection title="批次转化" description="已验收批次的领用与剩余对比；转化率 = 已领用 ÷（已领用 + 实存）。">
          <ReportTable minWidth={700}>
            <ReportHead>
              <tr>
                <th className="px-4 py-3">批次</th>
                <th className="px-4 py-3">物料</th>
                <th className="px-4 py-3">验收数量</th>
                <th className="px-4 py-3">已领用</th>
                <th className="px-4 py-3">实存</th>
                <th className="px-4 py-3">转化率</th>
              </tr>
            </ReportHead>
            <tbody className="divide-y divide-zinc-100">
              {data.batchConversions.length === 0 ? (
                <ReportEmptyRow colSpan={6} text="当前范围没有批次转化数据。" />
              ) : (
                data.batchConversions.map((row) => (
                  <tr key={row.batchId}>
                    <td className="px-4 py-3 font-medium">{row.batchNo}</td>
                    <td className="px-4 py-3">
                      <Link href={`/v2/inventory/${row.materialId}`} className="text-emerald-700 hover:underline">
                        {row.materialName}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{row.receivedQty}</td>
                    <td className="px-4 py-3">{row.usedQty}</td>
                    <td className="px-4 py-3">{row.onHandQty}</td>
                    <td className="px-4 py-3">{formatPercent(row.conversionRate)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </ReportTable>
        </ReportSection>
      </div>

      <ReportSection title="采购明细追踪" description="按采购单列出物料和状态，点击采购单号回到采购管理。">
        <ReportTable minWidth={900}>
          <ReportHead>
            <tr>
              <th className="px-4 py-3">采购单</th>
              <th className="px-4 py-3">供应商</th>
              <th className="px-4 py-3">物料</th>
              <th className="px-4 py-3">订购数量</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3">验收明细</th>
            </tr>
          </ReportHead>
          <tbody className="divide-y divide-zinc-100">
            {data.lines.length === 0 ? (
              <ReportEmptyRow colSpan={6} text="当前范围没有采购明细。" />
            ) : (
              data.lines.slice(0, 80).map((line, index) => (
                <tr key={`${line.purchaseOrderId}:${line.materialId}:${index}`} className="hover:bg-stone-50">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/v2/purchase-orders?q=${encodeURIComponent(line.purchaseNumber)}`} className="text-emerald-700 hover:underline">
                      {line.purchaseNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{line.supplierName}</td>
                  <td className="px-4 py-3">{line.materialName}</td>
                  <td className="px-4 py-3">{line.orderedQty} {line.baseUnit}</td>
                  <td className="px-4 py-3">
                    <StatusBadge
                      tone={
                        line.state === "ORDERED"
                          ? "info"
                          : line.state === "PARTIALLY_RECEIVED"
                            ? "warning"
                            : line.state === "RECEIVED"
                              ? "success"
                              : "neutral"
                      }
                    >
                      {PURCHASE_STATE_LABEL[line.state] ?? line.state}
                    </StatusBadge>
                  </td>
                  <td className="px-4 py-3">{line.receipts.length} 条</td>
                </tr>
              ))
            )}
          </tbody>
        </ReportTable>
        {data.lines.length > 80 && (
          <p className="mt-2 text-xs text-stone-500">
            采购明细较多，表格只显示前 80 条（共 {data.lines.length} 条）；金额汇总按全部明细计算。
          </p>
        )}
      </ReportSection>
      <p className="text-xs text-stone-400">拒绝与验收按验收明细统计；采购单与批次明细可回溯到采购管理。</p>
    </div>
  );
}

function CostSnapshotSection({ data }: { data: CostSnapshotReport }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ReportStat label="成本快照" value={data.snapshots.length} hint="每个订单最新版本" />
        <ReportStat label="快照营收" value={formatCurrency(data.summary.revenue)} />
        <ReportStat label="快照总成本" value={formatCurrency(data.summary.totalCost)} />
        <ReportStat label="估算快照" value={data.summary.estimatedSnapshotCount} tone={data.summary.estimatedSnapshotCount > 0 ? "warning" : "success"} />
      </div>
      <ReportSection title="成本快照明细" description="只读展示每个订单最新 revision 的快照及其已应用的成本调整；点击订单查看领用、批次和收款。">
        <ReportTable minWidth={1180}>
          <ReportHead>
            <tr>
              <th className="px-4 py-3">订单号</th>
              <th className="px-4 py-3">版本</th>
              <th className="px-4 py-3">快照时间</th>
              <th className="px-4 py-3">营收</th>
              <th className="px-4 py-3">花材</th>
              <th className="px-4 py-3">包装</th>
              <th className="px-4 py-3">耗材</th>
              <th className="px-4 py-3">人工</th>
              <th className="px-4 py-3">配送</th>
              <th className="px-4 py-3">平台</th>
              <th className="px-4 py-3">损耗</th>
              <th className="px-4 py-3">总成本</th>
              <th className="px-4 py-3">调整</th>
              <th className="px-4 py-3">估算</th>
              <th className="px-4 py-3">明细</th>
            </tr>
          </ReportHead>
          <tbody className="divide-y divide-zinc-100">
            {data.snapshots.length === 0 ? (
              <ReportEmptyRow colSpan={15} text="当前范围没有成本快照。" />
            ) : (
              data.snapshots.slice(0, 200).map((row) => (
                <tr key={row.orderId} className="hover:bg-stone-50">
                  <td className="px-4 py-3 font-medium">{row.orderNumber}</td>
                  <td className="px-4 py-3">{row.revisionNo}</td>
                  <td className="px-4 py-3">{formatDateTimeInAppTimezone(row.closedAt)}</td>
                  <td className="px-4 py-3">{formatCurrency(row.revenue)}</td>
                  <td className="px-4 py-3">{formatCurrency(row.materialCost)}</td>
                  <td className="px-4 py-3">{formatCurrency(row.packagingCost)}</td>
                  <td className="px-4 py-3">{formatCurrency(row.consumableCost)}</td>
                  <td className="px-4 py-3">{formatCurrency(row.laborCost)}</td>
                  <td className="px-4 py-3">{formatCurrency(row.deliveryCost)}</td>
                  <td className="px-4 py-3">{formatCurrency(row.platformCost)}</td>
                  <td className="px-4 py-3">{formatCurrency(row.attributedLossCost)}</td>
                  <td className="px-4 py-3 font-medium">{formatCurrency(row.totalCost)}</td>
                  <td className="px-4 py-3">{row.adjustmentCount} 条</td>
                  <td className="px-4 py-3">{row.estimated ? "是" : "否"}</td>
                  <td className="px-4 py-3">
                    <Link href={`/v2/orders?orderId=${encodeURIComponent(row.orderId)}`} className="text-emerald-700 hover:underline">
                      订单详情
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </ReportTable>
        {data.snapshots.length > 200 && (
          <p className="mt-2 text-xs text-stone-500">
            快照较多，表格只显示最近 200 笔（共 {data.snapshots.length} 笔）；上方汇总按全部快照计算。
          </p>
        )}
      </ReportSection>
      <p className="text-xs text-stone-400">成本调整合计：{formatCurrency(data.summary.adjustmentTotal)}；页面不提供补算或修改。</p>
    </div>
  );
}

async function loadReport(
  tab: ReportTab,
  filters: ReportFilters,
  scope: { tenantId: string; storeId: string },
  range: ReturnType<typeof resolveReportRange>,
) {
  switch (tab) {
    case "overview":
      return { tab, data: await loadOverviewReport(v2db, scope, range) } as const;
    case "sales":
      return { tab, data: await loadSalesTrendReport(v2db, scope, range) } as const;
    case "products":
      return { tab, data: await loadProductMarginReport(v2db, scope, range, filters.threshold) } as const;
    case "inventory":
      return { tab, data: await loadInventoryReport(v2db, scope, new Date()) } as const;
    case "loss":
      return { tab, data: await loadLossReport(v2db, scope, range) } as const;
    case "purchase":
      return { tab, data: await loadPurchaseReport(v2db, scope, range) } as const;
    case "cost":
      return { tab, data: await loadCostSnapshotReport(v2db, scope, range) } as const;
  }
}

export default async function V2ReportsPage({ searchParams }: { searchParams: Promise<ReportSearchParams> }) {
  const session = await auth();
  if (!session?.user || session.user.source !== "v2") {
    redirect("/login?callbackUrl=/v2/reports");
  }
  const scope = await requireV2Store("read");
  const params = await searchParams;
  const filters = parseReportFilters(params);
  const range = resolveReportRange(filters);
  const result = await loadReport(filters.tab, filters, scope, range);

  return (
    <V2ModulePage
      title="报表中心"
      description="统一日期范围查看经营、商品、库存、损耗、采购和成本快照；每个汇总都可追溯到订单、批次或采购明细。"
      actions={
        <>
          <Link href="/v2/setup" className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-white">
            试运营检查
          </Link>
          <Link href="/v2" className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-white">
            返回经营概览
          </Link>
        </>
      }
    >
      <RangeFilters filters={filters} rangeLabel={range.label} />
      {range.clamped && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          日期范围超过 366 天，已按结束日期截断到最近 366 天，汇总与明细使用同一截断范围。
        </div>
      )}
      <ReportTabs filters={filters} />
      <p className="text-xs text-stone-500">
        当前时间范围：{range.label}。时间型报表统一使用该范围；库存预警与效期是当前时点快照，不随日期范围变化。
      </p>
      {result.tab === "overview" && <OverviewSection data={result.data} />}
      {result.tab === "sales" && <SalesSection data={result.data} filters={filters} />}
      {result.tab === "products" && <ProductsSection data={result.data} />}
      {result.tab === "inventory" && <InventorySection data={result.data} />}
      {result.tab === "loss" && <LossSection data={result.data} />}
      {result.tab === "purchase" && <PurchaseSection data={result.data} />}
      {result.tab === "cost" && <CostSnapshotSection data={result.data} />}
    </V2ModulePage>
  );
}
