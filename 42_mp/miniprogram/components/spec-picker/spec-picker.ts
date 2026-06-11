import { baseUrl } from '../../config/index';
import type { WechatProductItem } from '../../utils/product';
import { isSkuSelectable } from '../../utils/product';
import { formatSkuStockLabel } from '../../utils/stock';

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
    },
    product: {
      type: Object,
      value: null as WechatProductItem | null,
    },
    baseUrl: {
      type: String,
      value: baseUrl,
    },
  },

  data: {
    selectedSkuId: '',
    selectedSkuStockLabel: '',
    isPreviewShow: false,
    previewImageUrl: '',
    previewSpecName: '',
    previewPrice: '',
    statusBarHeight: 20,
  },

  observers: {
    visible(show: boolean) {
      if (!show) {
        this.resetPreview();
        return;
      }
      const product = this.properties.product as WechatProductItem | null;
      if (!product?.skus?.length) return;
      const firstAvailable =
        product.skus.find((s) => isSkuSelectable(s)) ?? product.skus[0];
      this.setData({
        selectedSkuId: firstAvailable.id,
        selectedSkuStockLabel: formatSkuStockLabel(firstAvailable.stock),
      });
    },
  },

  lifetimes: {
    attached() {
      try {
        const sys = wx.getSystemInfoSync();
        this.setData({
          statusBarHeight: sys.statusBarHeight ?? 20,
        });
      } catch {
        /* ignore */
      }
    },
  },

  methods: {
    resetPreview() {
      this.setData({
        isPreviewShow: false,
        previewImageUrl: '',
        previewSpecName: '',
        previewPrice: '',
      });
    },

    onClose() {
      this.resetPreview();
      this.triggerEvent('close');
    },

    onMaskTap() {
      this.onClose();
    },

    onSheetTap() {
      // 阻止点击弹层内容关闭
    },

    onSelectSku(e: WechatMiniprogram.TouchEvent) {
      const id = e.currentTarget.dataset.id as string;
      const sku = (this.properties.product as WechatProductItem)?.skus.find(
        (s) => s.id === id
      );
      if (!sku || !isSkuSelectable(sku)) {
        wx.showToast({ title: '该规格暂时售罄', icon: 'none' });
        return;
      }
      this.setData({
        selectedSkuId: id,
        selectedSkuStockLabel: formatSkuStockLabel(sku.stock),
      });
    },

    onPreviewSkuImage(e: WechatMiniprogram.TouchEvent) {
      const id = e.currentTarget.dataset.id as string;
      const sku = (this.properties.product as WechatProductItem)?.skus.find(
        (s) => s.id === id
      );
      if (!sku) return;
      const imageUrl = sku.imageUrl || (this.properties.product as WechatProductItem).imageUrl;
      if (!imageUrl) {
        wx.showToast({ title: '暂无款式大图', icon: 'none' });
        return;
      }
      this.setData({
        isPreviewShow: true,
        previewImageUrl: imageUrl,
        previewSpecName: sku.specName,
        previewPrice: sku.price,
        selectedSkuId: id,
      });
    },

    onClosePreview() {
      this.resetPreview();
    },

    onPreviewMaskTap() {
      this.onClosePreview();
    },

    onPreviewImageTap() {
      // 点击图片不关闭
    },

    onPreviewInfoTap() {
      // 点击底部信息栏不关闭
    },

    onConfirm() {
      const product = this.properties.product as WechatProductItem | null;
      if (!product) return;

      const sku = product.skus.find((s) => s.id === this.data.selectedSkuId);
      if (!sku || !isSkuSelectable(sku)) {
        wx.showToast({ title: '请选择有货的款式', icon: 'none' });
        return;
      }

      this.resetPreview();
      this.triggerEvent('confirm', {
        spuId: product.id,
        skuId: sku.id,
        skuCode: sku.skuCode,
        specName: sku.specName,
        price: sku.price,
        imageUrl: sku.imageUrl || product.imageUrl,
        shippingFee: product.shippingFee,
        name: product.name,
      });
    },
  },
});
