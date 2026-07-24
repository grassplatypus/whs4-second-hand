import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { searchProducts } from "@/features/products/search";
import { createProduct } from "@/features/products/service";

const NUMERIC_PARAMS = new Set(["lat", "lng", "radiusKm", "minPrice", "maxPrice", "limit"]);

/** URLSearchParams는 전부 문자열이라, searchSchema가 기대하는 숫자 필드만 골라 변환한다.
 * 값이 유효한 숫자가 아니면 원래 문자열 그대로 넘겨 zod가 400으로 거절하게 둔다. */
function parseSearchParams(searchParams: URLSearchParams): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const [key, value] of searchParams.entries()) {
    if (NUMERIC_PARAMS.has(key)) {
      const num = Number(value);
      raw[key] = value !== "" && Number.isFinite(num) ? num : value;
    } else {
      raw[key] = value;
    }
  }
  return raw;
}

// 공개 엔드포인트 — 인증 불필요. searchProducts의 안전한 부분집합만 내려간다.
export const GET = withErrorHandling(async (req: Request) => {
  const url = new URL(req.url);
  const raw = parseSearchParams(url.searchParams);
  const result = await searchProducts(prisma, raw);
  return Response.json(result);
});

export const POST = withErrorHandling(async (req: Request) => {
  const current = await requireActiveUser(prisma, req);
  const body = await req.json().catch(() => ({}));
  const result = await createProduct(prisma, current.userId, body);
  return Response.json(result, { status: 201 });
});
