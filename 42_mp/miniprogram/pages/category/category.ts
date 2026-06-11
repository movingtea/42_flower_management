// pages/category/category.ts — 选花：服务端 tag 过滤 + 分页
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
import {
  DEFAULT_PAGE_SIZE,
  fetchProductList,
  type ProductListPagination,
} from '../../utils/product-api';
import {
  buildFilterChips,
  buildFilterGroupsUi,
  hasActiveFilters,
  sceneDescriptionByKey,
  sceneIconPath,
  sceneTitleByKey,
  type ProductFilters,
} from '../../utils/product-filters';
import { consumeCategoryPendingNav } from '../../utils/home-scene-entries';

interface CategoryNode {
  id: string;
  name: string;
  sortOrder: number;
  parentId: string | null;
  imageUrl: string | null;
  children: CategoryNode[];
}

interface NavDisplayItem {
  id: string;
  name: string;
  level: 1 | 2;
  hasChildren: boolean;
  isExpanded?: boolean;
}

const SEARCH_DEBOUNCE_MS = 500;

function normalizeProduct(item: WechatProductRaw): WechatProductItem {
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

Page({
  data: {
    categories: [] as CategoryNode[],
    navList: [] as NavDisplayItem[],
    expandedMap: {} as Record<string, boolean>,
    activeCategoryId: '',
    keyword: '',
    products: [] as WechatProductItem[],
    loadingCategories: true,
    loadingProducts: false,
    loadingMore: false,
    specPickerVisible: false,
    specPickerProduct: null as WechatProductItem | null,
    baseUrl,
    sceneType: '',
    sceneTitle: '',
    sceneDescription: '',
    sceneIcon: '',
    filterMode: false,
    showFilterPanel: false,
    filters: {} as ProductFilters,
    filterGroups: buildFilterGroupsUi({}),
    activeFilterChips: [] as Array<{ groupId: string; key: string; label: string }>,
    hasActiveFilters: false,
    filterEmptyText: '暂时没有适合这个场景的花束，可以换个预算或色系看看。',
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    pagination: null as ProductListPagination | null,
    hasMore: false,
    noMore: false,
  },

  searchTimer: null as ReturnType<typeof setTimeout> | null,
  productsRequestId: 0,

  onLoad(options: Record<string, string | undefined>) {
    const sceneType = (options.sceneType ?? options.occasionTag ?? '').trim();
    const filterMode = options.filterMode === '1' || !!sceneType;

    const filters: ProductFilters = sceneType ? { occasion: sceneType } : {};

    this.setData({
      sceneType,
      filterMode,
      sceneTitle: sceneType ? sceneTitleByKey(sceneType) : '',
      sceneDescription: sceneType ? sceneDescriptionByKey(sceneType) : '',
      sceneIcon: sceneType ? sceneIconPath(sceneType) : '',
      filters,
      filterGroups: buildFilterGroupsUi(filters),
      activeFilterChips: buildFilterChips(filters),
      hasActiveFilters: hasActiveFilters(filters),
    });

    if (sceneType) {
      wx.setNavigationBarTitle({ title: sceneTitleByKey(sceneType) });
    }
  },

  onShow() {
    updateCartTabBarBadge();
    this.applyPendingSceneNavigation();
    void this.loadCategories();
  },

  /** 消费首页场景入口经 switchTab 传入的筛选参数 */
  applyPendingSceneNavigation() {
    const pending = consumeCategoryPendingNav();
    if (!pending) return;

    console.log('[category] apply pending scene nav', pending);

    const sceneType = (pending.sceneType ?? pending.occasionTag ?? '').trim();
    const filterMode = pending.filterMode === true || !!sceneType;

    if (filterMode && !sceneType) {
      wx.showToast({ title: '缺少场景类型', icon: 'none' });
      return;
    }

    if (pending.slotKey) {
      console.warn('[category] slotKey not used in filter UI yet:', pending.slotKey);
    }

    const filters: ProductFilters = sceneType ? { occasion: sceneType } : {};

    this.setData({
      sceneType,
      filterMode,
      sceneTitle: sceneType ? sceneTitleByKey(sceneType) : '',
      sceneDescription: sceneType ? sceneDescriptionByKey(sceneType) : '',
      sceneIcon: sceneType ? sceneIconPath(sceneType) : '',
      filters,
      filterGroups: buildFilterGroupsUi(filters),
      activeFilterChips: buildFilterChips(filters),
      hasActiveFilters: hasActiveFilters(filters),
      activeCategoryId: filterMode ? '' : this.data.activeCategoryId,
    });

    if (sceneType) {
      wx.setNavigationBarTitle({ title: sceneTitleByKey(sceneType) });
    }
  },

  onPullDownRefresh() {
    Promise.all([this.loadCategories(), this.reloadProducts()])
      .finally(() => {
        wx.stopPullDownRefresh();
      });
  },

  onReachBottom() {
    void this.loadMoreProducts();
  },

  onUnload() {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
  },

  syncFilterUi(filters: ProductFilters) {
    this.setData({
      filters,
      filterGroups: buildFilterGroupsUi(filters),
      activeFilterChips: buildFilterChips(filters),
      hasActiveFilters: hasActiveFilters(filters),
    });
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
      let activeCategoryId = this.data.activeCategoryId;

      if (!this.data.filterMode) {
        const firstId = this.pickFirstCategoryId(categories);
        activeCategoryId =
          activeCategoryId && this.categoryExists(categories, activeCategoryId)
            ? activeCategoryId
            : firstId;
      }

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

      await this.reloadProducts();
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

  async reloadProducts() {
    this.setData({ page: 1, noMore: false, hasMore: false });
    return this.fetchProducts({ append: false, page: 1 });
  },

  async loadMoreProducts() {
    const { loadingMore, loadingProducts, hasMore, page } = this.data;
    if (loadingMore || loadingProducts || !hasMore) return;
    await this.fetchProducts({ append: true, page: page + 1 });
  },

  async fetchProducts(options: { append: boolean; page: number }) {
    const { append, page } = options;
    const requestId = ++this.productsRequestId;
    const { activeCategoryId, keyword, filterMode, filters, sceneType, pageSize } =
      this.data;

    this.setData({
      loadingProducts: !append,
      loadingMore: append,
    });

    try {
      const categoryId = filterMode ? '' : activeCategoryId;
      const data = await fetchProductList({
        keyword,
        categoryId: categoryId || undefined,
        filters,
        sceneType: filterMode && sceneType ? sceneType : undefined,
        page,
        pageSize,
      });

      if (requestId !== this.productsRequestId) {
        return;
      }

      if (!data) {
        throw new Error('商品数据无效');
      }

      const rawList = data.products ?? data.list ?? [];
      const mapped = rawList.map(normalizeProduct);
      const pagination = data.pagination ?? {
        page,
        pageSize,
        total: data.total ?? mapped.length,
        totalPages: Math.ceil((data.total ?? mapped.length) / pageSize) || 0,
      };

      const products = append ? [...this.data.products, ...mapped] : mapped;
      const hasMore = pagination.page < pagination.totalPages;

      this.setData({
        products,
        pagination,
        page: pagination.page,
        hasMore,
        noMore: !hasMore && products.length > 0,
        loadingProducts: false,
        loadingMore: false,
      });
    } catch {
      if (requestId !== this.productsRequestId) {
        return;
      }
      this.setData({
        products: append ? this.data.products : [],
        loadingProducts: false,
        loadingMore: false,
        hasMore: false,
      });
      wx.showToast({ title: '商品加载失败', icon: 'none' });
    }
  },

  onToggleFilterPanel() {
    this.setData({ showFilterPanel: !this.data.showFilterPanel });
  },

  onFilterChipTap(e: WechatMiniprogram.TouchEvent) {
    const groupId = e.currentTarget.dataset.groupId as keyof ProductFilters;
    const key = e.currentTarget.dataset.key as string;
    if (!groupId || !key) return;

    const filters = { ...this.data.filters };
    if (filters[groupId] === key) {
      delete filters[groupId];
    } else {
      filters[groupId] = key;
    }

    this.setData({ filters, filterMode: true });
    this.syncFilterUi(filters);
    void this.reloadProducts();
  },

  onRemoveFilterChip(e: WechatMiniprogram.TouchEvent) {
    const groupId = e.currentTarget.dataset.groupId as keyof ProductFilters;
    if (!groupId) return;
    const filters = { ...this.data.filters };
    delete filters[groupId];
    const stillFilterMode = hasActiveFilters(filters) || !!this.data.sceneType;
    this.setData({ filters, filterMode: stillFilterMode });
    this.syncFilterUi(filters);
    void this.reloadProducts();
  },

  onClearFilters() {
    const filters = {};
    this.setData({
      filters,
      filterMode: false,
      sceneType: '',
      sceneTitle: '',
      sceneDescription: '',
      sceneIcon: '',
    });
    this.syncFilterUi(filters);
    wx.setNavigationBarTitle({ title: '选花' });
    void this.reloadProducts();
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
      filterMode: false,
      filters: {},
      sceneType: '',
      sceneTitle: '',
      sceneDescription: '',
      sceneIcon: '',
    });
    this.syncFilterUi({});
    wx.setNavigationBarTitle({ title: '选花' });
    void this.reloadProducts();
  },

  onSearchInput(e: WechatMiniprogram.Input) {
    const keyword = (e.detail.value ?? '').trimStart();
    this.setData({ keyword });

    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
    }

    this.searchTimer = setTimeout(() => {
      void this.reloadProducts();
    }, SEARCH_DEBOUNCE_MS);
  },

  onSearchConfirm() {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    void this.reloadProducts();
  },

  onClearSearch() {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    this.setData({ keyword: '' });
    void this.reloadProducts();
  },

  onAddCart(e: WechatMiniprogram.TouchEvent) {
    const product = e.currentTarget.dataset.product as WechatProductItem | undefined;
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

    wx.navigateTo({
      url: `/pages/product-detail/product-detail?id=${id}`,
      fail: () => {
        wx.showToast({ title: '商品详情页开发中', icon: 'none' });
      },
    });
  },
});
