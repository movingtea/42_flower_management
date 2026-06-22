/**
 * Run with:
 *   npx tsx src/lib/master-parts-pure.test.ts
 */
import assert from "node:assert/strict";
import {
  DEFAULT_MASTER_PART_TYPE,
  getDefaultMasterPartValues,
  masterPartTypeLabels,
  normalizeMasterPartCreateInput,
  parseMasterPartType,
} from "@/lib/master-parts-pure";

function testTypeLabels() {
  assert.equal(masterPartTypeLabels.SUPPLY, "辅料");
  assert.equal(masterPartTypeLabels.PACKAGING, "包装材料");
  assert.equal(masterPartTypeLabels.TOOL, "工具");
  assert.equal(masterPartTypeLabels.OTHER, "其他");
}

function testInvalidType() {
  assert.throws(() => parseMasterPartType("FLOWER"), /只能为/);
  assert.throws(() => parseMasterPartType(""), /请选择物料类型/);
  assert.throws(() => parseMasterPartType("INVALID"), /只能为/);
}

function testDefaults() {
  const defaults = getDefaultMasterPartValues();
  assert.equal(defaults.type, DEFAULT_MASTER_PART_TYPE);
  assert.equal(defaults.isConsumable, true);
  assert.equal(defaults.isActive, true);
}

function testCreateInputNormalize() {
  const input = normalizeMasterPartCreateInput({
    type: "PACKAGING",
    name: " 包装纸 ",
    spec: "50cm",
    defaultUnit: "卷",
    isConsumable: false,
    isActive: true,
    note: "测试",
  });
  assert.equal(input.type, "PACKAGING");
  assert.equal(input.name, "包装纸");
  assert.equal(input.spec, "50cm");
  assert.equal(input.defaultUnit, "卷");
  assert.equal(input.isConsumable, false);
  assert.equal(input.isActive, true);
}

function testCreateInputDefaults() {
  const input = normalizeMasterPartCreateInput({ name: "扎带" });
  assert.equal(input.type, "SUPPLY");
  assert.equal(input.isConsumable, true);
  assert.equal(input.isActive, true);
}

function testCreateInputRequiresName() {
  assert.throws(() => normalizeMasterPartCreateInput({ type: "TOOL" }), /物料名称不能为空/);
}

function run() {
  testTypeLabels();
  testInvalidType();
  testDefaults();
  testCreateInputNormalize();
  testCreateInputDefaults();
  testCreateInputRequiresName();
  console.log("master-parts-pure.test.ts: all passed");
}

run();
