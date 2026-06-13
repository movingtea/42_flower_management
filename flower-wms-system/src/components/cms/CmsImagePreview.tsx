"use client";

import Image from "next/image";
import { useState } from "react";
import {
  CMS_IMAGE_INVALID_LOAD_HINT,
  CMS_IMAGE_REUPLOAD_HINT,
  getClientPreviewImageUrl,
  isClientImageInvalid,
} from "@/lib/client-image-preview";

type Props = {
  stored: string | null | undefined;
  alt: string;
  className?: string;
  fill?: boolean;
  sizes?: string;
  emptyHint?: string;
  /** 紧凑占位（表格缩略图） */
  compact?: boolean;
};

export function CmsImagePreview({
  stored,
  alt,
  className = "object-cover",
  fill = false,
  sizes,
  emptyHint = "暂无图片",
  compact = false,
}: Props) {
  const [loadFailed, setLoadFailed] = useState(false);

  const trimmed = stored?.trim() ?? "";
  const invalid = isClientImageInvalid(trimmed);
  const previewUrl = getClientPreviewImageUrl(trimmed);

  if (!trimmed) {
    return (
      <Placeholder compact={compact} text={emptyHint} tone="muted" />
    );
  }

  if (invalid) {
    return (
      <Placeholder compact={compact} text={CMS_IMAGE_REUPLOAD_HINT} tone="warn" />
    );
  }

  if (!previewUrl || loadFailed) {
    return (
      <Placeholder
        compact={compact}
        text={CMS_IMAGE_INVALID_LOAD_HINT}
        tone="warn"
      />
    );
  }

  return (
    <Image
      src={previewUrl}
      alt={alt}
      fill={fill}
      sizes={sizes}
      className={className}
      unoptimized
      onError={() => setLoadFailed(true)}
    />
  );
}

function Placeholder({
  text,
  tone,
  compact,
}: {
  text: string;
  tone: "muted" | "warn";
  compact?: boolean;
}) {
  return (
    <span
      className={`flex h-full w-full items-center justify-center text-center ${
        compact ? "p-1 text-[10px]" : "p-2 text-xs"
      } ${tone === "warn" ? "text-amber-700" : "text-zinc-400"}`}
    >
      {text}
    </span>
  );
}
