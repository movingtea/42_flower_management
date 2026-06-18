/** Preload for permission HTTP smoke — sets DATABASE_URL before Prisma client init */
process.env.DATABASE_URL ??=
  "postgresql://permission-smoke:permission-smoke@127.0.0.1:5432/permission_smoke_unused";
