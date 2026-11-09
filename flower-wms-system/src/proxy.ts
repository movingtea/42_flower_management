import { NextResponse } from "next/server";
import NextAuth from "next-auth";
import {
  authConfig,
  isV2Path,
  normalizeAuthSource,
  resolveLoginRedirect,
  V2_HOME_PATH,
} from "@/auth.config";
import { Role } from "@/generated/prisma/enums";
import {
  getRoleHomePath,
  isStaffProtectedAdminApi,
  isStaffProtectedApi,
  isStaffProtectedPath,
} from "@/lib/auth-routes";
import {
  canAccessBusinessData,
  isBusinessApiPath,
  isStaffAdminApiPath,
} from "@/lib/rbac";
import { canAccessWmsPath } from "@/lib/wms-nav";

const { auth } = NextAuth(authConfig);

function redirectToLogin(req: { nextUrl: URL }, pathname: string) {
  const login = new URL("/login", req.nextUrl);
  login.searchParams.set("callbackUrl", pathname);
  return NextResponse.redirect(login);
}

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const role = req.auth?.user?.role as Role | undefined;
  const isLoggedIn = !!req.auth?.user?.id && !!role;
  const source = normalizeAuthSource(req.auth?.user?.source);
  const isV2Source = isLoggedIn && source === "v2";

  // 默认入口固定切到 v2；旧后台通过显式 /wms、/cms、/admin 路由访问。
  if (pathname === "/") {
    return NextResponse.redirect(new URL(V2_HOME_PATH, req.nextUrl));
  }

  // 未带 callback 的 /login 默认 v2；显式 legacy callback 始终保留登录页，
  // 以便 v2/legacy 会话主动改用 legacy 凭据。
  if (pathname === "/login") {
    const decision = resolveLoginRedirect({
      isLoggedIn,
      source,
      callbackUrl: req.nextUrl.searchParams.get("callbackUrl"),
    });
    if (decision.kind === "redirect") {
      return NextResponse.redirect(
        new URL(decision.destination, req.nextUrl)
      );
    }
    return NextResponse.next();
  }

  // v2 工作台只接受带 v2 source 的会话；legacy 会话需重新用 v2 凭据登录。
  if (isV2Path(pathname)) {
    if (!isLoggedIn || !isV2Source) {
      return redirectToLogin(req, pathname);
    }
    if (req.auth?.user.v2BootstrapSession) {
      return NextResponse.redirect(new URL("/account/v2-password", req.nextUrl));
    }
    return NextResponse.next();
  }

  // v2 会话不得进入任何旧后台页面/API，即使 JWT 中携带了 legacy Role。
  if (isV2Source && isStaffProtectedPath(pathname)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { success: false, error: "v2 账号无权访问旧后台接口" },
        { status: 403 }
      );
    }
    return NextResponse.redirect(new URL(V2_HOME_PATH, req.nextUrl));
  }

  // 未登录：工作台、WMS/CMS/Admin 页面与后台 API 一律跳转登录
  if (!isLoggedIn) {
    if (!isStaffProtectedPath(pathname)) {
      return NextResponse.next();
    }
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { success: false, error: "未登录或会话已过期" },
        { status: 401 }
      );
    }
    return redirectToLogin(req, pathname);
  }

  // IT Admin：业务盲区（页面 + 业务 API）
  if (role === Role.IT_ADMIN) {
    if (isBusinessApiPath(pathname) || isStaffProtectedApi(pathname)) {
      if (pathname.startsWith("/api/") && !isStaffAdminApiPath(pathname)) {
        return NextResponse.json(
          { success: false, error: "IT 运维账号无权访问业务数据" },
          { status: 403 }
        );
      }
    }
    if (
      pathname.startsWith("/wms") ||
      pathname.startsWith("/cms") ||
      (isStaffProtectedAdminApi(pathname) && !isStaffAdminApiPath(pathname))
    ) {
      return NextResponse.redirect(new URL("/admin/staff-users", req.nextUrl));
    }
    return NextResponse.next();
  }

  if (!canAccessBusinessData(role!)) {
    return NextResponse.next();
  }

  // 前台运营：仅 CMS；配方 API 仅 GET
  if (role === Role.STORE_OPERATOR) {
    if (pathname.startsWith("/wms") || pathname.startsWith("/admin")) {
      return NextResponse.redirect(new URL("/cms/products", req.nextUrl));
    }
    const recipeReadOnly =
      req.method === "GET" &&
      (pathname === "/api/admin/wms/recipes" ||
        pathname.startsWith("/api/admin/wms/recipes/"));
    if (
      (pathname.startsWith("/api/admin/wms") && !recipeReadOnly) ||
      pathname.startsWith("/api/admin/wiki")
    ) {
      return NextResponse.json(
        { success: false, error: "前台运营无权操作大仓数据" },
        { status: 403 }
      );
    }
  }

  // WMS 页面：permission + 角色路径门控（与 sidebar 一致）
  if (
    pathname.startsWith("/wms") &&
    pathname !== "/wms" &&
    !canAccessWmsPath(role!, pathname)
  ) {
    return NextResponse.redirect(new URL(getRoleHomePath(role!), req.nextUrl));
  }

  // 花艺师：WMS 只读 GET API
  if (role === Role.FLORIST) {
    if (
      (pathname.startsWith("/api/admin/wms") ||
        pathname.startsWith("/api/admin/wiki")) &&
      req.method !== "GET"
    ) {
      return NextResponse.json(
        { success: false, error: "花艺师仅可只读查看配方与物料" },
        { status: 403 }
      );
    }
    if (pathname.startsWith("/cms")) {
      return NextResponse.redirect(new URL("/wms/orders", req.nextUrl));
    }
  }

  // 大仓经理：禁止 CMS
  if (role === Role.WAREHOUSE_MANAGER) {
    if (pathname.startsWith("/cms")) {
      return NextResponse.redirect(new URL("/wms/operations", req.nextUrl));
    }
    if (pathname.startsWith("/api/cms")) {
      return NextResponse.json(
        { success: false, error: "大仓角色无权操作 CMS" },
        { status: 403 }
      );
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/",
    "/login",
    "/v2",
    "/v2/:path*",
    "/wms/:path*",
    "/cms/:path*",
    "/admin/:path*",
    "/api/admin/:path*",
    "/api/cms/:path*",
    "/api/business/:path*",
  ],
};
