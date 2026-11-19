import assert from "node:assert/strict";
import { resolve } from "node:path";
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  MaterialKind,
  PrismaClient,
  SampleState,
} from "../../generated/prisma-v2/client";
import {
  copySample,
  estimateSampleCost,
  saveSample,
  setSampleState,
  type SampleScope,
} from "./sample-management";

config({ quiet: true });
config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const connectionString = process.env.V2_DATABASE_URL ?? process.env.DATABASE_URL;
const marker = crypto.randomUUID().slice(0, 8);

let tenantId: string | undefined;
let otherTenantId: string | undefined;

type Fixtures = {
  db: PrismaClient;
  scope: SampleScope;
  otherScope: SampleScope;
  flowerId: string;
  packagingId: string;
};

async function cleanup(db: PrismaClient): Promise<void> {
  const tenantIds = [tenantId, otherTenantId].filter((id): id is string => Boolean(id));
  if (tenantIds.length === 0) return;
  const tenants = { tenantId: { in: tenantIds } };
  await db.auditEvent.deleteMany({ where: tenants });
  await db.sampleMaterial.deleteMany({ where: { sample: tenants } });
  await db.sample.deleteMany({ where: tenants });
  await db.material.deleteMany({ where: tenants });
  await db.store.deleteMany({ where: tenants });
  await db.tenant.deleteMany({ where: { id: { in: tenantIds } } });
}

async function createFixtures(db: PrismaClient): Promise<Fixtures> {
  const tenant = await db.tenant.create({
    data: { slug: `sprint4-sample-${marker}`, name: "Sprint 4 样品测试租户" },
  });
  tenantId = tenant.id;
  const store = await db.store.create({
    data: { tenantId, code: "MAIN", name: "Sprint 4 样品测试店" },
  });
  const otherTenant = await db.tenant.create({
    data: { slug: `sprint4-sample-other-${marker}`, name: "Sprint 4 其他租户" },
  });
  otherTenantId = otherTenant.id;
  const otherStore = await db.store.create({
    data: { tenantId: otherTenantId, code: "MAIN", name: "Sprint 4 其他店" },
  });

  const flower = await db.material.create({
    data: {
      tenantId,
      code: `S4-ROSE-${marker}`,
      name: "Sprint 4 红玫瑰",
      kind: MaterialKind.FLOWER,
      color: "红",
      grade: "A",
      baseUnit: "支",
      quantityScale: 0,
      standardUnitCost: "2.0000",
      standardUsableRate: "0.5000",
      active: true,
    },
  });
  const packaging = await db.material.create({
    data: {
      tenantId,
      code: `S4-WRAP-${marker}`,
      name: "Sprint 4 包装纸",
      kind: MaterialKind.PACKAGING,
      baseUnit: "张",
      quantityScale: 0,
      standardUnitCost: "5.0000",
      active: true,
    },
  });

  return {
    db,
    scope: { tenantId, storeId: store.id, actorStaffId: "staff-sample-test" },
    otherScope: {
      tenantId: otherTenantId,
      storeId: otherStore.id,
      actorStaffId: "staff-sample-other-test",
    },
    flowerId: flower.id,
    packagingId: packaging.id,
  };
}

async function run(): Promise<void> {
  if (!connectionString) {
    console.log("v2 sample management DB test skipped (no V2_DATABASE_URL/DATABASE_URL)");
    return;
  }
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const fixtures = await createFixtures(db);
    const { scope, otherScope, flowerId, packagingId } = fixtures;
    const create = (input: Parameters<typeof saveSample>[2], useScope = scope) =>
      db.$transaction((tx) => saveSample(tx, useScope, input));
    const copy = (sampleId: string, useScope = scope) =>
      db.$transaction((tx) => copySample(tx, useScope, sampleId));
    const setState = (sampleId: string, state: SampleState) =>
      db.$transaction((tx) => setSampleState(tx, scope, sampleId, state));
    const cost = (sampleId: string) =>
      db.$transaction((tx) => estimateSampleCost(tx, scope, sampleId));

    await assert.rejects(
      create({ name: "  ", materials: [] }),
      /样品名称必填/,
    );
    await assert.rejects(
      create({ name: "重复物料", materials: [
        { materialId: flowerId, quantity: 1 },
        { materialId: flowerId, quantity: 2 },
      ] }),
      /重复/,
    );
    await assert.rejects(
      create({ name: "零用量", materials: [{ materialId: flowerId, quantity: 0 }] }),
      /必须大于零/,
    );
    await assert.rejects(
      create({ name: "坏毛利率", targetMarginRate: 1, materials: [{ materialId: flowerId, quantity: 1 }] }),
      /小于 1/,
    );

    const created = await create({
      name: "  Sprint 4 花香样品  ",
      description: "  花材搭配测试  ",
      priority: 3,
      targetMarginRate: 0.5,
      materials: [
        { materialId: flowerId, quantity: 10 },
        { materialId: packagingId, quantity: 2 },
      ],
    });
    assert.match(created.code, /^SMP-\d{8}-/);
    assert.equal(created.state, SampleState.DRAFT);
    assert.equal(created.versionNo, 1);

    const stored = await db.sample.findUniqueOrThrow({
      where: { id: created.id },
      include: { materials: true },
    });
    assert.equal(stored.name, "Sprint 4 花香样品");
    assert.equal(stored.description, "花材搭配测试");
    assert.equal(stored.priority, 3);
    assert.equal(stored.materials.length, 2);

    const costEstimate = await cost(created.id);
    assert.equal(costEstimate.materialCost, 20);
    assert.equal(costEstimate.packagingCost, 10);
    assert.equal(costEstimate.totalCost, 30);
    assert.equal(costEstimate.suggestedPrice, 60);
    assert.equal(costEstimate.lines.length, 2);

    const updated = await create({
      id: created.id,
      name: "Sprint 4 花香样品（改）",
      description: "第二次版本",
      priority: 4,
      targetMarginRate: 0.4,
      state: SampleState.DRAFT,
      materials: [
        { materialId: flowerId, quantity: 8 },
        { materialId: packagingId, quantity: 3 },
      ],
    });
    assert.equal(updated.versionNo, 2);
    const versions = await db.auditEvent.findMany({
      where: { tenantId: scope.tenantId, entityType: "Sample", entityId: created.id },
      orderBy: { occurredAt: "asc" },
    });
    assert.equal(versions.length, 2);

    const ready = await setState(created.id, SampleState.READY);
    assert.equal(ready.state, SampleState.READY);

    const copied = await copy(created.id);
    assert.notEqual(copied.id, created.id);
    assert.notEqual(copied.code, created.code);
    assert.equal(copied.state, SampleState.DRAFT);
    const copiedMaterials = await db.sampleMaterial.findMany({ where: { sampleId: copied.id } });
    assert.equal(copiedMaterials.length, 2);
    await assert.rejects(copy(created.id, otherScope), /样品不存在/);

    const archived = await setState(created.id, SampleState.ARCHIVED);
    assert.equal(archived.state, SampleState.ARCHIVED);
    await assert.rejects(
      create({
        id: created.id,
        name: "已归档不可编辑",
        materials: [{ materialId: flowerId, quantity: 1 }],
      }),
      /已归档/,
    );

    console.log("v2 sample management DB tests passed");
  } finally {
    try {
      await cleanup(db);
    } catch (error) {
      console.error("sample management cleanup failed", error);
      process.exitCode = 1;
    }
    await db.$disconnect();
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
