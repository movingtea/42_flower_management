import assert from "node:assert/strict";
import type { Prisma } from "../../generated/prisma-v2/client";
import {
  createMaterialCategory,
  deleteMaterialCategory,
  setMaterialCategoryActive,
  updateMaterialCategory,
  type MaterialCategoryScope,
} from "./material-category";

/**
 * Run with: npx tsx src/v2/services/material-category.test.ts
 *
 * Stub-based service test: no database, no Prisma client. It covers validation,
 * tenant scoping, every audit action and the "cannot delete a linked category"
 * guard that the UI depends on.
 */
type CategoryRow = {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string | null;
  active: boolean;
  sortOrder: number;
};

type AuditRow = {
  tenantId: string;
  storeId: string | null;
  actorStaffId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  beforeSnapshot?: unknown;
  afterSnapshot?: unknown;
};

type FakeDb = {
  categories: CategoryRow[];
  relations: { categoryId: string; materialId: string }[];
  audits: AuditRow[];
  sequence: number;
  tx: Prisma.TransactionClient;
};

function createFakeDb(seed: CategoryRow[] = []): FakeDb {
  let sequence = 0;
  const db: Omit<FakeDb, "tx"> = {
    categories: seed.map((row) => ({ ...row })),
    relations: [],
    audits: [],
    sequence,
  };
  const tx = {
    materialCategory: {
      findFirst: async ({ where }: { where: { id: string; tenantId: string } }) =>
        db.categories.find((row) => row.id === where.id && row.tenantId === where.tenantId) ?? null,
      create: async ({ data }: { data: Omit<CategoryRow, "id"> }) => {
        sequence += 1;
        db.sequence = sequence;
        const row: CategoryRow = { id: `category-${sequence}`, ...data };
        db.categories.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<CategoryRow> }) => {
        const index = db.categories.findIndex((item) => item.id === where.id);
        assert.notEqual(index, -1, `category ${where.id} must exist`);
        // Prisma returns a fresh row; replacing (not mutating) keeps a loaded
        // `current` snapshot intact for before/after audit assertions.
        const row: CategoryRow = { ...db.categories[index]!, ...data };
        db.categories[index] = row;
        return row;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const index = db.categories.findIndex((item) => item.id === where.id);
        assert.notEqual(index, -1, `category ${where.id} must exist`);
        return db.categories.splice(index, 1)[0]!;
      },
    },
    materialCategoryRelation: {
      count: async ({ where }: { where: { categoryId: string } }) =>
        db.relations.filter((relation) => relation.categoryId === where.categoryId).length,
    },
    auditEvent: {
      create: async ({ data }: { data: AuditRow }) => {
        db.audits.push(data);
        return data;
      },
    },
  } as unknown as Prisma.TransactionClient;
  return { ...db, tx };
}

const scope: MaterialCategoryScope = {
  tenantId: "tenant-1",
  storeId: "store-1",
  actorStaffId: "staff-1",
};

const otherScope: MaterialCategoryScope = {
  tenantId: "tenant-2",
  storeId: "store-2",
  actorStaffId: "staff-2",
};

function seededCategory(overrides: Partial<CategoryRow> = {}): CategoryRow {
  return {
    id: "category-seed",
    tenantId: "tenant-1",
    code: "MC-SEED",
    name: "花材",
    description: "鲜花类",
    active: true,
    sortOrder: 10,
    ...overrides,
  };
}

async function main(): Promise<void> {
  // 1. Required name, max lengths and integer sortOrder.
  {
    const db = createFakeDb();
    await assert.rejects(
      createMaterialCategory(db.tx, scope, { name: "   " }),
      /分类名称必填/,
    );
    await assert.rejects(
      createMaterialCategory(db.tx, scope, { name: "分".repeat(41) }),
      /分类名称不能超过 40 个字符/,
    );
    await assert.rejects(
      createMaterialCategory(db.tx, scope, { name: "花材", description: "说".repeat(501) }),
      /分类说明不能超过 500 个字符/,
    );
    await assert.rejects(
      createMaterialCategory(db.tx, scope, { name: "花材", sortOrder: 1.5 }),
      /排序值必须为整数/,
    );
    assert.equal(db.categories.length, 0, "invalid input must not create rows");
    assert.equal(db.audits.length, 0, "invalid input must not audit");
  }

  // 2. Create generates a stable internal code and audits the creation.
  {
    const db = createFakeDb();
    const created = await createMaterialCategory(db.tx, scope, {
      name: "  花材  ",
      description: "  鲜花与配叶  ",
      sortOrder: "3",
    });
    assert.match(created.code, /^MC-\d+[A-F0-9]{8}$/);
    assert.equal(created.name, "花材");
    assert.equal(created.description, "鲜花与配叶");
    assert.equal(created.sortOrder, 3);
    assert.equal(created.active, true);
    assert.equal(db.categories.length, 1);
    assert.equal(db.categories[0]?.tenantId, "tenant-1");
    assert.deepEqual(
      db.audits.map((row) => row.action),
      ["MATERIAL_CATEGORY_CREATED"],
    );
    assert.equal(db.audits[0]?.entityType, "MaterialCategory");
    assert.equal(db.audits[0]?.entityId, created.id);
    assert.equal(db.audits[0]?.storeId, "store-1");
    assert.equal(db.audits[0]?.actorStaffId, "staff-1");
  }

  // 3. Explicit inactive create and a unique code per category.
  {
    const db = createFakeDb();
    const first = await createMaterialCategory(db.tx, scope, { name: "包装", active: false });
    const second = await createMaterialCategory(db.tx, scope, { name: "耗材", active: false });
    assert.equal(first.active, false);
    assert.notEqual(first.code, second.code);
  }

  // 4. Update keeps the code and audits before/after business fields.
  {
    const db = createFakeDb([seededCategory()]);
    const updated = await updateMaterialCategory(db.tx, scope, "category-seed", {
      name: "  鲜切花  ",
      description: "",
      sortOrder: -2,
    });
    assert.equal(updated.code, "MC-SEED");
    assert.equal(updated.name, "鲜切花");
    assert.equal(updated.description, null);
    assert.equal(updated.sortOrder, -2);
    assert.equal(db.audits.length, 1);
    assert.equal(db.audits[0]?.action, "MATERIAL_CATEGORY_UPDATED");
    assert.deepEqual(db.audits[0]?.beforeSnapshot, {
      name: "花材",
      description: "鲜花类",
      sortOrder: 10,
    });
    assert.deepEqual(db.audits[0]?.afterSnapshot, {
      name: "鲜切花",
      description: null,
      sortOrder: -2,
    });
  }

  // 5. Tenant scoping: another tenant cannot update or activate this category.
  {
    const db = createFakeDb([seededCategory()]);
    await assert.rejects(
      updateMaterialCategory(db.tx, otherScope, "category-seed", { name: "越权" }),
      /分类不存在或不属于当前租户/,
    );
    await assert.rejects(
      setMaterialCategoryActive(db.tx, otherScope, "category-seed", false),
      /分类不存在或不属于当前租户/,
    );
    assert.equal(db.categories[0]?.name, "花材");
    assert.equal(db.audits.length, 0);
  }

  // 6. Activate/deactivate audit exactly once; repeating the same state is a no-op.
  {
    const db = createFakeDb([seededCategory()]);
    const disabled = await setMaterialCategoryActive(db.tx, scope, "category-seed", false);
    assert.equal(disabled.active, false);
    assert.deepEqual(db.audits.map((row) => row.action), ["MATERIAL_CATEGORY_DEACTIVATED"]);

    const stillDisabled = await setMaterialCategoryActive(db.tx, scope, "category-seed", false);
    assert.equal(stillDisabled.active, false);
    assert.equal(db.audits.length, 1, "same state must not add another audit");

    const enabled = await setMaterialCategoryActive(db.tx, scope, "category-seed", true);
    assert.equal(enabled.active, true);
    assert.deepEqual(db.audits.map((row) => row.action), [
      "MATERIAL_CATEGORY_DEACTIVATED",
      "MATERIAL_CATEGORY_ACTIVATED",
    ]);
  }

  // 7. Linked categories cannot be deleted; the error is user-facing Chinese.
  {
    const db = createFakeDb([seededCategory()]);
    db.relations.push({ categoryId: "category-seed", materialId: "material-1" });
    await assert.rejects(
      deleteMaterialCategory(db.tx, scope, "category-seed"),
      /该分类仍关联 1 个物料，不能删除；请先调整物料分类/,
    );
    assert.equal(db.categories.length, 1, "linked category must remain");
    assert.equal(db.audits.length, 0, "rejected delete must not audit");
  }

  // 8. An unlinked category can be deleted and the delete is audited.
  {
    const db = createFakeDb([seededCategory()]);
    await deleteMaterialCategory(db.tx, scope, "category-seed");
    assert.equal(db.categories.length, 0);
    assert.deepEqual(db.audits.map((row) => row.action), ["MATERIAL_CATEGORY_DELETED"]);
    assert.equal(db.audits[0]?.entityId, "category-seed");
    assert.deepEqual(db.audits[0]?.beforeSnapshot, {
      code: "MC-SEED",
      name: "花材",
      description: "鲜花类",
      sortOrder: 10,
      active: true,
    });
  }

  // 9. Empty scope is rejected before touching data.
  {
    const db = createFakeDb();
    await assert.rejects(
      createMaterialCategory(db.tx, { tenantId: "", storeId: "store-1", actorStaffId: "staff-1" }, { name: "花材" }),
      /缺少租户、门店或操作员工信息/,
    );
    assert.equal(db.categories.length, 0);
  }

  console.log("v2 material category service tests passed");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
