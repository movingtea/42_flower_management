/**
 * 库存边界 smoke（需要 DATABASE_URL）
 * Run: npm run smoke:stock-boundary
 * Cleanup: 脚本创建的数据带 SMOKE_TEST_STOCK 前缀，可手动删除
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { MINIPROGRAM_ERROR_CODES } from "../src/lib/miniprogram-business-error";
import { prisma } from "../src/lib/prisma";
import { createWechatOrder } from "../src/services/order-lifecycle";
import { isMiniprogramBusinessError } from "../src/lib/miniprogram-business-error";

const PREFIX = "SMOKE_TEST_STOCK";

async function main() {
  const skuCode = `${PREFIX}_${Date.now()}`;
  const spu = await prisma.productSpu.create({
    data: {
      name: `${PREFIX} 边界商品`,
      isActive: true,
      skus: {
        create: {
          skuCode,
          specName: "标准款",
          price: 199,
          stock: 1,
          isMainImage: true,
          imageUrl: "https://example.com/smoke.jpg",
        },
      },
    },
    include: { skus: true },
  });
  const sku = spu.skus[0]!;

  const user = await prisma.user.create({
    data: {
      openId: `${PREFIX}_openid_${Date.now()}`,
      nickName: `${PREFIX}用户`,
    },
  });

  const beforeStock = sku.stock;
  const beforeActive = spu.isActive;

  let failed = false;
  try {
    await createWechatOrder(user.id, {
      receiverName: "测试",
      receiverPhone: "13800001111",
      deliveryAddress: "上海市测试路 1 号",
      deliveryDate: "2026-06-15 14:00",
      totalAmount: 398,
      deliveryFee: 15,
      payAmount: 413,
      items: [{ skuId: sku.id, quantity: 2 }],
    });
  } catch (err) {
    failed = true;
    assert.ok(isMiniprogramBusinessError(err));
    assert.equal(err.code, MINIPROGRAM_ERROR_CODES.INSUFFICIENT_STOCK);
  }

  assert.equal(failed, true, "应返回 INSUFFICIENT_STOCK");

  const orderCount = await prisma.order.count({
    where: { userId: user.id },
  });
  assert.equal(orderCount, 0, "不得创建订单");

  const afterSku = await prisma.productSku.findUniqueOrThrow({
    where: { id: sku.id },
  });
  const afterSpu = await prisma.productSpu.findUniqueOrThrow({
    where: { id: spu.id },
  });

  assert.equal(afterSku.stock, beforeStock, "不得扣 stock");
  assert.equal(afterSpu.isActive, beforeActive, "商品不得下架");

  const crmCount = await prisma.customer.count({
    where: { miniProgramUserId: user.id },
  });
  assert.equal(crmCount, 0, "订单创建失败不得写 CRM");

  console.log("smoke-stock-boundary passed", { skuId: sku.id, userId: user.id });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
