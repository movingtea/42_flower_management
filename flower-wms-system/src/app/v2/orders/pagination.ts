/** Orders shown per board page; the board still groups the current page only. */
export const ORDER_PAGE_SIZE = 20;

export type PageSearchParam = string | string[] | undefined;

/** Query-string values that can be carried across order pages. */
export type OrderPageFilters = Readonly<Record<string, string | undefined>>;

/** Accept only a positive integer; anything else falls back to the first page. */
export function parsePage(value: PageSearchParam): number {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!/^\d+$/.test(raw)) return 1;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

/** At least one page is always rendered, even when the filtered result is empty. */
export function totalPages(total: number, pageSize: number = ORDER_PAGE_SIZE): number {
  if (!Number.isFinite(total) || total <= 0) return 1;
  if (!Number.isFinite(pageSize) || pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Clamp an out-of-range request to the last available page. */
export function clampPage(page: number, total: number, pageSize: number = ORDER_PAGE_SIZE): number {
  const pages = totalPages(total, pageSize);
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.min(Math.floor(page), pages);
}

/** Serialize the active order filters, adding the page only when it is not the first. */
export function buildOrderQuery(filters: OrderPageFilters, page: number): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (key === "page") continue;
    if (typeof value === "string" && value) params.set(key, value);
  }
  if (page > 1) params.set("page", String(page));
  return params.toString();
}

export function pageHref(page: number, filters: OrderPageFilters): string {
  const query = buildOrderQuery(filters, page);
  return query ? `/v2/orders?${query}` : "/v2/orders";
}

/** A compact page window (current page ± radius) that stays inside the valid range. */
export function visiblePageNumbers(current: number, total: number, radius: number = 2): number[] {
  const pages = Math.max(1, Math.floor(total));
  const active = Math.min(Math.max(1, Math.floor(current)), pages);
  const first = Math.max(1, active - Math.max(0, Math.floor(radius)));
  const last = Math.min(pages, active + Math.max(0, Math.floor(radius)));
  const numbers: number[] = [];
  for (let page = first; page <= last; page += 1) numbers.push(page);
  return numbers;
}
