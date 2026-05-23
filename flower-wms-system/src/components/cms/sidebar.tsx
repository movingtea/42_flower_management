"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/cms/products", label: "商城商品", icon: "🌸" },
  { href: "/cms/product-categories", label: "商品分类", icon: "🏷️" },
  { href: "/cms/banner", label: "首页轮播", icon: "🖼️" },
  { href: "/cms/marketing", label: "营销配置", icon: "✨" },
];

export function CmsSidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-rose-100 bg-white">
      <div className="border-b border-rose-100 px-5 py-6">
        <p className="text-xs font-medium uppercase tracking-wider text-rose-400">
          CMS
        </p>
        <h1 className="mt-1 text-lg font-semibold text-rose-900">
          小程序运营内容
        </h1>
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-3">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-rose-50 text-rose-700"
                  : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
              }`}
            >
              <span aria-hidden>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-rose-100 p-4">
        <Link href="/" className="text-xs text-zinc-500 hover:text-rose-600">
          ← 返回工作台
        </Link>
      </div>
    </aside>
  );
}
