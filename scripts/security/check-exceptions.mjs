#!/usr/bin/env node
/**
 * E3.7 offline gate: enforce the security policy file and its exceptions.
 *
 * What this checks (all offline, no network, Node built-ins only)
 *  - `.github/security/policy.yml` is structurally valid and states the
 *    runtime-vs-development scope, severity threshold, exploitability and
 *    fix-availability rules for dependency review, image scan and secret scan.
 *  - Every exception carries a vulnerability ID, reason, owner, expiry date and
 *    compensating controls. Missing fields fail the gate.
 *  - Expired exceptions fail the gate (expiry is enforced, not decorative).
 *  - `.github/security/trivy-ignore.yaml` entries cannot outlive their policy
 *    exception and must be backed by one; a permanent ignore is rejected.
 *  - `.github/security/gitleaks.toml` extends the default rules and carries
 *    reasoned allowlists for known placeholder-secret locations
 *    (`docs/evidence/**`, `*.env*.example`, `scripts/security/fixtures/**`)
 *    so real findings are not hidden and known non-secrets are not re-reported.
 *
 * Usage:
 *   node scripts/security/check-exceptions.mjs [options]
 *
 * Options:
 *   --policy <file>         policy file (default: .github/security/policy.yml)
 *   --trivy-ignore <file>   Trivy YAML ignore file (default: .github/security/trivy-ignore.yaml)
 *   --gitleaks-config <file> gitleaks config (default: .github/security/gitleaks.toml)
 *   --today <YYYY-MM-DD>    evaluation date for expiry checks (default: current UTC date)
 *   --json                  print a single machine-readable JSON line
 *   --output <file>         also write the JSON report to <file>
 *   --self-test             run unit assertions + controlled fixture matrix + real files
 *   --fixtures              run only the controlled fixture matrix
 *   --quiet                 only print the final PASS/FAIL line
 *   --help                  print this text
 *
 * Exit codes: 0 pass, 1 violation or failed expectation, 2 usage/internal error.
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
import { YamlError, getPath, parseYaml } from "./lib/yaml-lite.mjs";

const TOOL = "check-exceptions";
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(SCRIPT_DIR, "fixtures", "policy");

const EXCEPTION_TOOLS = new Set(["dependency-review", "image-scan", "secret-scan"]);
const DEP_SEVERITIES = new Set(["low", "moderate", "high", "critical"]);
const IMAGE_SEVERITIES = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const SCOPES = new Set(["unknown", "runtime", "development"]);
const TRIAGE_ACTIONS = new Set(["block", "report", "exception_required"]);
const REQUIRED_EXCEPTION_FIELDS = [
  "id",
  "tool",
  "vuln_id",
  "reason",
  "owner",
  "expires_on",
  "compensating_controls",
];
const TRIVY_SECTIONS = new Set([
  "vulnerabilities",
  "misconfigurations",
  "secrets",
  "licenses",
]);
const ALLOWLIST_COVERAGE = [
  { code: "docs-evidence", regex: /docs\/evidence/, hint: "docs/evidence/** placeholder secrets" },
  { code: "env-examples", regex: /\.env/, hint: "*.env*.example placeholder values" },
  {
    code: "controlled-fixtures",
    regex: /E37CONTROLLED-/,
    hint: "the E37CONTROLLED- synthetic marker used by controlled security fixtures",
  },
];

const HELP = `
check-exceptions — E3.7 policy, exception and ignore-file gate

Usage:
  node scripts/security/check-exceptions.mjs [options]

Options:
  --policy <file>          policy file (default: .github/security/policy.yml)
  --trivy-ignore <file>    Trivy YAML ignore file (default: .github/security/trivy-ignore.yaml)
  --gitleaks-config <file> gitleaks config (default: .github/security/gitleaks.toml)
  --today <YYYY-MM-DD>     evaluation date for expiry checks (default: current UTC date)
  --json                   print a single machine-readable JSON line
  --output <file>          also write the JSON report to <file>
  --self-test              run unit assertions + controlled fixture matrix + real files
  --fixtures               run only the controlled fixture matrix
  --quiet                  only print the final PASS/FAIL line
  --help                   print this text

Exit codes: 0 pass, 1 violation or failed expectation, 2 usage/internal error.
`;

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseIsoDate(value) {
  if (typeof value !== "string") return null;
  const match = value.match(DATE_RE);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

export function isValidIsoDate(value) {
  return parseIsoDate(value) !== null;
}

export function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

/** True when `expiresOn` is strictly before `today`. */
export function isExpired(expiresOn, today) {
  const expires = parseIsoDate(expiresOn);
  const reference = parseIsoDate(today);
  if (!expires || !reference) return false;
  return expires.getTime() < reference.getTime();
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

// ---------------------------------------------------------------------------
// Policy validation
// ---------------------------------------------------------------------------

function validateTriageActions(report, path, block) {
  const object = asObject(block);
  if (!object) {
    report.error("policy-missing-block", `policy.${path} must be a mapping`);
    return null;
  }
  for (const [key, value] of Object.entries(object)) {
    if (typeof value === "string" && !TRIAGE_ACTIONS.has(value)) {
      report.error(
        "policy-triage-action",
        `policy.${path}.${key} = \`${value}\` is not one of block/report/exception_required`,
      );
    }
  }
  return object;
}

function validateExploitability(report, path, block) {
  const object = validateTriageActions(report, path, block);
  if (!object) return;
  if (!isNonEmptyString(object.known_exploited)) {
    report.error("policy-exploitability", `policy.${path}.known_exploited must describe CISA KEV handling`);
  }
  if (typeof object.epss_threshold !== "number" || object.epss_threshold < 0 || object.epss_threshold > 1) {
    report.error("policy-exploitability", `policy.${path}.epss_threshold must be a number between 0 and 1`);
  }
}

function validateFixAvailability(report, path, block) {
  const object = validateTriageActions(report, path, block);
  if (!object) return;
  for (const key of ["fix_available", "no_fix_available"]) {
    if (!isNonEmptyString(object[key])) {
      report.error("policy-fix-availability", `policy.${path}.${key} is required`);
    }
  }
}

/** Validate the policy document; returns the parsed policy object or null. */
export function checkPolicy(policy, { today, relPath = "policy.yml" } = {}) {
  const report = createReport(TOOL);
  const root = asObject(policy);
  if (!root) {
    report.error("policy-parse", `${relPath}: policy root must be a mapping`);
    return { report, policy: null };
  }
  if (root.version !== 1) {
    report.error("policy-version", `${relPath}: policy.version must be 1`);
  }
  const body = asObject(root.policy);
  if (!body) {
    report.error("policy-missing-block", `${relPath}: \`policy:\` mapping is required`);
    return { report, policy: root };
  }

  // Dependency review: runtime vs development, severity, exploitability, fixes.
  const depReview = asObject(body.dependency_review);
  if (!depReview) {
    report.error("policy-missing-block", "policy.dependency_review is required");
  } else {
    if (!DEP_SEVERITIES.has(depReview.fail_on_severity)) {
      report.error(
        "policy-dep-severity",
        `policy.dependency_review.fail_on_severity must be one of ${[...DEP_SEVERITIES].join(", ")}`,
      );
    }
    if (!isNonEmptyString(depReview.fail_on_scopes)) {
      report.error("policy-dep-scopes", "policy.dependency_review.fail_on_scopes is required");
    } else {
      for (const scope of depReview.fail_on_scopes.split(",").map((entry) => entry.trim())) {
        if (!SCOPES.has(scope)) {
          report.error("policy-dep-scopes", `unknown dependency scope \`${scope}\``);
        }
      }
    }
    if (!["report", "block"].includes(depReview.development_findings)) {
      report.error(
        "policy-dep-development",
        "policy.dependency_review.development_findings must be `report` or `block`",
      );
    }
    validateExploitability(report, "dependency_review.exploitability", depReview.exploitability);
    validateFixAvailability(report, "dependency_review.fix_availability", depReview.fix_availability);
  }

  // Image scan: severity, exploitability, fix availability, scanners, ignore file.
  const imageScan = asObject(body.image_scan);
  if (!imageScan) {
    report.error("policy-missing-block", "policy.image_scan is required");
  } else {
    if (!IMAGE_SEVERITIES.has(String(imageScan.fail_on_severity))) {
      report.error(
        "policy-image-severity",
        `policy.image_scan.fail_on_severity must be one of ${[...IMAGE_SEVERITIES].join(", ")}`,
      );
    }
    if (typeof imageScan.ignore_unfixed !== "boolean") {
      report.error("policy-image-unfixed", "policy.image_scan.ignore_unfixed must be a boolean");
    }
    if (!Array.isArray(imageScan.scanners) || imageScan.scanners.length === 0) {
      report.error("policy-image-scanners", "policy.image_scan.scanners must be a non-empty list");
    }
    if (!isNonEmptyString(imageScan.ignore_file)) {
      report.error("policy-image-ignore-file", "policy.image_scan.ignore_file is required");
    }
    validateExploitability(report, "image_scan.exploitability", imageScan.exploitability);
    validateFixAvailability(report, "image_scan.fix_availability", imageScan.fix_availability);
  }

  // Secret scan config.
  const secretScan = asObject(body.secret_scan);
  if (!secretScan) {
    report.error("policy-missing-block", "policy.secret_scan is required");
  } else {
    if (typeof secretScan.fail_on_findings !== "boolean") {
      report.error("policy-secret-fail", "policy.secret_scan.fail_on_findings must be a boolean");
    }
    if (!isNonEmptyString(secretScan.config)) {
      report.error("policy-secret-config", "policy.secret_scan.config is required");
    }
  }

  // Supply-chain (lockfile) policy.
  const supplyChain = asObject(body.supply_chain);
  if (!supplyChain) {
    report.error("policy-missing-block", "policy.supply_chain is required");
  } else {
    for (const key of ["allowed_resolved_hosts", "legacy_mirror_hosts"]) {
      if (!Array.isArray(supplyChain[key])) {
        report.error("policy-supply-hosts", `policy.supply_chain.${key} must be a list`);
      }
    }
    if (typeof supplyChain.require_integrity !== "boolean") {
      report.error("policy-supply-integrity", "policy.supply_chain.require_integrity must be a boolean");
    }
    if (typeof supplyChain.require_https !== "boolean") {
      report.error("policy-supply-https", "policy.supply_chain.require_https must be a boolean");
    }
    if (!isNonEmptyString(supplyChain.lockfile)) {
      report.error("policy-supply-lockfile", "policy.supply_chain.lockfile is required");
    }
  }

  // SBOM formats.
  const sbom = asObject(body.sbom);
  if (!sbom) {
    report.error("policy-missing-block", "policy.sbom is required");
  } else {
    const formats = asArray(sbom.formats);
    for (const format of ["spdx-json", "cyclonedx-json"]) {
      if (!formats.includes(format)) {
        report.error("policy-sbom-format", `policy.sbom.formats must include \`${format}\``);
      }
    }
  }

  // Exception contract.
  const exceptionPolicy = asObject(body.exceptions);
  if (!exceptionPolicy) {
    report.error("policy-missing-block", "policy.exceptions is required");
  } else {
    const requiredFields = asArray(exceptionPolicy.required_fields);
    for (const field of REQUIRED_EXCEPTION_FIELDS) {
      if (!requiredFields.includes(field)) {
        report.error(
          "policy-exception-fields",
          `policy.exceptions.required_fields must include \`${field}\``,
        );
      }
    }
    if (exceptionPolicy.expired_policy !== "fail") {
      report.error("policy-exception-expiry", "policy.exceptions.expired_policy must be `fail`");
    }
    const tools = asArray(exceptionPolicy.tools);
    for (const tool of EXCEPTION_TOOLS) {
      if (!tools.includes(tool)) {
        report.error("policy-exception-tools", `policy.exceptions.tools must include \`${tool}\``);
      }
    }
  }

  // Exceptions themselves.
  const exceptions = asArray(root.exceptions);
  if (root.exceptions !== undefined && !Array.isArray(root.exceptions)) {
    report.error("exception-shape", `${relPath}: \`exceptions:\` must be a list`);
  }
  const seenIds = new Set();
  const seenVulns = new Set();
  for (const [index, exception] of exceptions.entries()) {
    const entry = asObject(exception);
    if (!entry) {
      report.error("exception-shape", `exceptions[${index}] must be a mapping`);
      continue;
    }
    const label = isNonEmptyString(entry.id) ? entry.id : `exceptions[${index}]`;
    for (const field of REQUIRED_EXCEPTION_FIELDS) {
      if (!isNonEmptyString(entry[field])) {
        report.error("exception-required-field", `${label}: required field \`${field}\` is missing or empty`);
      }
    }
    if (isNonEmptyString(entry.id)) {
      if (seenIds.has(entry.id)) report.error("exception-duplicate-id", `duplicate exception id \`${entry.id}\``);
      seenIds.add(entry.id);
    }
    if (isNonEmptyString(entry.tool) && !EXCEPTION_TOOLS.has(entry.tool)) {
      report.error("exception-tool", `${label}: tool \`${entry.tool}\` is not a known security gate`);
    }
    if (isNonEmptyString(entry.vuln_id)) {
      const key = `${entry.tool}:${entry.vuln_id}`;
      if (seenVulns.has(key)) {
        report.error("exception-duplicate-vuln", `${label}: duplicate exception for ${key}`);
      }
      seenVulns.add(key);
    }
    if (entry.status !== undefined && !["active", "retired"].includes(entry.status)) {
      report.error("exception-status", `${label}: status must be \`active\` or \`retired\``);
    }
    if (isNonEmptyString(entry.expires_on)) {
      if (!isValidIsoDate(entry.expires_on)) {
        report.error("exception-date", `${label}: expires_on \`${entry.expires_on}\` is not a valid YYYY-MM-DD date`);
      } else {
        if (isExpired(entry.expires_on, today)) {
          report.error(
            "exception-expired",
            `${label}: exception expired on ${entry.expires_on}; renew it with new evidence or fix the finding`,
          );
        }
        const horizonDays = exceptionPolicy ? exceptionPolicy.max_horizon_days : undefined;
        if (typeof horizonDays === "number") {
          const expires = parseIsoDate(entry.expires_on);
          const reference = parseIsoDate(today);
          if (expires && reference) {
            const days = Math.round((expires.getTime() - reference.getTime()) / 86_400_000);
            if (days > horizonDays) {
              report.warn(
                "exception-horizon",
                `${label}: expires in ${days} days, beyond the ${horizonDays}-day review horizon`,
              );
            }
          }
        }
      }
    }
    for (const field of ["exploitability", "fix_availability"]) {
      if (entry[field] !== undefined && !isNonEmptyString(entry[field])) {
        report.error("exception-analysis", `${label}: \`${field}\` must be a short non-empty assessment`);
      }
    }
  }

  return { report, policy: root };
}

// ---------------------------------------------------------------------------
// Trivy ignore YAML validation
// ---------------------------------------------------------------------------

function exceptionForVuln(policy, tool, vulnId) {
  return asArray(policy?.exceptions).find(
    (entry) => asObject(entry)?.tool === tool && asObject(entry)?.vuln_id === vulnId,
  );
}

export function checkTrivyIgnore(trivyIgnore, policy, { today, relPath = "trivy-ignore.yaml" } = {}) {
  const report = createReport(TOOL);
  if (trivyIgnore === null || trivyIgnore === undefined) {
    // Empty file is a valid "no ignores" state.
    return report;
  }
  const root = asObject(trivyIgnore);
  if (!root) {
    report.error("trivy-ignore-shape", `${relPath}: ignored findings file must be a mapping`);
    return report;
  }
  for (const key of Object.keys(root)) {
    if (!TRIVY_SECTIONS.has(key)) {
      report.error("trivy-ignore-section", `${relPath}: unknown section \`${key}\``);
    }
  }
  for (const section of TRIVY_SECTIONS) {
    if (root[section] === undefined || root[section] === null) continue;
    if (!Array.isArray(root[section])) {
      report.error("trivy-ignore-section", `${relPath}: \`${section}\` must be a list`);
      continue;
    }
    for (const [index, entry] of root[section].entries()) {
      const item = asObject(entry);
      const label = `${relPath}:${section}[${index}]`;
      if (!item) {
        report.error("trivy-ignore-shape", `${label} must be a mapping`);
        continue;
      }
      if (!isNonEmptyString(item.id)) {
        report.error("trivy-ignore-id", `${label} must declare an \`id\``);
        continue;
      }
      const ignoreLabel = `${label} (${item.id})`;
      if (!isNonEmptyString(item.statement)) {
        report.error("trivy-ignore-statement", `${ignoreLabel} must declare a \`statement\` reason`);
      }
      if (!isNonEmptyString(item.expired_at)) {
        report.error(
          "trivy-ignore-missing-expiry",
          `${ignoreLabel} must declare \`expired_at\`; permanent image-scan ignores are not allowed`,
        );
      } else if (!isValidIsoDate(item.expired_at)) {
        report.error("trivy-ignore-date", `${ignoreLabel}: expired_at \`${item.expired_at}\` is not a valid date`);
      } else if (isExpired(item.expired_at, today)) {
        report.error(
          "trivy-ignore-expired",
          `${ignoreLabel}: ignore expired on ${item.expired_at}; scan findings can no longer be suppressed`,
        );
      } else {
        const tool = section === "secrets" ? "secret-scan" : "image-scan";
        const backing = exceptionForVuln(policy, tool, item.id);
        if (!backing) {
          report.error(
            "trivy-ignore-unbacked",
            `${ignoreLabel} has no matching \`${tool}\` exception in policy.yml`,
          );
        } else if (isNonEmptyString(backing.expires_on) && isValidIsoDate(backing.expires_on)) {
          if (parseIsoDate(item.expired_at).getTime() > parseIsoDate(backing.expires_on).getTime()) {
            report.error(
              "trivy-ignore-outlives-exception",
              `${ignoreLabel}: expired_at ${item.expired_at} is later than policy exception expiry ${backing.expires_on}`,
            );
          }
        }
      }
    }
  }
  return report;
}

// ---------------------------------------------------------------------------
// gitleaks config validation
// ---------------------------------------------------------------------------

function stripTomlComment(line) {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote === '"') {
      if (char === "\\") index += 1;
      else if (char === '"') quote = null;
    } else if (quote === "'") {
      if (char === "'") quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "#") {
      return line.slice(0, index);
    }
  }
  return line;
}

function extractQuotedStrings(text) {
  const values = [];
  const triple = /'''([\s\S]*?)'''/g;
  let match;
  while ((match = triple.exec(text)) !== null) values.push(match[1]);
  const single = /"((?:[^"\\]|\\.)*)"/g;
  while ((match = single.exec(text)) !== null) values.push(match[1]);
  return values;
}

/**
 * Parse `[[allowlists]]` tables into {description, paths[], regexes[], line}.
 * This is a purpose-built reader for the repository-owned config, not a TOML
 * parser: unsupported constructs are ignored, structural problems are reported.
 */
export function parseGitleaksAllowlists(text) {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  const allowlists = [];
  let current = null;
  let openArray = null;
  const pushValue = (key, value) => {
    if (!current) return;
    current[key].push(...extractQuotedStrings(value));
  };
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (/^\s*\[\[allowlists\]\]\s*$/.test(raw.trim())) {
      current = { description: "", paths: [], regexes: [], lineNo: index + 1, rawLines: [] };
      allowlists.push(current);
      openArray = null;
      continue;
    }
    if (!current) continue;
    if (/^\s*\[/.test(raw) && !/^\s*\[\[?allowlists\]\]?/.test(raw)) {
      current = null;
      openArray = null;
      continue;
    }
    current.rawLines.push(raw);
    const cleaned = stripTomlComment(raw);
    if (openArray) {
      pushValue(openArray.key, cleaned);
      if (/\]\s*$/.test(cleaned)) openArray = null;
      continue;
    }
    const arrayStart = cleaned.match(/^\s*(paths|regexes)\s*=\s*\[(.*)$/);
    if (arrayStart) {
      const key = arrayStart[1];
      pushValue(key, arrayStart[2]);
      if (!/\]\s*$/.test(arrayStart[2])) {
        openArray = { key };
      }
      continue;
    }
    const description = cleaned.match(/^\s*description\s*=\s*(.*)$/);
    if (description) {
      const value = description[1].trim();
      const triple = value.match(/^"""([\s\S]*?)"""/);
      if (triple) {
        current.description = triple[1].trim();
        continue;
      }
      const quoted = value.match(/^"((?:[^"\\]|\\.)*)"\s*$/);
      if (quoted) {
        current.description = quoted[1].trim();
        continue;
      }
      const singleQuoted = value.match(/^'((?:[^'\\]|\\.)*)'\s*$/);
      if (singleQuoted) {
        current.description = singleQuoted[1].trim();
        continue;
      }
      current.description = value.trim();
    }
  }
  return allowlists;
}

export function checkGitleaksConfig(text, { relPath = "gitleaks.toml" } = {}) {
  const report = createReport(TOOL);
  if (typeof text !== "string" || text.trim() === "") {
    report.error("gitleaks-empty", `${relPath}: gitleaks config is missing or empty`);
    return report;
  }
  if (!/^\s*\[extend\]\s*$/m.test(text)) {
    report.error("gitleaks-extend", `${relPath}: must declare an \`[extend]\` section`);
  }
  if (!/^\s*useDefault\s*=\s*true\s*(#.*)?$/m.test(text)) {
    report.error("gitleaks-default-rules", `${relPath}: must set \`useDefault = true\` to keep built-in rules`);
  }
  const allowlists = parseGitleaksAllowlists(text);
  if (allowlists.length === 0) {
    report.error("gitleaks-no-allowlist", `${relPath}: expected at least one reasoned \`[[allowlists]]\` entry`);
    return report;
  }
  const coverage = { paths: "", regexes: "" };
  for (const [index, allowlist] of allowlists.entries()) {
    const label = `[[allowlists]] #${index + 1} (line ${allowlist.lineNo})`;
    if (allowlist.description.trim() === "") {
      report.error("gitleaks-allowlist-description", `${label} must explain why the allowlist exists`);
    }
    if (allowlist.paths.length === 0 && allowlist.regexes.length === 0) {
      report.error("gitleaks-allowlist-empty", `${label} must declare \`paths\` or \`regexes\``);
    }
    for (const pathPattern of allowlist.paths) {
      if (pathPattern.trim() === ".*" || pathPattern.trim() === "") {
        report.error("gitleaks-allowlist-too-broad", `${label}: path allowlist \`${pathPattern}\` hides the whole tree`);
      }
    }
    coverage.paths += `\n${allowlist.paths.join("\n")}`;
    coverage.regexes += `\n${allowlist.regexes.join("\n")}`;
  }
  for (const requirement of ALLOWLIST_COVERAGE) {
    if (!requirement.regex.test(coverage.paths) && !requirement.regex.test(coverage.regexes)) {
      report.error(
        "gitleaks-allowlist-coverage",
        `${relPath}: no allowlist covers ${requirement.hint} (${requirement.code}); known placeholders would be re-reported`,
      );
    }
  }
  return report;
}

// ---------------------------------------------------------------------------
// Combined real-file check
// ---------------------------------------------------------------------------

export function runChecks({ policyPath, trivyIgnorePath, gitleaksPath, today, quiet = false, filesExist = true }) {
  const report = createReport(TOOL);
  const combined = { report, policy: null, trivy: null, gitleaks: null };

  if (filesExist && !existsSync(policyPath)) {
    report.error("policy-unreadable", `policy file not found: ${policyPath}`);
    return combined;
  }
  if (existsSync(policyPath)) {
    try {
      combined.policy = parseYaml(readFileSync(policyPath, "utf8"));
    } catch (error) {
      report.error("policy-parse", `cannot parse ${policyPath}: ${error.message}`);
      return combined;
    }
    const policyResult = checkPolicy(combined.policy, { today, relPath: policyPath });
    mergeReport(report, policyResult.report);
  }

  if (existsSync(trivyIgnorePath)) {
    try {
      combined.trivy = parseYaml(readFileSync(trivyIgnorePath, "utf8"));
    } catch (error) {
      report.error("trivy-ignore-parse", `cannot parse ${trivyIgnorePath}: ${error.message}`);
      return combined;
    }
    mergeReport(
      report,
      checkTrivyIgnore(combined.trivy, combined.policy, { today, relPath: trivyIgnorePath }),
    );
  } else if (filesExist) {
    report.error("trivy-ignore-missing", `Trivy YAML ignore file not found: ${trivyIgnorePath}`);
  }

  if (existsSync(gitleaksPath)) {
    mergeReport(report, checkGitleaksConfig(readFileSync(gitleaksPath, "utf8"), { relPath: gitleaksPath }));
  } else if (filesExist) {
    report.error("gitleaks-missing", `gitleaks config not found: ${gitleaksPath}`);
  }

  if (!quiet && combined.policy) {
    const exceptionCount = asArray(combined.policy.exceptions).length;
    console.log(`policy exceptions: ${exceptionCount}`);
  }
  return combined;
}

function mergeReport(target, source) {
  target.findings.push(...source.findings);
  target.errors.push(...source.errors);
  target.warnings.push(...source.warnings);
}

// ---------------------------------------------------------------------------
// Controlled fixture matrix
// ---------------------------------------------------------------------------

const VALID_POLICY = "valid-policy.yml";
const VALID_TRIVY = "empty-trivy-ignore.yaml";
const VALID_GITLEAKS = "valid-gitleaks.toml";

const FIXTURE_EXPECTATIONS = [
  { name: "valid policy with no exceptions", policy: VALID_POLICY, expectPass: true },
  {
    name: "active exception backed by trivy ignore",
    policy: "valid-exception-policy.yml",
    trivy: "backed-trivy-ignore.yaml",
    expectPass: true,
  },
  {
    name: "expired exception fails",
    policy: "expired-exception-policy.yml",
    expectCodes: ["exception-expired"],
  },
  {
    name: "exception missing compensating controls fails",
    policy: "missing-controls-policy.yml",
    expectCodes: ["exception-required-field"],
  },
  {
    name: "exception missing owner fails",
    policy: "missing-owner-policy.yml",
    expectCodes: ["exception-required-field"],
  },
  {
    name: "exception invalid expiry date fails",
    policy: "invalid-date-policy.yml",
    expectCodes: ["exception-date"],
  },
  {
    name: "trivy ignore without policy exception fails",
    policy: VALID_POLICY,
    trivy: "unbacked-trivy-ignore.yaml",
    expectCodes: ["trivy-ignore-unbacked"],
  },
  {
    name: "trivy ignore past expiry fails",
    policy: "expired-exception-policy.yml",
    trivy: "expired-trivy-ignore.yaml",
    expectCodes: ["trivy-ignore-expired"],
  },
  {
    name: "trivy ignore without expiry fails",
    policy: VALID_POLICY,
    trivy: "permanent-trivy-ignore.yaml",
    expectCodes: ["trivy-ignore-missing-expiry"],
  },
  {
    name: "broad gitleaks allowlist fails",
    policy: VALID_POLICY,
    gitleaks: "broad-allowlist-gitleaks.toml",
    expectCodes: ["gitleaks-allowlist-too-broad"],
  },
  {
    name: "gitleaks allowlist missing placeholder coverage fails",
    policy: VALID_POLICY,
    gitleaks: "narrow-allowlist-gitleaks.toml",
    expectCodes: ["gitleaks-allowlist-coverage"],
  },
  {
    name: "gitleaks config without default rules fails",
    policy: VALID_POLICY,
    gitleaks: "no-default-rules-gitleaks.toml",
    expectCodes: ["gitleaks-default-rules"],
  },
];

export function runFixtureMatrix({ quiet = false, today = "2026-11-11" } = {}) {
  const cases = [];
  for (const expectation of FIXTURE_EXPECTATIONS) {
    const policyPath = join(FIXTURE_DIR, expectation.policy ?? VALID_POLICY);
    const trivyPath = join(FIXTURE_DIR, expectation.trivy ?? VALID_TRIVY);
    const gitleaksPath = join(FIXTURE_DIR, expectation.gitleaks ?? VALID_GITLEAKS);
    const combined = runChecks({
      policyPath,
      trivyIgnorePath: trivyPath,
      gitleaksPath,
      today,
      quiet: true,
      filesExist: true,
    });
    const actualCodes = [...new Set(combined.report.errors.map((error) => error.code))];
    const expectedPass = Boolean(expectation.expectPass);
    const codesMatch = (expectation.expectCodes ?? []).every((code) => actualCodes.includes(code));
    const passStateMatches = expectedPass ? combined.report.errors.length === 0 : combined.report.errors.length > 0;
    const passed = codesMatch && passStateMatches;
    cases.push({
      case: expectation.name,
      passed,
      expected: expectedPass ? "pass" : `fail with ${expectation.expectCodes.join(", ")}`,
      actualErrorCodes: actualCodes,
    });
    if (!quiet) {
      printCase(
        expectation.name,
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
  assert("accepts a valid date", isValidIsoDate("2026-11-11"));
  assert("rejects an impossible date", !isValidIsoDate("2026-02-30"));
  assert("rejects a non-date string", !isValidIsoDate("next quarter"));
  assert("detects an expired exception", isExpired("2000-01-01", "2026-11-11"));
  assert("does not expire today's exception", !isExpired("2026-11-11", "2026-11-11"));
  assert("valid gitleaks config passes", checkGitleaksConfig(readFileSync(join(FIXTURE_DIR, VALID_GITLEAKS), "utf8")).ok);
  assert(
    "gitleaks allowlist parser sees three allowlists",
    parseGitleaksAllowlists(readFileSync(join(FIXTURE_DIR, VALID_GITLEAKS), "utf8")).length === 3,
  );
  return checks;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2), {
      flags: ["help", "json", "self-test", "fixtures", "quiet"],
      values: ["policy", "trivy-ignore", "gitleaks-config", "today", "output"],
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
  const today = args.values.today ?? todayUtc();
  if (!isValidIsoDate(today)) {
    console.error(`usage error: --today must be a valid YYYY-MM-DD date, got \`${today}\``);
    return EXIT_USAGE;
  }
  const policyPath = resolveFromRoot(args.values.policy ?? ".github/security/policy.yml");
  const trivyIgnorePath = resolveFromRoot(args.values["trivy-ignore"] ?? ".github/security/trivy-ignore.yaml");
  const gitleaksPath = resolveFromRoot(args.values["gitleaks-config"] ?? ".github/security/gitleaks.toml");

  if (args.flags.has("fixtures")) {
    const cases = runFixtureMatrix({ quiet, today });
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

  if (args.flags.has("self-test")) {
    const primitives = runPrimitiveAssertions(quiet);
    const cases = runFixtureMatrix({ quiet, today });
    const real = runChecks({ policyPath, trivyIgnorePath, gitleaksPath, today, quiet: true });
    const realPassed = real.report.ok;
    if (!quiet) printCase("real policy/ignore/config files pass", realPassed, realPassed ? "" : "see default run for details");
    const ok = primitives.every((entry) => entry.passed) && cases.every((entry) => entry.passed) && realPassed;
    const payload = {
      tool: TOOL,
      mode: "self-test",
      ok,
      today,
      primitives,
      fixtures: cases,
      realFiles: { ok: realPassed, errors: real.report.errors },
    };
    if (json) console.log(JSON.stringify(payload));
    console.log(
      `${ok ? "PASS" : "FAIL"} ${TOOL} self-test: primitives ${primitives.filter((entry) => entry.passed).length}/${primitives.length}, ` +
        `fixtures ${cases.filter((entry) => entry.passed).length}/${cases.length}, real files ${realPassed ? "pass" : "fail"}`,
    );
    return ok ? EXIT_OK : EXIT_VIOLATION;
  }

  const combined = runChecks({ policyPath, trivyIgnorePath, gitleaksPath, today, quiet });
  if (!quiet) {
    console.log(`policy: ${policyPath}`);
    console.log(`trivy ignore: ${trivyIgnorePath}`);
    console.log(`gitleaks config: ${gitleaksPath}`);
    console.log(`evaluation date (UTC): ${today}`);
  }
  return finish(combined.report, { json, output, summaryExtra: { today } });
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

export { FIXTURE_DIR, FIXTURE_EXPECTATIONS, REPO_ROOT };
