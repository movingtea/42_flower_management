import assert from "node:assert/strict";
import { resolve } from "node:path";
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  MaterialKind,
  PrismaClient,
} from "../../generated/prisma-v2-draft/client";
import {
  savePackagingKit,
  setPackagingKitActive,
  type PackagingKitScope,
} from "./packaging-kit";

config({ quiet: true });
config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const connectionString = process.env.V2_DATABASE_URL ?? process.env.DATABASE_URL;
const marker = crypto.randomUUID().slice(0, 8);

let tenantId: string | undefined;
let otherTenantId: string | undefined;

type Fixtures = {
  db: PrismaClient;
  scope: PackagingKitScope;
  otherScope: PackagingKitScope;
  packagingMaterialId: string;
  consumableMaterialId: string;
  otherMaterialId: string;
  flowerMaterialId: string;
  inactivePackagingMaterialId: string;
  otherTenantMaterialId: string;
};

async function cleanup(db: PrismaClient): Promise<void> {
  const tenantIds = [tenantId, otherTenantId].filter(
    (id): id is string => Boolean(id),
  );
  if (tenantIds.length === 0) return;
  const tenants = { tenantId: { in: tenantIds } };
  await db.auditEvent.deleteMany({ where: tenants });
  await db.packagingKitLine.deleteMany({ where: { packagingKit: tenants } });
  await db.packagingKit.deleteMany({ where: tenants });
  await db.material.deleteMany({ where: tenants });
  await db.store.deleteMany({ where: tenants });
  await db.tenant.deleteMany({ where: { id: { in: tenantIds } } });
}

async function createFixtures(db: PrismaClient): Promise<Fixtures> {
  const tenant = await db.tenant.create({
    data: { slug: `phase1-packaging-kit-${marker}`, name: "Phase 1 包装方案测试租户" },
  });
  tenantId = tenant.id;
  const store = await db.store.create({
    data: { tenantId, code: "MAIN", name: "Phase 1 包装方案测试店" },
  });

  const otherTenant = await db.tenant.create({
    data: { slug: `phase1-packaging-kit-other-${marker}`, name: "Phase 1 包装方案其他租户" },
  });
  otherTenantId = otherTenant.id;
  const otherStore = await db.store.create({
    data: { tenantId: otherTenantId, code: "MAIN", name: "Phase 1 包装方案其他店" },
  });

  const packagingMaterial = await db.material.create({
    data: {
      tenantId,
      code: `PKG-BOX-${marker}`,
      name: "包装礼盒",
      kind: MaterialKind.PACKAGING,
      baseUnit: "个",
      quantityScale: 0,
      active: true,
    },
  });
  const consumableMaterial = await db.material.create({
    data: {
      tenantId,
      code: `PKG-METER-${marker}`,
      name: "包装丝带",
      kind: MaterialKind.CONSUMABLE,
      baseUnit: "米",
      quantityScale: 2,
      active: true,
    },
  });
  const otherMaterial = await db.material.create({
    data: {
      tenantId,
      code: `PKG-CARD-${marker}`,
      name: "包装卡片",
      kind: MaterialKind.OTHER,
      baseUnit: "张",
      quantityScale: 0,
      active: true,
    },
  });
  const flowerMaterial = await db.material.create({
    data: {
      tenantId,
      code: `PKG-FLOWER-${marker}`,
      name: "测试花材",
      kind: MaterialKind.FLOWER,
      baseUnit: "支",
      quantityScale: 1,
      active: true,
    },
  });
  const inactivePackagingMaterial = await db.material.create({
    data: {
      tenantId,
      code: `PKG-INACTIVE-${marker}`,
      name: "停用包装纸",
      kind: MaterialKind.PACKAGING,
      baseUnit: "张",
      quantityScale: 1,
      active: false,
    },
  });
  const otherTenantMaterial = await db.material.create({
    data: {
      tenantId: otherTenantId,
      code: `PKG-OTHER-${marker}`,
      name: "其他租户包装盒",
      kind: MaterialKind.PACKAGING,
      baseUnit: "个",
      quantityScale: 0,
      active: true,
    },
  });

  return {
    db,
    scope: { tenantId, storeId: store.id, actorStaffId: "staff-packaging-kit-test" },
    otherScope: {
      tenantId: otherTenantId,
      storeId: otherStore.id,
      actorStaffId: "staff-packaging-kit-other-test",
    },
    packagingMaterialId: packagingMaterial.id,
    consumableMaterialId: consumableMaterial.id,
    otherMaterialId: otherMaterial.id,
    flowerMaterialId: flowerMaterial.id,
    inactivePackagingMaterialId: inactivePackagingMaterial.id,
    otherTenantMaterialId: otherTenantMaterial.id,
  };
}

async function runDatabaseTest(): Promise<void> {
  if (!connectionString) {
    console.log("v2 packaging kit DB test skipped (no V2_DATABASE_URL/DATABASE_URL)");
    return;
  }

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const fixtures = await createFixtures(db);
    const {
      scope,
      otherScope,
      packagingMaterialId,
      consumableMaterialId,
      otherMaterialId,
      flowerMaterialId,
      inactivePackagingMaterialId,
      otherTenantMaterialId,
    } = fixtures;
    const baseCode = `KIT-${marker}`;

    const createKit = (
      input: Parameters<typeof savePackagingKit>[2],
      useScope: PackagingKitScope = scope,
    ) => db.$transaction((tx) => savePackagingKit(tx, useScope, input));

    const toggleKit = (id: string, active: boolean, useScope = scope) =>
      db.$transaction((tx) => setPackagingKitActive(tx, useScope, id, active));

    // Empty lines are rejected before any kit row is written.
    await assert.rejects(
      createKit({ code: baseCode, name: "空方案", lines: [] }),
      /至少需要一项物料/,
    );

    // Duplicate materials are rejected.
    await assert.rejects(
      createKit({
        code: baseCode,
        name: "重复物料方案",
        lines: [
          { materialId: packagingMaterialId, quantity: 1 },
          { materialId: packagingMaterialId, quantity: 2 },
        ],
      }),
      /不能重复/,
    );

    // Zero and negative quantities are rejected.
    await assert.rejects(
      createKit({
        code: baseCode,
        name: "零用量方案",
        lines: [{ materialId: packagingMaterialId, quantity: 0 }],
      }),
      /必须大于零/,
    );
    await assert.rejects(
      createKit({
        code: baseCode,
        name: "负用量方案",
        lines: [{ materialId: packagingMaterialId, quantity: -1 }],
      }),
      /必须大于零/,
    );

    // Quantity must match the material's quantityScale.
    await assert.rejects(
      createKit({
        code: baseCode,
        name: "精度不符方案",
        lines: [{ materialId: packagingMaterialId, quantity: 1.5 }],
      }),
      /不符合物料计量精度/,
    );

    // Only active PACKAGING/CONSUMABLE/OTHER materials from the same tenant are allowed.
    await assert.rejects(
      createKit({
        code: baseCode,
        name: "错误类别方案",
        lines: [{ materialId: flowerMaterialId, quantity: 1 }],
      }),
      /不存在、停用或非包装类物料/,
    );
    await assert.rejects(
      createKit({
        code: baseCode,
        name: "停用物料方案",
        lines: [{ materialId: inactivePackagingMaterialId, quantity: 1 }],
      }),
      /不存在、停用或非包装类物料/,
    );
    await assert.rejects(
      createKit({
        code: baseCode,
        name: "跨租户物料方案",
        lines: [{ materialId: otherTenantMaterialId, quantity: 1 }],
      }),
      /不存在、停用或非包装类物料/,
    );
    await assert.rejects(
      createKit({
        code: baseCode,
        name: "缺失物料方案",
        lines: [{ materialId: crypto.randomUUID(), quantity: 1 }],
      }),
      /不存在、停用或非包装类物料/,
    );

    // A valid kit can contain multiple allowed material kinds.
    const created = await createKit({
      code: baseCode,
      name: "开业礼盒包装方案",
      notes: "含礼盒、丝带和卡片",
      lines: [
        { materialId: packagingMaterialId, quantity: 1 },
        { materialId: consumableMaterialId, quantity: 2.25 },
        { materialId: otherMaterialId, quantity: 2 },
      ],
    });
    assert.equal(created.code, baseCode.toUpperCase());
    assert.equal(created.name, "开业礼盒包装方案");
    assert.equal(created.active, true);

    const createdWithLines = await db.packagingKit.findUniqueOrThrow({
      where: { id: created.id },
      include: { lines: true },
    });
    assert.equal(createdWithLines.lines.length, 3);
    const createdLine = createdWithLines.lines.find(
      (line) => line.materialId === consumableMaterialId,
    );
    assert.ok(createdLine);
    assert.equal(Number(createdLine.quantity), 2.25);

    const createAudit = await db.auditEvent.findFirst({
      where: {
        tenantId: scope.tenantId,
        action: "PACKAGING_KIT_CREATED",
        entityType: "PackagingKit",
        entityId: created.id,
      },
    });
    assert.ok(createAudit, "creating a packaging kit must write an audit row");

    // Code is unique per tenant.
    await assert.rejects(
      createKit({
        code: baseCode,
        name: "重复编码方案",
        lines: [{ materialId: packagingMaterialId, quantity: 1 }],
      }),
      /编码已存在/,
    );

    // The same code remains valid in another tenant.
    const otherTenantKit = await createKit(
      {
        code: baseCode,
        name: "其他租户同编码方案",
        lines: [{ materialId: otherTenantMaterialId, quantity: 1 }],
      },
      otherScope,
    );
    assert.notEqual(otherTenantKit.id, created.id);

    // Updating replaces lines and name while keeping the user-supplied code.
    const updated = await db.$transaction((tx) =>
      savePackagingKit(tx, scope, {
        id: created.id,
        code: baseCode,
        name: "开业礼盒包装方案（修订）",
        notes: "只保留礼盒和卡片",
        lines: [
          { materialId: packagingMaterialId, quantity: 2 },
          { materialId: otherMaterialId, quantity: 3 },
        ],
      }),
    );
    assert.equal(updated.name, "开业礼盒包装方案（修订）");
    assert.equal(updated.code, baseCode.toUpperCase());
    const updatedWithLines = await db.packagingKit.findUniqueOrThrow({
      where: { id: created.id },
      include: { lines: true },
    });
    assert.equal(updatedWithLines.lines.length, 2);
    assert.equal(
      updatedWithLines.lines.some((line) => line.materialId === consumableMaterialId),
      false,
    );
    const updatedLine = updatedWithLines.lines.find(
      (line) => line.materialId === packagingMaterialId,
    );
    assert.ok(updatedLine);
    assert.equal(Number(updatedLine.quantity), 2);
    const updateAudit = await db.auditEvent.findFirst({
      where: {
        tenantId: scope.tenantId,
        action: "PACKAGING_KIT_UPDATED",
        entityType: "PackagingKit",
        entityId: created.id,
      },
    });
    assert.ok(updateAudit, "updating a packaging kit must write an audit row");

    // The code is immutable after creation.
    await assert.rejects(
      db.$transaction((tx) =>
        savePackagingKit(tx, scope, {
          id: created.id,
          code: `${baseCode}-CHANGED`,
          name: "改名方案",
          lines: [{ materialId: packagingMaterialId, quantity: 1 }],
        }),
      ),
      /编码创建后不能修改/,
    );

    // Updates and toggles are tenant-isolated.
    await assert.rejects(
      db.$transaction((tx) =>
        savePackagingKit(tx, otherScope, {
          id: created.id,
          code: baseCode,
          name: "跨租户更新",
          lines: [{ materialId: otherTenantMaterialId, quantity: 1 }],
        }),
      ),
      /包装方案不存在/,
    );
    await assert.rejects(toggleKit(created.id, false, otherScope), /包装方案不存在/);
    await assert.rejects(toggleKit(crypto.randomUUID(), false), /包装方案不存在/);

    // Enable/disable persists the state and writes an audit row each time.
    const disabled = await toggleKit(created.id, false);
    assert.equal(disabled.active, false);
    assert.equal(
      (await db.packagingKit.findUniqueOrThrow({ where: { id: created.id } })).active,
      false,
    );
    const deactivateAudit = await db.auditEvent.findFirst({
      where: {
        tenantId: scope.tenantId,
        action: "PACKAGING_KIT_DEACTIVATED",
        entityType: "PackagingKit",
        entityId: created.id,
      },
    });
    assert.ok(deactivateAudit, "disabling a packaging kit must write an audit row");

    const enabled = await toggleKit(created.id, true);
    assert.equal(enabled.active, true);
    assert.equal(
      (await db.packagingKit.findUniqueOrThrow({ where: { id: created.id } })).active,
      true,
    );
    const activateAudit = await db.auditEvent.findFirst({
      where: {
        tenantId: scope.tenantId,
        action: "PACKAGING_KIT_ACTIVATED",
        entityType: "PackagingKit",
        entityId: created.id,
      },
    });
    assert.ok(activateAudit, "enabling a packaging kit must write an audit row");

    console.log("v2 packaging kit DB test passed");
  } finally {
    await cleanup(db);
    await db.$disconnect();
  }
}

runDatabaseTest().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
