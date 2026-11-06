"use client";

import { useState } from "react";
import { input } from "../_components/V2Ui";

export type TransferLocationOption = {
  id: string;
  code: string;
  kindLabel: string;
  onHand: number;
};

/**
 * Source/target selects for the transfer form. The target option that equals
 * the selected source is disabled, and switching the source resets a colliding
 * target. The server action still rejects equal locations because the browser
 * is never the security boundary.
 */
export function TransferLocationFields({ locations }: { locations: TransferLocationOption[] }) {
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <label className="block text-sm text-stone-700" htmlFor="transfer-from">
        源库位
        <select
          id="transfer-from"
          className={`${input} mt-1`}
          name="fromLocationId"
          required
          value={fromId}
          onChange={(event) => {
            const next = event.target.value;
            setFromId(next);
            if (next && next === toId) setToId("");
          }}
        >
          <option value="" disabled>请选择源库位</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id} disabled={location.id === toId}>
              {location.code} · {location.kindLabel} · 库位实存 {location.onHand}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm text-stone-700" htmlFor="transfer-to">
        目标库位
        <select
          id="transfer-to"
          className={`${input} mt-1`}
          name="toLocationId"
          required
          value={toId}
          onChange={(event) => setToId(event.target.value)}
        >
          <option value="" disabled>请选择目标库位</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id} disabled={location.id === fromId}>
              {location.code} · {location.kindLabel} · 库位实存 {location.onHand}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-zinc-500 md:col-span-2">
        源库位与目标库位必须不同。移库会在同一批次的源、目标库位之间转移实存，并生成 TRANSFER 流水。
      </p>
    </div>
  );
}
