"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { formatNullableDateTime } from "@/lib/datetime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/Switch";
import {
  GLOBAL_NOTICE_KEY,
  GLOBAL_NOTICE_NAME,
  HOME_POPUP_KEY,
  HOME_POPUP_NAME,
  type GlobalNoticeConfig,
  type HomePopupConfig,
} from "@/lib/app-marketing";

type Props = {
  initialNotice: GlobalNoticeConfig;
  initialPopup: HomePopupConfig;
  noticeUpdatedAt: string | null;
  popupUpdatedAt: string | null;
};

export function MarketingSettings({
  initialNotice,
  initialPopup,
  noticeUpdatedAt: initialNoticeUpdatedAt,
  popupUpdatedAt: initialPopupUpdatedAt,
}: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [notice, setNotice] = useState(initialNotice);
  const [popup, setPopup] = useState(initialPopup);
  const [noticeUpdatedAt, setNoticeUpdatedAt] = useState(initialNoticeUpdatedAt);
  const [popupUpdatedAt, setPopupUpdatedAt] = useState(initialPopupUpdatedAt);

  const [savingNotice, setSavingNotice] = useState(false);
  const [savingPopup, setSavingPopup] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 2800);
  }

  async function saveConfig(
    key: string,
    name: string,
    value: GlobalNoticeConfig | HomePopupConfig
  ) {
    const res = await fetch("/api/admin/app-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, name, value }),
    });

    const json = (await res.json()) as {
      success: boolean;
      error?: string;
      data?: {
        message?: string;
        value?: GlobalNoticeConfig | HomePopupConfig;
        updatedAt?: string;
      };
    };

    if (!res.ok || !json.success) {
      throw new Error(json.error ?? "保存失败");
    }

    return json.data;
  }

  async function handleSaveNotice() {
    setSavingNotice(true);
    try {
      const data = await saveConfig(GLOBAL_NOTICE_KEY, GLOBAL_NOTICE_NAME, notice);
      if (data?.value && typeof data.value === "object") {
        setNotice(data.value as GlobalNoticeConfig);
      }
      if (data?.updatedAt) setNoticeUpdatedAt(data.updatedAt);
      showToast(data?.message ?? "公告已保存", "success");
      router.refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "保存失败", "error");
    } finally {
      setSavingNotice(false);
    }
  }

  async function handlePublishPopup() {
    setSavingPopup(true);
    try {
      const data = await saveConfig(HOME_POPUP_KEY, HOME_POPUP_NAME, popup);
      if (data?.value && typeof data.value === "object") {
        setPopup(data.value as HomePopupConfig);
      }
      if (data?.updatedAt) setPopupUpdatedAt(data.updatedAt);
      showToast(data?.message ?? "弹窗已发布", "success");
      router.refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "发布失败", "error");
    } finally {
      setSavingPopup(false);
    }
  }

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
      const json = (await res.json()) as {
        success: boolean;
        error?: string;
        data?: { url?: string };
      };
      if (!res.ok || !json.success || !json.data?.url) {
        showToast(json.error ?? "上传失败", "error");
        return;
      }
      setPopup((p) => ({ ...p, imageUrl: json.data!.url! }));
      showToast("海报上传成功", "success");
    } catch {
      showToast("上传失败，请重试", "error");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="relative">
      {toast && (
        <div
          role="status"
          className={`fixed right-6 top-6 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${
            toast.type === "success"
              ? "bg-emerald-600 text-white"
              : "bg-red-600 text-white"
          }`}
        >
          {toast.message}
        </div>
      )}

      <header className="mb-8">
        <h2 className="text-2xl font-semibold text-rose-900">营销配置</h2>
        <p className="mt-1 text-sm text-zinc-500">
          全局公告栏与首页活动弹窗，保存后由小程序首页超级接口统一拉取
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-2">
        <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-zinc-900">全局通知公告栏</h3>
          <p className="mt-1 text-sm text-zinc-500">
            控制小程序顶部走马灯（{GLOBAL_NOTICE_KEY}）
          </p>
          {noticeUpdatedAt && (
            <p className="mt-1 text-xs text-zinc-400">
              上次保存：{formatNullableDateTime(noticeUpdatedAt)}
            </p>
          )}

          <div className="mt-6 space-y-5">
            <Switch
              checked={notice.enabled}
              onChange={(enabled) => setNotice((n) => ({ ...n, enabled }))}
              disabled={savingNotice}
              label="开启公告"
            />

            <label className="block text-sm">
              <span className="mb-1 block font-medium text-zinc-700">
                公告文本
              </span>
              <textarea
                rows={4}
                value={notice.text}
                onChange={(e) =>
                  setNotice((n) => ({ ...n, text: e.target.value }))
                }
                disabled={savingNotice}
                placeholder="由于母亲节期间昆明斗南花价暴涨，部分花束价格略有调整，敬请谅解。"
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm disabled:bg-zinc-50"
              />
            </label>

            <Button
              type="button"
              onClick={handleSaveNotice}
              disabled={savingNotice}
            >
              {savingNotice ? "保存中…" : "保存公告"}
            </Button>
          </div>
        </section>

        <section className="rounded-xl border border-rose-100 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-rose-900">首页活动大弹窗</h3>
          <p className="mt-1 text-sm text-zinc-500">
            顾客当天首次进入小程序时展示（{HOME_POPUP_KEY}）
          </p>
          {popupUpdatedAt && (
            <p className="mt-1 text-xs text-zinc-400">
              上次发布：{formatNullableDateTime(popupUpdatedAt)}
            </p>
          )}

          <div className="mt-6 space-y-5">
            <Switch
              checked={popup.enabled}
              onChange={(enabled) => setPopup((p) => ({ ...p, enabled }))}
              disabled={savingPopup || uploading}
              label="开启弹窗"
            />

            <div>
              <span className="mb-2 block text-sm font-medium text-zinc-700">
                活动海报
              </span>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleUpload(file);
                  e.target.value = "";
                }}
              />
              {popup.imageUrl ? (
                <div>
                  <div className="relative mb-2 h-44 w-full overflow-hidden rounded-xl border border-rose-100">
                    <Image
                      src={popup.imageUrl}
                      alt="弹窗海报"
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={uploading || savingPopup}
                    onClick={() => fileRef.current?.click()}
                  >
                    {uploading ? "上传中…" : "更换海报"}
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={uploading || savingPopup}
                  onClick={() => fileRef.current?.click()}
                  className="flex h-36 w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-rose-200 bg-rose-50/30 text-sm text-rose-700 hover:border-rose-300"
                >
                  {uploading ? "上传中…" : "点击上传活动海报"}
                </button>
              )}
            </div>

            <Input
              label="跳转商品 ID（可选）"
              value={popup.linkProductId}
              onChange={(e) =>
                setPopup((p) => ({ ...p, linkProductId: e.target.value }))
              }
              disabled={savingPopup}
              placeholder="成品 Product 的 cuid，留空则不跳转商品"
            />

            <Button
              type="button"
              onClick={handlePublishPopup}
              disabled={savingPopup || uploading}
            >
              {savingPopup ? "发布中…" : "发布弹窗"}
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
