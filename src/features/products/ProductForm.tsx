"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card, PageHeader, Field, Input, Select, Button } from "@/features/shell/ui";
import { CATEGORIES } from "./categories";

export interface ProductFormInitial {
  title: string;
  price: number;
  category: string;
  description: string;
  directPlace: string | null;
  images: { path: string; order: number }[];
}

const ERROR_KEYS: Record<string, string> = {
  NOT_FOUND: "notFound",
  FORBIDDEN: "forbidden",
  INVALID_IMAGE: "invalidImage",
  UPLOAD_FAILED: "invalidImage",
};

const textareaClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";

/** 가격 입력에서 콤마·공백 등 숫자가 아닌 문자를 전부 제거한다 — 붙여넣기도 이 한 경로를 탄다. */
function digitsOnly(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

/** 순수 숫자 문자열을 화면 표시용 3자리 콤마 형식으로 바꾼다(내부 상태는 항상 순수 숫자로 유지). */
function formatPriceDisplay(digits: string): string {
  if (!digits) return "";
  return Number(digits).toLocaleString("en-US");
}

/**
 * 등록/수정 겸용 폼. 이미지 추가/삭제는 등록·수정 모두에서 연다 — 서버의 수정 스키마
 * (productUpdateSchema)도 등록과 동일한 검증으로 images를 받아, 배열이 오면 상품 이미지
 * 전체를 그 배열로 교체한다(service.ts 참고).
 *
 * hasLocation: 등록 페이지가 서버에서 미리 조회해 내려준다 — 판매자의 동네가 아직 없으면
 * 폼을 채우기 전부터 배너로 안내한다(실제 차단은 언제나 서버의 NO_LOCATION 응답이 최종 판단).
 */
export function ProductForm({
  mode,
  productId,
  initial,
  hasLocation,
}: {
  mode: "create" | "edit";
  productId?: string;
  initial?: ProductFormInitial;
  hasLocation?: boolean;
}) {
  const t = useTranslations("product");
  const router = useRouter();

  const [title, setTitle] = useState(initial?.title ?? "");
  const [price, setPrice] = useState(initial ? String(initial.price) : "0");
  const [category, setCategory] = useState(initial?.category ?? CATEGORIES[0]);
  const [description, setDescription] = useState(initial?.description ?? "");
  const [directPlace, setDirectPlace] = useState(initial?.directPlace ?? "");
  const [images, setImages] = useState<string[]>(initial?.images?.map((i) => i.path) ?? []);

  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noLocation, setNoLocation] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const initialSnapshot = useRef(
    JSON.stringify({
      title: initial?.title ?? "",
      price: initial ? String(initial.price) : "0",
      category: initial?.category ?? CATEGORIES[0],
      description: initial?.description ?? "",
      directPlace: initial?.directPlace ?? "",
      images: initial?.images?.map((i) => i.path) ?? [],
    }),
  );
  const dirty =
    !submitted &&
    JSON.stringify({ title, price, category, description, directPlace, images }) !== initialSnapshot.current;

  // 탭을 닫거나 새로고침할 때: 저장하지 않은 편집 내용이 있으면 브라우저 기본 확인창을 띄운다.
  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  function goBack() {
    router.push(mode === "create" ? "/products" : `/products/${productId}`);
  }

  function onCancel() {
    if (dirty && !window.confirm(t("unsavedChangesConfirm"))) return;
    goBack();
  }

  async function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch("/api/products/images", { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ code: undefined }));
        setError(t(ERROR_KEYS[body.code] ?? "invalidImage"));
        return;
      }
      const body = (await res.json()) as { path: string };
      setImages((prev) => [...prev, body.path]);
    } catch {
      setError(t("invalidImage"));
    } finally {
      setUploading(false);
    }
  }

  function removeImage(path: string) {
    setImages((prev) => prev.filter((p) => p !== path));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNoLocation(false);
    if (submitting) return;
    // 가격을 비워 두면 0원(나눔)으로 잘못 등록되므로, 값이 없으면 먼저 알려준다.
    if (price.trim() === "") {
      setError(t("priceRequired"));
      return;
    }
    setSubmitting(true);
    try {
      const common = {
        title,
        price: Number(price),
        category,
        description,
        directPlace: directPlace.trim() ? directPlace : undefined,
      };
      const payload = { ...common, images };

      const res = await fetch(mode === "create" ? "/api/products" : `/api/products/${productId}`, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ code: undefined }));
        if (body.code === "NO_LOCATION") {
          setNoLocation(true);
          return;
        }
        setError(t(ERROR_KEYS[body.code] ?? "failed"));
        return;
      }

      setSubmitted(true);
      if (mode === "create") {
        const body = (await res.json()) as { id: string };
        router.push(`/products/${body.id}`);
      } else {
        router.push(`/products/${productId}`);
      }
    } catch {
      setError(t("failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex w-full max-w-2xl flex-col gap-5">
      <PageHeader title={mode === "create" ? t("newTitle") : t("editTitle")} />

      {hasLocation === false && (
        <div className="flex flex-col gap-1 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <span>{t("noLocation")}</span>
          <a href="/settings/location" className="font-medium underline">
            {t("goToLocationSettings")}
          </a>
        </div>
      )}

      <Card>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Field label={t("titleLabel")}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>

          <Field label={t("price")}>
            <Input
              type="text"
              inputMode="numeric"
              value={formatPriceDisplay(price)}
              onChange={(e) => setPrice(digitsOnly(e.target.value))}
            />
          </Field>

          <Field label={t("categoryLabel")}>
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`category.${c}`)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t("description")}>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              className={textareaClass}
            />
          </Field>

          <Field label={t("directPlace")}>
            <Input value={directPlace} onChange={(e) => setDirectPlace(e.target.value)} />
          </Field>

          <div className="flex flex-col gap-2">
            <Field label={t("addImage")}>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => void onFileChange(e)}
                disabled={uploading}
                className="text-sm text-zinc-600 dark:text-zinc-300"
              />
            </Field>
            {images.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {images.map((path, i) => (
                  <li key={path} className="flex flex-col items-center gap-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/media/${path}`}
                      alt={t("imagePreviewAlt", { index: i + 1 })}
                      className="h-16 w-16 rounded-lg object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(path)}
                      aria-label={t("removeImageAria", { index: i + 1 })}
                      className="text-xs text-red-600"
                    >
                      {t("deleteButton")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={submitting || uploading}>
              {mode === "create" ? t("createButton") : t("editButton")}
            </Button>
            <Button type="button" variant="secondary" onClick={onCancel}>
              {t("cancelButton")}
            </Button>
          </div>

          {noLocation && (
            <p role="alert" className="flex flex-col gap-1 text-sm text-red-600">
              {t("noLocation")}
              <a href="/settings/location" className="text-blue-600 underline">
                {t("goToLocationSettings")}
              </a>
            </p>
          )}

          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
        </form>
      </Card>
    </div>
  );
}
