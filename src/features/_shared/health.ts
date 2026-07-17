import type { PrismaClient } from "@prisma/client";

export interface HealthResult {
  status: "ok" | "degraded";
  db: boolean;
  ts: string;
}

export async function checkHealth(
  db: Pick<PrismaClient, "$queryRaw">,
): Promise<HealthResult> {
  let dbOk = false;
  try {
    await db.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }
  return { status: dbOk ? "ok" : "degraded", db: dbOk, ts: new Date().toISOString() };
}
