// pages/product-detail/product-detail.ts — 商品详情
import { baseUrl } from '../../config/index';
import { addPayloadToCart, buyNow } from '../../utils/cart-add';
import { updateCartTabBarBadge } from '../../utils/cart';
import {
  toRelativeImagePathList,
  rewriteRichTextImageSrc,
} from '../../utils/image';
import { request } from '../../utils/request';
import {
  buildBannerImages,
  computePriceRange,
  normalizeWechatProduct,
  pickDefaultSku,
  pickRandomRecommendations,
  type WechatProductItem,
  type WechatProductRaw,
} from '../../utils/product';
import {
  buildOccasionSummary,
  buildRelationshipSummary,
  buildStoryText,
  FLOWER_ADJUSTMENT_NOTE,
  DELIVERY_NOTES,
} from '../../utils/gift-copy';
import {
  canPurchaseSku,
  formatSkuStockLabel,
  isSoldOutProduct,
} from '../../utils/stock';
import {
  formatDefaultBulkPreorderHint,
  formatSkuBulkPreorderHint,
  isBulkQuantityHit,
  type BulkPreorderRule,
} from '../../utils/preorder-rule';

interface DetailPayload {
  product: WechatProductRaw;
  bannerImages?: string[];
}

type DetailProduct = WechatProductItem & {
  description: string | null;
  maintenanceGuide: string | null;
};

function tagLabels(tags: Array<{ label?: string; key?: string }> = []): string[] {
  return tags.map((t) => t.label || t.key || '').filter(Boolean);
}

Page({
  data: {
    loading: true,
    productId: '',
    product: null as DetailProduct | null,
    bannerImages: [] as string[],
    bannerCurrent: 0,
    minPrice: '0.00',
    maxPrice: '0.00',
    priceLabel: '¥0.00',
    descriptionHtml: '',
    maintenanceHtml: '',
    recommendList: [] as WechatProductItem[],
    occasionLabels: [] as string[],
    styleColorLabels: [] as string[],
    relationshipLabels: [] as string[],
    sellingPoints: [] as string[],
    specPickerVisible: false,
    specPickerMode: 'cart' as 'cart' | 'buy',
    selectedSkuStockLabel: '',
    selectedSkuId: '',
    selectedQuantity: 1,
    bulkPreorderHint: '',
    bulkPreorderActiveHint: '',
    canPurchase: true,
    baseUrl,
    occasionSummary: '',
    relationshipSummary: '',
    storyText: '',
    flowerAdjustmentNote: FLOWER_ADJUSTMENT_NOTE,
    deliveryNotes: Object.values(DELIVERY_NOTES),
  },

  onLoad(options: Record<string, string | undefined>) {
    const productId = (options.id ?? '').trim();
    if (!productId) {
      wx.showToast({ title: '商品参数无效', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }
    this.setData({ productId });
    void this.loadPageData(productId);
  },

  onShow() {
    updateCartTabBarBadge();
  },

  async loadPageData(productId: string) {
    this.setData({ loading: true });

    try {
      const [detailRes, listRes] = await Promise.all([
        request<DetailPayload>({
          url: `/products/${productId}`,
        }),
        request<{ list?: WechatProductRaw[]; products?: WechatProductRaw[] }>({
          url: '/products',
        }),
      ]);

      if (!detailRes?.product) {
        throw new Error('商品不存在');
      }

      const raw = detailRes.product;
      const base = normalizeWechatProduct(raw);
      const defaultSku = pickDefaultSku(base);
      const effectiveDescription =
        defaultSku?.description?.trim() ||
        raw.description?.trim() ||
        null;
      const product: DetailProduct = {
        ...base,
        description: effectiveDescription,
        maintenanceGuide: raw.maintenanceGuide ?? null,
      };

      const { minPrice, maxPrice, priceLabel } = computePriceRange(product.skus);
      const bannerImages = toRelativeImagePathList(
        detailRes.bannerImages?.length
          ? detailRes.bannerImages
          : buildBannerImages(product.skus, product.imageUrl)
      );

      const poolRaw = listRes?.products ?? listRes?.list ?? [];
      const pool = poolRaw.map(normalizeWechatProduct);
      const recommendList = pickRandomRecommendations(pool, productId, 6);

      const defaultSkuForStock = pickDefaultSku(product);
      const canPurchase = defaultSkuForStock
        ? canPurchaseSku(defaultSkuForStock)
        : !isSoldOutProduct(product);

      this.updateSkuPreorderHints(defaultSkuForStock, 1);

      this.setData({
        loading: false,
        product,
        selectedSkuId: defaultSkuForStock?.id ?? '',
        selectedQuantity: 1,
        selectedSkuStockLabel: defaultSkuForStock
          ? formatSkuStockLabel(defaultSkuForStock.stock)
          : formatSkuStockLabel(0),
        canPurchase,
        bannerImages,
        minPrice,
        maxPrice,
        priceLabel,
        descriptionHtml: rewriteRichTextImageSrc(effectiveDescription ?? ''),
        maintenanceHtml: rewriteRichTextImageSrc(product.maintenanceGuide ?? ''),
        recommendList,
        occasionLabels: tagLabels(product.occasionTags),
        styleColorLabels: [
          ...tagLabels(product.colorTags),
          ...tagLabels(product.styleTags),
        ],
        relationshipLabels: tagLabels(product.relationshipTags),
        sellingPoints: product.sellingPoints ?? [],
        occasionSummary: buildOccasionSummary(tagLabels(product.occasionTags)),
        relationshipSummary: buildRelationshipSummary(tagLabels(product.relationshipTags)),
        storyText: buildStoryText(product.sellingPoints ?? []),
      });

      wx.setNavigationBarTitle({ title: product.name });
    } catch {
      this.setData({ loading: false });
      wx.showToast({ title: '商品加载失败', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
    }
  },

  onBannerChange(e: WechatMiniprogram.SwiperChange) {
    this.setData({ bannerCurrent: e.detail.current });
  },

  updateSkuPreorderHints(
    sku: { bulkPreorderRule?: BulkPreorderRule } | null | undefined,
    quantity: number
  ) {
    const rule = sku?.bulkPreorderRule;
    if (!rule?.enabled || rule.threshold == null || rule.minLeadDays == null) {
      this.setData({ bulkPreorderHint: '', bulkPreorderActiveHint: '' });
      return;
    }
    const bulkPreorderHint =
      formatSkuBulkPreorderHint(rule) ||
      formatDefaultBulkPreorderHint(rule.threshold, rule.minLeadDays);
    const bulkPreorderActiveHint = isBulkQuantityHit(rule, quantity)
      ? '当前数量需要提前预订，不能选择当天送达。'
      : '';
    this.setData({ bulkPreorderHint, bulkPreorderActiveHint });
  },

  onQuantityChange(e: WechatMiniprogram.Input) {
    const quantity = Math.max(1, Math.floor(Number(e.detail.value) || 1));
    const sku =
      this.data.product?.skus.find((s) => s.id === this.data.selectedSkuId) ??
      pickDefaultSku(this.data.product!);
    this.setData({ selectedQuantity: quantity });
    this.updateSkuPreorderHints(sku, quantity);
  },

  onOpenSpecPicker(e?: WechatMiniprogram.TouchEvent) {
    const mode =
      (e?.currentTarget?.dataset?.mode as 'cart' | 'buy' | undefined) ?? 'cart';
    const { product } = this.data;
    if (!product) return;

    if (product.isOutOfStock || !this.data.canPurchase) {
      wx.showToast({ title: '该规格暂时售罄', icon: 'none' });
      return;
    }

    if (product.skus.length <= 1) {
      const sku = pickDefaultSku(product);
      if (!sku) {
        wx.showToast({ title: '暂无可售款式', icon: 'none' });
        return;
      }
      if (!canPurchaseSku(sku)) {
        wx.showToast({ title: '该规格暂时售罄', icon: 'none' });
        return;
      }
      if (mode === 'buy') {
        void this.buySku(
          sku.id,
          sku.skuCode,
          sku.specName,
          sku.price,
          sku.imageUrl ?? product.imageUrl,
          sku.stock,
          sku.bulkPreorderRule
        );
      } else {
        void this.addSkuToCart(
          sku.id,
          sku.skuCode,
          sku.specName,
          sku.price,
          sku.imageUrl ?? product.imageUrl,
          sku.stock,
          sku.bulkPreorderRule
        );
      }
      return;
    }

    this.setData({ specPickerVisible: true, specPickerMode: mode });
  },

  onSpecPickerClose() {
    this.setData({ specPickerVisible: false });
  },

  onSpecPickerConfirm(e: WechatMiniprogram.CustomEvent) {
    const detail = e.detail as {
      skuId: string;
      skuCode: string;
      specName: string;
      price: string;
      imageUrl: string;
    };
    const mode = this.data.specPickerMode;
    this.setData({ specPickerVisible: false });

    const sku = this.data.product?.skus.find((s) => s.id === detail.skuId);
    if (!sku || !canPurchaseSku(sku)) {
      wx.showToast({ title: '该规格暂时售罄', icon: 'none' });
      return;
    }

    this.setData({
      selectedSkuId: detail.skuId,
      selectedSkuStockLabel: formatSkuStockLabel(sku.stock),
      canPurchase: true,
    });
    this.updateSkuPreorderHints(sku, this.data.selectedQuantity);

    if (mode === 'buy') {
      void this.buySku(
        detail.skuId,
        detail.skuCode,
        detail.specName,
        detail.price,
        detail.imageUrl,
        sku.stock,
        sku.bulkPreorderRule
      );
      return;
    }

    void this.addSkuToCart(
      detail.skuId,
      detail.skuCode,
      detail.specName,
      detail.price,
      detail.imageUrl,
      sku.stock,
      sku.bulkPreorderRule
    );
  },

  buySku(
    skuId: string,
    skuCode: string,
    specName: string,
    price: string,
    imageUrl: string,
    stock: number,
    bulkPreorderRule?: BulkPreorderRule | null
  ) {
    const { product } = this.data;
    if (!product) return;

    void buyNow({
      spuId: product.id,
      skuId,
      skuCode,
      specName,
      name: product.name,
      price,
      imageUrl: imageUrl || product.imageUrl,
      shippingFee: product.shippingFee,
      stock,
      quantity: this.data.selectedQuantity,
      bulkPreorderRule: bulkPreorderRule ?? null,
    });
  },

  addSkuToCart(
    skuId: string,
    skuCode: string,
    specName: string,
    price: string,
    imageUrl: string,
    stock: number,
    bulkPreorderRule?: BulkPreorderRule | null
  ) {
    const { product } = this.data;
    if (!product) return;

    void addPayloadToCart({
      spuId: product.id,
      skuId,
      skuCode,
      specName,
      name: product.name,
      price,
      imageUrl: imageUrl || product.imageUrl,
      shippingFee: product.shippingFee,
      stock,
      quantity: this.data.selectedQuantity,
      bulkPreorderRule: bulkPreorderRule ?? null,
    }).then((ok) => {
      if (ok) wx.showToast({ title: '已加入购物车', icon: 'success' });
    });
  },

  onGoCart() {
    wx.switchTab({ url: '/pages/cart/cart' });
  },

  onRecommendTap(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id || id === this.data.productId) return;

    wx.redirectTo({
      url: `/pages/product-detail/product-detail?id=${id}`,
    });
  },
});
