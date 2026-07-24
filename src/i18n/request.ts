import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { routing, type AppLocale } from "./routing";

const LOCALE_COOKIE = "NEXT_LOCALE";

function isSupportedLocale(value: string | undefined): value is AppLocale {
  return !!value && (routing.locales as readonly string[]).includes(value);
}

/**
 * Picks the first locale from an `Accept-Language` header that we support.
 * Deliberately simple (no quality-value weighting) — good enough to tell
 * "browser prefers Korean" from "browser prefers English".
 */
function pickFromAcceptLanguage(acceptLanguage: string | null): AppLocale | undefined {
  if (!acceptLanguage) return undefined;
  const tags = acceptLanguage.split(",").map((part) => part.split(";")[0]?.trim().toLowerCase());
  for (const tag of tags) {
    const lang = tag?.split("-")[0];
    if (isSupportedLocale(lang)) return lang;
  }
  return undefined;
}

/**
 * This project uses next-intl WITHOUT the `[locale]` routing segment
 * (no middleware.ts). That means `requestLocale` (normally populated by
 * next-intl's middleware from the matched route segment) is always
 * `undefined` here — see next-intl's `GetRequestConfigParams.requestLocale`
 * docs. So we resolve the locale ourselves:
 *   1. `NEXT_LOCALE` cookie (set by `LocaleToggle` on user toggle)
 *   2. `Accept-Language` header (browser locale, first visit)
 *   3. `routing.defaultLocale` fallback
 */
export default getRequestConfig(async () => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);

  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  const locale: AppLocale = isSupportedLocale(cookieLocale)
    ? cookieLocale
    : (pickFromAcceptLanguage(headerStore.get("accept-language")) ?? routing.defaultLocale);

  return {
    locale,
    // 날짜·시간은 항상 서울(KST) 기준으로 표시한다 — 서버/클라이언트 시간대가 달라도 일관.
    timeZone: "Asia/Seoul",
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});
