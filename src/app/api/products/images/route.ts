import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling, AppError } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { saveProductImage } from "@/features/products/images";

export const POST = withErrorHandling(async (req: Request) => {
  await requireActiveUser(prisma, req);

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) {
    throw new AppError("INVALID_IMAGE", "이미지 파일을 첨부해 주세요.", 400);
  }

  const result = await saveProductImage(file);
  return Response.json(result, { status: 201 });
});
