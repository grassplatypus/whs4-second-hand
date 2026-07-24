import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/features/_shared/prisma";
import { currentUserFromRefresh } from "@/features/auth/session";
import { REFRESH_COOKIE } from "@/features/auth/cookies";
import { ProductForm } from "@/features/products/ProductForm";

// 로그인 가드 — 활성 사용자 여부(정지 등)는 실제 등록 요청 시 API(requireActiveUser)가 최종 판단한다.
export default async function NewProductPage() {
  const token = (await cookies()).get(REFRESH_COOKIE)?.value ?? null;
  const current = await currentUserFromRefresh(prisma, token);
  if (!current) redirect("/login?error=login_required");

  return (
    <main className="flex flex-1 flex-col items-center gap-6 py-12">
      <ProductForm mode="create" />
    </main>
  );
}
