"use client";

import dynamic from "next/dynamic";

export const RichTextEditorLazy = dynamic(
  () =>
    import("@/components/cms/RichTextEditor").then((m) => ({
      default: m.RichTextEditor,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[480px] items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-sm text-zinc-500">
        编辑器加载中…
      </div>
    ),
  }
);
