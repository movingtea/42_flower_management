"use client";

import { useFormStatus } from "react-dom";
import { setMaterialActiveAction } from "../actions";

/**
 * Server-confirmed enable/disable switch for one material row.
 *
 * The checked state always comes from the rendered row, never from local
 * optimistic state: after the server action redirects, the refreshed page
 * supplies the new value. The submit control is disabled while the form is in
 * flight so a rapid double click cannot queue two status changes.
 */

const TRACK =
  "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-wait";
const KNOB =
  "inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform";

function StatusSubmit({ active, materialName }: { active: boolean; materialName: string }) {
  const { pending } = useFormStatus();
  const stateLabel = active ? "启用" : "停用";
  return <>
    <button
      type="submit"
      role="switch"
      aria-checked={active}
      aria-busy={pending}
      aria-label={`${materialName}：当前${stateLabel}，点击${active ? "停用" : "启用"}`}
      disabled={pending}
      className={`${TRACK} ${active ? "border-emerald-700 bg-emerald-600" : "border-stone-300 bg-stone-300"} ${pending ? "opacity-60" : ""}`}
    >
      <span
        aria-hidden
        className={`${KNOB} ${active ? "translate-x-[1.1rem]" : "translate-x-0.5"}`}
      />
    </button>
    <span
      aria-live="polite"
      className={`whitespace-nowrap text-xs font-medium ${active ? "text-emerald-800" : "text-stone-500"}`}
    >
      {pending ? `${stateLabel} · 保存中…` : stateLabel}
    </span>
  </>;
}

export function MaterialStatusSwitch({
  materialId,
  materialName,
  active,
  returnTo,
}: {
  materialId: string;
  materialName: string;
  active: boolean;
  returnTo: string;
}) {
  return <form action={setMaterialActiveAction} className="flex items-center gap-2">
    <input type="hidden" name="materialId" value={materialId} />
    <input type="hidden" name="returnTo" value={returnTo} />
    <input type="hidden" name="active" value={String(!active)} />
    <StatusSubmit active={active} materialName={materialName} />
  </form>;
}
