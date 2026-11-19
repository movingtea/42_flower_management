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
import { statSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const srcRoot = pathToFileURL(resolve(process.cwd(), "src")).href;
const extensions = ["", ".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx"];

/** Node ESM cannot resolve a directory import; only accept regular files. */
function isFile(url) {
  try {
    return statSync(new URL(url)).isFile();
  } catch {
    return false;
  }
}

function resolveWithExtensions(url) {
  for (const extension of extensions) {
    const candidate = `${url}${extension}`;
    if (isFile(candidate)) return candidate;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    // Next's package exports omit the extension Node's ESM resolver expects.
    if (specifier.startsWith("next/")) {
      const nextFile = resolve(process.cwd(), "node_modules", `${specifier}.js`);
      if (isFile(pathToFileURL(nextFile).href)) {
        return { url: pathToFileURL(nextFile).href, shortCircuit: true };
      }
    }
    if (specifier.startsWith("@/")) {
      const base = `${srcRoot}/${specifier.slice(2)}`;
      const resolved = resolveWithExtensions(base);
      if (resolved) return { url: resolved, shortCircuit: true };
    }
    if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
      // Dependencies sometimes ship compiled .js next to a .ts source. Node's
      // type-stripping resolver prefers the .ts file and then refuses to strip
      // files under node_modules, so prefer the published .js sibling there.
      if (
        context.parentURL.includes("/node_modules/") &&
        !/\.[A-Za-z0-9]+$/.test(specifier)
      ) {
        const compiled = new URL(`${specifier}.js`, context.parentURL).href;
        if (isFile(compiled)) return { url: compiled, shortCircuit: true };
      }
      const base = new URL(specifier, context.parentURL).href;
      const resolved = resolveWithExtensions(base);
      if (resolved) return { url: resolved, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
