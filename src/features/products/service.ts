import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { decryptPII } from "@/features/_shared/crypto";
import { AppError } from "@/features/_shared/error";
import { toChoseong } from "./choseong";
import type { ProductDb } from "./db";

const CATEGORIES = ["DIGITAL", "APPLIANCE", "FURNITURE", "CLOTHING", "BOOK", "BEAUTY", "SPORTS", "ETC"] as const;

/**
 * saveProductImage(images.ts)가 실제로 만들어내는 경로 모양과 정확히 일치해야 한다 —
 * `products/<서버 생성 uuid>.webp`. 클라이언트가 임의 문자열(다른 유저 경로, 경로 트래버설,
 * 외부 URL 등)을 이미지로 등록하지 못하게 막는 핵심 검증이라 느슨하게 풀면 안 된다.
 */
const PRODUCT_IMAGE_PATH_RE = /^products\/[0-9a-f-]{36}\.webp$/;
const MAX_IMAGES = 10;

function invalidInput(): AppError {
  return new AppError("INVALID_INPUT", "입력한 내용을 다시 확인해 주세요.", 400);
}

export const productInputSchema = z.object({
  title: z.string().trim().min(1, "제목을 입력해 주세요.").max(40, "제목은 40자 이하로 적어 주세요."),
  description: z.string().trim().max(2000, "설명은 2000자 이하로 적어 주세요."),
  price: z.number().int("가격은 정수여야 해요.").min(0, "가격은 0원 이상이어야 해요."),
  category: z.enum(CATEGORIES),
  directPlace: z.string().trim().max(100).optional(),
  images: z
    .array(z.string().regex(PRODUCT_IMAGE_PATH_RE, "이미지 형식이 올바르지 않아요."))
    .max(MAX_IMAGES, `이미지는 최대 ${MAX_IMAGES}장까지 올릴 수 있어요.`)
    .optional(),
});
export type ProductInput = z.infer<typeof productInputSchema>;

/**
 * 수정용 부분 스키마. 이미지도 등록과 동일한 검증(경로 형식·최대 10장)으로 받는다 —
 * 배열이 오면 상품의 이미지 전체를 그 배열로 교체한다(부분 patch가 아니라 전체 치환).
 */
export const productUpdateSchema = productInputSchema.partial();
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
  seller: { nickname: string; avatarPath: string | null };
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
      seller: { select: { nickname: true, avatarPath: true } },
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
    seller: { nickname: product.seller.nickname, avatarPath: product.seller.avatarPath },
    createdAt: product.createdAt,
  };
}

/**
 * 상품 수정. 소유권을 먼저 확인한 뒤 부분 입력을 검증한다. 제목이 바뀌면 초성도 재계산한다.
 * images가 입력에 포함되면 기존 이미지 전체를 지우고 새 배열로 다시 순서대로 만든다(전체 치환).
 */
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
  if (input.images !== undefined) {
    data.images = {
      deleteMany: {},
      create: input.images.map((path, order) => ({ path, order })),
    };
  }

  await db.product.update({ where: { id }, data });
}

/** 상품 삭제(soft delete) — 공개 노출에서 "숨기기"와 같은 동작이다. 소유권 확인 후 deletedAt만 세팅한다. */
export async function deleteProduct(db: ProductDb, sellerId: string, id: string): Promise<void> {
  await assertOwner(db, id, sellerId);
  await db.product.update({ where: { id }, data: { deletedAt: new Date() } });
}

/**
 * 소유권만 확인한다(deleteProduct/updateProduct용 assertOwner와 달리 숨김 상태도 통과시킨다) —
 * 복원 대상은 정의상 이미 deletedAt이 세팅된 상품이라, assertOwner를 그대로 쓸 수 없다.
 */
async function assertOwnerAnyState(db: ProductDb, id: string, userId: string): Promise<void> {
  const product = await db.product.findUnique({ where: { id }, select: { sellerId: true } });
  if (!product) throw notFound();
  if (product.sellerId !== userId) throw forbidden();
}

/** 숨긴(soft-deleted) 상품을 되돌린다 — deletedAt을 지워 다시 공개 목록/상세에 나타나게 한다. */
export async function restoreProduct(db: ProductDb, sellerId: string, id: string): Promise<void> {
  await assertOwnerAnyState(db, id, sellerId);
  await db.product.update({ where: { id }, data: { deletedAt: null } });
}

/** 판매자 본인의 전체 상품(숨김 포함) 요약 목록 — "숨긴 상품에 다시 접근하는 방법"을 위한 조회. */
export interface OwnedProductSummary {
  id: string;
  title: string;
  price: number;
  category: string;
  status: string;
  thumbnail: string | null;
  isHidden: boolean;
  createdAt: Date;
}

export async function listOwnProducts(db: ProductDb, sellerId: string): Promise<OwnedProductSummary[]> {
  const rows = await db.product.findMany({
    where: { sellerId },
    select: {
      id: true,
      title: true,
      price: true,
      category: true,
      status: true,
      deletedAt: true,
      createdAt: true,
      images: { select: { path: true }, orderBy: { order: "asc" }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
  });

  return rows.map((row: {
    id: string;
    title: string;
    price: number;
    category: string;
    status: string;
    deletedAt: Date | null;
    createdAt: Date;
    images: { path: string }[];
  }) => ({
    id: row.id,
    title: row.title,
    price: row.price,
    category: row.category,
    status: row.status,
    thumbnail: row.images[0]?.path ?? null,
    isHidden: row.deletedAt !== null,
    createdAt: row.createdAt,
  }));
}
