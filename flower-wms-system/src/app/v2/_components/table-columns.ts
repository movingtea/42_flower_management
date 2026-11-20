/**
 * Field-based column widths for the shared V2 table pattern.
 *
 * A column's width follows the field it renders, not one uniform width. Free
 * text keeps at least ten CJK glyphs on one line (`10em`, because one CJK glyph
 * is about one em); long names get more room, while image, numeric, status,
 * date and action columns only reserve what their content needs. `2rem` is the
 * horizontal cell padding because border-box sizing is used.
 *
 * `short` and `medium` exist for the material masters, where role, colour,
 * product name and unit values are only a few glyphs. Sizing those columns like
 * generic free text made the flower table far wider than its content and pushed
 * the name/cost/action columns off-screen, so compact fields reserve five or
 * seven CJK glyphs instead. Values in a `medium` column may wrap; the caller
 * must not force `whitespace-nowrap` on them.
 *
 * The map lives in a pure module so pages, unit tests and the `V2Table`
 * primitive share one contract without importing React or Next.js.
 */
export type V2ColumnField =
  | "image"
  | "code"
  | "name"
  | "text"
  | "short"
  | "medium"
  | "numeric"
  | "status"
  | "date"
  | "action";

export const V2_COLUMN_WIDTH: Readonly<Record<V2ColumnField, string>> = {
  image: "5.5rem",
  code: "calc(12em + 2rem)",
  name: "calc(16em + 2rem)",
  text: "calc(10em + 2rem)",
  short: "calc(5em + 2rem)",
  medium: "calc(7em + 2rem)",
  numeric: "calc(8em + 2rem)",
  status: "calc(10em + 2rem)",
  date: "calc(10em + 2rem)",
  action: "14rem",
};

/** Width style for one field, for tables that cannot use `V2Table`'s colgroup. */
export function v2ColumnWidth(field: V2ColumnField): { minWidth: string } {
  return { minWidth: V2_COLUMN_WIDTH[field] };
}
