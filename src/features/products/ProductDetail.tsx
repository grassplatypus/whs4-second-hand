"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { STATUS_TRANSITIONS, type Status } from "./categories";

/**
 * GET /api/products/[id]가 내려주는 안전 부분집합에서 좌표(lat/lng)를 뺀 화면 전용 모양이다.
 * API 자체는 동네 수준으로 거칠어진 좌표를 내려주지만(지도 표시 등 후속 기능용), 이 화면은
 * 좌표를 아예 쓰지 않으므로 타입에서부터 배제한다 — 실수로라도 렌더될 길을 구조적으로 막는다.
 * 판매자는 nickname만(이메일/전화/식별정보 금지).
 */
export interface ProductDetailView {
  id: string;
  title: string;
  description: string;
  price: number;
  category: string;
  status: string;
  regionLabel: string | null;
  directPlace: string | null;
  images: { path: string; order: number }[];
  sellerNickname: string;
  createdAt: string;
}

const ERROR_KEYS: Record<string, string> = {
  NOT_FOUND: "notFound",
  FORBIDDEN: "forbidden",
  INVALID_TRANSITION: "invalidTransition",
};

const STATUS_BUTTON_KEY: Record<Status, string> = {
  SELLING: "toSelling",
  RESERVED: "toReserved",
  SOLD: "toSold",
};

export function ProductDetail({ product, isOwner }: { product: ProductDetailView; isOwner: boolean }) {
  const t = useTranslations("product");
  const router = useRouter();

  const [status, setStatus] = useState(product.status);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function changeStatus(next: Status) {
    setError(null);
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/products/${product.id}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ code: undefined }));
        setError(t(ERROR_KEYS[body.code] ?? "failed"));
        return;
      }
      setStatus(next);
      router.refresh();
    } catch {
      setError(t("failed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function doDelete() {
    setError(null);
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/products/${product.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ code: undefined }));
        setError(t(ERROR_KEYS[body.code] ?? "failed"));
        return;
      }
      router.push("/products");
    } catch {
      setError(t("failed"));
    } finally {
      setSubmitting(false);
    }
  }

  const priceLabel = product.price === 0 ? t("free") : `${product.price.toLocaleString()}${t("won")}`;
  const nextStatuses = STATUS_TRANSITIONS[status as Status] ?? [];

  return (
    <div className="flex w-full max-w-2xl flex-col gap-4">
      {product.images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {product.images.map((img) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={img.path}
              src={`/api/media/${img.path}`}
              alt={product.title}
              className="h-40 w-40 rounded object-cover"
            />
          ))}
        </div>
      )}

      <h1 className="text-xl font-semibold">{product.title}</h1>
      <p className="text-lg">{priceLabel}</p>
      <p className="text-sm text-zinc-500">
        <span>{t(`category.${product.category}`)}</span> · <span>{t(`status.${status}`)}</span>
      </p>
      <p className="whitespace-pre-wrap">{product.description}</p>

      <dl className="flex flex-col gap-1 text-sm text-zinc-600">
        {product.regionLabel && (
          <div className="flex justify-between">
            <dd>{product.regionLabel}</dd>
          </div>
        )}
        {product.directPlace && (
          <div className="flex justify-between gap-2">
            <dt>{t("directPlace")}</dt>
            <dd>{product.directPlace}</dd>
          </div>
        )}
        <div className="flex justify-between gap-2">
          <dt>{t("seller")}</dt>
          <dd>
            <a href={`/u/${product.sellerNickname}`} className="text-blue-600 underline">
              {product.sellerNickname}
            </a>
          </dd>
        </div>
      </dl>

      {isOwner ? (
        <div className="flex flex-col gap-3 border-t pt-3">
          <div className="flex gap-2">
            <a href={`/products/${product.id}/edit`} className="rounded border px-3 py-2 text-sm">
              {t("editButton")}
            </a>
            {!confirmingDelete ? (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="rounded border px-3 py-2 text-sm text-red-600"
              >
                {t("deleteButton")}
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span>{t("deleteConfirm")}</span>
                <button
                  type="button"
                  onClick={doDelete}
                  disabled={submitting}
                  className="rounded bg-red-600 px-3 py-2 text-sm text-white disabled:opacity-50"
                >
                  {t("deleteConfirmButton")}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="rounded border px-3 py-2 text-sm"
                >
                  {t("deleteCancel")}
                </button>
              </div>
            )}
          </div>

          {nextStatuses.length > 0 && (
            <div className="flex gap-2">
              {nextStatuses.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void changeStatus(s)}
                  disabled={submitting}
                  className="rounded border px-3 py-2 text-sm disabled:opacity-50"
                >
                  {t(STATUS_BUTTON_KEY[s])}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-1 border-t pt-3">
          <button type="button" disabled className="self-start rounded bg-black px-3 py-2 text-white opacity-50">
            {t("chat")}
          </button>
          <p className="text-xs text-zinc-500">{t("chatComingSoon")}</p>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
