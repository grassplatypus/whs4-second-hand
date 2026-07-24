import { useTranslations } from "next-intl";

const PROVIDERS = ["google", "kakao", "naver"] as const;

// 서버 컴포넌트에서도 쓸 수 있게 순수 링크만. 폼이 아니라 top-level 네비게이션(GET)이라
// SameSite=Lax 쿠키가 정상 전송된다.
export function SocialButtons() {
  const t = useTranslations("auth.oauth");
  return (
    <div className="flex flex-col gap-2">
      {PROVIDERS.map((p) => (
        <a
          key={p}
          href={`/api/auth/oauth/${p}/start`}
          className="inline-flex items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          {t(p)}
        </a>
      ))}
    </div>
  );
}
