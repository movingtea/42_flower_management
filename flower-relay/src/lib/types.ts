export type MaterialInput = {
  id: number;
  name: string;
  category: string;
  unit: string;
  unitPrice: number;
  lossRate: number;
  color: string;
};

export type SampleInput = {
  id: number;
  name: string;
  subtitle: string;
  priority: number;
  color: string;
  materials: Array<{
    quantity: number;
    material: MaterialInput;
  }>;
};

export type StepMaterial = {
  materialId: number;
  name: string;
  unit: string;
  reused: number;
  purchased: number;
  required: number;
  availableAfter: number;
  cost: number;
};

export type PlanStep = {
  sample: SampleInput;
  materials: StepMaterial[];
  reusedCount: number;
  purchasedCount: number;
  incrementalCost: number;
};

export type MaterialFlow = MaterialInput & {
  purchased: number;
  reused: number;
  remaining: number;
  useCount: number;
};

export type Plan = {
  steps: PlanStep[];
  totalCost: number;
  independentCost: number;
  savings: number;
  reuseRate: number;
  totalReused: number;
  totalUsed: number;
  flows: MaterialFlow[];
};
