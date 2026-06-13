"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/NumberInput";
import { Switch } from "@/components/ui/Switch";
import type { StoreDeliverySettings } from "@/lib/store-delivery-settings";

type Props = {
  onSaved?: () => void;
};

const EMPTY_FORM: StoreDeliverySettings = {
  sameDayEnabled: true,
  sameDayCutoffTime: "17:00",
  deliveryStartTime: "10:00",
  deliveryEndTime: "20:00",
  preorderEnabled: true,
  disabledDates: [],
  dailyOrderLimit: null,
};

export function DeliverySettingsPanel({ onSaved }: Props) {
  const [form, setForm] = useState<StoreDeliverySettings>(EMPTY_FORM);
  const [disabledDatesText, setDisabledDatesText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3200);
  };

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/cms/delivery-settings");
      const json = (await res.json()) as {
        success?: boolean;
        error?: string;
        data?: { settings?: StoreDeliverySettings };
      };
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "加载配送设置失败");
      }
      const settings = json.data?.settings ?? EMPTY_FORM;
      setForm(settings);
      setDisabledDatesText((settings.disabledDates ?? []).join("\n"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  async function handleSave() {
    const disabledDates = disabledDatesText
      .split(/[\n,，\s]+/)
      .map((d) => d.trim())
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));

    const payload: StoreDeliverySettings = {
      ...form,
      disabledDates,
      dailyOrderLimit:
        form.dailyOrderLimit != null && form.dailyOrderLimit > 0
          ? Math.round(form.dailyOrderLimit)
          : null,
    };

    setSaving(true);
    try {
      const res = await fetch("/api/admin/cms/delivery-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as {
        success?: boolean;
        error?: string;
        data?: { settings?: StoreDeliverySettings };
      };
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "保存失败");
      }
      if (json.data?.settings) {
        setForm(json.data.settings);
        setDisabledDatesText((json.data.settings.disabledDates ?? []).join("\n"));
      }
      showToast("配送设置已保存");
      onSaved?.();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-zinc-500">正在加载配送设置…</p>;
  }

  return (
    <div className="space-y-6">
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
          <Button
            type="button"
            variant="secondary"
            className="mt-3"
            onClick={() => void loadSettings()}
          >
            重试
          </Button>
        </div>
      ) : null}

      <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-rose-900">店铺配送设置</h3>
        <p className="mt-1 text-sm text-zinc-500">
          配置小程序下单可选配送日期与时段；保存后 orders/create 将读取此配置强校验。
        </p>

        <div className="mt-6 space-y-5">
          <div className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2">
            <div>
              <span className="text-sm font-medium text-zinc-700">开启当天配送</span>
              <p className="text-xs text-zinc-500">关闭后顾客不能选择今天送达</p>
            </div>
            <Switch
              checked={form.sameDayEnabled}
              onChange={(checked) =>
                setForm((f) => ({ ...f, sameDayEnabled: checked }))
              }
            />
          </div>

          <Input
            label="当天配送截单时间"
            value={form.sameDayCutoffTime}
            onChange={(e) =>
              setForm((f) => ({ ...f, sameDayCutoffTime: e.target.value }))
            }
            placeholder="17:00"
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="可选配送开始时间"
              value={form.deliveryStartTime}
              onChange={(e) =>
                setForm((f) => ({ ...f, deliveryStartTime: e.target.value }))
              }
              placeholder="10:00"
            />
            <Input
              label="可选配送结束时间"
              value={form.deliveryEndTime}
              onChange={(e) =>
                setForm((f) => ({ ...f, deliveryEndTime: e.target.value }))
              }
              placeholder="20:00"
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2">
            <div>
              <span className="text-sm font-medium text-zinc-700">开启预约配送</span>
              <p className="text-xs text-zinc-500">关闭后仅支持当天配送规则</p>
            </div>
            <Switch
              checked={form.preorderEnabled}
              onChange={(checked) =>
                setForm((f) => ({ ...f, preorderEnabled: checked }))
              }
            />
          </div>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-zinc-700">
              不支持配送日期（每行一个 YYYY-MM-DD）
            </span>
            <textarea
              className="min-h-[88px] w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
              value={disabledDatesText}
              onChange={(e) => setDisabledDatesText(e.target.value)}
              placeholder="2026-02-14"
            />
          </label>

          <NumberInput
            label="每日可承接订单数量上限（可选）"
            integerOnly
            min={1}
            allowEmpty
            value={form.dailyOrderLimit}
            onChange={(dailyOrderLimit) =>
              setForm((f) => ({ ...f, dailyOrderLimit }))
            }
            placeholder="留空表示不限制"
          />
          <p className="-mt-3 text-xs text-amber-700">
            第一版仅保存配置并提示，暂不在下单时自动拒单。
          </p>
        </div>

        <div className="mt-6 flex justify-end">
          <Button type="button" onClick={() => void handleSave()} disabled={saving}>
            {saving ? "保存中…" : "保存配送设置"}
          </Button>
        </div>
      </div>

      {toast ? (
        <div className="fixed bottom-6 right-6 z-50 rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
