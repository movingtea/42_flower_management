/**
 * Minimal Node resolve hook for running the TypeScript test scripts without
 * tsx/esbuild when a restricted Windows sandbox blocks esbuild's child-process
 * service. Node itself performs type stripping/transformation:
 *
 *   node --experimental-strip-types --import ./scripts/ts-path-loader.mjs <test.ts>
 *
 * The loader only resolves the project's "@/" alias and extensionless relative
 * imports; it is test tooling and is never imported by application code.
 */
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const srcRoot = pathToFileURL(resolve(process.cwd(), "src")).href;
const extensions = ["", ".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx"];

function resolveWithExtensions(url) {
  for (const extension of extensions) {
    const candidate = `${url}${extension}`;
    try {
      if (existsSync(new URL(candidate))) return candidate;
    } catch {
      // Ignore invalid URL candidates and continue.
    }
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = `${srcRoot}/${specifier.slice(2)}`;
      const resolved = resolveWithExtensions(base);
      if (resolved) return { url: resolved, shortCircuit: true };
    }
    if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
      const base = new URL(specifier, context.parentURL).href;
      const resolved = resolveWithExtensions(base);
      if (resolved) return { url: resolved, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
