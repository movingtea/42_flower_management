#!/usr/bin/env node
/**
 * Sprint 3 / S3-B: validate the V1 -> V2 WMS regression inventory and render the
 * checklist artifact.
 *
 * Design constraints:
 * - Pure Node ESM, zero dependencies, no child_process.
 * - The required ID list is deliberately mirrored here (from the first-phase
 *   scope in docs/flower-studio-2.0-v1-v2-gap-matrix.md) instead of trusting
 *   only the data file, so deleting an ID from the data cannot weaken the gate.
 * - Evidence paths and v2Entry pages are checked against real repository files.
 *
 * Usage:
 *   node scripts/release/check-wms-regression.mjs [--json] [--fail-on-blocked]
 *   node scripts/release/check-wms-regression.mjs --write-checklist <path>
 */

import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REGRESSION_ITEMS,
  REQUIRED_IDS,
  STATUSES,
} from "./wms-regression-data.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_APP_ROOT = resolve(SCRIPT_DIR, "../..");
const DEFAULT_REPO_ROOT = resolve(DEFAULT_APP_ROOT, "..");

export const BASELINE_COMMIT = "b4d93d8";
export const BASELINE_SUBJECT = "feat(wms): complete Sprint 2 operational oversight";
export const CHECKLIST_GATE_COMMAND =
  "node scripts/release/check-wms-regression.mjs --fail-on-blocked";

/**
 * Canonical first-phase WMS must-test IDs. Keep in sync with
 * docs/flower-studio-2.0-v1-v2-gap-matrix.md ("第一阶段 WMS 必须完成的矩阵范围").
 */
export const CANONICAL_REQUIRED_IDS = Object.freeze([
  "A01", "A02", "A03", "A04", "A05", "A06", "A07", "A08",
  "B01", "B02", "B03", "B04", "B05", "B06", "B07", "B08", "B09", "B10", "B11",
  "C01", "C02", "C03", "C04", "C05", "C06", "C07", "C08", "C09", "C10",
  "D03", "D04", "D05", "D09", "D10", "D11",
  "E01", "E02", "E03", "E04", "E05", "E06", "E07", "E08", "E09", "E10", "E11", "E12",
  "H01", "H02", "H03", "H04", "H05", "H06", "H07", "H08", "H09",
]);

export const CANONICAL_STATUSES = Object.freeze([
  "verified",
  "partial",
  "blocked",
  "not_applicable",
]);

const ID_PATTERN = /^[A-H][0-9]{2}$/;

const STATUS_META = Object.freeze({
  verified: {
    label: "✅ 已验证",
    legend: "证据可复现且签署完成；`reason`/`impact` 为空。",
  },
  partial: {
    label: "🟡 部分覆盖",
    legend:
      "主路径可用，但存在未覆盖分支或体验差异；必须填写原因、影响和签署。",
  },
  blocked: {
    label: "⛔ 阻断",
    legend: "第一阶段能力缺失或不可用；必须填写原因、影响和签署。",
  },
  not_applicable: {
    label: "➖ 不适用",
    legend: "经签署确认不在本阶段范围；必须填写原因和签署。",
  },
});

const AREA_LABELS = Object.freeze({
  A: "账号/权限",
  B: "物料/库存",
  C: "采购/验收",
  D: "商品/配方",
  E: "订单/履约",
  H: "报表/保障",
});

function trimText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isFile(filePath) {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function displayPath(filePath, repoRoot) {
  return relative(repoRoot, filePath).replaceAll("\\", "/");
}

function sameStringList(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (leftSet.size !== left.length || rightSet.size !== right.length) return false;
  return left.every((value) => rightSet.has(value));
}

function emptyStatusCounts() {
  return {
    verified: 0,
    partial: 0,
    blocked: 0,
    not_applicable: 0,
  };
}

function buildSummary(items, requiredIds) {
  const byStatus = emptyStatusCounts();
  const areaKeys = new Set(requiredIds.map((id) => String(id).charAt(0)));
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const area =
      trimText(item.area) ||
      (typeof item.id === "string" && item.id ? item.id.charAt(0) : "");
    if (area) areaKeys.add(area);
  }

  const byArea = {};
  for (const area of [...areaKeys].sort()) {
    byArea[area] = { total: 0, ...emptyStatusCounts() };
  }

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const status = trimText(item.status);
    const area =
      trimText(item.area) ||
      (typeof item.id === "string" && item.id ? item.id.charAt(0) : "");
    if (Object.hasOwn(byStatus, status)) byStatus[status] += 1;
    if (area && byArea[area]) {
      byArea[area].total += 1;
      if (Object.hasOwn(byArea[area], status)) byArea[area][status] += 1;
    }
  }

  return {
    total: items.length,
    required: requiredIds.length,
    byStatus,
    byArea,
  };
}

/**
 * Resolve a /v2 entry to its page.tsx. Supports literal dynamic segments such as
 * /v2/inventory/[id] (the bracket directory is used as-is) and strips query or
 * hash suffixes such as /v2/reports?tab=loss and /v2/operations#loss.
 */
function entryPagePath(entry, appRoot) {
  const pathname = entry.split(/[?#]/)[0];
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (normalized !== "/v2" && !normalized.startsWith("/v2/")) return null;
  const segments = normalized.slice(1).split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return null;
  }
  return join(appRoot, "src", "app", ...segments, "page.tsx");
}

/**
 * Validate the regression inventory. Pure: no process exit, no I/O writes.
 *
 * @param {Array<object>} items
 * @param {object} [options]
 * @param {string[]} [options.requiredIds] canonical IDs the inventory must match
 * @param {string[]|null} [options.declaredRequiredIds] data-file REQUIRED_IDS
 * @param {string[]|null} [options.declaredStatuses] data-file STATUSES
 * @param {string} [options.repoRoot] repository root for evidence paths
 * @param {string} [options.appRoot] flower-wms-system root for src/app/v2
 * @param {boolean} [options.checkFiles] set false only for pure field fixtures
 * @returns {{ok:boolean, errors:Array<object>, warnings:Array<object>, summary:object, requiredIds:string[]}}
 */
export function validateRegressionData(items, options = {}) {
  const {
    requiredIds = CANONICAL_REQUIRED_IDS,
    declaredRequiredIds = null,
    declaredStatuses = null,
    repoRoot = DEFAULT_REPO_ROOT,
    appRoot = DEFAULT_APP_ROOT,
    checkFiles = true,
  } = options;

  const required = Array.isArray(requiredIds) ? [...requiredIds] : [];
  const errors = [];
  const warnings = [];

  const addError = (code, id, field, message) => {
    errors.push({ code, id: id || null, field: field || null, message });
  };

  if (!Array.isArray(items)) {
    addError("ITEMS_NOT_ARRAY", null, "items", "regression data must be an array");
    return {
      ok: false,
      errors,
      warnings,
      summary: buildSummary([], required),
      requiredIds: required,
    };
  }

  if (declaredRequiredIds !== null) {
    if (!sameStringList(declaredRequiredIds, required)) {
      addError(
        "REQUIRED_IDS_MISMATCH",
        null,
        "REQUIRED_IDS",
        `data-file REQUIRED_IDS must contain exactly the ${required.length} canonical IDs`,
      );
    }
  }

  if (declaredStatuses !== null) {
    if (!sameStringList(declaredStatuses, CANONICAL_STATUSES)) {
      addError(
        "STATUSES_MISMATCH",
        null,
        "STATUSES",
        `data-file STATUSES must be exactly: ${CANONICAL_STATUSES.join(", ")}`,
      );
    }
  }

  const idCounts = new Map();
  const requiredSet = new Set(required);

  items.forEach((item, index) => {
    const indexLabel = `#${index + 1}`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      addError("INVALID_ITEM", indexLabel, null, "inventory item must be an object");
      return;
    }

    const rawId = item.id;
    const id = trimText(rawId);
    const itemLabel = id || indexLabel;

    if (!id) {
      addError("MISSING_ID", indexLabel, "id", "id must be a non-empty string");
    } else {
      idCounts.set(id, (idCounts.get(id) || 0) + 1);
      if (!ID_PATTERN.test(id)) {
        addError(
          "INVALID_ID_FORMAT",
          id,
          "id",
          `id "${id}" must match one of A01-A08, B01-B11, C01-C10, D03-D05/D09-D11, E01-E12, H01-H09`,
        );
      }
    }

    const area = trimText(item.area);
    if (!area) {
      addError("MISSING_AREA", itemLabel, "area", "area must be non-empty");
    } else if (id && area !== id.charAt(0)) {
      addError(
        "AREA_MISMATCH",
        itemLabel,
        "area",
        `area "${area}" must match ID prefix "${id.charAt(0)}"`,
      );
    }

    if (!trimText(item.title)) {
      addError("MISSING_TITLE", itemLabel, "title", "title must be non-empty");
    }

    if (!trimText(item.v1Capability)) {
      addError(
        "MISSING_V1_CAPABILITY",
        itemLabel,
        "v1Capability",
        "v1Capability must be non-empty",
      );
    }

    const entry = trimText(item.v2Entry);
    if (!entry) {
      addError("MISSING_V2_ENTRY", itemLabel, "v2Entry", "v2Entry must be non-empty");
    } else {
      const pagePath = entryPagePath(entry, appRoot);
      if (!pagePath) {
        addError(
          "INVALID_V2_ENTRY",
          itemLabel,
          "v2Entry",
          `v2Entry "${entry}" must be /v2 or start with /v2/ and may not contain "." or ".." segments`,
        );
      } else if (checkFiles && !isFile(pagePath)) {
        addError(
          "V2_ENTRY_NOT_FOUND",
          itemLabel,
          "v2Entry",
          `no page.tsx found for "${entry}" (expected ${displayPath(pagePath, repoRoot)})`,
        );
      }
    }

    if (!Array.isArray(item.evidence) || item.evidence.length === 0) {
      addError(
        "EMPTY_EVIDENCE",
        itemLabel,
        "evidence",
        "evidence must be a non-empty array of repository-relative file paths",
      );
    } else {
      // Duplicates within one item are errors. Reusing the same file across
      // different IDs is legitimate (one E2E spec often covers several IDs).
      const seenEvidence = new Set();
      item.evidence.forEach((rawEvidence, evidenceIndex) => {
        const field = `evidence[${evidenceIndex}]`;
        if (typeof rawEvidence !== "string" || !rawEvidence.trim()) {
          addError(
            "INVALID_EVIDENCE_PATH",
            itemLabel,
            field,
            "evidence path must be a non-empty string",
          );
          return;
        }

        const evidence = rawEvidence.trim().replaceAll("\\", "/");
        const segments = evidence.split("/");
        if (
          evidence.startsWith("/") ||
          /^[A-Za-z]:/.test(evidence) ||
          segments.some(
            (segment) => segment === "" || segment === "." || segment === "..",
          )
        ) {
          addError(
            "INVALID_EVIDENCE_PATH",
            itemLabel,
            field,
            `evidence path must be repository-relative without "." or ".." segments: ${rawEvidence}`,
          );
          return;
        }

        const absolutePath = resolve(repoRoot, evidence);
        const fromRoot = relative(repoRoot, absolutePath);
        if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
          addError(
            "INVALID_EVIDENCE_PATH",
            itemLabel,
            field,
            `evidence path escapes the repository root: ${rawEvidence}`,
          );
          return;
        }

        if (seenEvidence.has(evidence)) {
          addError(
            "DUPLICATE_EVIDENCE",
            itemLabel,
            field,
            `duplicate evidence path: ${evidence}`,
          );
        }
        seenEvidence.add(evidence);

        if (checkFiles && !isFile(absolutePath)) {
          addError(
            "EVIDENCE_NOT_FOUND",
            itemLabel,
            field,
            `evidence file not found from repository root: ${evidence}`,
          );
        }
      });
    }

    const status = trimText(item.status);
    if (!CANONICAL_STATUSES.includes(status)) {
      addError(
        "INVALID_STATUS",
        itemLabel,
        "status",
        `status must be one of ${CANONICAL_STATUSES.join(", ")}; received ${JSON.stringify(item.status)}`,
      );
      return;
    }

    const reason = trimText(item.reason);
    const impact = trimText(item.impact);
    const signoff = trimText(item.signoff);

    if (status === "verified") {
      if (reason) {
        addError(
          "UNEXPECTED_REASON",
          itemLabel,
          "reason",
          "verified items must not carry an open reason",
        );
      }
      if (impact) {
        addError(
          "UNEXPECTED_IMPACT",
          itemLabel,
          "impact",
          "verified items must not carry an open impact",
        );
      }
      if (!signoff) {
        addError("MISSING_SIGNOFF", itemLabel, "signoff", "verified items need a signoff");
      }
    } else if (status === "partial" || status === "blocked") {
      if (!reason) {
        addError(
          "MISSING_REASON",
          itemLabel,
          "reason",
          `${status} items must explain the open reason`,
        );
      }
      if (!impact) {
        addError(
          "MISSING_IMPACT",
          itemLabel,
          "impact",
          `${status} items must state the impact`,
        );
      }
      if (!signoff) {
        addError(
          "MISSING_SIGNOFF",
          itemLabel,
          "signoff",
          `${status} items need a signoff`,
        );
      }
      warnings.push({
        code: status === "blocked" ? "BLOCKED_ITEM" : "PARTIAL_ITEM",
        id: itemLabel,
        status,
        reason,
        impact,
        signoff,
        message:
          status === "blocked"
            ? "blocked must carry reason, impact and signoff"
            : "partial coverage must carry reason, impact and signoff",
      });
    } else {
      // not_applicable: a documented waiver still needs a reason and an owner.
      if (!reason) {
        addError(
          "MISSING_REASON",
          itemLabel,
          "reason",
          "not_applicable items must explain why the capability is out of scope",
        );
      }
      if (!signoff) {
        addError(
          "MISSING_SIGNOFF",
          itemLabel,
          "signoff",
          "not_applicable items need a signoff",
        );
      }
      warnings.push({
        code: "NOT_APPLICABLE_ITEM",
        id: itemLabel,
        status,
        reason,
        impact,
        signoff,
        message: "not_applicable must carry reason and signoff",
      });
    }
  });

  for (const [id, count] of idCounts) {
    if (count > 1) {
      addError(
        "DUPLICATE_ID",
        id,
        "id",
        `id "${id}" appears ${count} times; required IDs must appear exactly once`,
      );
    }
  }

  for (const id of required) {
    if (!idCounts.has(id)) {
      addError(
        "MISSING_REQUIRED_ID",
        id,
        "id",
        `required ID "${id}" is missing from the regression inventory`,
      );
    }
  }

  for (const id of idCounts.keys()) {
    if (!requiredSet.has(id)) {
      addError(
        "UNKNOWN_ID",
        id,
        "id",
        `id "${id}" is not in the first-phase must-test scope`,
      );
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: buildSummary(items, required),
    requiredIds: required,
  };
}

/**
 * Exit code contract:
 *   1 = validation errors (including unreadable data)
 *   2 = validation passed but a blocked item exists with --fail-on-blocked
 *   0 = pass
 */
export function exitCodeFor(result, { failOnBlocked = false } = {}) {
  if (!result.ok) return 1;
  if (failOnBlocked && result.summary.byStatus.blocked > 0) return 2;
  return 0;
}

function truncate(value, maxLength) {
  const text = String(value ?? "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function formatHumanReport(
  result,
  { failOnBlocked = false, checklistPath = null, maxReasonLength = 160 } = {},
) {
  const { summary } = result;
  const lines = [
    "WMS regression checklist check",
    `  required IDs: ${summary.required}; items: ${summary.total}`,
    `  status: ${CANONICAL_STATUSES.map((status) => `${status}=${summary.byStatus[status]}`).join(", ")}`,
    `  areas (verified/partial/blocked/not_applicable, total): ${Object.entries(summary.byArea)
      .map(
        ([area, counts]) =>
          `${area} ${counts.verified}/${counts.partial}/${counts.blocked}/${counts.not_applicable} (${counts.total})`,
      )
      .join(", ")}`,
  ];

  if (result.warnings.length > 0) {
    lines.push("", `Non-verified items (${result.warnings.length}):`);
    for (const warning of result.warnings) {
      const reason = warning.reason
        ? ` — ${truncate(warning.reason, maxReasonLength)}`
        : " — (missing reason)";
      lines.push(`  - ${warning.id ?? "?"} [${warning.status}]${reason}`);
    }
  }

  if (result.errors.length > 0) {
    lines.push("", `Errors (${result.errors.length}):`);
    for (const error of result.errors) {
      const prefix = error.id ? `${error.id} ` : "";
      lines.push(`  - ${prefix}${error.code}: ${error.message}`);
    }
  }

  lines.push("");
  if (!result.ok) {
    lines.push("Result: FAIL — fix the validation errors above.");
  } else if (failOnBlocked && summary.byStatus.blocked > 0) {
    lines.push(
      `Result: FAIL — ${summary.byStatus.blocked} blocked item(s) present and --fail-on-blocked is set.`,
    );
  } else {
    const notes = [];
    if (summary.byStatus.partial > 0) notes.push(`${summary.byStatus.partial} partial`);
    if (summary.byStatus.blocked > 0) {
      notes.push(`${summary.byStatus.blocked} blocked (explained)`);
    }
    if (summary.byStatus.not_applicable > 0) {
      notes.push(`${summary.byStatus.not_applicable} not_applicable`);
    }
    lines.push(`Result: PASS${notes.length > 0 ? ` with ${notes.join(", ")}` : ""}.`);
  }

  if (checklistPath) lines.push(`Checklist written to ${checklistPath}`);
  return lines.join("\n");
}

function markdownCell(value) {
  return String(value ?? "")
    .trim()
    .replaceAll("|", "\\|")
    .replace(/\r?\n/g, "<br>");
}

function markdownCode(value) {
  return `\`${markdownCell(value).replaceAll("`", "\\`")}\``;
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Render the human-readable checklist from the inventory. The CLI only calls
 * this after validation passes, so every row has a known status and signoff.
 */
export function renderChecklist(items, options = {}) {
  const {
    date = formatLocalDate(new Date()),
    baseline = BASELINE_COMMIT,
    baselineSubject = BASELINE_SUBJECT,
    requiredIds = CANONICAL_REQUIRED_IDS,
    scope = "第一阶段 WMS 必测 56 项（A01–A08、B01–B11、C01–C10、D03–D05、D09–D11、E01–E12、H01–H09）；CMS、CRM、小程序及 D01–D02、D06–D08、D12–D14 不在本清单关闭范围。",
    dataPath = "flower-wms-system/scripts/release/wms-regression-data.mjs",
  } = options;

  const sorted = [...items]
    .filter((item) => item && typeof item === "object")
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const summary = buildSummary(sorted, requiredIds);
  const nonVerified = sorted.filter((item) => trimText(item.status) !== "verified");
  const baselineText = baselineSubject
    ? `\`${baseline} ${baselineSubject}\``
    : `\`${baseline}\``;

  const lines = [
    "# Sprint 3 第一阶段 WMS 回归清单",
    "",
    `- **日期**：${date}`,
    `- **基线**：${baselineText}`,
    `- **范围**：${scope}`,
    `- **数据源**：\`${dataPath}\`（机器可读，供校验脚本使用）`,
    "- **校验**：在 `flower-wms-system/` 下运行 `node scripts/release/check-wms-regression.mjs`",
    `- **预生产门禁**：\`${CHECKLIST_GATE_COMMAND}\`（存在 blocked 项时非 0 退出）`,
    "- **状态图例**：",
  ];

  for (const status of CANONICAL_STATUSES) {
    lines.push(`  - ${STATUS_META[status].label} \`${status}\`：${STATUS_META[status].legend}`);
  }

  lines.push(
    "",
    "## 汇总",
    "",
    "| 状态 | 数量 |",
    "|---|---:|",
  );
  for (const status of CANONICAL_STATUSES) {
    lines.push(`| ${STATUS_META[status].label} \`${status}\` | ${summary.byStatus[status]} |`);
  }
  lines.push(`| **合计** | **${summary.total}** |`, "");

  lines.push(
    "| 领域 | 必测 | ✅ 已验证 | 🟡 部分覆盖 | ⛔ 阻断 | ➖ 不适用 |",
    "|---|---:|---:|---:|---:|---:|",
  );
  for (const area of Object.keys(summary.byArea).sort()) {
    const counts = summary.byArea[area];
    const areaLabel = AREA_LABELS[area] ? `${area} ${AREA_LABELS[area]}` : area;
    lines.push(
      `| ${areaLabel} | ${counts.total} | ${counts.verified} | ${counts.partial} | ${counts.blocked} | ${counts.not_applicable} |`,
    );
  }
  lines.push(
    `| **合计** | **${summary.total}** | **${summary.byStatus.verified}** | **${summary.byStatus.partial}** | **${summary.byStatus.blocked}** | **${summary.byStatus.not_applicable}** |`,
    "",
    `非 \`verified\` 项共 **${nonVerified.length}** 项（partial ${summary.byStatus.partial} + blocked ${summary.byStatus.blocked} + not_applicable ${summary.byStatus.not_applicable}）。默认校验允许已解释的 blocked 项并以 0 退出；预生产门禁 \`--fail-on-blocked\` 在存在 blocked 项时非 0 退出。`,
    "",
    "## 逐项清单",
    "",
    "> 证据路径均相对仓库根 `CMS_and_WMS`。V2 入口均为 `/v2` 下的实际 `page.tsx`；动态路由按 `[id]` 目录校验。",
    "",
    "| ID | 领域 | V1 能力 / 检查项 | V2 入口 | 状态 | 证据 | 未关闭原因 / 影响 | 签署 |",
    "|---|---|---|---|---|---|---|---|",
  );

  for (const item of sorted) {
    const status = trimText(item.status);
    const statusLabel = STATUS_META[status]?.label ?? status;
    const area = trimText(item.area);
    const areaLabel = AREA_LABELS[area] ? `${area} ${AREA_LABELS[area]}` : area;
    const capability = `**${markdownCell(item.title)}**<br>${markdownCell(item.v1Capability)}`;
    const entryNote = trimText(item.entryNote);
    const entry = markdownCode(item.v2Entry) + (entryNote ? `<br><sub>${markdownCell(entryNote)}</sub>` : "");

    const evidence = Array.isArray(item.evidence) && item.evidence.length > 0
      ? item.evidence.map((path) => markdownCode(path)).join("<br>")
      : "—";

    let openItems = "—";
    if (status === "partial" || status === "blocked") {
      openItems = `**原因：** ${markdownCell(item.reason)}<br>**影响：** ${markdownCell(item.impact)}`;
    } else if (status === "not_applicable") {
      openItems = `**原因：** ${markdownCell(item.reason)}`;
    }

    lines.push(
      `| ${markdownCell(item.id)} | ${areaLabel} | ${capability} | ${entry} | ${statusLabel} | ${evidence} | ${openItems} | ${markdownCell(item.signoff)} |`,
    );
  }

  lines.push("", "## 阻断/部分覆盖项", "");
  if (nonVerified.length === 0) {
    lines.push("当前全部项均为 `verified`，无阻断或部分覆盖项。", "");
  } else {
    lines.push(
      `以下列出全部 ${nonVerified.length} 个非 \`verified\` 项；完整证据与签署见上表。预生产门禁前必须逐项确认影响和签署。`,
      "",
    );
    for (const [status, heading] of [
      ["blocked", "阻断"],
      ["partial", "部分覆盖"],
      ["not_applicable", "不适用"],
    ]) {
      const group = sorted.filter((item) => trimText(item.status) === status);
      if (group.length === 0) continue;
      lines.push(`### ${heading}（${group.length}）`, "");
      for (const item of group) {
        const details = [];
        if (trimText(item.reason)) details.push(`原因：${trimText(item.reason)}`);
        if (status !== "not_applicable" && trimText(item.impact)) {
          details.push(`影响：${trimText(item.impact)}`);
        }
        if (trimText(item.signoff)) details.push(`签署：${trimText(item.signoff)}`);
        lines.push(
          `- **${markdownCell(item.id)} ${markdownCell(item.title)}** — ${details.length > 0 ? details.join("<br>") : "未填写"}`,
        );
      }
      lines.push("");
    }
  }

  lines.push(
    "---",
    "",
    "生成命令（仓库根）：",
    "",
    "```bash",
    "node flower-wms-system/scripts/release/check-wms-regression.mjs --write-checklist docs/stage-artifacts/sprints/sprint-3-wms-regression-checklist.md",
    "```",
    "",
    "数据变更后重新生成；不要手工修改状态。门禁结果以脚本退出码为准。",
    "",
  );

  return lines.join("\n");
}

export function parseArgs(argv) {
  const options = {
    json: false,
    failOnBlocked: false,
    writeChecklist: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") {
      options.json = true;
    } else if (argument === "--fail-on-blocked") {
      options.failOnBlocked = true;
    } else if (argument === "--write-checklist") {
      const value = argv[index + 1];
      if (!value) throw new Error("--write-checklist requires a path");
      options.writeChecklist = value;
      index += 1;
    } else if (argument.startsWith("--write-checklist=")) {
      const value = argument.slice("--write-checklist=".length);
      if (!value) throw new Error("--write-checklist requires a path");
      options.writeChecklist = value;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }

  return options;
}

function printUsage() {
  console.log(
    [
      "Usage: node scripts/release/check-wms-regression.mjs [options]",
      "",
      "Options:",
      "  --json                  Print machine-readable JSON and exit.",
      "  --fail-on-blocked       Exit 2 when any blocked item exists (pre-production gate).",
      "  --write-checklist PATH  Write the Markdown checklist (validation must pass).",
      "  -h, --help              Show this help.",
      "",
      "Exit codes: 0 pass, 1 validation error, 2 blocked item under --fail-on-blocked.",
    ].join("\n"),
  );
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`Argument error: ${error.message}`);
    console.error("Run with --help for usage.");
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    printUsage();
    return;
  }

  const result = validateRegressionData(REGRESSION_ITEMS, {
    requiredIds: CANONICAL_REQUIRED_IDS,
    declaredRequiredIds: REQUIRED_IDS,
    declaredStatuses: STATUSES,
    repoRoot: DEFAULT_REPO_ROOT,
    appRoot: DEFAULT_APP_ROOT,
  });

  let checklistPath = null;
  if (options.writeChecklist && result.ok) {
    try {
      const target = resolve(process.cwd(), options.writeChecklist);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(
        target,
        renderChecklist(REGRESSION_ITEMS, {
          date: formatLocalDate(new Date()),
          requiredIds: CANONICAL_REQUIRED_IDS,
        }),
        "utf8",
      );
      checklistPath = target;
    } catch (error) {
      result.errors.push({
        code: "CHECKLIST_WRITE_FAILED",
        id: null,
        field: "--write-checklist",
        message: error.message,
      });
      result.ok = false;
    }
  }

  const exitCode = exitCodeFor(result, { failOnBlocked: options.failOnBlocked });

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          schemaVersion: 1,
          baseline: BASELINE_COMMIT,
          generatedAt: new Date().toISOString(),
          ok: result.ok,
          failOnBlocked: options.failOnBlocked,
          gatePassed: options.failOnBlocked
            ? result.ok && result.summary.byStatus.blocked === 0
            : result.ok,
          exitCode,
          summary: result.summary,
          errors: result.errors,
          warnings: result.warnings,
          checklist: checklistPath,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      formatHumanReport(result, {
        failOnBlocked: options.failOnBlocked,
        checklistPath,
      }),
    );
    if (options.writeChecklist && !checklistPath) {
      console.log("Checklist not written because validation failed.");
    }
  }

  process.exitCode = exitCode;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  main();
}
