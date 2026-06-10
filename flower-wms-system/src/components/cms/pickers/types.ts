export type ProductPickerItem = {
  id: string;
  name: string;
  categoryName: string | null;
  status: "active" | "inactive";
  coverImage: string;
  priceRange: string;
  skuCount: number;
  readinessStatus: string;
  productDecisionSummary: {
    healthStatus: string;
    healthStatusLabel: string;
  };
};

export type ProductSkuPickerItem = {
  id: string;
  name: string;
  price: string;
  isActive: boolean;
  recipeId: string | null;
  recipeName: string | null;
  marginSummary: string | null;
};

export type RecipePickerItem = {
  id: string;
  name: string;
  bomNo: string;
  packagingKitName: string | null;
  estimatedCost: string;
  ingredientSummary: string;
};

export type RecommendationSlotPickerItem = {
  id: string;
  key: string;
  name: string;
  slotType: string;
  sceneType: string | null;
  isActive: boolean;
};
