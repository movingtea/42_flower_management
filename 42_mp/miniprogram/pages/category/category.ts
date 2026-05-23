// pages/category/category.ts — 商品分类：树形导航 + 搜索 + 商品列表
import { request } from '../../utils/request';
import {
  readCartFromStorage,
  updateCartTabBarBadge,
  writeCartToStorage,
} from '../../utils/cart';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface CategoryNode {
  id: string;
  name: string;
  sortOrder: number;
  parentId: string | null;
  imageUrl: string | null;
  children: CategoryNode[];
}

interface ProductRaw {
  id: string;
  sku?: string;
  name: string;
  subtitle?: string;
  price?: number | string;
  sellPrice?: string;
  shippingFee?: number;
  imageUrl?: string;
  images?: string[];
  isOutOfStock?: boolean;
}

interface ProductItem {
  id: string;
  sku?: string;
  name: string;
  subtitle?: string;
  price: number | string;
  shippingFee: number;
  imageUrl: string;
  isOutOfStock?: boolean;
}

/** 左侧导航扁平列表（便于 WXML 渲染展开态） */
interface NavDisplayItem {
  id: string;
  name: string;
  level: 1 | 2;
  hasChildren: boolean;
  isExpanded?: boolean;
}

const SEARCH_DEBOUNCE_MS = 500;

function normalizeProduct(item: ProductRaw): ProductItem {
  const price = item.price ?? item.sellPrice ?? '0';
  const imageUrl =
    item.imageUrl ?? (item.images && item.images.length > 0 ? item.images[0] : '');

  return {
    id: item.id,
    sku: item.sku,
    name: item.name,
    subtitle: item.subtitle,
    price,
    shippingFee: Math.max(0, Number(item.shippingFee) || 0),
    imageUrl,
    isOutOfStock: item.isOutOfStock,
  };
}

function buildNavList(
  categories: CategoryNode[],
  expandedMap: Record<string, boolean>
): NavDisplayItem[] {
  const list: NavDisplayItem[] = [];

  for (const root of categories) {
    const hasChildren = root.children.length > 0;
    list.push({
      id: root.id,
      name: root.name,
      level: 1,
      hasChildren,
      isExpanded: hasChildren && !!expandedMap[root.id],
    });

    if (hasChildren && expandedMap[root.id]) {
      for (const child of root.children) {
        list.push({
          id: child.id,
          name: child.name,
          level: 2,
          hasChildren: false,
        });
      }
    }
  }

  return list;
}

function buildProductsQuery(categoryId: string, keyword: string): string {
  const parts: string[] = [];
  if (categoryId) {
    parts.push(`category=${encodeURIComponent(categoryId)}`);
  }
  if (keyword.trim()) {
    parts.push(`keyword=${encodeURIComponent(keyword.trim())}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

Page({
  data: {
    categories: [] as CategoryNode[],
    navList: [] as NavDisplayItem[],
    expandedMap: {} as Record<string, boolean>,
    activeCategoryId: '',
    keyword: '',
    products: [] as ProductItem[],
    loadingCategories: true,
    loadingProducts: false,
  },

  searchTimer: null as ReturnType<typeof setTimeout> | null,
  productsRequestId: 0,

  onShow() {
    updateCartTabBarBadge();
    void this.loadCategories();
  },

  onPullDownRefresh() {
    Promise.all([this.loadCategories(), this.fetchProducts()])
      .finally(() => {
        wx.stopPullDownRefresh();
      });
  },

  onUnload() {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
  },

  async loadCategories() {
    this.setData({ loadingCategories: true });
    try {
      const res = await request<ApiResponse<{ categories?: CategoryNode[]; tree?: CategoryNode[] }>>({
        url: '/product-categories',
      });

      if (!res?.success || !res.data) {
        throw new Error('分类数据无效');
      }

      const categories = res.data.categories ?? res.data.tree ?? [];
      const firstId = this.pickFirstCategoryId(categories);
      const activeCategoryId =
        this.data.activeCategoryId &&
        this.categoryExists(categories, this.data.activeCategoryId)
          ? this.data.activeCategoryId
          : firstId;

      const expandedMap = { ...this.data.expandedMap };
      if (activeCategoryId) {
        const parentId = this.findParentId(categories, activeCategoryId);
        if (parentId) {
          expandedMap[parentId] = true;
        }
      }

      this.setData({
        categories,
        navList: buildNavList(categories, expandedMap),
        activeCategoryId,
        expandedMap,
        loadingCategories: false,
      });

      if (activeCategoryId) {
        await this.fetchProducts();
      } else {
        this.setData({ products: [], loadingProducts: false });
      }
    } catch {
      this.setData({ loadingCategories: false, categories: [] });
      wx.showToast({ title: '分类加载失败', icon: 'none' });
    }
  },

  pickFirstCategoryId(categories: CategoryNode[]): string {
    if (!categories.length) return '';
    const first = categories[0];
    if (first.children.length > 0) {
      return first.children[0].id;
    }
    return first.id;
  },

  categoryExists(categories: CategoryNode[], id: string): boolean {
    for (const node of categories) {
      if (node.id === id) return true;
      if (node.children.some((c) => c.id === id)) return true;
    }
    return false;
  },

  findParentId(categories: CategoryNode[], childId: string): string | null {
    for (const node of categories) {
      if (node.children.some((c) => c.id === childId)) {
        return node.id;
      }
    }
    return null;
  },

  async fetchProducts() {
    const { activeCategoryId, keyword } = this.data;
    const requestId = ++this.productsRequestId;

    this.setData({ loadingProducts: true });

    try {
      const query = buildProductsQuery(activeCategoryId, keyword);
      const res = await request<ApiResponse<{ list?: ProductRaw[]; products?: ProductRaw[] }>>({
        url: `/products${query}`,
      });

      if (requestId !== this.productsRequestId) {
        return;
      }

      if (!res?.success || !res.data) {
        throw new Error('商品数据无效');
      }

      const rawList = res.data.products ?? res.data.list ?? [];
      const products = rawList.map(normalizeProduct);

      this.setData({ products, loadingProducts: false });
    } catch {
      if (requestId !== this.productsRequestId) {
        return;
      }
      this.setData({ products: [], loadingProducts: false });
      wx.showToast({ title: '商品加载失败', icon: 'none' });
    }
  },

  onCategoryTap(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const hasChildren = !!e.currentTarget.dataset.hasChildren;

    if (!id) return;

    const expandedMap = { ...this.data.expandedMap };

    if (hasChildren) {
      expandedMap[id] = !expandedMap[id];
    }

    this.setData({
      activeCategoryId: id,
      expandedMap,
      navList: buildNavList(this.data.categories, expandedMap),
    });

    void this.fetchProducts();
  },

  onSearchInput(e: WechatMiniprogram.Input) {
    const keyword = (e.detail.value ?? '').trimStart();
    this.setData({ keyword });

    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
    }

    this.searchTimer = setTimeout(() => {
      void this.fetchProducts();
    }, SEARCH_DEBOUNCE_MS);
  },

  onSearchConfirm() {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    void this.fetchProducts();
  },

  onClearSearch() {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    this.setData({ keyword: '' });
    void this.fetchProducts();
  },

  onAddCart(e: WechatMiniprogram.TouchEvent) {
    const product = e.currentTarget.dataset.product as ProductItem | undefined;
    if (!product || !product.id) {
      wx.showToast({ title: '商品信息无效', icon: 'none' });
      return;
    }

    if (product.isOutOfStock) {
      wx.showToast({ title: '今日售罄，可预约明日', icon: 'none' });
      return;
    }

    const cart = readCartFromStorage();
    const index = cart.findIndex((row) => row.id === product.id);

    if (index >= 0) {
      cart[index].quantity += 1;
    } else {
      cart.push({
        id: product.id,
        sku: product.sku,
        name: product.name,
        price: product.price,
        imageUrl: product.imageUrl,
        quantity: 1,
        shippingFee: product.shippingFee,
      });
    }

    writeCartToStorage(cart);
    updateCartTabBarBadge(cart);
    wx.showToast({ title: '已加入购物车', icon: 'success' });
  },

  onProductTap(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const outOfStock = e.currentTarget.dataset.outOfStock;
    if (!id) return;

    if (outOfStock) {
      wx.showToast({ title: '今日售罄，可预约明日', icon: 'none' });
      return;
    }

    wx.navigateTo({
      url: `/pages/product-detail/product-detail?id=${id}`,
      fail: () => {
        wx.showToast({ title: '商品详情页开发中', icon: 'none' });
      },
    });
  },
});
