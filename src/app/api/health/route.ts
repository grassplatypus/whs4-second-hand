import { prisma } from "@/features/_shared/prisma";
import { checkHealth } from "@/features/_shared/health";
import { withErrorHandling } from "@/features/_shared/error";

export const GET = withErrorHandling(async () => {
  const result = await checkHealth(prisma);
  return Response.json(result);
});
