"use client";

import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  resolveLoginCallbackUrl,
  resolveLoginSurface,
} from "@/auth.config";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawCallbackUrl = searchParams.get("callbackUrl");
  const callbackUrl = resolveLoginCallbackUrl(rawCallbackUrl);
  const v2Login = resolveLoginSurface(rawCallbackUrl) === "v2";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await signIn(
        v2Login ? "v2-credentials" : "credentials",
        {
          username,
          password,
          redirect: false,
        }
      );
      if (res?.error) {
        setError("用户名或密码错误");
        return;
      }
      router.push(callbackUrl);
      router.refresh();
    } catch {
      setError("登录失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-5 rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm"
      >
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">
            {v2Login ? "花店 2.0 登录" : "旧后台登录（legacy）"}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {v2Login
              ? "Flower Studio 2.0 业务工作台"
              : "花艺大仓 WMS / CMS 后台（显式 legacy 参考入口）"}
          </p>
        </div>

        <Input
          label="用户名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
        />
        <Input
          label="密码"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        <Button
          type="submit"
          disabled={loading}
          className="min-h-[44px] w-full"
        >
          {loading ? "登录中…" : "登录"}
        </Button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-50" />}>
      <LoginForm />
    </Suspense>
  );
}
