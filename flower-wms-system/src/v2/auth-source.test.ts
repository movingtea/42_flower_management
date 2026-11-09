import assert from "node:assert/strict";
import { config } from "dotenv";
import { resolve } from "node:path";
import {
  authenticateV2Staff,
  mapV2RolesToSessionRole,
  resolveV2Access,
  resolveV2AnyAccess,
  type V2StaffRecord,
} from "./auth";
import {
  V2_ROLE_CAPABILITIES,
  capabilitiesForRoles,
  rolesHaveCapability,
} from "./navigation";
import {
  authConfig,
  isV2CallbackUrl,
  isV2Path,
  normalizeAuthSource,
  normalizeCallbackUrl,
  resolveLoginCallbackUrl,
  resolveLoginRedirect,
  resolveLoginSurface,
  V2_HOME_PATH,
} from "../auth.config";

function makeStaff(overrides: Partial<V2StaffRecord> = {}): V2StaffRecord {
  return {
    id: "v2-staff-1",
    username: "admin",
    passwordHash: "hashed:admin",
    displayName: "系统管理员",
    active: true,
    tenantMembers: [{ tenantId: "tenant-1", roles: ["ADMIN"], active: true }],
    storeMembers: [
      {
        storeId: "store-1",
        roles: ["ADMIN"],
        active: true,
        store: { tenantId: "tenant-1" },
      },
    ],
    ...overrides,
  };
}

function makeStaffWithRoles(roles: string[]): V2StaffRecord {
  return makeStaff({
    tenantMembers: [{ tenantId: "tenant-1", roles, active: true }],
    storeMembers: [
      {
        storeId: "store-1",
        roles,
        active: true,
        store: { tenantId: "tenant-1" },
      },
    ],
  });
}

const comparePassword = async (password: string, hash: string) =>
  hash === `hashed:${password}`;

async function main() {
  const bootstrapStaff = makeStaff({ mustChangePassword: true });
  const bootstrapPrincipal = await authenticateV2Staff(
    { username: "admin", password: "admin" },
    async () => bootstrapStaff,
    comparePassword
  );
  assert.equal(bootstrapPrincipal?.mustChangePassword, true);
  assert.throws(() => resolveV2Access("v2", bootstrapStaff), /请先修改初始密码/);

  const bootstrapToken = await authConfig.callbacks.jwt({
    token: {},
    user: { id: bootstrapStaff.id, username: "admin", role: "STORE_ADMIN", source: "v2", v2BootstrapSession: true },
  } as never);
  const bootstrapSession = await authConfig.callbacks.session({
    session: { user: {}, expires: "" },
    token: bootstrapToken,
  } as never);
  assert.equal((bootstrapSession as { user: { v2BootstrapSession?: boolean } }).user.v2BootstrapSession, true);

  // Source marker: pre-marker/unknown tokens must be treated as legacy, never v2.
  assert.equal(normalizeAuthSource(undefined), "legacy");
  assert.equal(normalizeAuthSource("legacy"), "legacy");
  assert.equal(normalizeAuthSource("v2"), "v2");
  assert.equal(normalizeAuthSource("admin"), "legacy");

  // JWT/session callbacks carry the source marker; pre-marker tokens become legacy.
  const v2Jwt = (await authConfig.callbacks.jwt({
    token: {},
    user: {
      id: "v2-staff-1",
      username: "admin",
      role: "STORE_ADMIN",
      source: "v2",
    },
  } as never)) as { source?: string };
  assert.equal(v2Jwt.source, "v2");

  const legacyJwt = (await authConfig.callbacks.jwt({
    token: {},
    user: {
      id: "legacy-staff-1",
      username: "admin",
      role: "STORE_ADMIN",
    },
  } as never)) as { source?: string };
  assert.equal(legacyJwt.source, "legacy");

  const oldSession = (await authConfig.callbacks.session({
    session: { user: {}, expires: "" },
    token: { id: "legacy-staff-1", username: "admin", role: "STORE_ADMIN" },
  } as never)) as { user: { source?: string } };
  assert.equal(oldSession.user.source, "legacy");

  const v2Session = (await authConfig.callbacks.session({
    session: { user: {}, expires: "" },
    token: {
      id: "v2-staff-1",
      username: "admin",
      role: "STORE_ADMIN",
      source: "v2",
    },
  } as never)) as { user: { source?: string } };
  assert.equal(v2Session.user.source, "v2");

  // Callback routing selects the v2 surface only for /v2 paths and stays internal.
  assert.equal(normalizeCallbackUrl("/v2"), "/v2");
  assert.equal(normalizeCallbackUrl("/v2?error=x"), "/v2?error=x");
  assert.equal(normalizeCallbackUrl("https://evil.example/v2"), "/");
  assert.equal(normalizeCallbackUrl("//evil.example/v2"), "/");
  assert.equal(isV2CallbackUrl("/v2"), true);
  assert.equal(isV2CallbackUrl("/v2/production"), true);
  assert.equal(isV2CallbackUrl("/v2?error=x"), true);
  assert.equal(isV2CallbackUrl("/v2-admin"), false);
  assert.equal(isV2CallbackUrl("/wms"), false);
  assert.equal(isV2Path("/v2"), true);
  assert.equal(isV2Path("/v2/orders"), true);
  assert.equal(isV2Path("/v20"), false);

  // Default entry/login leads to v2; explicit legacy callbacks keep legacy credentials.
  assert.equal(V2_HOME_PATH, "/v2");
  assert.equal(resolveLoginCallbackUrl(null), "/v2");
  assert.equal(resolveLoginCallbackUrl(""), "/v2");
  assert.equal(resolveLoginCallbackUrl("/"), "/v2");
  assert.equal(resolveLoginCallbackUrl("/v2?tab=orders"), "/v2?tab=orders");
  assert.equal(
    resolveLoginCallbackUrl("/wms/orders?status=NEW"),
    "/wms/orders?status=NEW"
  );
  assert.equal(resolveLoginCallbackUrl("https://evil.example/wms"), "/v2");
  assert.equal(resolveLoginCallbackUrl("//evil.example/wms"), "/v2");

  assert.equal(resolveLoginSurface(null), "v2");
  assert.equal(resolveLoginSurface(""), "v2");
  assert.equal(resolveLoginSurface("/"), "v2");
  assert.equal(resolveLoginSurface("/v2"), "v2");
  assert.equal(resolveLoginSurface("/v2/orders"), "v2");
  assert.equal(resolveLoginSurface("/wms"), "legacy");
  assert.equal(resolveLoginSurface("/wms/orders"), "legacy");
  assert.equal(resolveLoginSurface("/cms/products"), "legacy");
  assert.equal(resolveLoginSurface("/admin/staff-users"), "legacy");
  assert.equal(resolveLoginSurface("//evil.example/wms"), "v2");

  // Login redirects: guests always see the form, legacy callbacks are never bounced,
  // and a v2 session only short-circuits back to v2 for v2/root callbacks.
  const renderLogin = { kind: "render" } as const;
  assert.deepEqual(
    resolveLoginRedirect({
      isLoggedIn: false,
      source: "legacy",
      callbackUrl: null,
    }),
    renderLogin
  );
  assert.deepEqual(
    resolveLoginRedirect({
      isLoggedIn: false,
      source: "legacy",
      callbackUrl: "/wms/orders",
    }),
    renderLogin
  );
  assert.deepEqual(
    resolveLoginRedirect({
      isLoggedIn: true,
      source: "legacy",
      callbackUrl: null,
    }),
    renderLogin
  );
  assert.deepEqual(
    resolveLoginRedirect({
      isLoggedIn: true,
      source: "legacy",
      callbackUrl: "/v2",
    }),
    renderLogin
  );
  assert.deepEqual(
    resolveLoginRedirect({
      isLoggedIn: true,
      source: "legacy",
      callbackUrl: "/wms/orders",
    }),
    renderLogin
  );
  assert.deepEqual(
    resolveLoginRedirect({
      isLoggedIn: true,
      source: "v2",
      callbackUrl: null,
    }),
    { kind: "redirect", destination: "/v2" }
  );
  assert.deepEqual(
    resolveLoginRedirect({
      isLoggedIn: true,
      source: "v2",
      callbackUrl: "/",
    }),
    { kind: "redirect", destination: "/v2" }
  );
  assert.deepEqual(
    resolveLoginRedirect({
      isLoggedIn: true,
      source: "v2",
      callbackUrl: "/v2/orders?tab=1",
    }),
    { kind: "redirect", destination: "/v2/orders?tab=1" }
  );
  assert.deepEqual(
    resolveLoginRedirect({
      isLoggedIn: true,
      source: "v2",
      callbackUrl: "/wms/orders",
    }),
    renderLogin
  );
  assert.deepEqual(
    resolveLoginRedirect({
      isLoggedIn: true,
      source: "v2",
      callbackUrl: "https://evil.example/wms",
    }),
    { kind: "redirect", destination: "/v2" }
  );

  // Credential authorization: inactive, wrong password and empty input are rejected.
  let lookupCount = 0;
  assert.equal(
    await authenticateV2Staff(
      { username: "admin", password: "admin" },
      async () => {
        lookupCount += 1;
        return makeStaff({ active: false });
      },
      comparePassword
    ),
    null
  );
  assert.equal(lookupCount, 1);

  assert.equal(
    await authenticateV2Staff(
      { username: "admin", password: "wrong" },
      async () => makeStaff(),
      comparePassword
    ),
    null
  );

  let emptyLookup = false;
  assert.equal(
    await authenticateV2Staff(
      { username: "   ", password: "admin" },
      async () => {
        emptyLookup = true;
        return makeStaff();
      },
      comparePassword
    ),
    null
  );
  assert.equal(emptyLookup, false);

  const principal = await authenticateV2Staff(
    { username: "admin", password: "admin" },
    async (username) => (username === "admin" ? makeStaff() : null),
    comparePassword
  );
  assert.deepEqual(principal, {
    id: "v2-staff-1",
    username: "admin",
    displayName: "系统管理员",
    sessionRole: "STORE_ADMIN",
    source: "v2",
  });

  assert.equal(mapV2RolesToSessionRole(["MANAGER"]), "WAREHOUSE_MANAGER");
  assert.equal(mapV2RolesToSessionRole(["FLORIST"]), "FLORIST");
  assert.equal(mapV2RolesToSessionRole(["BUYER"]), "STORE_OPERATOR");
  assert.equal(mapV2RolesToSessionRole([]), "STORE_OPERATOR");
  assert.equal(mapV2RolesToSessionRole(["admin"]), "STORE_OPERATOR");

  // Capability resolution and login/session revalidation share the canonical matrix.
  assert.deepEqual(
    capabilitiesForRoles(["ADMIN"]),
    [...V2_ROLE_CAPABILITIES.ADMIN]
  );
  assert.deepEqual(capabilitiesForRoles(["MANAGER"]), [
    "read",
    "catalog",
    "purchase",
    "order",
    "production",
    "delivery",
  ]);
  assert.equal(rolesHaveCapability(["MANAGER"], "staff"), false);
  assert.equal(rolesHaveCapability(["ADMIN"], "staff"), true);
  assert.deepEqual(capabilitiesForRoles(["admin"]), []);

  // Login refuses a credential whose current tenant/store memberships are not
  // both active, matching every later session revalidation.
  assert.equal(
    await authenticateV2Staff(
      { username: "admin", password: "admin" },
      async () => makeStaff({ storeMembers: [] }),
      comparePassword
    ),
    null
  );
  assert.equal(
    await authenticateV2Staff(
      { username: "admin", password: "admin" },
      async () =>
        makeStaff({
          tenantMembers: [
            { tenantId: "tenant-1", roles: ["ADMIN"], active: false },
          ],
        }),
      comparePassword
    ),
    null
  );
  assert.equal(
    await authenticateV2Staff(
      { username: "admin", password: "admin" },
      async () =>
        makeStaff({
          storeMembers: [
            {
              storeId: "store-1",
              roles: ["ADMIN"],
              active: false,
              store: { tenantId: "tenant-1" },
            },
          ],
        }),
      comparePassword
    ),
    null
  );

  assert.equal(
    await authenticateV2Staff(
      { username: "admin", password: "admin" },
      async () =>
        makeStaff({
          tenantMembers: [
            { tenantId: "tenant-1", roles: ["SUPERUSER"], active: true },
          ],
          storeMembers: [
            {
              storeId: "store-1",
              roles: ["SUPERUSER"],
              active: true,
              store: { tenantId: "tenant-1" },
            },
          ],
        }),
      comparePassword
    ),
    null
  );

  // A legacy source can never be authorized on the v2 surface, even with v2 memberships.
  assert.throws(() => resolveV2Access("legacy", makeStaff()), /v2 账号登录/);
  assert.throws(() => resolveV2Access(undefined, makeStaff()), /v2 账号登录/);
  assert.throws(() => resolveV2Access("v2", makeStaff({ active: false })), /v2 访问权限/);
  assert.throws(
    () =>
      resolveV2Access(
        "v2",
        makeStaff({
          storeMembers: [
            {
              storeId: "store-1",
              roles: ["ADMIN"],
              active: false,
              store: { tenantId: "tenant-1" },
            },
          ],
        })
      ),
    /门店访问权限/
  );
  assert.throws(
    () =>
      resolveV2Access(
        "v2",
        makeStaff({
          tenantMembers: [{ tenantId: "other-tenant", roles: ["ADMIN"], active: true }],
        })
      ),
    /门店访问权限/
  );
  assert.throws(
    () =>
      resolveV2Access(
        "v2",
        makeStaff({
          tenantMembers: [{ tenantId: "tenant-1", roles: ["FLORIST"], active: true }],
          storeMembers: [
            {
              storeId: "store-1",
              roles: ["FLORIST"],
              active: true,
              store: { tenantId: "tenant-1" },
            },
          ],
        }),
        "catalog"
      ),
    /没有此操作权限/
  );

  assert.throws(
    () =>
      resolveV2Access(
        "v2",
        makeStaff({
          tenantMembers: [
            { tenantId: "tenant-1", roles: ["SUPERUSER"], active: true },
          ],
          storeMembers: [
            {
              storeId: "store-1",
              roles: ["SUPERUSER"],
              active: true,
              store: { tenantId: "tenant-1" },
            },
          ],
        })
      ),
    /没有此操作权限/
  );

  assert.deepEqual(resolveV2Access("v2", makeStaff(), "catalog"), {
    staffId: "v2-staff-1",
    tenantId: "tenant-1",
    storeId: "store-1",
  });
  assert.deepEqual(
    resolveV2Access(
      "v2",
      makeStaff({
        tenantMembers: [{ tenantId: "tenant-1", roles: ["FLORIST"], active: true }],
        storeMembers: [
          {
            storeId: "store-1",
            roles: ["FLORIST"],
            active: true,
            store: { tenantId: "tenant-1" },
          },
        ],
      }),
      "production"
    ),
    { staffId: "v2-staff-1", tenantId: "tenant-1", storeId: "store-1" }
  );

  // Any-of authorization uses the same membership boundary and matrix.
  const orderModuleCapabilities = [
    "order",
    "production",
    "delivery",
  ] as const;
  const expectedAccess = {
    staffId: "v2-staff-1",
    tenantId: "tenant-1",
    storeId: "store-1",
  };
  assert.deepEqual(
    resolveV2AnyAccess(
      "v2",
      makeStaffWithRoles(["SALES"]),
      orderModuleCapabilities
    ),
    expectedAccess
  );
  assert.deepEqual(
    resolveV2AnyAccess(
      "v2",
      makeStaffWithRoles(["FLORIST"]),
      orderModuleCapabilities
    ),
    expectedAccess
  );
  assert.throws(
    () =>
      resolveV2AnyAccess(
        "v2",
        makeStaffWithRoles(["BUYER"]),
        orderModuleCapabilities
      ),
    /没有此操作权限/
  );
  assert.deepEqual(
    resolveV2AnyAccess("v2", makeStaffWithRoles(["BUYER"]), ["purchase"]),
    expectedAccess
  );
  assert.throws(
    () =>
      resolveV2AnyAccess(
        "v2",
        makeStaffWithRoles(["SUPERUSER"]),
        orderModuleCapabilities
      ),
    /没有此操作权限/
  );
  assert.throws(
    () =>
      resolveV2AnyAccess(
        "v2",
        makeStaffWithRoles(["SALES"]),
        []
      ),
    /没有此操作权限/
  );

  // Optional integration check against the seeded v2 PostgreSQL database.
  config({ path: resolve(process.cwd(), ".env.local"), quiet: true });
  config({ quiet: true });

  const requireDb = process.env.V2_AUTH_REQUIRE_DB === "1";
  const connectionString = process.env.V2_DATABASE_URL;
  if (!connectionString) {
    if (requireDb) {
      throw new Error("V2_DATABASE_URL is required for the v2 auth integration check");
    }
    console.log("v2 auth DB integration check skipped: V2_DATABASE_URL not set");
  } else {
    const { PrismaPg } = await import("@prisma/adapter-pg");
    const { PrismaClient } = await import("../generated/prisma-v2/client");
    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    let dbAvailable = true;
    try {
      try {
        await db.$queryRaw`SELECT 1`;
      } catch (error) {
        dbAvailable = false;
        if (requireDb) throw error;
        console.log(
          `v2 auth DB integration check skipped: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }

      if (dbAvailable) {
        const seededAdmin = await db.staffUser.findUnique({
          where: { username: "admin" },
          include: {
            tenantMembers: true,
            storeMembers: { include: { store: true } },
          },
        });
        assert.ok(seededAdmin, "v2 seed must create the admin StaffUser");

        const seededPrincipal = await authenticateV2Staff(
          { username: "admin", password: "admin" },
          async () => seededAdmin
        );
        assert.ok(seededPrincipal, "seeded v2 admin must authenticate");
        assert.equal(seededPrincipal.source, "v2");
        assert.equal(seededPrincipal.sessionRole, "STORE_ADMIN");

        const access = resolveV2Access(
          seededPrincipal.source,
          seededAdmin,
          "catalog"
        );
        assert.equal(access.staffId, seededAdmin.id);
        assert.ok(access.tenantId);
        assert.ok(access.storeId);

        assert.throws(() => resolveV2Access("legacy", seededAdmin), /v2 账号登录/);
        assert.equal(
          await authenticateV2Staff(
            { username: "admin", password: "not-the-seed-password" },
            async () => seededAdmin
          ),
          null
        );
        console.log("v2 auth DB integration check passed (seeded admin)");
      }
    } finally {
      await db.$disconnect();
    }
  }

  console.log("v2 auth source/credential tests passed");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
