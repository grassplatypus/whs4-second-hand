"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card, Field, Button } from "@/features/shell/ui";
import { Avatar } from "@/features/shell/Avatar";

/** GET /api/profile/me가 내려주는 모양을 그대로 따른다(createdAt만 JSON 직렬화라 문자열). */
export interface MyProfileView {
  nickname: string;
  bio: string | null;
  region: string | null;
  phoneVerified: boolean;
  twoFactorMethod: string;
  identities: string[];
  hasPassword: boolean;
  createdAt: string;
}

// OAuth 식별자(raw enum) → 표시용 이름 카탈로그 키. ConnectionsManager와 같은 매핑.
const PROVIDER_LABEL_KEYS: Record<string, string> = {
  GOOGLE: "providerGoogle",
  KAKAO: "providerKakao",
  NAVER: "providerNaver",
};

export function MyPage({ initialProfile }: { initialProfile: MyProfileView }) {
  const t = useTranslations("profile");
  const tOauth = useTranslations("auth.oauth");
  const router = useRouter();

  const [profile, setProfile] = useState(initialProfile);
  const [editingBio, setEditingBio] = useState(false);
  const [bioDraft, setBioDraft] = useState(initialProfile.bio ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function saveBio(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/profile/bio", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bio: bioDraft }),
      });
      if (!res.ok) return setError(t("bioFailed"));
      setProfile((p) => ({ ...p, bio: bioDraft }));
      setEditingBio(false);
      setSaved(true);
      router.refresh();
    } catch {
      setError(t("bioFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  const connectionLabel =
    profile.identities.length > 0
      ? profile.identities.map((p) => tOauth(PROVIDER_LABEL_KEYS[p] ?? p)).join(", ")
      : t("noConnections");

  return (
    <div className="flex w-full max-w-2xl flex-col gap-6">
      <div className="flex items-center gap-4">
        <Avatar nickname={profile.nickname} size={64} />
        <div className="flex flex-col">
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">{profile.nickname}</h2>
          <Link
            href={`/u/${encodeURIComponent(profile.nickname)}`}
            className="text-sm text-emerald-600 hover:underline dark:text-emerald-400"
          >
            {t("viewPublicProfile")}
          </Link>
        </div>
      </div>

      <Card className="flex flex-col gap-3">
        {editingBio ? (
          <form onSubmit={saveBio} className="flex flex-col gap-3" noValidate>
            <Field label={t("bio")}>
              <textarea
                value={bioDraft}
                onChange={(e) => setBioDraft(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                rows={3}
              />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" disabled={submitting}>
                {t("saveBio")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setBioDraft(profile.bio ?? "");
                  setEditingBio(false);
                }}
              >
                {t("cancelBio")}
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-zinc-700 dark:text-zinc-300">{profile.bio || t("bioEmpty")}</p>
            <Button type="button" variant="ghost" onClick={() => setEditingBio(true)} className="self-start px-0">
              {t("editBio")}
            </Button>
          </div>
        )}

        {saved && (
          <p aria-live="polite" className="text-sm text-emerald-600">
            {t("bioSaved")}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </Card>

      <Card className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800">
        <div className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
          <span className="text-sm text-zinc-500 dark:text-zinc-400">{t("region")}</span>
          <span className="flex items-center gap-3">
            <span className="text-sm text-zinc-900 dark:text-zinc-100">{profile.region ?? t("noRegion")}</span>
            <Link href="/settings/location" className="text-sm font-medium text-emerald-600 hover:underline dark:text-emerald-400">
              {t("manageLocation")}
            </Link>
          </span>
        </div>
        <div className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
          <span className="text-sm text-zinc-500 dark:text-zinc-400">{t("phoneLabel")}</span>
          <span className="flex items-center gap-3">
            <span className="text-sm text-zinc-900 dark:text-zinc-100">
              {profile.phoneVerified ? t("phoneVerified") : t("phoneNotVerified")}
            </span>
            <Link href="/settings/phone" className="text-sm font-medium text-emerald-600 hover:underline dark:text-emerald-400">
              {t("managePhone")}
            </Link>
          </span>
        </div>
        <div className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
          <span className="text-sm text-zinc-500 dark:text-zinc-400">{t("twoFactorLabel")}</span>
          <span className="flex items-center gap-3">
            <span className="text-sm text-zinc-900 dark:text-zinc-100">
              {profile.twoFactorMethod !== "NONE" ? t("twoFactorOn") : t("twoFactorOff")}
            </span>
            <Link href="/settings/security" className="text-sm font-medium text-emerald-600 hover:underline dark:text-emerald-400">
              {t("manageSecurity")}
            </Link>
          </span>
        </div>
        <div className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
          <span className="text-sm text-zinc-500 dark:text-zinc-400">{t("connectedAccountsLabel")}</span>
          <span className="flex items-center gap-3">
            <span className="text-sm text-zinc-900 dark:text-zinc-100">{connectionLabel}</span>
            <Link href="/settings/connections" className="text-sm font-medium text-emerald-600 hover:underline dark:text-emerald-400">
              {t("manageConnections")}
            </Link>
          </span>
        </div>
        <div className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
          <span className="text-sm text-zinc-500 dark:text-zinc-400">{t("passwordLabel")}</span>
          <span className="text-sm text-zinc-900 dark:text-zinc-100">
            {profile.hasPassword ? t("hasPassword") : t("noPassword")}
          </span>
        </div>
      </Card>

      <a href="#account-management" className="text-sm font-medium text-emerald-600 hover:underline dark:text-emerald-400">
        {t("accountManagement")}
      </a>
    </div>
  );
}
