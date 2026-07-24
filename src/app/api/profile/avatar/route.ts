import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling, AppError } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { saveAvatar } from "@/features/profile/avatar";

// 프로필 사진 업로드 — active USER 본인만. 저장 후 자기 avatarPath만 갱신한다.
export const POST = withErrorHandling(async (req: Request) => {
  const current = await requireActiveUser(prisma, req);
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    throw new AppError("INVALID_IMAGE", "이미지 파일을 첨부해 주세요.", 400);
  }
  const { path } = await saveAvatar(file);
  await prisma.user.update({ where: { id: current.userId }, data: { avatarPath: path } });
  return Response.json({ path }, { status: 201 });
});

// 프로필 사진 제거 — 이니셜 아바타로 되돌린다.
export const DELETE = withErrorHandling(async (req: Request) => {
  const current = await requireActiveUser(prisma, req);
  await prisma.user.update({ where: { id: current.userId }, data: { avatarPath: null } });
  return Response.json({ ok: true });
});
