export type ProductSkuEditorRow = {
  id?: string;
  skuCode?: string;
  specName: string;
  price: string;
  stock: number;
  imageUrl: string;
  isMainImage: boolean;
  sortOrder?: number;
  recipeId: string | null;
};

export type ProductEditorInitial = {
  name: string;
  category: string[];
  occasionTags: string[];
  description: string;
  maintenanceGuide: string;
  isActive: boolean;
  needsShipping: boolean;
  shippingFee: string;
  skus: ProductSkuEditorRow[];
  displaySku: string;
  displayImageUrl: string;
  displayMinPrice: string;
};

export type ProductEditorProps = {
  productId: string;
  isNew: boolean;
  initial: ProductEditorInitial;
};
