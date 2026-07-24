import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/features/_shared/prisma";
import { AppError } from "@/features/_shared/error";
import { currentUserFromRefresh } from "@/features/auth/session";
import { REFRESH_COOKIE } from "@/features/auth/cookies";
import { getProduct } from "@/features/products/service";
import { ProductForm } from "@/features/products/ProductForm";

// 로그인 가드 + 소유자 확인. 실제 수정 권한은 API(updateProduct의 assertOwner)가 다시 최종 판단한다.
export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("product");

  const token = (await cookies()).get(REFRESH_COOKIE)?.value ?? null;
  const current = await currentUserFromRefresh(prisma, token);
  if (!current) redirect("/login?error=login_required");

  let product;
  try {
    product = await getProduct(prisma, id);
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    throw err;
  }

  const row = await prisma.product.findUnique({ where: { id }, select: { sellerId: true } });
  if (row?.sellerId !== current.userId) {
    return (
      <main className="flex flex-1 flex-col items-center gap-4 py-12">
        <p role="alert" className="text-sm text-red-600">
          {t("forbidden")}
        </p>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col items-center gap-6 py-12">
      <ProductForm
        mode="edit"
        productId={product.id}
        initial={{
          title: product.title,
          price: product.price,
          category: product.category,
          description: product.description,
          directPlace: product.directPlace,
          images: product.images,
        }}
      />
    </main>
  );
}
