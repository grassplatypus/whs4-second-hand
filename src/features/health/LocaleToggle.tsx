"use client";

import { useRouter } from "next/navigation";
import type { AppLocale } from "@/i18n/routing";

export function LocaleToggle() {
  const router = useRouter();

  const set = (locale: AppLocale) => {
    document.cookie = `NEXT_LOCALE=${locale}; path=/; max-age=31536000`;
    router.refresh();
  };

  return (
    <div>
      <button type="button" onClick={() => set("ko")}>
        한국어
      </button>
      <button type="button" onClick={() => set("en")}>
        English
      </button>
    </div>
  );
}
