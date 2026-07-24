"use client";

import { useTranslations } from "next-intl";

/**
 * GET /api/profile/[nickname]가 내려주는 안전한 부분집합과 정확히 같은 모양이다.
 * 이메일·전화번호·좌표·식별정보는 API 응답에도 없고 이 타입에도 없다 — 여기서
 * 절대 그런 필드를 추가하거나 다른 곳에서 가져와 표시하지 않는다.
 */
export interface PublicProfileView {
  nickname: string;
  bio: string | null;
  region: string | null;
  phoneVerified: boolean;
  createdAt: string;
}

export function PublicProfile({ profile }: { profile: PublicProfileView }) {
  const t = useTranslations("profile");

  return (
    <div className="flex w-80 flex-col gap-4">
      <h1 className="text-xl font-semibold">{profile.nickname}</h1>
      <p>{profile.bio || t("bioEmpty")}</p>

      <dl className="flex flex-col gap-2 text-sm text-zinc-600">
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
          <dd>{new Date(profile.createdAt).toLocaleDateString()}</dd>
        </div>
      </dl>
    </div>
  );
}
