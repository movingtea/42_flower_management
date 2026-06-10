import {
  HomeSceneEntryTargetType,
  OrderStatus,
  ReminderStatus,
} from "@/generated/prisma/enums";
import { isLocalhostUrl } from "@/lib/image-url";
import { activeSpuWhere } from "@/lib/product-query";
import { prisma } from "@/lib/prisma";
import {
  buildDataQualityResult,
  createDataQualityIssue,
  filterDataQualityIssues,
  issueBatchNegativeRemaining,
  issueExpiredReminder,
  issueFlowerWikiMissingCost,
  issueHomeSceneEntryInvalid,
  issueLocalhostImage,
  issueOrderMissingCostSnapshot,
  issueProductMissingImage,
  issueRecipeWithoutLines,
  issueRecommendationInactiveProduct,
  issueSkuMissingRecipe,
  type DataQualityDomain,
  type DataQualityResult,
  type DataQualitySeverity,
} from "@/services/data-quality-pure";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export async function collectDataQualityIssues() {
  const issues = [];

  const wikis = await prisma.flowerWiki.findMany({
    select: {
      id: true,
      chineseName: true,
      englishName: true,
      standardUnitCost: true,
    },
  });

  for (const w of wikis) {
    if (w.standardUnitCost == null || Number(w.standardUnitCost) <= 0) {
      issues.push(
        issueFlowerWikiMissingCost(w.id, w.chineseName || w.englishName)
      );
    }
  }

  const recipes = await prisma.recipe.findMany({
    select: {
      id: true,
      name: true,
      packagingKitId: true,
      _count: { select: { lines: true } },
      lines: {
        select: {
          quantityNeeded: true,
          wiki: { select: { standardUnitCost: true, chineseName: true } },
        },
      },
    },
  });

  for (const r of recipes) {
    if (r._count.lines === 0) {
      issues.push(issueRecipeWithoutLines(r.id, r.name));
    }
    if (!r.packagingKitId) {
      issues.push(
        createDataQualityIssue({
          severity: "WARNING",
          domain: "WMS",
          entityType: "Recipe",
          entityId: r.id,
          title: "配方未绑定包装方案",
          message: `Recipe「${r.name}」未绑定 PackagingKit。`,
          actionHref: "/wms/recipes",
        })
      );
    }
    for (const line of r.lines) {
      if (line.quantityNeeded <= 0) {
        issues.push(
          createDataQualityIssue({
            severity: "CRITICAL",
            domain: "WMS",
            entityType: "RecipeLine",
            entityId: r.id,
            title: "配方行数量无效",
            message: `Recipe「${r.name}」存在 quantityNeeded <= 0 的明细。`,
            actionHref: "/wms/recipes",
          })
        );
      }
      if (
        line.wiki.standardUnitCost == null ||
        Number(line.wiki.standardUnitCost) <= 0
      ) {
        issues.push(
          createDataQualityIssue({
            severity: "WARNING",
            domain: "WMS",
            entityType: "RecipeLine",
            entityId: r.id,
            title: "配方花材缺标准成本",
            message: `Recipe「${r.name}」中花材「${line.wiki.chineseName}」缺少 standardUnitCost。`,
            actionHref: "/wms/wiki",
          })
        );
      }
    }
  }

  const kits = await prisma.packagingKit.findMany({
    where: { isActive: true },
    select: { id: true, name: true, standardCost: true },
  });
  for (const k of kits) {
    if (Number(k.standardCost) <= 0) {
      issues.push(
        createDataQualityIssue({
          severity: "WARNING",
          domain: "WMS",
          entityType: "PackagingKit",
          entityId: k.id,
          title: "包装方案成本无效",
          message: `包装方案「${k.name}」standardCost <= 0。`,
          actionHref: "/wms/packaging-kits",
        })
      );
    }
  }

  const activeSpus = await prisma.productSpu.findMany({
    where: { ...activeSpuWhere, isActive: true },
    include: {
      skus: true,
      categories: { select: { id: true } },
    },
  });

  for (const spu of activeSpus) {
    if (!spu.occasionTags?.length) {
      issues.push(
        createDataQualityIssue({
          severity: "WARNING",
          domain: "CMS",
          entityType: "ProductSpu",
          entityId: spu.id,
          title: "商品缺少场景标签",
          message: `已上架商品「${spu.name}」未配置 occasionTags，小程序场景筛选可能无法命中。`,
          actionHref: `/cms/products/${spu.id}`,
        })
      );
    }
    if (spu.categories.length === 0) {
      issues.push(
        createDataQualityIssue({
          severity: "SUGGESTION",
          domain: "CMS",
          entityType: "ProductSpu",
          entityId: spu.id,
          title: "商品未关联分类",
          message: `商品「${spu.name}」未关联商品分类。`,
          actionHref: `/cms/products/${spu.id}`,
        })
      );
    }

    const hasMainImage = spu.skus.some((s) => s.imageUrl?.trim());
    if (!hasMainImage) {
      issues.push(issueProductMissingImage(spu.id, spu.name));
    }

    for (const sku of spu.skus) {
      if (!sku.recipeId) {
        issues.push(issueSkuMissingRecipe(sku.id, sku.specName));
      }
      if (Number(sku.price) <= 0) {
        issues.push(
          createDataQualityIssue({
            severity: "CRITICAL",
            domain: "CMS",
            entityType: "ProductSku",
            entityId: sku.id,
            title: "SKU 价格无效",
            message: `款式「${sku.specName}」价格 <= 0。`,
            actionHref: `/cms/products/${spu.id}`,
          })
        );
      }
      if (sku.stock < 0) {
        issues.push(
          createDataQualityIssue({
            severity: "CRITICAL",
            domain: "CMS",
            entityType: "ProductSku",
            entityId: sku.id,
            title: "SKU 库存为负",
            message: `款式「${sku.specName}」stock < 0。`,
            actionHref: `/cms/products/${spu.id}`,
          })
        );
      }
      if (sku.imageUrl && isLocalhostUrl(sku.imageUrl)) {
        issues.push(issueLocalhostImage("ProductSku", sku.id, "imageUrl"));
      }
    }
  }

  const recItems = await prisma.cmsRecommendationItem.findMany({
    where: { isActive: true, slot: { isActive: true } },
    include: {
      product: { select: { id: true, name: true, isActive: true, isDeleted: true, occasionTags: true } },
      sku: { select: { id: true, spuId: true } },
      slot: { select: { sceneType: true, name: true } },
    },
  });

  for (const item of recItems) {
    if (!item.product || item.product.isDeleted || !item.product.isActive) {
      issues.push(
        issueRecommendationInactiveProduct(
          item.id,
          item.product?.name ?? item.productId
        )
      );
    }
    if (item.skuId && item.sku && item.sku.spuId !== item.productId) {
      issues.push(
        createDataQualityIssue({
          severity: "CRITICAL",
          domain: "CMS",
          entityType: "CmsRecommendationItem",
          entityId: item.id,
          title: "推荐项 SKU 不匹配",
          message: "推荐项指定的 SKU 不属于该商品。",
          actionHref: "/cms/recommendations",
        })
      );
    }
    if (
      item.imageOverride &&
      isLocalhostUrl(item.imageOverride)
    ) {
      issues.push(
        issueLocalhostImage("CmsRecommendationItem", item.id, "imageOverride")
      );
    }
    if (
      item.slot.sceneType &&
      item.product?.occasionTags &&
      !item.product.occasionTags.includes(item.slot.sceneType)
    ) {
      issues.push(
        createDataQualityIssue({
          severity: "WARNING",
          domain: "CMS",
          entityType: "CmsRecommendationItem",
          entityId: item.id,
          title: "推荐位场景与商品标签不匹配",
          message: `推荐位「${item.slot.name}」场景与商品「${item.product.name}」occasionTags 不一致。`,
          actionHref: "/cms/recommendations",
        })
      );
    }
  }

  const emptySlots = await prisma.cmsRecommendationSlot.findMany({
    where: { isActive: true },
    include: { _count: { select: { items: { where: { isActive: true } } } } },
  });
  for (const slot of emptySlots) {
    if (slot._count.items === 0) {
      issues.push(
        createDataQualityIssue({
          severity: "WARNING",
          domain: "CMS",
          entityType: "CmsRecommendationSlot",
          entityId: slot.id,
          title: "推荐位为空",
          message: `推荐位「${slot.name}」暂无 active 商品。`,
          actionHref: "/cms/recommendations",
        })
      );
    }
  }

  const sceneEntries = await prisma.cmsHomeSceneEntry.findMany({
    where: { isActive: true },
  });
  for (const entry of sceneEntries) {
    if (!entry.iconKey?.trim()) {
      issues.push(
        issueHomeSceneEntryInvalid(entry.id, entry.title, "iconKey 为空")
      );
    }
    if (
      entry.targetType === HomeSceneEntryTargetType.RECOMMENDATION_SLOT &&
      !entry.linkedRecommendationSlotKey?.trim()
    ) {
      issues.push(
        issueHomeSceneEntryInvalid(
          entry.id,
          entry.title,
          "targetType 为推荐位但未关联 linkedRecommendationSlotKey"
        )
      );
    }
    if (
      entry.targetType === HomeSceneEntryTargetType.CUSTOM_URL &&
      !entry.targetValue?.trim()
    ) {
      issues.push(
        issueHomeSceneEntryInvalid(
          entry.id,
          entry.title,
          "targetType 为自定义路径但 targetValue 为空"
        )
      );
    }
    if (
      entry.targetType === HomeSceneEntryTargetType.PRODUCT_FILTER &&
      !entry.sceneType
    ) {
      issues.push(
        issueHomeSceneEntryInvalid(
          entry.id,
          entry.title,
          "商品筛选类型缺少 sceneType"
        )
      );
    }
  }

  const banners = await prisma.banner.findMany({
    where: { isActive: true },
    select: { id: true, imageUrl: true },
  });
  for (const b of banners) {
    if (isLocalhostUrl(b.imageUrl)) {
      issues.push(issueLocalhostImage("Banner", b.id, "imageUrl"));
    }
  }

  const paidWithoutSnapshot = await prisma.order.findMany({
    where: { status: OrderStatus.PAID, costSnapshot: null },
    select: { id: true, orderNo: true },
    take: 50,
  });
  for (const o of paidWithoutSnapshot) {
    issues.push(issueOrderMissingCostSnapshot(o.id, o.orderNo));
  }

  const zeroCostSnapshots = await prisma.orderCostSnapshot.findMany({
    where: { totalCost: { lte: 0 } },
    include: { order: { select: { id: true, orderNo: true, totalAmount: true, status: true } } },
    take: 20,
  });
  for (const snap of zeroCostSnapshots) {
    if (
      snap.order.status === OrderStatus.PAID &&
      Number(snap.order.totalAmount) > 0
    ) {
      issues.push(
        createDataQualityIssue({
          severity: "WARNING",
          domain: "ORDER",
          entityType: "OrderCostSnapshot",
          entityId: snap.orderId,
          title: "成本快照为 0",
          message: `订单 ${snap.order.orderNo} 成本快照为 0 但订单金额 > 0。`,
          actionHref: "/wms/reports",
        })
      );
    }
  }

  const badBatches = await prisma.batch.findMany({
    where: { remainingQty: { lt: 0 } },
    select: { id: true, batchNo: true },
    take: 20,
  });
  for (const b of badBatches) {
    issues.push(issueBatchNegativeRemaining(b.id, b.batchNo));
  }

  const badUnitCost = await prisma.batch.findMany({
    where: { unitCost: { lte: 0 } },
    select: { id: true, batchNo: true },
    take: 10,
  });
  for (const b of badUnitCost) {
    issues.push(
      createDataQualityIssue({
        severity: "WARNING",
        domain: "WMS",
        entityType: "Batch",
        entityId: b.id,
        title: "批次单位成本无效",
        message: `批次 ${b.batchNo ?? b.id} unitCost <= 0。`,
        actionHref: "/wms/inventory",
      })
    );
  }

  const expiredReminders = await prisma.customerReminder.findMany({
    where: {
      status: ReminderStatus.PENDING,
      remindAt: { lt: new Date(Date.now() - SEVEN_DAYS_MS) },
    },
    include: { customer: { select: { name: true } } },
    take: 30,
  });
  for (const r of expiredReminders) {
    issues.push(issueExpiredReminder(r.id, r.customer?.name ?? null));
  }

  const paidOrdersNoCustomer = await prisma.order.count({
    where: {
      status: OrderStatus.PAID,
      customerId: null,
      createdAt: { gte: new Date("2026-01-01") },
    },
  });
  if (paidOrdersNoCustomer > 0) {
    issues.push(
      createDataQualityIssue({
        severity: "WARNING",
        domain: "CRM",
        entityType: "Order",
        entityId: null,
        title: "已支付订单未关联客户",
        message: `${paidOrdersNoCustomer} 笔已支付订单缺少 CRM Customer 关联。`,
        actionHref: "/wms/crm/customers",
        metadata: { count: paidOrdersNoCustomer },
      })
    );
  }

  return issues;
}

export async function getDataQualityReport(params?: {
  severity?: DataQualitySeverity | null;
  domain?: DataQualityDomain | null;
  page?: number;
  pageSize?: number;
}): Promise<DataQualityResult & { pagination: ReturnType<typeof filterDataQualityIssues>["pagination"] }> {
  const allIssues = await collectDataQualityIssues();
  const base = buildDataQualityResult(allIssues);
  const { issues, pagination } = filterDataQualityIssues(allIssues, params ?? {});
  return { ...base, issues, pagination };
}
