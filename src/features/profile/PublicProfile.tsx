"use client";

import { useLocale, useTranslations } from "next-intl";
import { Card, EmptyState } from "@/features/shell/ui";
import { Avatar } from "@/features/shell/Avatar";
import { ProductCard, type ProductCardView } from "@/features/products/ProductCard";

export interface PublicProfileProductView {
  id: string;
  title: string;
  price: number;
  category: string;
  status: string;
  thumbnail: string | null;
  regionLabel: string | null;
}

/**
 * GET /api/profile/[nickname]가 내려주는 안전한 부분집합과 정확히 같은 모양이다.
 * 이메일·전화번호·좌표·식별정보는 API 응답에도 없고 이 타입에도 없다 — 여기서
 * 절대 그런 필드를 추가하거나 다른 곳에서 가져와 표시하지 않는다.
 */
export interface PublicProfileView {
  nickname: string;
  bio: string | null;
  avatarPath: string | null;
  region: string | null;
  phoneVerified: boolean;
  createdAt: string;
  /** 판매중/예약중 상품. */
  active: PublicProfileProductView[];
  /** 판매완료 상품. */
  sold: PublicProfileProductView[];
}

function toCardView(p: PublicProfileProductView): ProductCardView {
  return { ...p, distanceKm: null };
}

/** 유효하지 않은 날짜(파싱 실패)를 조용히 "—"로 보여준다 — 깨진 날짜 문자열이 그대로 노출되지 않게. */
function formatJoined(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(locale);
}

export function PublicProfile({ profile }: { profile: PublicProfileView }) {
  const t = useTranslations("profile");
  const locale = useLocale();

  return (
    <div className="flex w-full max-w-2xl flex-col gap-6">
      <div className="flex items-center gap-4">
        <Avatar nickname={profile.nickname} src={profile.avatarPath} size={64} />
        <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">{profile.nickname}</h1>
      </div>

      <Card className="flex flex-col gap-3">
        <p className="text-sm text-zinc-700 dark:text-zinc-300">{profile.bio || t("bioEmpty")}</p>
        <dl className="flex flex-col gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          <div className="flex justify-between">
            <dt>{t("region")}</dt>
            <dd>{profile.region ?? t("noRegion")}</dd>
          </div>
          <div className="flex justify-between">
            <dt>{t("phoneLabel")}</dt>
            <dd>{profile.phoneVerified ? t("phoneVerified") : t("phoneNotVerified")}</dd>
          </div>
          <div className="flex justify-between">
            <dt>{t("joined")}</dt>
            <dd>{formatJoined(profile.createdAt, locale)}</dd>
          </div>
        </dl>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{t("activeListings")}</h2>
        {profile.active.length > 0 ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {profile.active.map((p) => (
              <ProductCard key={p.id} product={toCardView(p)} />
            ))}
          </div>
        ) : (
          <EmptyState icon="🛍️" title={t("noActiveListings")} />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{t("soldListings")}</h2>
        {profile.sold.length > 0 ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {profile.sold.map((p) => (
              <ProductCard key={p.id} product={toCardView(p)} />
            ))}
          </div>
        ) : (
          <EmptyState icon="✅" title={t("noSoldListings")} />
        )}
      </section>
    </div>
  );
}
