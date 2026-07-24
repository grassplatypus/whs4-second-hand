"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

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

export function MyPage({ initialProfile }: { initialProfile: MyProfileView }) {
  const t = useTranslations("profile");
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

  return (
    <div className="flex w-80 flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-lg font-semibold">{profile.nickname}</span>
        <a href={`/u/${profile.nickname}`} className="text-sm text-blue-600">
          {t("viewPublicProfile")}
        </a>
      </div>

      {editingBio ? (
        <form onSubmit={saveBio} className="flex flex-col gap-2" noValidate>
          <label className="flex flex-col gap-1">
            {t("bio")}
            <textarea
              value={bioDraft}
              onChange={(e) => setBioDraft(e.target.value)}
              className="rounded border px-2 py-1"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="rounded bg-black px-3 py-2 text-white disabled:opacity-50"
            >
              {t("saveBio")}
            </button>
            <button
              type="button"
              onClick={() => {
                setBioDraft(profile.bio ?? "");
                setEditingBio(false);
              }}
              className="rounded border px-3 py-2"
            >
              {t("cancelBio")}
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-1">
          <p>{profile.bio || t("bioEmpty")}</p>
          <button
            type="button"
            onClick={() => setEditingBio(true)}
            className="self-start text-sm text-blue-600"
          >
            {t("editBio")}
          </button>
        </div>
      )}

      {saved && (
        <p aria-live="polite" className="text-sm text-green-700">
          {t("bioSaved")}
        </p>
      )}

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
          <dt>{t("twoFactorLabel")}</dt>
          <dd>{profile.twoFactorMethod !== "NONE" ? t("twoFactorOn") : t("twoFactorOff")}</dd>
        </div>
        <div className="flex justify-between">
          <dt>{t("passwordLabel")}</dt>
          <dd>{profile.hasPassword ? t("hasPassword") : t("noPassword")}</dd>
        </div>
        <div className="flex justify-between">
          <dt>{t("connectedAccountsLabel")}</dt>
          <dd>{profile.identities.length > 0 ? profile.identities.join(", ") : t("noConnections")}</dd>
        </div>
      </dl>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <a href="#account-management" className="text-sm text-blue-600">
        {t("accountManagement")}
      </a>
    </div>
  );
}
