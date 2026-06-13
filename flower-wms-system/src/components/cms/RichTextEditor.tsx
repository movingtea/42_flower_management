"use client";

import "@wangeditor/editor/dist/css/style.css";
import type { IDomEditor, IEditorConfig } from "@wangeditor/editor";
import { Editor, Toolbar } from "@wangeditor/editor-for-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Props = {
  label: string;
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
};

import { uploadCmsImage } from "@/lib/cms-image-upload";

async function uploadImageFile(file: File): Promise<string> {
  const { previewUrl } = await uploadCmsImage(file, "cms");
  return previewUrl;
}

export function RichTextEditor({
  label,
  value,
  onChange,
  placeholder = "请输入内容",
  minHeight = 420,
}: Props) {
  const [editor, setEditor] = useState<IDomEditor | null>(null);
  const editorRef = useRef<IDomEditor | null>(null);

  const editorConfig: Partial<IEditorConfig> = useMemo(
    () => ({
      placeholder,
      MENU_CONF: {
        uploadImage: {
          maxFileSize: 3 * 1024 * 1024,
          allowedFileTypes: ["image/jpeg", "image/png", "image/webp"],
          async customUpload(
            file: File,
            insertFn: (url: string, alt: string, href: string) => void
          ) {
            try {
              const url = await uploadImageFile(file);
              insertFn(url, file.name, url);
            } catch (err) {
              const msg =
                err instanceof Error ? err.message : "图片上传失败";
              window.alert(msg);
            }
          },
        },
      },
    }),
    [placeholder]
  );

  const handleCreated = useCallback((instance: IDomEditor) => {
    editorRef.current = instance;
    setEditor(instance);
  }, []);

  useEffect(() => {
    return () => {
      if (editorRef.current) {
        editorRef.current.destroy();
        editorRef.current = null;
      }
    };
  }, []);

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-100 px-4 py-3">
        <span className="text-sm font-semibold text-zinc-900">{label}</span>
      </div>
      <div className="border-b border-zinc-100">
        <Toolbar
          editor={editor}
          defaultConfig={{}}
          mode="default"
          style={{ borderBottom: "1px solid #f4f4f5" }}
        />
      </div>
      <Editor
        defaultConfig={editorConfig}
        value={value}
        onCreated={handleCreated}
        onChange={(instance) => onChange(instance.getHtml())}
        mode="default"
        style={{ height: minHeight, overflowY: "hidden" }}
      />
    </div>
  );
}
