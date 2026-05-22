import fs from "fs";

function u(s) {
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) =>
    String.fromCharCode(parseInt(h, 16))
  );
}

function write(path, raw) {
  const content = u(raw);
  fs.writeFileSync(path, content, "utf8");
  new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(path));
  console.log("OK", path);
}

write(
  "src/app/cms/products/page.tsx",
  String.raw`import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { prisma } from "@/lib/prisma";
import { PRODUCT_TYPE_PRODUCT } from "@/lib/product-type";
import { ProductCategory } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

const CATEGORY_LABEL: Record<ProductCategory, string> = {
  [ProductCategory.FLOWER]: "\\u9c9c\\u82b1",
  [ProductCategory.LEAF]: "\\u53f6\\u6750",
  [ProductCategory.PACK]: "\\u5305\\u6750",
  [ProductCategory.FINISHED]: "\\u6210\\u54c1",
};

export default async function CmsProductsPage() {
  const products = await prisma.product.findMany({
    where: { type: PRODUCT_TYPE_PRODUCT },
    orderBy: { updatedAt: "desc" },
    include: { batches: { select: { remainingQty: true } } },
  });

  return (
    <div>
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-rose-900">\\u5546\\u57ce\\u5546\\u54c1</h2>
          <p className="mt-1 text-sm text-zinc-500">\\u4ec5\\u7ba1\\u7406\\u5c0f\\u7a0b\\u5e8f\\u6210\\u54c1\\uff08PRODUCT\\uff09\\uff0c\\u539f\\u6750\\u6599\\u5728 WMS \\u5e93\\u5b58/\\u5165\\u5e93\\u6a21\\u5757\\u7ef4\\u62a4</p>
        </div>
        <Link href="/cms/products/new" className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700">+ \\u65b0\\u5efa\\u5546\\u54c1</Link>
      </header>
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-zinc-50">
            <tr>
              <th className="px-4 py-3 font-medium text-zinc-600">\u5546\u54c1</th>
              <th className="px-4 py-3 font-medium text-zinc-600">\u5206\u7c7b</th>
              <th className="px-4 py-3 font-medium text-zinc-600">\u552e\u4ef7</th>
              <th className="px-4 py-3 font-medium text-zinc-600">\u5e93\u5b58</th>
              <th className="px-4 py-3 font-medium text-zinc-600">\u72b6\u6001</th>
              <th className="px-4 py-3 font-medium text-zinc-600">\u64cd\u4f5c</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {products.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-zinc-500">\u6682\u65e0\u5546\u54c1\uff0c<Link href="/cms/products/new" className="text-rose-600">\u65b0\u5efa\u7b2c\u4e00\u4e2a</Link></td></tr>
            ) : products.map((p) => {
              const stock = p.batches.reduce((s, b) => s + b.remainingQty, 0);
              return (
                <tr key={p.id} className="hover:bg-zinc-50/50">
                  <td className="px-4 py-3"><p className="font-medium">{p.name}</p><p className="text-xs text-zinc-500">{p.sku}</p></td>
                  <td className="px-4 py-3">{CATEGORY_LABEL[p.category]}</td>
                  <td className="px-4 py-3">{p.sellPrice ? \`\u00a5\${p.sellPrice}\` : "\u2014"}</td>
                  <td className="px-4 py-3">{stock}</td>
                  <td className="px-4 py-3">{p.isActive ? <Badge variant="success">\u5df2\u4e0a\u67b6</Badge> : <Badge variant="default">\u672a\u4e0a\u67b6</Badge>}</td>
                  <td className="px-4 py-3"><Link href={\`/cms/products/\${p.id}\`} className="text-rose-600 hover:underline">\u7f16\u8f91</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
`
);

write(
  "src/app/wms/batches/page.tsx",
  String.raw`import { InboundForm } from "@/app/wms/batches/InboundForm";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function BatchesPage() {
  const recentInbound = await prisma.batch.findMany({
    orderBy: { inboundAt: "desc" },
    take: 10,
    include: { product: { select: { name: true, unit: true } } },
  });

  return (
    <div>
      <header className="mb-8">
        <h2 className="text-2xl font-semibold text-zinc-900">\u91c7\u8d2d\u5165\u5e93</h2>
        <p className="mt-1 text-sm text-zinc-500">\u586b\u5199 SKU\u3001\u82b1\u6750\u3001\u6570\u91cf\u4e0e\u74f6\u63d2\u671f\uff0c\u63d0\u4ea4\u540e\u5199\u5165\u5546\u54c1\u3001\u6279\u6b21\u4e0e\u5165\u5e93\u6d41\u6c34</p>
      </header>
      <InboundForm />
      <section>
        <h3 className="mb-4 text-sm font-semibold text-zinc-900">\u6700\u8fd1\u5165\u5e93</h3>
        {recentInbound.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-200 bg-white px-4 py-8 text-center text-sm text-zinc-500">\u6682\u65e0\u5165\u5e93\u8bb0\u5f55\uff0c\u8bf7\u63d0\u4ea4\u7b2c\u4e00\u7b14\u91c7\u8d2d\u5165\u5e93</p>
        ) : (
          <ul className="space-y-3">
            {recentInbound.map((row) => (
              <li key={row.id} className="rounded-xl border bg-white px-4 py-3 shadow-sm">
                <p className="font-medium">{row.batchNo ?? "\u2014"} \u00b7 {row.product.name} +{row.originalQty} {row.product.unit}</p>
                <p className="text-sm text-zinc-500">
                  {row.supplier ? \`\${row.supplier} \u00b7 \` : ""}
                  {row.expiresAt ? \`\u74f6\u63d2\u671f\u81f3 \${row.expiresAt.toLocaleDateString("zh-CN")} \u00b7 \` : ""}
                  {row.inboundAt.toLocaleString("zh-CN")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
`
);
