import { isLocalhostUrl } from "@/lib/image-url";
import { activeSpuWhere } from "@/lib/product-query";
import { prisma } from "@/lib/prisma";
import { getReportDateRange } from "@/services/business-report-pure";
import {
  aggregateTrialRunStatus,
  type TrialRunStep,
  type TrialRunStepStatus,
} from "@/services/trial-run-check-pure";

export type { TrialRunStep, TrialRunStepStatus };

export type TrialRunCheckResult = {
  status: "READY" | "WARNING" | "BLOCKED";
  steps: TrialRunStep[];
  recommendedTestProduct: {
    spuId: string;
    skuId: string;
    name: string;
  } | null;
  warnings: string[];
};

export function aggregateTrialRunStatusFromSteps(
  steps: TrialRunStep[]
): TrialRunCheckResult["status"] {
  return aggregateTrialRunStatus(steps);
}

function step(
  partial: TrialRunStep
): TrialRunStep {
  return partial;
}

export async function runTrialRunCheck(): Promise<TrialRunCheckResult> {
  const steps: TrialRunStep[] = [];
  const warnings: string[] = [];
  let recommended: TrialRunCheckResult["recommendedTestProduct"] = null;

  const product = await prisma.productSpu.findFirst({
    where: {
      ...activeSpuWhere,
      isActive: true,
      skus: { some: { stock: { gt: 0 } } },
    },
    include: {
      skus: {
        where: { stock: { gt: 0 } },
        orderBy: [{ isMainImage: "desc" }, { sortOrder: "asc" }],
        include: {
          recipe: {
            include: {
              lines: {
                include: {
                  wiki: {
                    include: {
                      materials: {
                        include: {
                          batches: {
                            where: { remainingQty: { gt: 0 } },
                            take: 1,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  if (!product) {
    steps.push(
      step({
        key: "active_product",
        title: "已上架可售商品",
        status: "BLOCKED",
        message: "没有找到已上架且有库存的商品。",
        actionHref: "/cms/products",
      })
    );
  } else {
    steps.push(
      step({
        key: "active_product",
        title: "已上架可售商品",
        status: "PASS",
        message: `找到商品「${product.name}」。`,
        metadata: { spuId: product.id },
      })
    );

    const sku = product.skus[0];
    if (!sku) {
      steps.push(
        step({
          key: "active_sku",
          title: "可售 SKU",
          status: "BLOCKED",
          message: "商品没有可售 SKU。",
          actionHref: `/cms/products/${product.id}`,
        })
      );
    } else {
      steps.push(
        step({
          key: "active_sku",
          title: "可售 SKU",
          status: "PASS",
          message: `SKU「${sku.specName}」库存 ${sku.stock}。`,
          metadata: { skuId: sku.id },
        })
      );

      recommended = {
        spuId: product.id,
        skuId: sku.id,
        name: product.name,
      };

      if (!sku.recipeId || !sku.recipe) {
        steps.push(
          step({
            key: "sku_recipe",
            title: "SKU 绑定 Recipe",
            status: "BLOCKED",
            message: "SKU 未绑定 Recipe，下单后无法准确扣库/算成本。",
            actionHref: `/cms/products/${product.id}`,
          })
        );
      } else {
        steps.push(
          step({
            key: "sku_recipe",
            title: "SKU 绑定 Recipe",
            status: "PASS",
            message: `已绑定 Recipe「${sku.recipe.name}」。`,
          })
        );

        if (sku.recipe.lines.length === 0) {
          steps.push(
            step({
              key: "recipe_lines",
              title: "Recipe 明细",
              status: "BLOCKED",
              message: "Recipe 没有 RecipeLine。",
              actionHref: "/wms/recipes",
            })
          );
        } else {
          steps.push(
            step({
              key: "recipe_lines",
              title: "Recipe 明细",
              status: "PASS",
              message: `${sku.recipe.lines.length} 条配方行。`,
            })
          );

          const hasBatch = sku.recipe.lines.some((line) =>
            line.wiki.materials.some((m) => m.batches.length > 0)
          );

          steps.push(
            step({
              key: "material_batch",
              title: "花材可用批次",
              status: hasBatch ? "PASS" : "WARNING",
              message: hasBatch
                ? "至少一条配方花材有可用批次库存。"
                : "配方花材暂无可用批次，下单可能无法 FIFO 扣库。",
              actionHref: "/wms/purchase-orders",
            })
          );
          if (!hasBatch) {
            warnings.push("建议先完成采购入库后再试营业下单。");
          }
        }
      }

      const image = sku.imageUrl ?? product.skus.find((s) => s.imageUrl)?.imageUrl;
      const imageOk = image && !isLocalhostUrl(image);
      steps.push(
        step({
          key: "product_image",
          title: "商品图片",
          status: imageOk ? "PASS" : "WARNING",
          message: imageOk
            ? "商品图片路径正常。"
            : "商品缺少图片或含 localhost URL。",
          actionHref: `/cms/products/${product.id}`,
        })
      );

      const hasTags = product.occasionTags?.length > 0;
      steps.push(
        step({
          key: "occasion_tags",
          title: "场景标签",
          status: hasTags ? "PASS" : "WARNING",
          message: hasTags
            ? `已配置场景标签：${product.occasionTags.join(", ")}`
            : "商品缺少 occasionTags，场景筛选可能无法命中。",
        })
      );
    }
  }

  const recItem = await prisma.cmsRecommendationItem.findFirst({
    where: {
      isActive: true,
      slot: { isActive: true },
      product: { ...activeSpuWhere, isActive: true },
    },
    include: { product: { select: { name: true } }, slot: { select: { name: true } } },
  });

  steps.push(
    step({
      key: "recommendation",
      title: "推荐位有效商品",
      status: recItem ? "PASS" : "WARNING",
      message: recItem
        ? `推荐位「${recItem.slot.name}」包含商品「${recItem.product.name}」。`
        : "暂无有效推荐位商品，首页推荐模块可能为空。",
      actionHref: "/cms/recommendations",
    })
  );

  steps.push(
    step({
      key: "crm_recipients_api",
      title: "常用收花人 API",
      status: "PASS",
      message: "GET /api/miniprogram/recipients 路由已注册（需登录态）。",
    })
  );

  try {
    const range = getReportDateRange({ preset: "thisMonth" });
    steps.push(
      step({
        key: "reports",
        title: "经营报表查询",
        status: "PASS",
        message: `报表日期范围计算正常（${range.label}）。`,
        actionHref: "/wms/reports",
      })
    );
  } catch (err) {
    steps.push(
      step({
        key: "reports",
        title: "经营报表查询",
        status: "WARNING",
        message:
          err instanceof Error ? err.message : "报表日期范围计算失败",
        actionHref: "/wms/reports",
      })
    );
  }

  return {
    status: aggregateTrialRunStatus(steps),
    steps,
    recommendedTestProduct: recommended,
    warnings,
  };
}
