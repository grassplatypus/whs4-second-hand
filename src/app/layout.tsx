import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { NavBar } from "@/features/shell/NavBar";
import { getSessionUser } from "@/features/shell/getSessionUser";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return { title: t("title"), description: t("description") };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();
  const user = await getSessionUser();

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-50 dark:bg-zinc-950">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {/* userId는 서버 전용 — 클라이언트 navbar엔 닉네임·역할만 넘긴다(내부 id 직렬화 방지). */}
          <NavBar user={user ? { nickname: user.nickname, role: user.role, avatarPath: user.avatarPath } : null} />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
