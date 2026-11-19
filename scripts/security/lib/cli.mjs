/**
 * Shared CLI helpers for the E3.7 offline security gates.
 *
 * Exit-code contract for every script in scripts/security/:
 *   0 — checks passed (or the controlled fixture matrix matched expectations)
 *   1 — policy violation / failed self-test expectation
 *   2 — usage or internal error (bad arguments, unreadable required input)
 *
 * No external dependencies: Node built-ins only, matching the Sprint E3
 * "zero new dependencies" constraint.
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const EXIT_OK = 0;
export const EXIT_VIOLATION = 1;
export const EXIT_USAGE = 2;

/** Repository root derived from this file: scripts/security/lib/cli.mjs */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
}

/**
 * Minimal argument parser.
 *
 * spec = { flags: ["json", "self-test", ...], values: ["workflow", "policy", ...] }
 * Returns { flags: Set<string>, values: Record<string, string>, positionals: string[] }.
 * Unknown or duplicate-value arguments raise UsageError.
 */
export function parseArgs(argv, spec) {
  const flags = new Set();
  const values = Object.create(null);
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (spec.flags.includes(name)) {
      flags.add(name);
      continue;
    }
    if (spec.values.includes(name)) {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new UsageError(`option --${name} requires a value`);
      }
      if (values[name] !== undefined) {
        throw new UsageError(`option --${name} was provided more than once`);
      }
      values[name] = next;
      index += 1;
      continue;
    }
    throw new UsageError(`unknown option --${name}`);
  }
  return { flags, values, positionals };
}

/** Resolve a CLI path against the repository root. */
export function resolveFromRoot(value) {
  return resolve(REPO_ROOT, value);
}

/** Format a UTC timestamp for evidence output. */
export function utcNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Create a report collector.
 * Finding levels: "error" fails the gate, "warn" is reported but does not fail.
 */
export function createReport(tool, options = {}) {
  const findings = [];
  const errors = [];
  const warnings = [];
  return {
    tool,
    findings,
    errors,
    warnings,
    add(level, code, message, extra = {}) {
      const finding = { level, code, message, ...extra };
      findings.push(finding);
      if (level === "error") errors.push(finding);
      else warnings.push(finding);
      return finding;
    },
    error(code, message, extra) {
      return this.add("error", code, message, extra);
    },
    warn(code, message, extra) {
      return this.add("warn", code, message, extra);
    },
    get ok() {
      return errors.length === 0;
    },
    summary(extra = {}) {
      return {
        tool,
        version: options.version ?? 1,
        generatedAt: utcNow(),
        ok: errors.length === 0,
        errorCount: errors.length,
        warningCount: warnings.length,
        ...extra,
        findings,
      };
    },
  };
}

/**
 * Print a report, optionally write JSON to disk, append a GitHub step summary.
 * Returns the process exit code.
 */
export function finish(report, options = {}) {
  const { json = false, output = null, summaryExtra = {}, print = true } = options;
  const summary = report.summary(summaryExtra);
  if (print) {
    if (json) {
      console.log(JSON.stringify(summary));
    } else {
      for (const warning of report.warnings) {
        console.log(`WARN  [${warning.code}] ${warning.message}`);
      }
      for (const error of report.errors) {
        console.log(`ERROR [${error.code}] ${error.message}`);
      }
      console.log(
        `${summary.ok ? "PASS" : "FAIL"} ${report.tool}: ${report.errors.length} error(s), ` +
          `${report.warnings.length} warning(s)`,
      );
    }
  }
  if (output) {
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  }
  appendStepSummary(summary);
  return summary.ok ? EXIT_OK : EXIT_VIOLATION;
}

function appendStepSummary(summary) {
  const target = process.env.GITHUB_STEP_SUMMARY;
  if (!target) return;
  const lines = [
    `### ${summary.tool} — ${summary.ok ? "PASS" : "FAIL"}`,
    "",
    `- errors: ${summary.errorCount}`,
    `- warnings: ${summary.warningCount}`,
  ];
  for (const error of summary.findings.filter((finding) => finding.level === "error").slice(0, 20)) {
    lines.push(`- ERROR \`${error.code}\`: ${error.message}`);
  }
  lines.push("");
  try {
    appendFileSync(target, `${lines.join("\n")}\n`, "utf8");
  } catch {
    // Step summaries are best-effort; never fail the gate because of them.
  }
}

/** Print a `--help` block and exit 0. */
export function printHelp(text) {
  console.log(text.trim());
  return EXIT_OK;
}

/** A single PASS/FAIL line used by self-test matrices. */
export function printCase(name, passed, detail = "") {
  const status = passed ? "PASS" : "FAIL";
  console.log(`${status} ${name}${detail ? ` — ${detail}` : ""}`);
}
