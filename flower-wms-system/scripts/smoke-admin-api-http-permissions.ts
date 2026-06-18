/**
 * Admin API HTTP 层权限 smoke（route handler 直调 + session override，无需 DB / 浏览器）
 * Run: npm run smoke:admin-api-http-permissions
 *
 * 限制：通过 api-auth.setStaffSessionOverrideForTests 模拟登录态，非真实 cookie；
 * 覆盖 requirePermission 在 handler 内的 401/403 行为。
 */
import {
  assertNotAuthBlocked,
  assertResponseStatus,
  STAFF_FIXTURES,
} from "../src/lib/admin-api-http-test-harness";
import {
  clearStaffSessionOverrideForTests,
  setStaffSessionOverrideForTests,
} from "../src/lib/api-auth";

const FAKE_CATEGORY_ID = "00000000-0000-4000-8000-000000000001";
const FAKE_PRODUCT_ID = "00000000-0000-4000-8000-000000000002";

type HandlerCase = {
  label: string;
  run: () => Promise<Response>;
};

function jsonRequest(method: string, body: unknown = {}): Request {
  return new Request("http://localhost/api/admin/smoke", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function loadHandlers(): Promise<{
  WRITE_CASES: HandlerCase[];
  getWmsBomStub: () => Promise<Response>;
  postWmsBomStub: () => Promise<Response>;
  postProductsBomStub: () => Promise<Response>;
  putProductBomStub: (
    req: Request,
    ctx: { params: Promise<{ id: string }> }
  ) => Promise<Response>;
}> {
  process.env.DATABASE_URL ??=
    "postgresql://permission-smoke:permission-smoke@127.0.0.1:5432/permission_smoke_unused";

  const [
    productsRoute,
    stocktakeRoute,
    appConfigRoute,
    productCategoriesRoute,
    materialCategoriesRoute,
    wmsBomRoute,
    productsBomRoute,
    productIdBomRoute,
  ] = await Promise.all([
    import("../src/app/api/admin/products/route"),
    import("../src/app/api/admin/stocktake/route"),
    import("../src/app/api/admin/app-config/route"),
    import("../src/app/api/admin/product-categories/route"),
    import("../src/app/api/admin/wms/material-categories/[id]/route"),
    import("../src/app/api/admin/wms/bom/route"),
    import("../src/app/api/admin/products/bom/route"),
    import("../src/app/api/admin/products/[id]/bom/route"),
  ]);

  const WRITE_CASES: HandlerCase[] = [
    {
      label: "POST /api/admin/products",
      run: () => productsRoute.POST(jsonRequest("POST", {})),
    },
    {
      label: "POST /api/admin/stocktake",
      run: () => stocktakeRoute.POST(jsonRequest("POST", {})),
    },
    {
      label: "PUT /api/admin/app-config",
      run: () => appConfigRoute.PUT(jsonRequest("PUT", {})),
    },
    {
      label: "POST /api/admin/product-categories",
      run: () => productCategoriesRoute.POST(jsonRequest("POST", {})),
    },
    {
      label: "PUT /api/admin/wms/material-categories/[id]",
      run: () =>
        materialCategoriesRoute.PUT(jsonRequest("PUT", {}), {
          params: Promise.resolve({ id: FAKE_CATEGORY_ID }),
        }),
    },
  ];

  return {
    WRITE_CASES,
    getWmsBomStub: wmsBomRoute.GET,
    postWmsBomStub: wmsBomRoute.POST,
    postProductsBomStub: productsBomRoute.POST,
    putProductBomStub: productIdBomRoute.PUT,
  };
}

async function testUnauthenticatedReturns401(WRITE_CASES: HandlerCase[]) {
  clearStaffSessionOverrideForTests();
  setStaffSessionOverrideForTests(null);
  for (const c of WRITE_CASES) {
    const res = await c.run();
    await assertResponseStatus(res, 401, `unauthenticated ${c.label}`);
  }
}

async function testItAdminReturns403(WRITE_CASES: HandlerCase[]) {
  setStaffSessionOverrideForTests(STAFF_FIXTURES.itAdmin);
  for (const c of WRITE_CASES) {
    const res = await c.run();
    await assertResponseStatus(res, 403, `IT_ADMIN ${c.label}`);
  }
}

async function testLowPrivilegeReturns403(WRITE_CASES: HandlerCase[]) {
  const cases: Array<{
    staff: (typeof STAFF_FIXTURES)[keyof typeof STAFF_FIXTURES];
    label: string;
    run: HandlerCase["run"];
  }> = [
    {
      staff: STAFF_FIXTURES.florist,
      label: "FLORIST cms:write POST /api/admin/products",
      run: WRITE_CASES[0].run,
    },
    {
      staff: STAFF_FIXTURES.storeOperator,
      label: "STORE_OPERATOR wms:write POST /api/admin/stocktake",
      run: WRITE_CASES[1].run,
    },
    {
      staff: STAFF_FIXTURES.warehouseManager,
      label: "WAREHOUSE_MANAGER cms:write PUT /api/admin/app-config",
      run: WRITE_CASES[2].run,
    },
  ];
  for (const c of cases) {
    setStaffSessionOverrideForTests(c.staff);
    const res = await c.run();
    await assertResponseStatus(res, 403, c.label);
  }
}

async function testAuthorizedRolesPassAuthBoundary(WRITE_CASES: HandlerCase[]) {
  setStaffSessionOverrideForTests(STAFF_FIXTURES.storeAdmin);
  for (const c of [
    WRITE_CASES[0],
    WRITE_CASES[2],
    WRITE_CASES[3],
    WRITE_CASES[1],
  ]) {
    const res = await c.run();
    assertNotAuthBlocked(res.status, `STORE_ADMIN ${c.label}`);
  }

  setStaffSessionOverrideForTests(STAFF_FIXTURES.warehouseManager);
  const stockRes = await WRITE_CASES[1].run();
  assertNotAuthBlocked(stockRes.status, "WAREHOUSE_MANAGER POST /api/admin/stocktake");

  const matRes = await WRITE_CASES[4].run();
  assertNotAuthBlocked(
    matRes.status,
    "WAREHOUSE_MANAGER PUT /api/admin/wms/material-categories/[id]"
  );
}

async function test410StubAuth(handlers: Awaited<ReturnType<typeof loadHandlers>>) {
  const {
    getWmsBomStub,
    postWmsBomStub,
    postProductsBomStub,
    putProductBomStub,
  } = handlers;

  clearStaffSessionOverrideForTests();
  setStaffSessionOverrideForTests(null);
  let res = await getWmsBomStub();
  await assertResponseStatus(res, 401, "unauthenticated GET /api/admin/wms/bom");

  setStaffSessionOverrideForTests(STAFF_FIXTURES.florist);
  res = await postWmsBomStub();
  await assertResponseStatus(res, 403, "FLORIST POST /api/admin/wms/bom");

  setStaffSessionOverrideForTests(STAFF_FIXTURES.warehouseManager);
  res = await getWmsBomStub();
  await assertResponseStatus(res, 410, "WAREHOUSE_MANAGER GET /api/admin/wms/bom");
  res = await postWmsBomStub();
  await assertResponseStatus(res, 410, "WAREHOUSE_MANAGER POST /api/admin/wms/bom");

  setStaffSessionOverrideForTests(STAFF_FIXTURES.storeOperator);
  res = await postProductsBomStub();
  await assertResponseStatus(res, 403, "STORE_OPERATOR POST /api/admin/products/bom");

  setStaffSessionOverrideForTests(STAFF_FIXTURES.warehouseManager);
  res = await postProductsBomStub();
  await assertResponseStatus(res, 410, "WAREHOUSE_MANAGER POST /api/admin/products/bom");

  setStaffSessionOverrideForTests(null);
  res = await putProductBomStub(undefined as unknown as Request, {
    params: Promise.resolve({ id: FAKE_PRODUCT_ID }),
  });
  await assertResponseStatus(res, 401, "unauthenticated PUT /api/admin/products/[id]/bom");

  setStaffSessionOverrideForTests(STAFF_FIXTURES.florist);
  res = await putProductBomStub(undefined as unknown as Request, {
    params: Promise.resolve({ id: FAKE_PRODUCT_ID }),
  });
  await assertResponseStatus(res, 403, "FLORIST PUT /api/admin/products/[id]/bom");

  setStaffSessionOverrideForTests(STAFF_FIXTURES.warehouseManager);
  res = await putProductBomStub(undefined as unknown as Request, {
    params: Promise.resolve({ id: FAKE_PRODUCT_ID }),
  });
  await assertResponseStatus(res, 410, "WAREHOUSE_MANAGER PUT /api/admin/products/[id]/bom");
}

async function main() {
  try {
    const handlers = await loadHandlers();
    await testUnauthenticatedReturns401(handlers.WRITE_CASES);
    await testItAdminReturns403(handlers.WRITE_CASES);
    await testLowPrivilegeReturns403(handlers.WRITE_CASES);
    await testAuthorizedRolesPassAuthBoundary(handlers.WRITE_CASES);
    await test410StubAuth(handlers);
    console.log("smoke-admin-api-http-permissions passed");
  } finally {
    clearStaffSessionOverrideForTests();
  }
}

main().catch((err) => {
  console.error(err);
  clearStaffSessionOverrideForTests();
  process.exit(1);
});
