"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Avatar } from "./Avatar";
import type { SessionUser } from "./getSessionUser";

const NAV = [
  { href: "/products", key: "products" },
  { href: "/chat", key: "chat" },
  { href: "/escrow", key: "escrow" },
] as const;

export function NavBar({ user }: { user: SessionUser | null }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      setOpen(false);
      router.push("/");
      router.refresh();
    }
  }

  const active = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4">
        <Link href="/" className="flex items-center gap-1.5 font-bold tracking-tight">
          <span className="text-lg">🌿</span>
          <span className="hidden sm:inline">{t("brand")}</span>
        </Link>

        <nav className="hidden items-center gap-1 sm:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                active(item.href)
                  ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                  : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900"
              }`}
            >
              {t(item.key)}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <>
              {user.role === "ADMIN" && (
                <Link
                  href="/admin"
                  className="hidden rounded-md px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 sm:inline dark:text-emerald-400 dark:hover:bg-emerald-950"
                >
                  {t("admin")}
                </Link>
              )}
              <Link
                href="/settings"
                className="hidden rounded-md px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 sm:inline dark:text-zinc-400 dark:hover:bg-zinc-900"
              >
                {t("settings")}
              </Link>
              <Link
                href="/mypage"
                className="hidden items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 sm:inline-flex dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                <Avatar nickname={user.nickname} size={24} />
                {user.nickname}
              </Link>
              <button
                type="button"
                onClick={() => void logout()}
                disabled={loggingOut}
                className="hidden rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 sm:inline dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                {t("logout")}
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="hidden rounded-md px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 sm:inline dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                {t("login")}
              </Link>
              <Link
                href="/signup"
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                {t("register")}
              </Link>
            </>
          )}

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={t("menu")}
            className="rounded-md p-1.5 text-zinc-600 hover:bg-zinc-100 sm:hidden dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="4" y1="7" x2="20" y2="7" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="17" x2="20" y2="17" />
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-zinc-200 px-4 py-2 sm:hidden dark:border-zinc-800">
          <nav className="flex flex-col gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                {t(item.key)}
              </Link>
            ))}
            <div className="my-1 h-px bg-zinc-200 dark:bg-zinc-800" />
            {user ? (
              <>
                {user.role === "ADMIN" && (
                  <Link href="/admin" onClick={() => setOpen(false)} className="rounded-md px-3 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                    {t("admin")}
                  </Link>
                )}
                <Link href="/mypage" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  <Avatar nickname={user.nickname} size={22} />
                  {user.nickname}
                </Link>
                <Link href="/settings" onClick={() => setOpen(false)} className="rounded-md px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  {t("settings")}
                </Link>
                <button type="button" onClick={() => void logout()} disabled={loggingOut} className="rounded-md px-3 py-2 text-left text-sm font-medium text-zinc-700 disabled:opacity-50 dark:text-zinc-300">
                  {t("logout")}
                </button>
              </>
            ) : (
              <>
                <Link href="/login" onClick={() => setOpen(false)} className="rounded-md px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  {t("login")}
                </Link>
                <Link href="/signup" onClick={() => setOpen(false)} className="rounded-md px-3 py-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                  {t("register")}
                </Link>
              </>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
