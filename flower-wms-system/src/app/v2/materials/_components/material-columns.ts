import type { V2ColumnField } from "../../_components/table-columns";

/**
 * Column order shared by the material-master header and every row.
 *
 * Field-based widths keep the image/action columns compact while code and name
 * stay readable. Role, colour, category and unit values are only a few glyphs,
 * so they use the compact `short` width; variety/product/spec values use
 * `medium` and may wrap. Without that split, every classification column
 * reserved ten CJK glyphs and pushed the name/cost/action columns off-screen.
 *
 * The flower and consumable masters differ only in the classification block and
 * the consumable-only safety-stock column, so the order lives here rather than
 * being duplicated in the table markup.
 */
export function materialColumnFields(flower: boolean): readonly V2ColumnField[] {
  return [
    "image",
    "code",
    "name",
    "short",
    ...(flower
      ? ["short", "medium", "short", "medium"] as const
      : ["medium", "medium", "medium"] as const),
    "short",
    ...(flower ? [] : ["numeric"] as const),
    "numeric",
    "status",
    "action",
  ];
}
