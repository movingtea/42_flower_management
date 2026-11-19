"use client";

import { useId, useState, type ChangeEvent } from "react";
import {
  CMS_IMAGE_INVALID_LOAD_HINT,
  CMS_IMAGE_REUPLOAD_HINT,
  getClientPreviewImageUrl,
  isClientImageInvalid,
} from "@/lib/client-image-preview";
import type { V2UploadModule } from "@/v2/domain/media";
import { uploadV2Image } from "../_lib/image-upload";

const PLACEHOLDER_TEXT = "暂无图片";

function previewState(stored: string) {
  if (!stored.trim()) {
    return { kind: "empty" as const, url: null, text: PLACEHOLDER_TEXT };
  }
  if (isClientImageInvalid(stored)) {
    return { kind: "warn" as const, url: null, text: CMS_IMAGE_REUPLOAD_HINT };
  }
  const url = getClientPreviewImageUrl(stored);
  if (!url) {
    return { kind: "warn" as const, url: null, text: CMS_IMAGE_INVALID_LOAD_HINT };
  }
  return { kind: "image" as const, url, text: "" };
}

function ImagePlaceholder({
  text,
  warn,
  compact,
}: {
  text: string;
  warn?: boolean;
  compact?: boolean;
}) {
  return (
    <span
      className={`flex h-full w-full flex-col items-center justify-center gap-1 text-center ${
        compact ? "p-1 text-[10px]" : "p-3 text-xs"
      } ${warn ? "bg-amber-50 text-amber-700" : "bg-zinc-50 text-zinc-400"}`}
    >
      <span aria-hidden className={compact ? "text-sm" : "text-xl"}>
        {warn ? "!" : "▧"}
      </span>
      <span>{text}</span>
    </span>
  );
}

/** Read-only WMS thumbnail with empty / invalid / load-failure placeholders. */
export function V2ImagePreview({
  stored,
  alt,
  compact = false,
  className = "h-16 w-16",
}: {
  stored: string | null | undefined;
  alt: string;
  compact?: boolean;
  className?: string;
}) {
  const [loadFailed, setLoadFailed] = useState(false);
  const value = stored?.trim() ?? "";
  const state = previewState(value);

  return (
    <span
      className={`relative inline-flex overflow-hidden rounded-lg border border-zinc-200 ${className}`}
    >
      {state.kind === "image" && !loadFailed ? (
        // OSS public URLs are runtime-configurable, so a plain <img> avoids
        // hard-coding every possible remote host in next.config.ts.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={state.url}
          alt={alt}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setLoadFailed(true)}
        />
      ) : (
        <ImagePlaceholder
          text={loadFailed ? CMS_IMAGE_INVALID_LOAD_HINT : state.text}
          warn={state.kind === "warn" || loadFailed}
          compact={compact}
        />
      )}
    </span>
  );
}

/**
 * WMS image field: uploads through the V2 route, stores only the OSS objectKey
 * in a hidden input, and renders preview / empty / invalid / failed states.
 */
export function V2ImageField({
  name,
  module,
  initialValue,
  label = "图片",
  alt = "物料或商品图片",
  hint = "支持 JPG、PNG、WebP，单张不超过 3MB；保存的是 OSS objectKey。",
  compact = false,
}: {
  name: string;
  module: V2UploadModule;
  initialValue?: string | null;
  label?: string;
  alt?: string;
  hint?: string;
  compact?: boolean;
}) {
  const inputId = useId();
  const [value, setValue] = useState(initialValue?.trim() ?? "");
  const [loadFailed, setLoadFailed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const state = previewState(value);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setUploading(true);
    setError(null);
    setMessage(null);
    try {
      const uploaded = await uploadV2Image(file, module);
      setValue(uploaded.objectKey);
      setLoadFailed(false);
      setMessage("图片上传成功，保存后生效");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "上传失败，请稍后重试");
    } finally {
      setUploading(false);
    }
  }

  function clearImage() {
    setValue("");
    setLoadFailed(false);
    setError(null);
    setMessage("已移除图片，保存后生效");
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start gap-3">
        <span className="inline-flex h-24 w-24 overflow-hidden rounded-lg border border-zinc-200 bg-white">
          {state.kind === "image" && !loadFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={state.url}
              alt={alt}
              className="h-full w-full object-cover"
              onError={() => setLoadFailed(true)}
            />
          ) : (
            <ImagePlaceholder
              text={loadFailed ? CMS_IMAGE_INVALID_LOAD_HINT : state.text}
              warn={state.kind === "warn" || loadFailed}
              compact={compact}
            />
          )}
        </span>

        <div className="min-w-48 flex-1 space-y-2">
          <label htmlFor={inputId} className="block text-sm text-zinc-700">
            {label}
          </label>
          <input type="hidden" name={name} value={value} readOnly />
          <div className="flex flex-wrap items-center gap-2">
            <label
              htmlFor={inputId}
              className="inline-flex cursor-pointer items-center rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
            >
              {uploading ? "上传中…" : value ? "重新上传" : "选择图片"}
            </label>
            <input
              id={inputId}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              disabled={uploading}
              onChange={(event) => void handleFile(event)}
            />
            {value && (
              <button
                type="button"
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50"
                onClick={clearImage}
                disabled={uploading}
              >
                移除图片
              </button>
            )}
          </div>
          <p className="text-xs text-zinc-500">{hint}</p>
          {value && (
            <p className="break-all font-mono text-[11px] text-zinc-400">
              objectKey：{value}
            </p>
          )}
        </div>
      </div>

      {message && (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}
