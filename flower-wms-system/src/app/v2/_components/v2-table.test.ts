import assert from "node:assert/strict";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { V2Table } from "./V2Ui";

/**
 * `createElement`'s typed overloads model required `children` as a prop, while
 * the lint rule requires them as additional arguments. This narrow cast keeps
 * the render test on the supported call shape.
 */
const Table = V2Table as unknown as ComponentType<Record<string, unknown>>;

/**
 * Run with: npx tsx src/app/v2/_components/v2-table.test.ts
 *
 * The server-rendered table owns the field-based width contract. This render
 * test catches a missing colgroup, a mismatched field order or a lost
 * `data-field` marker without needing a database or browser.
 */

function main(): void {
  const html = renderToStaticMarkup(createElement(Table, {
    label: "示例列表",
    fields: ["image", "name", "numeric", "action"],
    minWidthClass: "min-w-[40rem]",
  },
    createElement("caption", { key: "caption", className: "sr-only" }, "示例列表"),
    createElement("thead", { key: "head" },
      createElement("tr", null,
        createElement("th", { scope: "col" }, "图片"),
        createElement("th", { scope: "col" }, "名称"),
        createElement("th", { scope: "col" }, "数量"),
        createElement("th", { scope: "col" }, "操作"),
      ),
    ),
    createElement("tbody", { key: "body" },
      createElement("tr", null,
        createElement("td", null, "图"),
        createElement("td", null, "玫瑰"),
        createElement("td", null, "1"),
        createElement("td", null, "查看"),
      ),
    ),
  ));

  assert.match(html, /role="region"/);
  assert.match(html, /aria-label="示例列表"/);
  assert.match(html, /<colgroup>/);
  assert.match(html, /data-field="image"/);
  assert.match(html, /data-field="name"/);
  assert.match(html, /data-field="numeric"/);
  assert.match(html, /data-field="action"/);
  assert.match(html, /width:5\.5rem/);
  assert.match(html, /width:calc\(16em \+ 2rem\)/);
  assert.match(html, /width:calc\(8em \+ 2rem\)/);
  assert.match(html, /width:14rem/);

  // Without `fields` the legacy shell keeps its original markup.
  const legacy = renderToStaticMarkup(createElement(Table, { label: "旧列表" },
    createElement("tbody", null,
      createElement("tr", null, createElement("td", null, "旧")),
    ),
  ));
  assert.doesNotMatch(legacy, /<colgroup>/);

  console.log("v2-table.test.ts passed");
}

main();
