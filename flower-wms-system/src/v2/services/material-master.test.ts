import assert from "node:assert/strict";
import { config } from "dotenv";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { MaterialKind, PrismaClient } from "../../generated/prisma-v2/client";
import {
  createMaterialMaster,
  createSupplierMaster,
  deleteMaterial,
  setMaterialActive,
  updateMaterialMaster,
  updateMaterialStandardCost,
} from "./master-data";
import {
  createMaterialCategory,
  deleteMaterialCategory,
  setMaterialCategoryActive,
  updateMaterialCategory,
} from "./material-category";

/**
 * Run with the project's managed test database:
 *   npx tsx src/v2/services/material-master.test.ts
 *
 * Business Sprint 1 integration: the unified V1 FlowerWiki/MasterPart fields and
 * material-category relation must persist through the real Prisma service, and
 * category deletion must protect linked materials.
 *
 * Material library parity (migration 0014): auto-generated codes, pinyin/alias
 * search index, default loss policy, delete-with-references guard and the inline
 * standard-cost edit are covered here as well.
 */

config({ quiet: true });
config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const connectionString = process.env.V2_DATABASE_URL ?? process.env.DATABASE_URL;
const marker = crypto.randomUUID().slice(0, 8).toUpperCase();

async function runDatabaseTest(): Promise<void> {
  if (!connectionString) {
    console.log("v2 material master DB test skipped (no V2_DATABASE_URL/DATABASE_URL)");
    return;
  }
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const tenant = await db.tenant.create({
      data: { slug: `sprint1-material-${marker.toLowerCase()}`, name: "物料主数据测试租户" },
    });
    const otherTenant = await db.tenant.create({
      data: { slug: `sprint1-material-other-${marker.toLowerCase()}`, name: "物料主数据他租户" },
    });
    const store = await db.store.create({
      data: { tenantId: tenant.id, code: "MAIN", name: "物料主数据测试店" },
    });
    const otherStore = await db.store.create({
      data: { tenantId: otherTenant.id, code: "MAIN", name: "物料主数据他租户店" },
    });
    const scope = { tenantId: tenant.id, storeId: store.id, actorStaffId: "staff-material-test" };
    const otherScope = {
      tenantId: otherTenant.id,
      storeId: otherStore.id,
      actorStaffId: "staff-material-other-test",
    };

    const category = await db.$transaction((tx) =>
      createMaterialCategory(tx, scope, {
        name: "花材",
        description: "V1 原材料分类",
        sortOrder: 10,
      }),
    );
    const otherCategory = await db.$transaction((tx) =>
      createMaterialCategory(tx, otherScope, { name: "他租户分类" }),
    );
    assert.match(category.code, /^MC-\d+[A-F0-9]{8}$/);

    const careDocument = {
      v: 1,
      careTable: [
        { key: "wakeWater", label: "醒花水位", value: "需要深水醒花" },
        { key: "frequency", label: "换水频率", value: "每2天换水" },
      ],
    };
    const created = await db.$transaction((tx) =>
      createMaterialMaster(tx, scope, {
        code: `MAT-${marker}`,
        name: "测试玫瑰",
        kind: MaterialKind.FLOWER,
        color: "红",
        grade: "A",
        gradeSpecification: "40-50cm",
        specification: "单头",
        baseUnit: "支",
        quantityScale: 0,
        reservePerOrder: true,
        englishName: "Rosa hybrida / Rose",
        flowerLanguage: "热烈的爱",
        maintenance: "醒花水位：需要深水醒花\n换水频率：每2天换水",
        maintenanceCare: careDocument,
        supplySeason: "全年",
        defaultShelfLifeDays: 7,
        standardUnitCost: "12.5000",
        costUnit: "支",
        costNote: "近 30 天均价",
        optimisticUsableRate: "0.9200",
        standardUsableRate: "0.8500",
        conservativeUsableRate: "0.7500",
        lossRateNote: "夏季偏高",
        brand: "测试品牌",
        model: "M-1",
        notes: "统一物料备注",
        safetyStockThreshold: "3.500",
        categoryIds: [category.id],
        floralRole: "MAIN",
        colorTags: ["红", "深红", "红"],
        morphology: "花头饱满、花瓣层叠、茎粗直",
        aliasMap: { zh: ["月季", "刺玫"], en: ["Rose"] },
        defaultUsableRate: "0.8800",
        defaultLossRate: "0.1200",
        lossMode: "OPTIMISTIC",
      }),
    );

    const loaded = await db.material.findUniqueOrThrow({
      where: { id: created.id },
      include: { categories: true },
    });
    assert.equal(loaded.englishName, "Rosa hybrida / Rose");
    assert.equal(loaded.flowerLanguage, "热烈的爱");
    assert.deepEqual(loaded.maintenanceCare, careDocument);
    assert.equal(loaded.supplySeason, "全年");
    assert.equal(loaded.defaultShelfLifeDays, 7);
    assert.equal(Number(loaded.standardUnitCost), 12.5);
    assert.equal(loaded.costUnit, "支");
    assert.equal(loaded.costNote, "近 30 天均价");
    assert.equal(Number(loaded.optimisticUsableRate), 0.92);
    assert.equal(Number(loaded.standardUsableRate), 0.85);
    assert.equal(Number(loaded.conservativeUsableRate), 0.75);
    assert.equal(loaded.lossRateNote, "夏季偏高");
    assert.equal(loaded.brand, "测试品牌");
    assert.equal(loaded.model, "M-1");
    assert.equal(loaded.notes, "统一物料备注");
    assert.equal(Number(loaded.safetyStockThreshold), 3.5);
    assert.deepEqual(loaded.categories.map((row) => row.categoryId), [category.id]);

    // Parity fields: explicit code kept, search index generated, loss policy stored.
    assert.equal(loaded.code, `MAT-${marker}`);
    assert.equal(loaded.pinyinIndex, "csmg");
    assert.equal(loaded.aliasText, "月季,刺玫,Rose");
    assert.deepEqual(loaded.aliasMap, { zh: ["月季", "刺玫"], en: ["Rose"] });
    assert.equal(loaded.floralRole, "MAIN");
    assert.deepEqual(loaded.colorTags, ["红", "深红"]);
    assert.equal(loaded.morphology, "花头饱满、花瓣层叠、茎粗直");
    assert.equal(Number(loaded.defaultUsableRate), 0.88);
    assert.equal(Number(loaded.defaultLossRate), 0.12);
    assert.equal(loaded.lossMode, "OPTIMISTIC");
    assert.ok(loaded.lossRateUpdatedAt instanceof Date);
    assert.ok(loaded.costUpdatedAt instanceof Date);

    // Cross-tenant category ids are rejected before any write.
    await assert.rejects(
      db.$transaction((tx) =>
        updateMaterialMaster(tx, scope, created.id, {
          code: loaded.code,
          name: loaded.name,
          kind: loaded.kind,
          baseUnit: loaded.baseUnit,
          quantityScale: loaded.quantityScale,
          reservePerOrder: loaded.reservePerOrder,
          categoryIds: [otherCategory.id],
        }),
      ),
      /物料分类不存在或不属于当前租户/,
    );

    // Knowledge/master-part edits persist and categoryIds: [] clears the relation.
    // A submitted code is ignored on edit: the identifier never changes.
    const updated = await db.$transaction((tx) =>
      updateMaterialMaster(tx, scope, created.id, {
        code: "IGNORED-CODE",
        name: "测试玫瑰（更名）",
        kind: MaterialKind.FLOWER,
        baseUnit: "支",
        quantityScale: 0,
        reservePerOrder: true,
        englishName: "Rosa hybrida",
        flowerLanguage: "爱与美",
        maintenance: "每日换水",
        maintenanceCare: null,
        standardUnitCost: "13.2500",
        standardUsableRate: "0.8000",
        safetyStockThreshold: "4.000",
        categoryIds: [],
        floralRole: "FILLER",
        colorTags: ["香槟色"],
        aliasMap: { zh: ["月季"] },
        defaultUsableRate: "0.8000",
        defaultLossRate: "0.2000",
        lossMode: "CONSERVATIVE",
      }),
    );
    assert.equal(updated.name, "测试玫瑰（更名）");
    assert.equal(updated.code, loaded.code);
    assert.equal(updated.maintenanceCare, null);
    assert.equal(Number(updated.standardUnitCost), 13.25);
    assert.equal(Number(updated.standardUsableRate), 0.8);
    assert.equal(updated.pinyinIndex, "csmggm");
    assert.equal(updated.aliasText, "月季");
    assert.deepEqual(updated.aliasMap, { zh: ["月季"] });
    assert.equal(updated.floralRole, "FILLER");
    assert.deepEqual(updated.colorTags, ["香槟色"]);
    assert.equal(Number(updated.defaultUsableRate), 0.8);
    assert.equal(Number(updated.defaultLossRate), 0.2);
    assert.equal(updated.lossMode, "CONSERVATIVE");
    assert.ok(updated.costUpdatedAt instanceof Date);
    assert.ok(updated.lossRateUpdatedAt instanceof Date);
    assert.ok(
      updated.costUpdatedAt.getTime() >= loaded.costUpdatedAt.getTime(),
      "costUpdatedAt must move when the standard cost changes",
    );
    assert.equal(await db.materialCategoryRelation.count({ where: { categoryId: category.id } }), 0);

    // Category lifecycle still protects references and audits the transitions.
    const renamed = await db.$transaction((tx) =>
      updateMaterialCategory(tx, scope, category.id, {
        name: "鲜切花",
        description: "更新后的说明",
        sortOrder: 5,
      }),
    );
    assert.equal(renamed.name, "鲜切花");
    const disabled = await db.$transaction((tx) =>
      setMaterialCategoryActive(tx, scope, category.id, false),
    );
    assert.equal(disabled.active, false);
    await db.$transaction((tx) => deleteMaterialCategory(tx, scope, category.id));
    assert.equal(await db.materialCategory.count({ where: { id: category.id } }), 0);

    await db.$transaction((tx) => setMaterialActive(tx, scope, created.id, false));
    const inactive = await db.material.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(inactive.active, false);

    const auditActions = await db.auditEvent.findMany({
      where: { tenantId: tenant.id, entityId: created.id },
      select: { action: true },
    });
    assert.ok(auditActions.some((row) => row.action === "MATERIAL_CREATED"));
    assert.ok(auditActions.some((row) => row.action === "MATERIAL_UPDATED"));
    assert.ok(auditActions.some((row) => row.action === "MATERIAL_DEACTIVATED"));

    // ------------------------------------------------ auto codes + delete guard
    // A blank material code is generated by the service (MAT-YYYYMMDD-XXXXXXXX).
    const autoCoded = await db.$transaction((tx) =>
      createMaterialMaster(tx, scope, {
        name: "自动编号月季",
        kind: MaterialKind.FLOWER,
        baseUnit: "支",
        quantityScale: 0,
        reservePerOrder: true,
      }),
    );
    assert.match(autoCoded.code, /^MAT-\d{8}-[A-F0-9]{8}$/);
    assert.equal(autoCoded.pinyinIndex, "zdbhyj");
    assert.equal(autoCoded.aliasText, "");
    assert.deepEqual(autoCoded.aliasMap, {});
    assert.equal(autoCoded.lossMode, "STANDARD");
    assert.equal(autoCoded.lossRateUpdatedAt, null);
    assert.equal(autoCoded.costUpdatedAt, null);

    // No business reference → the material can be deleted and audited.
    const removed = await db.$transaction((tx) => deleteMaterial(tx, scope, autoCoded.id));
    assert.equal(removed.id, autoCoded.id);
    assert.equal(await db.material.count({ where: { id: autoCoded.id } }), 0);
    assert.ok(await db.auditEvent.findFirst({
      where: { tenantId: tenant.id, entityId: autoCoded.id, action: "MATERIAL_DELETED" },
    }));

    // One inventory batch is enough to block deletion with the documented message.
    const referenced = await db.$transaction((tx) =>
      createMaterialMaster(tx, scope, {
        name: "引用保护测试花",
        kind: MaterialKind.FLOWER,
        baseUnit: "支",
        quantityScale: 0,
        reservePerOrder: true,
      }),
    );
    await db.inventoryBatch.create({
      data: {
        storeId: store.id,
        materialId: referenced.id,
        batchNo: `B-${marker}`,
        unitCost: 1,
      },
    });
    await assert.rejects(
      db.$transaction((tx) => deleteMaterial(tx, scope, referenced.id)),
      /该物料已有业务引用，请改为停用/,
    );
    await db.inventoryBatch.deleteMany({ where: { materialId: referenced.id } });
    await db.$transaction((tx) => deleteMaterial(tx, scope, referenced.id));

    // A blank supplier code is generated the same way.
    const supplier = await db.$transaction((tx) =>
      createSupplierMaster(tx, scope, { name: "自动编号供应商" }),
    );
    assert.match(supplier.code, /^SUP-\d{8}-[A-F0-9]{8}$/);

    // Inline standard-cost edit updates the cost, its timestamp and the audit.
    const costUpdated = await db.$transaction((tx) =>
      updateMaterialStandardCost(tx, scope, created.id, "20.0000"),
    );
    assert.equal(Number(costUpdated.standardUnitCost), 20);
    assert.ok(costUpdated.costUpdatedAt instanceof Date);
    const costNoop = await db.$transaction((tx) =>
      updateMaterialStandardCost(tx, scope, created.id, "20.0000"),
    );
    assert.equal(Number(costNoop.standardUnitCost), 20);
    const costAudits = await db.auditEvent.count({
      where: { tenantId: tenant.id, entityId: created.id, action: "MATERIAL_COST_UPDATED" },
    });
    assert.equal(costAudits, 1);
    await assert.rejects(
      db.$transaction((tx) => updateMaterialStandardCost(tx, scope, created.id, "")),
      /标准单位成本必填/,
    );

    console.log("v2 material master knowledge/category DB tests passed");
  } finally {
    await db.$disconnect();
  }
}

runDatabaseTest().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
