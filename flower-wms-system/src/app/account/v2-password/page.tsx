import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { logEvent } from "@/lib/observability/logger";
import { fingerprintAccount } from "@/lib/observability/redact";
import { v2db } from "@/v2/db";
import {
  V2_BOOTSTRAP_PASSWORD_MIN_LENGTH,
  evaluateV2PasswordChange,
} from "@/v2/password-policy";
import {
  PASSWORD_CHANGE_AUDIT_ACTION,
  PASSWORD_CHANGE_AUDIT_ENTITY_TYPE,
  PASSWORD_CHANGE_INVALID_REDIRECT,
  buildPasswordChangeAuditSnapshots,
  resolvePasswordChangeAuditScope,
  type PasswordAuditStoreMember,
  type PasswordAuditTenantMember,
} from "./audit";

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

/**
 * Best-effort security audit for the completed password change.
 *
 * `AuditEvent.tenantId` is mandatory and bootstrap sessions carry no tenant in
 * the JWT, so the tenant/store is resolved from the persisted memberships. A
 * missing membership or a failed write must not undo a completed password
 * change (see E3.5 plan §4.5 risk note); the failure is still visible in the
 * server log. The snapshots only contain account state - never a hash or the
 * plaintext password.
 */
async function writePasswordChangedAudit(staff: {
  id: string;
  username: string;
  active: boolean;
  mustChangePassword: boolean;
}) {
  try {
    const [tenantMembers, storeMembers] = await Promise.all([
      v2db.tenantMember.findMany({
        where: { staffUserId: staff.id, active: true },
        select: { tenantId: true, active: true },
      }),
      v2db.storeMember.findMany({
        where: { staffUserId: staff.id, active: true },
        select: { storeId: true, active: true, store: { select: { tenantId: true } } },
      }),
    ]);
    const scope = resolvePasswordChangeAuditScope({
      tenantMembers: tenantMembers as PasswordAuditTenantMember[],
      storeMembers: storeMembers as PasswordAuditStoreMember[],
    });
    if (!scope) {
      logEvent({
        level: "warn",
        event: "auth.password.changed",
        fields: {
          outcome: "failure",
          staffFingerprint: fingerprintAccount(staff.username),
          reason: "audit_scope_missing",
        },
      });
      return;
    }
    const { beforeSnapshot, afterSnapshot } = buildPasswordChangeAuditSnapshots(staff);
    await v2db.auditEvent.create({
      data: {
        tenantId: scope.tenantId,
        storeId: scope.storeId,
        actorStaffId: staff.id,
        action: PASSWORD_CHANGE_AUDIT_ACTION,
        entityType: PASSWORD_CHANGE_AUDIT_ENTITY_TYPE,
        entityId: staff.id,
        beforeSnapshot,
        afterSnapshot,
      },
    });
  } catch {
    // Do not pass the database error to the logger: it can carry connection
    // details. The password change itself is already committed and must not be
    // blocked by an audit failure.
    logEvent({
      level: "error",
      event: "auth.password.changed",
      fields: {
        outcome: "failure",
        staffFingerprint: fingerprintAccount(staff.username),
        reason: "audit_write_failed",
      },
    });
  }
}

async function changePassword(form: FormData) {
  "use server";

  const staff = await pendingStaff();
  if (!staff) {
    await signOut({ redirectTo: "/login?callbackUrl=/v2" });
    return;
  }
  const decision = await evaluateV2PasswordChange({
    current: form.get("current"),
    next: form.get("next"),
    confirm: form.get("confirm"),
    username: staff.username,
    currentPasswordHash: staff.passwordHash,
    compare: bcrypt.compare,
  });
  if (!decision.allowed) {
    // One generic result for every failure: never reveal which check failed or
    // whether the account still exists / is active.
    logEvent({
      level: "warn",
      event: "auth.password.changed",
      fields: {
        outcome: "failure",
        staffFingerprint: fingerprintAccount(staff.username),
        reason: decision.reason,
      },
    });
    redirect(PASSWORD_CHANGE_INVALID_REDIRECT);
  }

  const updated = await v2db.staffUser.updateMany({
    where: {
      id: staff.id,
      active: true,
      mustChangePassword: true,
      passwordHash: staff.passwordHash,
    },
    data: {
      passwordHash: await bcrypt.hash(decision.nextPassword, 12),
      mustChangePassword: false,
    },
  });
  if (updated.count === 0) {
    // Lost a race with another device or the state changed after the session
    // was issued. Drop the stale session instead of reporting account state.
    logEvent({
      level: "warn",
      event: "auth.password.changed",
      fields: {
        outcome: "failure",
        staffFingerprint: fingerprintAccount(staff.username),
        reason: "state_conflict",
      },
    });
    await signOut({ redirectTo: "/login?callbackUrl=/v2" });
    return;
  }

  await writePasswordChangedAudit(staff);
  logEvent({
    level: "info",
    event: "auth.password.changed",
    fields: {
      outcome: "success",
      staffFingerprint: fingerprintAccount(staff.username),
    },
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
      <p className="mb-4">请使用至少 {V2_BOOTSTRAP_PASSWORD_MIN_LENGTH} 个字符且不含用户名的新密码。</p>
      {invalid && <p role="alert" className="mb-4 text-red-700">请核对当前密码、密码强度和两次输入的新密码。</p>}
      <form action={changePassword} className="grid gap-4">
        <label>当前密码 <input className="block w-full rounded border p-2" type="password" name="current" autoComplete="current-password" required /></label>
        <label>新密码 <input className="block w-full rounded border p-2" type="password" name="next" autoComplete="new-password" minLength={V2_BOOTSTRAP_PASSWORD_MIN_LENGTH} required /></label>
        <label>确认新密码 <input className="block w-full rounded border p-2" type="password" name="confirm" autoComplete="new-password" minLength={V2_BOOTSTRAP_PASSWORD_MIN_LENGTH} required /></label>
        <button className="rounded bg-emerald-700 p-2 text-white" type="submit">保存新密码</button>
      </form>
    </main>
  );
}
