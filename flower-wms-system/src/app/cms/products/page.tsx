import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { formatCmsCategoryLabels } from "@/lib/cms-product-categories";
import { loadCmsProductCategories } from "@/lib/cms-product-categories.server";
import {
  categoryIdsFromProduct,
  productCategoriesInclude,
} from "@/lib/product-categories";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function CmsProductsPage() {
  const [products, categoryConfig] = await Promise.all([
    prisma.product.findMany({
      orderBy: { updatedAt: "desc" },
      include: productCategoriesInclude,
    }),
    loadCmsProductCategories(),
  ]);

  return (
    <div>
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-rose-900">商品列表</h2>
          <p className="mt-1 text-sm text-zinc-500">
            用于管理商品信息。
          </p>
        </div>
        <Link
          href="/cms/products/new"
          className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700"
        >
          + 新增商品
        </Link>
      </header>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-zinc-50">
            <tr>
              <th className="px-4 py-3 font-medium text-zinc-600">品名</th>
              <th className="px-4 py-3 font-medium text-zinc-600">分类</th>
              <th className="px-4 py-3 font-medium text-zinc-600">零售价</th>
              <th className="px-4 py-3 font-medium text-zinc-600">可售数量</th>
              <th className="px-4 py-3 font-medium text-zinc-600">上架状态</th>
              <th className="px-4 py-3 font-medium text-zinc-600">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {products.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-zinc-500">
                    暂无商品，请点击新增商品按钮。
                  <Link href="/cms/products/new" className="text-rose-600">
                    新增商品
                  </Link>
                </td>
              </tr>
            ) : (
              products.map((p) => {
                const categoryIds = categoryIdsFromProduct(p);
                return (
                  <tr key={p.id} className="hover:bg-zinc-50/50">
                    <td className="px-4 py-3">
                      <p className="font-medium">{p.name}</p>
                      <p className="text-xs text-zinc-500">{p.sku}</p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {categoryIds.length === 0 ? (
                          <span className="text-zinc-400">无分类</span>
                        ) : (
                          categoryIds.map((cid) => (
                            <span
                              key={cid}
                              className="rounded-full bg-rose-50 px-2 py-0.5 text-xs text-rose-700"
                            >
                              {formatCmsCategoryLabels([cid], categoryConfig)}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {p.price ? `¥${p.price}` : "¥0"}
                    </td>
                    <td className="px-4 py-3">{p.quantity}</td>
                    <td className="px-4 py-3">
                      {p.status === "PUBLISHED" ? (
                        <Badge variant="success">上架</Badge>
                      ) : (
                        <Badge variant="default">{p.status}</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/cms/products/${p.id}`}
                        className="text-rose-600 hover:underline"
                      >
                        编辑
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
