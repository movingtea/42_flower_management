/**
 * 将数据库中 localhost / 127.0.0.1 图片 URL 转为 /uploads/... 相对路径。
 * 默认 dry-run；执行写库：npx tsx scripts/fix-localhost-image-urls.ts --write
 */
import { prisma } from "../src/lib/prisma";
import {
  normalizeStoredImagePath,
  normalizeStoredImagePathRequired,
} from "../src/lib/image-url";
import {
  HOME_POPUP_KEY,
  parseHomePopupValue,
  type HomePopupConfig,
} from "../src/lib/app-marketing";
import {
  HOME_BANNER_KEY,
  parseHomeBannerValue,
  type HomeBannerItem,
} from "../src/lib/home-banner";

type Change = {
  model: string;
  id: string;
  field: string;
  oldValue: string;
  newValue: string;
};

const write = process.argv.includes("--write");

function planChange(
  changes: Change[],
  model: string,
  id: string,
  field: string,
  oldValue: string | null | undefined
) {
  if (!oldValue?.trim()) return;
  const next = normalizeStoredImagePath(oldValue);
  if (!next || next === oldValue) return;
  changes.push({ model, id, field, oldValue, newValue: next });
}

async function main() {
  const changes: Change[] = [];

  const skus = await prisma.productSku.findMany({
    where: { imageUrl: { not: null } },
    select: { id: true, imageUrl: true },
  });
  for (const row of skus) {
    planChange(changes, "ProductSku", row.id, "imageUrl", row.imageUrl);
  }

  const banners = await prisma.banner.findMany({
    select: { id: true, imageUrl: true },
  });
  for (const row of banners) {
    planChange(changes, "Banner", row.id, "imageUrl", row.imageUrl);
  }

  const recItems = await prisma.cmsRecommendationItem.findMany({
    where: { imageOverride: { not: null } },
    select: { id: true, imageOverride: true },
  });
  for (const row of recItems) {
    planChange(
      changes,
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
    planChange(changes, "ProductCategory", row.id, "imageUrl", row.imageUrl);
  }

  const users = await prisma.user.findMany({
    where: { avatarUrl: { not: null } },
    select: { id: true, avatarUrl: true },
  });
  for (const row of users) {
    planChange(changes, "User", row.id, "avatarUrl", row.avatarUrl);
  }

  const configs = await prisma.appConfig.findMany({
    where: { key: { in: [HOME_POPUP_KEY, HOME_BANNER_KEY] } },
    select: { id: true, key: true, value: true },
  });

  const configUpdates: Array<{
    id: string;
    key: string;
    value: HomePopupConfig | HomeBannerItem[];
  }> = [];

  for (const row of configs) {
    if (row.key === HOME_POPUP_KEY) {
      const popup = parseHomePopupValue(row.value);
      const nextUrl = normalizeStoredImagePathRequired(popup.imageUrl);
      if (nextUrl !== popup.imageUrl) {
        changes.push({
          model: "AppConfig",
          id: row.id,
          field: "value.imageUrl",
          oldValue: popup.imageUrl,
          newValue: nextUrl,
        });
        configUpdates.push({
          id: row.id,
          key: row.key,
          value: { ...popup, imageUrl: nextUrl },
        });
      }
    }

    if (row.key === HOME_BANNER_KEY) {
      const items = parseHomeBannerValue(row.value);
      let mutated = false;
      const nextItems = items.map((item) => {
        const nextUrl = normalizeStoredImagePathRequired(item.imageUrl);
        if (nextUrl !== item.imageUrl) {
          mutated = true;
          changes.push({
            model: "AppConfig",
            id: `${row.id}:${item.id}`,
            field: "value[].imageUrl",
            oldValue: item.imageUrl,
            newValue: nextUrl,
          });
          return { ...item, imageUrl: nextUrl };
        }
        return item;
      });
      if (mutated) {
        configUpdates.push({ id: row.id, key: row.key, value: nextItems });
      }
    }
  }

  console.log(
    write
      ? `将更新 ${changes.length} 条记录：`
      : `[dry-run] 将更新 ${changes.length} 条记录（加 --write 执行）：`
  );

  for (const c of changes) {
    console.log(
      `- ${c.model} id=${c.id} field=${c.field}\n  old: ${c.oldValue}\n  new: ${c.newValue}\n`
    );
  }

  if (!write || changes.length === 0) {
    if (!write && changes.length > 0) {
      console.log("\n未写库。确认后执行：npx tsx scripts/fix-localhost-image-urls.ts --write");
    }
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const c of changes) {
      if (c.model === "ProductSku") {
        await tx.productSku.update({
          where: { id: c.id },
          data: { imageUrl: c.newValue },
        });
      } else if (c.model === "Banner") {
        await tx.banner.update({
          where: { id: c.id },
          data: { imageUrl: c.newValue },
        });
      } else if (c.model === "CmsRecommendationItem") {
        await tx.cmsRecommendationItem.update({
          where: { id: c.id },
          data: { imageOverride: c.newValue },
        });
      } else if (c.model === "ProductCategory") {
        await tx.productCategory.update({
          where: { id: c.id },
          data: { imageUrl: c.newValue },
        });
      } else if (c.model === "User") {
        await tx.user.update({
          where: { id: c.id },
          data: { avatarUrl: c.newValue },
        });
      }
    }

    for (const u of configUpdates) {
      await tx.appConfig.update({
        where: { id: u.id },
        data: { value: u.value as object },
      });
    }
  });

  console.log("\n写库完成。");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
