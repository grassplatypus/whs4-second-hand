import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling, AppError } from "@/features/_shared/error";
import { currentUserFromRefresh } from "@/features/auth/session";
import { readRefreshCookie } from "@/features/auth/cookies";
import { requestMeta } from "@/features/auth/audit";
import { getGeocoder } from "@/features/location/geocoder/geocoder";
import { locationSchema, setLocation } from "@/features/location/service";

export const POST = withErrorHandling(async (req: Request) => {
  const current = await currentUserFromRefresh(prisma, readRefreshCookie(req));
  if (!current) throw new AppError("UNAUTHENTICATED", "로그인이 필요해요.", 401);

  const raw = await req.json().catch(() => null);
  const parsed = locationSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("INVALID_INPUT", "입력을 확인해 주세요.", 400);

  const result = await setLocation(prisma, current.userId, parsed.data, getGeocoder(), requestMeta(req));
  return Response.json(result);
});
