"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { deferEffectTask } from "@/lib/defer-effect";
import type { WikiListItem } from "@/lib/wiki-constants";

export type FlowerMaterialSelectProps = {
  value?: string | null;
  onChange: (item: WikiListItem | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

export function FlowerMaterialSelect({
  value,
  onChange,
  placeholder = "输入简拼 / 中文 / 拉丁名搜索…",
  disabled = false,
  className = "",
}: FlowerMaterialSelectProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<WikiListItem[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [selected, setSelected] = useState<WikiListItem | null>(null);

  const fetchItems = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ pageSize: "30" });
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`/api/admin/wiki?${params.toString()}`);
      const json = (await res.json()) as {
        success?: boolean;
        data?: { items?: WikiListItem[] };
      };
      if (res.ok && json.success && json.data?.items) {
        setItems(json.data.items);
        setHighlight(0);
      } else {
        setItems([]);
      }
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    deferEffectTask(() => {
      if (cancelled) return;
      if (!value) {
        setSelected(null);
        return;
      }
      if (selected?.id === value) return;

      void (async () => {
        try {
          const res = await fetch(`/api/admin/wiki/${value}`);
          const json = (await res.json()) as {
            success?: boolean;
            data?: { item?: WikiListItem };
          };
          if (cancelled) return;
          if (res.ok && json.success && json.data?.item) {
            setSelected(json.data.item);
            setQuery(json.data.item.chineseName);
          }
        } catch {
          /* ignore */
        }
      })();
    });

    return () => {
      cancelled = true;
    };
  }, [value, selected?.id]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      void fetchItems(query);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query, open, fetchItems]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function pick(item: WikiListItem) {
    setSelected(item);
    setQuery(item.chineseName);
    setOpen(false);
    onChange(item);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(items.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && items[highlight]) {
      e.preventDefault();
      pick(items[highlight]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        value={query}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (!e.target.value.trim()) {
            setSelected(null);
            onChange(null);
          }
        }}
        onKeyDown={onKeyDown}
        className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-rose-400 focus:ring-1 focus:ring-rose-400 disabled:bg-zinc-50"
      />
      {selected && (
        <p className="mt-1 text-xs text-zinc-500">
          已选：{selected.chineseName} · {selected.englishName}
          {selected.pinyinIndex ? ` · ${selected.pinyinIndex}` : ""}
        </p>
      )}
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-lg"
        >
          {loading && (
            <li className="px-3 py-2 text-sm text-zinc-400">搜索中…</li>
          )}
          {!loading && items.length === 0 && (
            <li className="px-3 py-2 text-sm text-zinc-400">无匹配花材</li>
          )}
          {!loading &&
            items.map((item, index) => (
              <li key={item.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={highlight === index}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => pick(item)}
                  className={`flex w-full flex-col px-3 py-2 text-left text-sm ${
                    highlight === index
                      ? "bg-rose-50 text-rose-900"
                      : "text-zinc-800 hover:bg-zinc-50"
                  }`}
                >
                  <span className="font-medium">{item.chineseName}</span>
                  <span className="text-xs text-zinc-500">
                    {item.englishName}
                    {item.pinyinIndex ? ` · ${item.pinyinIndex}` : ""}
                    {item.color ? ` · ${item.color}` : ""}
                  </span>
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}