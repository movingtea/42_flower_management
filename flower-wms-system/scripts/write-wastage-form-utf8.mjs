import fs from "fs";

/** Build UTF-8 file from code points only (script source stays ASCII). */
function t(...codes) {
  return String.fromCodePoint(...codes);
}

const REASON_OPTIONS = [
  t(0x81ea, 0x7136, 0x67af, 0x840e),
  t(0x5236, 0x4f5c, 0x6298, 0x635f),
  t(0x8fd0, 0x8f93, 0x7834, 0x635f),
  t(0x5176, 0x4ed6),
];

const S = {
  alertSelect: t(0x8bf7, 0x5148, 0x5728, 0x5de6, 0x4fa7, 0x5217, 0x8868, 0x70b9, 0x51fb, 0x300c, 0x9009, 0x62e9, 0x62a5, 0x635f, 0x300d),
  alertQty: t(0x635f, 0x8017, 0x6570, 0x91cf, 0x987b, 0x4e3a, 0x6b63, 0x6574, 0x6570),
  alertMax: t(0x62a5, 0x635f, 0x6570, 0x91cf, 0x4e0d, 0x80fd, 0x5927, 0x4e8e, 0x5f53, 0x524d, 0x6279, 0x6b21, 0x5269, 0x4f59, 0x5e93, 0x5b58),
  alertReason: t(0x8bf7, 0x9009, 0x62e9, 0x635f, 0x8017, 0x539f, 0x56e0),
  alertOperator: t(0x8bf7, 0x586b, 0x5199, 0x64cd, 0x4f5c, 0x5458),
  fail: t(0x635f, 0x8017, 0x6838, 0x9500, 0x5931, 0x8d25),
  ok: t(0x635f, 0x8017, 0x6838, 0x9500, 0x6210, 0x529f),
  network: t(0x7f51, 0x7edc, 0x5f02, 0x5e38, 0xff0c, 0x8bf7, 0x7a0d, 0x540e, 0x91cd, 0x8bd5),
  formTitle: t(0x62a5, 0x635f, 0x6838, 0x9500, 0x8868, 0x5355),
  selectedBatch: t(0x5df2, 0x9009, 0x6279, 0x6b21),
  batchNo: t(0x6279, 0x6b21, 0x53f7),
  remain: t(0x5269, 0x4f59),
  pickHint: t(0x8bf7, 0x4ece, 0x5de6, 0x4fa7, 0x9009, 0x62e9, 0x8981, 0x62a5, 0x635f, 0x7684, 0x6279, 0x6b21),
  qtyLabel: t(0x635f, 0x8017, 0x6570, 0x91cf),
  max: t(0x6700, 0x591a),
  pickFirst: t(0x5148, 0x9009, 0x62e9, 0x6279, 0x6b21),
  reasonLabel: t(0x635f, 0x8017, 0x539f, 0x56e0),
  pleaseSelect: t(0x8bf7, 0x9009, 0x62e9),
  noteLabel: t(0x5907, 0x6ce8, 0x8bf4, 0x660e),
  notePh: t(0x53ef, 0x9009, 0xff0c, 0x5982, 0xff1a, 0x51b7, 0x5e93, 0x20, 0x41, 0x20, 0x533a, 0x53d1, 0x73b0, 0x6574, 0x624e, 0x67af, 0x840e),
  operator: t(0x64cd, 0x4f5c, 0x5458),
  operatorPh: t(0x5c0f, 0x9648),
  submitting: t(0x63d0, 0x4ea4, 0x4e2d, 0x2026),
  confirm: t(0x786e, 0x8ba4, 0x62a5, 0x635f),
  cancel: t(0x53d6, 0x6d88, 0x9009, 0x62e9),
  emDash: t(0x2014),
  midDot: t(0x00b7),
  parenL: t(0xff08),
  parenR: t(0xff09),
};

const reasonsJson = JSON.stringify(REASON_OPTIONS);

const ph =
  "          placeholder={selected ? `" +
  S.max +
  " ${maxQty}` : " +
  JSON.stringify(S.pickFirst) +
  "}\n";

const content = `"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { WastageBatchRow } from "./types";

const REASON_OPTIONS = ${reasonsJson} as const;

type WastageFormProps = {
  selected: WastageBatchRow | null;
  onClearSelection: () => void;
};

export function WastageForm({ selected, onClearSelection }: WastageFormProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [wastageQty, setWastageQty] = useState("");

  useEffect(() => {
    setWastageQty("");
  }, [selected?.id]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!selected) {
      alert(${JSON.stringify(S.alertSelect)});
      return;
    }

    const form = e.currentTarget;
    const fd = new FormData(form);
    const qty = Number(wastageQty || fd.get("wastageQty"));
    const reason = String(fd.get("reason") ?? "");
    const note = String(fd.get("note") ?? "").trim();
    const operatorId = String(fd.get("operatorId") ?? "").trim();

    if (!Number.isInteger(qty) || qty <= 0) {
      alert(${JSON.stringify(S.alertQty)});
      return;
    }
    if (qty > selected.remainingQty) {
      alert(${JSON.stringify(S.alertMax)});
      return;
    }
    if (!reason) {
      alert(${JSON.stringify(S.alertReason)});
      return;
    }
    if (!operatorId) {
      alert(${JSON.stringify(S.alertOperator)});
      return;
    }

    const fullReason = note
      ? \`\${reason}${S.parenL}\${note}${S.parenR}\`
      : reason;

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/wastage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId: selected.id,
          wastageQty: qty,
          reason: fullReason,
          operatorId,
        }),
      });

      const json = (await res.json()) as {
        success: boolean;
        error?: string;
        data?: { message?: string };
      };

      if (!res.ok || !json.success) {
        alert(json.error ?? ${JSON.stringify(S.fail)});
        return;
      }

      alert(json.data?.message ?? ${JSON.stringify(S.ok)});
      form.reset();
      setWastageQty("");
      onClearSelection();
      router.refresh();
    } catch {
      alert(${JSON.stringify(S.network)});
    } finally {
      setSubmitting(false);
    }
  }

  const maxQty = selected?.remainingQty ?? 0;

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-xl border border-rose-100 bg-white p-6 shadow-sm"
    >
      <h3 className="text-sm font-semibold text-rose-900">{${JSON.stringify(S.formTitle)}}</h3>

      <div className="block text-sm">
        <span className="mb-1 block font-medium text-zinc-700">{${JSON.stringify(S.selectedBatch)}}</span>
        {selected ? (
          <div className="rounded-lg border border-rose-100 bg-rose-50/50 px-3 py-2 text-zinc-800">
            <p className="font-medium">{selected.productName}</p>
            <p className="mt-1 text-xs text-zinc-600">
              {${JSON.stringify(S.batchNo)}} {selected.batchNo ?? ${JSON.stringify(S.emDash)}} {${JSON.stringify(S.midDot)}} {${JSON.stringify(S.remain)}} {selected.remainingQty}{" "}
              {selected.productUnit}
            </p>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-zinc-200 px-3 py-4 text-center text-sm text-zinc-400">
            {${JSON.stringify(S.pickHint)}}
          </p>
        )}
        <input type="hidden" name="batchId" value={selected?.id ?? ""} readOnly />
      </div>

      <label className="block text-sm">
        <span className="mb-1 block font-medium text-zinc-700">{${JSON.stringify(S.qtyLabel)}}</span>
        <input
          name="wastageQty"
          type="number"
          min={1}
          max={maxQty || undefined}
          step={1}
          value={wastageQty}
          onChange={(e) => setWastageQty(e.target.value)}
          disabled={!selected}
PLACEHOLDER_LINE          required
          className="w-full rounded-lg border border-zinc-200 px-3 py-2 disabled:bg-zinc-50"
        />
      </label>

      <label className="block text-sm">
        <span className="mb-1 block font-medium text-zinc-700">{${JSON.stringify(S.reasonLabel)}}</span>
        <select
          name="reason"
          required
          disabled={!selected}
          defaultValue=""
          className="w-full rounded-lg border border-zinc-200 px-3 py-2 disabled:bg-zinc-50"
        >
          <option value="" disabled>
            {${JSON.stringify(S.pleaseSelect)}}
          </option>
          {REASON_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm">
        <span className="mb-1 block font-medium text-zinc-700">{${JSON.stringify(S.noteLabel)}}</span>
        <textarea
          name="note"
          rows={3}
          disabled={!selected}
          placeholder=${JSON.stringify(S.notePh)}
          className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm disabled:bg-zinc-50"
        />
      </label>

      <Input
        name="operatorId"
        label=${JSON.stringify(S.operator)}
        placeholder=${JSON.stringify(S.operatorPh)}
        required
        disabled={!selected}
      />

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={!selected || submitting}>
          {submitting ? ${JSON.stringify(S.submitting)} : ${JSON.stringify(S.confirm)}}
        </Button>
        {selected && (
          <Button
            type="button"
            variant="secondary"
            onClick={onClearSelection}
            disabled={submitting}
          >
            {${JSON.stringify(S.cancel)}}
          </Button>
        )}
      </div>
    </form>
  );
}
`;

const out = "src/app/wms/wastage/WastageForm.tsx";
const final = content.replace("PLACEHOLDER_LINE", ph);
fs.writeFileSync(out, final, "utf8");
new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(out));
const text = fs.readFileSync(out, "utf8");
console.log("OK:", out);
console.log("REASON:", REASON_OPTIONS.join(" | "));
