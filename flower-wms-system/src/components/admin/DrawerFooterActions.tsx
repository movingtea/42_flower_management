"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  onCancel: () => void;
  onConfirm?: () => void;
  cancelLabel?: string;
  confirmLabel?: string;
  confirmLoading?: boolean;
  confirmDisabled?: boolean;
  dangerAction?: ReactNode;
  hideConfirm?: boolean;
};

export function DrawerFooterActions({
  onCancel,
  onConfirm,
  cancelLabel = "取消",
  confirmLabel = "保存",
  confirmLoading = false,
  confirmDisabled = false,
  dangerAction,
  hideConfirm = false,
}: Props) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">{dangerAction ?? null}</div>
      <div className="flex shrink-0 items-center gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {cancelLabel}
        </Button>
        {!hideConfirm && onConfirm ? (
          <Button
            type="button"
            onClick={onConfirm}
            disabled={confirmLoading || confirmDisabled}
          >
            {confirmLoading ? "保存中…" : confirmLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
