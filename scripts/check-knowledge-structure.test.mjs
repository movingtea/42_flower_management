import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  KNOWN_EXCEPTIONS,
  RULE_CODES,
  normalizeChecks,
  parseFrontmatter,
  runCheck,
} from "./check-knowledge-structure.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "check-knowledge-structure.mjs");
const FIXTURES = join(HERE, "fixtures", "knowledge-structure");
const VALID_ROOT = join(FIXTURES, "valid");
const INVALID_ROOT = join(FIXTURES, "invalid");
const INVALID_EXCEPTIONS = join(FIXTURES, "invalid-exceptions.json");
const VALID_EXCEPTIONS = join(VALID_ROOT, "exceptions.json");

function runCli(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
}

function runJson(args) {
  const result = runCli([...args, "--json"]);
  assert.equal(result.stderr.trim(), "", `unexpected stderr: ${result.stderr}`);
  assert.ok(result.stdout.trim().length > 0, "expected a JSON summary on stdout");
  return { status: result.status, summary: JSON.parse(result.stdout.trim()) };
}

function errorCodes(summary) {
  return new Set(summary.errors.map((error) => error.code));
}

function warningCodes(summary) {
  return new Set(summary.warnings.map((warning) => warning.code));
}

test("valid knowledge fixture passes every structural rule", () => {
  const { status, summary } = runJson(["--root", VALID_ROOT, "--exceptions", VALID_EXCEPTIONS]);
  assert.equal(status, 0);
  assert.equal(summary.status, "passed");
  assert.deepEqual(summary.errors, []);
  assert.deepEqual(summary.exceptions, []);
  assert.equal(summary.counts.knowledgeFiles, 9);
  assert.equal(summary.counts.featureSpecs, 1);
  assert.equal(summary.counts.testPlans, 1);
  assert.equal(summary.counts.adrDocs, 2);
  assert.equal(summary.counts.links > 0, true);
  assert.equal(summary.counts.wikilinks > 0, true);
});

test("valid fixture tolerates no exception and reports no warning", () => {
  const { summary } = runJson(["--root", VALID_ROOT, "--exceptions", VALID_EXCEPTIONS]);
  assert.deepEqual(summary.warnings, []);
  assert.deepEqual(summary.unusedExceptions, []);
});

test("invalid knowledge fixture fails with one example per rule", () => {
  const { status, summary } = runJson(["--root", INVALID_ROOT]);
  assert.equal(status, 1);
  assert.equal(summary.status, "failed");
  const codes = errorCodes(summary);
  for (const expected of [
    RULE_CODES.LINK_MISSING,
    RULE_CODES.WIKILINK_UNRESOLVED,
    RULE_CODES.WIKILINK_HEADING_MISSING,
    RULE_CODES.FM_MISSING,
    RULE_CODES.FM_PARSE_ERROR,
    RULE_CODES.APPROVED_METADATA_MISSING,
    RULE_CODES.ADR_ID_DUPLICATE,
    RULE_CODES.ADR_FILE_MISSING,
    RULE_CODES.SUPERSEDED_WITHOUT_REPLACEMENT,
    RULE_CODES.FEATURE_SPEC_TEST_PLAN_MISSING,
    RULE_CODES.TEST_PLAN_SPEC_MISSING,
    RULE_CODES.TEST_PLAN_SPEC_UNRESOLVED,
    RULE_CODES.TEST_PLAN_AC_UNKNOWN,
  ]) {
    assert.ok(codes.has(expected), `expected failure code ${expected}, got ${[...codes].join(", ")}`);
  }
  assert.deepEqual(summary.exceptions, []);
});

test("explicit exception list converts every fixture failure into visible warnings", () => {
  const { status, summary } = runJson([
    "--root",
    INVALID_ROOT,
    "--exceptions",
    INVALID_EXCEPTIONS,
  ]);
  assert.equal(status, 0);
  assert.equal(summary.status, "passed");
  assert.deepEqual(summary.errors, []);
  assert.equal(summary.exceptions.length, 16);
  assert.deepEqual(summary.unusedExceptions, []);
  for (const applied of summary.exceptions) {
    assert.ok(applied.reason && applied.reason.length > 10, "exception must carry a reason");
  }
  assert.ok(warningCodes(summary).has("EXCEPTION_APPLIED"));
  assert.equal(
    summary.warnings.filter((warning) => warning.code === "EXCEPTION_APPLIED").length,
    summary.exceptions.length,
  );
});

test("tracking check subset only reports Feature Spec / test plan traceability", () => {
  const valid = runJson(["--root", VALID_ROOT, "--checks", "tracking"]);
  assert.equal(valid.status, 0);
  assert.deepEqual(valid.summary.checks, ["specs"]);
  assert.deepEqual(valid.summary.errors, []);

  const invalid = runJson(["--root", INVALID_ROOT, "--checks", "tracking"]);
  assert.equal(invalid.status, 1);
  const codes = errorCodes(invalid.summary);
  assert.ok(codes.has(RULE_CODES.TEST_PLAN_SPEC_MISSING));
  assert.ok(codes.has(RULE_CODES.FEATURE_SPEC_TEST_PLAN_MISSING));
  assert.ok(!codes.has(RULE_CODES.LINK_MISSING));
  assert.ok(!codes.has(RULE_CODES.FM_MISSING));
  assert.ok(!codes.has(RULE_CODES.ADR_ID_DUPLICATE));
});

test("frontmatter parser handles scalars, lists, inline lists and nested maps", () => {
  const parsed = parseFrontmatter(
    [
      'title: "Quoted: title"',
      "type: index",
      "module: project",
      "status: draft",
      "version: 3",
      "owner: engineering",
      "updated: 2026-11-09",
      "sources: []",
      "related:",
      '  - "[[A]]"',
      "  - '[[B]]'",
      "nested:",
      "  key: value",
      "tags: [alpha, beta]",
    ].join("\n"),
  );
  assert.equal(parsed.title, "Quoted: title");
  assert.equal(parsed.type, "index");
  assert.equal(parsed.version, 3);
  assert.deepEqual(parsed.sources, []);
  assert.deepEqual(parsed.related, ["[[A]]", "[[B]]"]);
  assert.deepEqual(parsed.nested, { key: "value" });
  assert.deepEqual(parsed.tags, ["alpha", "beta"]);
});

test("frontmatter parser rejects duplicate keys, bad indentation and invalid lines", () => {
  assert.throws(() => parseFrontmatter("title: a\ntitle: b"), /duplicate YAML key/);
  assert.throws(() => parseFrontmatter("title: a\n  unexpected: x"), /unexpected indentation/);
  assert.throws(() => parseFrontmatter("not a yaml line"), /invalid YAML line/);
  assert.throws(() => parseFrontmatter('title: "unterminated'), /unterminated quoted/);
});

test("normalizeChecks expands aliases and rejects unknown checks", () => {
  assert.deepEqual(normalizeChecks("tracking"), ["specs"]);
  assert.deepEqual(normalizeChecks("all"), [
    "links",
    "wikilinks",
    "frontmatter",
    "adr",
    "specs",
    "superseded",
  ]);
  assert.deepEqual(normalizeChecks("links, adr"), ["links", "adr"]);
  assert.throws(() => normalizeChecks("deployment"), /unknown check/);
});

test("machine-readable summary is deterministic between runs", () => {
  const first = runJson(["--root", INVALID_ROOT, "--exceptions", INVALID_EXCEPTIONS]);
  const second = runJson(["--root", INVALID_ROOT, "--exceptions", INVALID_EXCEPTIONS]);
  assert.deepEqual(first.summary, second.summary);
});

test("stale exception entries are reported as warnings, not hidden", () => {
  const dir = mkdtempSync(join(tmpdir(), "knowledge-structure-exceptions-"));
  try {
    const exceptionsFile = join(dir, "exceptions.json");
    writeFileSync(
      exceptionsFile,
      JSON.stringify({
        version: 1,
        exceptions: [
          {
            code: RULE_CODES.LINK_MISSING,
            target: "knowledge/00-Home/never-missing.md",
            reason: "stale fixture exception used to prove unused entries stay visible",
          },
        ],
      }),
    );
    const { status, summary } = runJson([
      "--root",
      VALID_ROOT,
      "--exceptions",
      exceptionsFile,
    ]);
    assert.equal(status, 0);
    assert.equal(summary.unusedExceptions.length, 1);
    assert.ok(warningCodes(summary).has(RULE_CODES.UNUSED_EXCEPTION));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("invalid exception list is rejected with exit code 1 and a SETUP_ERROR summary", () => {
  const dir = mkdtempSync(join(tmpdir(), "knowledge-structure-bad-exceptions-"));
  try {
    const exceptionsFile = join(dir, "exceptions.json");
    writeFileSync(
      exceptionsFile,
      JSON.stringify({
        exceptions: [{ code: "NOT_A_RULE", target: "x", reason: "invalid on purpose" }],
      }),
    );
    const { status, summary } = runJson([
      "--root",
      VALID_ROOT,
      "--exceptions",
      exceptionsFile,
    ]);
    assert.equal(status, 1);
    assert.equal(summary.errors[0].code, "SETUP_ERROR");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unknown CLI check and unknown flag fail with exit code 1", () => {
  assert.equal(runCli(["--root", VALID_ROOT, "--checks", "deployment"]).status, 1);
  assert.equal(runCli(["--root", VALID_ROOT, "--not-a-flag"]).status, 1);
});

test("human output still ends with a parseable machine-readable summary line", () => {
  const result = runCli(["--root", VALID_ROOT, "--exceptions", VALID_EXCEPTIONS]);
  assert.equal(result.status, 0);
  const lines = result.stdout.trim().split(/\r?\n/);
  const last = lines[lines.length - 1];
  assert.ok(last.startsWith("KNOWLEDGE_STRUCTURE_RESULT "));
  const summary = JSON.parse(last.slice("KNOWLEDGE_STRUCTURE_RESULT ".length));
  assert.equal(summary.status, "passed");
});

test("markdown summary file is written for CI step summaries", () => {
  const dir = mkdtempSync(join(tmpdir(), "knowledge-structure-summary-"));
  try {
    const summaryFile = join(dir, "summary.md");
    const result = runCli([
      "--root",
      VALID_ROOT,
      "--exceptions",
      VALID_EXCEPTIONS,
      "--no-github-summary",
      "--summary-file",
      summaryFile,
    ]);
    assert.equal(result.status, 0);
    const markdown = readFileSync(summaryFile, "utf8");
    assert.match(markdown, /Knowledge structure gate — PASSED/);
    assert.match(markdown, /\| links checked \|/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("embedded repository exceptions all carry code, target and reason", () => {
  assert.ok(KNOWN_EXCEPTIONS.length > 0);
  const validCodes = new Set(Object.values(RULE_CODES));
  for (const exception of KNOWN_EXCEPTIONS) {
    assert.ok(validCodes.has(exception.code), `unknown code ${exception.code}`);
    assert.ok(exception.target.length > 0);
    assert.ok(exception.reason.length > 10);
  }
});

test("script only imports Node built-in modules (no network or third-party dependency)", () => {
  const source = readFileSync(SCRIPT, "utf8");
  const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(imports.length > 0);
  for (const specifier of imports) {
    assert.ok(specifier.startsWith("node:"), `non-builtin import: ${specifier}`);
  }
  assert.ok(!/\brequire\(/.test(source));
  assert.ok(!/fetch\(|https?\.request|node:https?|node:net/.test(source));
});

test("runCheck can be used programmatically without the CLI", () => {
  const summary = runCheck({ root: VALID_ROOT, exceptions: [] });
  assert.equal(summary.tool, "check-knowledge-structure");
  assert.equal(summary.status, "passed");
  assert.equal(summary.counts.markdownFiles, 11);
});
