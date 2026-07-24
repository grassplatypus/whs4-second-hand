"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useFormatter } from "next-intl";
import { Card, Field, Input, Button } from "@/features/shell/ui";
import { Avatar } from "@/features/shell/Avatar";
import { STATUS_TRANSITIONS, type Status } from "./categories";
import { ImageGallery } from "./ImageGallery";

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
  sellerAvatarPath: string | null;
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

const STATUS_BADGE_STYLE: Record<string, string> = {
  SELLING: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300",
  RESERVED: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
  SOLD: "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300",
};

export function ProductDetail({ product, isOwner }: { product: ProductDetailView; isOwner: boolean }) {
  const t = useTranslations("product");
  const tc = useTranslations("chat");
  const te = useTranslations("escrow");
  const format = useFormatter();
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

  const priceLabel = product.price === 0 ? t("free") : `${format.number(product.price)}${t("won")}`;
  const nextStatuses = STATUS_TRANSITIONS[status as Status] ?? [];

  return (
    <div className="flex w-full max-w-4xl flex-col gap-4">
      <a
        href="/products"
        className="inline-flex w-fit items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        <span aria-hidden>←</span>
        {t("backToList")}
      </a>

      <div className="grid gap-6 md:grid-cols-2">
        <ImageGallery images={product.images} category={product.category} title={product.title} />

        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">{product.title}</h1>
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                STATUS_BADGE_STYLE[status] ?? "bg-zinc-200 text-zinc-600"
              }`}
            >
              {t(`status.${status}`)}
            </span>
          </div>

          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{priceLabel}</p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t(`category.${product.category}`)}</p>

          <Card className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
            {product.description}
          </Card>

          <Card className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Avatar nickname={product.sellerNickname} src={product.sellerAvatarPath} />
              <div className="flex flex-col">
                <a
                  href={`/u/${encodeURIComponent(product.sellerNickname)}`}
                  className="font-medium text-zinc-900 hover:underline dark:text-zinc-100"
                >
                  {product.sellerNickname}
                </a>
                {product.regionLabel && (
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">{product.regionLabel}</span>
                )}
              </div>
            </div>
            {product.directPlace && (
              <div className="flex justify-between gap-2 border-t border-zinc-100 pt-3 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                <span>{t("directPlace")}</span>
                <span>{product.directPlace}</span>
              </div>
            )}
          </Card>

          {isOwner ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                <a
                  href={`/products/${product.id}/edit`}
                  className="inline-flex items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  {t("editButton")}
                </a>
                {!confirmingDelete ? (
                  <Button type="button" variant="danger" onClick={() => setConfirmingDelete(true)}>
                    {t("deleteButton")}
                  </Button>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-zinc-600 dark:text-zinc-400">{t("deleteConfirm")}</span>
                    <Button type="button" variant="danger" onClick={doDelete} disabled={submitting}>
                      {t("deleteConfirmButton")}
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => setConfirmingDelete(false)}>
                      {t("deleteCancel")}
                    </Button>
                  </div>
                )}
              </div>

              {nextStatuses.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {nextStatuses.map((s) => (
                    <Button
                      key={s}
                      type="button"
                      variant="secondary"
                      onClick={() => void changeStatus(s)}
                      disabled={submitting}
                    >
                      {t(STATUS_BUTTON_KEY[s])}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {!composingChat ? (
                <Button type="button" onClick={() => setComposingChat(true)} className="self-start">
                  {t("chat")}
                </Button>
              ) : (
                <form onSubmit={startChat} className="flex flex-col gap-2" noValidate>
                  <Field label={tc("composeTitle")}>
                    <textarea
                      value={firstText}
                      onChange={(e) => setFirstText(e.target.value)}
                      placeholder={tc("composePlaceholder")}
                      rows={3}
                      className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                    />
                  </Field>
                  <div className="flex gap-2">
                    <Button type="submit" disabled={chatSubmitting}>
                      {tc("send")}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        setComposingChat(false);
                        setFirstText("");
                      }}
                    >
                      {tc("cancel")}
                    </Button>
                  </div>
                </form>
              )}

              {/* 판매중일 때만 안전거래 요청 — 예약중/판매완료면 서비스가 409라 버튼을 숨긴다. */}
              {status === "SELLING" &&
                (!composingEscrow ? (
                  <Button type="button" variant="secondary" onClick={() => setComposingEscrow(true)} className="self-start">
                    {te("request")}
                  </Button>
                ) : (
                  <form onSubmit={startEscrow} className="flex flex-col gap-2" noValidate>
                    <Field label={te("amountInputLabel")}>
                      <Input
                        type="number"
                        min={1}
                        value={escrowAmount}
                        onChange={(e) => setEscrowAmount(e.target.value)}
                      />
                    </Field>
                    <div className="flex gap-2">
                      <Button type="submit" disabled={escrowSubmitting}>
                        {te("requestSubmit")}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          setComposingEscrow(false);
                          setEscrowAmount(String(product.price));
                        }}
                      >
                        {te("cancel")}
                      </Button>
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
      </div>
    </div>
  );
}
