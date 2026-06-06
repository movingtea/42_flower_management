"use client";

import type { WikiCareRow } from "@/lib/wiki-care";

type Props = {
  rows: WikiCareRow[];
  editable?: boolean;
  onChange?: (rows: WikiCareRow[]) => void;
};

export function WikiCareTable({ rows, editable = false, onChange }: Props) {
  return (
    <div className="overflow-hidden rounded-xl border border-rose-100/80 bg-white shadow-sm ring-1 ring-zinc-100">
      <table className="w-full text-sm">
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={row.key}
              className={`transition-colors ${
                index % 2 === 0 ? "bg-white" : "bg-rose-50/30"
              } hover:bg-rose-50/60`}
            >
              <td className="w-[38%] border-r border-zinc-100 px-3 py-2.5 align-top sm:w-[32%]">
                <span className="inline-flex rounded-md bg-rose-50 px-2 py-1 text-xs font-medium text-rose-800 ring-1 ring-rose-100">
                  {row.label}
                </span>
              </td>
              <td className="px-3 py-2.5 text-zinc-800">
                {editable && onChange ? (
                  <input
                    type="text"
                    value={row.value}
                    onChange={(e) => {
                      const next = rows.map((r) =>
                        r.key === row.key
                          ? { ...r, value: e.target.value }
                          : r
                      );
                      onChange(next);
                    }}
                    className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-rose-400 focus:ring-1 focus:ring-rose-400"
                  />
                ) : (
                  <span className="leading-relaxed">{row.value || "—"}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
