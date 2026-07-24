"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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

/**
 * 등록/수정 겸용 폼. 이미지 업로드는 등록(create) 모드에서만 연다 — 서버의 수정 스키마
 * (productUpdateSchema)가 images를 애초에 받지 않기 때문(후속 태스크 소관, service.ts 주석 참고).
 */
export function ProductForm({
  mode,
  productId,
  initial,
}: {
  mode: "create" | "edit";
  productId?: string;
  initial?: ProductFormInitial;
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
    setSubmitting(true);
    try {
      const common = {
        title,
        price: Number(price),
        category,
        description,
        directPlace: directPlace.trim() ? directPlace : undefined,
      };
      const payload = mode === "create" ? { ...common, images } : common;

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
    <form onSubmit={submit} className="flex w-full max-w-md flex-col gap-3" noValidate>
      <h1 className="text-xl font-semibold">{mode === "create" ? t("newTitle") : t("editTitle")}</h1>

      <label className="flex flex-col gap-1">
        {t("titleLabel")}
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="rounded border px-2 py-1" />
      </label>

      <label className="flex flex-col gap-1">
        {t("price")}
        <input
          type="number"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="rounded border px-2 py-1"
        />
      </label>

      <label className="flex flex-col gap-1">
        {t("categoryLabel")}
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded border px-2 py-1">
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`category.${c}`)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        {t("description")}
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="rounded border px-2 py-1"
        />
      </label>

      <label className="flex flex-col gap-1">
        {t("directPlace")}
        <input
          value={directPlace}
          onChange={(e) => setDirectPlace(e.target.value)}
          className="rounded border px-2 py-1"
        />
      </label>

      {mode === "create" && (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            {t("addImage")}
            <input type="file" accept="image/*" onChange={(e) => void onFileChange(e)} disabled={uploading} />
          </label>
          {images.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {images.map((path) => (
                <li key={path} className="flex flex-col items-center gap-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/media/${path}`} alt="" className="h-16 w-16 rounded object-cover" />
                  <button type="button" onClick={() => removeImage(path)} className="text-xs text-red-600">
                    {t("deleteButton")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || uploading}
        className="rounded bg-black px-3 py-2 text-white disabled:opacity-50"
      >
        {mode === "create" ? t("createButton") : t("editButton")}
      </button>

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
  );
}
