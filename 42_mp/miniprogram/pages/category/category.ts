// pages/category/category.ts — 商品分类：树形导航 + 搜索 + 商品列表
import { baseUrl } from '../../config/index';
import { request } from '../../utils/request';
import { addPayloadToCart } from '../../utils/cart-add';
import { updateCartTabBarBadge } from '../../utils/cart';
import {
  normalizeWechatProduct,
  pickDefaultSku,
  type WechatProductItem,
  type WechatProductRaw,
} from '../../utils/product';

interface CategoryNode {
  id: string;
  name: string;
  sortOrder: number;
  parentId: string | null;
  imageUrl: string | null;
  children: CategoryNode[];
}

type ProductItem = WechatProductItem;

/** 左侧导航扁平列表（便于 WXML 渲染展开态） */
interface NavDisplayItem {
  id: string;
  name: string;
  level: 1 | 2;
  hasChildren: boolean;
  isExpanded?: boolean;
}

const SEARCH_DEBOUNCE_MS = 500;

function normalizeProduct(item: WechatProductRaw): ProductItem {
  return normalizeWechatProduct(item);
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
    specPickerVisible: false,
    specPickerProduct: null as ProductItem | null,
    baseUrl,
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
      const data = await request<{
        categories?: CategoryNode[];
        tree?: CategoryNode[];
      }>({
        url: '/product-categories',
      });

      if (!data) {
        throw new Error('分类数据无效');
      }

      const categories = data.categories ?? data.tree ?? [];
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
      const data = await request<{
        list?: WechatProductRaw[];
        products?: WechatProductRaw[];
      }>({
        url: `/products${query}`,
      });

      if (requestId !== this.productsRequestId) {
        return;
      }

      if (!data) {
        throw new Error('商品数据无效');
      }

      const rawList = data.products ?? data.list ?? [];
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
    if (!product?.id) {
      wx.showToast({ title: '商品信息无效', icon: 'none' });
      return;
    }

    if (product.isOutOfStock) {
      wx.showToast({ title: '今日售罄，可预约明日', icon: 'none' });
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

    addPayloadToCart({
      spuId: product.id,
      skuId: sku.id,
      skuCode: sku.skuCode,
      specName: sku.specName,
      name: product.name,
      price: sku.price,
      imageUrl: sku.imageUrl || product.imageUrl,
      shippingFee: product.shippingFee,
    });
    wx.showToast({ title: '已加入购物车', icon: 'success' });
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
    addPayloadToCart({
      spuId: detail.spuId,
      skuId: detail.skuId,
      skuCode: detail.skuCode,
      specName: detail.specName,
      name: detail.name,
      price: detail.price,
      imageUrl: detail.imageUrl,
      shippingFee: detail.shippingFee,
    });
    this.setData({ specPickerVisible: false, specPickerProduct: null });
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
