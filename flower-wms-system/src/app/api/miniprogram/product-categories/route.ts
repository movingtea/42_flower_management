import { jsonError } from "@/lib/api";
import { jsonWechatSuccess } from "@/lib/wechat-api";
import type { ProductCategoryTreeNode } from "@/lib/product-category";
import { loadProductCategoryTree } from "@/lib/product-category.server";

export const dynamic = "force-dynamic";

export type WechatProductCategoryNode = {
  id: string;
  name: string;
  sortOrder: number;
  parentId: string | null;
  imageUrl: string | null;
  children: WechatProductCategoryNode[];
};

function mapActiveTree(
  nodes: ProductCategoryTreeNode[]
): WechatProductCategoryNode[] {
  return nodes
    .filter((n) => n.isActive)
    .map((n) => ({
      id: n.id,
      name: n.name,
      sortOrder: n.sortOrder,
      parentId: n.parentId,
      imageUrl: n.imageUrl,
      children: mapActiveTree(n.children),
    }));
}

/** GET：小程序商品分类树（按 sortOrder 升序，含 children） */
export async function GET() {
  try {
    const tree = await loadProductCategoryTree();
    const categories = mapActiveTree(tree);

    return jsonWechatSuccess({
      tree: categories,
      categories,
      total: categories.length,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "商品分类加载失败";
    return jsonError(message, 500);
  }
}
