import Link from "next/link";
import { CmsProductsOperationsList } from "@/app/cms/products/CmsProductsOperationsList";
import { loadCmsProductCategories } from "@/lib/cms-product-categories.server";

export const dynamic = "force-dynamic";

export default async function CmsProductsPage() {
  const categoryConfig = await loadCmsProductCategories();

  return (
    <div>
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-rose-900">商品列表</h2>
          <p className="mt-1 text-sm text-zinc-500">
            运营摘要、上架校验与推荐位状态一览。删除为软删除，历史订单不受影响。
          </p>
        </div>
        <Link
          href="/cms/products/new"
          className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700"
        >
          + 新增商品
        </Link>
      </header>

      <CmsProductsOperationsList categoryConfig={categoryConfig} />
    </div>
  );
}
