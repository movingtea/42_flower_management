#!/usr/bin/env node
/**
 * Starts the Next dev server for Playwright E2E from a clean `.next/dev` cache.
 *
 * Next 16 dev can keep a half-written route graph after a run is interrupted:
 * `/login` still renders, while `/api/auth/*` answers with the dev HTML error
 * page. That state poisons every auth request (auth.js reports
 * `ClientFetchError: Unexpected token '<'`). Removing `.next/dev` before the
 * server starts makes each E2E invocation reproducible; the compile cost is a
 * few seconds on the first request.
 */
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";

const appRoot = process.cwd();
rmSync(join(appRoot, ".next", "dev"), { recursive: true, force: true });

const nextBin = join(appRoot, "node_modules", "next", "dist", "bin", "next");
const child = spawn(
  process.execPath,
  [nextBin, "dev", "-H", "127.0.0.1", "-p", "3100"],
  { cwd: appRoot, env: process.env, stdio: "inherit" },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
