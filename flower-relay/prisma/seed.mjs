import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const materials = [
  { name: "香槟玫瑰", category: "主花", unitPrice: 12, lossRate: 0.12, color: "#d99678" },
  { name: "白百合", category: "主花", unitPrice: 16, lossRate: 0.15, color: "#dccb99" },
  { name: "尤加利", category: "叶材", unitPrice: 5, lossRate: 0.05, color: "#7b9b80" },
  { name: "洋桔梗", category: "配花", unitPrice: 9, lossRate: 0.12, color: "#c9b4cf" },
  { name: "向日葵", category: "主花", unitPrice: 14, lossRate: 0.1, color: "#d7a73f" },
  { name: "小雏菊", category: "配花", unitPrice: 4, lossRate: 0.18, color: "#e3d8ae" },
  { name: "喷泉草", category: "线条花", unitPrice: 6, lossRate: 0.08, color: "#b99d77" },
  { name: "康乃馨", category: "主花", unitPrice: 8, lossRate: 0.1, color: "#cf8e93" },
];

const samples = [
  { name: "春日花篮", subtitle: "温柔清新的春日花篮样品", priority: 3, color: "#ead5c6", needs: { 香槟玫瑰: 8, 白百合: 4, 尤加利: 6, 小雏菊: 8 } },
  { name: "暮色手捧花", subtitle: "低饱和的优雅手捧花样品", priority: 3, color: "#d8c9d8", needs: { 香槟玫瑰: 6, 白百合: 3, 尤加利: 5, 洋桔梗: 6 } },
  { name: "晴光桌花", subtitle: "明亮通透的桌面花艺", priority: 2, color: "#e8d98f", needs: { 香槟玫瑰: 4, 白百合: 2, 尤加利: 6, 向日葵: 2, 小雏菊: 8 } },
  { name: "原野瓶花", subtitle: "自然松弛的野趣瓶花样品", priority: 2, color: "#c9dbc8", needs: { 香槟玫瑰: 4, 尤加利: 5, 小雏菊: 5, 喷泉草: 6 } },
  { name: "柔粉礼盒", subtitle: "适合节日推广的精致礼盒", priority: 2, color: "#e7c6ca", needs: { 香槟玫瑰: 6, 洋桔梗: 4, 康乃馨: 6, 尤加利: 3 } },
  { name: "向阳花束", subtitle: "充满能量的明黄色花束", priority: 1, color: "#dfc16a", needs: { 向日葵: 5, 小雏菊: 6, 尤加利: 4, 喷泉草: 4 } },
];

async function main() {
  await prisma.sampleMaterial.deleteMany();
  await prisma.sample.deleteMany();
  await prisma.material.deleteMany();

  for (const material of materials) {
    await prisma.material.create({ data: material });
  }

  const savedMaterials = await prisma.material.findMany();
  const byName = new Map(savedMaterials.map((material) => [material.name, material.id]));

  for (const sample of samples) {
    const { needs, ...data } = sample;
    await prisma.sample.create({
      data: {
        ...data,
        materials: {
          create: Object.entries(needs).map(([name, quantity]) => ({
            materialId: byName.get(name),
            quantity,
          })),
        },
      },
    });
  }
}

main()
  .finally(async () => prisma.$disconnect());
