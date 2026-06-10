"use client";

import { Input } from "@/components/ui/input";
import { CMS_OCCASION_TAG_OPTIONS } from "@/lib/cms-product-tags";
import {
  CMS_LINK_TARGET_LABELS,
  CMS_LINK_TARGET_TYPES,
  type CmsLinkTarget,
  type CmsLinkTargetType,
} from "@/lib/cms-link-target";
import { CategoryPicker } from "@/components/cms/pickers/CategoryPicker";
import { ProductPicker } from "@/components/cms/pickers/ProductPicker";
import { RecommendationSlotPicker } from "@/components/cms/pickers/RecommendationSlotPicker";

type Props = {
  value: CmsLinkTarget;
  onChange: (target: CmsLinkTarget) => void;
  disabled?: boolean;
  label?: string;
  /** 是否展示优惠券（旧数据兼容） */
  showCoupon?: boolean;
};

export function CmsLinkTargetSelector({
  value,
  onChange,
  disabled,
  label = "跳转目标",
  showCoupon = false,
}: Props) {
  const types: CmsLinkTargetType[] = showCoupon
    ? [...CMS_LINK_TARGET_TYPES, "COUPON"]
    : CMS_LINK_TARGET_TYPES;

  function patch(partial: Partial<CmsLinkTarget>) {
    onChange({ ...value, ...partial });
  }

  function setType(targetType: CmsLinkTargetType) {
    onChange({
      targetType,
      productId: null,
      categoryId: null,
      sceneType: null,
      slotKey: null,
      customUrl: null,
      couponCode: null,
    });
  }

  return (
    <div className="space-y-4">
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-zinc-700">{label}</span>
        <select
          value={value.targetType}
          disabled={disabled}
          onChange={(e) => setType(e.target.value as CmsLinkTargetType)}
          className="w-full rounded-lg border border-zinc-200 px-3 py-2"
        >
          {types.map((t) => (
            <option key={t} value={t}>
              {CMS_LINK_TARGET_LABELS[t]}
            </option>
          ))}
        </select>
      </label>

      {value.targetType === "PRODUCT" ? (
        <ProductPicker
          value={value.productId ?? null}
          onChange={(productId) => patch({ productId })}
          disabled={disabled}
        />
      ) : null}

      {value.targetType === "CATEGORY" ? (
        <CategoryPicker
          value={value.categoryId ?? null}
          onChange={(categoryId) => patch({ categoryId })}
          disabled={disabled}
        />
      ) : null}

      {value.targetType === "SCENE" ? (
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-zinc-700">选择场景</span>
          <select
            value={value.sceneType ?? ""}
            disabled={disabled}
            onChange={(e) => patch({ sceneType: e.target.value || null })}
            className="w-full rounded-lg border border-zinc-200 px-3 py-2"
          >
            <option value="">请选择场景</option>
            {CMS_OCCASION_TAG_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {value.targetType === "RECOMMENDATION_SLOT" ? (
        <RecommendationSlotPicker
          value={value.slotKey ?? null}
          onChange={(slotKey) => patch({ slotKey })}
          disabled={disabled}
        />
      ) : null}

      {value.targetType === "CUSTOM_URL" ? (
        <div className="space-y-2">
          <Input
            label="自定义链接"
            value={value.customUrl ?? ""}
            disabled={disabled}
            onChange={(e) => patch({ customUrl: e.target.value })}
            placeholder="例如 /pages/activity/spring"
          />
          <p className="text-xs text-amber-700">
            自定义链接仅用于特殊情况，请确认路径可访问。
          </p>
        </div>
      ) : null}

      {value.targetType === "COUPON" ? (
        <Input
          label="优惠券码"
          value={value.couponCode ?? ""}
          disabled={disabled}
          onChange={(e) => patch({ couponCode: e.target.value })}
          placeholder="例如 COUPON_2026_SPRING"
        />
      ) : null}
    </div>
  );
}
