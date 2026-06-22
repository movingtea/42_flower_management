"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { deferEffectTask } from "@/lib/defer-effect";
import { formatMasterPartOptionLabel, type MasterPartRef } from "@/lib/purchase-line-source-pure";
import { MASTER_PART_SELECT_EMPTY_HINT } from "@/lib/purchase-line-form-pure";
import type { MasterPartType } from "@/lib/master-parts-pure";

export type MasterPartSelectProps = {
  value?: string | null;
  itemType: MasterPartType;
  onChange: (item: MasterPartRef | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

export function MasterPartSelect({
  value,
  itemType,
  onChange,
  placeholder = "搜索通用物料…",
  disabled = false,
  className = "",
}: MasterPartSelectProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<MasterPartRef[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [selected, setSelected] = useState<MasterPartRef | null>(null);

  const fetchItems = useCallback(
    async (q: string) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          type: itemType,
          isActive: "true",
          pageSize: "50",
        });
        if (q.trim()) params.set("keyword", q.trim());
        const res = await fetch(`/api/admin/master-parts?${params.toString()}`);
        const json = (await res.json()) as {
          success?: boolean;
          data?: { items?: MasterPartRef[] };
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
    },
    [itemType]
  );

  useEffect(() => {
    let cancelled = false;

    deferEffectTask(() => {
      if (cancelled) return;
      if (!value) {
        setSelected(null);
        setQuery("");
        return;
      }
      if (selected?.id === value) return;

      void (async () => {
        try {
          const res = await fetch(`/api/admin/master-parts/${value}`);
          const json = (await res.json()) as {
            success?: boolean;
            data?: { masterPart?: MasterPartRef };
          };
          if (cancelled) return;
          if (res.ok && json.success && json.data?.masterPart) {
            setSelected(json.data.masterPart);
            setQuery(formatMasterPartOptionLabel(json.data.masterPart));
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

  function pick(item: MasterPartRef) {
    setSelected(item);
    setQuery(formatMasterPartOptionLabel(item));
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
          已选：{formatMasterPartOptionLabel(selected)}
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
            <li className="px-3 py-2 text-sm text-zinc-500">
              无匹配通用物料。{MASTER_PART_SELECT_EMPTY_HINT}
            </li>
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
                  <span className="font-medium">{formatMasterPartOptionLabel(item)}</span>
                  {(item.brand || item.model || item.color) && (
                    <span className="text-xs text-zinc-500">
                      {[item.brand, item.model, item.color].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
