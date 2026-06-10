"use client";

import { RecipePicker } from "@/components/cms/pickers/RecipePicker";

export type RecipeOption = {
  id: string;
  recipeCode: string;
  name: string;
  ingredientSummary: string;
  ingredientCount: number;
};

type Props = {
  value: string | null;
  onChange: (recipeId: string | null) => void;
  disabled?: boolean;
  compact?: boolean;
};

/** @deprecated 请使用 RecipePicker；保留此导出以兼容旧引用 */
export function RecipeSelect({ value, onChange, disabled, compact }: Props) {
  return (
    <RecipePicker
      value={value}
      onChange={onChange}
      disabled={disabled}
      compact={compact}
    />
  );
}
