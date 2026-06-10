/**
 * 纯函数单测 — 运行：npm run test:cms-pickers
 */
import assert from "node:assert/strict";
import {
  generateRecommendationSlotKey,
  validateCmsKey,
} from "./cms-auto-key";

assert.equal(validateCmsKey("home_main"), null);
assert.equal(validateCmsKey("scene_birthday"), null);
assert.match(validateCmsKey("") ?? "", /不能为空/);
assert.match(validateCmsKey("HOME_MAIN") ?? "", /只能包含/);
assert.match(validateCmsKey("bad key") ?? "", /只能包含/);

assert.equal(
  generateRecommendationSlotKey({ slotType: "HOME_MAIN" }),
  "home_main"
);
assert.equal(
  generateRecommendationSlotKey({ slotType: "NEW_ARRIVAL" }),
  "new_arrival"
);
assert.equal(
  generateRecommendationSlotKey({
    slotType: "SCENE",
    sceneType: "BIRTHDAY",
  }),
  "scene_birthday"
);

console.log("cms-auto-key tests passed");
