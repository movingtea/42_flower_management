import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { v2db } from "@/v2/db";
import { isStrongV2Password } from "@/v2/password-policy";

async function pendingStaff() {
  const session = await auth();
  if (session?.user.source !== "v2" || !session.user.id) {
    redirect("/login?callbackUrl=/v2");
  }
  const staff = await v2db.staffUser.findUnique({ where: { id: session.user.id } });
  if (!staff?.active) return null;
  if (staff.mustChangePassword) return staff;
  if (!session.user.v2BootstrapSession) redirect("/v2");
  return null;
}

async function signInAgain() {
  "use server";
  await signOut({ redirectTo: "/login?callbackUrl=/v2" });
}

async function changePassword(form: FormData) {
  "use server";

  const staff = await pendingStaff();
  if (!staff) {
    await signOut({ redirectTo: "/login?callbackUrl=/v2" });
    return;
  }
  const current = form.get("current");
  const next = form.get("next");
  if (typeof current !== "string" || typeof next !== "string" ||
      next !== form.get("confirm") ||
      !isStrongV2Password(next, staff.username) ||
      !(await bcrypt.compare(current, staff.passwordHash)) ||
      await bcrypt.compare(next, staff.passwordHash)) {
    redirect("/account/v2-password?invalid=1");
  }

  await v2db.staffUser.updateMany({
    where: { id: staff.id, active: true, mustChangePassword: true, passwordHash: staff.passwordHash },
    data: { passwordHash: await bcrypt.hash(next, 12), mustChangePassword: false },
  });
  await signOut({ redirectTo: "/login?callbackUrl=/v2" });
}

export default async function InitialPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ invalid?: string }>;
}) {
  const staff = await pendingStaff();
  if (!staff) {
    return (
      <form action={signInAgain} className="mx-auto max-w-md p-6">
        <p>请重新登录以继续访问工作台。</p>
        <button type="submit" className="mt-4 rounded bg-emerald-700 p-2 text-white">重新登录</button>
      </form>
    );
  }
  const { invalid } = await searchParams;
  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="mb-4 text-xl font-semibold">修改初始密码</h1>
      <p className="mb-4">请使用至少 16 个字符且不含用户名的新密码。</p>
      {invalid && <p role="alert" className="mb-4 text-red-700">请核对当前密码、密码强度和两次输入的新密码。</p>}
      <form action={changePassword} className="grid gap-4">
        <label>当前密码 <input className="block w-full rounded border p-2" type="password" name="current" autoComplete="current-password" required /></label>
        <label>新密码 <input className="block w-full rounded border p-2" type="password" name="next" autoComplete="new-password" minLength={16} required /></label>
        <label>确认新密码 <input className="block w-full rounded border p-2" type="password" name="confirm" autoComplete="new-password" minLength={16} required /></label>
        <button className="rounded bg-emerald-700 p-2 text-white" type="submit">保存新密码</button>
      </form>
    </main>
  );
}
