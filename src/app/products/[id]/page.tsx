import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { prisma } from "@/features/_shared/prisma";
import { AppError } from "@/features/_shared/error";
import { currentUserFromRefresh } from "@/features/auth/session";
import { REFRESH_COOKIE } from "@/features/auth/cookies";
import { PageContainer } from "@/features/shell/ui";
import { getProduct } from "@/features/products/service";
import { ProductDetail, type ProductDetailView } from "@/features/products/ProductDetail";

// 공개 페이지 — 인증 불필요. 소유자 여부만 로그인 상태에 따라 추가로 계산한다.
export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let product;
  try {
    product = await getProduct(prisma, id);
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    throw err;
  }

  const token = (await cookies()).get(REFRESH_COOKIE)?.value ?? null;
  const current = await currentUserFromRefresh(prisma, token);

  // 소유권 비교용 sellerId만 별도 조회한다 — getProduct의 안전 부분집합에는 sellerId가 없고,
  // 화면에도 절대 내려주지 않는다(isOwner 불리언 하나로만 소비된다).
  let isOwner = false;
  if (current) {
    const row = await prisma.product.findUnique({ where: { id }, select: { sellerId: true } });
    isOwner = row?.sellerId === current.userId;
  }

  // 좌표(lat/lng)는 API가 내려주더라도 이 화면에는 절대 옮기지 않는다 — 안전 부분집합만 명시적으로 골라 담는다.
  const view: ProductDetailView = {
    id: product.id,
    title: product.title,
    description: product.description,
    price: product.price,
    category: product.category,
    status: product.status,
    regionLabel: product.regionLabel,
    directPlace: product.directPlace,
    images: product.images,
    sellerNickname: product.seller.nickname,
    sellerAvatarPath: product.seller.avatarPath,
    createdAt: product.createdAt.toISOString(),
  };

  return (
    <PageContainer size="lg" className="items-center">
      <ProductDetail product={view} isOwner={isOwner} />
    </PageContainer>
  );
}
