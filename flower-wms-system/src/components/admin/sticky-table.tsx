import type { ReactNode } from "react";

/** 宽表格 sticky 列样式（与物料母表 WikiMaterialConsole 一致） */
export const STICKY_LEFT_HEAD =
  "sticky left-0 z-30 min-w-[10rem] max-w-[14rem] border-r border-zinc-200 bg-zinc-50 px-4 py-3 font-medium text-zinc-600 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.08)]";

export const STICKY_LEFT_CELL =
  "sticky left-0 z-20 min-w-[10rem] max-w-[14rem] overflow-hidden border-r border-zinc-200 bg-white px-4 py-3 font-medium text-zinc-900 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.08)] group-hover:bg-zinc-50/80";

export const STICKY_RIGHT_HEAD =
  "sticky right-0 z-40 w-28 min-w-[7rem] border-l border-zinc-200 bg-zinc-50 px-3 py-3 text-left font-medium text-zinc-600 shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.08)]";

export const STICKY_RIGHT_CELL =
  "sticky right-0 z-30 w-28 min-w-[7rem] whitespace-nowrap border-l border-zinc-200 bg-white px-3 py-3 text-right shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.08)] group-hover:bg-zinc-50/80";

export const STICKY_SCROLL_HEAD =
  "px-4 py-3 font-medium text-zinc-600 bg-zinc-50";

export const STICKY_SCROLL_CELL = "px-4 py-3 text-zinc-600";

type StickyTableScrollProps = {
  children: ReactNode;
  minWidth?: string;
  className?: string;
};

/** 横向滚动容器 + table 基类 */
export function StickyTableScroll({
  children,
  minWidth = "980px",
  className = "",
}: StickyTableScrollProps) {
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table
        className="w-full text-left text-sm"
        style={{ minWidth }}
      >
        {children}
      </table>
    </div>
  );
}
