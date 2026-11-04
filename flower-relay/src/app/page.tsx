import { Dashboard } from "@/components/dashboard";
import { prisma } from "@/lib/prisma";
import { connection } from "next/server";

export default async function Home() {
  await connection();
  const [samples, materials] = await Promise.all([
    prisma.sample.findMany({
      include: { materials: { include: { material: true } } },
      orderBy: [{ priority: "desc" }, { id: "asc" }],
    }),
    prisma.material.findMany({ orderBy: [{ category: "asc" }, { id: "asc" }] }),
  ]);

  return <Dashboard samples={samples} materials={materials} />;
}
