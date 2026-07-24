import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling } from "@/features/_shared/error";
import { requireAdmin } from "@/features/auth/rbac";
import { getChatRepo } from "@/features/chat/repo";
import { listReports } from "@/features/admin/service";
import type { ListReportsOptions, ReportStatus } from "@/features/chat/repo";

const VALID: ReportStatus[] = ["open", "resolved", "dismissed"];
const MAX_LIMIT = 100;

function toStatus(raw: string | null): ReportStatus | undefined {
  return raw && VALID.includes(raw as ReportStatus) ? (raw as ReportStatus) : undefined;
}

export const GET = withErrorHandling(async (req: Request) => {
  await requireAdmin(prisma, req);
  const params = new URL(req.url).searchParams;
  const opts: ListReportsOptions = {};

  const status = toStatus(params.get("status"));
  if (status) opts.status = status;

  const limit = Number(params.get("limit"));
  if (Number.isInteger(limit) && limit > 0) opts.limit = Math.min(limit, MAX_LIMIT);

  // "더 보기" 커서 — 마지막으로 받은 신고의 createdAt과 상태(open 우선 정렬을 이어가기 위해).
  const cursorAt = params.get("cursor");
  const cursorStatus = toStatus(params.get("cursorStatus"));
  const cursorId = params.get("cursorId") ?? undefined;
  if (cursorAt && cursorStatus) {
    const createdAt = new Date(cursorAt);
    if (!Number.isNaN(createdAt.getTime())) {
      opts.cursor = { createdAt, status: cursorStatus, id: cursorId };
    }
  }

  const reports = await listReports(getChatRepo(), prisma, Object.keys(opts).length ? opts : undefined);
  return Response.json({ reports });
});
