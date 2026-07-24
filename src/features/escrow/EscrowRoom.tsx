"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { EscrowStatus } from "./EscrowList";

/**
 * GET /api/escrow/[id]가 내려주는 안전 상세 — 상대는 닉네임만(이메일/전화/상대 userId 원본 금지).
 * at/createdAt은 JSON 직렬화라 문자열이다.
 */
export interface EscrowEventView {
  status: EscrowStatus;
  amount: number | null;
  note: string | null;
  at: string;
  actor: "me" | "other" | "admin";
}
export interface EscrowDetailView {
  id: string;
  status: EscrowStatus;
  amount: number;
  myRole: "buyer" | "seller";
  myTurn: boolean;
  counterparty: { nickname: string };
  product: { id: string; title: string; status: string };
  events: EscrowEventView[];
  createdAt: string;
}

/** 서비스가 던지는 코드 → escrow 카탈로그 키. 서버 message 원문은 절대 렌더하지 않는다. */
const ERROR_KEYS: Record<string, string> = {
  SELF_TRADE: "selfTrade",
  PRODUCT_UNAVAILABLE: "productUnavailable",
  INVALID_TRANSITION: "invalidTransition",
  NOT_YOUR_TURN: "notYourTurn",
  CANNOT_ACCEPT_OWN: "cannotAcceptOwn",
  INVALID_AMOUNT: "invalidAmount",
  INVALID_INPUT: "invalidAmount",
  FORBIDDEN: "forbidden",
  NOT_FOUND: "notFound",
  UNAUTHENTICATED: "unauthenticated",
};

async function readErrorCode(res: Response): Promise<string | undefined> {
  const body = await res.json().catch(() => ({ code: undefined }));
  return (body as { code?: string }).code;
}

export function EscrowRoom({ escrowId }: { escrowId: string }) {
  const t = useTranslations("escrow");

  const [detail, setDetail] = useState<EscrowDetailView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [countering, setCountering] = useState(false);
  const [counterAmount, setCounterAmount] = useState("");
  const [disputing, setDisputing] = useState(false);
  const [disputeNote, setDisputeNote] = useState("");

  const loadDetail = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(`/api/escrow/${escrowId}`);
      if (!res.ok) {
        const code = await readErrorCode(res);
        setLoadError(t(ERROR_KEYS[code ?? ""] ?? "failed"));
        return;
      }
      const body = (await res.json()) as EscrowDetailView;
      setDetail(body);
    } catch {
      setLoadError(t("failed"));
    } finally {
      setLoading(false);
    }
  }, [escrowId, t]);

  useEffect(() => {
    setLoading(true);
    void loadDetail();
  }, [loadDetail]);

  async function runAction(path: string, body?: Record<string, unknown>) {
    if (submitting) return;
    setActionError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/escrow/${escrowId}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      if (!res.ok) {
        const code = await readErrorCode(res);
        setActionError(t(ERROR_KEYS[code ?? ""] ?? "failed"));
        return;
      }
      setCountering(false);
      setCounterAmount("");
      setDisputing(false);
      setDisputeNote("");
      // 어떤 행동이든 성공 후 상세를 다시 불러 버튼·타임라인을 갱신한다.
      await loadDetail();
    } catch {
      setActionError(t("failed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitCounter(event: React.FormEvent) {
    event.preventDefault();
    const amount = Number(counterAmount);
    if (!Number.isInteger(amount) || amount <= 0) {
      setActionError(t("invalidAmount"));
      return;
    }
    await runAction("/counter", { amount });
  }

  async function submitDispute(event: React.FormEvent) {
    event.preventDefault();
    const note = disputeNote.trim();
    await runAction("/dispute", note ? { note } : undefined);
  }

  const money = (n: number) => `${n.toLocaleString()}${t("won")}`;

  function actorLabel(actor: EscrowEventView["actor"]): string {
    if (actor === "me") return t("actorMe");
    if (actor === "other") return t("actorOther");
    return t("actorAdmin");
  }

  return (
    <div className="flex w-full max-w-lg flex-col gap-4">
      <div className="flex flex-col gap-1 border-b pb-2">
        <h1 className="text-lg font-semibold">{t("roomTitle")}</h1>
        {detail && (
          <a href={`/products/${detail.product.id}`} className="text-xs text-blue-600 underline">
            {t("viewProduct")}
          </a>
        )}
      </div>

      {loadError && (
        <p role="alert" className="text-sm text-red-600">
          {loadError}
        </p>
      )}

      {detail && (
        <>
          <dl className="flex flex-col gap-1 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-zinc-500">{t("counterparty")}</dt>
              <dd>{detail.counterparty.nickname}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-zinc-500">{t("amountLabel")}</dt>
              <dd className="font-medium">{money(detail.amount)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-zinc-500">{t("statusLabel")}</dt>
              <dd>
                <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">
                  {t(`status.${detail.status}`)}
                </span>
              </dd>
            </div>
          </dl>

          <div className="flex flex-col gap-2 border-t pt-3">
            {detail.status === "REQUESTED" && detail.myTurn && (
              <>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void runAction("/accept")}
                    disabled={submitting}
                    className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50"
                  >
                    {t("accept")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCountering((v) => !v)}
                    disabled={submitting}
                    className="rounded border px-3 py-2 text-sm disabled:opacity-50"
                  >
                    {t("counter")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void runAction("/cancel")}
                    disabled={submitting}
                    className="rounded border px-3 py-2 text-sm text-red-600 disabled:opacity-50"
                  >
                    {t("cancel")}
                  </button>
                </div>
                {countering && (
                  <form onSubmit={submitCounter} className="flex flex-col gap-2" noValidate>
                    <label className="flex flex-col gap-1 text-sm">
                      {t("amountInputLabel")}
                      <input
                        type="number"
                        min={1}
                        value={counterAmount}
                        onChange={(e) => setCounterAmount(e.target.value)}
                        className="rounded border px-2 py-1"
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="self-start rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50"
                    >
                      {t("counterSubmit")}
                    </button>
                  </form>
                )}
              </>
            )}

            {detail.status === "REQUESTED" && !detail.myTurn && (
              <>
                <p className="text-sm text-zinc-500">{t("waitingReply")}</p>
                <button
                  type="button"
                  onClick={() => void runAction("/cancel")}
                  disabled={submitting}
                  className="self-start rounded border px-3 py-2 text-sm text-red-600 disabled:opacity-50"
                >
                  {t("cancel")}
                </button>
              </>
            )}

            {detail.status === "ACCEPTED" && detail.myRole === "buyer" && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void runAction("/fund")}
                  disabled={submitting}
                  className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50"
                >
                  {t("fund")}
                </button>
                <button
                  type="button"
                  onClick={() => void runAction("/cancel")}
                  disabled={submitting}
                  className="rounded border px-3 py-2 text-sm text-red-600 disabled:opacity-50"
                >
                  {t("cancel")}
                </button>
              </div>
            )}

            {detail.status === "ACCEPTED" && detail.myRole === "seller" && (
              <>
                <p className="text-sm text-zinc-500">{t("waitingFund")}</p>
                <button
                  type="button"
                  onClick={() => void runAction("/cancel")}
                  disabled={submitting}
                  className="self-start rounded border px-3 py-2 text-sm text-red-600 disabled:opacity-50"
                >
                  {t("cancel")}
                </button>
              </>
            )}

            {detail.status === "FUNDED" && detail.myRole === "buyer" && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void runAction("/confirm")}
                  disabled={submitting}
                  className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50"
                >
                  {t("confirm")}
                </button>
                <button
                  type="button"
                  onClick={() => setDisputing((v) => !v)}
                  disabled={submitting}
                  className="rounded border px-3 py-2 text-sm disabled:opacity-50"
                >
                  {t("dispute")}
                </button>
              </div>
            )}

            {detail.status === "FUNDED" && detail.myRole === "seller" && (
              <>
                <p className="text-sm text-zinc-500">{t("waitingConfirm")}</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void runAction("/refund")}
                    disabled={submitting}
                    className="rounded border px-3 py-2 text-sm disabled:opacity-50"
                  >
                    {t("refund")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDisputing((v) => !v)}
                    disabled={submitting}
                    className="rounded border px-3 py-2 text-sm disabled:opacity-50"
                  >
                    {t("dispute")}
                  </button>
                </div>
              </>
            )}

            {detail.status === "FUNDED" && disputing && (
              <form onSubmit={submitDispute} className="flex flex-col gap-2" noValidate>
                <label className="flex flex-col gap-1 text-sm">
                  {t("disputeNotePlaceholder")}
                  <textarea
                    value={disputeNote}
                    onChange={(e) => setDisputeNote(e.target.value)}
                    className="rounded border px-2 py-1"
                  />
                </label>
                <button
                  type="submit"
                  disabled={submitting}
                  className="self-start rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50"
                >
                  {t("disputeSubmit")}
                </button>
              </form>
            )}

            {detail.status === "RELEASED" && <p className="text-sm text-green-700">{t("doneReleased")}</p>}
            {detail.status === "REFUNDED" && <p className="text-sm text-zinc-600">{t("doneRefunded")}</p>}
            {detail.status === "CANCELLED" && <p className="text-sm text-zinc-500">{t("doneCancelled")}</p>}
            {detail.status === "DISPUTED" && <p className="text-sm text-amber-700">{t("disputedState")}</p>}
          </div>

          {actionError && (
            <p role="alert" className="text-sm text-red-600">
              {actionError}
            </p>
          )}

          <ol className="flex flex-col gap-2 border-t pt-3">
            {detail.events.map((ev, i) => (
              <li key={i} className="flex flex-col gap-0.5 rounded border px-3 py-2 text-sm">
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium">{t(`status.${ev.status}`)}</span>
                  <span className="text-xs text-zinc-500">{actorLabel(ev.actor)}</span>
                </span>
                {ev.amount !== null && <span>{money(ev.amount)}</span>}
                {ev.note && <span className="whitespace-pre-wrap text-zinc-600">{ev.note}</span>}
                <span className="text-xs text-zinc-400">{new Date(ev.at).toLocaleString()}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
