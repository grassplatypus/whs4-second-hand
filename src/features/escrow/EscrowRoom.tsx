"use client";

import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Card, PageHeader, Field, Input, Button } from "@/features/shell/ui";
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
  meetupPlace: string | null;
  meetupAt: string | null;
  myReview: { rating: "GOOD" | "OK" | "BAD"; comment: string | null } | null;
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

/** 약속 저장은 INVALID_INPUT의 의미가 다르다("금액" 아님) — 그 한 코드만 오버라이드한다. */
const MEETUP_ERROR_KEYS: Record<string, string> = { ...ERROR_KEYS, INVALID_INPUT: "meetupInvalid" };

/** 거래 후기 라우트의 에러 코드 → review 카탈로그 키(escrow 카탈로그와는 별개 네임스페이스). */
const REVIEW_ERROR_KEYS: Record<string, string> = {
  FORBIDDEN: "forbidden",
  NOT_FOUND: "notFound",
  INVALID_TRANSITION: "notReleased",
  INVALID_INPUT: "invalidInput",
  ALREADY_REVIEWED: "alreadyReviewed",
  UNAUTHENTICATED: "unauthenticated",
};

async function readErrorCode(res: Response): Promise<string | undefined> {
  const body = await res.json().catch(() => ({ code: undefined }));
  return (body as { code?: string }).code;
}

/** ISO 문자열 → <input type="datetime-local">가 받는 로컬 "YYYY-MM-DDTHH:mm". 파싱 실패는 빈 문자열. */
function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
  const tReview = useTranslations("review");
  const tCommon = useTranslations("common");
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

  const [meetupEditing, setMeetupEditing] = useState(false);
  const [meetupPlaceInput, setMeetupPlaceInput] = useState("");
  const [meetupAtInput, setMeetupAtInput] = useState("");

  const [rating, setRating] = useState<"GOOD" | "OK" | "BAD" | null>(null);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

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

  async function runAction(path: string, body?: Record<string, unknown>, errorKeys: Record<string, string> = ERROR_KEYS) {
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
        setActionError(t(errorKeys[code ?? ""] ?? "failed"));
        return;
      }
      setCountering(false);
      setCounterAmount("");
      setDisputing(false);
      setDisputeNote("");
      setMeetupEditing(false);
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

  function openMeetupEdit() {
    setMeetupPlaceInput(detail?.meetupPlace ?? "");
    setMeetupAtInput(detail?.meetupAt ? toDatetimeLocalValue(detail.meetupAt) : "");
    setMeetupEditing(true);
  }

  async function submitMeetup(event: React.FormEvent) {
    event.preventDefault();
    const place = meetupPlaceInput.trim();
    const at = new Date(meetupAtInput);
    if (!place || !meetupAtInput || Number.isNaN(at.getTime())) {
      setActionError(t("meetupInvalid"));
      return;
    }
    await runAction("/meetup", { place, at: at.toISOString() }, MEETUP_ERROR_KEYS);
  }

  async function submitReview(event: React.FormEvent) {
    event.preventDefault();
    if (!rating || reviewSubmitting) return;
    setReviewError(null);
    setReviewSubmitting(true);
    try {
      const comment = reviewComment.trim();
      const res = await fetch(`/api/escrow/${escrowId}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rating, ...(comment ? { comment } : {}) }),
      });
      if (!res.ok) {
        const code = await readErrorCode(res);
        setReviewError(tReview(REVIEW_ERROR_KEYS[code ?? ""] ?? "failed"));
        return;
      }
      await loadDetail();
    } catch {
      setReviewError(tReview("failed"));
    } finally {
      setReviewSubmitting(false);
    }
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

          {detail.status !== "REQUESTED" && detail.status !== "CANCELLED" && (
            <Card className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{t("meetupTitle")}</h2>
              {detail.meetupPlace && detail.meetupAt ? (
                <dl className="flex flex-col gap-1 text-sm">
                  <div className="flex justify-between gap-2">
                    <dt className="text-zinc-500 dark:text-zinc-400">{t("meetupPlaceLabel")}</dt>
                    <dd className="text-zinc-900 dark:text-zinc-50">{detail.meetupPlace}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-zinc-500 dark:text-zinc-400">{t("meetupAtLabel")}</dt>
                    <dd className="text-zinc-900 dark:text-zinc-50">{formatDate(detail.meetupAt, format)}</dd>
                  </div>
                </dl>
              ) : (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("meetupEmpty")}</p>
              )}

              {(detail.status === "ACCEPTED" || detail.status === "FUNDED") && !meetupEditing && (
                <Button type="button" variant="secondary" className="self-start" onClick={openMeetupEdit} disabled={submitting}>
                  {detail.meetupPlace ? t("meetupEdit") : t("meetupSet")}
                </Button>
              )}

              {meetupEditing && (
                <form onSubmit={submitMeetup} className="flex flex-col gap-3" noValidate>
                  <Field label={t("meetupPlaceLabel")}>
                    <Input
                      type="text"
                      value={meetupPlaceInput}
                      onChange={(e) => setMeetupPlaceInput(e.target.value)}
                      maxLength={100}
                      placeholder={t("meetupPlacePlaceholder")}
                    />
                  </Field>
                  <Field label={t("meetupAtLabel")}>
                    <Input type="datetime-local" value={meetupAtInput} onChange={(e) => setMeetupAtInput(e.target.value)} />
                  </Field>
                  <div className="flex gap-2">
                    <Button type="submit" variant="primary" disabled={submitting}>
                      {t("meetupSave")}
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => setMeetupEditing(false)} disabled={submitting}>
                      {tCommon("close")}
                    </Button>
                  </div>
                </form>
              )}
            </Card>
          )}

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

          {detail.status === "RELEASED" && (
            <Card className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{tReview("writeTitle")}</h2>
              {detail.myReview ? (
                <div className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">
                    {tReview(`rating.${detail.myReview.rating}`)}
                  </span>
                  {detail.myReview.comment && (
                    <p className="whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">{detail.myReview.comment}</p>
                  )}
                </div>
              ) : (
                <form onSubmit={submitReview} className="flex flex-col gap-3" noValidate>
                  <div className="flex flex-wrap gap-2">
                    {(["GOOD", "OK", "BAD"] as const).map((r) => (
                      <Button
                        key={r}
                        type="button"
                        variant={rating === r ? "primary" : "secondary"}
                        onClick={() => setRating(r)}
                        disabled={reviewSubmitting}
                      >
                        {tReview(`rating.${r}`)}
                      </Button>
                    ))}
                  </div>
                  <Field label={tReview("commentLabel")}>
                    <textarea
                      value={reviewComment}
                      onChange={(e) => setReviewComment(e.target.value)}
                      maxLength={500}
                      className={textInputClass}
                      placeholder={tReview("commentPlaceholder")}
                    />
                  </Field>
                  <Button type="submit" variant="primary" className="self-start" disabled={reviewSubmitting || !rating}>
                    {tReview("submit")}
                  </Button>
                  {reviewError && (
                    <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                      {reviewError}
                    </p>
                  )}
                </form>
              )}
            </Card>
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
