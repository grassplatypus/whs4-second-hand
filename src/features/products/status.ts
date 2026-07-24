import { AppError } from "@/features/_shared/error";
import type { ProductDb } from "./db";
import type { ProductStatus } from "@prisma/client";

export const TRANSITIONS: Record<ProductStatus, ProductStatus[]> = {
  SELLING: ["RESERVED", "SOLD"],
  RESERVED: ["SELLING", "SOLD"],
  SOLD: [],
};

export async function changeStatus(
  db: ProductDb,
  sellerId: string,
  id: string,
  next: ProductStatus,
): Promise<void> {
  const p = await db.product.findFirst({
    where: { id, deletedAt: null },
    select: { sellerId: true, status: true },
  });
  if (!p) throw new AppError("NOT_FOUND", "상품을 찾을 수 없어요.", 404);
  if (p.sellerId !== sellerId) throw new AppError("FORBIDDEN", "권한이 없어요.", 403);
  if (!TRANSITIONS[p.status].includes(next))
    throw new AppError("INVALID_TRANSITION", "바꿀 수 없는 상태예요.", 409);
  await db.product.update({ where: { id }, data: { status: next } });
}
