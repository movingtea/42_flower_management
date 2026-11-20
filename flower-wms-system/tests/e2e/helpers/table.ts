import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Shared browser assertions for the V2 table column-width contract.
 *
 * `V2Table.fields` renders `<colgroup><col data-field=...>` so tests can verify
 * that width follows the rendered field rather than one uniform value.
 */

export const TEXT_COLUMN_FIELDS = new Set(["code", "name", "text", "status", "date"]);
/**
 * Compact material-master fields reserve five (`short`) or seven (`medium`) CJK
 * glyphs instead of the ten used by generic free text.
 */
export const COMPACT_COLUMN_FIELDS = new Map([
  ["short", 5],
  ["medium", 7],
]);

export type RenderedColumn = {
  label: string;
  width: number;
  fontSize: number;
};

export async function readFieldColumns(page: Page, table?: Locator) {
  const target = table ?? page.locator("main table").first();
  const fields = await target.locator("colgroup col").evaluateAll(
    (columns) => columns.map((column) => column.getAttribute("data-field") ?? ""),
  );
  const headers = await target.locator("thead th").evaluateAll(
    (cells) => cells.map((cell) => {
      const style = getComputedStyle(cell);
      return {
        label: cell.textContent?.trim() ?? "",
        width: cell.getBoundingClientRect().width,
        fontSize: Number.parseFloat(style.fontSize),
      };
    }),
  );
  return { fields, headers };
}

export function expectFieldWidths(fields: string[], headers: RenderedColumn[]): void {
  expect(headers).toHaveLength(fields.length);
  for (const [index, field] of fields.entries()) {
    const column = headers[index]!;
    if (TEXT_COLUMN_FIELDS.has(field)) {
      expect(column.width, `${column.label}（${field}）列宽`).toBeGreaterThanOrEqual(column.fontSize * 10);
    }
    const compactMinimum = COMPACT_COLUMN_FIELDS.get(field);
    if (compactMinimum) {
      expect(column.width, `${column.label}（${field}）列宽`).toBeGreaterThanOrEqual(column.fontSize * compactMinimum);
    }
  }
  const imageWidth = headers[fields.indexOf("image")]?.width ?? 0;
  const nameWidth = headers[fields.indexOf("name")]?.width ?? 0;
  const shortWidth = headers[fields.indexOf("short")]?.width ?? 0;
  const mediumWidth = headers[fields.indexOf("medium")]?.width ?? 0;
  const actionWidth = headers[fields.indexOf("action")]?.width ?? 0;
  expect(nameWidth).toBeGreaterThan(imageWidth);
  expect(nameWidth).toBeGreaterThan(shortWidth);
  if (mediumWidth > 0) {
    expect(mediumWidth).toBeLessThan(nameWidth);
  }
  expect(actionWidth).toBeGreaterThanOrEqual(200);
}
