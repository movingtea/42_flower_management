#!/usr/bin/env node
/**
 * E3.7 offline gate: inspect the npm lockfile for supply-chain drift.
 *
 * This gate NEVER modifies the lockfile. Sprint E3 explicitly forbids rewriting
 * dependencies or the lockfile; the check reports problems and leaves the fix
 * to a separately approved work package.
 *
 * What this checks (all offline, no network, Node built-ins only)
 *  - lockfileVersion is the expected one (3 for npm 9+/11 in this repository).
 *  - Every registry package `resolved` URL is HTTPS.
 *  - Every `resolved` host is either an approved registry (error otherwise) or a
 *    documented legacy mirror. Legacy mirrors (registry.npmmirror.com) are the
 *    known E2 baseline limitation and are reported as warnings; pass
 *    `--strict-mirrors` to fail on them instead.
 *  - Every package with a `resolved` entry also has a well-formed SRI
 *    `integrity` value, unless the policy disables that requirement.
 *  - The host distribution is reported so the accepted baseline stays visible.
 *
 * Usage:
 *   node scripts/security/check-lockfile.mjs [options]
 *
 * Options:
 *   --lockfile <file>   lockfile to inspect (default: policy supply_chain.lockfile,
 *                       else flower-wms-system/package-lock.json)
 *   --policy <file>     policy file (default: .github/security/policy.yml)
 *   --strict-mirrors    fail when a resolved URL uses a documented legacy mirror
 *   --json              print a single machine-readable JSON line
 *   --output <file>     also write the JSON report to <file>
 *   --self-test         run unit assertions + controlled fixture matrix + real lockfile
 *   --fixtures          run only the controlled fixture matrix
 *   --quiet             only print the final PASS/FAIL line
 *   --help              print this text
 *
 * Exit codes: 0 pass (warnings allowed), 1 violation or failed expectation,
 *             2 usage/internal error.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXIT_OK,
  EXIT_USAGE,
  EXIT_VIOLATION,
  REPO_ROOT,
  UsageError,
  createReport,
  finish,
  parseArgs,
  printCase,
  printHelp,
  resolveFromRoot,
} from "./lib/cli.mjs";
import { getPath, parseYaml } from "./lib/yaml-lite.mjs";

const TOOL = "check-lockfile";
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(SCRIPT_DIR, "fixtures", "lockfile");
const DEFAULT_LOCKFILE = "flower-wms-system/package-lock.json";
const INTEGRITY_RE = /^sha(?:1|256|384|512)-[A-Za-z0-9+/]+={0,2}$/;
const LOCKFILE_VERSION = 3;

const FALLBACK_POLICY = {
  allowedResolvedHosts: ["registry.npmjs.org"],
  legacyMirrorHosts: ["registry.npmmirror.com"],
  requireIntegrity: true,
  requireHttps: true,
  lockfile: DEFAULT_LOCKFILE,
};

const HELP = `
check-lockfile — E3.7 offline npm lockfile supply-chain gate

Usage:
  node scripts/security/check-lockfile.mjs [options]

Options:
  --lockfile <file>   lockfile to inspect (default: policy supply_chain.lockfile,
                      else flower-wms-system/package-lock.json)
  --policy <file>     policy file (default: .github/security/policy.yml)
  --strict-mirrors    fail when a resolved URL uses a documented legacy mirror
  --json              print a single machine-readable JSON line
  --output <file>     also write the JSON report to <file>
  --self-test         run unit assertions + controlled fixture matrix + real lockfile
  --fixtures          run only the controlled fixture matrix
  --quiet             only print the final PASS/FAIL line
  --help              print this text

Exit codes: 0 pass (warnings allowed), 1 violation or failed expectation, 2 usage/internal error.
`;

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

export function parsePolicySupplyChain(policy) {
  const supplyChain = asObject(getPath(policy, "policy.supply_chain"));
  if (!supplyChain) return { ...FALLBACK_POLICY, source: "fallback" };
  const asStrings = (value, fallback) =>
    Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : fallback;
  return {
    allowedResolvedHosts: asStrings(supplyChain.allowed_resolved_hosts, FALLBACK_POLICY.allowedResolvedHosts),
    legacyMirrorHosts: asStrings(supplyChain.legacy_mirror_hosts, FALLBACK_POLICY.legacyMirrorHosts),
    requireIntegrity:
      typeof supplyChain.require_integrity === "boolean"
        ? supplyChain.require_integrity
        : FALLBACK_POLICY.requireIntegrity,
    requireHttps:
      typeof supplyChain.require_https === "boolean" ? supplyChain.require_https : FALLBACK_POLICY.requireHttps,
    lockfile: typeof supplyChain.lockfile === "string" ? supplyChain.lockfile : FALLBACK_POLICY.lockfile,
    source: "policy",
  };
}

export function isValidIntegrity(value) {
  return typeof value === "string" && INTEGRITY_RE.test(value.trim());
}

export function normalizeHost(url) {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Inspect a parsed package-lock object.
 * @returns {ReturnType<typeof createReport>}
 */
export function checkLockfile(lockfile, config = FALLBACK_POLICY, options = {}) {
  const { strictMirrors = false, relPath = "package-lock.json" } = options;
  const report = createReport(TOOL);
  const root = asObject(lockfile);
  if (!root) {
    report.error("lockfile-parse", `${relPath}: lockfile must be a JSON object`);
    return report;
  }
  if (root.lockfileVersion !== LOCKFILE_VERSION) {
    report.error(
      "lockfile-version",
      `${relPath}: lockfileVersion ${root.lockfileVersion} is not the expected ${LOCKFILE_VERSION}`,
    );
  }
  const packages = asObject(root.packages);
  if (!packages) {
    report.error("lockfile-packages", `${relPath}: \`packages\` mapping is required (lockfileVersion 3 format)`);
    return report;
  }

  const hostCounts = Object.create(null);
  let packageCount = 0;
  let resolvedCount = 0;
  let integrityCount = 0;
  let legacyMirrorCount = 0;

  for (const [packagePath, rawEntry] of Object.entries(packages)) {
    if (packagePath === "") continue;
    const entry = asObject(rawEntry);
    if (!entry) {
      report.error("lockfile-entry", `${relPath}: package entry \`${packagePath}\` must be a mapping`);
      continue;
    }
    if (entry.link === true) continue; // local workspace link, not a registry artifact
    packageCount += 1;

    const resolved = entry.resolved;
    if (resolved === undefined) {
      if (typeof entry.version === "string" && entry.integrity === undefined) {
        // Git/file/tarball dependencies legitimately have no registry `resolved`.
        report.warn(
          "lockfile-missing-resolved",
          `${relPath}: \`${packagePath}\` has a version but no resolved URL; verify it is not a registry package`,
        );
      }
      continue;
    }
    if (typeof resolved !== "string" || resolved.trim() === "") {
      report.error("lockfile-resolved-shape", `${relPath}: \`${packagePath}\` has an invalid resolved value`);
      continue;
    }
    resolvedCount += 1;

    let parsedUrl = null;
    try {
      parsedUrl = new URL(resolved);
    } catch {
      report.error("lockfile-resolved-url", `${relPath}: \`${packagePath}\` resolved URL is not parseable`);
      continue;
    }
    const protocol = parsedUrl.protocol;
    const host = parsedUrl.host.toLowerCase();
    hostCounts[host] = (hostCounts[host] ?? 0) + 1;

    if (config.requireHttps && protocol !== "https:") {
      report.error(
        "lockfile-resolved-protocol",
        `${relPath}: \`${packagePath}\` resolves over ${protocol}; HTTPS is required`,
      );
    }

    const hostIsAllowed = config.allowedResolvedHosts.includes(host);
    const hostIsLegacyMirror = config.legacyMirrorHosts.includes(host);
    if (!hostIsAllowed && !hostIsLegacyMirror) {
      report.error(
        "lockfile-resolved-host",
        `${relPath}: \`${packagePath}\` resolves from unapproved host \`${host}\``,
      );
    } else if (!hostIsAllowed && hostIsLegacyMirror) {
      legacyMirrorCount += 1;
      if (strictMirrors) {
        report.error(
          "lockfile-legacy-mirror",
          `${relPath}: \`${packagePath}\` resolves from documented legacy mirror \`${host}\`; --strict-mirrors is enabled`,
        );
      }
    }

    if (entry.integrity === undefined) {
      if (config.requireIntegrity) {
        report.error(
          "lockfile-missing-integrity",
          `${relPath}: \`${packagePath}\` has a resolved URL but no SRI integrity value`,
        );
      }
    } else if (!isValidIntegrity(entry.integrity)) {
      report.error(
        "lockfile-integrity-format",
        `${relPath}: \`${packagePath}\` has a malformed integrity value`,
      );
    } else {
      integrityCount += 1;
    }
  }

  if (legacyMirrorCount > 0 && !strictMirrors) {
    report.warn(
      "lockfile-legacy-mirror-baseline",
      `${legacyMirrorCount} package(s) resolve from a documented legacy mirror; ` +
        "this is the known E2 baseline and must not be silently normalised. Fix in a separately approved lockfile work package.",
    );
  }

  const sortedHosts = Object.fromEntries(
    Object.entries(hostCounts).sort((left, right) => right[1] - left[1]),
  );
  const summary = {
    lockfileVersion: root.lockfileVersion,
    packageCount,
    resolvedCount,
    integrityCount,
    legacyMirrorCount,
    hostCounts: sortedHosts,
    strictMirrors,
  };
  return Object.assign(report, { lockfileSummary: summary });
}

// ---------------------------------------------------------------------------
// Controlled fixture matrix
// ---------------------------------------------------------------------------

const FIXTURE_EXPECTATIONS = [
  { file: "lock-valid.json", expectPass: true },
  { file: "lock-bad-host.json", expectCodes: ["lockfile-resolved-host"] },
  { file: "lock-missing-integrity.json", expectCodes: ["lockfile-missing-integrity"] },
  { file: "lock-http.json", expectCodes: ["lockfile-resolved-protocol"] },
  { file: "lock-legacy-mirror.json", expectPass: true },
  { file: "lock-legacy-mirror.json", strictMirrors: true, expectCodes: ["lockfile-legacy-mirror"] },
  { file: "lock-bad-version.json", expectCodes: ["lockfile-version"] },
  { file: "lock-bad-integrity.json", expectCodes: ["lockfile-integrity-format"] },
];

export function runFixtureMatrix({ quiet = false } = {}) {
  const cases = [];
  for (const expectation of FIXTURE_EXPECTATIONS) {
    const lockfilePath = join(FIXTURE_DIR, expectation.file);
    let lockfile;
    try {
      lockfile = JSON.parse(readFileSync(lockfilePath, "utf8"));
    } catch (error) {
      cases.push({
        case: expectation.file,
        passed: false,
        detail: `cannot read fixture: ${error.message}`,
        actualErrorCodes: [],
      });
      continue;
    }
    const report = checkLockfile(lockfile, FALLBACK_POLICY, {
      strictMirrors: Boolean(expectation.strictMirrors),
      relPath: expectation.file,
    });
    const actualCodes = [...new Set(report.errors.map((error) => error.code))];
    const expectedPass = Boolean(expectation.expectPass);
    const codesMatch = (expectation.expectCodes ?? []).every((code) => actualCodes.includes(code));
    const passStateMatches = expectedPass ? report.errors.length === 0 : report.errors.length > 0;
    const passed = codesMatch && passStateMatches;
    const label = expectation.strictMirrors ? `${expectation.file} (strict)` : expectation.file;
    cases.push({
      case: label,
      passed,
      expected: expectedPass ? "pass" : `fail with ${expectation.expectCodes.join(", ")}`,
      actualErrorCodes: actualCodes,
      warningCodes: [...new Set(report.warnings.map((warning) => warning.code))],
    });
    if (!quiet) {
      printCase(
        label,
        passed,
        passed
          ? expectedPass
            ? "accepted"
            : `controlled failure detected (${actualCodes.join(", ")})`
          : `expected ${expectation.expectCodes?.join(", ")}, got ${actualCodes.join(", ") || "no errors"}`,
      );
    }
  }
  return cases;
}

function runPrimitiveAssertions(quiet) {
  const checks = [];
  const assert = (name, condition) => {
    checks.push({ name, passed: Boolean(condition) });
    if (!quiet) printCase(name, Boolean(condition));
  };
  assert("accepts sha512 integrity", isValidIntegrity("sha512-abcDEF123+/=="));
  assert("accepts sha1 integrity", isValidIntegrity("sha1-abc123"));
  assert("rejects a plain hash", !isValidIntegrity("deadbeef"));
  assert("rejects an empty integrity", !isValidIntegrity(""));
  assert("normalises a host", normalizeHost("https://registry.npmjs.org/a.tgz") === "registry.npmjs.org");
  assert("returns null for a bad URL", normalizeHost("not a url") === null);
  return checks;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2), {
      flags: ["help", "json", "self-test", "fixtures", "quiet", "strict-mirrors"],
      values: ["lockfile", "policy", "output"],
    });
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`usage error: ${error.message}`);
      console.error("run with --help for usage");
      return EXIT_USAGE;
    }
    throw error;
  }
  if (args.flags.has("help")) return printHelp(HELP);

  const quiet = args.flags.has("quiet");
  const json = args.flags.has("json");
  const strictMirrors = args.flags.has("strict-mirrors");
  const output = args.values.output ? resolveFromRoot(args.values.output) : null;
  const policyPath = resolveFromRoot(args.values.policy ?? ".github/security/policy.yml");

  let policy = null;
  if (existsSync(policyPath)) {
    try {
      policy = parseYaml(readFileSync(policyPath, "utf8"));
    } catch (error) {
      console.error(`cannot parse policy ${policyPath}: ${error.message}`);
      return EXIT_USAGE;
    }
  }
  const config = parsePolicySupplyChain(policy);
  const lockfilePath = resolveFromRoot(args.values.lockfile ?? config.lockfile);

  if (args.flags.has("fixtures")) {
    const cases = runFixtureMatrix({ quiet });
    const passed = cases.every((entry) => entry.passed);
    const payload = { tool: TOOL, mode: "fixtures", ok: passed, cases };
    if (json) console.log(JSON.stringify(payload));
    if (output) {
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    }
    console.log(`${passed ? "PASS" : "FAIL"} ${TOOL} fixture matrix: ${cases.filter((entry) => entry.passed).length}/${cases.length}`);
    return passed ? EXIT_OK : EXIT_VIOLATION;
  }

  const runReal = () => {
    let rawLockfile;
    try {
      rawLockfile = readFileSync(lockfilePath, "utf8");
    } catch (error) {
      const report = createReport(TOOL);
      report.error("lockfile-unreadable", `cannot read lockfile ${lockfilePath}: ${error.message}`);
      return { report, summary: null };
    }
    let parsed;
    try {
      parsed = JSON.parse(rawLockfile);
    } catch (error) {
      const report = createReport(TOOL);
      report.error("lockfile-json", `cannot parse lockfile ${lockfilePath}: ${error.message}`);
      return { report, summary: null };
    }
    const report = checkLockfile(parsed, config, { strictMirrors, relPath: lockfilePath });
    return { report, summary: report.lockfileSummary ?? null };
  };

  if (args.flags.has("self-test")) {
    const primitives = runPrimitiveAssertions(quiet);
    const cases = runFixtureMatrix({ quiet });
    const real = runReal();
    const realPassed = real.report.ok;
    if (!quiet) printCase("real lockfile passes (warnings allowed)", realPassed, realPassed ? "" : "see default run for details");
    const ok = primitives.every((entry) => entry.passed) && cases.every((entry) => entry.passed) && realPassed;
    const payload = {
      tool: TOOL,
      mode: "self-test",
      ok,
      primitives,
      fixtures: cases,
      realLockfile: { path: lockfilePath, ok: realPassed, summary: real.summary, errors: real.report.errors },
    };
    if (json) console.log(JSON.stringify(payload));
    console.log(
      `${ok ? "PASS" : "FAIL"} ${TOOL} self-test: primitives ${primitives.filter((entry) => entry.passed).length}/${primitives.length}, ` +
        `fixtures ${cases.filter((entry) => entry.passed).length}/${cases.length}, real lockfile ${realPassed ? "pass" : "fail"}`,
    );
    return ok ? EXIT_OK : EXIT_VIOLATION;
  }

  const real = runReal();
  if (!quiet) {
    console.log(`lockfile: ${lockfilePath}`);
    console.log(`policy: ${policyPath} (${config.source})`);
    if (real.summary) {
      console.log(
        `packages: ${real.summary.packageCount}, resolved: ${real.summary.resolvedCount}, ` +
          `integrity: ${real.summary.integrityCount}, legacy mirror: ${real.summary.legacyMirrorCount}`,
      );
      for (const [host, count] of Object.entries(real.summary.hostCounts)) {
        console.log(`  host ${host}: ${count}`);
      }
    }
  }
  return finish(real.report, { json, output, summaryExtra: { lockfile: lockfilePath, ...(real.summary ?? {}) } });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`${TOOL}: internal error: ${error instanceof Error ? error.stack : String(error)}`);
    process.exitCode = EXIT_USAGE;
  }
}

export { FIXTURE_DIR, FIXTURE_EXPECTATIONS, REPO_ROOT };
