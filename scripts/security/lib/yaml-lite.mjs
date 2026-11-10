/**
 * yaml-lite — a deliberately small, dependency-free YAML subset parser for the
 * E3.7 security configuration and the security workflow.
 *
 * Why not a real YAML library: Sprint E3.7 must not add dependencies, and CI
 * configuration is a trusted, repository-owned input. The gates still need to
 * detect broken structure, so this parser *fails closed* on anything outside
 * the documented subset instead of guessing.
 *
 * Supported subset
 *  - block mappings and block sequences (nested by indentation)
 *  - `- key: value` sequence items that start a mapping
 *  - flow sequences of scalars: `[a, b, "c"]` and `[]`
 *  - single/double quoted scalars, plain scalars, booleans, null, integers,
 *    decimals
 *  - literal (`|`, `|-`) and folded (`>`, `>-`) block scalars
 *  - full-line comments and trailing ` # comment`
 *  - `{}` and `null` as empty values
 *
 * Explicitly unsupported (throws a YamlError): anchors/aliases, tags,
 * multi-document streams, flow mappings, tabs for indentation, merge keys.
 *
 * Exit/error contract: callers get a `YamlError` with `line` so they can report
 * the failing location and exit non-zero.
 */

export class YamlError extends Error {
  constructor(message, line) {
    super(line ? `${message} (line ${line})` : message);
    this.name = "YamlError";
    this.line = line ?? null;
  }
}

const KEY_COLON_RE = /^[^:#\s][^:]*:/;

function countIndent(raw, lineNo) {
  const match = raw.match(/^ */);
  const spaces = match ? match[0].length : 0;
  if (raw[spaces] === "\t") {
    throw new YamlError("tab indentation is not supported", lineNo);
  }
  return spaces;
}

/** Find the key/value separator colon outside quotes and flow brackets. */
function splitKeyValue(content, lineNo) {
  let quote = null;
  let depth = 0;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (quote === "'") {
      if (char === "'") {
        if (content[index + 1] === "'") index += 1;
        else quote = null;
      }
      continue;
    }
    if (quote === '"') {
      if (char === "\\") index += 1;
      else if (char === '"') quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "[" || char === "{") depth += 1;
    else if (char === "]" || char === "}") depth -= 1;
    else if (char === "#" && index > 0 && /\s/.test(content[index - 1])) break;
    else if (char === ":" && depth === 0) {
      const next = content[index + 1];
      if (next === undefined || next === " ") {
        return [content.slice(0, index).trim(), content.slice(index + 1).trim()];
      }
    }
  }
  return null;
}

/** Remove a trailing ` # comment` that is outside quotes and flow brackets. */
function stripTrailingComment(value) {
  let quote = null;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote === "'") {
      if (char === "'") {
        if (value[index + 1] === "'") index += 1;
        else quote = null;
      }
      continue;
    }
    if (quote === '"') {
      if (char === "\\") index += 1;
      else if (char === '"') quote = null;
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if (char === "[" || char === "{") depth += 1;
    else if (char === "]" || char === "}") depth -= 1;
    else if (char === "#" && depth === 0 && index > 0 && /\s/.test(value[index - 1])) {
      return value.slice(0, index).trimEnd();
    }
  }
  return value.trimEnd();
}

export function parseScalar(raw, lineNo) {
  const value = stripTrailingComment(raw.trim());
  if (value === "") return null;
  if (value === "[]") return [];
  if (value === "{}") return {};
  if (value.startsWith("[")) {
    if (!value.endsWith("]")) throw new YamlError("unterminated flow sequence", lineNo);
    const inner = value.slice(1, -1).trim();
    if (inner === "") return [];
    const items = [];
    let current = "";
    let quote = null;
    for (let index = 0; index < inner.length; index += 1) {
      const char = inner[index];
      if (quote === "'") {
        current += char;
        if (char === "'" && inner[index + 1] !== "'") quote = null;
        continue;
      }
      if (quote === '"') {
        current += char;
        if (char === "\\") {
          current += inner[index + 1] ?? "";
          index += 1;
        } else if (char === '"') quote = null;
        continue;
      }
      if (char === "'" || char === '"') {
        quote = char;
        current += char;
      } else if (char === ",") {
        items.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    if (quote) throw new YamlError("unterminated quote in flow sequence", lineNo);
    if (current.trim() !== "") items.push(current.trim());
    return items.map((item) => parseScalar(item, lineNo));
  }
  if (value.startsWith("{")) throw new YamlError("flow mappings are not supported", lineNo);
  if (value.startsWith('"')) {
    if (!value.endsWith('"') || value.length === 1) {
      throw new YamlError("unterminated double-quoted scalar", lineNo);
    }
    return value
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t");
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length === 1) {
      throw new YamlError("unterminated single-quoted scalar", lineNo);
    }
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value === "null" || value === "~" || value === "Null" || value === "NULL") return null;
  if (value === "true" || value === "True" || value === "TRUE") return true;
  if (value === "false" || value === "False" || value === "FALSE") return false;
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return Number.parseFloat(value);
  return value;
}

function unquoteKey(key) {
  const trimmed = key.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

export function parseYaml(text) {
  const normalized = String(text).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  let index = 0;

  const isBlankOrComment = (raw) => /^\s*(#.*)?$/.test(raw);

  function peek() {
    while (index < lines.length && isBlankOrComment(lines[index])) index += 1;
    if (index >= lines.length) return null;
    const raw = lines[index];
    const indent = countIndent(raw, index + 1);
    return {
      raw,
      indent,
      content: raw.slice(indent).replace(/\s+$/, ""),
      lineNo: index + 1,
    };
  }

  function parseBlockScalar(style, parentIndent) {
    const collected = [];
    let blockIndent = -1;
    while (index < lines.length) {
      const raw = lines[index];
      if (/^\s*$/.test(raw)) {
        collected.push("");
        index += 1;
        continue;
      }
      const indent = countIndent(raw, index + 1);
      if (indent <= parentIndent) break;
      if (blockIndent === -1) blockIndent = indent;
      if (indent < blockIndent) break;
      collected.push(raw.slice(blockIndent));
      index += 1;
    }
    while (collected.length > 0 && collected[collected.length - 1] === "") collected.pop();
    if (style.startsWith(">")) {
      return collected.join(" ").replace(/[ \t]{2,}/g, " ");
    }
    return collected.join("\n");
  }

  function parseSequence(indent) {
    const items = [];
    for (;;) {
      const line = peek();
      if (!line || line.indent !== indent) {
        if (line && line.indent > indent) {
          throw new YamlError("unexpected indentation in sequence", line.lineNo);
        }
        break;
      }
      if (!(line.content === "-" || line.content.startsWith("- "))) break;
      index += 1;
      const rest = line.content === "-" ? "" : line.content.slice(2).trim();
      if (rest === "") {
        const child = parseBlock(indent + 1, line.lineNo);
        items.push(child);
        continue;
      }
      const kv = splitKeyValue(rest, line.lineNo);
      if (kv) {
        const entry = {};
        assignEntry(entry, kv[0], kv[1], indent + 2, line.lineNo);
        const next = peek();
        if (next && next.indent > indent) {
          if (next.content.startsWith("- ")) {
            throw new YamlError("nested sequence inside a mapping item is not supported", next.lineNo);
          }
          const more = parseMapping(next.indent);
          for (const [key, value] of Object.entries(more)) entry[key] = value;
        }
        items.push(entry);
        continue;
      }
      items.push(parseScalar(rest, line.lineNo));
    }
    return items;
  }

  function assignEntry(target, rawKey, rawValue, keyIndent, lineNo) {
    const key = unquoteKey(rawKey);
    if (key === "") throw new YamlError("empty mapping key", lineNo);
    if (rawValue === "") {
      const next = peek();
      if (next && (next.content === "-" || next.content.startsWith("- ")) && next.indent >= keyIndent) {
        target[key] = parseSequence(next.indent);
      } else if (next && next.indent > keyIndent) {
        target[key] = parseBlock(next.indent, lineNo);
      } else {
        target[key] = null;
      }
      return;
    }
    if (/^[|>][+-]?$/.test(rawValue)) {
      target[key] = parseBlockScalar(rawValue, keyIndent);
      return;
    }
    target[key] = parseScalar(rawValue, lineNo);
  }

  function parseMapping(indent) {
    const map = {};
    for (;;) {
      const line = peek();
      if (!line || line.indent !== indent) {
        if (line && line.indent > indent) {
          throw new YamlError("unexpected indentation in mapping", line.lineNo);
        }
        break;
      }
      if (line.content === "-" || line.content.startsWith("- ")) break;
      const kv = splitKeyValue(line.content, line.lineNo);
      if (!kv) throw new YamlError(`expected "key: value", got "${line.content}"`, line.lineNo);
      index += 1;
      assignEntry(map, kv[0], kv[1], indent, line.lineNo);
    }
    return map;
  }

  function parseBlock(minIndent, lineNo) {
    const line = peek();
    if (!line) return null;
    if (line.indent < minIndent) return null;
    if (line.content === "-" || line.content.startsWith("- ")) {
      return parseSequence(line.indent);
    }
    if (!splitKeyValue(line.content, line.lineNo)) {
      // A bare scalar document/block.
      index += 1;
      return parseScalar(line.content, line.lineNo);
    }
    return parseMapping(line.indent);
  }

  const root = parseBlock(0, 1);
  const leftover = peek();
  if (leftover) throw new YamlError("unexpected content after document root", leftover.lineNo);
  return root;
}

/** Parse a YAML file from disk. Throws YamlError / fs errors to the caller. */
export function parseYamlFile(fs, filePath) {
  return parseYaml(fs.readFileSync(filePath, "utf8"));
}

/** Convenience: does the parsed object contain `path` (dot-separated)? */
export function hasPath(object, path) {
  let current = object;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) return false;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return false;
    current = current[segment];
  }
  return true;
}

/** Convenience: read a dot-separated path, returning undefined when absent. */
export function getPath(object, path) {
  let current = object;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

export { KEY_COLON_RE };
