import Link from "next/link";
import { buildOrderQuery, type OrderPageFilters } from "./pagination";

export type OrderView = "board" | "list";

const OPTIONS: ReadonlyArray<{ value: OrderView; label: string; description: string }> = [
  { value: "board", label: "看板", description: "按履约阶段分组，适合推进和操作" },
  { value: "list", label: "列表", description: "按订单逐行浏览，适合检索和核对" },
];

function viewHref(view: OrderView, filters: OrderPageFilters, page: number): string {
  const query = buildOrderQuery(view === "list" ? { ...filters, view: "list" } : filters, page);
  return query ? `/v2/orders?${query}` : "/v2/orders";
}

/**
 * Board/list switch. Both destinations carry the active filters and page so
 * changing the presentation never resets the query.
 */
export function OrderViewToggle({
  view,
  filters,
  page,
}: {
  view: OrderView;
  filters: OrderPageFilters;
  page: number;
}) {
  return <nav aria-label="订单视图" className="inline-flex rounded-xl border border-stone-200 bg-white p-1 shadow-sm">
    {OPTIONS.map((option) => {
      const active = option.value === view;
      return <Link
        key={option.value}
        href={viewHref(option.value, filters, page)}
        aria-current={active ? "page" : undefined}
        title={option.description}
        className={`rounded-lg px-3 py-1.5 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700 ${
          active
            ? "bg-emerald-700 text-white"
            : "text-stone-600 hover:bg-stone-50 hover:text-stone-900"
        }`}
      >
        {option.label}
      </Link>;
    })}
  </nav>;
}
