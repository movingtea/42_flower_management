import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { StaffAppShell } from "@/components/shared/StaffAppShell";
import { V2Topbar } from "@/components/v2/V2Topbar";
import { V2Sidebar } from "@/components/v2/sidebar";
import { requireV2Context, V2PasswordChangeRequired, type V2AccessContext } from "@/v2/auth";

export const metadata = {
  title: "Flower Studio 2.0 · 花店经营管理",
  description: "面向花店的采购、库存、商品配方与订单履约系统",
};

function denialMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message) return cause.message;
  return "当前账号暂时无法访问 V2 工作台";
}

export default async function V2Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user || session.user.source !== "v2") {
    redirect("/login?callbackUrl=/v2");
  }

  let context: V2AccessContext | null = null;
  let denial = "";
  try {
    // The shell revalidates active staff/tenant/store membership on every
    // authenticated V2 request, even for pages that only read business data.
    context = await requireV2Context("read");
  } catch (cause) {
    if (cause instanceof V2PasswordChangeRequired) redirect("/account/v2-password");
    denial = denialMessage(cause);
  }

  if (!context) {
    return (
      <StaffAppShell
        variant="wms"
        sidebar={
          <V2Sidebar
            roles={[]}
            displayName={session.user.name ?? null}
            username={session.user.username ?? "当前账号"}
          />
        }
        topbar={<V2Topbar />}
        showFooter
      >
        <section className="mx-auto max-w-xl rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-950 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-rose-700">
            Flower Studio 2.0
          </p>
          <h1 className="mt-2 text-2xl font-semibold">无法访问 V2 工作台</h1>
          <p className="mt-3 text-sm leading-6">{denial}</p>
          <p className="mt-2 text-sm leading-6">
            请确认当前账号和门店成员身份仍处于启用状态，或联系门店管理员。
          </p>
        </section>
      </StaffAppShell>
    );
  }

  return (
    <StaffAppShell
      variant="wms"
      sidebar={
        <V2Sidebar
          roles={context.roles}
          displayName={context.displayName}
          username={context.username}
        />
      }
      topbar={<V2Topbar />}
      shellClassName="bg-[#f7f7f2]"
      mainClassName="min-h-full p-0"
      showFooter
    >
      {children}
    </StaffAppShell>
  );
}
