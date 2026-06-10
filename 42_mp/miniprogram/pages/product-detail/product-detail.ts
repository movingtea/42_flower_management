// pages/product-detail/product-detail.ts — 商品详情
import { baseUrl } from '../../config/index';
import { addPayloadToCart } from '../../utils/cart-add';
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
    baseUrl,
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

      this.setData({
        loading: false,
        product,
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

  onOpenSpecPicker() {
    const { product } = this.data;
    if (!product) return;

    if (product.isOutOfStock) {
      wx.showToast({ title: '今日售罄，可预约明日', icon: 'none' });
      return;
    }

    if (product.skus.length <= 1) {
      const sku = pickDefaultSku(product);
      if (!sku) {
        wx.showToast({ title: '暂无可售款式', icon: 'none' });
        return;
      }
      this.addSkuToCart(
        sku.id,
        sku.skuCode,
        sku.specName,
        sku.price,
        sku.imageUrl ?? product.imageUrl
      );
      return;
    }

    this.setData({ specPickerVisible: true });
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
    this.setData({ specPickerVisible: false });
    this.addSkuToCart(
      detail.skuId,
      detail.skuCode,
      detail.specName,
      detail.price,
      detail.imageUrl
    );
  },

  addSkuToCart(
    skuId: string,
    skuCode: string,
    specName: string,
    price: string,
    imageUrl: string
  ) {
    const { product } = this.data;
    if (!product) return;

    addPayloadToCart({
      spuId: product.id,
      skuId,
      skuCode,
      specName,
      name: product.name,
      price,
      imageUrl: imageUrl || product.imageUrl,
      shippingFee: product.shippingFee,
    });
    wx.showToast({ title: '已加入购物车', icon: 'success' });
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
