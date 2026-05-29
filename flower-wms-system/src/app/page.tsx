import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { PortalAccountStrip } from "@/components/shared/PortalAccountStrip";
import { Role } from "@/generated/prisma/enums";
import { getRoleHomePath } from "@/lib/auth-routes";

function WmsIcon() {
  return (
    <svg
      className="h-12 w-12 text-zinc-600"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.25}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
      />
    </svg>
  );
}

function CmsIcon() {
  return (
    <svg
      className="h-12 w-12 text-rose-500"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.25}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
      />
    </svg>
  );
}

export default async function PortalPage() {
  const session = await auth();
  if (!session?.user?.role) {
    redirect("/login");
  }

  const role = session.user.role as Role;
  if (role !== Role.STORE_ADMIN) {
    redirect(getRoleHomePath(role));
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-stone-100 via-zinc-50 to-stone-200 px-6 py-16">
      <PortalAccountStrip />
      <main className="w-full max-w-5xl text-center">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-400">
          Flower Studio
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-zinc-800 sm:text-5xl">
          花艺工作室 · 数字化工作台
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-zinc-500">
          仓储与运营分离：左侧进入 WMS 处理入库与履约，右侧进入 CMS 配置小程序内容与营销。
        </p>

        <div className="mt-14 grid gap-8 sm:grid-cols-2">
          <Link
            href="/wms/dashboard"
            className="group relative flex flex-col rounded-2xl border border-zinc-200/80 bg-white/90 p-8 text-left shadow-sm backdrop-blur-sm transition-all duration-300 ease-out hover:scale-[1.03] hover:border-zinc-300 hover:shadow-xl"
          >
            <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-100 transition-colors group-hover:bg-zinc-200/80">
              <WmsIcon />
            </div>
            <h2 className="text-xl font-semibold text-zinc-800">
              WMS 仓储物流与履约系统
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-zinc-500">
              采购入库、物理库存与 FIFO 批次、损耗核销、小程序订单制作与配送履约。
            </p>
            <span className="mt-8 inline-flex items-center text-sm font-medium text-zinc-600 transition-colors group-hover:text-zinc-900">
              进入仓储系统
              <span className="ml-2 transition-transform group-hover:translate-x-1">
                →
              </span>
            </span>
          </Link>

          <Link
            href="/cms/products"
            className="group relative flex flex-col rounded-2xl border border-rose-100/90 bg-white/90 p-8 text-left shadow-sm backdrop-blur-sm transition-all duration-300 ease-out hover:scale-[1.03] hover:border-rose-200 hover:shadow-xl"
          >
            <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-50 transition-colors group-hover:bg-rose-100/80">
              <CmsIcon />
            </div>
            <h2 className="text-xl font-semibold text-rose-900">
              CMS 小程序运营内容系统
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-zinc-500">
              成品花束上架与图文、售价与库存展示、首页轮播图与营销活动配置。
            </p>
            <span className="mt-8 inline-flex items-center text-sm font-medium text-rose-600 transition-colors group-hover:text-rose-800">
              进入运营系统
              <span className="ml-2 transition-transform group-hover:translate-x-1">
                →
              </span>
            </span>
          </Link>
        </div>
      </main>
    </div>
  );
}
