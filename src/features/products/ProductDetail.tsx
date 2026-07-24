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

/** POST /api/chat/conversations가 던지는 서비스 코드 → chat 카탈로그 키. */
const CHAT_ERROR_KEYS: Record<string, string> = {
  NOT_FOUND: "notFound",
  FORBIDDEN: "forbidden",
  BLOCKED: "blocked",
  SELF_CHAT: "selfChat",
  EMPTY_MESSAGE: "emptyMessage",
};

/** POST /api/escrow가 던지는 서비스 코드 → escrow 카탈로그 키. */
const ESCROW_ERROR_KEYS: Record<string, string> = {
  SELF_TRADE: "selfTrade",
  PRODUCT_UNAVAILABLE: "productUnavailable",
  INVALID_AMOUNT: "invalidAmount",
  INVALID_INPUT: "invalidAmount",
  FORBIDDEN: "forbidden",
  NOT_FOUND: "notFound",
  UNAUTHENTICATED: "unauthenticated",
};

const STATUS_BUTTON_KEY: Record<Status, string> = {
  SELLING: "toSelling",
  RESERVED: "toReserved",
  SOLD: "toSold",
};

export function ProductDetail({ product, isOwner }: { product: ProductDetailView; isOwner: boolean }) {
  const t = useTranslations("product");
  const tc = useTranslations("chat");
  const te = useTranslations("escrow");
  const router = useRouter();

  const [status, setStatus] = useState(product.status);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const [composingChat, setComposingChat] = useState(false);
  const [firstText, setFirstText] = useState("");
  const [chatSubmitting, setChatSubmitting] = useState(false);

  const [composingEscrow, setComposingEscrow] = useState(false);
  const [escrowAmount, setEscrowAmount] = useState(String(product.price));
  const [escrowSubmitting, setEscrowSubmitting] = useState(false);

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

  async function startChat(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (chatSubmitting) return;
    if (!firstText.trim()) {
      setError(tc("emptyMessage"));
      return;
    }
    setChatSubmitting(true);
    try {
      const res = await fetch("/api/chat/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productId: product.id, firstText }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ code: undefined }));
        setError(tc(CHAT_ERROR_KEYS[body.code] ?? "failed"));
        return;
      }
      const body = (await res.json()) as { conversationId: string };
      router.push(`/chat/${body.conversationId}`);
    } catch {
      setError(tc("failed"));
    } finally {
      setChatSubmitting(false);
    }
  }

  async function startEscrow(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (escrowSubmitting) return;
    const amount = Number(escrowAmount);
    if (!Number.isInteger(amount) || amount <= 0) {
      setError(te("invalidAmount"));
      return;
    }
    setEscrowSubmitting(true);
    try {
      const res = await fetch("/api/escrow", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productId: product.id, amount }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ code: undefined }));
        setError(te(ESCROW_ERROR_KEYS[body.code] ?? "failed"));
        return;
      }
      const body = (await res.json()) as { id: string };
      router.push(`/escrow/${body.id}`);
    } catch {
      setError(te("failed"));
    } finally {
      setEscrowSubmitting(false);
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
        <div className="flex flex-col gap-2 border-t pt-3">
          {!composingChat ? (
            <button
              type="button"
              onClick={() => setComposingChat(true)}
              className="self-start rounded bg-black px-3 py-2 text-white"
            >
              {t("chat")}
            </button>
          ) : (
            <form onSubmit={startChat} className="flex flex-col gap-2" noValidate>
              <label className="flex flex-col gap-1 text-sm">
                {tc("composeTitle")}
                <textarea
                  value={firstText}
                  onChange={(e) => setFirstText(e.target.value)}
                  placeholder={tc("composePlaceholder")}
                  className="rounded border px-2 py-1"
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={chatSubmitting}
                  className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50"
                >
                  {tc("send")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setComposingChat(false);
                    setFirstText("");
                  }}
                  className="rounded border px-3 py-2 text-sm"
                >
                  {tc("cancel")}
                </button>
              </div>
            </form>
          )}

          {/* 판매중일 때만 안전거래 요청 — 예약중/판매완료면 서비스가 409라 버튼을 숨긴다. */}
          {status === "SELLING" &&
            (!composingEscrow ? (
            <button
              type="button"
              onClick={() => setComposingEscrow(true)}
              className="self-start rounded border px-3 py-2 text-sm"
            >
              {te("request")}
            </button>
          ) : (
            <form onSubmit={startEscrow} className="flex flex-col gap-2" noValidate>
              <label className="flex flex-col gap-1 text-sm">
                {te("amountInputLabel")}
                <input
                  type="number"
                  min={1}
                  value={escrowAmount}
                  onChange={(e) => setEscrowAmount(e.target.value)}
                  className="rounded border px-2 py-1"
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={escrowSubmitting}
                  className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50"
                >
                  {te("requestSubmit")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setComposingEscrow(false);
                    setEscrowAmount(String(product.price));
                  }}
                  className="rounded border px-3 py-2 text-sm"
                >
                  {te("cancel")}
                </button>
              </div>
            </form>
          ))}
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
