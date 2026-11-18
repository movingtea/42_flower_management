import Link from "next/link";
import { ORDER_PAGE_SIZE, pageHref, visiblePageNumbers, type OrderPageFilters } from "./pagination";

const pageLink = "rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50";
const currentPage = "rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white";
const disabledPage = "rounded-lg border border-stone-200 bg-stone-100 px-3 py-1.5 text-sm text-stone-400";

/** Server-rendered pagination; every link keeps the active filters and page. */
export function OrderPagination({ page, pages, total, filters }: {
  page: number;
  pages: number;
  total: number;
  filters: OrderPageFilters;
}) {
  return (
    <nav
      aria-label="订单分页"
      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-white px-5 py-3 shadow-sm"
    >
      <p className="text-sm text-stone-600">
        共 {total} 单 · 第 {page} / {pages} 页
        <span className="ml-2 text-xs text-stone-400">每页 {ORDER_PAGE_SIZE} 单</span>
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {page > 1
          ? <Link className={pageLink} href={pageHref(page - 1, filters)} rel="prev">上一页</Link>
          : <span className={disabledPage} aria-disabled="true">上一页</span>}
        {visiblePageNumbers(page, pages).map((number) => number === page
          ? <span key={number} className={currentPage} aria-current="page">{number}</span>
          : <Link key={number} className={pageLink} href={pageHref(number, filters)}>{number}</Link>)}
        {page < pages
          ? <Link className={pageLink} href={pageHref(page + 1, filters)} rel="next">下一页</Link>
          : <span className={disabledPage} aria-disabled="true">下一页</span>}
      </div>
    </nav>
  );
}
