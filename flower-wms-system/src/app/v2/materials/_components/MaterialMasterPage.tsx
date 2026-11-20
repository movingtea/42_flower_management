import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { FloralRole } from "@/generated/prisma-v2/client";
import { requireV2Store } from "@/v2/auth";
import { v2db } from "@/v2/db";
import { V2DrawerForm } from "../../_components/V2Drawer";
import { V2FilterBar, V2FilterField, V2Meta, V2ModulePage, button, input } from "../../_components/V2Ui";
import { readV2Feedback } from "../../_lib/search-params";
import { createMaterialAction } from "../actions";
import { MaterialKnowledgeEditor } from "../MaterialKnowledgeEditor";
import { FlowerClassificationFields } from "./FlowerClassificationFields";
import { FlowerClassificationFilter } from "./FlowerClassificationFilter";
import { MaterialIdentityFields } from "./MaterialIdentityFields";
import { MaterialTable, type FlowerClassificationOptions } from "./MaterialTable";
import { FLORAL_ROLE_LABEL } from "./material-format";
import type { MaterialScopeConfig } from "./material-scope";

/**
 * Search params are typed inline instead of using the generated `PageProps`
 * route types: the consumable route is a new page and both routes share this
 * server component, so it must not depend on one specific generated route.
 */
export type MaterialSearchParams = {
  q?: string | string[];
  state?: string | string[];
  category?: string | string[];
  role?: string | string[];
  color?: string | string[];
  variety?: string | string[];
  productName?: string | string[];
  message?: string | string[];
  error?: string | string[];
};

function single(value: string | string[] | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return [...new Set(
    values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)),
  )].sort((left, right) => left.localeCompare(right, "zh"));
}

/**
 * Shared server-rendered material master page.
 *
 * The flower and consumable routes only differ by `scope`: the same query,
 * table, drawers, actions and feedback handling are reused, so business logic
 * is never duplicated between `/v2/materials` and `/v2/consumables`.
 */
export async function MaterialMasterPage({
  scope,
  searchParams,
}: {
  scope: MaterialScopeConfig;
  searchParams: Promise<MaterialSearchParams>;
}) {
  const session = await auth();
  if (!session?.user || session.user.source !== "v2") {
    redirect(`/login?callbackUrl=${scope.basePath}`);
  }
  const { tenantId } = await requireV2Store("catalog");
  const params = await searchParams;
  const query = single(params.q);
  const state = single(params.state) || "active";
  const category = single(params.category);
  const role = single(params.role);
  const color = single(params.color);
  const variety = single(params.variety);
  const productName = single(params.productName);
  const floralRoleFilter =
    scope.showFlowerFields && (Object.values(FloralRole) as readonly string[]).includes(role)
      ? role
      : "";

  type ClassificationRow = { flowerVariety: string | null; flowerProductName: string | null; color: string | null };

  const [categories, materials, classificationRows] = await Promise.all([
    v2db.materialCategory.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, active: true },
    }),
    v2db.material.findMany({
      where: {
        tenantId,
        kind: { in: [...scope.kinds] },
        ...(state === "all" ? {} : { active: state !== "inactive" }),
        ...(query ? { OR: [
          { code: { contains: query, mode: "insensitive" } },
          { name: { contains: query, mode: "insensitive" } },
          { englishName: { contains: query, mode: "insensitive" } },
          { pinyinIndex: { contains: query.toLowerCase(), mode: "insensitive" } },
          { aliasText: { contains: query, mode: "insensitive" } },
        ] } : {}),
        ...(category ? { categories: { some: { categoryId: category } } } : {}),
        ...(floralRoleFilter ? { floralRole: floralRoleFilter as FloralRole } : {}),
        ...(scope.showFlowerFields && variety ? { flowerVariety: variety } : {}),
        ...(scope.showFlowerFields && productName ? { flowerProductName: productName } : {}),
        ...(color ? { color: color } : {}),
      },
      include: { categories: { include: { category: { select: { id: true, name: true, active: true } } } } },
      orderBy: [{ active: "desc" }, { code: "asc" }],
    }),
    v2db.material.findMany({
      where: { tenantId, kind: { in: [...scope.kinds] } },
      select: { flowerVariety: true, flowerProductName: true, color: true },
      take: 1000,
    }) as Promise<ClassificationRow[]>,
  ]);
  const classification: FlowerClassificationOptions = {
    varieties: uniqueSorted(classificationRows.map((row) => row.flowerVariety)),
    colors: [...new Map(
      classificationRows
        .filter((row) => row.color)
        .map((row) => ({
          variety: row.flowerVariety?.trim() || null,
          color: row.color!.trim(),
        }))
        .map((option) => [`${option.variety ?? ""}::${option.color}`, option] as const),
    ).values()],
    products: [...new Map(
      classificationRows
        .filter((row) => row.flowerProductName)
        .map((row) => ({
          variety: row.flowerVariety?.trim() || null,
          color: row.color?.trim() || null,
          name: row.flowerProductName!.trim(),
        }))
        .map((product) => [
          `${product.variety ?? ""}::${product.color ?? ""}::${product.name}`,
          product,
        ] as const),
    ).values()],
  };
  const feedback = readV2Feedback(params);
  const hasFilters = Boolean(
    query || category || floralRoleFilter || color || variety || productName || state !== "active",
  );
  const activeCount = materials.filter((material) => material.active).length;
  const inactiveCount = materials.length - activeCount;
  const roleCounts = scope.showFlowerFields
    ? Object.values(FloralRole)
        .map((value) => ({
          value,
          count: materials.filter((material) => material.floralRole === value).length,
        }))
        .filter((entry) => entry.count > 0)
    : [];

  return <V2ModulePage
    title={scope.title}
    description={scope.description}
    message={feedback.message}
    error={feedback.error}
    actions={<V2DrawerForm
      triggerLabel={scope.create.trigger}
      title={scope.create.title}
      description={scope.create.description}
      action={createMaterialAction}
      submitLabel={scope.create.submit}
      size="xl"
      triggerClassName={button}
      footerNote={scope.footerNote}
    >
      <input type="hidden" name="returnTo" value={scope.basePath} />
      <MaterialIdentityFields
        scope={scope}
        classificationFields={scope.showFlowerFields
          ? <FlowerClassificationFields {...classification} />
          : undefined}
      />
      <MaterialKnowledgeEditor categories={categories} variant={scope.showFlowerFields ? "flower" : "consumable"} />
    </V2DrawerForm>}
  >
    <V2FilterBar
      key={`${query}|${state}|${category}|${floralRoleFilter}|${variety}|${color}|${productName}`}
      action={scope.basePath}
      label={`${scope.title}筛选`}
      keyword={{ defaultValue: query, placeholder: scope.searchPlaceholder }}
      resetHref={hasFilters ? scope.basePath : undefined}
    >
      {scope.showFlowerFields && <>
        <V2FilterField label="花材角色" className="w-40">
          <select className={`${input} w-full`} name="role" defaultValue={floralRoleFilter}>
            <option value="">全部角色</option>
            {Object.values(FloralRole).map((value) => (
              <option key={value} value={value}>{FLORAL_ROLE_LABEL[value] ?? value}</option>
            ))}
          </select>
        </V2FilterField>
        <FlowerClassificationFilter
          varieties={classification.varieties}
          products={classification.products}
          colors={classification.colors}
          defaultVariety={variety}
          defaultProductName={productName}
          defaultColor={color}
        />
      </>}
      <V2FilterField label="分类" className="w-44">
        <select className={`${input} w-full`} name="category" defaultValue={category}>
          <option value="">全部分类</option>
          {categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </V2FilterField>
      <V2FilterField label="状态" className="w-36">
        <select className={`${input} w-full`} name="state" defaultValue={state}>
          <option value="active">启用</option>
          <option value="inactive">已停用</option>
          <option value="all">全部</option>
        </select>
      </V2FilterField>
    </V2FilterBar>

    <div className="flex flex-wrap items-center gap-2">
      <V2Meta label="结果">{materials.length} 条</V2Meta>
      <V2Meta label="启用">{activeCount}</V2Meta>
      <V2Meta label="停用">{inactiveCount}</V2Meta>
      {roleCounts.map((entry) => (
        <V2Meta key={entry.value} label={FLORAL_ROLE_LABEL[entry.value] ?? entry.value}>{entry.count}</V2Meta>
      ))}
    </div>

    <MaterialTable
      scope={scope}
      materials={materials}
      categories={categories}
      hasFilters={hasFilters}
      classification={classification}
    />

    <p className="text-xs text-stone-500">{scope.countNote(materials.length)}</p>
  </V2ModulePage>;
}
