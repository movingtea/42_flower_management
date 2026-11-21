import Link from "next/link";
import { V2Drawer, V2DrawerForm } from "../_components/V2Drawer";
import {
  DetailItem,
  DetailList,
  StatusBadge,
  input,
  secondaryButton,
  type V2Tone,
} from "../_components/V2Ui";
import {
  baseQuantityStep,
  formatPurchaseDateTime,
  formatQuantity,
  materialIdentityLabel,
  purchaseOrderStateLabel,
} from "../_lib/purchase-ui";
import { materialPickerClass, materialPickerLabel } from "../_components/material-option-label";
import { isReceivingLineActionable, receivingLineStatus } from "./receiving-query";
import { receivePurchaseAction, rejectPurchaseAction } from "./actions";

export type ReceivingReceiptRow = {
  id: string;
  disposition: string;
  quantity: number;
  baseUnit: string;
  rejectionReason: string | null;
  gradeChangeReason: string | null;
  finalUnitCost: number | null;
  acceptedMaterial: { code: string; name: string } | null;
  receivedAt: Date;
};

export type ReceivingLineData = {
  id: string;
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  supplierName: string;
  orderState: string;
  expectedAt: Date | null;
  material: {
    id: string;
    code: string;
    name: string;
    baseUnit: string;
    quantityScale: number;
  };
  orderedQty: number;
  expectedBaseQty: number;
  processedQty: number;
  remainingQty: number;
  rejectedQty: number;
  unitPrice: number;
  /** Procurement-channel loss snapshot; null for legacy lines. */
  channelLossRate: number | null;
  expectedUsableQty: number | null;
  lossAdjustedUnitCost: number | null;
  relationKind: string;
  receipts: ReceivingReceiptRow[];
};

export type ReceivingMaterialOption = {
  id: string;
  code: string;
  name: string;
  baseUnit: string;
};

const TRIGGER =
  "inline-flex items-center justify-center rounded-md px-1.5 py-1 text-xs font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700";
const TRIGGER_PRIMARY = `${TRIGGER} text-emerald-800 hover:bg-emerald-50`;
const TRIGGER_DANGER = `${TRIGGER} text-rose-700 hover:bg-rose-50`;

const DISPOSITION_LABEL: Record<string, string> = {
  ACCEPTED: "合格入库",
  DOWNGRADED: "降级入库",
  REJECTED: "拒收",
};

const DISPOSITION_TONE: Record<string, V2Tone> = {
  ACCEPTED: "success",
  DOWNGRADED: "warning",
  REJECTED: "danger",
};

function NumberField({
  label,
  name,
  defaultValue,
  step,
  required = true,
  hint,
}: {
  label: string;
  name: string;
  defaultValue?: string | number;
  step: number;
  required?: boolean;
  hint?: string;
}) {
  return <label className="block text-sm text-stone-700">
    {label}
    <input
      className={`${input} mt-1`}
      name={name}
      type="number"
      min="0"
      step={step}
      defaultValue={defaultValue}
      required={required}
    />
    {hint ? <span className="mt-1 block text-xs text-stone-500">{hint}</span> : null}
  </label>;
}

function ReceivingSummary({ line }: { line: ReceivingLineData }) {
  const status = receivingLineStatus({ processedQty: line.processedQty, remainingQty: line.remainingQty });
  return <div className="space-y-3">
    <DetailList>
      <DetailItem label="采购单">{line.purchaseOrderNumber}</DetailItem>
      <DetailItem label="供应商">{line.supplierName}</DetailItem>
      <DetailItem label="物料">{materialIdentityLabel(line.material)}</DetailItem>
      <DetailItem label="采购状态">{purchaseOrderStateLabel(line.orderState)}</DetailItem>
      <DetailItem label="预计到货">{formatPurchaseDateTime(line.expectedAt)}</DetailItem>
      <DetailItem label="验收状态"><StatusBadge tone={status.tone}>{status.label}</StatusBadge></DetailItem>
      <DetailItem label="采购数量">{formatQuantity(line.expectedBaseQty)} {line.material.baseUnit}</DetailItem>
      <DetailItem label="已处理">{formatQuantity(line.processedQty)} {line.material.baseUnit}</DetailItem>
      <DetailItem label="其中拒收">{formatQuantity(line.rejectedQty)} {line.material.baseUnit}</DetailItem>
      <DetailItem label="剩余待验收">
        <span className={isReceivingLineActionable(line.remainingQty) ? "font-semibold text-amber-900" : "text-emerald-800"}>
          {formatQuantity(line.remainingQty)} {line.material.baseUnit}
        </span>
      </DetailItem>
      <DetailItem label="采购单价">¥{Number(line.unitPrice).toFixed(4)}</DetailItem>
      {line.channelLossRate !== null && (
        <>
          <DetailItem label="渠道损耗率">{(line.channelLossRate * 100).toFixed(2)}%</DetailItem>
          <DetailItem label="预计可用量">
            {line.expectedUsableQty === null ? "—" : `${formatQuantity(line.expectedUsableQty)} ${line.material.baseUnit}`}
          </DetailItem>
          <DetailItem label="损耗调整后单价">
            {line.lossAdjustedUnitCost === null ? "—" : `¥${line.lossAdjustedUnitCost.toFixed(4)}`}
          </DetailItem>
        </>
      )}
      <DetailItem label="关联类型">
        {line.relationKind === "ORIGINAL" ? "原始采购明细" : line.relationKind === "EXTRA_ORDER" ? "关联补单 / 额外到货" : "拒收后关联补送"}
      </DetailItem>
    </DetailList>
    <p className="text-xs text-stone-500">
      验收合格会增加对应批次实存；降级会按所选物料入库；拒收只记录处理进度，不增加库存。
    </p>
  </div>;
}

function ReceiptHistory({ line }: { line: ReceivingLineData }) {
  return <section className="rounded-xl border border-stone-200 bg-white p-3">
    <h3 className="text-sm font-semibold text-stone-900">验收记录</h3>
    {line.receipts.length === 0
      ? <p className="mt-2 rounded-lg border border-dashed border-stone-300 px-3 py-5 text-center text-xs text-stone-500">
          该采购明细还没有验收或拒收记录。
        </p>
      : <ul className="mt-2 divide-y divide-stone-100">
          {line.receipts.map((receipt) => (
            <li key={receipt.id} className="py-2 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={DISPOSITION_TONE[receipt.disposition] ?? "neutral"}>
                    {DISPOSITION_LABEL[receipt.disposition] ?? receipt.disposition}
                  </StatusBadge>
                  <span className="text-sm font-medium tabular-nums text-stone-900">
                    {formatQuantity(receipt.quantity)} {receipt.baseUnit}
                  </span>
                </div>
                <span className="text-xs text-stone-500">{formatPurchaseDateTime(receipt.receivedAt)}</span>
              </div>
              {receipt.acceptedMaterial ? (
                <p className="mt-1 text-xs text-stone-600">
                  入库物料：{receipt.acceptedMaterial.code} · {receipt.acceptedMaterial.name}
                </p>
              ) : null}
              {receipt.finalUnitCost !== null ? (
                <p className="mt-0.5 text-xs text-stone-500">最终单位成本 ¥{receipt.finalUnitCost.toFixed(4)}</p>
              ) : null}
              {receipt.gradeChangeReason ? <p className="mt-0.5 text-xs text-amber-800">降级原因：{receipt.gradeChangeReason}</p> : null}
              {receipt.rejectionReason ? <p className="mt-0.5 text-xs text-rose-700">拒收原因：{receipt.rejectionReason}</p> : null}
            </li>
          ))}
        </ul>}
  </section>;
}

/**
 * Row actions for one receiving line: read-only detail, plus accept/reject
 * drawers only while the line still has unprocessed quantity.
 */
export function ReceivingLineDrawer({
  line,
  materialOptions,
}: {
  line: ReceivingLineData;
  materialOptions: ReceivingMaterialOption[];
}) {
  const actionable = isReceivingLineActionable(line.remainingQty);
  const step = baseQuantityStep(line.material.quantityScale);
  const defaultCost = Number(line.unitPrice);

  return <div className="flex flex-wrap items-center gap-0.5">
    <V2Drawer
      triggerLabel="详情"
      triggerAriaLabel={`查看采购明细 ${line.purchaseOrderNumber} ${line.material.name}`}
      title="采购明细详情"
      description={`${line.purchaseOrderNumber} · ${line.material.code} ${line.material.name}`}
      size="lg"
      triggerClassName={TRIGGER_PRIMARY}
      footerNote="只读预览，不会修改采购或库存数据。"
    >
      <div className="space-y-4">
        <ReceivingSummary line={line} />
        <ReceiptHistory line={line} />
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/v2/purchase-orders?q=${encodeURIComponent(line.purchaseOrderNumber)}&state=all`}
            className={secondaryButton}
          >
            打开采购单
          </Link>
        </div>
      </div>
    </V2Drawer>

    {actionable ? <>
      <V2DrawerForm
        triggerLabel="验收"
        triggerAriaLabel={`验收 ${line.purchaseOrderNumber} ${line.material.name}`}
        title="验收入库"
        description={`${line.purchaseOrderNumber} · ${line.material.code} ${line.material.name}`}
        action={receivePurchaseAction}
        submitLabel="确认验收"
        size="lg"
        triggerClassName={TRIGGER_PRIMARY}
        footerNote="验收成功后生成批次与入库流水；同一幂等键重复提交不会重复入库。"
      >
        <input type="hidden" name="purchaseLineId" value={line.id} />
        <input type="hidden" name="idempotencyKey" value={`RECEIVE-${line.id}-${crypto.randomUUID()}`} />
        <ReceivingSummary line={line} />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm text-stone-700">验收结果
            <select className={`${input} mt-1`} name="disposition" defaultValue="ACCEPTED">
              <option value="ACCEPTED">合格（原等级）</option>
              <option value="DOWNGRADED">降级</option>
            </select>
          </label>
          <label className="block text-sm text-stone-700">降级后的物料
            <select className={`${input} ${materialPickerClass} mt-1`} name="acceptedMaterialId" defaultValue={line.material.id}>
              {materialOptions.map((material) => (
                <option key={material.id} value={material.id}>{materialPickerLabel(material)}</option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-stone-500">仅“降级”时生效；合格验收始终入库原物料。</span>
          </label>
          <NumberField
            label="数量"
            name="quantity"
            defaultValue={formatQuantity(line.remainingQty)}
            step={step}
            hint={`物料基础单位：${line.material.baseUnit}；最多三位小数，超过剩余数量会被服务层拒绝。`}
          />
          <NumberField
            label="最终单位成本"
            name="finalUnitCost"
            defaultValue={defaultCost}
            step={0.0001}
            hint="用于生成批次成本；后续可在采购单页面做批次成本最终确认。"
          />
          <label className="block text-sm text-stone-700">最晚可用时间（可选）
            <input className={`${input} mt-1`} name="usableUntil" type="datetime-local" />
          </label>
          <label className="block text-sm text-stone-700">降级原因（降级时填写）
            <input className={`${input} mt-1`} name="gradeChangeReason" placeholder="如：等级不符，按降级验收" />
          </label>
        </div>
      </V2DrawerForm>

      <V2DrawerForm
        triggerLabel="拒收"
        triggerAriaLabel={`拒收 ${line.purchaseOrderNumber} ${line.material.name}`}
        title="记录拒收"
        description={`${line.purchaseOrderNumber} · ${line.material.code} ${line.material.name}`}
        action={rejectPurchaseAction}
        submitLabel="记录拒收"
        size="md"
        triggerClassName={TRIGGER_DANGER}
        footerNote="拒收只记录处理进度和原因，不增加可用库存。"
      >
        <input type="hidden" name="purchaseLineId" value={line.id} />
        <input type="hidden" name="idempotencyKey" value={`REJECT-${line.id}-${crypto.randomUUID()}`} />
        <ReceivingSummary line={line} />
        <NumberField
          label="拒收数量"
          name="quantity"
          defaultValue={formatQuantity(line.remainingQty)}
          step={step}
          hint={`物料基础单位：${line.material.baseUnit}`}
        />
        <label className="block text-sm text-stone-700">拒收原因
          <input className={`${input} mt-1`} name="reason" required placeholder="如：到货破损、等级不符、数量短少" />
        </label>
      </V2DrawerForm>
    </> : null}
  </div>;
}
