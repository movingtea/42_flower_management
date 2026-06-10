/**
 * 扫描数据库中含 localhost / 127.0.0.1 的图片字段（只读，不写库）。
 * Run: npx tsx scripts/check-image-url-data.ts
 */
import { prisma } from "../src/lib/prisma";
import { isLocalhostUrl } from "../src/lib/image-url";
import {
  HOME_POPUP_KEY,
  parseHomePopupValue,
} from "../src/lib/app-marketing";
import {
  HOME_BANNER_KEY,
  parseHomeBannerValue,
} from "../src/lib/home-banner";

type Finding = {
  model: string;
  id: string;
  field: string;
  value: string;
};

function maybePush(
  findings: Finding[],
  model: string,
  id: string,
  field: string,
  value: string | null | undefined
) {
  if (!value?.trim()) return;
  if (!isLocalhostUrl(value)) return;
  findings.push({ model, id, field, value });
}

async function main() {
  const findings: Finding[] = [];

  const skus = await prisma.productSku.findMany({
    where: { imageUrl: { not: null } },
    select: { id: true, imageUrl: true },
  });
  for (const row of skus) {
    maybePush(findings, "ProductSku", row.id, "imageUrl", row.imageUrl);
  }

  const banners = await prisma.banner.findMany({
    select: { id: true, imageUrl: true },
  });
  for (const row of banners) {
    maybePush(findings, "Banner", row.id, "imageUrl", row.imageUrl);
  }

  const recItems = await prisma.cmsRecommendationItem.findMany({
    where: { imageOverride: { not: null } },
    select: { id: true, imageOverride: true },
  });
  for (const row of recItems) {
    maybePush(
      findings,
      "CmsRecommendationItem",
      row.id,
      "imageOverride",
      row.imageOverride
    );
  }

  const categories = await prisma.productCategory.findMany({
    where: { imageUrl: { not: null } },
    select: { id: true, imageUrl: true },
  });
  for (const row of categories) {
    maybePush(findings, "ProductCategory", row.id, "imageUrl", row.imageUrl);
  }

  const users = await prisma.user.findMany({
    where: { avatarUrl: { not: null } },
    select: { id: true, avatarUrl: true },
  });
  for (const row of users) {
    maybePush(findings, "User", row.id, "avatarUrl", row.avatarUrl);
  }

  const configs = await prisma.appConfig.findMany({
    where: { key: { in: [HOME_POPUP_KEY, HOME_BANNER_KEY] } },
    select: { id: true, key: true, value: true },
  });

  for (const row of configs) {
    if (row.key === HOME_POPUP_KEY) {
      const popup = parseHomePopupValue(row.value);
      maybePush(findings, "AppConfig", row.id, "value.imageUrl", popup.imageUrl);
    }
    if (row.key === HOME_BANNER_KEY) {
      const items = parseHomeBannerValue(row.value);
      for (const item of items) {
        maybePush(
          findings,
          "AppConfig",
          `${row.id}:${item.id}`,
          "value[].imageUrl",
          item.imageUrl
        );
      }
    }
  }

  if (findings.length === 0) {
    console.log("未发现含 localhost / 127.0.0.1 的图片 URL。");
    return;
  }

  console.log(`发现 ${findings.length} 条可疑图片 URL：\n`);
  for (const f of findings) {
    console.log(
      `- ${f.model} id=${f.id} field=${f.field}\n  ${f.value}\n`
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
