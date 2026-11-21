import assert from "node:assert/strict";
import {
  filterSampleOptions,
  matchesSampleQuery,
  sampleSearchHaystack,
} from "./sample-option-search";
import type { SampleOption } from "../samples/_components/SampleEditors";

/**
 * Run with: npx tsx src/app/v2/sample-plans/sample-option-search.test.ts
 *
 * The drawer's main-sample picker is a client-side filter only. These tests
 * pin its matching contract: code, name and three-level classification are
 * searchable; whitespace and separators are ignored; tokens are AND-combined.
 */

function sample(
  code: string,
  name: string,
  classifications: SampleOption["classifications"] = [],
): SampleOption {
  return {
    id: code,
    code,
    name,
    state: "READY",
    materialCount: 1,
    priority: 0,
    classifications,
  };
}

function main(): void {
  const samples = [
    sample("003", "高原红花束", [
      { flowerVariety: "玫瑰", color: "红色", flowerProductName: "高原红" },
    ]),
    sample("SMP-20260101-AB12", "高原红与香豌豆"),
    sample("059", "高原红与流光粉", [
      { flowerVariety: "康乃馨", color: "浅粉色", flowerProductName: "流光粉" },
    ]),
    sample("028", "高原红与大丽花"),
  ];

  assert.deepEqual(filterSampleOptions(samples, ""), samples);
  assert.deepEqual(filterSampleOptions(samples, "   "), samples);
  assert.deepEqual(filterSampleOptions(samples, "003").map((row) => row.code), ["003"]);
  assert.deepEqual(filterSampleOptions(samples, "高原红花").map((row) => row.code), ["003"]);
  assert.deepEqual(
    filterSampleOptions(samples, "高原红").map((row) => row.code),
    ["003", "SMP-20260101-AB12", "059", "028"],
  );

  // Code search is case-insensitive and tolerates missing separators.
  assert.deepEqual(
    filterSampleOptions(samples, "smp20260101").map((row) => row.code),
    ["SMP-20260101-AB12"],
  );
  assert.equal(matchesSampleQuery(samples[1]!, "AB12"), true);

  // Classification fields participate in fuzzy matching.
  assert.deepEqual(filterSampleOptions(samples, "浅粉").map((row) => row.code), ["059"]);
  assert.deepEqual(filterSampleOptions(samples, "康乃馨 流光").map((row) => row.code), ["059"]);

  // Whitespace-separated tokens are AND conditions; an unmatched token yields none.
  assert.deepEqual(filterSampleOptions(samples, "003 高原").map((row) => row.code), ["003"]);
  assert.deepEqual(filterSampleOptions(samples, "003 香豌豆"), []);
  assert.deepEqual(filterSampleOptions(samples, "不存在"), []);

  // The optional limit caps the dropdown without reordering matches.
  assert.deepEqual(
    filterSampleOptions(samples, "高原红", 2).map((row) => row.code),
    ["003", "SMP-20260101-AB12"],
  );
  assert.deepEqual(filterSampleOptions(samples, "高原红", 0), []);
  assert.match(sampleSearchHaystack(samples[0]!), /003/);
  assert.match(sampleSearchHaystack(samples[0]!), /玫瑰红色高原红/);

  console.log("sample option search tests passed");
}

main();
