#!/usr/bin/env node
/**
 * E3.7 offline gate: assert the independent security workflow is structurally
 * sound and that every third-party action is pinned to an immutable
 * 40-character commit SHA with a version comment.
 *
 * What this checks (all offline, no network, Node built-ins only)
 *  - Trigger scope: `pull_request` and `workflow_dispatch`; never
 *    `pull_request_target`.
 *  - Least privilege: top-level `permissions.contents: read`; no root
 *    `security-events: write`; job-level `security-events: write` only on jobs
 *    that actually upload SARIF; no other write scopes, no `write-all`.
 *  - Supply chain: every `uses:` is `owner/repo[/path]@<40 lowercase hex>` and
 *    carries a `# vX.Y.Z` version comment.
 *  - Required jobs exist and reference the expected pinned actions/scripts.
 *  - The image scan is manual/dispatch-only (never builds a production image in
 *    a pull request job) and the ACR pull guard is present.
 *  - No secret value is echoed to logs; `docker login` uses `--password-stdin`.
 *  - Cross-file consistency: the workflow passes the thresholds and ignore
 *    files declared in `.github/security/policy.yml`, and those files exist.
 *
 * Usage:
 *   node scripts/security/check-workflow-pins.mjs [options]
 *
 * Options:
 *   --workflow <file>   workflow to inspect (default: .github/workflows/security.yml)
 *   --policy <file>     policy file for consistency checks (default: .github/security/policy.yml)
 *   --json              print a single machine-readable JSON line
 *   --output <file>     also write the JSON report to <file>
 *   --self-test         run unit assertions + controlled fixture matrix + real workflow
 *   --fixtures          run only the controlled fixture matrix
 *   --quiet             only print the final PASS/FAIL line
 *   --help              print this text
 *
 * Exit codes: 0 pass, 1 violation or failed expectation, 2 usage/internal error.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXIT_OK,
  EXIT_USAGE,
  REPO_ROOT,
  UsageError,
  createReport,
  finish,
  parseArgs,
  printCase,
  printHelp,
  resolveFromRoot,
} from "./lib/cli.mjs";
import { YamlError, getPath, parseYaml } from "./lib/yaml-lite.mjs";

const TOOL = "check-workflow-pins";
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(SCRIPT_DIR, "fixtures", "workflows");

const SHA_RE = /^[0-9a-f]{40}$/;
const VERSION_COMMENT_RE = /^v?\d+\.\d+\.\d+/;
const USES_LINE_RE = /^\s*(?:-\s+)?uses:\s*(\S+)\s*(?:#\s*(.+?))?\s*$/;
const IMAGE_SCAN_GUARD_RE = /github\.event_name\s*!=\s*['"]pull_request['"]/;
const DOCKER_BUILD_RE = /\bdocker\s+(?:build|buildx\s+build)\b|\bbuild-push-action\b/;
const SECRET_ECHO_RE = /\becho\b[^\n]*\$\{\{\s*secrets\./i;

const REQUIRED_JOBS = ["dependency-review", "secret-scan", "sbom", "offline-supply-chain", "image-scan"];
const JOB_ACTION_PREFIX = {
  "dependency-review": "actions/dependency-review-action@",
  "secret-scan": "gitleaks/gitleaks-action@",
  sbom: "anchore/sbom-action@",
  "image-scan": "aquasecurity/trivy-action@",
};
const OFFLINE_SCRIPT_MARKERS = [
  "scripts/security/check-workflow-pins.mjs",
  "scripts/security/check-exceptions.mjs",
  "scripts/security/check-lockfile.mjs",
];
const REQUIRED_POLICY_FILES = [
  ".github/security/policy.yml",
  ".github/security/gitleaks.toml",
  ".github/security/trivy-ignore.yaml",
];
const HELP = `
check-workflow-pins — E3.7 offline workflow/action pin gate

Usage:
  node scripts/security/check-workflow-pins.mjs [options]

Options:
  --workflow <file>   workflow to inspect (default: .github/workflows/security.yml)
  --policy <file>     policy file for consistency checks (default: .github/security/policy.yml)
  --json              print a single machine-readable JSON line
  --output <file>     also write the JSON report to <file>
  --self-test         run unit assertions + controlled fixture matrix + real workflow
  --fixtures          run only the controlled fixture matrix
  --quiet             only print the final PASS/FAIL line
  --help              print this text

Exit codes: 0 pass, 1 violation or failed expectation, 2 usage/internal error.
`;

export function isPinnedSha(ref) {
  return typeof ref === "string" && SHA_RE.test(ref);
}

/** Split `owner/repo[/path]@ref`; returns null when there is no @ref. */
export function splitActionRef(value) {
  if (typeof value !== "string") return null;
  const at = value.lastIndexOf("@");
  if (at <= 0 || at === value.length - 1) return null;
  return { action: value.slice(0, at), ref: value.slice(at + 1) };
}

export function hasVersionComment(comment) {
  return typeof comment === "string" && VERSION_COMMENT_RE.test(comment.trim());
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function stepsOf(job) {
  return asArray(job && job.steps).filter((step) => step && typeof step === "object");
}

function usesOf(job) {
  return stepsOf(job)
    .map((step) => step.uses)
    .filter((value) => typeof value === "string");
}

function runTextOf(job) {
  return stepsOf(job)
    .map((step) => (typeof step.run === "string" ? step.run : ""))
    .join("\n");
}

function findStep(job, actionPrefix) {
  return stepsOf(job).find((step) => typeof step.uses === "string" && step.uses.startsWith(actionPrefix));
}

/**
 * Run all workflow checks against a workflow text.
 * @returns {ReturnType<typeof createReport>}
 */
export function checkWorkflowText(text, options = {}) {
  const { policy = null, relPath = "<workflow>", crossFile = false } = options;
  const report = createReport(TOOL);
  let root;
  try {
    root = parseYaml(text);
  } catch (error) {
    report.error("yaml-parse", `${relPath}: YAML subset parse failed: ${error.message}`);
    return report;
  }
  if (!asObject(root)) {
    report.error("yaml-root", `${relPath}: workflow root must be a mapping`);
    return report;
  }

  const codeText = text
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");

  // ---- triggers -----------------------------------------------------------
  const triggers = asObject(root.on) ?? (typeof root.on === "string" ? { [root.on]: null } : null);
  if (!triggers) {
    report.error("missing-trigger", "workflow must define an `on:` mapping");
  } else {
    if (Object.prototype.hasOwnProperty.call(triggers, "pull_request_target")) {
      report.error("forbidden-pull-request-target", "`pull_request_target` is forbidden for this workflow");
    }
    if (!Object.prototype.hasOwnProperty.call(triggers, "pull_request")) {
      report.error("missing-pull-request-trigger", "`on.pull_request` is required");
    }
    if (!Object.prototype.hasOwnProperty.call(triggers, "workflow_dispatch")) {
      report.error("missing-workflow-dispatch-trigger", "`on.workflow_dispatch` is required");
    }
  }
  if (/pull_request_target/.test(codeText)) {
    report.error("forbidden-pull-request-target", "the text `pull_request_target` must not appear in this workflow");
  }

  // ---- concurrency --------------------------------------------------------
  const concurrency = asObject(root.concurrency);
  if (!concurrency || typeof concurrency.group !== "string" || concurrency.group.trim() === "") {
    report.warn("missing-concurrency", "recommended: a `concurrency.group` to cancel superseded runs");
  }

  // ---- permissions --------------------------------------------------------
  const rootPermissions = asObject(root.permissions);
  if (!rootPermissions) {
    report.error("missing-permissions", "top-level `permissions:` is required (default: contents: read)");
  } else {
    if (rootPermissions.contents !== "read") {
      report.error("permissions-contents", "top-level `permissions.contents` must be `read`");
    }
    for (const [scope, value] of Object.entries(rootPermissions)) {
      if (scope === "contents") continue;
      if (value === "write" || value === "write-all") {
        report.error(
          "permissions-root-write",
          `top-level permission \`${scope}: ${value}\` is not allowed; grant write scopes per job only when required`,
        );
      }
    }
    if (rootPermissions["security-events"] === "write") {
      report.error(
        "root-security-events-write",
        "`security-events: write` must be a job-level permission on SARIF-uploading jobs, not at the workflow root",
      );
    }
  }

  // ---- action pinning -----------------------------------------------------
  let usesCount = 0;
  text.split("\n").forEach((line, index) => {
    const match = line.match(USES_LINE_RE);
    if (!match) return;
    usesCount += 1;
    const [, rawValue, comment] = match;
    if (rawValue.startsWith("./")) {
      report.warn("local-action", `line ${index + 1}: local action ${rawValue} is not pinned (allowed for in-repo actions)`);
      return;
    }
    const parsed = splitActionRef(rawValue);
    if (!parsed) {
      report.error("uses-without-ref", `line ${index + 1}: \`uses: ${rawValue}\` has no @ref`);
      return;
    }
    if (!isPinnedSha(parsed.ref)) {
      report.error(
        "uses-not-sha-pinned",
        `line ${index + 1}: \`${parsed.action}@${parsed.ref}\` must be pinned to a 40-character commit SHA`,
      );
    }
    if (!hasVersionComment(comment)) {
      report.error(
        "uses-missing-version-comment",
        `line ${index + 1}: \`${parsed.action}\` needs a trailing version comment such as \`# v1.2.3\``,
      );
    }
  });
  if (usesCount === 0) {
    report.error("uses-missing", "workflow references no actions; the security gate expects pinned actions");
  }

  // ---- no production image build inside this workflow --------------------
  if (DOCKER_BUILD_RE.test(codeText)) {
    report.error(
      "docker-build-forbidden",
      "the security workflow must not build the production image; scan the image already pushed to ACR",
    );
  }

  // ---- credential handling ----------------------------------------------
  if (SECRET_ECHO_RE.test(codeText)) {
    report.error("secret-echo", "a `secrets.*` value is echoed into logs; never print credentials");
  }
  if (/\bdocker\s+login\b/.test(codeText) && !/--password-stdin/.test(codeText)) {
    report.error("docker-login-password", "`docker login` must use `--password-stdin`, never an inline password argument");
  }

  // ---- jobs ---------------------------------------------------------------
  const jobs = asObject(root.jobs);
  if (!jobs) {
    report.error("missing-jobs", "workflow must define a `jobs:` mapping");
    return report;
  }
  for (const jobName of REQUIRED_JOBS) {
    if (!Object.prototype.hasOwnProperty.call(jobs, jobName)) {
      report.error("missing-job", `required job \`${jobName}\` is missing`);
      continue;
    }
    const job = asObject(jobs[jobName]) ?? {};
    const actionPrefix = JOB_ACTION_PREFIX[jobName];
    if (actionPrefix && !usesOf(job).some((value) => value.startsWith(actionPrefix))) {
      report.error("job-action-mismatch", `job \`${jobName}\` must use a pinned \`${actionPrefix.split("@")[0]}\``);
    }
    if (jobName === "offline-supply-chain") {
      const runText = runTextOf(job);
      for (const marker of OFFLINE_SCRIPT_MARKERS) {
        if (!runText.includes(marker)) {
          report.error("offline-script-missing", `job \`offline-supply-chain\` must run \`node ${marker}\``);
        }
      }
    }

    // Job-level permissions must stay minimal and consistent with SARIF use.
    const jobPermissions = asObject(job.permissions);
    const mergedPermissions = { ...(rootPermissions ?? {}), ...(jobPermissions ?? {}) };
    const uploadsSarif = usesOf(job).some((value) => value.startsWith("github/codeql-action/upload-sarif@"));
    if (uploadsSarif && mergedPermissions["security-events"] !== "write") {
      report.error(
        "sarif-without-permission",
        `job \`${jobName}\` uploads SARIF but lacks \`security-events: write\``,
      );
    }
    if (!uploadsSarif && mergedPermissions["security-events"] === "write") {
      report.error(
        "security-events-write-unneeded",
        `job \`${jobName}\` grants \`security-events: write\` without a SARIF upload step`,
      );
    }
    if (jobPermissions) {
      for (const [scope, value] of Object.entries(jobPermissions)) {
        if (value === "write-all") {
          report.error("job-permissions-write-all", `job \`${jobName}\` must not use \`permissions: write-all\``);
          continue;
        }
        if (scope === "security-events" && value === "write") continue;
        if (value === "write") {
          report.error(
            "job-permissions-write",
            `job \`${jobName}\` grants unused write permission \`${scope}: write\``,
          );
        }
        if (scope === "contents" && value !== "read") {
          report.error("job-permissions-contents", `job \`${jobName}\` must keep \`contents: read\``);
        }
      }
    }
  }

  // ---- image scan guard ---------------------------------------------------
  const imageScan = asObject(jobs["image-scan"]);
  if (imageScan) {
    const guard = typeof imageScan.if === "string" ? imageScan.if : "";
    if (!IMAGE_SCAN_GUARD_RE.test(guard)) {
      report.error(
        "image-scan-guard",
        "job `image-scan` must be guarded with `if: github.event_name != 'pull_request'` " +
          "so pull requests never pull production images or need ACR secrets",
      );
    }
  }

  // ---- policy consistency (real run only) --------------------------------
  if (crossFile) {
    for (const relativePath of REQUIRED_POLICY_FILES) {
      if (!existsSync(resolveFromRoot(relativePath))) {
        report.error("required-file-missing", `required security file is missing: ${relativePath}`);
      }
    }
    if (policy) {
      const depReviewJob = asObject(jobs["dependency-review"]);
      const depStep = depReviewJob ? findStep(depReviewJob, "actions/dependency-review-action@") : undefined;
      const depWith = asObject(depStep && depStep.with) ?? {};
      const policyDep = asObject(getPath(policy, "policy.dependency_review")) ?? {};
      compareValue(report, "policy-dep-fail-on-severity", depWith["fail-on-severity"], policyDep.fail_on_severity);
      compareValue(report, "policy-dep-fail-on-scopes", depWith["fail-on-scopes"], policyDep.fail_on_scopes);

      const trivyStep = imageScan ? findStep(imageScan, "aquasecurity/trivy-action@") : undefined;
      const trivyWith = asObject(trivyStep && trivyStep.with) ?? {};
      const policyImage = asObject(getPath(policy, "policy.image_scan")) ?? {};
      const workflowSeverity = String(trivyWith.severity ?? "").toUpperCase();
      const policySeverity = String(policyImage.fail_on_severity ?? "").toUpperCase();
      if (workflowSeverity !== "" && policySeverity !== "" && !workflowSeverity.includes(policySeverity)) {
        report.error(
          "policy-image-severity",
          `workflow trivy severity \`${workflowSeverity}\` does not include policy severity \`${policySeverity}\``,
        );
      }
      compareValue(
        report,
        "policy-image-ignore-unfixed",
        trivyWith["ignore-unfixed"] === undefined ? undefined : String(trivyWith["ignore-unfixed"]),
        policyImage.ignore_unfixed === undefined ? undefined : String(policyImage.ignore_unfixed),
      );
      const workflowIgnore = trivyWith.trivyignores;
      if (
        workflowIgnore !== undefined &&
        policyImage.ignore_file !== undefined &&
        workflowIgnore !== policyImage.ignore_file
      ) {
        report.error(
          "policy-image-ignore-file",
          `workflow trivy ignores \`${workflowIgnore}\` but policy declares \`${policyImage.ignore_file}\``,
        );
      }

      // Referenced config files must exist.
      for (const job of Object.values(jobs)) {
        const jobObject = asObject(job);
        if (!jobObject) continue;
        const env = asObject(jobObject.env);
        const gitleaksConfig = env ? env.GITLEAKS_CONFIG : undefined;
        if (typeof gitleaksConfig === "string") {
          const normalized = gitleaksConfig.replace(/^\$\{\{\s*github\.workspace\s*\}\}\//, "").replace(/^\.\//, "");
          if (!existsSync(resolveFromRoot(normalized))) {
            report.error("gitleaks-config-missing", `GITLEAKS_CONFIG points to a missing file: ${normalized}`);
          }
          const policyGitleaks = getPath(policy, "policy.secret_scan.config");
          if (typeof policyGitleaks === "string" && policyGitleaks !== normalized) {
            report.error(
              "policy-gitleaks-config",
              `workflow GITLEAKS_CONFIG \`${normalized}\` differs from policy \`${policyGitleaks}\``,
            );
          }
        }
      }
    } else {
      report.warn("policy-missing", "policy file not loaded; cross-file consistency checks were skipped");
    }
  }

  return report;
}

function compareValue(report, code, workflowValue, policyValue) {
  if (typeof policyValue === "undefined") {
    report.warn(`${code}-policy-undefined`, `policy value for ${code} is undefined`);
    return;
  }
  if (String(workflowValue) !== String(policyValue)) {
    report.error(code, `workflow value \`${workflowValue}\` does not match policy value \`${policyValue}\``);
  }
}

// ---------------------------------------------------------------------------
// Controlled fixture matrix
// ---------------------------------------------------------------------------

/**
 * Each fixture is an intentionally broken (or valid) workflow. Expected failures
 * prove the gate actually fails; the valid fixture proves it passes.
 */
const FIXTURE_EXPECTATIONS = [
  { file: "valid.yml", expectErrors: [] },
  { file: "unpinned-tag.yml", expectErrors: ["uses-not-sha-pinned"] },
  { file: "short-sha.yml", expectErrors: ["uses-not-sha-pinned"] },
  { file: "missing-version-comment.yml", expectErrors: ["uses-missing-version-comment"] },
  { file: "pull-request-target.yml", expectErrors: ["forbidden-pull-request-target"] },
  { file: "missing-permissions.yml", expectErrors: ["missing-permissions"] },
  { file: "write-all-permissions.yml", expectErrors: ["permissions-root-write"] },
  { file: "docker-build.yml", expectErrors: ["docker-build-forbidden"] },
  { file: "unneeded-security-events.yml", expectErrors: ["security-events-write-unneeded"] },
  { file: "missing-jobs.yml", expectErrors: ["missing-job"] },
  { file: "unpinned-image-scan-guard.yml", expectErrors: ["image-scan-guard"] },
  { file: "secret-echo.yml", expectErrors: ["secret-echo"] },
];

export function runFixtureMatrix({ quiet = false } = {}) {
  const cases = [];
  for (const expectation of FIXTURE_EXPECTATIONS) {
    const workflowPath = join(FIXTURE_DIR, expectation.file);
    let text;
    try {
      text = readFileSync(workflowPath, "utf8");
    } catch (error) {
      cases.push({
        case: expectation.file,
        passed: false,
        detail: `cannot read fixture: ${error.message}`,
        expectedCodes: expectation.expectErrors,
        actualErrorCodes: [],
      });
      continue;
    }
    const report = checkWorkflowText(text, { relPath: expectation.file, crossFile: false });
    const actualCodes = report.errors.map((error) => error.code);
    const expectedPass = expectation.expectErrors.length === 0;
    const codesMatch = expectation.expectErrors.every((code) => actualCodes.includes(code));
    const passStateMatches = expectedPass ? report.errors.length === 0 : report.errors.length > 0;
    const passed = codesMatch && passStateMatches;
    cases.push({
      case: expectation.file,
      passed,
      expected: expectedPass ? "pass" : `fail with ${expectation.expectErrors.join(", ")}`,
      actualErrorCodes: [...new Set(actualCodes)],
      warningCodes: [...new Set(report.warnings.map((warning) => warning.code))],
    });
    if (!quiet) {
      printCase(
        expectation.file,
        passed,
        passed
          ? expectedPass
            ? "normal workflow accepted"
            : `controlled failure detected (${[...new Set(actualCodes)].join(", ")})`
          : `expected ${expectation.expectErrors.join(", ")}, got ${[...new Set(actualCodes)].join(", ") || "no errors"}`,
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
  assert("accepts a 40-char lowercase SHA", isPinnedSha("a1d282b36b6f3519aa1f3fc636f609c47dddb294"));
  assert("rejects a 39-char SHA", !isPinnedSha("a1d282b36b6f3519aa1f3fc636f609c47dddb29"));
  assert("rejects a 41-char SHA", !isPinnedSha("a1d282b36b6f3519aa1f3fc636f609c47dddb2940"));
  assert("rejects an uppercase SHA", !isPinnedSha("A1D282B36B6F3519AA1F3FC636F609C47DDDB294"));
  assert("rejects a tag ref", !isPinnedSha("v5.0.0"));
  assert("accepts a `# vX.Y.Z` comment", hasVersionComment("v5.0.0"));
  assert("accepts a `# X.Y.Z` comment", hasVersionComment("0.24.3"));
  assert("rejects a branch comment", !hasVersionComment("main"));
  assert("splits owner/repo@sha", splitActionRef("actions/checkout@abc")?.action === "actions/checkout");
  assert("rejects a missing @ref", splitActionRef("actions/checkout") === null);
  assert(
    "detects the image-scan guard",
    IMAGE_SCAN_GUARD_RE.test("github.event_name != 'pull_request'"),
  );
  return checks;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function runRealCheck({ workflowPath, policyPath, json, output, quiet }) {
  let text;
  try {
    text = readFileSync(workflowPath, "utf8");
  } catch (error) {
    const report = createReport(TOOL);
    report.error("workflow-unreadable", `cannot read workflow ${workflowPath}: ${error.message}`);
    return finish(report, { json, output });
  }
  let policy = null;
  if (existsSync(policyPath)) {
    try {
      policy = parseYaml(readFileSync(policyPath, "utf8"));
    } catch (error) {
      const report = createReport(TOOL);
      report.error("policy-unreadable", `cannot parse policy ${policyPath}: ${error.message}`);
      return finish(report, { json, output });
    }
  }
  const report = checkWorkflowText(text, {
    policy,
    relPath: workflowPath,
    crossFile: true,
  });
  if (!quiet) {
    console.log(`workflow: ${workflowPath}`);
    const usesLines = text.split("\n").filter((line) => USES_LINE_RE.test(line)).length;
    console.log(`action references inspected: ${usesLines}`);
  }
  return finish(report, { json, output });
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2), {
      flags: ["help", "json", "self-test", "fixtures", "quiet"],
      values: ["workflow", "policy", "output"],
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
  const output = args.values.output ? resolveFromRoot(args.values.output) : null;
  const workflowPath = resolveFromRoot(args.values.workflow ?? ".github/workflows/security.yml");
  const policyPath = resolveFromRoot(args.values.policy ?? ".github/security/policy.yml");

  if (args.flags.has("fixtures")) {
    const cases = runFixtureMatrix({ quiet });
    const passed = cases.every((entry) => entry.passed);
    if (json) console.log(JSON.stringify({ tool: TOOL, mode: "fixtures", ok: passed, cases }));
    if (output) {
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, `${JSON.stringify({ tool: TOOL, mode: "fixtures", ok: passed, cases }, null, 2)}\n`, "utf8");
    }
    console.log(`${passed ? "PASS" : "FAIL"} ${TOOL} fixture matrix: ${cases.filter((entry) => entry.passed).length}/${cases.length}`);
    return passed ? EXIT_OK : EXIT_VIOLATION;
  }

  if (args.flags.has("self-test")) {
    const primitives = runPrimitiveAssertions(quiet);
    const cases = runFixtureMatrix({ quiet });
    const realReport = (() => {
      try {
        const text = readFileSync(workflowPath, "utf8");
        const policy = existsSync(policyPath) ? parseYaml(readFileSync(policyPath, "utf8")) : null;
        return checkWorkflowText(text, { policy, relPath: workflowPath, crossFile: true });
      } catch (error) {
        const report = createReport(TOOL);
        report.error("workflow-unreadable", error.message);
        return report;
      }
    })();
    const realPassed = realReport.ok;
    if (!quiet) printCase("real security workflow passes", realPassed, realPassed ? "" : "see default run for details");
    const ok =
      primitives.every((entry) => entry.passed) &&
      cases.every((entry) => entry.passed) &&
      realPassed;
    const payload = {
      tool: TOOL,
      mode: "self-test",
      ok,
      primitives,
      fixtures: cases,
      realWorkflow: { path: workflowPath, ok: realPassed, errors: realReport.errors },
    };
    if (json) console.log(JSON.stringify(payload));
    console.log(
      `${ok ? "PASS" : "FAIL"} ${TOOL} self-test: primitives ${primitives.filter((entry) => entry.passed).length}/${primitives.length}, ` +
        `fixtures ${cases.filter((entry) => entry.passed).length}/${cases.length}, real workflow ${realPassed ? "pass" : "fail"}`,
    );
    return ok ? EXIT_OK : EXIT_VIOLATION;
  }

  return runRealCheck({ workflowPath, policyPath, json, output, quiet });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exitCode = main();
  } catch (error) {
    if (error instanceof YamlError) {
      console.error(`${TOOL}: YAML error: ${error.message}`);
      process.exitCode = EXIT_USAGE;
    } else {
      console.error(`${TOOL}: internal error: ${error instanceof Error ? error.stack : String(error)}`);
      process.exitCode = EXIT_USAGE;
    }
  }
}

export { FIXTURE_EXPECTATIONS, FIXTURE_DIR, REPO_ROOT };
