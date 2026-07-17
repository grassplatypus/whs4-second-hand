import type { PrismaClient } from "@prisma/client";

export interface HealthResult {
  status: "ok";
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
  return { status: "ok", db: dbOk, ts: new Date().toISOString() };
}
