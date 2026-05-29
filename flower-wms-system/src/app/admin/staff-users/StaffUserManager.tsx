"use client";

import { useCallback, useEffect, useState } from "react";
import { Role } from "@/generated/prisma/enums";
import { resetUserPassword } from "@/actions/staff-users";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ROLE_LABEL } from "@/lib/role-labels";

type StaffRow = {
  id: string;
  username: string;
  role: Role;
  displayName: string | null;
  isActive: boolean;
  createdAt: string;
};

type ToastState = {
  message: string;
  type: "success" | "error";
} | null;

type ResetModalState = {
  user: StaffRow;
  newPassword: string;
  confirmPassword: string;
} | null;

type StaffUserManagerProps = {
  canResetPassword: boolean;
};

export function StaffUserManager({ canResetPassword }: StaffUserManagerProps) {
  const [items, setItems] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>(Role.WAREHOUSE_MANAGER);
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [resetModal, setResetModal] = useState<ResetModalState>(null);

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 3200);
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/staff-users");
      const json = (await res.json()) as {
        success?: boolean;
        data?: { items?: StaffRow[] };
        error?: string;
      };
      if (!res.ok || !json.success) {
        showToast(json.error ?? "加载失败", "error");
        return;
      }
      setItems(json.data?.items ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/staff-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          role,
          displayName: displayName || undefined,
        }),
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !json.success) {
        showToast(json.error ?? "创建失败", "error");
        return;
      }
      setUsername("");
      setPassword("");
      setDisplayName("");
      await load();
      showToast("用户已创建", "success");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResetPassword() {
    if (!resetModal) return;
    if (resetModal.newPassword !== resetModal.confirmPassword) {
      showToast("两次输入的密码不一致", "error");
      return;
    }

    setResetting(true);
    try {
      const result = await resetUserPassword(
        resetModal.user.id,
        resetModal.newPassword
      );
      if (!result.success) {
        showToast(result.error, "error");
        return;
      }
      setResetModal(null);
      showToast(`已重置 ${resetModal.user.username} 的密码`, "success");
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="space-y-8">
      {toast && (
        <div
          role="status"
          className={`fixed bottom-6 right-6 z-50 rounded-lg px-4 py-3 text-sm shadow-lg ${
            toast.type === "success"
              ? "bg-emerald-600 text-white"
              : "bg-rose-600 text-white"
          }`}
        >
          {toast.message}
        </div>
      )}

      <form
        onSubmit={handleCreate}
        className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm"
      >
        <h2 className="text-sm font-semibold text-zinc-900">新建员工账号</h2>
        <Input
          label="用户名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        <Input
          label="初始密码"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <Input
          label="显示名"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-zinc-700">角色</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="min-h-[44px] w-full rounded-lg border border-zinc-200 px-3 py-2"
          >
            {Object.values(Role).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" disabled={submitting} className="min-h-[44px]">
          {submitting ? "提交中…" : "创建账号"}
        </Button>
      </form>

      <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
        <h2 className="border-b px-5 py-3 text-sm font-semibold text-zinc-900">
          账号列表
        </h2>
        {loading ? (
          <p className="p-5 text-sm text-zinc-500">加载中…</p>
        ) : items.length === 0 ? (
          <p className="p-5 text-sm text-zinc-500">暂无账号</p>
        ) : (
          <ul className="divide-y">
            {items.map((u) => (
              <li
                key={u.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm"
              >
                <div>
                  <p className="font-medium text-zinc-900">
                    {u.displayName ?? u.username}
                  </p>
                  <p className="text-zinc-500">
                    @{u.username} · {ROLE_LABEL[u.role]}
                    {!u.isActive && " · 已停用"}
                  </p>
                </div>
                {canResetPassword && (
                  <Button
                    type="button"
                    variant="secondary"
                    className="min-h-[40px] shrink-0"
                    onClick={() =>
                      setResetModal({
                        user: u,
                        newPassword: "",
                        confirmPassword: "",
                      })
                    }
                  >
                    重置密码
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {resetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-zinc-900">重置密码</h3>
            <p className="mt-1 text-sm text-zinc-500">
              为账号{" "}
              <span className="font-medium text-zinc-800">
                {resetModal.user.username}
              </span>{" "}
              （{ROLE_LABEL[resetModal.user.role]}）设置新密码。操作将写入审计日志。
            </p>
            <div className="mt-4 space-y-3">
              <Input
                label="新密码"
                type="password"
                value={resetModal.newPassword}
                onChange={(e) =>
                  setResetModal((m) =>
                    m ? { ...m, newPassword: e.target.value } : m
                  )
                }
                required
                autoComplete="new-password"
              />
              <Input
                label="确认新密码"
                type="password"
                value={resetModal.confirmPassword}
                onChange={(e) =>
                  setResetModal((m) =>
                    m ? { ...m, confirmPassword: e.target.value } : m
                  )
                }
                required
                autoComplete="new-password"
              />
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={resetting}
                onClick={() => setResetModal(null)}
              >
                取消
              </Button>
              <Button
                type="button"
                disabled={resetting}
                onClick={() => void handleResetPassword()}
              >
                {resetting ? "提交中…" : "确认重置"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
