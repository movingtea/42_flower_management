/**
 * 以「会落人肩膀的小鸟」为母本，复制生成 10 个测试 SPU（各含 2 个 SKU）。
 * 运行：npm run seed:test-products
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { generateUniqueSku } from "../src/utils/skuGenerator";

const SOURCE_NAME_KEY = "会落人肩膀的小鸟";
const TEST_NAME_PREFIX = "会落人肩膀的小鸟 (测试 ";

async function main() {
  const source = await prisma.productSpu.findFirst({
    where: {
      isDeleted: false,
      name: { contains: SOURCE_NAME_KEY },
      NOT: { name: { contains: "(测试" } },
    },
    include: {
      skus: { orderBy: { sortOrder: "asc" } },
      categories: true,
    },
    orderBy: { createdAt: "asc" },
  });

  if (!source) {
    throw new Error(
      `未找到母本商品（名称包含「${SOURCE_NAME_KEY}」）。请先在 CMS 创建该商品。`
    );
  }

  if (source.skus.length < 1) {
    throw new Error("母本商品至少需要一个 SKU 款式。");
  }

  const templateSkus =
    source.skus.length >= 2
      ? source.skus.slice(0, 2)
      : [source.skus[0], source.skus[0]];

  const categoryIds = source.categories.map((c) => c.productCategoryId);

  let created = 0;
  let skipped = 0;

  for (let i = 1; i <= 10; i++) {
    const name = `${TEST_NAME_PREFIX}${i})`;

    const exists = await prisma.productSpu.findFirst({
      where: { name, isDeleted: false },
      select: { id: true },
    });

    if (exists) {
      skipped += 1;
      console.log(`跳过（已存在）：${name}`);
      continue;
    }

    await prisma.$transaction(async (tx) => {
      const spu = await tx.productSpu.create({
        data: {
          name,
          description: source.description,
          maintenanceGuide: source.maintenanceGuide,
          isActive: true,
          isDeleted: false,
          shippingFee: source.shippingFee,
          allowPreOrder: source.allowPreOrder,
          productionTime: source.productionTime,
        },
      });

      if (categoryIds.length > 0) {
        await tx.productCategoryRelation.createMany({
          data: categoryIds.map((productCategoryId) => ({
            spuId: spu.id,
            productCategoryId,
          })),
          skipDuplicates: true,
        });
      }

      for (let j = 0; j < 2; j++) {
        const template = templateSkus[j];
        const skuCode = await generateUniqueSku("productSku", tx);
        const basePrice = Number(template.price);
        const priceOffset = i * 3 + j * 8;

        await tx.productSku.create({
          data: {
            spuId: spu.id,
            skuCode,
            specName:
              j === 0
                ? template.specName
                : `${template.specName}·测试${i}`,
            price: (basePrice + priceOffset).toFixed(2),
            stock: Math.max(1, template.stock + 5 + i),
            imageUrl: template.imageUrl,
            isMainImage: j === 0,
            sortOrder: j * 10,
          },
        });
      }
    });

    created += 1;
    console.log(`已创建：${name}`);
  }

  console.log(`\n完成：新建 ${created} 个，跳过 ${skipped} 个。母本 ID：${source.id}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
