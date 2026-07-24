"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

const SAMPLE_CATEGORIES = new Set([
  "DIGITAL", "APPLIANCE", "FURNITURE", "CLOTHING", "BOOK", "BEAUTY", "SPORTS", "ETC",
]);

/**
 * 상품 상세 이미지 갤러리 — 업로드 이미지가 없으면 카테고리 예시 이미지로 폴백,
 * 여러 장이면 썸네일 스트립, 클릭하면 전체화면 라이트박스(theater)로 확대·좌우 이동.
 *
 * 접근성: 라이트박스는 role="dialog" + aria-label(상품명)을 갖고, 열릴 때 포커스가 안으로
 * 들어가고, Tab이 다이얼로그 안의 버튼들 사이에서만 순환하며(포커스 트랩), 닫히면 포커스가
 * 이 갤러리를 열었던 버튼으로 돌아간다.
 */
export function ImageGallery({
  images,
  category,
  title,
}: {
  images: { path: string; order: number }[];
  category: string;
  title: string;
}) {
  const t = useTranslations("product");
  const tc = useTranslations("common");

  const srcs =
    images.length > 0
      ? images.map((i) => `/api/media/${i.path}`)
      : SAMPLE_CATEGORIES.has(category)
        ? [`/samples/${category}.webp`]
        : [];

  const [sel, setSel] = useState(0);
  const [open, setOpen] = useState(false);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // 열릴 때 다이얼로그 안으로 포커스를 옮기고, 닫힐 때(정리 함수) 트리거 버튼으로 되돌린다.
  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    return () => {
      triggerRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key === "ArrowRight") setSel((s) => (s + 1) % srcs.length);
      if (e.key === "ArrowLeft") setSel((s) => (s - 1 + srcs.length) % srcs.length);
      if (e.key === "Tab") {
        const focusables = dialogRef.current?.querySelectorAll<HTMLButtonElement>("button");
        if (!focusables || focusables.length === 0) return;
        const list = Array.from(focusables);
        const first = list[0];
        const last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, srcs.length]);

  if (srcs.length === 0) return null;

  return (
    <>
      <div className="flex flex-col gap-2">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(true)}
          className="group relative aspect-square w-full overflow-hidden rounded-xl bg-zinc-100 dark:bg-zinc-800"
          aria-label={t("viewLargeImageAria")}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={srcs[sel]} alt={title} className="h-full w-full object-cover" />
          <span className="absolute bottom-2 right-2 rounded-full bg-black/50 px-2 py-0.5 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
            🔍 {t("viewLargeImage")}
          </span>
        </button>
        {srcs.length > 1 && (
          <div className="flex gap-2 overflow-x-auto">
            {srcs.map((s, i) => (
              <button
                key={s}
                type="button"
                onClick={() => setSel(i)}
                aria-label={t("thumbnailAria", { index: i + 1 })}
                aria-current={i === sel ? "true" : undefined}
                className={`h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 ${i === sel ? "border-emerald-500" : "border-transparent"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      {open && (
        <div
          ref={dialogRef}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          tabIndex={-1}
        >
          <button
            ref={closeButtonRef}
            type="button"
            onClick={() => setOpen(false)}
            className="absolute right-4 top-4 rounded-full bg-white/10 px-3 py-1.5 text-white hover:bg-white/20"
            aria-label={tc("close")}
          >
            ✕
          </button>
          {srcs.length > 1 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setSel((s) => (s - 1 + srcs.length) % srcs.length); }}
              className="absolute left-4 rounded-full bg-white/10 px-3 py-2 text-xl text-white hover:bg-white/20"
              aria-label={tc("prev")}
            >
              ‹
            </button>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={srcs[sel]}
            alt={title}
            className="max-h-full max-w-full rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          {srcs.length > 1 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setSel((s) => (s + 1) % srcs.length); }}
              className="absolute right-4 rounded-full bg-white/10 px-3 py-2 text-xl text-white hover:bg-white/20"
              aria-label={tc("next")}
            >
              ›
            </button>
          )}
        </div>
      )}
    </>
  );
}
