import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { normalizeAiCareTable } from "@/lib/ai/material-care-normalizer";
import {
  formatWikiEnglishName,
  normalizeCareTable,
  type WikiCareRow,
} from "@/lib/wiki-care";

/**
 * Run with: npx tsx src/app/api/v2/ai/complete-material/route.test.ts
 *
 * In the confined sandbox used for this task, esbuild's child-process service is
 * blocked (spawn EPERM). The equivalent fallback command is:
 * node --experimental-strip-types --import ./scripts/ts-path-loader.mjs src/app/api/v2/ai/complete-material/route.test.ts
 *
 * Route-handler test with Node module stubs only (no database, no network).
 * The auth, DeepSeek and NextResponse modules are replaced through a resolve
 * hook; the real V1 care-table normalizers are injected into the wiki-care stub
 * so the route's response normalization is exercised for real.
 */

type Completion = {
  latinName: string;
  englishName: string;
  flowerLanguage: string;
  careTable: WikiCareRow[];
};

type RouteState = {
  capability?: string;
  authError: string | null;
  completion: Completion | null;
  completionError: string | null;
  flowerName?: string;
  deepSeekCalls: number;
  wikiCare: {
    formatWikiEnglishName: typeof formatWikiEnglishName;
    normalizeAiCareTable: typeof normalizeAiCareTable;
    normalizeCareTable: typeof normalizeCareTable;
  };
};

const state: RouteState = {
  authError: null,
  completion: null,
  completionError: null,
  deepSeekCalls: 0,
  wikiCare: { formatWikiEnglishName, normalizeAiCareTable, normalizeCareTable },
};
(globalThis as unknown as { __materialAiRouteTest: RouteState }).__materialAiRouteTest =
  state;

const stubs: Record<string, string> = {
  "next/server": `
    export class NextResponse {
      constructor(body, init) {
        this._body = body;
        this.status = init && typeof init.status === "number" ? init.status : 200;
      }
      static json(body, init) { return new NextResponse(body, init); }
      async json() { return this._body; }
    }
  `,
  "@/v2/auth": `
    export async function requireV2Store(capability) {
      const shared = globalThis.__materialAiRouteTest;
      shared.capability = capability;
      if (shared.authError) throw new Error(shared.authError);
      return { tenantId: "tenant-1", storeId: "store-1", staffId: "staff-1" };
    }
  `,
  "@/lib/deepseek-flower": `
    export async function completeFlowerWithDeepSeek(flowerName) {
      const shared = globalThis.__materialAiRouteTest;
      shared.flowerName = flowerName;
      shared.deepSeekCalls += 1;
      if (shared.completionError) throw new Error(shared.completionError);
      return shared.completion;
    }
  `,
  "@/lib/ai/material-care-normalizer": `
    export function normalizeAiCareTable(careTable) {
      return globalThis.__materialAiRouteTest.wikiCare.normalizeAiCareTable(careTable);
    }
  `,
  "@/lib/wiki-care": `
    export function formatWikiEnglishName(latinName, englishName) {
      return globalThis.__materialAiRouteTest.wikiCare.formatWikiEnglishName(latinName, englishName);
    }
    export function normalizeCareTable(careTable) {
      return globalThis.__materialAiRouteTest.wikiCare.normalizeCareTable(careTable);
    }
  `,
};

const registerHooks = (nodeModule as unknown as {
  registerHooks: (hooks: {
    resolve: (
      specifier: string,
      context: { parentURL?: string },
      nextResolve: (specifier: string, context?: { parentURL?: string }) => { url: string; shortCircuit?: boolean },
    ) => { url: string; shortCircuit?: boolean };
  }) => void;
}).registerHooks;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const source = stubs[specifier];
    if (source) {
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const testDirectory = typeof __dirname === "string"
  ? __dirname
  : fileURLToPath(new URL(".", import.meta.url));
const routeSource = ts.transpileModule(
  readFileSync(join(testDirectory, "route.ts"), "utf8"),
  {
    fileName: join(testDirectory, "route.ts"),
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;

type StubResponse = {
  status: number;
  json: () => Promise<unknown>;
};

type RouteJson = {
  success?: boolean;
  error?: string;
  data?: {
    combinedEnglishName?: string;
    latinName?: string;
    englishName?: string;
    flowerLanguage?: string;
    careTable?: WikiCareRow[];
  };
};

type Post = (request: Request) => Promise<StubResponse>;

async function post(body: string): Promise<StubResponse> {
  const request = new Request("http://localhost/api/v2/ai/complete-material", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  return POST(request);
}

let POST: Post;

function resetState(): void {
  state.capability = undefined;
  state.authError = null;
  state.completion = null;
  state.completionError = null;
  state.flowerName = undefined;
  state.deepSeekCalls = 0;
}

async function main(): Promise<void> {
  POST = ((await import(
    `data:text/javascript;base64,${Buffer.from(routeSource).toString("base64")}`
  )) as { POST: Post }).POST;

  // 1. Success: catalog capability, trimmed name, real normalization applied.
  resetState();
  state.completion = {
    latinName: "Rosa hybrida",
    englishName: "Rose",
    flowerLanguage: "热烈的爱",
    careTable: [
      { key: "wakeWater", label: "醒花水位", value: "建议使用深水醒花，将花茎浸入水中……" },
      { key: "mainWater", label: "养护水位", value: "浅水养护即可" },
      { key: "frequency", label: "换水频率", value: "每2天换水" },
    ],
  };
  const successResponse = await post(JSON.stringify({ flowerName: "  玫瑰  " }));
  assert.equal(successResponse.status, 200);
  assert.equal(state.capability, "catalog");
  assert.equal(state.flowerName, "玫瑰");
  const successJson = (await successResponse.json()) as RouteJson;
  assert.equal(successJson.success, true);
  assert.equal(successJson.data?.combinedEnglishName, "Rosa hybrida / Rose");
  assert.equal(successJson.data?.latinName, "Rosa hybrida");
  assert.equal(successJson.data?.englishName, "Rose");
  assert.equal(successJson.data?.flowerLanguage, "热烈的爱");
  assert.equal(successJson.data?.careTable?.length, 7);
  assert.equal(successJson.data?.careTable?.[0]?.value, "需要深水醒花");
  assert.equal(successJson.data?.careTable?.[1]?.value, "花瓶1/3至1/2");
  assert.equal(successJson.data?.careTable?.[5]?.value, "每2天换水");

  // 2. Missing / blank / non-string flowerName is a 400 before DeepSeek.
  resetState();
  for (const body of [
    JSON.stringify({}),
    JSON.stringify({ flowerName: "   " }),
    JSON.stringify({ flowerName: 42 }),
  ]) {
    const response = await post(body);
    assert.equal(response.status, 400);
    const json = (await response.json()) as RouteJson;
    assert.equal(json.success, false);
    assert.match(json.error ?? "", /请填写花材中文名/);
  }
  assert.equal(state.deepSeekCalls, 0);

  // 3. Malformed JSON body is a 400 and never calls DeepSeek.
  resetState();
  const malformed = await post("{not-json");
  assert.equal(malformed.status, 400);
  assert.match(((await malformed.json()) as RouteJson).error ?? "", /JSON/);
  assert.equal(state.deepSeekCalls, 0);

  // 4. Authorization failure is a 403 and never calls DeepSeek.
  resetState();
  state.authError = "当前账号没有物料维护权限";
  const denied = await post(JSON.stringify({ flowerName: "玫瑰" }));
  assert.equal(denied.status, 403);
  assert.equal(state.capability, "catalog");
  assert.match(((await denied.json()) as RouteJson).error ?? "", /没有物料维护权限/);
  assert.equal(state.deepSeekCalls, 0);

  // 5. Missing API key maps to 503; other upstream failures map to 502.
  resetState();
  state.completionError = "未配置 DEEPSEEK_API_KEY，无法调用 AI 补全";
  const unavailable = await post(JSON.stringify({ flowerName: "玫瑰" }));
  assert.equal(unavailable.status, 503);
  assert.match(((await unavailable.json()) as RouteJson).error ?? "", /DEEPSEEK_API_KEY/);

  resetState();
  state.completionError = "DeepSeek 请求失败 (500)";
  const upstreamFailure = await post(JSON.stringify({ flowerName: "玫瑰" }));
  assert.equal(upstreamFailure.status, 502);
  assert.match(((await upstreamFailure.json()) as RouteJson).error ?? "", /DeepSeek 请求失败/);
  assert.equal(state.deepSeekCalls, 1);

  console.log("complete-material route tests passed");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
