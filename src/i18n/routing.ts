import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["ko", "en"],
  defaultLocale: "ko",
  // NOTE: this project uses next-intl WITHOUT the `[locale]` routing segment
  // (no middleware.ts), so `localeDetection` here has no effect — next-intl's
  // automatic Accept-Language/cookie detection is wired into `createMiddleware`,
  // which we don't use. Locale detection is implemented manually in
  // `src/i18n/request.ts` (cookie first, then Accept-Language, then this
  // defaultLocale) to reproduce the same behavior without routing.
  localeDetection: true,
});

export type AppLocale = (typeof routing.locales)[number];
