import type { MaterialFlow, Plan, PlanStep, SampleInput } from "./types";

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, index) =>
    permutations(items.filter((_, itemIndex) => itemIndex !== index)).map((rest) => [item, ...rest]),
  );
}

function combinations<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  const [first, ...rest] = items;
  return [
    ...combinations(rest, size - 1).map((combo) => [first, ...combo]),
    ...combinations(rest, size),
  ];
}

function simulate(sequence: SampleInput[]): Plan {
  const pool = new Map<number, number>();
  const flows = new Map<number, MaterialFlow>();
  const steps: PlanStep[] = [];
  let independentCost = 0;

  for (const sample of sequence) {
    let incrementalCost = 0;
    let reusedCount = 0;
    let purchasedCount = 0;

    const stepMaterials = sample.materials.map(({ material, quantity }) => {
      independentCost += quantity * material.unitPrice;
      const available = pool.get(material.id) ?? 0;
      const reused = Math.min(available, quantity);
      const purchased = quantity - reused;
      const cost = purchased * material.unitPrice;
      incrementalCost += cost;
      reusedCount += reused;
      purchasedCount += purchased;

      const surviving = Math.floor(quantity * (1 - material.lossRate));
      const unused = Math.max(available - reused, 0);
      const availableAfter = unused + surviving;
      pool.set(material.id, availableAfter);

      const flow = flows.get(material.id) ?? {
        ...material,
        purchased: 0,
        reused: 0,
        remaining: 0,
        useCount: 0,
      };
      flow.purchased += purchased;
      flow.reused += reused;
      flow.remaining = availableAfter;
      flow.useCount += 1;
      flows.set(material.id, flow);

      return {
        materialId: material.id,
        name: material.name,
        unit: material.unit,
        reused,
        purchased,
        required: quantity,
        availableAfter,
        cost,
      };
    });

    steps.push({ sample, materials: stepMaterials, reusedCount, purchasedCount, incrementalCost });
  }

  const totalCost = steps.reduce((sum, step) => sum + step.incrementalCost, 0);
  const totalReused = steps.reduce((sum, step) => sum + step.reusedCount, 0);
  const totalUsed = steps.reduce(
    (sum, step) => sum + step.materials.reduce((materialSum, material) => materialSum + material.required, 0),
    0,
  );

  return {
    steps,
    totalCost,
    independentCost,
    savings: independentCost - totalCost,
    reuseRate: totalUsed === 0 ? 0 : Math.round((totalReused / totalUsed) * 100),
    totalReused,
    totalUsed,
    flows: [...flows.values()].sort((a, b) => b.reused - a.reused),
  };
}

export function optimize(samples: SampleInput[], count: number): Plan[] {
  const safeCount = Math.min(Math.max(count, 2), Math.min(samples.length, 5));
  const plans = combinations(samples, safeCount).flatMap((combo) => permutations(combo).map(simulate));

  plans.sort((a, b) => {
    if (a.totalCost !== b.totalCost) return a.totalCost - b.totalCost;
    if (a.totalReused !== b.totalReused) return b.totalReused - a.totalReused;
    return b.steps.reduce((sum, step) => sum + step.sample.priority, 0) -
      a.steps.reduce((sum, step) => sum + step.sample.priority, 0);
  });

  const unique = new Map<string, Plan>();
  for (const plan of plans) {
    const key = plan.steps.map((step) => step.sample.id).sort((a, b) => a - b).join("-");
    if (!unique.has(key)) unique.set(key, plan);
    if (unique.size >= 5) break;
  }

  return [...unique.values()];
}
