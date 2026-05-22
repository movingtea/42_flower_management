"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/wms/dashboard", label: "仪表盘", icon: "📊" },
  { href: "/wms/inventory", label: "库存管理", icon: "📦" },
  { href: "/wms/batches", label: "采购入库", icon: "📥" },
  { href: "/wms/wastage", label: "损耗登记", icon: "🥀" },
  { href: "/wms/orders", label: "订单履约", icon: "📋" },
];

export function WmsSidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-200 bg-white">
      <div className="border-b border-zinc-200 px-5 py-6">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">
          WMS
        </p>
        <h1 className="mt-1 text-lg font-semibold text-zinc-900">
          仓储物流与履约
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
                  ? "bg-zinc-100 text-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
              }`}
            >
              <span aria-hidden>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-zinc-200 p-4">
        <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-800">
          ← 返回工作台
        </Link>
      </div>
    </aside>
  );
}
