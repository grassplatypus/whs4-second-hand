"use client";

import { useState, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type ButtonHTMLAttributes } from "react";
import { useTranslations } from "next-intl";

/** 공통 카드 컨테이너. */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 ${className}`}>
      {children}
    </div>
  );
}

/**
 * 모든 페이지의 공통 컨테이너 — 좌우 패딩·최대폭·상단정렬을 한 곳에서 통일한다.
 * (페이지마다 px-4 누락·정렬 제각각이던 문제를 근본 해소.)
 */
export function PageContainer({
  children,
  size = "md",
  className = "",
}: {
  children: ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const max = size === "sm" ? "max-w-md" : size === "lg" ? "max-w-5xl" : "max-w-2xl";
  return (
    <main className={`mx-auto flex w-full flex-1 flex-col gap-6 px-4 py-10 ${max} ${className}`}>
      {children}
    </main>
  );
}

/** 페이지 헤더(제목 + 선택적 설명). */
export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">{title}</h1>
      {subtitle && <p className="text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
    </div>
  );
}

/** 라벨 + 입력 필드 래퍼. */
export function Field({ label, children, hint, error }: { label?: string; children: ReactNode; hint?: string; error?: string | null }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      {label && <span className="font-medium text-zinc-700 dark:text-zinc-300">{label}</span>}
      {children}
      {hint && !error && <span className="text-xs text-zinc-400">{hint}</span>}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </label>
  );
}

const inputBase =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputBase} ${props.className ?? ""}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputBase} cursor-pointer ${props.className ?? ""}`} />;
}

/** 표시/숨김 토글이 있는 비밀번호 입력. */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [show, setShow] = useState(false);
  const t = useTranslations("common");
  return (
    <div className="relative">
      <input {...props} type={show ? "text" : "password"} className={`${inputBase} pr-16 ${props.className ?? ""}`} />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? t("hide") : t("show")}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        {show ? t("hide") : t("show")}
      </button>
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" };
const variants: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-emerald-600 text-white hover:bg-emerald-700",
  secondary: "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800",
  danger: "border border-red-300 bg-white text-red-600 hover:bg-red-50 dark:border-red-800 dark:bg-zinc-900",
  ghost: "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
};

export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${variants[variant]} ${className}`}
    />
  );
}

/** 빈 상태(데이터 없음) 표시. */
export function EmptyState({ icon = "📭", title, action }: { icon?: string; title: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-zinc-300 py-16 text-center dark:border-zinc-700">
      <span className="text-3xl">{icon}</span>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{title}</p>
      {action}
    </div>
  );
}

/** 인증/폼 페이지용 중앙 정렬 카드 래퍼. */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
        </div>
        <Card className="flex flex-col gap-4">{children}</Card>
      </div>
    </main>
  );
}
