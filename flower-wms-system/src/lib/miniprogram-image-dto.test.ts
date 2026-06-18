/**
 * 小程序商品 mapper 图片 DTO 测试
 * Run: npm run test:miniprogram-image-dto
 */
import assert from "node:assert/strict";
import { Prisma } from "@/generated/prisma/client";
import {
  isBareOssObjectKeyForMiniprogram,
  isMiniprogramPublicImageUrl,
  toMiniprogramImageUrl,
  toMiniprogramImageUrlList,
  toMiniprogramImageUrlOrEmpty,
} from "@/lib/miniprogram-image-dto";
import {
  mapSpuToWechatListItem,
  resolveBannerImagesFromSkus,
} from "@/lib/wechat-product-mapper";
import type { ProductSpuWithRelations } from "@/lib/product-spu";
import { imageUrlFormatter } from "@/utils/imageUrlFormatter";

process.env.ENABLE_LEGACY_UPLOADS = "false";
process.env.BLOCK_LOCALHOST_IMAGE_URL = "true";
process.env.ALIYUN_OSS_PUBLIC_BASE_URL = "https://oss.universe42.studio";
process.env.ALIYUN_OSS_OBJECT_PREFIX = "universe42";

const SKU_KEY = "universe42/products/sku/test-sku.webp";
const SPU_KEY = "universe42/products/spu/test-spu.webp";
const EXPECTED = `https://oss.universe42.studio/${SKU_KEY}`;

function buildSpu(): ProductSpuWithRelations {
  return {
    id: "spu-1",
    name: "测试花束",
    description: "desc",
    maintenanceGuide: null,
    isActive: true,
    isDeleted: false,
    shippingFee: new Prisma.Decimal(0),
    allowPreOrder: false,
    productionTime: 0,
    occasionTags: [],
    colorTags: [],
    styleTags: [],
    relationshipTags: [],
    budgetTags: [],
    positioningTags: [],
    sellingPoints: [],
    operationNote: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    categories: [],
    skus: [
      {
        id: "sku-1",
        spuId: "spu-1",
        skuCode: "SKU001",
        specName: "标准款",
        price: new Prisma.Decimal(368),
        stock: 5,
        isActive: true,
        isMainImage: true,
        imageUrl: SKU_KEY,
        description: null,
        bulkPreorderEnabled: false,
        bulkOrderThreshold: null,
        bulkMinLeadDays: null,
        bulkPreorderMessage: null,
        recipeId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  } as ProductSpuWithRelations;
}

function testHelpers() {
  assert.equal(toMiniprogramImageUrl(SKU_KEY), EXPECTED);
  assert.equal(toMiniprogramImageUrlOrEmpty(SKU_KEY), EXPECTED);
  assert.deepEqual(toMiniprogramImageUrlList([SKU_KEY, SPU_KEY]), [
    EXPECTED,
    `https://oss.universe42.studio/${SPU_KEY}`,
  ]);
  assert.equal(toMiniprogramImageUrl("/uploads/a.jpg"), null);
  assert.equal(toMiniprogramImageUrl("http://localhost:3000/uploads/a.jpg"), null);
  assert.equal(
    toMiniprogramImageUrl(`https://oss.universe42.studio/${SKU_KEY}`),
    EXPECTED
  );
  assert.equal(isBareOssObjectKeyForMiniprogram(SKU_KEY), true);
  assert.equal(isMiniprogramPublicImageUrl(EXPECTED), true);
  assert.equal(
    isMiniprogramPublicImageUrl(
      "https://www.universe42.studio/universe42/products/sku/x.webp"
    ),
    false
  );
}

function testProductMapper() {
  const item = mapSpuToWechatListItem(buildSpu());
  assert.equal(item.imageUrl, EXPECTED);
  assert.equal(item.mainImageUrl, EXPECTED);
  assert.ok(item.images.every((u) => isMiniprogramPublicImageUrl(u)));
  assert.equal(item.skus[0]?.imageUrl, EXPECTED);
  assert.ok(!isBareOssObjectKeyForMiniprogram(item.imageUrl));
}

function testFormatterCoverImageAndBannerImages() {
  const out = imageUrlFormatter({
    list: [{ coverImage: SKU_KEY }],
    bannerImages: [SPU_KEY],
    scene: { iconKey: "birthday" },
  }) as {
    list: Array<{ coverImage: string }>;
    bannerImages: string[];
    scene: { iconKey: string };
  };
  assert.equal(out.list[0].coverImage, EXPECTED);
  assert.equal(
    out.bannerImages[0],
    `https://oss.universe42.studio/${SPU_KEY}`
  );
  assert.equal(out.scene.iconKey, "birthday");
}

function testBannerImagesFromSkus() {
  const urls = resolveBannerImagesFromSkus([
    {
      id: "s1",
      skuCode: "A",
      specName: "A",
      displaySpecName: "",
      price: "1",
      stock: 1,
      hasStock: true,
      lowStock: false,
      description: null,
      imageUrl: SKU_KEY,
      isMainImage: true,
      bulkPreorderRule: {
        enabled: false,
        threshold: null,
        minLeadDays: null,
        message: null,
      },
    },
  ]);
  assert.deepEqual(urls, [EXPECTED]);
}

function run() {
  testHelpers();
  testProductMapper();
  testFormatterCoverImageAndBannerImages();
  testBannerImagesFromSkus();
  console.log("miniprogram-image-dto tests passed");
}

run();
