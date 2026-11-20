import assert from "node:assert/strict";
import {
  isV2ControlFlowError,
  runV2DrawerAction,
  v2ActionErrorMessage,
} from "./action-result";

/**
 * Run with: npx tsx src/app/v2/_lib/action-result.test.ts
 *
 * The shared drawer contract: ordinary failures become inline results, a
 * missing success message falls back to the caller's label, and Next.js
 * control-flow errors are never swallowed as form feedback.
 */
async function main(): Promise<void> {
  assert.deepEqual(
    await runV2DrawerAction(async () => "物料已创建，编号 MAT-1", "物料已创建"),
    { ok: true, message: "物料已创建，编号 MAT-1" },
  );

  assert.deepEqual(
    await runV2DrawerAction(async () => undefined, "物料已更新"),
    { ok: true, message: "物料已更新" },
  );

  assert.deepEqual(
    await runV2DrawerAction(async () => "", "供应商已更新"),
    { ok: true, message: "供应商已更新" },
  );

  assert.deepEqual(
    await runV2DrawerAction(async () => {
      throw new Error("物料名称必填");
    }, "物料已创建"),
    { ok: false, error: "物料名称必填" },
  );

  assert.deepEqual(
    await runV2DrawerAction(async () => {
      throw {};
    }, "物料已创建"),
    { ok: false, error: "操作失败" },
  );

  const controlFlow = { digest: "NEXT_REDIRECT;replace;/v2;307" };
  assert.equal(isV2ControlFlowError(controlFlow), true);
  assert.equal(isV2ControlFlowError(new Error("普通错误")), false);
  await assert.rejects(
    () =>
      runV2DrawerAction(async () => {
        throw controlFlow;
      }, "物料已创建"),
    (error: unknown) => {
      assert.equal(error, controlFlow);
      return true;
    },
  );

  assert.equal(v2ActionErrorMessage(new Error("原始错误")), "原始错误");
  assert.equal(v2ActionErrorMessage("字符串错误", "操作失败"), "操作失败");

  console.log("v2 drawer action result tests passed");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
