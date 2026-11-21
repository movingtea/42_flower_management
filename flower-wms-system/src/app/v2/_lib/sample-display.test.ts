import assert from "node:assert/strict";
import { sampleDisplayName, shortSampleCode } from "./sample-display";

/**
 * Run with: npx tsx src/app/v2/_lib/sample-display.test.ts
 *
 * Pins the picker label contract: sample pickers show only the name, never the
 * generated code. The short code is reserved for the empty/code-like-name
 * fallback so such rows remain distinguishable.
 */

const longUuidCode =
  "SMP-20261120-3180135a-a0c2-467f-88ab-1234567890ab";

function main(): void {
  // Short/manual codes stay intact for the fallback path.
  assert.equal(shortSampleCode("003"), "003");
  assert.equal(shortSampleCode("SMP-1"), "SMP-1");
  assert.equal(shortSampleCode("SMP-20260101"), "SMP-20260101");

  // Generated codes collapse to a prefix plus the last six alphanumerics.
  assert.equal(shortSampleCode("SMP-20260101-AB12CD34"), "SMP-…12CD34");
  assert.equal(shortSampleCode(longUuidCode), "SMP-…7890AB");
  assert.ok(shortSampleCode(longUuidCode).length < longUuidCode.length);

  // The picker label is the name, even when the code is UUID-length.
  assert.equal(
    sampleDisplayName({ code: longUuidCode, name: "高原红花束" }),
    "高原红花束",
  );
  assert.equal(
    sampleDisplayName({ code: "SMP-20260101-AB12CD34", name: "  高原红与香豌豆  " }),
    "高原红与香豌豆",
  );

  // Empty or code-like names fall back to the short code.
  assert.equal(sampleDisplayName({ code: longUuidCode, name: "" }), "SMP-…7890AB");
  assert.equal(sampleDisplayName({ code: longUuidCode, name: "   " }), "SMP-…7890AB");
  assert.equal(
    sampleDisplayName({ code: longUuidCode, name: longUuidCode }),
    "SMP-…7890AB",
  );

  console.log("sample display tests passed");
}

main();
