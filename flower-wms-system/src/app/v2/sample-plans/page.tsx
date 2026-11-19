import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import {
  Prisma,
  SamplePlanState,
  TransactionKind,
} from "@/generated/prisma-v2/client";
import { requireV2Context } from "@/v2/auth";
import { v2db } from "@/v2/db";
import {
  ActionEmptyState,
  StatusBadge,
  V2ModulePage,
  button,
  input,
} from "../_components/V2Ui";
import { V2DrawerForm } from "../_components/V2Drawer";
import { readV2Feedback } from "../_lib/search-params";
import {
  SamplePlanItemsEditor,
  StepActualsEditor,
  type PlanItem,
  type SampleOption,
  type StepMaterialInput,
} from "../samples/_components/SampleEditors";
import {
  approveSamplePlanAction,
  calculateSamplePlanAction,
  cancelSamplePlanAction,
  completeSampleStepAction,
  copySamplePlanAction,
  createSamplePlanAction,
  pauseSamplePlanAction,
  recalculateSamplePlanAction,
  resumeSamplePlanAction,
  selectSamplePlanRunAction,
  startNextSampleStepAction,
  startSamplePlanAction,
  updateSamplePlanAction,
} from "./actions";

export const dynamic = "force-dynamic";

const STATE_LABELS: Record<SamplePlanState, string> = {
  DRAFT: "草稿",
  PROPOSED: "已算方案",
  APPROVED: "已批准",
  PAUSED: "已暂停",
  IN_PROGRESS: "制作中",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
};

function stateTone(state: SamplePlanState): "success" | "warning" | "danger" | "info" | "neutral" {
  if (state === SamplePlanState.COMPLETED) return "success";
  if (state === SamplePlanState.CANCELLED) return "neutral";
  if (state === SamplePlanState.PAUSED) return "warning";
  if (state === SamplePlanState.IN_PROGRESS || state === SamplePlanState.APPROVED) return "info";
  if (state === SamplePlanState.PROPOSED) return "warning";
  return "neutral";
}

function money(value: number | Prisma.Decimal | null | undefined): string {
  return `¥${Number(value ?? 0).toFixed(2)}`;
}

function rate(value: number | Prisma.Decimal | null | undefined): string {
  return `${(Number(value ?? 0) * 100).toFixed(1)}%`;
}

function parseReusedByMaterial(value: Prisma.JsonValue | null): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = (value as Record<string, unknown>).reusedByMaterial;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: Record<string, number> = {};
  for (const [materialId, quantity] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof quantity === "number" && Number.isFinite(quantity) && quantity > 0) {
      result[materialId] = quantity;
    }
  }
  return result;
}

type PlanRow = Prisma.SamplePlanGetPayload<{
  include: {
    items: { include: { sample: { select: { id: true; code: true; name: true; state: true } } } };
    runs: { include: { steps: { include: { flows: true } } } };
    executions: {
      include: {
        steps: {
          include: {
            plannedStep: { include: { flows: true; sample: { select: { id: true; code: true; name: true } } } };
            reservations: { include: { batch: { include: { material: true } } } };
            disassembledMaterials: true;
          };
        };
      };
    };
  };
}>;

function stepInputs(execution: PlanRow["executions"][number], step: PlanRow["executions"][number]["steps"][number]): StepMaterialInput[] {
  const reused = parseReusedByMaterial(step.actualReusableSnapshot);
  const issued = new Map<string, number>();
  for (const reservation of step.reservations) {
    if (reservation.state !== "ISSUED" && reservation.state !== "CONSUMED") continue;
    issued.set(
      reservation.batch.materialId,
      (issued.get(reservation.batch.materialId) ?? 0) + Number(reservation.quantity),
    );
  }
  return step.plannedStep.flows
    .filter((flow) => Number(flow.requiredQty) > 0)
    .map((flow) => ({
      materialId: flow.materialId,
      name: flow.materialNameSnapshot,
      baseUnit: flow.unitSnapshot.split(" ")[0] ?? "",
      inputQty: Math.round(((issued.get(flow.materialId) ?? 0) + (reused[flow.materialId] ?? 0)) * 1000) / 1000,
      reusedQty: reused[flow.materialId] ?? 0,
    }));
}

function outstandingByBatch(
  execution: PlanRow["executions"][number],
  consumed: Map<string, number>,
): { batchId: string; materialName: string; baseUnit: string; quantity: number }[] {
  const issued = new Map<string, { quantity: number; materialName: string; baseUnit: string }>();
  for (const step of execution.steps) {
    for (const reservation of step.reservations) {
      if (reservation.state !== "ISSUED" && reservation.state !== "CONSUMED") continue;
      const current = issued.get(reservation.batchId) ?? {
        quantity: 0,
        materialName: reservation.batch.material.name,
        baseUnit: reservation.batch.material.baseUnit,
      };
      current.quantity += Number(reservation.quantity);
      issued.set(reservation.batchId, current);
    }
  }
  return [...issued.entries()]
    .map(([batchId, value]) => ({
      batchId,
      materialName: value.materialName,
      baseUnit: value.baseUnit,
      quantity: Math.round((value.quantity - (consumed.get(batchId) ?? 0) + Number.EPSILON) * 1000) / 1000,
    }))
    .filter((row) => row.quantity > 1e-8);
}

function PlanRunList({
  plan,
  canEdit,
}: {
  plan: PlanRow;
  canEdit: boolean;
}) {
  if (plan.runs.length === 0) {
    return <p className="text-sm text-stone-500">还没有计算方案。点击“计算方案”生成推荐。</p>;
  }
  return (
    <div className="space-y-2">
      {plan.runs.map((run) => (
        <details key={run.id} className="rounded-lg border border-stone-200 bg-white">
          <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-5 gap-y-2 px-3 py-2 text-sm">
            <span className="font-medium">方案 #{run.rank}</span>
            {plan.selectedRunId === run.id && <StatusBadge tone="success">当前选择</StatusBadge>}
            <span>总成本 {money(run.totalCost)}</span>
            <span>预计节省 {money(run.estimatedSaving)}</span>
            <span>复用率 {rate(run.reuseRate)}</span>
            <span>{run.steps.length} 步</span>
            <span className="ml-auto text-xs text-emerald-700">展开步骤</span>
          </summary>
          <div className="space-y-2 border-t border-stone-100 p-3">
            {canEdit && plan.selectedRunId !== run.id && (
              <form action={selectSamplePlanRunAction}>
                <input type="hidden" name="planId" value={plan.id} />
                <input type="hidden" name="runId" value={run.id} />
                <button className="rounded-lg border border-emerald-300 px-3 py-1 text-xs text-emerald-800">选择此方案</button>
              </form>
            )}
            {run.steps.map((step) => (
              <div key={step.id} className="rounded-lg bg-stone-50 p-2">
                <div className="text-sm font-medium">第 {step.sequenceNo} 步 · {step.sampleNameSnapshot} × {step.plannedQuantity}</div>
                <div className="mt-1 grid gap-1 text-xs text-stone-600 md:grid-cols-2">
                  {step.flows.map((flow) => (
                    <div key={flow.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-medium">{flow.materialNameSnapshot}</span>
                      <span>需求 {Number(flow.requiredQty)}</span>
                      <span>现货 {Number(flow.stockQty)}</span>
                      <span>复用 {Number(flow.reusedQty)}</span>
                      <span>采购 {Number(flow.purchaseQty)}</span>
                      <span>预计损耗 {Number(flow.lossQty)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

function plannedStepInputs(step: PlanRow["executions"][number]["steps"][number]): StepMaterialInput[] {
  return step.plannedStep.flows
    .filter((flow) => Number(flow.requiredQty) > 0)
    .map((flow) => ({
      materialId: flow.materialId,
      name: flow.materialNameSnapshot,
      baseUnit: flow.unitSnapshot.split(" ")[0] ?? "",
      inputQty: Number(flow.requiredQty),
      reusedQty: Number(flow.reusedQty),
    }));
}

function ExecutionPanel({
  plan,
  canApprove,
  outstanding,
}: {
  plan: PlanRow;
  canApprove: boolean;
  outstanding: { batchId: string; materialName: string; baseUnit: string; quantity: number }[];
}) {
  const execution = plan.executions.find((row) => !row.cancelledAt);
  if (!execution) {
    return (
      <div className="space-y-2 rounded-xl border border-stone-200 bg-white p-4">
        <h3 className="font-semibold">批准与执行</h3>
        {plan.state === SamplePlanState.PROPOSED && (
          <>
            <p className="text-sm text-stone-500">
              方案已计算。批准时会重新检查现货，只预留首次制作所需花材。
            </p>
            {canApprove ? (
              <form action={approveSamplePlanAction}>
                <input type="hidden" name="planId" value={plan.id} />
                <button className={button}>批准计划并预留首次花材</button>
              </form>
            ) : (
              <p className="text-xs text-amber-800">
                当前角色可执行打样，但批准计划需要商品/主数据权限（经理或管理员）。
              </p>
            )}
          </>
        )}
        {plan.state === SamplePlanState.CANCELLED && (
          <p className="text-sm text-stone-500">计划已取消；如需继续，请复制计划后重新计算。</p>
        )}
        {plan.state === SamplePlanState.COMPLETED && (
          <p className="text-sm text-stone-500">计划已完成，可在样品库将完成样品转为 SKU。</p>
        )}
        {(plan.state === SamplePlanState.DRAFT || plan.state === SamplePlanState.PROPOSED) && (
          <p className="text-xs text-stone-500">还没有执行记录；先计算并选择方案，再批准进入执行。</p>
        )}
      </div>
    );
  }

  const currentStep = execution.steps.find((step) => !step.completedAt);
  const isLast = currentStep
    ? !execution.steps.some((step) => step.plannedStep.sequenceNo > currentStep.plannedStep.sequenceNo)
    : false;
  const firstStep = execution.steps[0];
  const plannedFirst = firstStep?.plannedStep.flows.reduce((sum, flow) => sum + Number(flow.requiredQty), 0) ?? 0;
  const reservedFirst = firstStep?.reservations
    .filter((row) => row.state === "ACTIVE" || row.state === "ISSUED")
    .reduce((sum, row) => sum + Number(row.quantity), 0) ?? 0;

  return (
    <div className="space-y-3 rounded-xl border border-stone-200 bg-stone-50 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="font-semibold">批准与执行</h3>
        <StatusBadge tone={stateTone(plan.state)}>{STATE_LABELS[plan.state]}</StatusBadge>
        {execution.approvedAt && <span className="text-xs text-stone-500">批准 {execution.approvedAt.toISOString().slice(0, 16).replace("T", " ")}</span>}
        {execution.startedAt && <span className="text-xs text-stone-500">开始 {execution.startedAt.toISOString().slice(0, 16).replace("T", " ")}</span>}
        {execution.completedAt && <span className="text-xs text-stone-500">完成 {execution.completedAt.toISOString().slice(0, 16).replace("T", " ")}</span>}
        {execution.actualCost !== null && <span className="text-sm">实际成本 {money(execution.actualCost)}</span>}
      </div>

      {plan.state === SamplePlanState.APPROVED && (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
          <div>首次制作需求 {plannedFirst}，已预留 {reservedFirst}{reservedFirst + 1e-8 < plannedFirst ? "（仍有缺料，开始前需补购或重算）" : ""}。</div>
          <form action={startSamplePlanAction}>
            <input type="hidden" name="planId" value={plan.id} />
            <button className={button}>开始打样（领用到制作区）</button>
          </form>
          <form action={pauseSamplePlanAction}>
            <input type="hidden" name="planId" value={plan.id} />
            <button className="rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-sm text-amber-900">
              暂停计划（释放未领用预留）
            </button>
          </form>
        </div>
      )}

      {plan.state === SamplePlanState.IN_PROGRESS && (
        <form action={pauseSamplePlanAction} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <input type="hidden" name="planId" value={plan.id} />
          <button className="rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-sm text-amber-900">
            暂停打样（释放未领用预留）
          </button>
          <p className="mt-1 text-xs text-amber-900">制作区已领用物料保留；恢复后继续当前步骤。</p>
        </form>
      )}

      {plan.state === SamplePlanState.PAUSED && (
        <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="text-amber-900">
            计划已暂停：未领用预留已释放，制作区已领用物料保留。恢复时会重新检查现货。
          </p>
          <form action={resumeSamplePlanAction}>
            <input type="hidden" name="planId" value={plan.id} />
            <button className={button}>恢复打样</button>
          </form>
        </div>
      )}

      <div className="space-y-2">
        {execution.steps.map((step) => {
          const completed = Boolean(step.completedAt);
          const started = Boolean(step.startedAt);
          const active = currentStep?.id === step.id;
          return (
            <div key={step.id} className={`rounded-lg border p-3 ${active ? "border-emerald-300 bg-white" : "border-stone-200 bg-white/60"}`}>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">第 {step.plannedStep.sequenceNo} 步 · {step.plannedStep.sample.name}</span>
                <StatusBadge tone={completed ? "success" : started ? "info" : "neutral"}>
                  {completed ? "已完成" : started ? "制作中" : "未开始"}
                </StatusBadge>
                {Number(step.reusedQty) > 0 && <span className="text-xs text-stone-500">复用 {Number(step.reusedQty)}</span>}
                {completed && (
                  <span className="text-xs text-stone-600">
                    用量 {Number(step.usedQty)} · 损耗 {Number(step.lostQty)} · 留在制作区 {Number(step.reusableQty)} · 成本 {money(step.actualCost)}
                  </span>
                )}
              </div>
              {active && !started && plan.state === SamplePlanState.IN_PROGRESS && (
                <form action={startNextSampleStepAction} className="mt-2">
                  <input type="hidden" name="planId" value={plan.id} />
                  <button className={button}>开始本步（按实际拆解复用领料）</button>
                </form>
              )}
              {active && !started && (plan.state === SamplePlanState.APPROVED || plan.state === SamplePlanState.IN_PROGRESS) && (
                <form action={completeSampleStepAction} className="mt-3 space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
                  <input type="hidden" name="planId" value={plan.id} />
                  <p className="text-xs text-emerald-900">
                    直接完成：提交后在同一事务内自动补齐本步预留、领用与制作区流转，再登记实际用量。
                  </p>
                  <StepActualsEditor materials={plannedStepInputs(step)} defaultDisassemble={!isLast} />
                  <label className="block text-sm text-stone-700">
                    损耗原因（有损耗时填写）
                    <input className={`${input} mt-1`} name="lossReason" placeholder="例如：修剪损耗" />
                  </label>
                  <button className={button}>直接完成本步（自动补齐流转）</button>
                </form>
              )}
              {active && started && !completed && (
                <form action={completeSampleStepAction} className="mt-3 space-y-3">
                  <input type="hidden" name="planId" value={plan.id} />
                  <StepActualsEditor materials={stepInputs(execution, step)} defaultDisassemble={!isLast} />
                  <label className="block text-sm text-stone-700">
                    损耗原因（有损耗时填写）
                    <input className={`${input} mt-1`} name="lossReason" placeholder="例如：修剪损耗" />
                  </label>
                  <button className={button}>完成本步</button>
                </form>
              )}
              {completed && step.disassembledMaterials.length > 0 && (
                <div className="mt-2 grid gap-1 text-xs text-stone-600 md:grid-cols-2">
                  {step.disassembledMaterials.map((material) => (
                    <div key={material.id}>
                      拆解确认：可用 {Number(material.usableQty)}，不可用 {Number(material.rejectedQty)}
                      {material.usableUntil ? `，最晚可用 ${material.usableUntil.toISOString().slice(0, 10)}` : ""}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {plan.state !== SamplePlanState.COMPLETED && plan.state !== SamplePlanState.CANCELLED && canApprove && (
        <form action={cancelSamplePlanAction} className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3">
          <input type="hidden" name="planId" value={plan.id} />
          <h4 className="text-sm font-semibold text-red-900">取消计划</h4>
          <label className="block text-xs text-red-900">
            原因
            <input className={`${input} mt-1`} name="reason" required placeholder="说明取消原因" />
          </label>
          {outstanding.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-red-900">以下为仍在制作区的物料，请确认回库或报损数量；回库必须重新验收。</p>
              {outstanding.map((row) => (
                <div key={row.batchId} className="grid gap-1 rounded border border-red-200 bg-white p-2 text-xs sm:grid-cols-[1fr_5rem_5rem_7rem_auto]">
                  <input type="hidden" name="resolutionBatchId" value={row.batchId} />
                  <div>
                    {row.materialName}
                    <div className="font-mono text-[10px] text-stone-500">{row.batchId} · 未处理 {row.quantity}{row.baseUnit}</div>
                  </div>
                  <label>
                    回库
                    <input className={`${input} mt-1`} type="number" min="0" step="0.001" name={`resolutionReturnQty_${row.batchId}`} defaultValue={0} />
                  </label>
                  <label>
                    报损
                    <input className={`${input} mt-1`} type="number" min="0" step="0.001" name={`resolutionLossQty_${row.batchId}`} defaultValue={row.quantity} />
                  </label>
                  <label>
                    最晚可用
                    <input className={`${input} mt-1`} type="date" name={`resolutionUsableUntil_${row.batchId}`} />
                  </label>
                  <label className="flex items-end gap-1 pb-2">
                    <input type="checkbox" name={`resolutionReverified_${row.batchId}`} />
                    已验收
                  </label>
                </div>
              ))}
            </div>
          )}
          <button className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white">确认取消</button>
        </form>
      )}
    </div>
  );
}

export default async function SamplePlansPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user || session.user.source !== "v2") {
    redirect("/login?callbackUrl=/v2/sample-plans");
  }
  const context = await requireV2Context("production");
  const scope = {
    tenantId: context.tenantId,
    storeId: context.storeId,
    staffId: context.staffId,
    actorStaffId: context.staffId,
  };
  const canApprove = context.capabilities.includes("catalog");
  const params = await searchParams;

  const [plans, samples] = await Promise.all([
    v2db.samplePlan.findMany({
      where: { tenantId: scope.tenantId, storeId: scope.storeId },
      include: {
        items: {
          include: { sample: { select: { id: true, code: true, name: true, state: true } } },
          orderBy: { sequenceNo: "asc" },
        },
        runs: {
          include: {
            steps: {
              include: { flows: true },
              orderBy: { sequenceNo: "asc" },
            },
            inventory: { select: { materialId: true, unitCost: true } },
          },
          orderBy: { runNo: "desc" },
          take: 5,
        },
        executions: {
          include: {
            steps: {
              include: {
                plannedStep: {
                  include: {
                    flows: true,
                    sample: { select: { id: true, code: true, name: true } },
                  },
                },
                reservations: { include: { batch: { include: { material: true } } } },
                disassembledMaterials: true,
              },
              orderBy: { plannedStep: { sequenceNo: "asc" } },
            },
          },
          orderBy: { approvedAt: "desc" },
          take: 1,
        },
      },
      orderBy: [{ approvedAt: "desc" }, { name: "asc" }],
    }),
    v2db.sample.findMany({
      where: { tenantId: scope.tenantId, state: { not: "ARCHIVED" } },
      include: { _count: { select: { materials: true } } },
      orderBy: [{ state: "asc" }, { code: "asc" }],
    }),
  ]);

  const executionIds = plans.flatMap((plan) => plan.executions.map((execution) => execution.id));
  const riskEvents = plans.length === 0
    ? []
    : await v2db.auditEvent.findMany({
        where: {
          tenantId: scope.tenantId,
          storeId: scope.storeId,
          entityType: "SamplePlan",
          action: "SAMPLE_PLAN_AT_RISK",
          entityId: { in: plans.map((plan) => plan.id) },
        },
        orderBy: { occurredAt: "desc" },
      });
  const recalcEvents = plans.length === 0
    ? []
    : await v2db.auditEvent.findMany({
        where: {
          tenantId: scope.tenantId,
          storeId: scope.storeId,
          entityType: "SamplePlan",
          action: "SAMPLE_PLAN_RECALCULATED",
          entityId: { in: plans.map((plan) => plan.id) },
        },
        orderBy: { occurredAt: "desc" },
      });
  const riskByPlan = new Map<string, (typeof riskEvents)[number]>();
  for (const event of riskEvents) {
    if (event.entityId && !riskByPlan.has(event.entityId)) riskByPlan.set(event.entityId, event);
  }
  const recalcByPlan = new Map<string, (typeof recalcEvents)[number]>();
  for (const event of recalcEvents) {
    if (event.entityId && !recalcByPlan.has(event.entityId)) recalcByPlan.set(event.entityId, event);
  }
  const consumeRows = executionIds.length === 0
    ? []
    : await v2db.inventoryTransaction.findMany({
        where: {
          referenceType: "SAMPLE_PLAN_EXECUTION",
          referenceId: { in: executionIds },
          kind: TransactionKind.CONSUME,
        },
        select: { referenceId: true, batchId: true, quantity: true },
      });
  const consumedByExecution = new Map<string, Map<string, number>>();
  for (const row of consumeRows) {
    const batches = consumedByExecution.get(row.referenceId) ?? new Map<string, number>();
    batches.set(row.batchId, (batches.get(row.batchId) ?? 0) + Number(row.quantity));
    consumedByExecution.set(row.referenceId, batches);
  }

  const sampleOptions: SampleOption[] = samples
    .filter((sample) => sample._count.materials > 0)
    .map((sample) => ({
      id: sample.id,
      code: sample.code,
      name: sample.name,
      state: sample.state,
      materialCount: sample._count.materials,
      priority: sample.priority,
    }));

  const feedback = readV2Feedback(params);
  const activePlans = plans.filter((plan) => plan.state !== SamplePlanState.CANCELLED).length;

  return (
    <V2ModulePage
      title="打样计划"
      description="选择样品、模拟拆解复用与补购，批准后按步骤领用、记录实际用量与损耗，并将完成样品转为 SKU。"
      message={feedback.message}
      error={feedback.error}
      actions={
        <V2DrawerForm
          triggerLabel="新建打样计划"
          title="新建打样计划"
          description="选择样品与制作顺序；创建后再计算现货覆盖、复用与补购方案。"
          action={createSamplePlanAction}
          submitLabel="创建并稍后计算"
          size="xl"
          triggerClassName={button}
        >
          <label className="block text-sm text-stone-700">
            计划名称
            <input className={`${input} mt-1`} name="name" maxLength={100} required />
          </label>
          <SamplePlanItemsEditor samples={sampleOptions} />
        </V2DrawerForm>
      }
    >
      <p className="text-xs text-stone-500">
        共 {plans.length} 个计划，其中未取消 {activePlans} 个；样品选择 {sampleOptions.length} 个可用（至少一项花材）。
      </p>

      {plans.length === 0 ? (
        <ActionEmptyState
          title="还没有打样计划"
          description="点击右上角“新建打样计划”，选择一个或多个已完成样品，计算现货覆盖、复用与补购方案。"
        />
      ) : (
        <div className="space-y-3">
          {plans.map((plan) => {
            const execution = plan.executions.find((row) => !row.cancelledAt);
            const consumed = execution ? consumedByExecution.get(execution.id) ?? new Map() : new Map();
            const outstanding = execution ? outstandingByBatch(execution, consumed) : [];
            const canEdit = plan.state === SamplePlanState.DRAFT && !execution;
            const canSelectRun = (plan.state === SamplePlanState.DRAFT || plan.state === SamplePlanState.PROPOSED) && !execution;
            const initialItems: PlanItem[] = plan.items.map((item) => ({
              sampleId: item.sampleId,
              quantity: item.quantity,
              mandatory: item.mandatory,
              sequenceNo: item.sequenceNo ?? 1,
            }));
            const riskEvent = riskByPlan.get(plan.id);
            const recalcEvent = recalcByPlan.get(plan.id);
            // A recalculation supersedes older risk markers. A later customer
            // order conflict writes a fresh SAMPLE_PLAN_AT_RISK event.
            const activeRisk = riskEvent &&
              plan.state !== SamplePlanState.COMPLETED &&
              plan.state !== SamplePlanState.CANCELLED &&
              !execution?.startedAt &&
              (!recalcEvent || riskEvent.occurredAt > recalcEvent.occurredAt)
              ? riskEvent
              : undefined;
            const canRecalculate = Boolean(
              activeRisk &&
              canApprove &&
              plan.state === SamplePlanState.APPROVED &&
              execution &&
              !execution.startedAt
            );
            return (
              <details key={plan.id} className="rounded-xl border border-stone-200 bg-white shadow-sm">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
                  <div className="min-w-52 flex-1">
                    <div className="font-medium text-zinc-900">{plan.name}</div>
                    <div className="text-xs text-stone-500">
                      {plan.items.length} 个样品 · {plan.selectedRunId ? "已选方案" : "未选方案"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500">状态</div>
                    <div className="flex flex-wrap gap-1">
                      <StatusBadge tone={stateTone(plan.state)}>{STATE_LABELS[plan.state]}</StatusBadge>
                      {activeRisk && <StatusBadge tone="danger">顾客订单优先</StatusBadge>}
                    </div>
                  </div>
                  <div className="w-40">
                    <div className="text-xs text-zinc-500">预算 / 节省</div>
                    <div className="text-sm">{money(plan.estimatedPurchaseCost)}</div>
                    <div className="text-xs text-stone-500">节省 {money(plan.estimatedSaving)}</div>
                  </div>
                  <span className="ml-auto text-sm text-emerald-700">展开方案与执行</span>
                </summary>

                <div className="space-y-4 border-t border-stone-200 p-4 md:p-5">
                  {activeRisk && (
                    <div className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                      <p>
                        顾客订单优先占用了本计划尚未开始的批次预留，已释放约 {String((activeRisk.afterSnapshot as Record<string, unknown> | null)?.releasedQty ?? "?")}。补购后可在原计划上重新计算并再次批准，无需取消重建。
                      </p>
                      {canRecalculate ? (
                        <form action={recalculateSamplePlanAction}>
                          <input type="hidden" name="planId" value={plan.id} />
                          <button className="rounded-lg border border-red-400 bg-white px-3 py-1.5 text-sm text-red-900">
                            补购后原地重算（保留计划）
                          </button>
                        </form>
                      ) : (
                        <p className="text-xs text-red-800">
                          原地重算需要商品/主数据权限（经理或管理员），且计划尚未开始制作。
                        </p>
                      )}
                    </div>
                  )}
                  <div className="grid gap-4 lg:grid-cols-2">
                    <section className="space-y-2 rounded-xl border border-stone-200 bg-stone-50 p-4">
                      <h3 className="font-semibold">计划样品与制作顺序</h3>
                      <div className="space-y-1 text-sm">
                        {plan.items.map((item) => (
                          <div key={item.id} className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs text-stone-500">{item.sequenceNo ?? "—"}</span>
                            <span>{item.sample.name}</span>
                            <span className="text-xs text-stone-500">× {item.quantity}</span>
                            <StatusBadge tone={item.mandatory ? "info" : "neutral"}>{item.mandatory ? "必选" : "可选"}</StatusBadge>
                          </div>
                        ))}
                      </div>
                      {canEdit && (
                        <div className="mt-3 border-t border-stone-200 pt-3">
                          <V2DrawerForm
                            triggerLabel="编辑计划"
                            title="编辑计划样品与制作顺序"
                            description="修改计划名称、样品与制作顺序；保存后需重新计算方案。"
                            action={updateSamplePlanAction}
                            submitLabel="保存计划"
                            size="xl"
                            triggerClassName={button}
                          >
                            <input type="hidden" name="planId" value={plan.id} />
                            <label className="block text-sm text-stone-700">
                              计划名称
                              <input className={`${input} mt-1`} name="name" defaultValue={plan.name} maxLength={100} required />
                            </label>
                            <SamplePlanItemsEditor samples={sampleOptions} initialItems={initialItems} />
                          </V2DrawerForm>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {!execution && (plan.state === SamplePlanState.DRAFT || plan.state === SamplePlanState.PROPOSED) && (
                          <form action={calculateSamplePlanAction}>
                            <input type="hidden" name="planId" value={plan.id} />
                            <button className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white">计算方案</button>
                          </form>
                        )}
                        {!activeRisk && canApprove && plan.state === SamplePlanState.APPROVED && execution && !execution.startedAt && (
                          <form action={recalculateSamplePlanAction}>
                            <input type="hidden" name="planId" value={plan.id} />
                            <button className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">重新检查现货并原地重算</button>
                          </form>
                        )}
                        <form action={copySamplePlanAction}>
                          <input type="hidden" name="planId" value={plan.id} />
                          <button className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs text-stone-700">复制计划</button>
                        </form>
                        <Link className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs text-stone-700" href="/v2/samples">样品库</Link>
                      </div>
                    </section>

                    <section className="rounded-xl border border-stone-200 bg-white p-4">
                      <h3 className="font-semibold">推荐方案（成本、复用与补购）</h3>
                      <div className="mt-2">
                        <PlanRunList plan={plan} canEdit={canSelectRun} />
                      </div>
                    </section>
                  </div>

                  <ExecutionPanel
                    plan={plan}
                    canApprove={canApprove}
                    outstanding={outstanding}
                  />
                </div>
              </details>
            );
          })}
        </div>
      )}
    </V2ModulePage>
  );
}
