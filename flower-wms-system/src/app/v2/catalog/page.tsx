import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Prisma } from "@/generated/prisma-v2/client";
import { requireV2Store } from "@/v2/auth";
import { v2db } from "@/v2/db";
import {
  ActionEmptyState,
  Field,
  StatusBadge,
  V2ModulePage,
  button,
  input,
} from "../_components/V2Ui";
import { readV2Feedback } from "../_lib/search-params";
import { sampleDisplayName } from "../_lib/sample-display";
import { V2DrawerForm } from "../_components/V2Drawer";
import { V2ImageField, V2ImagePreview } from "../_components/V2Image";
import {
  createProductAction,
  createSkuAction,
  setDefaultSkuAction,
  setProductActiveAction,
  setSkuActiveAction,
  updateProductAction,
  updateSkuAction,
} from "./actions";

export const dynamic = "force-dynamic";

const catalogInclude = {
  skus: {
    orderBy: { code: "asc" },
    include: {
      sourceSample: { select: { id: true, code: true, name: true } },
      recipe: {
        select: {
          id: true,
          versions: {
            orderBy: { versionNo: "desc" },
            select: { id: true, versionNo: true, state: true, publishedAt: true },
          },
        },
      },
    },
  },
} satisfies Prisma.ProductInclude;

type CatalogProduct = Prisma.ProductGetPayload<{ include: typeof catalogInclude }>;
type CatalogSku = CatalogProduct["skus"][number];
type SampleOption = { id: string; code: string; name: string };

function recipeStatus(sku: CatalogSku) {
  const versions = sku.recipe?.versions ?? [];
  return {
    published: versions.find((version) => version.state === "PUBLISHED"),
    draft: versions.find((version) => version.state === "DRAFT"),
    hasVersions: versions.length > 0,
  };
}

function RecipeBadges({ sku }: { sku: CatalogSku }) {
  const { published, draft, hasVersions } = recipeStatus(sku);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {published && <StatusBadge tone="success">已发布 v{published.versionNo}</StatusBadge>}
      {draft && <StatusBadge tone="warning">草稿 v{draft.versionNo}</StatusBadge>}
      {!published && !draft && (
        <StatusBadge tone="neutral">{hasVersions ? "无已发布配方" : "无配方"}</StatusBadge>
      )}
      <Link
        className="text-xs text-emerald-700 underline"
        href={`/v2/recipes?q=${encodeURIComponent(sku.code)}`}
      >
        配方详情
      </Link>
    </div>
  );
}

function SourceSampleSelect({ samples, defaultValue }: { samples: SampleOption[]; defaultValue?: string | null }) {
  return (
    <select className={`${input} mt-1`} name="sourceSampleId" defaultValue={defaultValue ?? ""}>
      <option value="">无来源样品</option>
      {samples.map((sample) => (
        <option key={sample.id} value={sample.id}>
          {sampleDisplayName(sample)}
        </option>
      ))}
    </select>
  );
}

function SkuFields({ sku, samples }: { sku?: CatalogSku; samples: SampleOption[] }) {
  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm text-stone-700">
          规格名称
          <input
            className={`${input} mt-1`}
            name="name"
            defaultValue={sku?.name}
            maxLength={100}
            required
          />
        </label>
        <label className="text-sm text-stone-700">
          售价（元）
          <input
            className={`${input} mt-1`}
            name="price"
            type="number"
            min="0"
            step="0.01"
            defaultValue={sku ? Number(sku.price) : undefined}
            required
          />
        </label>
        <label className="text-sm text-stone-700">
          耗材估算（元）
          <input
            className={`${input} mt-1`}
            name="estimatedConsumableCost"
            type="number"
            min="0"
            step="0.01"
            defaultValue={sku ? Number(sku.estimatedConsumableCost) : 0}
            required
          />
        </label>
        <label className="text-sm text-stone-700">
          人工估算（元）
          <input
            className={`${input} mt-1`}
            name="estimatedLaborCost"
            type="number"
            min="0"
            step="0.01"
            defaultValue={sku ? Number(sku.estimatedLaborCost) : 0}
            required
          />
        </label>
        {sku && (
          <label className="text-sm text-stone-700">
            系统 SKU 编号
            <input className={`${input} mt-1 bg-stone-100 font-mono`} value={sku.code} readOnly />
          </label>
        )}
        <label className="text-sm text-stone-700">
          来源样品
          <SourceSampleSelect samples={samples} defaultValue={sku?.sourceSampleId} />
        </label>
      </div>
      <V2ImageField
        name="imageKey"
        module="wms-sku"
        initialValue={sku?.imageKey}
        label="SKU 图片"
        alt="SKU 图片"
        hint="留空时使用商品主图；支持 JPG、PNG、WebP，单张不超过 3MB。"
        compact
      />
      <label className="flex items-center gap-2 text-sm text-stone-700">
        <input type="checkbox" name="active" defaultChecked={sku ? sku.active : true} />
        启用该 SKU
      </label>
    </>
  );
}

function ProductEditForm({ product }: { product: CatalogProduct }) {
  return (
    <V2DrawerForm
      triggerLabel="编辑商品"
      title={`编辑商品：${product.name}`}
      description="商品编号由系统自动生成，创建后不可修改。"
      action={updateProductAction}
      submitLabel="保存商品"
      size="lg"
      triggerClassName={button}
    >
      <input type="hidden" name="productId" value={product.id} />
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="商品名称" name="name" defaultValue={product.name} />
        <label className="block text-sm text-stone-700">
          系统商品编号
          <input className={`${input} mt-1 bg-stone-100 font-mono`} value={product.code} readOnly />
        </label>
        <label className="block text-sm text-stone-700">
          默认 SKU
          <select className={`${input} mt-1`} name="defaultSkuId" defaultValue={product.defaultSkuId ?? ""}>
            <option value="">未设置（仅停用商品允许）</option>
            {product.skus.map((sku) => (
              <option key={sku.id} value={sku.id}>
                {sku.name} · {sku.code}
                {sku.active ? "" : "（当前停用；需同时勾选启用）"}
              </option>
            ))}
          </select>
        </label>
      </div>
      <V2ImageField
        name="imageKey"
        module="wms-product"
        initialValue={product.imageKey}
        label="商品主图"
        alt="商品主图"
        hint="商品默认展示图；SKU 图片留空时继承此图。支持 JPG、PNG、WebP，单张不超过 3MB。"
      />
      <label className="flex items-center gap-2 text-sm text-stone-700">
        <input type="checkbox" name="active" defaultChecked={product.active} />
        启用商品（至少保留一个启用的 SKU）
      </label>
      <fieldset>
        <legend className="text-sm text-stone-700">SKU 启用范围</legend>
        <p className="mt-1 text-xs text-stone-500">
          勾选表示该 SKU 保持启用并包含在商品中；取消勾选会停用该 SKU。默认 SKU 必须是已勾选的 SKU。停用默认 SKU 前请先在上方选择新的默认 SKU；停用最后一个启用 SKU 前请先取消启用商品。
        </p>
        {product.skus.length === 0 ? (
          <p className="mt-2 text-sm text-amber-800">该商品还没有 SKU，请先新增 SKU。</p>
        ) : (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {product.skus.map((sku) => (
              <label key={sku.id} className="flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm">
                <input type="checkbox" name="activeSkuIds" value={sku.id} defaultChecked={sku.active} />
                <span>{sku.name}</span>
                <span className="ml-auto font-mono text-xs text-stone-500">{sku.code}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
    </V2DrawerForm>
  );
}

function SkuCreateForm({ product, samples }: { product: CatalogProduct; samples: SampleOption[] }) {
  return (
    <V2DrawerForm
      triggerLabel="新增 SKU"
      title={`新增 SKU：${product.name}`}
      description="SKU 编号由系统自动生成，无需填写。"
      action={createSkuAction}
      submitLabel="创建 SKU"
      size="lg"
      triggerClassName={button}
    >
      <input type="hidden" name="productId" value={product.id} />
      <SkuFields samples={samples} />
      <p className="text-xs text-stone-500">
        SKU 编号由系统自动生成，无需填写。同一来源样品可以生成多个 SKU，系统不会去重。
      </p>
    </V2DrawerForm>
  );
}

function SkuEditForm({ product, sku, samples }: { product: CatalogProduct; sku: CatalogSku; samples: SampleOption[] }) {
  return (
    <V2DrawerForm
      triggerLabel="编辑 SKU"
      title={`编辑 SKU：${sku.name}`}
      description={`SKU 编号 ${sku.code} 由系统生成，创建后不可修改。`}
      action={updateSkuAction}
      submitLabel="保存 SKU"
      size="lg"
      triggerClassName="text-xs text-emerald-700 hover:underline"
    >
      <input type="hidden" name="skuId" value={sku.id} />
      <input type="hidden" name="productId" value={product.id} />
      <p className="text-sm text-stone-700">
        所属商品：<strong>{product.name}</strong>
      </p>
      <SkuFields sku={sku} samples={samples} />
    </V2DrawerForm>
  );
}

function SkuList({ product, samples }: { product: CatalogProduct; samples: SampleOption[] }) {
  if (product.skus.length === 0) {
    return (
      <p className="mt-3 rounded-xl border border-dashed border-stone-300 bg-white px-4 py-8 text-center text-sm text-stone-500">
        该商品还没有 SKU。先新增 SKU，再设置默认 SKU 并启用商品。
      </p>
    );
  }
  return (
    <div className="mt-3 space-y-2">
      {product.skus.map((sku) => (
        <details key={sku.id} className="rounded-xl border border-stone-200 bg-white">
          <summary className={`flex cursor-pointer list-none flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 ${sku.active ? "" : "bg-zinc-50 text-zinc-600"}`}>
            <div className="min-w-48 flex-1">
              <div className="flex flex-wrap items-center gap-1">
                <V2ImagePreview stored={sku.imageKey || product.imageKey} alt={sku.name} compact className="mr-1 h-10 w-10" />
                <span className="font-medium text-zinc-900">{sku.name}</span>
                {product.defaultSkuId === sku.id && <StatusBadge tone="info">默认</StatusBadge>}
              </div>
              <div className="text-xs text-zinc-500">
                编号 <span className="font-mono">{sku.code}</span>
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">状态</div>
              <StatusBadge tone={sku.active ? "success" : "neutral"}>{sku.active ? "启用" : "停用"}</StatusBadge>
            </div>
            <div className="w-44">
              <div className="text-xs text-zinc-500">售价与成本</div>
              <div>售价 ¥{Number(sku.price).toFixed(2)}</div>
              <div className="text-xs text-zinc-500">
                耗材 ¥{Number(sku.estimatedConsumableCost).toFixed(2)} · 人工 ¥{Number(sku.estimatedLaborCost).toFixed(2)}
              </div>
            </div>
            <div className="w-36">
              <div className="text-xs text-zinc-500">来源样品</div>
              {sku.sourceSample ? (
                <>
                  <div>{sku.sourceSample.name}</div>
                  <div className="font-mono text-xs text-zinc-500">{sku.sourceSample.code}</div>
                </>
              ) : (
                <span className="text-zinc-400">无来源样品</span>
              )}
            </div>
            <div>
              <div className="text-xs text-zinc-500">配方状态</div>
              <RecipeBadges sku={sku} />
            </div>
            <span className="ml-auto text-sm text-emerald-700">操作</span>
          </summary>
          <div className="space-y-3 border-t border-stone-200 p-4">
            <SkuEditForm product={product} sku={sku} samples={samples} />
            <div className="flex flex-wrap items-center gap-4">
              <form action={setSkuActiveAction}>
                <input type="hidden" name="skuId" value={sku.id} />
                <input type="hidden" name="active" value={String(!sku.active)} />
                <button className="text-xs text-stone-600 underline">{sku.active ? "停用 SKU" : "启用 SKU"}</button>
              </form>
              {sku.active && product.defaultSkuId !== sku.id && (
                <form action={setDefaultSkuAction}>
                  <input type="hidden" name="productId" value={product.id} />
                  <input type="hidden" name="skuId" value={sku.id} />
                  <button className="text-xs text-emerald-700 underline">设为默认 SKU</button>
                </form>
              )}
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}

function ProductListItem({ product, samples }: { product: CatalogProduct; samples: SampleOption[] }) {
  const defaultSku = product.skus.find((sku) => sku.id === product.defaultSkuId);
  const activeSkuCount = product.skus.filter((sku) => sku.active).length;
  return (
    <details className="rounded-xl border border-stone-200 bg-white shadow-sm">
      <summary className={`flex cursor-pointer list-none flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 ${product.active ? "" : "bg-zinc-50 text-zinc-600"}`}>
        <V2ImagePreview stored={product.imageKey} alt={product.name} compact className="h-12 w-12" />
        <div className="min-w-52 flex-1">
          <div className="font-medium text-zinc-900">{product.name}</div>
          <div className="text-xs text-zinc-500">
            编号 <span className="font-mono">{product.code}</span>
          </div>
        </div>
        <div>
          <div className="text-xs text-zinc-500">状态</div>
          <StatusBadge tone={product.active ? "success" : "neutral"}>
            {product.active ? "启用" : "停用"}
          </StatusBadge>
        </div>
        <div className="w-44">
          <div className="text-xs text-zinc-500">默认 SKU</div>
          {defaultSku ? (
            <>
              <div className="text-sm">{defaultSku.name}</div>
              <div className="font-mono text-xs text-zinc-500">{defaultSku.code}</div>
            </>
          ) : (
            <div className="text-sm text-zinc-400">未设置</div>
          )}
        </div>
        <div>
          <div className="text-xs text-zinc-500">SKU 数量</div>
          <div className="text-sm">
            {product.skus.length} 个
            <span className="text-xs text-zinc-500">（启用 {activeSkuCount} 个）</span>
          </div>
        </div>
        <span className="ml-auto text-sm text-emerald-700">展开 / 收起 SKU 与操作</span>
      </summary>

      <div className="border-t border-stone-200 p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={product.active ? "success" : "neutral"}>
              {product.active ? "商品启用" : "商品停用"}
            </StatusBadge>
            <form action={setProductActiveAction}>
              <input type="hidden" name="productId" value={product.id} />
              <input type="hidden" name="active" value={String(!product.active)} />
              <button className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs text-stone-700">
                {product.active ? "停用商品" : "启用商品"}
              </button>
            </form>
          </div>
          <span className="text-xs text-stone-400">商品与 SKU 编号均由系统生成；停用不会删除历史数据。</span>
        </div>

        <div className="mt-4 space-y-4">
          <ProductEditForm product={product} />
          <SkuCreateForm product={product} samples={samples} />
          <section>
            <h3 className="font-semibold">全部 SKU（含停用）</h3>
            <p className="mt-1 text-xs text-stone-500">
              规格名称即顾客可选的规格；配方状态仅展示已发布与草稿版本，详细用料请前往标准配方。
            </p>
            <SkuList product={product} samples={samples} />
          </section>
        </div>
      </div>
    </details>
  );
}

export default async function CatalogPage({ searchParams }: PageProps<"/v2/catalog">) {
  const session = await auth();
  if (!session?.user || session.user.source !== "v2") {
    redirect("/login?callbackUrl=/v2/catalog");
  }
  const { tenantId } = await requireV2Store("catalog");
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const requestedState = typeof params.state === "string" ? params.state : "all";
  const state = requestedState === "active" || requestedState === "inactive" ? requestedState : "all";

  const where: Prisma.ProductWhereInput = {
    tenantId,
    ...(state === "active" ? { active: true } : state === "inactive" ? { active: false } : {}),
  };
  if (query) {
    where.OR = [
      { code: { contains: query, mode: "insensitive" } },
      { name: { contains: query, mode: "insensitive" } },
      {
        skus: {
          some: {
            OR: [
              { code: { contains: query, mode: "insensitive" } },
              { name: { contains: query, mode: "insensitive" } },
            ],
          },
        },
      },
    ];
  }

  const [products, samples] = await Promise.all([
    v2db.product.findMany({
      where,
      include: catalogInclude,
      orderBy: [{ active: "desc" }, { code: "asc" }],
    }),
    v2db.sample.findMany({
      where: { tenantId },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
  ]);
  const feedback = readV2Feedback(params);
  const activeProductCount = products.filter((product) => product.active).length;
  const hasFilters = query.length > 0 || state !== "all";

  return (
    <V2ModulePage
      title="商品列表"
      description="维护 WMS 商品与 SKU 主数据：系统编号、规格名称、售价、成本估算、来源样品与配方版本状态。"
      message={feedback.message}
      error={feedback.error}
      actions={
        <>
          <Link className="rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-700" href="/v2/samples">
            样品库与转 SKU
          </Link>
          <V2DrawerForm
            triggerLabel="新增商品"
            title="新增商品"
            description="商品编号由系统自动生成，无需填写。"
            action={createProductAction}
            submitLabel="创建商品"
            size="md"
            triggerClassName={button}
          >
            <Field label="商品名称" name="name" />
            <V2ImageField
              name="imageKey"
              module="wms-product"
              label="商品主图"
              alt="商品主图"
              compact
            />
            <p className="text-xs text-stone-500">
              商品编号由系统自动生成。新商品默认为停用，请先添加 SKU，再在商品编辑中设置默认 SKU 并启用商品。
            </p>
          </V2DrawerForm>
        </>
      }
    >
      <form className="flex flex-wrap items-end gap-2 rounded-xl border border-stone-200 bg-white p-4">
        <label className="block text-sm text-stone-700">
          搜索
          <input
            className={`${input} mt-1 max-w-sm`}
            name="q"
            defaultValue={query}
            placeholder="商品编号/名称 或 SKU 编号/规格名称"
          />
        </label>
        <label className="block text-sm text-stone-700">
          商品状态
          <select className={`${input} mt-1 w-36`} name="state" defaultValue={state}>
            <option value="all">全部状态</option>
            <option value="active">启用</option>
            <option value="inactive">停用</option>
          </select>
        </label>
        <button className={button}>查询</button>
        {hasFilters && (
          <Link className="px-2 py-2 text-sm text-stone-500 underline" href="/v2/catalog">
            清除筛选
          </Link>
        )}
      </form>

      <p className="text-xs text-stone-500">
        共 {products.length} 个商品，其中启用 {activeProductCount} 个；SKU 明细包含全部停用记录。
      </p>

      {products.length === 0 ? (
        <ActionEmptyState
          title={hasFilters ? "没有符合条件的商品" : "还没有商品"}
          description={
            hasFilters
              ? "调整商品/SKU 搜索关键词或商品状态后重试。"
              : "点击右上角“新增商品”创建商品档案，再为商品添加 SKU 与配方。"
          }
        />
      ) : (
        <div className="space-y-3">
          {products.map((product) => (
            <ProductListItem key={product.id} product={product} samples={samples} />
          ))}
        </div>
      )}
    </V2ModulePage>
  );
}
