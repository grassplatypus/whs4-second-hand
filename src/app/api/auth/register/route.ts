import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling } from "@/features/_shared/error";
import { registerUser } from "@/features/auth/register";
import { requestMeta } from "@/features/auth/audit";

export const POST = withErrorHandling(async (req: Request) => {
  const result = await registerUser(prisma, await req.json(), requestMeta(req));
  return Response.json(result, { status: 201 });
});
