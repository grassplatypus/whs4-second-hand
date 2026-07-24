import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling } from "@/features/_shared/error";
import { requireAdmin } from "@/features/auth/rbac";
import { getChatRepo } from "@/features/chat/repo";
import { listReports } from "@/features/admin/service";
import type { ReportStatus } from "@/features/chat/repo";

const VALID: ReportStatus[] = ["open", "resolved", "dismissed"];

export const GET = withErrorHandling(async (req: Request) => {
  await requireAdmin(prisma, req);
  const raw = new URL(req.url).searchParams.get("status");
  const status = raw && VALID.includes(raw as ReportStatus) ? (raw as ReportStatus) : undefined;
  const reports = await listReports(getChatRepo(), prisma, status ? { status } : undefined);
  return Response.json({ reports });
});
