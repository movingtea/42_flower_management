export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [{ prisma }, { v2db }] = await Promise.all([
      import("@/lib/prisma"),
      import("@/v2/db"),
    ]);
    await Promise.all([prisma.$queryRaw`SELECT 1`, v2db.$queryRaw`SELECT 1`]);
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
