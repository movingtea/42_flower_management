import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Prisma, SampleState } from "@/generated/prisma-v2/client";
import { requireV2Store } from "@/v2/auth";
import { v2db } from "@/v2/db";
import { calculateSamplePricing } from "@/v2/domain/sample-pricing";
import { getMaterialAvailableQuantities } from "@/v2/services/material-availability";
import {
  ActionEmptyState,
  Field,
  StatusBadge,
  V2ModulePage,
  button,
  input,
} from "../_components/V2Ui";
import { V2DrawerForm } from "../_components/V2Drawer";
import { readV2Feedback } from "../_lib/search-params";
import {
  MaterialLinesEditor,
  type MaterialLine,
  type MaterialOption,
} from "./_components/SampleEditors";
import {
  convertSampleAction,
  convertSamplesAction,
  copySampleAction,
  createSampleAction,
  setSampleStateAction,
  updateSampleAction,
} from "./actions";

export const dynamic = "force-dynamic";

const STATE_LABELS: Record<SampleState, string> = {
  DRAFT: "草稿",
  READY: "已完成",
  ARCHIVED: "已归档",
};

type SampleRow = Prisma.SampleGetPayload<{
  include: {
    materials: { include: { material: true } };
    sourceSkus: {
      include: {
        product: { select: { active: true } },
        recipe: { include: { versions: true } },
      },
    };
    planItems: { select: { planId: true } };
  };
}>;

function decimal(value: Prisma.Decimal | null | undefined): number {
  return value === null || value === undefined ? 0 : Number(value);
}

function money(value: number): string {
  return `¥${value.toFixed(2)}`;
}

function sampleCost(
  sample: SampleRow,
  batchCost: Map<string, number>,
) {
  let materialCost = 0;
  let packagingCost = 0;
  const lines = sample.materials.map((line) => {
    const unitCost = batchCost.get(line.materialId) ?? decimal(line.material.standardUnitCost);
    const lineCost = Number(line.quantity) * unitCost;
    if (line.material.kind === "PACKAGING" || line.material.kind === "CONSUMABLE") {
      packagingCost += lineCost;
    } else {
      materialCost += lineCost;
    }
    return {
      materialId: line.materialId,
      name: line.material.name,
      baseUnit: line.material.baseUnit,
      quantity: Number(line.quantity),
      unitCost,
      lineCost,
    };
  });
  const margin = sample.targetMarginRate === null ? null : Number(sample.targetMarginRate);
  const pricing = calculateSamplePricing({
    materialCost: Math.round((materialCost + Number.EPSILON) * 100) / 100,
    packagingCost: Math.round((packagingCost + Number.EPSILON) * 100) / 100,
    targetMarginRate: margin,
  });
  return { lines, pricing };
}

function skuRecipeState(sku: SampleRow["sourceSkus"][number]) {
  const versions = sku.recipe?.versions ?? [];
  const published = versions.find((version) => version.state === "PUBLISHED") ?? null;
  const draft = versions.find((version) => version.state === "DRAFT") ?? null;
  const price = Number(sku.price);
  const checks = [
    { label: "售价", passed: price > 0, detail: price > 0 ? money(price) : "未填写" },
    { label: "配方", passed: Boolean(published), detail: published ? `已发布 v${published.versionNo}` : draft ? `草稿 v${draft.versionNo}` : "无配方" },
    { label: "商品", passed: sku.product.active, detail: sku.product.active ? "已启用" : "未上架" },
    { label: "SKU", passed: sku.active, detail: sku.active ? "已启用" : "未启用" },
  ];
  return {
    published,
    draft,
    checks,
    ready: checks.every((check) => check.passed),
  };
}

function VersionHistory({ events }: { events: { id: string; action: string; occurredAt: Date; afterSnapshot: unknown }[] }) {
  if (events.length === 0) return <p className="text-xs text-stone-500">暂无版本记录。</p>;
  return (
    <ol className="space-y-1 text-xs text-stone-600">
      {events.map((event) => {
        const snapshot = event.afterSnapshot && typeof event.afterSnapshot === "object"
          ? event.afterSnapshot as Record<string, unknown>
          : {};
        const versionNo = typeof snapshot.versionNo === "number" ? snapshot.versionNo : null;
        const materialCount = Array.isArray(snapshot.materials) ? snapshot.materials.length : null;
        return (
          <li key={event.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 bg-white px-2 py-1">
            <span className="font-mono text-[11px] text-stone-500">
              {event.occurredAt.toISOString().slice(0, 16).replace("T", " ")}
            </span>
            <span>{event.action === "SAMPLE_CREATED" ? "创建" : event.action === "SAMPLE_UPDATED" ? "编辑" : event.action === "SAMPLE_COPIED" ? "复制" : event.action === "SAMPLE_STATE_CHANGED" ? "状态变更" : "转 SKU"}</span>
            {versionNo !== null && <StatusBadge tone="info">v{versionNo}</StatusBadge>}
            {materialCount !== null && <span>{materialCount} 项物料</span>}
          </li>
        );
      })}
    </ol>
  );
}

function SampleDetail({
  sample,
  materialOptions,
  products,
  batchCost,
  versions,
}: {
  sample: SampleRow;
  materialOptions: MaterialOption[];
  products: { id: string; code: string; name: string; active: boolean }[];
  batchCost: Map<string, number>;
  versions: { id: string; action: string; occurredAt: Date; afterSnapshot: unknown }[];
}) {
  const cost = sampleCost(sample, batchCost);
  const initialLines: MaterialLine[] = sample.materials.map((line) => ({
    materialId: line.materialId,
    quantity: Number(line.quantity),
  }));
  const skuCount = sample.sourceSkus.length;
  return (
    <details className="rounded-xl border border-stone-200 bg-white shadow-sm">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
        <div className="min-w-52 flex-1">
          <div className="font-medium text-zinc-900">{sample.name}</div>
          <div className="font-mono text-xs text-zinc-500">{sample.code}</div>
        </div>
        <div>
          <div className="text-xs text-zinc-500">状态</div>
          <StatusBadge tone={sample.state === "READY" ? "success" : sample.state === "ARCHIVED" ? "neutral" : "warning"}>
            {STATE_LABELS[sample.state]}
          </StatusBadge>
        </div>
        <div className="w-36">
          <div className="text-xs text-zinc-500">标准成本 / 目标售价</div>
          <div className="text-sm">{money(cost.pricing.totalCost)}</div>
          <div className="text-xs text-stone-500">
            {cost.pricing.suggestedPrice === null ? "未设毛利率" : money(cost.pricing.suggestedPrice)}
          </div>
        </div>
        <div className="w-28">
          <div className="text-xs text-zinc-500">物料 / SKU</div>
          <div className="text-sm">{sample.materials.length} / {skuCount}</div>
        </div>
        <span className="ml-auto text-sm text-emerald-700">展开查看成本、版本与转 SKU</span>
      </summary>

      <div className="space-y-4 border-t border-stone-200 p-4 md:p-5">
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="space-y-3 rounded-xl border border-stone-200 bg-stone-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="font-semibold">样品信息与物料</h3>
              <V2DrawerForm
                triggerLabel="编辑样品"
                title="编辑样品与版本"
                description="修改名称、状态、目标毛利率与物料搭配；每次保存都会写入版本记录。"
                action={updateSampleAction}
                submitLabel="保存样品"
                size="lg"
                triggerClassName={button}
                footerNote="后续样品变更不会自动修改已生成 SKU 的配方"
              >
                <input type="hidden" name="sampleId" value={sample.id} />
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-sm text-stone-700">
                    样品名称
                    <input className={`${input} mt-1`} name="name" defaultValue={sample.name} maxLength={100} required />
                  </label>
                  <label className="text-sm text-stone-700">
                    状态
                    <select className={`${input} mt-1`} name="state" defaultValue={sample.state}>
                      <option value="DRAFT">草稿</option>
                      <option value="READY">已完成（可转 SKU）</option>
                      <option value="ARCHIVED">已归档</option>
                    </select>
                  </label>
                  <label className="text-sm text-stone-700">
                    目标毛利率（%）
                    <input
                      className={`${input} mt-1`}
                      name="targetMarginPercent"
                      type="number"
                      min="0"
                      max="99.99"
                      step="0.01"
                      defaultValue={sample.targetMarginRate === null ? "" : (Number(sample.targetMarginRate) * 100).toFixed(2)}
                    />
                  </label>
                  <label className="text-sm text-stone-700">
                    优先级
                    <input className={`${input} mt-1`} name="priority" type="number" min="0" step="1" defaultValue={sample.priority} />
                  </label>
                </div>
                <label className="block text-sm text-stone-700">
                  说明
                  <textarea className={`${input} mt-1`} name="description" rows={2} defaultValue={sample.description ?? ""} />
                </label>
                <MaterialLinesEditor materials={materialOptions} initialLines={initialLines} />
              </V2DrawerForm>
            </div>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <dt className="text-xs text-stone-500">样品编号</dt>
                <dd className="font-mono text-xs text-stone-600">{sample.code}</dd>
              </div>
              <div>
                <dt className="text-xs text-stone-500">状态</dt>
                <dd>{STATE_LABELS[sample.state]}</dd>
              </div>
              <div>
                <dt className="text-xs text-stone-500">目标毛利率</dt>
                <dd>{sample.targetMarginRate === null ? "未设置" : `${(Number(sample.targetMarginRate) * 100).toFixed(2)}%`}</dd>
              </div>
              <div>
                <dt className="text-xs text-stone-500">优先级</dt>
                <dd>{sample.priority}</dd>
              </div>
            </dl>
            <div>
              <h4 className="text-xs font-medium text-stone-500">物料清单</h4>
              {cost.lines.length === 0 ? (
                <p className="mt-1 text-sm text-stone-500">还没有物料。</p>
              ) : (
                <div className="mt-1 space-y-1 text-sm text-stone-700">
                  {cost.lines.map((line) => (
                    <div key={line.materialId} className="flex items-center justify-between gap-2">
                      <span>{line.name} {line.quantity}{line.baseUnit}</span>
                      <span className="text-xs text-stone-500">{money(line.lineCost)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <p className="text-xs text-stone-500">每次保存都会写入版本记录；后续样品变更不会自动修改已生成 SKU 的配方。</p>
          </section>

          <div className="space-y-3">
            <section className="rounded-xl border border-stone-200 bg-white p-4">
              <h3 className="font-semibold">成本与目标售价测算</h3>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-stone-500">花材成本</span><div>{money(cost.pricing.materialCost)}</div></div>
                <div><span className="text-stone-500">包材/耗材</span><div>{money(cost.pricing.packagingCost)}</div></div>
                <div><span className="text-stone-500">总成本</span><div className="font-medium">{money(cost.pricing.totalCost)}</div></div>
                <div><span className="text-stone-500">建议售价</span><div className="font-medium text-emerald-700">{cost.pricing.suggestedPrice === null ? "设置毛利率后计算" : money(cost.pricing.suggestedPrice)}</div></div>
              </div>
              <div className="mt-3 space-y-1 text-xs text-stone-600">
                {cost.lines.map((line) => (
                  <div key={line.materialId} className="flex items-center justify-between gap-2">
                    <span>{line.name} {line.quantity}{line.baseUnit}</span>
                    <span>{money(line.lineCost)}</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-stone-500">成本优先取最近批次单价，其次取物料标准成本；目标售价 = 总成本 ÷（1 − 毛利率）。</p>
            </section>

            <div className="flex flex-wrap items-center gap-3">
              {sample.state !== "READY" && sample.state !== "ARCHIVED" && (
                <form action={setSampleStateAction}>
                  <input type="hidden" name="sampleId" value={sample.id} />
                  <input type="hidden" name="state" value="READY" />
                  <button className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white">标记完成</button>
                </form>
              )}
              {sample.state !== "ARCHIVED" && (
                <form action={setSampleStateAction}>
                  <input type="hidden" name="sampleId" value={sample.id} />
                  <input type="hidden" name="state" value="ARCHIVED" />
                  <button className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs text-stone-700">归档</button>
                </form>
              )}
              <form action={copySampleAction}>
                <input type="hidden" name="sampleId" value={sample.id} />
                <button className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs text-stone-700">复制样品</button>
              </form>
            </div>

            <section className="rounded-xl border border-stone-200 bg-white p-4">
              <h3 className="font-semibold">版本记录</h3>
              <div className="mt-2"><VersionHistory events={versions} /></div>
            </section>
          </div>
        </div>

        <section className="rounded-xl border border-stone-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold">转为可售 SKU</h3>
              <p className="mt-1 text-xs text-stone-500">
                只有已完成样品可以转 SKU。可调整数量或替换花材/包材颜色生成变体；每个 SKU 独立价格与配方，生成后不会随样品变化。
              </p>
            </div>
            {sample.state === "READY" ? (
              <V2DrawerForm
                triggerLabel="转为可售 SKU"
                title={`转为可售 SKU · ${sample.name}`}
                description="生成 SKU 草稿与配方；生成后不会随样品变化。"
                action={convertSampleAction}
                submitLabel="生成 SKU 草稿与配方"
                size="xl"
                triggerClassName={button}
              >
                <input type="hidden" name="sampleId" value={sample.id} />
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-sm text-stone-700">
                    SKU 规格名称
                    <input className={`${input} mt-1`} name="skuName" defaultValue={`${sample.name} · ${sample.code}`} maxLength={100} required />
                  </label>
                  <label className="text-sm text-stone-700">
                    目标毛利率（%）
                    <input className={`${input} mt-1`} name="targetMarginPercent" type="number" min="0" max="99.99" step="0.01" defaultValue={sample.targetMarginRate === null ? "" : (Number(sample.targetMarginRate) * 100).toFixed(2)} />
                  </label>
                  <label className="text-sm text-stone-700">
                    售价（留空按毛利率计算）
                    <input className={`${input} mt-1`} name="price" type="number" min="0" step="0.01" />
                  </label>
                  <label className="text-sm text-stone-700">
                    人工成本
                    <input className={`${input} mt-1`} name="laborCost" type="number" min="0" step="0.01" defaultValue={0} />
                  </label>
                  <label className="text-sm text-stone-700">
                    配方外耗材成本
                    <input className={`${input} mt-1`} name="consumableCost" type="number" min="0" step="0.01" defaultValue={0} />
                  </label>
                  <label className="text-sm text-stone-700">
                    商品
                    <select className={`${input} mt-1`} name="productId" defaultValue="">
                      <option value="">新建商品</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>{product.code} · {product.name}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="block text-sm text-stone-700">
                  新商品名称（未选择商品时必填）
                  <input className={`${input} mt-1`} name="newProductName" maxLength={100} placeholder="例如：春日花束" />
                </label>
                <MaterialLinesEditor materials={materialOptions} initialLines={initialLines} hiddenName="linesJson" />
              </V2DrawerForm>
            ) : (
              <button
                type="button"
                disabled
                className="cursor-not-allowed rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white opacity-60"
              >
                转为可售 SKU（需先标记完成）
              </button>
            )}
          </div>
        </section>

        <section>
          <h3 className="font-semibold">该样品生成的 SKU</h3>
          {sample.sourceSkus.length === 0 ? (
            <p className="mt-2 rounded-lg border border-dashed border-stone-300 bg-stone-50 p-3 text-sm text-stone-500">
              还没有 SKU。生成后请到标准配方发布草稿，再到商品与 SKU 启用 SKU 与商品。
            </p>
          ) : (
            <div className="mt-2 overflow-x-auto rounded-xl border border-stone-200">
              <table className="min-w-full text-sm">
                <thead className="bg-stone-50 text-left text-xs text-stone-500">
                  <tr>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2">售价</th>
                    <th className="px-3 py-2">配方</th>
                    <th className="px-3 py-2">状态</th>
                    <th className="px-3 py-2">上架检查</th>
                    <th className="px-3 py-2">入口</th>
                  </tr>
                </thead>
                <tbody>
                  {sample.sourceSkus.map((sku) => {
                    const state = skuRecipeState(sku);
                    return (
                      <tr key={sku.id} className="border-t border-stone-100">
                        <td className="px-3 py-2">
                          <div className="font-medium">{sku.name}</div>
                          <div className="font-mono text-xs text-stone-500">{sku.code}</div>
                        </td>
                        <td className="px-3 py-2">{money(Number(sku.price))}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {state.published && <StatusBadge tone="success">已发布 v{state.published.versionNo}</StatusBadge>}
                            {state.draft && <StatusBadge tone="warning">草稿 v{state.draft.versionNo}</StatusBadge>}
                            {!state.published && !state.draft && <StatusBadge tone="neutral">无配方</StatusBadge>}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge tone={sku.active ? "success" : "neutral"}>{sku.active ? "启用" : "停用"}</StatusBadge>
                        </td>
                        <td className="px-3 py-2">
                          {state.ready ? <StatusBadge tone="success">可上架</StatusBadge> : <StatusBadge tone="warning">待补齐</StatusBadge>}
                          <div className="mt-1 text-xs text-stone-500">
                            {state.checks.map((check) => `${check.label}:${check.passed ? "✓" : "✗"}`).join(" · ")}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <Link className="text-emerald-700 underline" href={`/v2/recipes?q=${encodeURIComponent(sku.code)}`}>配方</Link>
                          <span className="mx-1 text-stone-300">|</span>
                          <Link className="text-emerald-700 underline" href={`/v2/catalog?q=${encodeURIComponent(sku.code)}`}>商品</Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </details>
  );
}

export default async function SamplesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user || session.user.source !== "v2") {
    redirect("/login?callbackUrl=/v2/samples");
  }
  const scope = await requireV2Store("catalog");
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const requestedState = typeof params.state === "string" ? params.state : "all";
  const state = ["DRAFT", "READY", "ARCHIVED"].includes(requestedState) ? requestedState : "all";

  const samples = await v2db.sample.findMany({
    where: {
      tenantId: scope.tenantId,
      ...(state === "all" ? {} : { state: state as SampleState }),
      ...(query
        ? {
            OR: [
              { code: { contains: query, mode: "insensitive" } },
              { name: { contains: query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      materials: {
        include: { material: true },
        orderBy: { material: { code: "asc" } },
      },
      sourceSkus: {
        include: {
          product: { select: { active: true } },
          recipe: { include: { versions: true } },
        },
        orderBy: { code: "asc" },
      },
      planItems: { select: { planId: true } },
    },
    orderBy: [{ state: "asc" }, { code: "asc" }],
  });

  const [materials, products] = await Promise.all([
    v2db.material.findMany({
      where: { tenantId: scope.tenantId },
      select: {
        id: true,
        code: true,
        name: true,
        kind: true,
        baseUnit: true,
        standardUnitCost: true,
        active: true,
      },
      orderBy: [{ active: "desc" }, { kind: "asc" }, { code: "asc" }],
    }),
    v2db.product.findMany({
      where: { tenantId: scope.tenantId },
      select: { id: true, code: true, name: true, active: true },
      orderBy: { code: "asc" },
    }),
  ]);

  const materialIds = materials.map((material) => material.id);
  const availability = await getMaterialAvailableQuantities(v2db, {
    tenantId: scope.tenantId,
    storeId: scope.storeId,
    materialIds,
  });
  const batches = await v2db.inventoryBatch.findMany({
    where: { storeId: scope.storeId, materialId: { in: materialIds } },
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    select: { materialId: true, unitCost: true },
  });
  const batchCost = new Map<string, number>();
  for (const batch of batches) {
    if (!batchCost.has(batch.materialId)) batchCost.set(batch.materialId, Number(batch.unitCost));
  }

  const materialOptions: MaterialOption[] = materials.map((material) => ({
    id: material.id,
    code: material.code,
    name: material.name,
    kind: material.kind,
    baseUnit: material.baseUnit,
    availableQty: availability.get(material.id)?.availableQty ?? 0,
    standardUnitCost: material.standardUnitCost === null ? null : Number(material.standardUnitCost),
    active: material.active,
  }));

  const versionEvents = await v2db.auditEvent.findMany({
    where: {
      tenantId: scope.tenantId,
      entityType: "Sample",
      action: {
        in: [
          "SAMPLE_CREATED",
          "SAMPLE_UPDATED",
          "SAMPLE_COPIED",
          "SAMPLE_STATE_CHANGED",
          "SAMPLE_CONVERTED_TO_SKU",
        ],
      },
    },
    orderBy: { occurredAt: "desc" },
    take: 200,
  });
  const versionsBySample = new Map<string, typeof versionEvents>();
  for (const event of versionEvents) {
    if (!event.entityId) continue;
    const list = versionsBySample.get(event.entityId) ?? [];
    list.push(event);
    versionsBySample.set(event.entityId, list);
  }

  const feedback = readV2Feedback(params);
  const readySamples = samples.filter((sample) => sample.state === "READY");
  const inStockMaterials = materialOptions
    .filter((material) => material.active && (material.kind === "FLOWER" || material.kind === "FOLIAGE") && material.availableQty > 0)
    .sort((left, right) => right.availableQty - left.availableQty)
    .slice(0, 12);
  const hasFilters = query.length > 0 || state !== "all";

  return (
    <V2ModulePage
      title="样品库"
      description="维护样品花材搭配、成本与目标售价，记录版本，并将已完成样品转为商品下的 SKU 与草稿配方。"
      message={feedback.message}
      error={feedback.error}
      actions={
        <V2DrawerForm
          triggerLabel="新增样品"
          title="新增样品"
          description="录入花材搭配与目标毛利率；样品编号由系统自动生成。"
          action={createSampleAction}
          submitLabel="创建样品"
          size="lg"
          triggerClassName={button}
        >
          <Field label="样品名称" name="name" />
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm text-stone-700">
              初始状态
              <select className={`${input} mt-1`} name="state" defaultValue="DRAFT">
                <option value="DRAFT">草稿</option>
                <option value="READY">已完成</option>
              </select>
            </label>
            <Field label="目标毛利率（%）" name="targetMarginPercent" type="number" required={false} />
            <Field label="优先级" name="priority" type="number" required={false} defaultValue={0} />
          </div>
          <label className="block text-sm text-stone-700">
            说明
            <textarea className={`${input} mt-1`} name="description" rows={2} />
          </label>
          <MaterialLinesEditor materials={materialOptions} />
        </V2DrawerForm>
      }
    >
      <form className="flex flex-wrap items-end gap-2 rounded-xl border border-stone-200 bg-white p-4">
        <label className="block text-sm text-stone-700">
          搜索
          <input className={`${input} mt-1 max-w-sm`} name="q" defaultValue={query} placeholder="样品编号或名称" />
        </label>
        <label className="block text-sm text-stone-700">
          状态
          <select className={`${input} mt-1 w-36`} name="state" defaultValue={state}>
            <option value="all">全部状态</option>
            <option value="DRAFT">草稿</option>
            <option value="READY">已完成</option>
            <option value="ARCHIVED">已归档</option>
          </select>
        </label>
        <button className={button}>查询</button>
        {hasFilters && <Link className="px-2 py-2 text-sm text-stone-500 underline" href="/v2/samples">清除筛选</Link>}
      </form>

      <section className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold text-emerald-900">现货可用花材推荐</h3>
          <span className="text-xs text-emerald-800">仅作人工搭配参考，不自动替换样品物料</span>
        </div>
        {inStockMaterials.length === 0 ? (
          <p className="mt-2 text-sm text-emerald-900">当前门店没有可用于花材搭配的现货。可先采购入库，或在样品中使用包材与耗材。</p>
        ) : (
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {inStockMaterials.map((material) => (
              <div key={material.id} className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm">
                <div className="font-medium">{material.name}</div>
                <div className="text-xs text-stone-500">{material.code} · 可用 {material.availableQty}{material.baseUnit}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold">批量转 SKU：多份样品生成同一商品下的多个 SKU</h3>
            <p className="mt-1 text-xs text-stone-500">勾选已完成样品，选择一个商品或新建商品；系统为每份样品复制一份草稿配方，价格按目标毛利率测算。每个 SKU 之后可独立调整。</p>
          </div>
          {readySamples.length > 0 ? (
            <V2DrawerForm
              triggerLabel="批量转 SKU"
              title="批量转 SKU"
              description="勾选已完成样品并选择目标商品；系统为每份样品生成一份 SKU 草稿与配方。"
              action={convertSamplesAction}
              submitLabel="批量生成 SKU 草稿"
              size="xl"
              triggerClassName={button}
            >
              <div className="grid gap-2 sm:grid-cols-2">
                {readySamples.map((sample) => (
                  <label key={sample.id} className="flex items-center gap-2 rounded-lg border border-stone-200 px-3 py-2 text-sm">
                    <input type="checkbox" name="sampleIds" value={sample.id} />
                    <span>{sample.name}</span>
                    <span className="ml-auto font-mono text-xs text-stone-500">{sample.code}</span>
                  </label>
                ))}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm text-stone-700">
                  商品
                  <select className={`${input} mt-1`} name="productId" defaultValue="">
                    <option value="">新建商品</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>{product.code} · {product.name}</option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-stone-700">
                  新商品名称
                  <input className={`${input} mt-1`} name="newProductName" placeholder="未选择商品时必填" />
                </label>
                <label className="text-sm text-stone-700">
                  目标毛利率（%）
                  <input className={`${input} mt-1`} name="targetMarginPercent" type="number" min="0" max="99.99" step="0.01" />
                </label>
                <label className="text-sm text-stone-700">
                  人工成本 / 个
                  <input className={`${input} mt-1`} name="laborCost" type="number" min="0" step="0.01" defaultValue={0} />
                </label>
              </div>
            </V2DrawerForm>
          ) : (
            <button
              type="button"
              disabled
              className="cursor-not-allowed rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white opacity-60"
            >
              批量转 SKU（暂无已完成样品）
            </button>
          )}
        </div>
        {readySamples.length === 0 && (
          <p className="mt-2 text-sm text-amber-800">还没有已完成样品。先在下方将样品“标记完成”。</p>
        )}
      </section>

      {samples.length === 0 ? (
        <ActionEmptyState
          title={hasFilters ? "没有符合条件的样品" : "还没有样品"}
          description={hasFilters ? "调整搜索或状态筛选后重试。" : "点击右上角“新增样品”，录入花材搭配与目标毛利率。"}
        />
      ) : (
        <div className="space-y-3">
          {samples.map((sample) => (
            <SampleDetail
              key={sample.id}
              sample={sample}
              materialOptions={materialOptions}
              products={products}
              batchCost={batchCost}
              versions={versionsBySample.get(sample.id) ?? []}
            />
          ))}
        </div>
      )}
    </V2ModulePage>
  );
}
