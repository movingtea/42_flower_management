// pages/index/index.ts — 首页：/homepage + /products 联调
import { baseUrl } from '../../config/index';
import { toRelativeImagePath } from '../../utils/image';
import { request } from '../../utils/request';
import { addPayloadToCart } from '../../utils/cart-add';
import { updateCartTabBarBadge } from '../../utils/cart';
import {
  normalizeWechatProduct,
  pickDefaultSku,
  type WechatProductItem,
  type WechatProductRaw,
} from '../../utils/product';
import {
  getLocalFallbackSceneEntries,
  mapApiSceneEntries,
  navigateToSceneEntry,
  type HomeSceneEntriesResponse,
} from '../../utils/home-scene-entries';
import type { HomeSceneEntryDisplay } from '../../utils/icons';

interface NoticeConfig {
  enabled: boolean;
  text: string;
}

interface PopupConfig {
  enabled?: boolean;
  title?: string;
  content?: string;
  imageUrl?: string;
}

interface BannerItem {
  id: string;
  imageUrl: string;
  sort?: number;
  targetType?: 'PRODUCT' | 'ACTIVITY' | 'COUPON' | 'NONE';
  targetParam?: string | null;
  productId?: string | null;
}

/** CMS 分类项（homepage 返回 value/label；兼容 id 字段） */
interface CategorySourceItem {
  id?: string;
  value?: string;
  label: string;
  sortOrder?: number;
}

interface CategoryTab {
  id: string;
  label: string;
}

interface HomepageData {
  banners?: BannerItem[];
  notice?: NoticeConfig;
  popup?: PopupConfig;
  categories?: CategorySourceItem[];
}

interface ProductsData {
  products?: WechatProductRaw[];
  list?: WechatProductRaw[];
}

type ProductItem = WechatProductItem & {
  category: string[];
};

interface RecommendationTag {
  key: string;
  label: string;
}

interface RecommendationItem {
  productId: string;
  skuId: string | null;
  productName: string;
  skuName: string | null;
  price: string;
  coverImage: string;
  subtitle: string | null;
  occasionTags?: RecommendationTag[];
  colorTags?: RecommendationTag[];
  styleTags?: RecommendationTag[];
  sellingPoints?: string[];
  cardOccasionLabels?: string[];
  cardStyleColorLabels?: string[];
  cardSellingPoint?: string;
}

interface RecommendationSlot {
  key: string;
  name: string;
  slotType: string;
  sceneType?: string | null;
  items: RecommendationItem[];
}

interface RecommendationsData {
  slots?: RecommendationSlot[];
}

const DEFAULT_SCENE_ENTRIES = getLocalFallbackSceneEntries();

function normalizeProduct(item: WechatProductRaw & { category?: string[] }): ProductItem {
  const base = normalizeWechatProduct(item);
  return {
    ...base,
    category: Array.isArray(item.category)
      ? item.category.map((c) => String(c).trim()).filter(Boolean)
      : [],
  };
}

function normalizeCategoryTabs(items: CategorySourceItem[]): CategoryTab[] {
  return items
    .map((item) => {
      const id = (item.id ?? item.value ?? "").trim();
      if (!id) return null;
      return {
        id,
        label: item.label || id,
      };
    })
    .filter((tab): tab is CategoryTab => tab !== null);
}

Page({
  data: {
    banners: [] as BannerItem[],
    notice: { enabled: false, text: '' } as NoticeConfig,
    popup: {} as PopupConfig,
    popupVisible: false,
    categories: [] as CategoryTab[],
    currentTabId: '',
    allProducts: [] as ProductItem[],
    filteredProducts: [] as ProductItem[],
    loading: true,
    specPickerVisible: false,
    specPickerProduct: null as ProductItem | null,
    baseUrl,
    homeMainSlots: [] as RecommendationSlot[],
    newArrivalSlots: [] as RecommendationSlot[],
    highTicketSlots: [] as RecommendationSlot[],
    sceneSlots: [] as RecommendationSlot[],
    sceneEntries: DEFAULT_SCENE_ENTRIES as HomeSceneEntryDisplay[],
    sceneEntriesFailed: false,
    recommendationsFailed: false,
  },

  onLoad() {
    this.loadPageData();
  },

  onShow() {
    updateCartTabBarBadge();
  },

  onPullDownRefresh() {
    this.loadPageData().finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  /** 并行拉取首页配置与全量商品，再本地按分类过滤 */
  loadPageData() {
    this.setData({ loading: true });
    return Promise.all([
      this.fetchHomepage(),
      this.fetchProducts(),
      this.fetchRecommendations(),
      this.fetchHomeSceneEntries(),
    ])
      .then(() => {
        this.applyCategoryFilter();
      })
      .catch((err) => {
        console.error('首页数据加载失败', err);
      })
      .finally(() => {
        this.setData({ loading: false });
      });
  },

  fetchHomepage() {
    return request<HomepageData>({ url: '/homepage' }).then((homepageData) => {
      if (!homepageData) {
        console.warn('首页配置接口未返回有效数据', homepageData);
        return;
      }
      const categories = normalizeCategoryTabs(homepageData.categories ?? []);
      const prevTabId = this.data.currentTabId;
      const currentTabId =
        prevTabId && categories.some((c) => c.id === prevTabId)
          ? prevTabId
          : categories[0]?.id ?? '';

      const popupRaw = homepageData.popup ?? {};
      const popup = {
        ...popupRaw,
        imageUrl: popupRaw.imageUrl
          ? toRelativeImagePath(popupRaw.imageUrl)
          : undefined,
      };

      const banners = (homepageData.banners ?? []).map((item) => ({
        ...item,
        imageUrl: toRelativeImagePath(item.imageUrl),
      }));

      this.setData({
        banners,
        notice: homepageData.notice ?? { enabled: false, text: '' },
        popup,
        categories,
        currentTabId,
        popupVisible: !!popup.enabled,
      });
    });
  },

  fetchHomeSceneEntries() {
    return request<HomeSceneEntriesResponse>({
      url: '/home-scene-entries',
      raw: false,
    })
      .then((data) => {
        console.log(data)
        const apiEntries = data?.entries ?? [];
        if (apiEntries.length === 0) {
          this.setData({
            sceneEntries: getLocalFallbackSceneEntries(),
            sceneEntriesFailed: false,
          });
          return;
        }
        this.setData({
          sceneEntries: mapApiSceneEntries(apiEntries),
          sceneEntriesFailed: false,
        });
      })
      .catch((err) => {
        console.warn('首页场景入口加载失败，使用本地 fallback', err);
        this.setData({
          sceneEntries: getLocalFallbackSceneEntries(),
          sceneEntriesFailed: true,
        });
      });
  },

  fetchRecommendations() {
    return request<RecommendationsData>({ url: '/recommendations', raw: false })
      .then((data) => {
        const slots = (data?.slots ?? []).map((slot) => ({
          ...slot,
          items: (slot.items ?? []).map((item) => ({
            ...item,
            coverImage: toRelativeImagePath(item.coverImage),
            cardOccasionLabels: (item.occasionTags ?? [])
              .slice(0, 2)
              .map((t) => t.label || t.key),
            cardStyleColorLabels: [
              ...(item.colorTags ?? []).slice(0, 1),
              ...(item.styleTags ?? []).slice(0, 1),
            ].map((t) => t.label || t.key),
            cardSellingPoint: (item.sellingPoints ?? [])[0] ?? '',
          })),
        }));

        this.setData({
          homeMainSlots: slots.filter((s) => s.slotType === 'HOME_MAIN'),
          newArrivalSlots: slots.filter((s) => s.slotType === 'NEW_ARRIVAL'),
          highTicketSlots: slots.filter((s) => s.slotType === 'HIGH_TICKET'),
          sceneSlots: slots.filter(
            (s) => s.slotType === 'SCENE' || s.slotType === 'FESTIVAL'
          ),
          recommendationsFailed: false,
        });
      })
      .catch((err) => {
        console.warn('推荐位加载失败，首页将仅展示原有内容', err);
        this.setData({
          homeMainSlots: [],
          newArrivalSlots: [],
          highTicketSlots: [],
          sceneSlots: [],
          recommendationsFailed: true,
        });
      });
  },

  fetchProducts() {
    return request<ProductsData>({ url: '/products' }).then((data) => {
      if (!data) {
        console.warn('商品列表接口未返回有效数据', data);
        return;
      }

      const rawList = data.products ?? data.list ?? [];
      const allProducts = rawList.map(normalizeProduct);
      this.setData({ allProducts });
    });
  },

  /** 按分类 id（与商品 category 数组中的分类 id 对齐）过滤 */
  applyCategoryFilter() {
    const { allProducts, currentTabId } = this.data;
    if (!currentTabId) {
      this.setData({ filteredProducts: allProducts });
      return;
    }
    const filtered = allProducts.filter(
      (p) => Array.isArray(p.category) && p.category.includes(currentTabId)
    );
    this.setData({ filteredProducts: filtered });
  },

  onCategoryTabTap(e: WechatMiniprogram.TouchEvent) {
    const tabId = e.currentTarget.dataset.tabId as string;
    if (!tabId || tabId === this.data.currentTabId) return;
    this.setData({ currentTabId: tabId }, () => {
      this.applyCategoryFilter();
    });
  },

  onBannerTap(e: WechatMiniprogram.TouchEvent) {
    const ds = e.currentTarget.dataset;
    const targetType = (ds.targetType as string | undefined) || 'NONE';
    const productId = ds.productId as string | undefined;
    const targetParam = ds.targetParam as string | undefined;

    if (targetType === 'PRODUCT' && productId) {
      this.navigateToProductDetail(productId);
      return;
    }

    if (targetType === 'ACTIVITY' && targetParam) {
      const path = targetParam.startsWith('/') ? targetParam : `/${targetParam}`;
      wx.navigateTo({
        url: path,
        fail: () => {
          wx.showToast({ title: '活动页暂未开放', icon: 'none' });
        },
      });
      return;
    }

    if (targetType === 'COUPON') {
      wx.showToast({
        title: targetParam ? `优惠券：${targetParam}` : '优惠券活动',
        icon: 'none',
      });
    }
  },

  onAddCart(e: WechatMiniprogram.TouchEvent) {
    const product = e.currentTarget.dataset.product as ProductItem | undefined;
    if (!product?.id) {
      wx.showToast({ title: '商品信息无效', icon: 'none' });
      return;
    }

    if (product.isOutOfStock) {
      wx.showToast({ title: '该商品暂时售罄', icon: 'none' });
      return;
    }

    if (product.skus.length > 1) {
      this.setData({
        specPickerVisible: true,
        specPickerProduct: product,
      });
      return;
    }

    const sku = pickDefaultSku(product);
    if (!sku) {
      wx.showToast({ title: '暂无可售款式', icon: 'none' });
      return;
    }

    void addPayloadToCart({
      spuId: product.id,
      skuId: sku.id,
      skuCode: sku.skuCode,
      specName: sku.specName,
      name: product.name,
      price: sku.price,
      imageUrl: sku.imageUrl || product.imageUrl,
      shippingFee: product.shippingFee,
      stock: sku.stock,
    }).then((ok) => {
      if (ok) wx.showToast({ title: '已加入购物车', icon: 'success' });
    });
  },

  onSpecPickerClose() {
    this.setData({ specPickerVisible: false, specPickerProduct: null });
  },

  onSpecPickerConfirm(e: WechatMiniprogram.CustomEvent) {
    const detail = e.detail as {
      spuId: string;
      skuId: string;
      skuCode: string;
      specName: string;
      name: string;
      price: string;
      imageUrl: string;
      shippingFee: number;
    };
    const product = this.data.specPickerProduct;
    const sku = product?.skus.find((s) => s.id === detail.skuId);
    void addPayloadToCart({
      spuId: detail.spuId,
      skuId: detail.skuId,
      skuCode: detail.skuCode,
      specName: detail.specName,
      name: detail.name,
      price: detail.price,
      imageUrl: detail.imageUrl,
      shippingFee: detail.shippingFee,
      stock: sku?.stock ?? 0,
    }).then((ok) => {
      if (ok) wx.showToast({ title: '已加入购物车', icon: 'success' });
    });
    this.setData({ specPickerVisible: false, specPickerProduct: null });
  },

  onProductTap(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    this.navigateToProductDetail(id);
  },

  navigateToProductDetail(productId: string) {
    wx.navigateTo({
      url: `/pages/product-detail/product-detail?id=${productId}`,
      fail: () => {
        wx.showToast({ title: '商品详情页开发中', icon: 'none' });
      },
    });
  },

  onRecommendationTap(e: WechatMiniprogram.TouchEvent) {
    const productId = e.currentTarget.dataset.productId as string;
    if (!productId) return;
    this.navigateToProductDetail(productId);
  },

  onSceneEntryTap(e: WechatMiniprogram.TouchEvent) {
    console.log('[home-scene] tap', e.currentTarget.dataset);
    const index = Number(e.currentTarget.dataset.index);
    const entry = this.data.sceneEntries[index];
    if (!entry) {
      wx.showToast({ title: '场景入口无效', icon: 'none' });
      return;
    }
    navigateToSceneEntry({
      sceneType: entry.sceneType,
      targetType: entry.targetType,
      targetValue: entry.targetValue,
      linkedRecommendationSlotKey: entry.linkedRecommendationSlotKey,
    });
  },

  onKingkongTap(e: WechatMiniprogram.TouchEvent) {
    const type = e.currentTarget.dataset.type as string;
    const map: Record<string, string> = {
      pickup: '到店自提',
      romance: '浪漫告白',
      business: '商务定制',
      guide: '养护指南',
    };
    wx.navigateTo({ url: '/pages/checkout/checkout' });
    wx.showToast({
      title: `${map[type] ?? '功能'} · 敬请期待`,
      icon: 'none',
    });
  },

  onClosePopup() {
    this.setData({ popupVisible: false });
  },

  onPopupCardTap() {
    // 阻止点击卡片内容时关闭蒙层
  },
});
