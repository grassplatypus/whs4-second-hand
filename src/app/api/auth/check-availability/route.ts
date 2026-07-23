import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling } from "@/features/_shared/error";
import { checkAvailability } from "@/features/auth/register";

export const GET = withErrorHandling(async (req: Request) => {
  const params = new URL(req.url).searchParams;
  const query = {
    ...(params.get("nickname") ? { nickname: params.get("nickname")! } : {}),
    ...(params.get("email") ? { email: params.get("email")! } : {}),
  };
  return Response.json(await checkAvailability(prisma, query));
});
