"use client";

import Image from "next/image";
import {
  getCmsProductTagLabel,
  toTagDisplayList,
} from "@/lib/cms-product-tags";
import type { ProductOperationTagsValue } from "@/components/cms/ProductOperationTagsEditor";

type SkuPreview = {
  specName: string;
  price: string;
  imageUrl: string;
  isMainImage: boolean;
};

type Props = {
  name: string;
  description: string;
  maintenanceGuide: string;
  tags: ProductOperationTagsValue;
  skus: SkuPreview[];
};

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function ProductMiniProgramPreview({
  name,
  description,
  maintenanceGuide,
  tags,
  skus,
}: Props) {
  const mainSku =
    skus.find((s) => s.isMainImage && s.imageUrl) ??
    skus.find((s) => s.imageUrl) ??
    skus[0];

  const cover = mainSku?.imageUrl?.trim() ?? "";
  const prices = skus
    .map((s) => Number(s.price))
    .filter((n) => Number.isFinite(n) && n > 0);
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const maxPrice = prices.length ? Math.max(...prices) : 0;
  const priceLabel =
    prices.length === 0
      ? "¥0.00"
      : minPrice === maxPrice
        ? `¥${minPrice.toFixed(2)}`
        : `¥${minPrice.toFixed(2)} - ¥${maxPrice.toFixed(2)}`;

  const occasionLabels = toTagDisplayList("occasion", tags.occasionTags).slice(
    0,
    3
  );
  const positioningLabels = toTagDisplayList(
    "positioning",
    tags.positioningTags
  ).slice(0, 2);
  const colorLabels = toTagDisplayList("color", tags.colorTags).slice(0, 2);
  const styleLabels = toTagDisplayList("style", tags.styleTags).slice(0, 2);
  const sellingPoint = tags.sellingPoints[0] ?? "";

  const story = stripHtml(maintenanceGuide || description);
  const hints: string[] = [];
  if (name.length > 18) hints.push("商品名较长，可能影响小程序列表展示。");
  if (
    tags.occasionTags.length + tags.positioningTags.length > 4
  ) {
    hints.push("标签较多，前台建议只展示前 2–3 个。");
  }
  if (!cover) hints.push("缺少主图，小程序将显示占位。");

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-200 bg-gradient-to-b from-rose-50/50 to-white p-4">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-rose-400">
          小程序商品卡片预览
        </p>
        <div className="mx-auto max-w-xs overflow-hidden rounded-2xl border border-zinc-100 bg-white shadow-sm">
          <div className="relative aspect-[4/5] bg-zinc-100">
            {cover ? (
              <Image
                src={cover}
                alt={name}
                fill
                className="object-cover"
                unoptimized
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-zinc-400">
                暂无主图
              </div>
            )}
          </div>
          <div className="space-y-2 p-3">
            <p className="line-clamp-2 font-medium text-zinc-900">{name}</p>
            {sellingPoint ? (
              <p className="text-xs text-zinc-500">{sellingPoint}</p>
            ) : null}
            <div className="flex flex-wrap gap-1">
              {occasionLabels.map((t) => (
                <span
                  key={t.key}
                  className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] text-rose-700"
                >
                  {t.label}
                </span>
              ))}
              {positioningLabels.map((t) => (
                <span
                  key={t.key}
                  className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] text-violet-700"
                >
                  {t.label}
                </span>
              ))}
            </div>
            <p className="text-base font-semibold text-rose-700">{priceLabel}</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-400">
          详情基础预览
        </p>
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-zinc-500">适用场景</dt>
            <dd className="text-zinc-800">
              {occasionLabels.length
                ? occasionLabels.map((t) => t.label).join("、")
                : "尚未配置"}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">色系 / 风格</dt>
            <dd className="text-zinc-800">
              {[...colorLabels, ...styleLabels].map((t) => t.label).join("、") ||
                "—"}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">适合关系</dt>
            <dd className="text-zinc-800">
              {tags.relationshipTags
                .map((k) => getCmsProductTagLabel("relationship", k))
                .join("、") || "—"}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">SKU 价格</dt>
            <dd className="text-zinc-800">
              {skus.length
                ? skus
                    .map((s) => `${s.specName} ¥${s.price}`)
                    .join(" · ")
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">商品摘要</dt>
            <dd className="line-clamp-3 text-zinc-700">
              {story || "暂无详情文案"}
            </dd>
          </div>
        </dl>
      </div>

      {hints.length > 0 ? (
        <ul className="space-y-1 text-xs text-amber-700">
          {hints.map((h) => (
            <li key={h}>· {h}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
