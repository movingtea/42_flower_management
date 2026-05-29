import { NextResponse } from "next/server";
import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";
import { Role } from "@/generated/prisma/enums";

const { auth } = NextAuth(authConfig);
import {
  getRoleHomePath,
  isStaffProtectedAdminApi,
  isStaffProtectedApi,
  isStaffProtectedPage,
  isStaffProtectedPath,
} from "@/lib/auth-routes";
import {
  canAccessBusinessData,
  isBusinessApiPath,
  isStaffAdminApiPath,
} from "@/lib/rbac";

function redirectToLogin(req: { nextUrl: URL }, pathname: string) {
  const login = new URL("/login", req.nextUrl);
  login.searchParams.set("callbackUrl", pathname);
  return NextResponse.redirect(login);
}

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const role = req.auth?.user?.role as Role | undefined;
  const isLoggedIn = !!req.auth?.user?.id && !!role;

  // 已登录访问登录页 → 角色首页
  if (pathname === "/login") {
    if (isLoggedIn) {
      return NextResponse.redirect(new URL(getRoleHomePath(role!), req.nextUrl));
    }
    return NextResponse.next();
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
      pathname === "/" ||
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

  // 门店主理人可访问工作台门户
  if (pathname === "/" && role === Role.STORE_ADMIN) {
    return NextResponse.next();
  }

  // 其他已登录角色访问 /：按角色落地（避免非主理人看到全量入口）
  if (pathname === "/" && role !== Role.STORE_ADMIN) {
    return NextResponse.redirect(new URL(getRoleHomePath(role!), req.nextUrl));
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

  // 花艺师：订单看板 + WMS 只读 GET
  if (role === Role.FLORIST) {
    if (
      isStaffProtectedPage(pathname) &&
      pathname.startsWith("/wms") &&
      !pathname.startsWith("/wms/orders")
    ) {
      return NextResponse.redirect(new URL("/wms/orders", req.nextUrl));
    }
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
    "/wms/:path*",
    "/cms/:path*",
    "/admin/:path*",
    "/api/admin/:path*",
    "/api/cms/:path*",
    "/api/business/:path*",
  ],
};
