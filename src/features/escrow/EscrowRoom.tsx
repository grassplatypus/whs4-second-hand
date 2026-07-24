"use client";

import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Card, PageHeader, Button } from "@/features/shell/ui";
import { Avatar } from "@/features/shell/Avatar";
import { STATUS_BADGE_STYLE, type EscrowStatus } from "./EscrowList";

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

/** 서버가 주는 날짜 문자열을 안전하게 포맷한다 — 파싱 실패는 "—"로. */
function formatDate(iso: string, format: ReturnType<typeof useFormatter>): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return format.dateTime(d, { dateStyle: "medium", timeStyle: "short" });
}

const textInputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";

export function EscrowRoom({ escrowId }: { escrowId: string }) {
  const t = useTranslations("escrow");
  const format = useFormatter();

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

  const money = (n: number) => `${format.number(n)}${t("won")}`;

  function actorLabel(actor: EscrowEventView["actor"]): string {
    if (actor === "me") return t("actorMe");
    if (actor === "other") return t("actorOther");
    return t("actorAdmin");
  }

  return (
    <div className="flex w-full max-w-lg flex-col gap-4">
      <div className="flex flex-col gap-1">
        <PageHeader title={t("roomTitle")} />
        {detail && (
          <a
            href={`/products/${detail.product.id}`}
            className="text-sm font-medium text-emerald-600 hover:underline dark:text-emerald-400"
          >
            {t("viewProduct")}
          </a>
        )}
      </div>

      {loadError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {loadError}
        </p>
      )}

      {loading && !detail && (
        <Card className="animate-pulse" aria-hidden>
          <div className="h-4 w-1/2 rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="mt-3 h-4 w-1/3 rounded bg-zinc-200 dark:bg-zinc-800" />
        </Card>
      )}

      {detail && (
        <>
          <Card className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Avatar nickname={detail.counterparty.nickname} size={40} />
              <div className="flex flex-col">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">{t("counterparty")}</span>
                <span className="font-medium text-zinc-900 dark:text-zinc-50">{detail.counterparty.nickname}</span>
              </div>
            </div>

            <dl className="flex flex-col gap-1 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-zinc-500 dark:text-zinc-400">{t("amountLabel")}</dt>
                <dd className="font-semibold text-zinc-900 dark:text-zinc-50">{money(detail.amount)}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-zinc-500 dark:text-zinc-400">{t("statusLabel")}</dt>
                <dd>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE_STYLE[detail.status]}`}>
                    {t(`status.${detail.status}`)}
                  </span>
                </dd>
              </div>
            </dl>
          </Card>

          <div className="flex flex-col gap-3">
            {detail.status === "REQUESTED" && detail.myTurn && (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="primary" onClick={() => void runAction("/accept")} disabled={submitting}>
                    {t("accept")}
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setCountering((v) => !v)} disabled={submitting}>
                    {t("counter")}
                  </Button>
                  <Button type="button" variant="danger" onClick={() => void runAction("/cancel")} disabled={submitting}>
                    {t("cancel")}
                  </Button>
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
                        className={textInputClass}
                      />
                    </label>
                    <Button type="submit" variant="primary" className="self-start" disabled={submitting}>
                      {t("counterSubmit")}
                    </Button>
                  </form>
                )}
              </>
            )}

            {detail.status === "REQUESTED" && !detail.myTurn && (
              <>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("waitingReply")}</p>
                <Button type="button" variant="danger" className="self-start" onClick={() => void runAction("/cancel")} disabled={submitting}>
                  {t("cancel")}
                </Button>
              </>
            )}

            {detail.status === "ACCEPTED" && detail.myRole === "buyer" && (
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="primary" onClick={() => void runAction("/fund")} disabled={submitting}>
                  {t("fund")}
                </Button>
                <Button type="button" variant="danger" onClick={() => void runAction("/cancel")} disabled={submitting}>
                  {t("cancel")}
                </Button>
              </div>
            )}

            {detail.status === "ACCEPTED" && detail.myRole === "seller" && (
              <>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("waitingFund")}</p>
                <Button type="button" variant="danger" className="self-start" onClick={() => void runAction("/cancel")} disabled={submitting}>
                  {t("cancel")}
                </Button>
              </>
            )}

            {detail.status === "FUNDED" && detail.myRole === "buyer" && (
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="primary" onClick={() => void runAction("/confirm")} disabled={submitting}>
                  {t("confirm")}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setDisputing((v) => !v)} disabled={submitting}>
                  {t("dispute")}
                </Button>
              </div>
            )}

            {detail.status === "FUNDED" && detail.myRole === "seller" && (
              <>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("waitingConfirm")}</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" onClick={() => void runAction("/refund")} disabled={submitting}>
                    {t("refund")}
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setDisputing((v) => !v)} disabled={submitting}>
                    {t("dispute")}
                  </Button>
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
                    className={textInputClass}
                  />
                </label>
                <Button type="submit" variant="danger" className="self-start" disabled={submitting}>
                  {t("disputeSubmit")}
                </Button>
              </form>
            )}

            {detail.status === "RELEASED" && (
              <p className="text-sm text-emerald-700 dark:text-emerald-400">{t("doneReleased")}</p>
            )}
            {detail.status === "REFUNDED" && <p className="text-sm text-zinc-600 dark:text-zinc-400">{t("doneRefunded")}</p>}
            {detail.status === "CANCELLED" && <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("doneCancelled")}</p>}
            {detail.status === "DISPUTED" && <p className="text-sm text-amber-700 dark:text-amber-400">{t("disputedState")}</p>}
          </div>

          {actionError && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {actionError}
            </p>
          )}

          <div className="flex flex-col gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <ol className="flex flex-col gap-2">
              {detail.events.map((ev, i) => (
                <li key={i}>
                  <Card className="flex items-start gap-3">
                    <Avatar nickname={actorLabel(ev.actor)} size={32} />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-medium text-zinc-900 dark:text-zinc-50">{t(`status.${ev.status}`)}</span>
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">{actorLabel(ev.actor)}</span>
                      </span>
                      {ev.amount !== null && <span className="text-zinc-700 dark:text-zinc-300">{money(ev.amount)}</span>}
                      {ev.note && <span className="whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">{ev.note}</span>}
                      <span className="text-xs text-zinc-400 dark:text-zinc-500">{formatDate(ev.at, format)}</span>
                    </div>
                  </Card>
                </li>
              ))}
            </ol>
          </div>
        </>
      )}
    </div>
  );
}
