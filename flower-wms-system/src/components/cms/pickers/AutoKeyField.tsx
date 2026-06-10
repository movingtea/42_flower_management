"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { validateCmsKey } from "@/lib/cms-auto-key";

type Props = {
  value: string;
  onChange: (key: string) => void;
  autoValue: string;
  label?: string;
  readOnlyByDefault?: boolean;
  existingKeys?: string[];
  excludeKey?: string | null;
  disabled?: boolean;
};

export function AutoKeyField({
  value,
  onChange,
  autoValue,
  label = "标识 key",
  readOnlyByDefault = true,
  existingKeys = [],
  excludeKey,
  disabled,
}: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [manualEdit, setManualEdit] = useState(false);

  useEffect(() => {
    if (!manualEdit && !advancedOpen && autoValue && value !== autoValue) {
      onChange(autoValue);
    }
  }, [autoValue, manualEdit, advancedOpen, onChange, value]);

  const formatError = validateCmsKey(value);
  const duplicateError =
    value.trim() &&
    existingKeys.some(
      (k) => k === value.trim() && k !== (excludeKey?.trim() ?? "")
    )
      ? "该 key 已被使用，请更换。"
      : null;

  const showReadOnly = readOnlyByDefault && !advancedOpen;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-zinc-700">{label}</span>
        <button
          type="button"
          className="text-xs text-rose-600 hover:underline"
          onClick={() => setAdvancedOpen((o) => !o)}
        >
          {advancedOpen ? "收起高级设置" : "高级设置"}
        </button>
      </div>

      {showReadOnly ? (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600">
          <span className="font-mono">{value || autoValue || "—"}</span>
          <p className="mt-1 text-xs text-zinc-400">系统自动生成 key</p>
        </div>
      ) : (
        <Input
          label="手动编辑 key"
          value={value}
          onChange={(e) => {
            setManualEdit(true);
            onChange(e.target.value);
          }}
          disabled={disabled}
          placeholder="小写字母、数字、下划线、短横线"
        />
      )}

      {advancedOpen && !showReadOnly && formatError ? (
        <p className="text-xs text-red-600">{formatError}</p>
      ) : null}
      {advancedOpen && duplicateError ? (
        <p className="text-xs text-red-600">{duplicateError}</p>
      ) : null}
    </div>
  );
}
