"use client";

import { useRef, useState } from "react";
import { prepareImageForUpload } from "@/utils/image-pipeline";

type Props = {
  label: string;
  capture?: boolean;
  onReady: (payload: {
    blob: Blob;
    base64: string;
    mimeType: string;
    dataUrl: string;
  }) => void | Promise<void>;
  disabled?: boolean;
  className?: string;
};

export function ImageUploadZone({
  label,
  capture = false,
  onReady,
  disabled,
  className = "",
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  async function processFile(file: File) {
    setBusy(true);
    try {
      const prepared = await prepareImageForUpload(file);
      await onReady(prepared);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className={className}>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        capture={capture ? "environment" : undefined}
        className="hidden"
        disabled={disabled || busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void processFile(file);
        }}
      />
      <div
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onClick={() => !disabled && !busy && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file?.type.startsWith("image/")) void processFile(file);
        }}
        className={`cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
          dragOver
            ? "border-rose-400 bg-rose-50"
            : "border-zinc-300 bg-zinc-50/80 hover:border-rose-300"
        } ${disabled || busy ? "pointer-events-none opacity-60" : ""}`}
      >
        <p className="text-sm font-medium text-zinc-800">
          {busy ? "处理图片中…" : label}
        </p>
        <p className="mt-1 hidden text-xs text-zinc-500 md:block">
          支持拖拽上传 · 自动压缩至 1100px
        </p>
        <p className="mt-1 text-xs text-zinc-500 md:hidden">点击拍照或选图</p>
      </div>
    </div>
  );
}
