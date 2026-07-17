"use client";

import { useTranslations } from "next-intl";

export function HealthStatus({ db }: { db: boolean }) {
  const t = useTranslations("health");
  return <p role="status">{db ? t("ok") : t("bad")}</p>;
}
