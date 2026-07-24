"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Card, EmptyState, PageHeader } from "@/features/shell/ui";
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

/** 받은 후기 한 건 — 작성자는 닉네임·아바타만(이메일/전화/식별정보 없음). */
export interface ReceivedReviewItemView {
  reviewer: { nickname: string; avatarPath: string | null };
  rating: "GOOD" | "OK" | "BAD";
  comment: string | null;
  createdAt: string;
}

export interface ReceivedReviewsView {
  summary: {
    counts: { GOOD: number; OK: number; BAD: number };
    positiveRate: number;
    total: number;
  };
  items: ReceivedReviewItemView[];
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
  /** 이 사람이 받은 거래 후기 — 구매 이력(비공개)과 달리 공개 프로필에 보인다. */
  reviews: ReceivedReviewsView;
}

function toCardView(p: PublicProfileProductView): ProductCardView {
  return { ...p, distanceKm: null };
}

/** 유효하지 않은 날짜(파싱 실패)를 조용히 "—"로 보여준다 — 깨진 날짜 문자열이 그대로 노출되지 않게. */
function formatDate(iso: string, format: ReturnType<typeof useFormatter>): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return format.dateTime(d, { dateStyle: "medium" });
}

export function PublicProfile({ profile }: { profile: PublicProfileView }) {
  const t = useTranslations("profile");
  const tReview = useTranslations("review");
  const format = useFormatter();

  return (
    <div className="flex w-full max-w-2xl flex-col gap-6">
      <div className="flex items-center gap-4">
        <Avatar nickname={profile.nickname} src={profile.avatarPath} size={64} />
        <PageHeader title={profile.nickname} />
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
            <dd>{formatDate(profile.createdAt, format)}</dd>
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

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{tReview("receivedTitle")}</h2>
        {profile.reviews.summary.total > 0 ? (
          <>
            <Card className="flex flex-wrap gap-4 text-sm">
              <span className="text-zinc-700 dark:text-zinc-300">
                {tReview("rating.GOOD")} {profile.reviews.summary.counts.GOOD}
              </span>
              <span className="text-zinc-700 dark:text-zinc-300">
                {tReview("rating.OK")} {profile.reviews.summary.counts.OK}
              </span>
              <span className="text-zinc-700 dark:text-zinc-300">
                {tReview("rating.BAD")} {profile.reviews.summary.counts.BAD}
              </span>
              <span className="ml-auto font-semibold text-zinc-900 dark:text-zinc-50">
                {tReview("positiveRate")} {profile.reviews.summary.positiveRate}%
              </span>
            </Card>
            <ul className="flex flex-col gap-3">
              {profile.reviews.items.map((r, i) => (
                <li key={i}>
                  <Card className="flex items-start gap-3">
                    <Avatar nickname={r.reviewer.nickname} src={r.reviewer.avatarPath} size={32} />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-medium text-zinc-900 dark:text-zinc-50">{r.reviewer.nickname}</span>
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">{tReview(`rating.${r.rating}`)}</span>
                      </span>
                      {r.comment && <span className="whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">{r.comment}</span>}
                      <span className="text-xs text-zinc-400 dark:text-zinc-500">{formatDate(r.createdAt, format)}</span>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <EmptyState icon="💬" title={tReview("receivedEmpty")} />
        )}
      </section>
    </div>
  );
}
