import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling, AppError } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { saveAvatar } from "@/features/profile/avatar";
import { deleteStoredMedia } from "@/features/media/storage";

// 프로필 사진 업로드 — active USER 본인만. 저장 후 자기 avatarPath만 갱신하고,
// 쓰지 않게 된 이전 파일은 디스크에서 지운다(안 지우면 교체할 때마다 쓰레기가 쌓인다).
export const POST = withErrorHandling(async (req: Request) => {
  const current = await requireActiveUser(prisma, req);
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    throw new AppError("INVALID_IMAGE", "이미지 파일을 첨부해 주세요.", 400);
  }
  const before = await prisma.user.findUnique({
    where: { id: current.userId },
    select: { avatarPath: true },
  });
  const { path } = await saveAvatar(file);
  await prisma.user.update({ where: { id: current.userId }, data: { avatarPath: path } });
  // DB 갱신이 끝난 뒤에 지운다 — 갱신이 실패했는데 파일만 사라지는 일이 없게. 삭제 실패는 응답에 영향 없다.
  if (before?.avatarPath && before.avatarPath !== path) await deleteStoredMedia(before.avatarPath);
  return Response.json({ path }, { status: 201 });
});

// 프로필 사진 제거 — 이니셜 아바타로 되돌리고, 참조가 끊긴 파일도 함께 지운다.
export const DELETE = withErrorHandling(async (req: Request) => {
  const current = await requireActiveUser(prisma, req);
  const before = await prisma.user.findUnique({
    where: { id: current.userId },
    select: { avatarPath: true },
  });
  await prisma.user.update({ where: { id: current.userId }, data: { avatarPath: null } });
  await deleteStoredMedia(before?.avatarPath);
  return Response.json({ ok: true });
});
