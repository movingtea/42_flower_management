"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

type MaterialPayload = {
  id?: number;
  name: string;
  category: string;
  unit: string;
  unitPrice: number;
  lossRate: number;
  color: string;
};

type SamplePayload = {
  id?: number;
  name: string;
  subtitle: string;
  priority: number;
  color: string;
  materials: Array<{ materialId: number; quantity: number }>;
};

export type SaveResult = { ok: true; id: number } | { ok: false; error: string };

function cleanText(value: string, field: string, maxLength = 60) {
  const cleaned = value.trim();
  if (!cleaned) throw new Error(`请填写${field}`);
  if (cleaned.length > maxLength) throw new Error(`${field}不能超过 ${maxLength} 个字符`);
  return cleaned;
}

export async function saveMaterial(payload: MaterialPayload): Promise<SaveResult> {
  try {
    const data = {
      name: cleanText(payload.name, "花材名称"),
      category: cleanText(payload.category, "分类", 30),
      unit: cleanText(payload.unit, "单位", 10),
      unitPrice: Number(payload.unitPrice),
      lossRate: Number(payload.lossRate),
      color: /^#[0-9a-fA-F]{6}$/.test(payload.color) ? payload.color : "#7b9b80",
    };
    if (!Number.isFinite(data.unitPrice) || data.unitPrice < 0) throw new Error("采购单价必须是非负数");
    if (!Number.isFinite(data.lossRate) || data.lossRate < 0 || data.lossRate > 0.9) throw new Error("拆解损耗率必须在 0% 到 90% 之间");

    const saved = payload.id
      ? await prisma.material.update({ where: { id: payload.id }, data })
      : await prisma.material.create({ data });
    revalidatePath("/");
    return { ok: true, id: saved.id };
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unique constraint")) return { ok: false, error: "已存在同名花材" };
    return { ok: false, error: error instanceof Error ? error.message : "保存花材失败" };
  }
}

export async function saveSample(payload: SamplePayload): Promise<SaveResult> {
  try {
    const name = cleanText(payload.name, "样品名称");
    const subtitle = cleanText(payload.subtitle, "样品说明", 120);
    const priority = Math.min(3, Math.max(1, Math.round(Number(payload.priority))));
    const color = /^#[0-9a-fA-F]{6}$/.test(payload.color) ? payload.color : "#d8c9d8";
    const materials = payload.materials
      .map((item) => ({ materialId: Number(item.materialId), quantity: Math.round(Number(item.quantity)) }))
      .filter((item) => Number.isInteger(item.materialId) && Number.isInteger(item.quantity) && item.quantity > 0);
    if (materials.length === 0) throw new Error("请至少添加一种花材");
    if (new Set(materials.map((item) => item.materialId)).size !== materials.length) throw new Error("同一种花材不能重复添加");
    const existingCount = await prisma.material.count({ where: { id: { in: materials.map((item) => item.materialId) } } });
    if (existingCount !== materials.length) throw new Error("部分花材不存在，请刷新后重试");

    const saved = await prisma.$transaction(async (transaction) => {
      const sample = payload.id
        ? await transaction.sample.update({ where: { id: payload.id }, data: { name, subtitle, priority, color } })
        : await transaction.sample.create({ data: { name, subtitle, priority, color } });
      await transaction.sampleMaterial.deleteMany({ where: { sampleId: sample.id } });
      await transaction.sampleMaterial.createMany({ data: materials.map((item) => ({ sampleId: sample.id, ...item })) });
      return sample;
    });
    revalidatePath("/");
    return { ok: true, id: saved.id };
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unique constraint")) return { ok: false, error: "已存在同名样品" };
    return { ok: false, error: error instanceof Error ? error.message : "保存样品失败" };
  }
}
