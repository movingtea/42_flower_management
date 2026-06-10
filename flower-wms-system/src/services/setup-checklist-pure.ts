export type CheckStatus = "PASS" | "WARNING" | "CRITICAL" | "NOT_STARTED";
export type CheckSeverity = "info" | "warning" | "critical" | "success";

export type SetupChecklistItem = {
  key: string;
  title: string;
  status: CheckStatus;
  severity: CheckSeverity;
  message: string;
  actionLabel?: string;
  actionHref?: string;
  metrics?: Record<string, number | string | boolean>;
};

export type SetupChecklistSection = {
  key: string;
  title: string;
  status: CheckStatus;
  items: SetupChecklistItem[];
};

export type SetupChecklistSummary = {
  totalItems: number;
  passedCount: number;
  warningCount: number;
  criticalCount: number;
  completionRate: number;
};

export type SetupChecklistStats = {
  flowerWikiTotal: number;
  flowerWikiWithCost: number;
  flowerWikiWithUsableRate: number;
  supplierActiveCount: number;
  packagingKitActiveCount: number;
  recipeCount: number;
  recipeWithoutLines: number;
  recipeWithoutPackaging: number;
  activeProductCount: number;
  activeProductWithoutSku: number;
  activeSkuWithoutRecipe: number;
  activeSkuWithoutImage: number;
  activeProductWithoutOccasionTags: number;
  activeProductWithoutCategory: number;
  homeMainSlotItemCount: number;
  sceneSlotCount: number;
  sceneSlotEmptyCount: number;
  homeSceneEntryActiveCount: number;
  homeSceneUsingFallback: boolean;
  localhostImageCount: number;
  orderTotalCount: number;
  paidOrderCount: number;
  paidOrderWithoutSnapshot: number;
  miniprogramProductCount: number;
  miniprogramCategoryCount: number;
};

export type SetupChecklistResult = {
  summary: SetupChecklistSummary;
  sections: SetupChecklistSection[];
  nextActions: Array<{
    title: string;
    actionHref: string;
    severity: CheckSeverity;
  }>;
};

function worstStatus(statuses: CheckStatus[]): CheckStatus {
  if (statuses.includes("CRITICAL")) return "CRITICAL";
  if (statuses.includes("NOT_STARTED")) return "NOT_STARTED";
  if (statuses.includes("WARNING")) return "WARNING";
  return "PASS";
}

function item(
  partial: SetupChecklistItem
): SetupChecklistItem {
  return partial;
}

function pct(n: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((n / total) * 100);
}

export function buildSetupChecklist(
  stats: SetupChecklistStats
): SetupChecklistResult {
  const sections: SetupChecklistSection[] = [];

  const wikiItems: SetupChecklistItem[] = [];

  if (stats.flowerWikiTotal === 0) {
    wikiItems.push(
      item({
        key: "flower_wiki_count",
        title: "花材母表",
        status: "NOT_STARTED",
        severity: "critical",
        message: "尚未录入花材，请先维护 FlowerWiki。",
        actionLabel: "去维护花材",
        actionHref: "/wms/wiki",
        metrics: { total: 0 },
      })
    );
  } else {
    const costRate = pct(stats.flowerWikiWithCost, stats.flowerWikiTotal);
    const usableRate = pct(stats.flowerWikiWithUsableRate, stats.flowerWikiTotal);
    wikiItems.push(
      item({
        key: "flower_wiki_count",
        title: "花材数量",
        status: stats.flowerWikiTotal >= 20 ? "PASS" : "WARNING",
        severity: stats.flowerWikiTotal >= 20 ? "success" : "warning",
        message:
          stats.flowerWikiTotal >= 20
            ? `已录入 ${stats.flowerWikiTotal} 个花材。`
            : `当前 ${stats.flowerWikiTotal} 个花材，建议至少 20 个再试运营。`,
        actionHref: "/wms/wiki",
        metrics: { total: stats.flowerWikiTotal },
      }),
      item({
        key: "flower_wiki_cost",
        title: "标准成本覆盖率",
        status: costRate >= 80 ? "PASS" : "WARNING",
        severity: costRate >= 80 ? "success" : "warning",
        message: `${costRate}% 花材已维护 standardUnitCost（${stats.flowerWikiWithCost}/${stats.flowerWikiTotal}）。`,
        actionHref: "/wms/wiki",
        metrics: { costRate },
      }),
      item({
        key: "flower_wiki_usable_rate",
        title: "可用率 / 损耗率",
        status: usableRate >= 80 ? "PASS" : "WARNING",
        severity: usableRate >= 80 ? "success" : "warning",
        message: `${usableRate}% 花材已维护可用率或损耗率字段。`,
        actionHref: "/wms/wiki",
        metrics: { usableRate },
      })
    );
  }

  sections.push({
    key: "flower_wiki",
    title: "花材与成本基础",
    status: worstStatus(wikiItems.map((i) => i.status)),
    items: wikiItems,
  });

  const supplierItems: SetupChecklistItem[] = [
    item({
      key: "supplier_active",
      title: "活跃供应商",
      status:
        stats.supplierActiveCount === 0
          ? "CRITICAL"
          : stats.supplierActiveCount >= 2
            ? "PASS"
            : "WARNING",
      severity:
        stats.supplierActiveCount === 0
          ? "critical"
          : stats.supplierActiveCount >= 2
            ? "success"
            : "warning",
      message:
        stats.supplierActiveCount === 0
          ? "没有可用供应商，无法创建采购单。"
          : stats.supplierActiveCount >= 2
            ? `已有 ${stats.supplierActiveCount} 个活跃供应商。`
            : `仅有 ${stats.supplierActiveCount} 个活跃供应商，建议至少 2 个。`,
      actionLabel: "管理供应商",
      actionHref: "/wms/suppliers",
      metrics: { active: stats.supplierActiveCount },
    }),
  ];

  sections.push({
    key: "supplier",
    title: "供应商",
    status: worstStatus(supplierItems.map((i) => i.status)),
    items: supplierItems,
  });

  const packagingItems: SetupChecklistItem[] = [
    item({
      key: "packaging_kit",
      title: "包装方案",
      status:
        stats.packagingKitActiveCount === 0
          ? "CRITICAL"
          : stats.packagingKitActiveCount >= 3
            ? "PASS"
            : "WARNING",
      severity:
        stats.packagingKitActiveCount === 0 ? "critical" : "warning",
      message:
        stats.packagingKitActiveCount === 0
          ? "没有活跃包装方案，Recipe 成本预估可能不完整。"
          : stats.packagingKitActiveCount >= 3
            ? `已有 ${stats.packagingKitActiveCount} 个包装方案。`
            : `当前 ${stats.packagingKitActiveCount} 个包装方案，建议至少 3 个。`,
      actionHref: "/wms/packaging-kits",
      metrics: { active: stats.packagingKitActiveCount },
    }),
  ];

  sections.push({
    key: "packaging",
    title: "包装方案",
    status: worstStatus(packagingItems.map((i) => i.status)),
    items: packagingItems,
  });

  const recipeItems: SetupChecklistItem[] = [
    item({
      key: "recipe_count",
      title: "标准配方数量",
      status:
        stats.recipeCount >= 3
          ? "PASS"
          : stats.recipeCount === 0
            ? "NOT_STARTED"
            : "WARNING",
      severity: stats.recipeCount >= 3 ? "success" : "warning",
      message:
        stats.recipeCount >= 3
          ? `已有 ${stats.recipeCount} 个 Recipe。`
          : stats.recipeCount === 0
            ? "尚未创建 Recipe。"
            : `当前 ${stats.recipeCount} 个 Recipe，建议至少 3 个。`,
      actionHref: "/wms/recipes",
      metrics: { total: stats.recipeCount },
    }),
    item({
      key: "recipe_lines",
      title: "配方明细完整",
      status: stats.recipeWithoutLines === 0 ? "PASS" : "WARNING",
      severity: stats.recipeWithoutLines === 0 ? "success" : "warning",
      message:
        stats.recipeWithoutLines === 0
          ? "所有 Recipe 至少有一条 RecipeLine。"
          : `${stats.recipeWithoutLines} 个 Recipe 缺少配方行。`,
      actionHref: "/wms/recipes",
      metrics: { withoutLines: stats.recipeWithoutLines },
    }),
    item({
      key: "recipe_packaging",
      title: "配方绑定包装",
      status: stats.recipeWithoutPackaging === 0 ? "PASS" : "WARNING",
      severity: "warning",
      message:
        stats.recipeWithoutPackaging === 0
          ? "所有 Recipe 已绑定 PackagingKit。"
          : `${stats.recipeWithoutPackaging} 个 Recipe 未绑定 PackagingKit。`,
      actionHref: "/wms/recipes",
      metrics: { withoutPackaging: stats.recipeWithoutPackaging },
    }),
  ];

  sections.push({
    key: "recipe",
    title: "标准配方",
    status: worstStatus(recipeItems.map((i) => i.status)),
    items: recipeItems,
  });

  const productItems: SetupChecklistItem[] = [
    item({
      key: "cms_active_products",
      title: "已上架商品",
      status:
        stats.activeProductCount >= 3
          ? "PASS"
          : stats.activeProductCount === 0
            ? "NOT_STARTED"
            : "WARNING",
      severity: stats.activeProductCount >= 3 ? "success" : "warning",
      message:
        stats.activeProductCount >= 3
          ? `已有 ${stats.activeProductCount} 个已上架商品。`
          : stats.activeProductCount === 0
            ? "尚无已上架商品。"
            : `当前 ${stats.activeProductCount} 个已上架商品，建议至少 3 个。`,
      actionHref: "/cms/products",
      metrics: { active: stats.activeProductCount },
    }),
    item({
      key: "cms_sku_recipe",
      title: "SKU 绑定 Recipe",
      status: stats.activeSkuWithoutRecipe === 0 ? "PASS" : "WARNING",
      severity: stats.activeSkuWithoutRecipe === 0 ? "success" : "warning",
      message:
        stats.activeSkuWithoutRecipe === 0
          ? "已上架 SKU 均已绑定 Recipe。"
          : `${stats.activeSkuWithoutRecipe} 个已上架 SKU 未绑定 Recipe。`,
      actionHref: "/cms/products",
      metrics: { withoutRecipe: stats.activeSkuWithoutRecipe },
    }),
    item({
      key: "cms_product_image",
      title: "商品主图",
      status: stats.activeSkuWithoutImage === 0 ? "PASS" : "WARNING",
      severity: "warning",
      message:
        stats.activeSkuWithoutImage === 0
          ? "已上架商品均有主图。"
          : `${stats.activeSkuWithoutImage} 个已上架 SKU 缺少图片。`,
      actionHref: "/cms/products",
      metrics: { withoutImage: stats.activeSkuWithoutImage },
    }),
    item({
      key: "cms_occasion_tags",
      title: "场景标签",
      status: stats.activeProductWithoutOccasionTags === 0 ? "PASS" : "WARNING",
      severity: "warning",
      message:
        stats.activeProductWithoutOccasionTags === 0
          ? "已上架商品均已配置场景标签。"
          : `${stats.activeProductWithoutOccasionTags} 个已上架商品缺少 occasionTags。`,
      actionHref: "/cms/products",
      metrics: { withoutTags: stats.activeProductWithoutOccasionTags },
    }),
  ];

  sections.push({
    key: "cms_product",
    title: "CMS 商品",
    status: worstStatus(productItems.map((i) => i.status)),
    items: productItems,
  });

  const recItems: SetupChecklistItem[] = [
    item({
      key: "rec_home_main",
      title: "首页主推推荐位",
      status: stats.homeMainSlotItemCount > 0 ? "PASS" : "WARNING",
      severity: stats.homeMainSlotItemCount > 0 ? "success" : "warning",
      message:
        stats.homeMainSlotItemCount > 0
          ? `HOME_MAIN 推荐位有 ${stats.homeMainSlotItemCount} 个商品。`
          : "HOME_MAIN 推荐位暂无商品，小程序首页主推区可能为空。",
      actionHref: "/cms/recommendations",
      metrics: { items: stats.homeMainSlotItemCount },
    }),
    item({
      key: "rec_scene",
      title: "场景推荐位",
      status: stats.sceneSlotCount > 0 ? "PASS" : "WARNING",
      severity: "warning",
      message:
        stats.sceneSlotCount > 0
          ? `已有 ${stats.sceneSlotCount} 个 SCENE/FESTIVAL 推荐位，${stats.sceneSlotEmptyCount} 个为空。`
          : "建议至少配置 1 个场景推荐位。",
      actionHref: "/cms/recommendations",
      metrics: {
        slots: stats.sceneSlotCount,
        empty: stats.sceneSlotEmptyCount,
      },
    }),
  ];

  sections.push({
    key: "cms_recommendation",
    title: "CMS 推荐位",
    status: worstStatus(recItems.map((i) => i.status)),
    items: recItems,
  });

  const sceneItems: SetupChecklistItem[] = [
    item({
      key: "home_scene_entries",
      title: "首页场景入口",
      status: stats.homeSceneUsingFallback
        ? "WARNING"
        : stats.homeSceneEntryActiveCount >= 6
          ? "PASS"
          : stats.homeSceneEntryActiveCount > 0
            ? "WARNING"
            : "WARNING",
      severity: "warning",
      message: stats.homeSceneUsingFallback
        ? "当前首页场景入口使用默认 fallback，建议在 CMS 中确认配置。"
        : stats.homeSceneEntryActiveCount >= 6
          ? `CMS 已配置 ${stats.homeSceneEntryActiveCount} 个 active 场景入口。`
          : `CMS 仅有 ${stats.homeSceneEntryActiveCount} 个 active 场景入口，建议至少 6 个。`,
      actionHref: "/cms/marketing",
      metrics: {
        active: stats.homeSceneEntryActiveCount,
        fallback: stats.homeSceneUsingFallback,
      },
    }),
  ];

  sections.push({
    key: "home_scene",
    title: "首页场景入口",
    status: worstStatus(sceneItems.map((i) => i.status)),
    items: sceneItems,
  });

  const mpItems: SetupChecklistItem[] = [
    item({
      key: "mp_products",
      title: "小程序商品 API",
      status: stats.miniprogramProductCount > 0 ? "PASS" : "WARNING",
      severity: stats.miniprogramProductCount > 0 ? "success" : "warning",
      message:
        stats.miniprogramProductCount > 0
          ? `小程序可见商品 ${stats.miniprogramProductCount} 个。`
          : "小程序商品列表为空，请检查上架状态。",
      metrics: { visible: stats.miniprogramProductCount },
    }),
    item({
      key: "mp_categories",
      title: "小程序分类 API",
      status: stats.miniprogramCategoryCount > 0 ? "PASS" : "WARNING",
      severity: "warning",
      message:
        stats.miniprogramCategoryCount > 0
          ? `商品分类 ${stats.miniprogramCategoryCount} 个。`
          : "商品分类为空，选花页可能无分类导航。",
      metrics: { categories: stats.miniprogramCategoryCount },
    }),
  ];

  sections.push({
    key: "miniprogram",
    title: "小程序 API",
    status: worstStatus(mpItems.map((i) => i.status)),
    items: mpItems,
  });

  const imageItems: SetupChecklistItem[] = [
    item({
      key: "localhost_images",
      title: "图片 URL 规范",
      status: stats.localhostImageCount === 0 ? "PASS" : "CRITICAL",
      severity: stats.localhostImageCount === 0 ? "success" : "critical",
      message:
        stats.localhostImageCount === 0
          ? "未发现 localhost / 127.0.0.1 图片 URL。"
          : `发现 ${stats.localhostImageCount} 处 localhost 图片 URL，请尽快修正。`,
      actionHref: "/cms/products",
      metrics: { localhostCount: stats.localhostImageCount },
    }),
  ];

  sections.push({
    key: "image_url",
    title: "图片路径",
    status: worstStatus(imageItems.map((i) => i.status)),
    items: imageItems,
  });

  const orderItems: SetupChecklistItem[] = [
    item({
      key: "test_orders",
      title: "测试订单",
      status: stats.orderTotalCount > 0 ? "PASS" : "WARNING",
      severity: stats.orderTotalCount > 0 ? "success" : "info",
      message:
        stats.orderTotalCount > 0
          ? `系统已有 ${stats.orderTotalCount} 笔订单，其中 ${stats.paidOrderCount} 笔已支付。`
          : "尚无订单，建议完成一笔测试订单验证链路。",
      actionHref: "/wms/orders",
      metrics: {
        total: stats.orderTotalCount,
        paid: stats.paidOrderCount,
      },
    }),
    item({
      key: "cost_snapshot",
      title: "订单成本快照",
      status:
        stats.paidOrderWithoutSnapshot === 0
          ? "PASS"
          : stats.paidOrderCount === 0
            ? "WARNING"
            : "CRITICAL",
      severity:
        stats.paidOrderWithoutSnapshot === 0 ? "success" : "critical",
      message:
        stats.paidOrderCount === 0
          ? "尚无已支付订单，无法验证成本快照。"
          : stats.paidOrderWithoutSnapshot === 0
            ? "所有已支付订单均有 OrderCostSnapshot。"
            : `${stats.paidOrderWithoutSnapshot} 笔已支付订单缺少成本快照。`,
      actionHref: "/wms/reports",
      metrics: {
        missing: stats.paidOrderWithoutSnapshot,
        paid: stats.paidOrderCount,
      },
    }),
  ];

  sections.push({
    key: "orders",
    title: "订单与报表",
    status: worstStatus(orderItems.map((i) => i.status)),
    items: orderItems,
  });

  const allItems = sections.flatMap((s) => s.items);
  const passedCount = allItems.filter((i) => i.status === "PASS").length;
  const warningCount = allItems.filter((i) => i.status === "WARNING").length;
  const criticalCount = allItems.filter(
    (i) => i.status === "CRITICAL" || i.status === "NOT_STARTED"
  ).length;

  const nextActions = allItems
    .filter((i) => i.status !== "PASS" && i.actionHref)
    .sort((a, b) => {
      const rank = (s: CheckStatus) =>
        s === "CRITICAL" || s === "NOT_STARTED"
          ? 0
          : s === "WARNING"
            ? 1
            : 2;
      return rank(a.status) - rank(b.status);
    })
    .slice(0, 5)
    .map((i) => ({
      title: i.title,
      actionHref: i.actionHref!,
      severity: i.severity,
    }));

  return {
    summary: {
      totalItems: allItems.length,
      passedCount,
      warningCount,
      criticalCount,
      completionRate:
        allItems.length === 0
          ? 0
          : Math.round((passedCount / allItems.length) * 100),
    },
    sections,
    nextActions,
  };
}

export function computeSetupCompletionRate(
  passed: number,
  total: number
): number {
  if (total <= 0) return 0;
  return Math.round((passed / total) * 100);
}
