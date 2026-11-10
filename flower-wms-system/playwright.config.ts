import { defineConfig, devices } from "@playwright/test";

/**
 * Browser E2E for the V2 WMS.
 *
 * The runner is normally started through the throw-away database harness:
 *   node scripts/with-v2-test-db.mjs -- npm run test:e2e:inner
 * so V2_DATABASE_URL/DATABASE_URL already point at a per-run PostgreSQL cluster.
 * The webServer below only adds the auth/runtime test values; it must never
 * overwrite the harness database variables.
 */
const baseURL = "http://127.0.0.1:3100";

/** String-only copy of process.env, so the webServer env object stays strongly typed. */
const inheritedEnv: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
);

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Next dev compiles routes on first visit, so allow a slow first navigation.
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 20_000,
    navigationTimeout: 120_000,
  },
  webServer: {
    // The wrapper removes a possibly half-written `.next/dev` route graph before
    // starting Next dev (an interrupted dev run can leave `/api/auth/*` serving
    // the dev error HTML, which breaks every login), then starts:
    //   next dev -H 127.0.0.1 -p 3100
    // `-H 127.0.0.1` also registers the browser origin as a dev origin: Next 16
    // blocks `/_next/*` HMR/client endpoints whose host is not `localhost` (or
    // the server hostname) unless it is listed in allowedDevOrigins. Without it
    // the page renders but never hydrates, so form submits fall back to native
    // GET requests. Binding the dev server to 127.0.0.1 keeps the E2E baseURL on
    // 127.0.0.1 without changing product configuration.
    command: "node tests/e2e/start-dev-server.mjs",
    url: `${baseURL}/login`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      // The database harness forces NODE_ENV=test for its callback. Next dev is
      // not designed to run its browser bundles under that value (the client
      // never hydrates and form posts fall back to native GET submissions), so
      // the web server is explicitly started in standard development mode.
      // The explicit spread keeps the harness V2_DATABASE_URL and DATABASE_URL;
      // Playwright applies this object after process.env.
      ...inheritedEnv,
      NODE_ENV: "development",
      AUTH_SECRET: "wms-e2e-only-auth-secret-0123456789abcdef",
      NEXTAUTH_SECRET: "wms-e2e-only-auth-secret-0123456789abcdef",
      NEXTAUTH_URL: baseURL,
      AUTH_TRUST_HOST: "true",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
