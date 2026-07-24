import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { decryptPII } from "@/features/_shared/crypto";
import { AppError } from "@/features/_shared/error";
import { toChoseong } from "./choseong";
import type { ProductDb } from "./db";

const CATEGORIES = ["DIGITAL", "APPLIANCE", "FURNITURE", "CLOTHING", "BOOK", "BEAUTY", "SPORTS", "ETC"] as const;

function invalidInput(): AppError {
  return new AppError("INVALID_INPUT", "입력한 내용을 다시 확인해 주세요.", 400);
}

export const productInputSchema = z.object({
  title: z.string().trim().min(1, "제목을 입력해 주세요.").max(40, "제목은 40자 이하로 적어 주세요."),
  description: z.string().trim().max(2000, "설명은 2000자 이하로 적어 주세요."),
  price: z.number().int("가격은 정수여야 해요.").min(0, "가격은 0원 이상이어야 해요."),
  category: z.enum(CATEGORIES),
  directPlace: z.string().trim().max(100).optional(),
  images: z.array(z.string()).optional(),
});
export type ProductInput = z.infer<typeof productInputSchema>;

/** 수정용 부분 스키마 — 이미지는 별도 업로드 플로우(후속 태스크) 소관이라 여기서 다루지 않는다. */
export const productUpdateSchema = productInputSchema.omit({ images: true }).partial();
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;

/**
 * 공개 상세 — 이 안전한 부분집합 외에는 절대 추가하지 않는다.
 * seller는 nickname만(이메일/전화/식별정보 금지). lat/lng는 판매자 좌표를 그대로 스냅샷한
 * "동네 수준"의 값이라 노출 가능하다(정확 주소는 애초에 저장하지 않는다).
 */
export interface ProductDetail {
  id: string;
  title: string;
  description: string;
  price: number;
  category: string;
  status: string;
  lat: number;
  lng: number;
  regionLabel: string | null;
  directPlace: string | null;
  images: { path: string; order: number }[];
  seller: { nickname: string };
  createdAt: Date;
}

function notFound(): AppError {
  return new AppError("NOT_FOUND", "상품을 찾을 수 없어요.", 404);
}

function forbidden(): AppError {
  return new AppError("FORBIDDEN", "권한이 없어요.", 403);
}

/** 소유권 확인 — 없거나 삭제된 상품은 404, 소유자가 아니면 403. */
export async function assertOwner(db: ProductDb, id: string, userId: string): Promise<void> {
  const product = await db.product.findUnique({
    where: { id },
    select: { sellerId: true, deletedAt: true },
  });
  if (!product || product.deletedAt) throw notFound();
  if (product.sellerId !== userId) throw forbidden();
}

/**
 * 상품 등록. 판매자의 동네 설정(coarse lat/lng)이 없으면 등록을 막는다 — 위치 없이 올릴 수 없다.
 * 저장되는 좌표는 판매자의 이미 거칠어진(coarsened) 좌표 스냅샷일 뿐, 어떤 정확 좌표도 다루지 않는다.
 */
export async function createProduct(
  db: ProductDb,
  sellerId: string,
  raw: unknown,
): Promise<{ id: string }> {
  const parsed = productInputSchema.safeParse(raw);
  if (!parsed.success) throw invalidInput();
  const input = parsed.data;

  const seller = await db.user.findUnique({
    where: { id: sellerId },
    select: { lat: true, lng: true, regionCiphertext: true },
  });
  if (!seller || seller.lat == null || seller.lng == null) {
    throw new AppError("NO_LOCATION", "동네를 먼저 설정해 주세요.", 400);
  }

  const created = await db.product.create({
    data: {
      sellerId,
      title: input.title,
      titleChoseong: toChoseong(input.title),
      description: input.description,
      price: input.price,
      category: input.category,
      lat: seller.lat,
      lng: seller.lng,
      regionLabel: seller.regionCiphertext ? decryptPII(seller.regionCiphertext) : null,
      directPlace: input.directPlace ?? null,
      images: input.images ? { create: input.images.map((path, order) => ({ path, order })) } : undefined,
    },
    select: { id: true },
  });
  return { id: created.id };
}

/** 상품 상세 조회. 판매자 select는 nickname만 — 이메일/전화/정확좌표는 쿼리에도 넣지 않는다. */
export async function getProduct(db: ProductDb, id: string): Promise<ProductDetail> {
  const product = await db.product.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      description: true,
      price: true,
      category: true,
      status: true,
      lat: true,
      lng: true,
      regionLabel: true,
      directPlace: true,
      deletedAt: true,
      createdAt: true,
      images: { select: { path: true, order: true }, orderBy: { order: "asc" } },
      seller: { select: { nickname: true } },
    },
  });
  if (!product || product.deletedAt) throw notFound();

  return {
    id: product.id,
    title: product.title,
    description: product.description,
    price: product.price,
    category: product.category,
    status: product.status,
    lat: product.lat,
    lng: product.lng,
    regionLabel: product.regionLabel,
    directPlace: product.directPlace,
    images: product.images.map((img: { path: string; order: number }) => ({ path: img.path, order: img.order })),
    seller: { nickname: product.seller.nickname },
    createdAt: product.createdAt,
  };
}

/** 상품 수정. 소유권을 먼저 확인한 뒤 부분 입력을 검증한다. 제목이 바뀌면 초성도 재계산한다. */
export async function updateProduct(
  db: ProductDb,
  sellerId: string,
  id: string,
  raw: unknown,
): Promise<void> {
  await assertOwner(db, id, sellerId);
  const parsed = productUpdateSchema.safeParse(raw);
  if (!parsed.success) throw invalidInput();
  const input = parsed.data;

  const data: Prisma.ProductUpdateInput = {};
  if (input.title !== undefined) {
    data.title = input.title;
    data.titleChoseong = toChoseong(input.title);
  }
  if (input.description !== undefined) data.description = input.description;
  if (input.price !== undefined) data.price = input.price;
  if (input.category !== undefined) data.category = input.category;
  if (input.directPlace !== undefined) data.directPlace = input.directPlace;

  await db.product.update({ where: { id }, data });
}

/** 상품 삭제(soft delete). 소유권 확인 후 deletedAt만 세팅한다. */
export async function deleteProduct(db: ProductDb, sellerId: string, id: string): Promise<void> {
  await assertOwner(db, id, sellerId);
  await db.product.update({ where: { id }, data: { deletedAt: new Date() } });
}
