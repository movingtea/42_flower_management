/**
 * Run with:
 *   npx tsx src/app/v2/orders/pagination.test.ts
 */
import assert from "node:assert/strict";
import {
  ORDER_PAGE_SIZE,
  buildOrderQuery,
  clampPage,
  pageHref,
  parsePage,
  totalPages,
  visiblePageNumbers,
} from "./pagination";

function query(href: string): URLSearchParams {
  return new URLSearchParams(href.split("?")[1] ?? "");
}

function testParsePage() {
  assert.equal(ORDER_PAGE_SIZE, 20);
  assert.equal(parsePage(undefined), 1);
  assert.equal(parsePage(""), 1);
  assert.equal(parsePage("   "), 1);
  assert.equal(parsePage("1"), 1);
  assert.equal(parsePage(" 4 "), 4);
  assert.equal(parsePage("0"), 1);
  assert.equal(parsePage("-3"), 1);
  assert.equal(parsePage("2.5"), 1);
  assert.equal(parsePage("abc"), 1);
  assert.equal(parsePage("2"), 2);
  assert.equal(parsePage(["2"]), 1);
}

function testTotalAndClamp() {
  assert.equal(totalPages(0), 1);
  assert.equal(totalPages(20), 1);
  assert.equal(totalPages(21), 2);
  assert.equal(totalPages(40), 2);
  assert.equal(totalPages(41), 3);
  assert.equal(totalPages(10, 0), 1);
  assert.equal(clampPage(5, 41), 3);
  assert.equal(clampPage(3, 41), 3);
  assert.equal(clampPage(2, 41), 2);
  assert.equal(clampPage(0, 41), 1);
  assert.equal(clampPage(Number.NaN, 41), 1);
}

function testBuildQueryAndHref() {
  const filters = { q: "A 001", commercial: "CONFIRMED", supply: "ON_HAND_COVERED" };
  const pageTwo = query(pageHref(2, filters));
  assert.equal(pageTwo.get("q"), "A 001");
  assert.equal(pageTwo.get("commercial"), "CONFIRMED");
  assert.equal(pageTwo.get("supply"), "ON_HAND_COVERED");
  assert.equal(pageTwo.get("page"), "2");

  const firstPage = pageHref(1, filters);
  assert.ok(firstPage.startsWith("/v2/orders?"));
  assert.equal(query(firstPage).get("page"), null);
  assert.equal(query(firstPage).get("q"), "A 001");

  assert.equal(pageHref(1, {}), "/v2/orders");
  assert.equal(buildOrderQuery({}, 1), "");
  assert.equal(buildOrderQuery({ q: "x" }, 1), "q=x");
  // A stale page key must not leak into the new query.
  assert.equal(new URLSearchParams(buildOrderQuery({ q: "x", page: "9" }, 2)).get("page"), "2");
}

function testVisiblePageNumbers() {
  assert.deepEqual(visiblePageNumbers(1, 1), [1]);
  assert.deepEqual(visiblePageNumbers(1, 10), [1, 2, 3]);
  assert.deepEqual(visiblePageNumbers(5, 10), [3, 4, 5, 6, 7]);
  assert.deepEqual(visiblePageNumbers(10, 10), [8, 9, 10]);
  assert.deepEqual(visiblePageNumbers(99, 10), [8, 9, 10]);
  assert.deepEqual(visiblePageNumbers(5, 10, 1), [4, 5, 6]);
}

function run() {
  testParsePage();
  testTotalAndClamp();
  testBuildQueryAndHref();
  testVisiblePageNumbers();
  console.log("orders pagination tests passed");
}

run();
