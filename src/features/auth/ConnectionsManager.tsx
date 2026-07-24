"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { StepUpPrompt } from "./StepUpPrompt";

const PROVIDERS = [
  { slug: "google", name: "GOOGLE" },
  { slug: "kakao", name: "KAKAO" },
  { slug: "naver", name: "NAVER" },
] as const;

const ERROR_KEYS: Record<string, string> = {
  LAST_CREDENTIAL: "lastCredential",
  IDENTITY_TAKEN: "identityTaken",
};

export function ConnectionsManager({
  connected,
  initialError,
}: {
  connected: string[];
  initialError?: string;
}) {
  const t = useTranslations("auth.oauth");
  const router = useRouter();
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [stepUpSlug, setStepUpSlug] = useState<string | null>(null);

  async function unlink(slug: string) {
    setError(null);
    const res = await fetch(`/api/auth/oauth/${slug}/unlink`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ code: undefined }));
      // 민감 작업(연동 해제)은 최근 재인증이 없으면 401 STEP_UP_REQUIRED — 원문 대신
      // StepUpPrompt를 띄워 재인증시킨 뒤 같은 provider로 해제를 재시도한다.
      if (body.code === "STEP_UP_REQUIRED") {
        setStepUpSlug(slug);
        return;
      }
      return setError(t(ERROR_KEYS[body.code] ?? "failed"));
    }
    setStepUpSlug(null);
    router.refresh();
  }

  return (
    <div className="flex w-80 flex-col gap-3">
      {PROVIDERS.map((p) => {
        const isConnected = connected.includes(p.name);
        return (
          <div key={p.slug} className="flex items-center justify-between rounded border px-3 py-2">
            {isConnected ? (
              <>
                <span>{t(p.slug)}</span>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-zinc-400">{t("connected")}</span>
                  <button type="button" onClick={() => unlink(p.slug)} className="text-sm text-red-600">
                    {t("unlink")}
                  </button>
                </span>
              </>
            ) : (
              <a href={`/api/auth/oauth/${p.slug}/start?link=1`} className="text-sm text-blue-600">
                {t(p.slug)}
              </a>
            )}
          </div>
        );
      })}
      {stepUpSlug && <StepUpPrompt onSuccess={() => unlink(stepUpSlug)} />}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
