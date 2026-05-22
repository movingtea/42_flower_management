// pages/index/index.ts — 首页：/homepage + /products 联调
import { request } from '../../utils/request';

/** 与 Next.js jsonSuccess 一致：业务数据在 data 内 */
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

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
  productId?: string;
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

interface ProductRaw {
  id: string;
  name: string;
  subtitle?: string;
  price?: number | string;
  sellPrice?: string;
  imageUrl?: string;
  images?: string[];
  category: string[];
  isOutOfStock?: boolean;
}

interface ProductsData {
  products?: ProductRaw[];
  list?: ProductRaw[];
}

interface ProductItem {
  id: string;
  name: string;
  subtitle?: string;
  price: number | string;
  imageUrl: string;
  category: string[];
  isOutOfStock?: boolean;
}

function normalizeCategoryTabs(items: CategorySourceItem[]): CategoryTab[] {
  return items.map((item) => {
    const id = (item.id ?? item.value ?? item.label).trim().toLowerCase();
    return {
      id,
      label: item.label || item.value || id,
    };
  });
}

function normalizeProduct(item: ProductRaw): ProductItem {
  const price = item.price ?? item.sellPrice ?? '0';
  const imageUrl =
    item.imageUrl ?? (item.images && item.images.length > 0 ? item.images[0] : '');

  return {
    id: item.id,
    name: item.name,
    subtitle: item.subtitle,
    price,
    imageUrl,
    category: Array.isArray(item.category)
      ? item.category.map((c) => String(c).toLowerCase())
      : [],
    isOutOfStock: item.isOutOfStock,
  };
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
  },

  onLoad() {
    this.loadPageData();
  },

  onPullDownRefresh() {
    this.loadPageData().finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  /** 并行拉取首页配置与全量商品，再本地按分类过滤 */
  loadPageData() {
    this.setData({ loading: true });
    return Promise.all([this.fetchHomepage(), this.fetchProducts()])
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
    return request<ApiResponse<HomepageData>>({ url: '/homepage' }).then((res) => {
      if (!res?.success || !res.data) {
        console.warn('首页配置接口未返回有效 data', res);
        return;
      }

      const homepageData = res.data;
      console.log(homepageData);
      const categories = normalizeCategoryTabs(homepageData.categories ?? []);
      const prevTabId = this.data.currentTabId;
      const currentTabId =
        prevTabId && categories.some((c) => c.id === prevTabId)
          ? prevTabId
          : categories[0]?.id ?? '';

      const popup = homepageData.popup ?? {};

      this.setData({
        banners: homepageData.banners ?? [],
        notice: homepageData.notice ?? { enabled: false, text: '' },
        popup,
        categories,
        currentTabId,
        popupVisible: !!popup.enabled,
      });
    });
  },

  fetchProducts() {
    return request<ApiResponse<ProductsData>>({ url: '/products' }).then((res) => {
      if (!res?.success || !res.data) {
        console.warn('商品列表接口未返回有效 data', res);
        return;
      }

      const rawList = res.data.products ?? res.data.list ?? [];
      const allProducts = rawList.map(normalizeProduct);
      this.setData({ allProducts });
    });
  },

  /** 按分类 id（与商品 category 数组中的 key 对齐）过滤 */
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
    const productId = e.currentTarget.dataset.productId as string | undefined;
    if (productId) {
      this.navigateToProductDetail(productId);
    }
  },

  onProductTap(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const outOfStock = e.currentTarget.dataset.outOfStock;
    if (!id) return;
    if (outOfStock) {
      wx.showToast({ title: '今日售罄，可预约明日', icon: 'none' });
      return;
    }
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
