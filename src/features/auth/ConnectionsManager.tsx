"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card, Button } from "@/features/shell/ui";
import { StepUpPrompt } from "./StepUpPrompt";

const PROVIDERS = [
  { slug: "google", name: "GOOGLE", labelKey: "providerGoogle" },
  { slug: "kakao", name: "KAKAO", labelKey: "providerKakao" },
  { slug: "naver", name: "NAVER", labelKey: "providerNaver" },
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
    <div className="flex flex-col gap-3">
      {PROVIDERS.map((p) => {
        const isConnected = connected.includes(p.name);
        return (
          <Card key={p.slug} className="flex items-center justify-between p-3">
            {isConnected ? (
              <>
                <span className="font-medium text-zinc-900 dark:text-zinc-100">{t(p.labelKey)}</span>
                <span className="flex items-center gap-3">
                  <span className="text-xs text-zinc-400">{t("connected")}</span>
                  <Button type="button" variant="danger" onClick={() => unlink(p.slug)} className="px-2 py-1 text-xs">
                    {t("unlink")}
                  </Button>
                </span>
              </>
            ) : (
              <a
                href={`/api/auth/oauth/${p.slug}/start?link=1`}
                className="text-sm font-medium text-emerald-600 hover:underline dark:text-emerald-400"
              >
                {t(p.slug)}
              </a>
            )}
          </Card>
        );
      })}
      {stepUpSlug && <StepUpPrompt onSuccess={() => unlink(stepUpSlug)} />}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
