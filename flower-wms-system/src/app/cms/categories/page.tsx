import { redirect } from "next/navigation";

/** 旧路径重定向至商品分类管理 */
export default function LegacyCategoriesRedirect() {
  redirect("/cms/product-categories");
}
