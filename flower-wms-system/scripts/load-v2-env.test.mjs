import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { loadV2Env, resolveV2EnvFiles } from "./load-v2-env.mjs";

function withEnvDir(files, run) {
  const cwd = mkdtempSync(join(tmpdir(), "wms-load-v2-env-"));
  try {
    for (const [name, contents] of Object.entries(files)) {
      writeFileSync(join(cwd, name), contents, "utf8");
    }
    return run(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test("resolves Next.js local development env files, highest priority first", () => {
  assert.deepEqual(resolveV2EnvFiles("development"), [
    ".env.development.local",
    ".env.local",
    ".env.development",
    ".env",
  ]);
});

test(".env.local overrides .env and missing files are ignored", () => {
  withEnvDir(
    {
      ".env": "V2_DATABASE_URL=postgresql://env/from_env\n",
      ".env.local": "V2_DATABASE_URL=postgresql://local/from_local\n",
    },
    (cwd) => {
      const env = {};
      const loaded = loadV2Env({ cwd, mode: "development", env });

      assert.equal(env.V2_DATABASE_URL, "postgresql://local/from_local");
      assert.deepEqual(loaded.map((path) => basename(path)), [".env.local", ".env"]);
    },
  );
});

test("mode-specific local files outrank .env.local", () => {
  withEnvDir(
    {
      ".env.local": "V2_DATABASE_URL=postgresql://local/from_local\n",
      ".env.development.local": "V2_DATABASE_URL=postgresql://mode/from_mode\n",
    },
    (cwd) => {
      const env = {};
      loadV2Env({ cwd, mode: "development", env });

      assert.equal(env.V2_DATABASE_URL, "postgresql://mode/from_mode");
    },
  );
});

test("an existing process value always wins over env files", () => {
  withEnvDir(
    {
      ".env.local": "V2_DATABASE_URL=postgresql://local/from_local\n",
      ".env": "V2_DATABASE_URL=postgresql://env/from_env\n",
    },
    (cwd) => {
      const env = { V2_DATABASE_URL: "postgresql://shell/from_shell" };
      loadV2Env({ cwd, mode: "development", env });

      assert.equal(env.V2_DATABASE_URL, "postgresql://shell/from_shell");
    },
  );
});

test("NODE_ENV=test still reads .env.local for CLI commands", () => {
  withEnvDir(
    {
      ".env": "V2_DATABASE_URL=postgresql://env/from_env\n",
      ".env.local": "V2_DATABASE_URL=postgresql://local/from_local\n",
      ".env.test": "V2_DATABASE_URL=postgresql://test/from_test\n",
    },
    (cwd) => {
      const env = {};
      loadV2Env({ cwd, mode: "test", env });

      assert.equal(env.V2_DATABASE_URL, "postgresql://test/from_test");
    },
  );
});

test("parses a UTF-8 BOM written by Windows editors", () => {
  withEnvDir(
    {
      ".env.local": "\uFEFFV2_DATABASE_URL=postgresql://local/from_bom\n",
    },
    (cwd) => {
      const env = {};
      loadV2Env({ cwd, mode: "development", env });

      assert.equal(env.V2_DATABASE_URL, "postgresql://local/from_bom");
    },
  );
});

test("parses quoted values and comments", () => {
  withEnvDir(
    {
      ".env.local": [
        "# local V2 connection",
        'V2_DATABASE_URL="postgresql://user:pass@127.0.0.1:55432/flower_v2_dev?schema=public"',
        "",
      ].join("\n"),
    },
    (cwd) => {
      const env = {};
      loadV2Env({ cwd, mode: "development", env });

      assert.equal(
        env.V2_DATABASE_URL,
        "postgresql://user:pass@127.0.0.1:55432/flower_v2_dev?schema=public",
      );
    },
  );
});
