import assert from "node:assert/strict";
import {
  CONSUMABLE_MATERIAL_KINDS,
  CONSUMABLE_SCOPE,
  DEFAULT_MATERIAL_RETURN_TO,
  FLOWER_MATERIAL_KINDS,
  FLOWER_SCOPE,
  MATERIAL_RETURN_TO_PATHS,
  isMaterialReturnTo,
} from "./material-scope";

/**
 * Run with: npx tsx src/app/v2/materials/_components/material-scope.test.ts
 *
 * Locks the acceptance contract for the split material masters: the two pages
 * share one set of server actions, so the hidden `returnTo` field must be an
 * allow-listed module path and each scope must own a disjoint kind subset.
 */

function testReturnToAllowList() {
  assert.deepEqual([...MATERIAL_RETURN_TO_PATHS], ["/v2/materials", "/v2/consumables"]);
  assert.equal(DEFAULT_MATERIAL_RETURN_TO, "/v2/materials");

  for (const allowed of MATERIAL_RETURN_TO_PATHS) {
    assert.equal(isMaterialReturnTo(allowed), true, `${allowed} must be accepted`);
  }

  const rejected: unknown[] = [
    "/v2",
    "/v2/orders",
    "/v2/materials?message=ok",
    "/v2/consumables#drawer",
    "/v2/materials/",
    "/v2/consumables/extra",
    "//v2/materials",
    "https://example.com/v2/materials",
    "/v2/materials/../consumables",
    "",
    null,
    undefined,
    1,
  ];
  for (const value of rejected) {
    assert.equal(isMaterialReturnTo(value), false, `${String(value)} must be rejected`);
  }
}

function testScopesOwnDisjointKinds() {
  assert.deepEqual([...FLOWER_MATERIAL_KINDS], ["FLOWER", "FOLIAGE"]);
  assert.deepEqual([...CONSUMABLE_MATERIAL_KINDS], ["PACKAGING", "CONSUMABLE", "OTHER"]);

  const flowerKinds = new Set<string>(FLOWER_SCOPE.kinds);
  const consumableKinds = new Set<string>(CONSUMABLE_SCOPE.kinds);
  const overlap = [...flowerKinds].filter((kind) => consumableKinds.has(kind));
  assert.deepEqual(overlap, [], "a material kind must not appear on both masters");
  assert.equal(new Set([...flowerKinds, ...consumableKinds]).size, 5);
}

function testScopeCopyAndReturnTo() {
  assert.equal(FLOWER_SCOPE.basePath, "/v2/materials");
  assert.equal(FLOWER_SCOPE.title, "花材母表");
  assert.equal(FLOWER_SCOPE.showFlowerFields, true);
  assert.equal(FLOWER_SCOPE.create.trigger, "新增花材");
  assert.ok(FLOWER_SCOPE.description.includes("种类"));
  assert.ok(!isMaterialReturnTo(`${FLOWER_SCOPE.basePath}/x`));

  assert.equal(CONSUMABLE_SCOPE.basePath, "/v2/consumables");
  assert.equal(CONSUMABLE_SCOPE.title, "耗材母表");
  assert.equal(CONSUMABLE_SCOPE.showFlowerFields, false);
  assert.equal(CONSUMABLE_SCOPE.create.trigger, "新增耗材");
  assert.ok(CONSUMABLE_SCOPE.description.includes("规格"));
  assert.ok(!CONSUMABLE_SCOPE.filteredEmpty.description.includes("种类"));
  assert.ok(!isMaterialReturnTo(`${CONSUMABLE_SCOPE.basePath}/x`));

  // Both scopes must pass their own redirect target through the same allow-list.
  for (const scope of [FLOWER_SCOPE, CONSUMABLE_SCOPE]) {
    assert.equal(isMaterialReturnTo(scope.basePath), true);
  }
}

testReturnToAllowList();
testScopesOwnDisjointKinds();
testScopeCopyAndReturnTo();

console.log("material-scope.test.ts: all passed");
