import { useTranslations } from "next-intl";

const PROVIDERS = ["google", "kakao", "naver"] as const;

// 서버 컴포넌트에서도 쓸 수 있게 순수 링크만. 폼이 아니라 top-level 네비게이션(GET)이라
// SameSite=Lax 쿠키가 정상 전송된다.
export function SocialButtons() {
  const t = useTranslations("auth.oauth");
  return (
    <div className="flex w-80 flex-col gap-2">
      {PROVIDERS.map((p) => (
        <a
          key={p}
          href={`/api/auth/oauth/${p}/start`}
          className="rounded border px-3 py-2 text-center"
        >
          {t(p)}
        </a>
      ))}
    </div>
  );
}
