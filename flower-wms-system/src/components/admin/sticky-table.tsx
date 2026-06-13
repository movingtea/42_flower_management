import type { ReactNode } from "react";

/** 宽表格 sticky 列样式（与物料母表 WikiMaterialConsole 一致） */
export const STICKY_LEFT_HEAD =
  "sticky left-0 z-30 min-w-[10rem] max-w-[14rem] border-r border-zinc-200 bg-zinc-50 px-4 py-3 font-medium text-zinc-600 shadow-[4px_0_8px_-6px_rgba(15,23,42,0.25)]";

export const STICKY_LEFT_CELL =
  "sticky left-0 z-20 min-w-[10rem] max-w-[14rem] overflow-hidden border-r border-zinc-200 bg-white px-4 py-3 font-medium text-zinc-900 shadow-[4px_0_8px_-6px_rgba(15,23,42,0.25)] group-hover:bg-zinc-50";

export const STICKY_RIGHT_HEAD =
  "sticky right-0 z-40 min-w-[9rem] w-36 border-l border-zinc-200 bg-zinc-50 px-3 py-3 text-left font-medium text-zinc-600 shadow-[-4px_0_8px_-6px_rgba(15,23,42,0.25)]";

export const STICKY_RIGHT_CELL =
  "sticky right-0 z-30 min-w-[9rem] w-36 border-l border-zinc-200 bg-white px-3 py-3 text-right shadow-[-4px_0_8px_-6px_rgba(15,23,42,0.25)] group-hover:bg-zinc-50";

export const STICKY_SCROLL_HEAD =
  "px-4 py-3 font-medium text-zinc-600 bg-zinc-50";

export const STICKY_SCROLL_CELL = "px-4 py-3 text-zinc-600";

/** 表格行：配合 sticky 单元格 hover 背景同步 */
export const STICKY_TABLE_ROW = "group bg-white hover:bg-zinc-50";

/** 操作列按钮容器：横向排列、不换行 */
export const STICKY_ACTIONS =
  "flex shrink-0 flex-row items-center justify-end gap-2 whitespace-nowrap";

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
