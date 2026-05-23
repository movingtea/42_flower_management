import type { CmsProductCategoryItem } from "@/lib/cms-product-categories";

export type ProductEditorInitial = {
  sku: string;
  name: string;
  category: string[];
  sellPrice: string;
  quantity: number;
  isActive: boolean;
  needsShipping: boolean;
  shippingFee: string;
  description: string;
  careTips: string;
  imageUrl: string;
};

export type ProductEditorProps = {
  productId: string;
  isNew: boolean;
  initial: ProductEditorInitial;
  categoryOptions: CmsProductCategoryItem[];
};
