"use client";

import { useEffect, useState } from "react";

const SAMPLE_CATEGORIES = new Set([
  "DIGITAL", "APPLIANCE", "FURNITURE", "CLOTHING", "BOOK", "BEAUTY", "SPORTS", "ETC",
]);

/**
 * 상품 상세 이미지 갤러리 — 업로드 이미지가 없으면 카테고리 예시 이미지로 폴백,
 * 여러 장이면 썸네일 스트립, 클릭하면 전체화면 라이트박스(theater)로 확대·좌우 이동.
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
  const srcs =
    images.length > 0
      ? images.map((i) => `/api/media/${i.path}`)
      : SAMPLE_CATEGORIES.has(category)
        ? [`/samples/${category}.webp`]
        : [];

  const [sel, setSel] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "ArrowRight") setSel((s) => (s + 1) % srcs.length);
      if (e.key === "ArrowLeft") setSel((s) => (s - 1 + srcs.length) % srcs.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, srcs.length]);

  if (srcs.length === 0) return null;

  return (
    <>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group relative aspect-square w-full overflow-hidden rounded-xl bg-zinc-100 dark:bg-zinc-800"
          aria-label="이미지 크게 보기"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={srcs[sel]} alt={title} className="h-full w-full object-cover" />
          <span className="absolute bottom-2 right-2 rounded-full bg-black/50 px-2 py-0.5 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
            🔍 크게 보기
          </span>
        </button>
        {srcs.length > 1 && (
          <div className="flex gap-2 overflow-x-auto">
            {srcs.map((s, i) => (
              <button
                key={s}
                type="button"
                onClick={() => setSel(i)}
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute right-4 top-4 rounded-full bg-white/10 px-3 py-1.5 text-white hover:bg-white/20"
            aria-label="닫기"
          >
            ✕
          </button>
          {srcs.length > 1 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setSel((s) => (s - 1 + srcs.length) % srcs.length); }}
              className="absolute left-4 rounded-full bg-white/10 px-3 py-2 text-xl text-white hover:bg-white/20"
              aria-label="이전"
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
              aria-label="다음"
            >
              ›
            </button>
          )}
        </div>
      )}
    </>
  );
}
