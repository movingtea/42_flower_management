/**
 * Run: npm run test:banner-validity
 */
import assert from "node:assert/strict";
import { resolveBannerCmsStatus } from "./banner-rules-pure";

const NOW = new Date("2026-06-10T10:00:00.000Z");

function testStatuses() {
  assert.equal(
    resolveBannerCmsStatus(
      { isActive: true, isDeleted: false, startsAt: null, endsAt: null },
      NOW
    ),
    "展示中"
  );
  assert.equal(
    resolveBannerCmsStatus(
      {
        isActive: true,
        isDeleted: false,
        startsAt: new Date("2026-06-15T00:00:00.000Z"),
        endsAt: null,
      },
      NOW
    ),
    "未开始"
  );
  assert.equal(
    resolveBannerCmsStatus(
      {
        isActive: true,
        isDeleted: false,
        startsAt: null,
        endsAt: new Date("2026-06-01T00:00:00.000Z"),
      },
      NOW
    ),
    "已过期"
  );
  assert.equal(
    resolveBannerCmsStatus(
      { isActive: false, isDeleted: false, startsAt: null, endsAt: null },
      NOW
    ),
    "已停用"
  );
  assert.equal(
    resolveBannerCmsStatus(
      { isActive: true, isDeleted: true, startsAt: null, endsAt: null },
      NOW
    ),
    "已删除"
  );
}

testStatuses();
console.log("banner-validity.test.ts: all tests passed");
