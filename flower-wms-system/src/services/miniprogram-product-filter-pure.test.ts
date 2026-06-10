/**
 * 纯函数单测 — 运行：npm run test:miniprogram-products
 */
import assert from "node:assert/strict";
import {
  BUDGET_TAG_PRICE_RANGES,
  matchAllFilterGroups,
  matchAnyTag,
  matchPriceRange,
  matchProductFilters,
  normalizeJsonTags,
  normalizeTagQueryFromSearchParams,
  paginateAfterFilter,
  sortProducts,
} from "./miniprogram-product-filter-pure";

function testNormalizeJsonTags() {
  assert.deepEqual(normalizeJsonTags(null), []);
  assert.deepEqual(normalizeJsonTags(undefined), []);
  assert.deepEqual(normalizeJsonTags([]), []);
  assert.deepEqual(normalizeJsonTags(["BIRTHDAY"]), ["BIRTHDAY"]);
  assert.deepEqual(
    normalizeJsonTags([{ key: "PINK", label: "粉色" }]),
    ["PINK"]
  );
  assert.deepEqual(normalizeJsonTags('["VISIT"]'), ["VISIT"]);
}

function testMatchAnyTag() {
  assert.equal(matchAnyTag(["BIRTHDAY", "VISIT"], []), true);
  assert.equal(matchAnyTag(["BIRTHDAY"], ["ANNIVERSARY"]), false);
  assert.equal(matchAnyTag(["BIRTHDAY"], ["BIRTHDAY", "VISIT"]), true);
}

function testMatchAllFilterGroupsAndOr() {
  const product = {
    occasionTags: ["BIRTHDAY"],
    colorTags: ["PINK"],
    styleTags: ["KOREAN"],
    relationshipTags: ["PARTNER"],
    budgetTags: ["BUDGET_268_398"],
    positioningTags: [],
  };

  assert.equal(
    matchAllFilterGroups(product, {
      occasionTags: ["BIRTHDAY", "ANNIVERSARY"],
      colorTags: ["PINK", "WHITE_GREEN"],
      styleTags: [],
      relationshipTags: [],
      budgetTags: [],
      positioningTags: [],
    }),
    true
  );

  assert.equal(
    matchAllFilterGroups(product, {
      occasionTags: ["BIRTHDAY"],
      colorTags: ["WHITE_GREEN"],
      styleTags: [],
      relationshipTags: [],
      budgetTags: [],
      positioningTags: [],
    }),
    false
  );
}

function testSceneTypeMerge() {
  const params = new URLSearchParams(
    "sceneType=BIRTHDAY&occasionTag=ANNIVERSARY&page=1&pageSize=10"
  );
  const q = normalizeTagQueryFromSearchParams(params);
  assert.ok(q.tagFilters.occasionTags.includes("BIRTHDAY"));
  assert.ok(q.tagFilters.occasionTags.includes("ANNIVERSARY"));
  assert.equal(q.page, 1);
  assert.equal(q.pageSize, 10);
}

function testPriceRange() {
  assert.equal(matchPriceRange(300, 400, 250, 500), true);
  assert.equal(matchPriceRange(300, 400, 500, null), false);
  assert.equal(matchPriceRange(300, 400, null, 250), false);
}

function testBudgetTagPriceFallback() {
  const productNoBudgetTag = {
    occasionTags: [],
    colorTags: [],
    styleTags: [],
    relationshipTags: [],
    budgetTags: [],
    positioningTags: [],
  };

  assert.equal(
    matchProductFilters(
      productNoBudgetTag,
      380,
      420,
      {
        occasionTags: [],
        colorTags: [],
        styleTags: [],
        relationshipTags: [],
        budgetTags: ["BUDGET_398_498"],
        positioningTags: [],
      },
      null,
      null
    ),
    true
  );

  const productWithWrongBudget = {
    ...productNoBudgetTag,
    budgetTags: ["BUDGET_UNDER_268"],
  };
  assert.equal(
    matchProductFilters(
      productWithWrongBudget,
      380,
      420,
      {
        occasionTags: [],
        colorTags: [],
        styleTags: [],
        relationshipTags: [],
        budgetTags: ["BUDGET_398_498"],
        positioningTags: [],
      },
      null,
      null
    ),
    false
  );
}

function testPaginateAfterFilter() {
  const items = [1, 2, 3, 4, 5];
  const page1 = paginateAfterFilter(items, 1, 2);
  assert.deepEqual(page1.items, [1, 2]);
  assert.equal(page1.total, 5);
  assert.equal(page1.totalPages, 3);

  const page3 = paginateAfterFilter(items, 3, 2);
  assert.deepEqual(page3.items, [5]);
}

function testSortPrice() {
  const items = [
    {
      minPriceNum: 500,
      maxPriceNum: 600,
      createdAt: new Date("2024-01-01"),
      positioningTags: [],
      name: "B",
    },
    {
      minPriceNum: 200,
      maxPriceNum: 300,
      createdAt: new Date("2024-06-01"),
      positioningTags: [],
      name: "A",
    },
  ];

  const asc = sortProducts(items, "price_asc");
  assert.equal(asc[0].minPriceNum, 200);

  const desc = sortProducts(items, "price_desc");
  assert.equal(desc[0].maxPriceNum, 600);
}

function testEmptyTagsNoCrash() {
  assert.equal(
    matchProductFilters(
      {
        occasionTags: [],
        colorTags: [],
        styleTags: [],
        relationshipTags: [],
        budgetTags: [],
        positioningTags: [],
      },
      0,
      0,
      {
        occasionTags: [],
        colorTags: [],
        styleTags: [],
        relationshipTags: [],
        budgetTags: [],
        positioningTags: [],
      },
      null,
      null
    ),
    true
  );
  assert.ok(BUDGET_TAG_PRICE_RANGES.BUDGET_268_398);
}

function run() {
  testNormalizeJsonTags();
  testMatchAnyTag();
  testMatchAllFilterGroupsAndOr();
  testSceneTypeMerge();
  testPriceRange();
  testBudgetTagPriceFallback();
  testPaginateAfterFilter();
  testSortPrice();
  testEmptyTagsNoCrash();
  console.log("miniprogram-product-filter-pure.test.ts: all passed");
}

run();
