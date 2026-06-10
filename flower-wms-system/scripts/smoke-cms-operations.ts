/**
 * CMS 商品运营 smoke（需要 DATABASE_URL 且已 migrate）
 * Run: npm run smoke:cms-operations
 */
import assert from "node:assert/strict";
import { GiftOccasionType, RecommendationSlotType } from "../src/generated/prisma/enums";
import { prisma } from "../src/lib/prisma";
import {
  addRecommendationItem,
  createRecommendationSlot,
  listActiveRecommendationsForMiniProgram,
  validateProductForPublish,
} from "../src/services/cms-product-operations";

const PREFIX = "CMS_OPS_SMOKE";

async function main() {
  const existing = await prisma.productSpu.findFirst({
    where: { isDeleted: false },
    include: { skus: true },
    orderBy: { createdAt: "asc" },
  });

  let productId = existing?.id;
  let createdProduct = false;

  if (!productId) {
    const spu = await prisma.productSpu.create({
      data: {
        name: `${PREFIX} 测试商品`,
        isActive: false,
        occasionTags: [GiftOccasionType.BIRTHDAY],
        colorTags: ["PINK"],
        styleTags: ["KOREAN"],
        relationshipTags: ["FRIEND"],
        budgetTags: ["BUDGET_268_398"],
        positioningTags: ["TEST_PRODUCT"],
        sellingPoints: ["新鲜直达"],
        skus: {
          create: {
            skuCode: `${PREFIX}_SKU_${Date.now()}`,
            specName: "标准款",
            price: 368,
            stock: 5,
            isMainImage: true,
            imageUrl: "https://example.com/smoke.jpg",
          },
        },
      },
      include: { skus: true },
    });
    productId = spu.id;
    createdProduct = true;
  } else {
    await prisma.productSpu.update({
      where: { id: productId },
      data: {
        occasionTags: [GiftOccasionType.BIRTHDAY],
        colorTags: ["PINK"],
        positioningTags: ["TEST_PRODUCT"],
        sellingPoints: ["运营 smoke 测试"],
      },
    });
  }

  assert.ok(productId, "需要测试商品");

  const readiness = await validateProductForPublish(productId);
  assert.ok(readiness);
  assert.equal(typeof readiness.score, "number");

  const slotKey = `${PREFIX}_slot_${Date.now()}`;
  const slot = await createRecommendationSlot({
    key: slotKey,
    name: "Smoke 推荐位",
    slotType: RecommendationSlotType.SCENE,
    sceneType: GiftOccasionType.BIRTHDAY,
    sortOrder: 999,
  });

  const addResult = await addRecommendationItem(slot.id, {
    productId,
    sortOrder: 1,
  });
  assert.ok(addResult.item.id);
  assert.ok(Array.isArray(addResult.warnings));

  const inactiveProduct = await prisma.productSpu.create({
    data: {
      name: `${PREFIX} 未上架商品`,
      isActive: false,
      occasionTags: [GiftOccasionType.BIRTHDAY],
      skus: {
        create: {
          skuCode: `${PREFIX}_INACTIVE_${Date.now()}`,
          specName: "款",
          price: 199,
          stock: 1,
          isMainImage: true,
          imageUrl: "https://example.com/inactive.jpg",
        },
      },
    },
  });

  await addRecommendationItem(slot.id, {
    productId: inactiveProduct.id,
    sortOrder: 2,
  });

  await prisma.productSpu.update({
    where: { id: productId },
    data: { isActive: true },
  });

  const activeRecs = await listActiveRecommendationsForMiniProgram({
    slotKey,
    limit: 10,
  });

  const targetSlot = activeRecs.slots.find((s) => s.key === slotKey);
  assert.ok(targetSlot, "应返回推荐位");
  assert.ok(
    targetSlot.items.every((item) => item.productId !== inactiveProduct.id),
    "未上架商品不应出现在小程序推荐位"
  );

  await prisma.cmsRecommendationItem.updateMany({
    where: { slotId: slot.id },
    data: { isActive: false },
  });
  await prisma.cmsRecommendationSlot.update({
    where: { id: slot.id },
    data: { isActive: false },
  });

  if (createdProduct) {
    await prisma.productSpu.update({
      where: { id: productId },
      data: { isDeleted: true, isActive: false },
    });
  }

  await prisma.productSpu.update({
    where: { id: inactiveProduct.id },
    data: { isDeleted: true },
  });

  console.log("smoke-cms-operations passed");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
