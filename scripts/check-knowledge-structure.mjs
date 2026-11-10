#!/usr/bin/env node
/**
 * E1.7 knowledge sync gate: structural checks for the Obsidian knowledge base.
 *
 * Checks (all offline, Node built-ins only):
 *  - Markdown relative links between docs/ and knowledge/ resolve to a file or directory.
 *  - Obsidian [[wikilink]], [[note#heading]] and ![[embed]] targets resolve to a
 *    knowledge note (and the heading exists when one is given).
 *  - YAML frontmatter exists and parses for knowledge notes; approved documents
 *    carry owner/version/updated.
 *  - ADR IDs are unique across knowledge/05-ADR and the ADR register, and the
 *    register and ADR files point at each other.
 *  - Every test plan references an existing Feature Spec (path/ID), every
 *    Feature Spec references at least one test plan, and cited AC/FS IDs exist.
 *  - A superseded document points at its replacement.
 *
 * Historical gaps are carried in an explicit, reasoned exception list instead
 * of being silently ignored. Suppressed failures are re-emitted as warnings so
 * they stay visible in the run summary.
 *
 * Usage:
 *   node scripts/check-knowledge-structure.mjs [options]
 *
 * Options:
 *   --root <dir>            repository root to scan (default: repository root)
 *   --checks <list>         comma-separated subset: links,wikilinks,frontmatter,
 *                           adr,specs,superseded (default: all; "tracking" = specs)
 *   --exceptions <file>     JSON exception list (default: built-in list for this repo)
 *   --json                  print only the machine-readable JSON summary line
 *   --summary-file <file>   also write the Markdown summary to <file>
 *   --no-github-summary     do not append to $GITHUB_STEP_SUMMARY
 *   --help                  print this text
 *
 * Exit code: 0 when no unsuppressed error remains, 1 otherwise.
 *
 * Machine-readable line (human mode):
 *   KNOWLEDGE_STRUCTURE_RESULT {"tool":"check-knowledge-structure",...}
 */

import {
  appendFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

export const SCRIPT_VERSION = 1;
export const TOOL_NAME = "check-knowledge-structure";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = resolve(SCRIPT_DIR, "..");

export const RULE_CODES = Object.freeze({
  FM_MISSING: "FM_MISSING",
  FM_PARSE_ERROR: "FM_PARSE_ERROR",
  FM_REQUIRED_KEY: "FM_REQUIRED_KEY",
  FM_INVALID_STATUS: "FM_INVALID_STATUS",
  FM_INVALID_FIELD: "FM_INVALID_FIELD",
  APPROVED_METADATA_MISSING: "APPROVED_METADATA_MISSING",
  LINK_MISSING: "LINK_MISSING",
  WIKILINK_UNRESOLVED: "WIKILINK_UNRESOLVED",
  WIKILINK_HEADING_MISSING: "WIKILINK_HEADING_MISSING",
  WIKILINK_AMBIGUOUS: "WIKILINK_AMBIGUOUS",
  ADR_ID_DUPLICATE: "ADR_ID_DUPLICATE",
  ADR_REGISTER_MISSING: "ADR_REGISTER_MISSING",
  ADR_FILE_MISSING: "ADR_FILE_MISSING",
  ADR_TYPE_INVALID: "ADR_TYPE_INVALID",
  FEATURE_SPECS_ABSENT: "FEATURE_SPECS_ABSENT",
  TEST_PLAN_SPEC_MISSING: "TEST_PLAN_SPEC_MISSING",
  TEST_PLAN_SPEC_UNRESOLVED: "TEST_PLAN_SPEC_UNRESOLVED",
  TEST_PLAN_AC_UNKNOWN: "TEST_PLAN_AC_UNKNOWN",
  FEATURE_SPEC_TEST_PLAN_MISSING: "FEATURE_SPEC_TEST_PLAN_MISSING",
  SUPERSEDED_WITHOUT_REPLACEMENT: "SUPERSEDED_WITHOUT_REPLACEMENT",
  SUPERSEDED_TARGET_MISSING: "SUPERSEDED_TARGET_MISSING",
  UNUSED_EXCEPTION: "UNUSED_EXCEPTION",
});

const ALL_CHECKS = ["links", "wikilinks", "frontmatter", "adr", "specs", "superseded"];
const CHECK_ALIASES = {
  all: ALL_CHECKS,
  tracking: ["specs"],
};
const KNOWLEDGE_STATUSES = new Set([
  "draft",
  "under-review",
  "approved",
  "superseded",
  "archived",
]);
const FEATURE_SPEC_TYPES = new Set(["feature-spec", "feature-specification"]);
const TEST_PLAN_TYPES = new Set(["test-plan"]);
const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".avif",
  ".pdf",
]);

/**
 * Explicit, reviewable exceptions for historical gaps in this repository.
 * Each entry must name the rule code, the affected repository path (or the
 * unresolved target), and a reason. Remove an entry once the underlying gap is
 * fixed; the script warns about entries that no longer suppress anything.
 */
export const KNOWN_EXCEPTIONS = Object.freeze([
  Object.freeze({
    code: RULE_CODES.FEATURE_SPECS_ABSENT,
    target: "knowledge/specifications/features",
    reason:
      "正式 Feature Spec 与 AC 编号尚未建立；E1.1 交接已登记该缺口，当前规格入口仍为来源索引。",
    owner: "engineering",
    registered: "2026-11-09",
  }),
  Object.freeze({
    code: RULE_CODES.TEST_PLAN_SPEC_MISSING,
    target: "knowledge/specifications/test-plans/E1.1-p1-test-traceability.md",
    reason:
      "E1.1 交接已登记正式 Feature Spec AC 待建立，矩阵暂以已批准规则 ID/ADR 条款作为来源锚点；Feature Spec 建立后回填并删除本例外。",
    owner: "engineering",
    registered: "2026-11-09",
  }),
  Object.freeze({
    code: RULE_CODES.SUPERSEDED_WITHOUT_REPLACEMENT,
    target: "knowledge/02-Business/E0-business-rule-review.md",
    reason:
      "历史文档建立时未设置 superseded_by 字段；正文和 related 已指向 E0-confirmed-inventory-decisions、E0-confirmed-operating-rules 等已批准替代文档。",
    owner: "product",
    registered: "2026-11-09",
  }),
]);

// ---------------------------------------------------------------------------
// small helpers

function toPosix(value) {
  return value.split(sep).join("/");
}

function repoRel(root, absPath) {
  const rel = relative(root, absPath);
  return toPosix(rel === "" ? "." : rel);
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function lineNumberAt(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}

function isDirectory(absPath) {
  try {
    return statSync(absPath).isDirectory();
  } catch {
    return false;
  }
}

function walkMarkdown(dir, results = []) {
  if (!isDirectory(dir)) return results;
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".next") {
      continue;
    }
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkMarkdown(abs, results);
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") {
      results.push(abs);
    }
  }
  return results;
}

function stripInlineCode(text) {
  // Inline code spans (e.g. documentation examples of [[wikilinks]]) are not
  // real links; blank them out while keeping offsets and line numbers stable.
  return text.replace(/`[^`\n]*`/g, (match) => " ".repeat(match.length));
}

/**
 * Replace fenced code blocks with empty lines. Keeps line numbers stable and
 * prevents example links inside code blocks from being treated as real links.
 */
function stripCodeFences(markdown) {
  const lines = markdown.split(/\r?\n/);
  let fence = null;
  const out = lines.map((line) => {
    const match = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (match && match[1][0] === fence[0] && match[1].length >= fence.length) {
        fence = null;
      }
      return "";
    }
    if (match) {
      fence = match[1];
      return "";
    }
    return line;
  });
  return out.join("\n");
}

function splitFrontmatter(source) {
  const text = stripBom(source);
  const match = text.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!match) return null;
  return {
    raw: match[1],
    body: text.slice(match[0].length),
    offset: match[0].length,
  };
}

function stripInlineComment(text) {
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "#" && i > 0 && /\s/.test(text[i - 1])) {
      return text.slice(0, i).trim();
    }
  }
  return text;
}

function splitInlineList(text) {
  const items = [];
  let current = "";
  let quote = null;
  for (const char of text) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === ",") {
      if (current.trim()) items.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) items.push(current.trim());
  return items.map((item) => parseScalar(item));
}

function parseScalar(raw) {
  const text = raw.trim();
  if (text === "") return "";
  if (text === "null" || text === "~") return null;
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?\d+$/.test(text)) return Number.parseInt(text, 10);
  if (/^"(?:[^"\\]|\\.)*"$/.test(text)) {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`invalid double-quoted YAML scalar: ${text}`);
    }
  }
  if (/^'(?:[^']|'')*'$/.test(text)) {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (text.startsWith('"') || text.startsWith("'")) {
    throw new Error(`unterminated quoted YAML scalar: ${text}`);
  }
  return stripInlineComment(text);
}

/**
 * Strict line-oriented YAML subset parser for frontmatter. Supports:
 *  - top-level `key: scalar`
 *  - top-level `key:` followed by a `- item` block list
 *  - top-level `key:` followed by one level of `  nested_key: scalar`
 *  - inline `[]` and simple `[a, b]` lists
 * Throws on malformed content so a broken document fails the gate.
 */
export function parseFrontmatter(raw) {
  const lines = raw.split(/\r?\n/);
  const result = {};
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim() || /^\s*#/.test(line)) {
      index += 1;
      continue;
    }
    if (/^\s/.test(line)) {
      throw new Error(`unexpected indentation at frontmatter line ${index + 1}`);
    }
    const match = line.match(/^([A-Za-z0-9_-]+):[ \t]*(.*)$/);
    if (!match) {
      throw new Error(`invalid YAML line ${index + 1}: ${line.trim()}`);
    }
    const key = match[1];
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      throw new Error(`duplicate YAML key "${key}" at frontmatter line ${index + 1}`);
    }
    const rest = match[2].trim();
    index += 1;
    if (rest === "") {
      const items = [];
      const nested = [];
      while (index < lines.length) {
        const next = lines[index];
        if (!next.trim() || /^\s*#/.test(next)) {
          index += 1;
          continue;
        }
        if (!/^\s+/.test(next)) break;
        const itemMatch = next.match(/^\s+-[ \t]*(.*)$/);
        if (itemMatch) {
          items.push(parseScalar(itemMatch[1].trim()));
          index += 1;
          continue;
        }
        const nestedMatch = next.match(/^\s+([A-Za-z0-9_-]+):[ \t]*(.*)$/);
        if (nestedMatch) {
          nested.push([nestedMatch[1], parseScalar(nestedMatch[2].trim())]);
          index += 1;
          continue;
        }
        throw new Error(`invalid YAML line ${index + 1}: ${next.trim()}`);
      }
      if (items.length > 0) result[key] = items;
      else if (nested.length > 0) result[key] = Object.fromEntries(nested);
      else result[key] = null;
      continue;
    }
    if (rest === "[]") {
      result[key] = [];
      continue;
    }
    if (rest.startsWith("[") && rest.endsWith("]")) {
      result[key] = splitInlineList(rest.slice(1, -1));
      continue;
    }
    result[key] = parseScalar(rest);
  }
  return result;
}

function extractAtxHeadings(markdown) {
  const stripped = stripCodeFences(markdown);
  const headings = [];
  for (const line of stripped.split(/\r?\n/)) {
    const match = line.match(/^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/);
    if (match) headings.push(match[2].trim());
  }
  return headings;
}

function extractMarkdownLinks(text) {
  const links = [];
  const pattern = /!?\[[^\]\n]*\]\(([^)\n]+)\)/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    links.push({ raw: match[1].trim(), offset: match.index });
  }
  return links;
}

function parseLinkTarget(raw) {
  let target = raw.trim();
  let title = "";
  if (target.startsWith("<")) {
    const close = target.indexOf(">");
    if (close !== -1) {
      title = target.slice(close + 1).trim();
      target = target.slice(1, close);
    }
  } else {
    const titleMatch = target.match(/^(\S+)(\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))$/);
    if (titleMatch) {
      target = titleMatch[1];
      title = titleMatch[2];
    }
  }
  const hashIndex = target.indexOf("#");
  const fragment = hashIndex >= 0 ? target.slice(hashIndex + 1) : "";
  const pathPart = hashIndex >= 0 ? target.slice(0, hashIndex) : target;
  return { target: pathPart, fragment, title };
}

function extractWikilinks(text) {
  const links = [];
  const pattern = /(!?)\[\[([^\]\n]+)\]\]/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    links.push({ embed: match[1] === "!", body: match[2], offset: match.index });
  }
  return links;
}

function parseWikilinkBody(body) {
  // Obsidian tables escape the alias separator as "\|"; normalize it before
  // splitting so [[note\|alias]] resolves exactly like [[note|alias]].
  const raw = body.trim().replace(/\\\|/g, "|");
  const pipeIndex = raw.indexOf("|");
  const targetPart = pipeIndex >= 0 ? raw.slice(0, pipeIndex) : raw;
  const alias = pipeIndex >= 0 ? raw.slice(pipeIndex + 1).trim() : "";
  let target = targetPart.trim();
  let heading = null;
  const hashIndex = target.indexOf("#");
  if (hashIndex >= 0) {
    heading = target.slice(hashIndex + 1).trim() || null;
    target = target.slice(0, hashIndex).trim();
  }
  return { target, heading, alias };
}

function isExternalTarget(target) {
  return (
    target === "" ||
    target.startsWith("#") ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target)
  );
}

function safeDecode(target) {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

// ---------------------------------------------------------------------------
// document index

function loadDocuments(root) {
  const knowledgeDir = join(root, "knowledge");
  const docsDir = join(root, "docs");
  const knowledgePaths = walkMarkdown(knowledgeDir);
  const docPaths = walkMarkdown(docsDir);
  const docs = [];
  for (const abs of [...knowledgePaths, ...docPaths]) {
    let source;
    try {
      source = readFileSync(abs, "utf8");
    } catch (error) {
      throw new Error(`cannot read ${repoRel(root, abs)}: ${error.message}`);
    }
    const stripped = stripCodeFences(source);
    const linkText = stripInlineCode(stripped);
    const fm = splitFrontmatter(source);
    let frontmatter = null;
    let frontmatterError = null;
    if (fm) {
      try {
        frontmatter = parseFrontmatter(fm.raw);
      } catch (error) {
        frontmatterError = error.message;
      }
    }
    docs.push({
      abs,
      rel: repoRel(root, abs),
      source,
      stripped,
      linkText,
      frontmatter,
      frontmatterError,
      isKnowledge: abs === knowledgeDir || abs.startsWith(knowledgeDir + sep),
    });
  }
  return { docs, knowledgeDir, docsDir, knowledgePaths, docPaths };
}

function buildKnowledgeIndex(docs, root) {
  const knowledgeDir = join(root, "knowledge");
  const byName = new Map();
  const byRel = new Map();
  for (const doc of docs) {
    if (!doc.isKnowledge) continue;
    const name = basename(doc.abs, extname(doc.abs)).toLowerCase();
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(doc);
    const rel = toPosix(relative(knowledgeDir, doc.abs)).replace(/\.md$/i, "").toLowerCase();
    byRel.set(rel, doc);
  }
  return { byName, byRel, knowledgeDir };
}

function resolveWikilinkTarget(wikilink, doc, index, root) {
  const note = wikilink.target;
  if (note === "") return { doc, display: doc.rel };
  const normalized = note.replace(/\.md$/i, "").toLowerCase();
  if (normalized.includes("/") || normalized.startsWith("knowledge/")) {
    const key = normalized.startsWith("knowledge/")
      ? normalized.slice("knowledge/".length)
      : normalized;
    const direct = index.byRel.get(key);
    if (direct) return { doc: direct, display: direct.rel };
    const candidate = resolve(index.knowledgeDir, key + ".md");
    if (existsSync(candidate)) {
      return { doc: null, display: repoRel(root, candidate) };
    }
    return { doc: null, display: null };
  }
  const matches = index.byName.get(normalized) ?? [];
  if (matches.length === 1) return { doc: matches[0], display: matches[0].rel };
  if (matches.length > 1) return { doc: null, display: null, ambiguous: matches.map((m) => m.rel) };
  return { doc: null, display: null };
}

function resolveExistingPath(root, fromDir, rawTarget) {
  const cleaned = safeDecode(rawTarget.trim());
  if (!cleaned) return null;
  const candidates = [];
  if (isAbsolute(cleaned)) {
    candidates.push(cleaned);
  } else {
    candidates.push(resolve(fromDir, cleaned));
    candidates.push(resolve(root, cleaned));
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------
// checks

function checkFrontmatter(doc, errors, warnings, counts) {
  if (!doc.isKnowledge) {
    if (doc.frontmatterError) {
      errors.push({
        code: RULE_CODES.FM_PARSE_ERROR,
        file: doc.rel,
        message: `frontmatter does not parse: ${doc.frontmatterError}`,
      });
    }
    return;
  }
  if (!doc.source.match(/^---[ \t]*\r?\n/)) {
    errors.push({
      code: RULE_CODES.FM_MISSING,
      file: doc.rel,
      message: "knowledge note has no YAML frontmatter block",
    });
    return;
  }
  if (doc.frontmatterError) {
    errors.push({
      code: RULE_CODES.FM_PARSE_ERROR,
      file: doc.rel,
      message: `frontmatter does not parse: ${doc.frontmatterError}`,
    });
    return;
  }
  const data = doc.frontmatter ?? {};
  counts.frontmatterDocs += 1;
  for (const key of ["title", "type", "status"]) {
    const value = data[key];
    if (value === undefined || value === null || String(value).trim() === "") {
      errors.push({
        code: RULE_CODES.FM_REQUIRED_KEY,
        file: doc.rel,
        message: `frontmatter is missing required key "${key}"`,
      });
    }
  }
  if (data.status !== undefined) {
    const status = String(data.status).trim();
    if (!KNOWLEDGE_STATUSES.has(status)) {
      errors.push({
        code: RULE_CODES.FM_INVALID_STATUS,
        file: doc.rel,
        message: `frontmatter status "${status}" is not one of ${[...KNOWLEDGE_STATUSES].join(", ")}`,
      });
    }
  }
  if (data.version !== undefined && !Number.isInteger(data.version)) {
    errors.push({
      code: RULE_CODES.FM_INVALID_FIELD,
      file: doc.rel,
      message: "frontmatter version must be an integer",
    });
  }
  if (data.updated !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(data.updated))) {
    errors.push({
      code: RULE_CODES.FM_INVALID_FIELD,
      file: doc.rel,
      message: "frontmatter updated must use YYYY-MM-DD",
    });
  }
  if (data.owner !== undefined && String(data.owner).trim() === "") {
    errors.push({
      code: RULE_CODES.FM_INVALID_FIELD,
      file: doc.rel,
      message: "frontmatter owner must not be empty",
    });
  }
  const status = data.status === undefined ? "" : String(data.status).trim();
  if (status === "approved") {
    const missing = ["owner", "version", "updated"].filter((key) => {
      const value = data[key];
      return value === undefined || value === null || String(value).trim() === "";
    });
    if (missing.length > 0) {
      errors.push({
        code: RULE_CODES.APPROVED_METADATA_MISSING,
        file: doc.rel,
        message: `approved document is missing required metadata: ${missing.join(", ")}`,
      });
    }
  }
}

function checkRelativeLinks(doc, root, errors, counts) {
  const links = extractMarkdownLinks(doc.linkText);
  for (const link of links) {
    const parsed = parseLinkTarget(link.raw);
    if (isExternalTarget(parsed.target)) continue;
    counts.links += 1;
    const resolved = resolveExistingPath(root, dirname(doc.abs), parsed.target);
    if (!resolved) {
      errors.push({
        code: RULE_CODES.LINK_MISSING,
        file: doc.rel,
        target: parsed.target,
        line: lineNumberAt(doc.stripped, link.offset),
        message: `relative link target does not exist: ${parsed.target}`,
      });
    }
  }
}

function checkWikilinks(doc, index, root, errors, warnings, counts) {
  for (const wikilink of extractWikilinks(doc.linkText)) {
    const parsed = parseWikilinkBody(wikilink.body);
    counts.wikilinks += 1;
    const line = lineNumberAt(doc.stripped, wikilink.offset);
    const lowerTarget = parsed.target.toLowerCase();
    const targetExt = extname(lowerTarget);
    if (targetExt && IMAGE_EXTENSIONS.has(targetExt)) {
      const resolved =
        resolveExistingPath(root, dirname(doc.abs), parsed.target) ??
        resolveExistingPath(root, index.knowledgeDir, parsed.target);
      if (!resolved) {
        errors.push({
          code: RULE_CODES.WIKILINK_UNRESOLVED,
          file: doc.rel,
          target: parsed.target,
          line,
          message: `embedded file does not exist: ${parsed.target}`,
        });
      }
      continue;
    }
    const resolved = resolveWikilinkTarget(parsed, doc, index, root);
    if (resolved.ambiguous) {
      warnings.push({
        code: RULE_CODES.WIKILINK_AMBIGUOUS,
        file: doc.rel,
        target: parsed.target,
        line,
        message: `wikilink target is ambiguous: ${parsed.target} matches ${resolved.ambiguous.join(", ")}`,
      });
      continue;
    }
    let targetDoc = resolved.doc;
    if (!targetDoc && resolved.display) {
      const candidate = resolve(root, resolved.display);
      targetDoc = index?.docsByAbs?.get(candidate) ?? null;
    }
    if (!targetDoc && resolved.display && existsSync(resolve(root, resolved.display))) {
      if (parsed.heading) {
        const body = readFileSync(resolve(root, resolved.display), "utf8");
        if (!headingExists(body, parsed.heading)) {
          errors.push({
            code: RULE_CODES.WIKILINK_HEADING_MISSING,
            file: doc.rel,
            target: `${parsed.target}#${parsed.heading}`,
            line,
            message: `wikilink heading does not exist: ${parsed.heading}`,
          });
        }
      }
      continue;
    }
    if (!targetDoc) {
      errors.push({
        code: RULE_CODES.WIKILINK_UNRESOLVED,
        file: doc.rel,
        target: parsed.target || wikilink.body,
        line,
        message: `wikilink does not resolve to a note under knowledge/: ${wikilink.body}`,
      });
      continue;
    }
    if (parsed.heading) {
      if (!headingExists(targetDoc.source, parsed.heading)) {
        errors.push({
          code: RULE_CODES.WIKILINK_HEADING_MISSING,
          file: doc.rel,
          target: `${parsed.target}#${parsed.heading}`,
          line,
          message: `wikilink heading does not exist in ${targetDoc.rel}: ${parsed.heading}`,
        });
      }
    }
  }
}

function headingExists(markdown, heading) {
  const needle = heading.trim();
  if (needle.startsWith("^")) {
    const blockId = needle.slice(1);
    return new RegExp(`\\^${escapeRegExp(blockId)}(?:\\s|$)`).test(markdown);
  }
  const plain = needle.replace(/^#+\s*/, "").trim();
  return extractAtxHeadings(markdown).some(
    (candidate) => candidate.trim() === plain || candidate.trim() === needle,
  );
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function checkAdr(docs, root, errors, warnings, counts) {
  const adrDir = join(root, "knowledge/05-ADR");
  const adrDocs = docs.filter(
    (doc) =>
      doc.isKnowledge &&
      resolve(doc.abs).startsWith(resolve(adrDir) + sep) &&
      /^ADR-\d{3,}-/i.test(basename(doc.abs)),
  );
  counts.adrDocs = adrDocs.length;
  const idToDocs = new Map();
  for (const doc of adrDocs) {
    const match = basename(doc.abs).match(/^(ADR-\d{3,})-/i);
    const id = match[1].toUpperCase();
    if (!idToDocs.has(id)) idToDocs.set(id, []);
    idToDocs.get(id).push(doc);
    const type = doc.frontmatter?.type;
    if (type !== undefined && String(type).trim() !== "adr") {
      warnings.push({
        code: RULE_CODES.ADR_TYPE_INVALID,
        file: doc.rel,
        message: `ADR document frontmatter type should be "adr", found "${type}"`,
      });
    }
  }
  for (const [id, entries] of idToDocs) {
    if (entries.length > 1) {
      for (const doc of entries) {
        errors.push({
          code: RULE_CODES.ADR_ID_DUPLICATE,
          file: doc.rel,
          target: id,
          message: `ADR ID ${id} is used by more than one file: ${entries
            .map((entry) => entry.rel)
            .join(", ")}`,
        });
      }
    }
  }
  const registerDocs = docs.filter(
    (doc) =>
      doc.isKnowledge &&
      resolve(doc.abs).startsWith(resolve(adrDir) + sep) &&
      /adr-register/i.test(basename(doc.abs)),
  );
  if (registerDocs.length === 0) {
    errors.push({
      code: RULE_CODES.ADR_REGISTER_MISSING,
      file: "knowledge/05-ADR",
      target: "ADR register",
      message: "ADR register document not found under knowledge/05-ADR",
    });
    return;
  }
  const registerRows = [];
  for (const register of registerDocs) {
    const lines = register.stripped.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (!line.startsWith("|")) continue;
      const ids = [...line.matchAll(/\bADR-(\d{3,})\b/gi)].map((match) =>
        `ADR-${match[1]}`.toUpperCase(),
      );
      if (ids.length === 0) continue;
      const uniqueIds = [...new Set(ids)];
      registerRows.push({ id: uniqueIds[0], file: register.rel, line: index + 1, ids: uniqueIds });
    }
  }
  const registerIds = new Map();
  for (const row of registerRows) {
    registerIds.set(row.id, (registerIds.get(row.id) ?? 0) + 1);
  }
  for (const [id, count] of registerIds) {
    if (count > 1) {
      errors.push({
        code: RULE_CODES.ADR_ID_DUPLICATE,
        file: registerDocs.map((doc) => doc.rel).join(", "),
        target: id,
        message: `ADR register lists ${id} in ${count} table rows`,
      });
    }
  }
  for (const [id, entries] of idToDocs) {
    if (!registerIds.has(id)) {
      for (const doc of entries) {
        errors.push({
          code: RULE_CODES.ADR_REGISTER_MISSING,
          file: doc.rel,
          target: id,
          message: `ADR ${id} is not listed in the ADR register`,
        });
      }
    }
  }
  for (const [id] of registerIds) {
    if (!idToDocs.has(id)) {
      errors.push({
        code: RULE_CODES.ADR_FILE_MISSING,
        file: registerDocs.map((doc) => doc.rel).join(", "),
        target: id,
        message: `ADR register lists ${id} but no matching ADR file exists`,
      });
    }
  }
}

function getResolvedLinksForDoc(doc, index, root) {
  const referenced = [];
  for (const link of extractMarkdownLinks(doc.linkText)) {
    const parsed = parseLinkTarget(link.raw);
    if (isExternalTarget(parsed.target)) continue;
    const resolved = resolveExistingPath(root, dirname(doc.abs), parsed.target);
    if (resolved) referenced.push({ abs: resolved, target: parsed.target });
  }
  for (const wikilink of extractWikilinks(doc.linkText)) {
    const parsed = parseWikilinkBody(wikilink.body);
    const resolved = resolveWikilinkTarget(parsed, doc, index, root);
    if (resolved.doc) referenced.push({ abs: resolved.doc.abs, target: parsed.target });
  }
  return referenced;
}

function checkSpecTraceability(docs, index, root, errors, warnings, counts) {
  const specDir = join(root, "knowledge/specifications/features");
  const featureSpecs = docs.filter(
    (doc) => doc.isKnowledge && FEATURE_SPEC_TYPES.has(String(doc.frontmatter?.type ?? "").trim()),
  );
  const testPlans = docs.filter(
    (doc) => doc.isKnowledge && TEST_PLAN_TYPES.has(String(doc.frontmatter?.type ?? "").trim()),
  );
  counts.featureSpecs = featureSpecs.length;
  counts.testPlans = testPlans.length;

  if (featureSpecs.length === 0) {
    errors.push({
      code: RULE_CODES.FEATURE_SPECS_ABSENT,
      file: "knowledge/specifications/features",
      target: "knowledge/specifications/features",
      message: `no Feature Spec documents (frontmatter type feature-spec) found under knowledge/specifications/features (${testPlans.length} test plan(s) present)`,
    });
  }

  const featureSpecPaths = new Set(featureSpecs.map((doc) => resolve(doc.abs)));
  const testPlanPaths = new Set(testPlans.map((doc) => resolve(doc.abs)));
  const allFeatureSpecText = featureSpecs.map((doc) => doc.stripped).join("\n");

  for (const plan of testPlans) {
    const referenced = getResolvedLinksForDoc(plan, index, root);
    const specRefs = referenced.filter((ref) => featureSpecPaths.has(resolve(ref.abs)));
    const rawSpecPaths = [];
    const pathPattern = /`([^`]*features[\/\\][^`]*\.md)`/gi;
    let pathMatch;
    while ((pathMatch = pathPattern.exec(plan.stripped)) !== null) {
      rawSpecPaths.push(pathMatch[1]);
    }
    for (const rawPath of rawSpecPaths) {
      const resolved =
        resolveExistingPath(root, dirname(plan.abs), rawPath) ??
        resolveExistingPath(root, root, rawPath);
      if (!resolved || !featureSpecPaths.has(resolve(resolved))) {
        errors.push({
          code: RULE_CODES.TEST_PLAN_SPEC_UNRESOLVED,
          file: plan.rel,
          target: rawPath,
          message: `test plan references a Feature Spec path that does not resolve: ${rawPath}`,
        });
      }
    }
    if (specRefs.length === 0 && rawSpecPaths.length === 0) {
      errors.push({
        code: RULE_CODES.TEST_PLAN_SPEC_MISSING,
        file: plan.rel,
        target: plan.rel,
        message: "test plan does not reference any Feature Spec document",
      });
      continue;
    }
    const referencedSpecText = specRefs
      .map((ref) => docs.find((doc) => resolve(doc.abs) === resolve(ref.abs))?.stripped ?? "")
      .join("\n");
    const idPattern = /\b(?:WMS-)?(?:FS|AC)-\d{2,}(?:-\d+)?\b/gi;
    const citedIds = new Set();
    // Ignore IDs embedded in code spans or link targets (e.g. a spec file path
    // such as `.../FS-404.md`) so only real acceptance-criterion citations count.
    const idSource = plan.stripped
      .replace(/`[^`]*`/g, "")
      .replace(/\]\([^)]*\)/g, "]");
    let idMatch;
    while ((idMatch = idPattern.exec(idSource)) !== null) {
      citedIds.add(idMatch[0].toUpperCase());
    }
    for (const cited of citedIds) {
      const haystack = `${referencedSpecText}\n${allFeatureSpecText}`.toUpperCase();
      if (!haystack.includes(cited)) {
        errors.push({
          code: RULE_CODES.TEST_PLAN_AC_UNKNOWN,
          file: plan.rel,
          target: cited,
          message: `test plan cites ${cited} but no Feature Spec defines it`,
        });
      }
    }
  }

  for (const spec of featureSpecs) {
    const referenced = getResolvedLinksForDoc(spec, index, root);
    const planRefs = referenced.filter((ref) => testPlanPaths.has(resolve(ref.abs)));
    if (planRefs.length === 0) {
      errors.push({
        code: RULE_CODES.FEATURE_SPEC_TEST_PLAN_MISSING,
        file: spec.rel,
        target: spec.rel,
        message: "Feature Spec does not reference any test plan document",
      });
    }
  }
}

function checkSuperseded(docs, index, root, errors, warnings) {
  for (const doc of docs) {
    if (!doc.isKnowledge || doc.frontmatterError) continue;
    const status = String(doc.frontmatter?.status ?? "").trim();
    if (status !== "superseded") continue;
    const raw = doc.frontmatter?.superseded_by ?? doc.frontmatter?.replaced_by;
    const values = raw === undefined || raw === null ? [] : Array.isArray(raw) ? raw : [raw];
    const usable = values
      .map((value) => String(value ?? "").trim())
      .filter((value) => value !== "");
    if (usable.length === 0) {
      errors.push({
        code: RULE_CODES.SUPERSEDED_WITHOUT_REPLACEMENT,
        file: doc.rel,
        message: "superseded document has no superseded_by/replaced_by replacement pointer",
      });
      continue;
    }
    for (const value of usable) {
      const wikilinks = extractWikilinks(value);
      if (wikilinks.length > 0) {
        for (const wikilink of wikilinks) {
          const parsed = parseWikilinkBody(wikilink.body);
          const resolved = resolveWikilinkTarget(parsed, doc, index, root);
          if (!resolved.doc && !resolved.display) {
            errors.push({
              code: RULE_CODES.SUPERSEDED_TARGET_MISSING,
              file: doc.rel,
              target: parsed.target,
              message: `superseded replacement does not resolve: ${wikilink.body}`,
            });
          }
        }
        continue;
      }
      const resolved = resolveExistingPath(root, dirname(doc.abs), value);
      if (!resolved) {
        errors.push({
          code: RULE_CODES.SUPERSEDED_TARGET_MISSING,
          file: doc.rel,
          target: value,
          message: `superseded replacement path does not exist: ${value}`,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// exceptions and orchestration

export function normalizeChecks(input) {
  if (input === undefined || input === null || input === "") return [...ALL_CHECKS];
  const parts = Array.isArray(input) ? input : String(input).split(",");
  const selected = [];
  for (const raw of parts) {
    const name = String(raw).trim().toLowerCase();
    if (!name) continue;
    const expanded = CHECK_ALIASES[name] ?? [name];
    for (const item of expanded) {
      if (!ALL_CHECKS.includes(item)) {
        throw new Error(
          `unknown check "${item}" (valid: all, tracking, ${ALL_CHECKS.join(", ")})`,
        );
      }
      if (!selected.includes(item)) selected.push(item);
    }
  }
  return selected.length > 0 ? selected : [...ALL_CHECKS];
}

export function loadExceptions(filePath) {
  if (!filePath) return [];
  const raw = JSON.parse(readFileSync(filePath, "utf8"));
  const entries = Array.isArray(raw) ? raw : raw?.exceptions;
  if (!Array.isArray(entries)) {
    throw new Error(`${filePath}: expected an array or an object with an "exceptions" array`);
  }
  return entries.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`${filePath}: exception #${index + 1} must be an object`);
    }
    const code = String(entry.code ?? "").trim();
    const target = String(entry.target ?? "").trim();
    const reason = String(entry.reason ?? "").trim();
    if (!Object.values(RULE_CODES).includes(code)) {
      throw new Error(`${filePath}: exception #${index + 1} has unknown code "${code}"`);
    }
    if (!target) {
      throw new Error(`${filePath}: exception #${index + 1} needs a target path or "*"`);
    }
    if (!reason) {
      throw new Error(`${filePath}: exception #${index + 1} needs a reason`);
    }
    return {
      code,
      target,
      reason,
      owner: entry.owner ? String(entry.owner) : "engineering",
      registered: entry.registered ? String(entry.registered) : "",
    };
  });
}

function exceptionMatches(exception, issue) {
  if (exception.code !== issue.code) return false;
  if (exception.target === "*") return true;
  const candidates = [issue.file, issue.target, issue.file && issue.target ? `${issue.file}#${issue.target}` : ""]
    .filter(Boolean)
    .map((value) => String(value));
  return candidates.includes(exception.target);
}

export function runCheck(options = {}) {
  const root = resolve(options.root ?? DEFAULT_ROOT);
  if (!isDirectory(root)) throw new Error(`root is not a directory: ${root}`);
  const checks = normalizeChecks(options.checks);
  const exceptions = options.exceptions ?? [];
  const counts = {
    markdownFiles: 0,
    knowledgeFiles: 0,
    docsFiles: 0,
    frontmatterDocs: 0,
    links: 0,
    wikilinks: 0,
    adrDocs: 0,
    featureSpecs: 0,
    testPlans: 0,
    approvedDocs: 0,
  };
  const errors = [];
  const warnings = [];
  const { docs, knowledgePaths, docPaths } = loadDocuments(root);
  counts.markdownFiles = docs.length;
  counts.knowledgeFiles = knowledgePaths.length;
  counts.docsFiles = docPaths.length;
  counts.approvedDocs = docs.filter(
    (doc) => String(doc.frontmatter?.status ?? "").trim() === "approved",
  ).length;

  const index = buildKnowledgeIndex(docs, root);
  index.docsByAbs = new Map(docs.map((doc) => [resolve(doc.abs), doc]));

  if (checks.includes("frontmatter")) {
    for (const doc of docs) checkFrontmatter(doc, errors, warnings, counts);
  }
  if (checks.includes("links")) {
    for (const doc of docs) checkRelativeLinks(doc, root, errors, counts);
  }
  if (checks.includes("wikilinks")) {
    for (const doc of docs) checkWikilinks(doc, index, root, errors, warnings, counts);
  }
  if (checks.includes("adr")) {
    checkAdr(docs, root, errors, warnings, counts);
  }
  if (checks.includes("specs")) {
    checkSpecTraceability(docs, index, root, errors, warnings, counts);
  }
  if (checks.includes("superseded")) {
    checkSuperseded(docs, index, root, errors, warnings);
  }

  const unused = [];
  const applied = [];
  const remainingErrors = [];
  for (const issue of errors) {
    const exception = exceptions.find((entry) => {
      if (entry.__used) return false;
      return exceptionMatches(entry, issue);
    });
    if (exception) {
      exception.__used = true;
      applied.push({
        code: issue.code,
        target: issue.target ?? issue.file,
        file: issue.file,
        reason: exception.reason,
        owner: exception.owner,
        registered: exception.registered,
      });
      warnings.push({
        code: "EXCEPTION_APPLIED",
        suppressedCode: issue.code,
        file: issue.file,
        target: issue.target,
        message: `historical gap tolerated: ${issue.message} (reason: ${exception.reason})`,
      });
    } else {
      remainingErrors.push(issue);
    }
  }
  for (const exception of exceptions) {
    if (!exception.__used) {
      unused.push({
        code: exception.code,
        target: exception.target,
        reason: exception.reason,
      });
      warnings.push({
        code: RULE_CODES.UNUSED_EXCEPTION,
        file: exception.target,
        target: exception.code,
        message: `exception no longer suppresses any failure: code=${exception.code} target=${exception.target}`,
      });
    }
  }

  const sortIssues = (list) =>
    [...list].sort((a, b) => {
      const left = `${a.file ?? ""}\u0000${a.code}\u0000${a.target ?? ""}`;
      const right = `${b.file ?? ""}\u0000${b.code}\u0000${b.target ?? ""}`;
      return left.localeCompare(right);
    });
  const sortPlain = (list) =>
    [...list].sort((a, b) =>
      `${a.code}\u0000${a.target ?? ""}`.localeCompare(`${b.code}\u0000${b.target ?? ""}`),
    );

  return {
    tool: TOOL_NAME,
    version: SCRIPT_VERSION,
    root: repoRel(process.cwd(), root) || ".",
    checks,
    status: remainingErrors.length > 0 ? "failed" : "passed",
    counts,
    errors: sortIssues(remainingErrors).map((issue) => ({
      code: issue.code,
      file: issue.file,
      ...(issue.target ? { target: issue.target } : {}),
      ...(issue.line ? { line: issue.line } : {}),
      message: issue.message,
    })),
    warnings: sortIssues(warnings).map((issue) => ({
      code: issue.code,
      ...(issue.file ? { file: issue.file } : {}),
      ...(issue.target ? { target: issue.target } : {}),
      ...(issue.line ? { line: issue.line } : {}),
      message: issue.message,
    })),
    exceptions: sortPlain(applied),
    unusedExceptions: sortPlain(unused),
  };
}

// ---------------------------------------------------------------------------
// rendering

function renderHuman(summary) {
  for (const issue of summary.errors) {
    const location = [issue.file, issue.line ? `:${issue.line}` : ""].join("");
    console.log(`FAIL [${issue.code}] ${location}: ${issue.message}`);
  }
  for (const warning of summary.warnings) {
    const location = [warning.file, warning.line ? `:${warning.line}` : ""].join("");
    console.log(`WARN [${warning.code}] ${location}: ${warning.message}`);
  }
  console.log(
    `knowledge-structure: ${summary.status.toUpperCase()} files=${summary.counts.markdownFiles} links=${summary.counts.links} wikilinks=${summary.counts.wikilinks} errors=${summary.errors.length} warnings=${summary.warnings.length} exceptions=${summary.exceptions.length}`,
  );
}

function renderSummaryMarkdown(summary) {
  const lines = [];
  lines.push(`## Knowledge structure gate — ${summary.status.toUpperCase()}`);
  lines.push("");
  lines.push("| metric | value |");
  lines.push("|---|---|");
  lines.push(`| checks | ${summary.checks.join(", ")} |`);
  lines.push(`| Markdown files | ${summary.counts.markdownFiles} (knowledge ${summary.counts.knowledgeFiles}, docs ${summary.counts.docsFiles}) |`);
  lines.push(`| links checked | ${summary.counts.links} |`);
  lines.push(`| wikilinks checked | ${summary.counts.wikilinks} |`);
  lines.push(`| ADR documents | ${summary.counts.adrDocs} |`);
  lines.push(`| Feature Specs / test plans | ${summary.counts.featureSpecs} / ${summary.counts.testPlans} |`);
  lines.push(`| errors / warnings / tolerated exceptions | ${summary.errors.length} / ${summary.warnings.length} / ${summary.exceptions.length} |`);
  lines.push("");
  if (summary.errors.length > 0) {
    lines.push(`### Failures (${summary.errors.length})`);
    for (const issue of summary.errors) {
      lines.push(`- \`${issue.code}\` ${issue.file}: ${issue.message}`);
    }
    lines.push("");
  }
  if (summary.warnings.length > 0) {
    lines.push(`### Warnings (${summary.warnings.length})`);
    for (const warning of summary.warnings) {
      lines.push(`- \`${warning.code}\` ${warning.file ?? ""}: ${warning.message}`);
    }
    lines.push("");
  }
  if (summary.exceptions.length > 0) {
    lines.push(`### Tolerated historical exceptions (${summary.exceptions.length})`);
    for (const exception of summary.exceptions) {
      lines.push(`- \`${exception.code}\` ${exception.file ?? exception.target}: ${exception.reason}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

const USAGE = `Usage: node scripts/check-knowledge-structure.mjs [options]

Options:
  --root <dir>            repository root to scan (default: repository root)
  --checks <list>         subset of: ${ALL_CHECKS.join(",")} (aliases: all, tracking)
  --exceptions <file>     JSON exception list (default: built-in repository list)
  --json                  print only the machine-readable JSON summary
  --summary-file <file>   also write the Markdown summary to <file>
  --no-github-summary     do not append to $GITHUB_STEP_SUMMARY
  --help, -h              print this text
`;

function parseArgs(argv) {
  const options = {
    root: undefined,
    checks: undefined,
    exceptionsFile: undefined,
    exceptionsProvided: false,
    json: false,
    summaryFile: undefined,
    githubSummary: true,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--root":
        options.root = argv[++i];
        break;
      case "--checks":
        options.checks = argv[++i];
        break;
      case "--exceptions":
        options.exceptionsFile = argv[++i];
        options.exceptionsProvided = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--summary-file":
        options.summaryFile = argv[++i];
        break;
      case "--no-github-summary":
        options.githubSummary = false;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

export function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`check-knowledge-structure: ${error.message}`);
    console.error(USAGE);
    return 1;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  const root = resolve(options.root ?? DEFAULT_ROOT);
  let exceptions;
  try {
    if (options.exceptionsProvided) {
      exceptions = loadExceptions(options.exceptionsFile);
    } else if (root === resolve(DEFAULT_ROOT)) {
      exceptions = KNOWN_EXCEPTIONS.map((entry) => ({ ...entry }));
    } else {
      exceptions = [];
    }
    const summary = runCheck({ root, checks: options.checks, exceptions });
    if (options.json) {
      console.log(JSON.stringify(summary));
    } else {
      renderHuman(summary);
      console.log(`KNOWLEDGE_STRUCTURE_RESULT ${JSON.stringify(summary)}`);
    }
    const markdown = renderSummaryMarkdown(summary);
    if (options.summaryFile) {
      writeFileSync(options.summaryFile, markdown, "utf8");
    }
    if (options.githubSummary && process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown, "utf8");
    }
    return summary.status === "passed" ? 0 : 1;
  } catch (error) {
    const summary = {
      tool: TOOL_NAME,
      version: SCRIPT_VERSION,
      status: "failed",
      errors: [{ code: "SETUP_ERROR", message: error.message }],
      warnings: [],
      exceptions: [],
    };
    if (options.json) {
      console.log(JSON.stringify(summary));
    } else {
      console.error(`check-knowledge-structure: ${error.message}`);
    }
    return 1;
  }
}

const isEntryPoint = (() => {
  try {
    return process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isEntryPoint) {
  process.exitCode = main();
}
