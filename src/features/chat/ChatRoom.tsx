"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Input } from "@/features/shell/ui";
import { Avatar } from "@/features/shell/Avatar";
import { maskProfanity } from "./filter";

/**
 * GET/POST /api/chat/conversations/[id]/messages가 내려주는 참여자용 모양.
 * 서버가 이미 mine을 계산해 내려주므로(누가 보냈는지) senderId(상대의 원본 userId)는 아예 실어 보내지 않는다(#5/G8).
 * rawText도 이 타입에 없다 — 서버가 절대 내려주지 않으므로 화면도 마스킹본만 다룬다.
 */
export interface ChatMessageView {
  _id: string;
  conversationId: string;
  mine: boolean;
  kind: "text" | "image";
  text?: string;
  imagePath?: string;
  masked: boolean;
  createdAt: string;
  /**
   * 전화번호·계좌로 보이는 구간(서버가 표시). 화면에서 밑줄로 강조한다.
   * digits는 그 구간에서 읽어낸 숫자만 모은 값 — `영1영-5O14`처럼 바꿔 쓴 표기도 사기 이력 조회에 그대로 쓸 수 있다.
   */
  sensitive?: { start: number; end: number; kind: "phone" | "account"; evasive: boolean; digits: string }[];
}

/**
 * WS 실시간 수신 메시지 — REST와 같은 모양이다.
 * 서버가 각 소켓의 인증된 userId로 mine을 계산해 내려주므로 senderId(상대의 원본 userId)는 오지 않고,
 * 클라이언트도 누가 보냈는지 직접 따질 필요가 없다.
 */
type WsIncomingMessage = ChatMessageView;

/** 신고 사유 — 자유 입력 대신 고르게 한다(관리자 분류가 쉬워지고, 사용자도 빠르다). */
const REPORT_REASONS = [
  "noShow",
  "noReply",
  "haggling",
  "abuse",
  "fraud",
  "spam",
  "inappropriate",
  "etc",
] as const;

const ERROR_KEYS: Record<string, string> = {
  NOT_FOUND: "notFound",
  FORBIDDEN: "forbidden",
  BLOCKED: "blocked",
  FIRST_MSG_TEXT_ONLY: "firstMsgTextOnly",
  IMAGE_BEFORE_REPLY: "imageBeforeReply",
  EMPTY_MESSAGE: "emptyMessage",
  INVALID_IMAGE: "invalidImage",
  UPLOAD_FAILED: "invalidImage",
};

/** 전화번호·계좌로 보이는 구간에 밑줄을 그어 눈에 띄게 한다(내용은 그대로 보여준다). */
function renderWithSensitive(m: ChatMessageView) {
  const text = m.text ?? "";
  const spans = (m.sensitive ?? []).slice().sort((a, b) => a.start - b.start);
  if (spans.length === 0) return text;
  const out: React.ReactNode[] = [];
  let cursor = 0;
  spans.forEach((s, i) => {
    if (s.start > cursor) out.push(text.slice(cursor, s.start));
    out.push(
      <span key={i} className="underline decoration-2 underline-offset-2">
        {text.slice(s.start, s.end)}
      </span>,
    );
    cursor = s.end;
  });
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

async function readErrorCode(res: Response): Promise<string | undefined> {
  const body = await res.json().catch(() => ({ code: undefined }));
  return (body as { code?: string }).code;
}

export interface ChatRoomProps {
  conversationId: string;
  otherNickname: string;
  productId: string;
  productTitle?: string;
  /** 재입장 시 즉시 정확한 상태를 보여주기 위해 서버(페이지)가 미리 조회해 넣어준다(#4/G9 — 양방향 차단 확인). */
  initialBlocked?: boolean;
  /** 상대가 나를 차단한 경우 — 내가 풀 수 없으므로 안내만 하고 해제 버튼은 숨긴다. */
  blockedByOther?: boolean;
  /**
   * WS 실시간 수신은 진행 개선(progressive enhancement)이다 — 앱이 아직 액세스 토큰을 클라이언트에
   * 보관하지 않으므로(별도 과제) 기본값은 undefined이고, 이 경우 소켓을 아예 열지 않는다.
   * 토큰이 없으면 아래의 주기적 확인(폴링)으로 상대 메시지를 받아 오고, 토큰이 주어질 때만 소켓으로 업그레이드한다.
   */
  accessToken?: string;
  wsUrl?: string;
}

const HISTORY_LIMIT_HINT = 50; // 서버 DEFAULT_MESSAGE_LIMIT과 맞춘 힌트 — 정확한 값이 아니어도 "더 있을 수도" 판단에는 충분하다.

export function ChatRoom({
  conversationId,
  otherNickname,
  productId,
  productTitle,
  initialBlocked = false,
  blockedByOther = false,
  accessToken,
  wsUrl,
}: ChatRoomProps) {
  const t = useTranslations("chat");

  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [profanityWarned, setProfanityWarned] = useState(false);
  const [pendingImage, setPendingImage] = useState<{ file: File; url: string } | null>(null);
  const [leaving, setLeaving] = useState(false);

  // 사기 이력 확인(메시지별) — 확인 중인 메시지 id와, 메시지별 결과 문구.
  const [fraudChecking, setFraudChecking] = useState<string | null>(null);
  const [fraudResults, setFraudResults] = useState<Record<string, string>>({});

  const [blocked, setBlocked] = useState(initialBlocked);
  const [blockError, setBlockError] = useState<string | null>(null);

  const [reporting, setReporting] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportDetail, setReportDetail] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportSent, setReportSent] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const seenIds = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement | null>(null);

  function scrollToBottom() {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  /** 새 메시지(내가 보냈거나 실시간 수신)는 항상 맨 아래에 붙고, 바닥으로 자동 스크롤한다. */
  function appendMessage(message: ChatMessageView) {
    if (seenIds.current.has(message._id)) return;
    seenIds.current.add(message._id);
    setMessages((prev) => [...prev, message]);
    scrollToBottom();
    // 방을 보고 있는 동안 도착한 상대 메시지는 바로 읽음 처리한다.
    if (!message.mine) {
      void fetch(`/api/chat/conversations/${conversationId}/read`, { method: "POST" }).catch(() => {});
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingHistory(true);
      setHistoryError(null);
      try {
        const res = await fetch(`/api/chat/conversations/${conversationId}/messages`);
        if (!res.ok) {
          const code = await readErrorCode(res);
          if (!cancelled) setHistoryError(t(ERROR_KEYS[code ?? ""] ?? "failed"));
          return;
        }
        const body = (await res.json()) as { messages: ChatMessageView[] };
        // 서버는 최신순(newest-first)으로 내려준다 — 화면은 대화 흐름대로 오래된 순으로 보여준다.
        const ordered = [...body.messages].reverse();
        if (!cancelled) {
          for (const m of ordered) seenIds.current.add(m._id);
          setMessages(ordered);
          setHasMore(body.messages.length >= HISTORY_LIMIT_HINT);
          scrollToBottom();
          // 방을 열어봤으니 읽음으로 표시한다 — 목록의 안 읽은 수가 쌓이지 않게.
          void fetch(`/api/chat/conversations/${conversationId}/read`, { method: "POST" }).catch(() => {});
        }
      } catch {
        if (!cancelled) setHistoryError(t("failed"));
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  /**
   * 상대가 알려준 번호에 사기 신고 이력이 있는지 확인한다(데모용 흉내 조회).
   * 서버는 상대가 이 대화에서 알려준 번호만 확인해 준다 — 표시된 구간의 숫자를 그대로 보낸다.
   */
  async function checkFraud(key: string, digits: string) {
    if (!digits) return;
    setFraudChecking(key);
    try {
      const res = await fetch("/api/chat/fraud-check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, value: digits }),
      });
      if (!res.ok) {
        setFraudResults((prev) => ({ ...prev, [key]: t("fraudCheckFailed") }));
        return;
      }
      const body = (await res.json()) as { reported: boolean; count: number };
      setFraudResults((prev) => ({
        ...prev,
        [key]: body.reported ? t("fraudReported", { count: body.count }) : t("fraudClean"),
      }));
    } catch {
      setFraudResults((prev) => ({ ...prev, [key]: t("fraudCheckFailed") }));
    } finally {
      setFraudChecking(null);
    }
  }

  /** 스크롤이 맨 위에 닿으면(또는 버튼으로) 커서 기반으로 이전 메시지를 더 불러온다 — 전체를 한 번에 로드하지 않는다(#3). */
  async function loadOlder() {
    if (loadingMore || !hasMore || loadingHistory || messages.length === 0) return;
    setLoadingMore(true);
    try {
      // 커서는 시각 기준이라, 같은 밀리초에 저장된 메시지가 쪽 경계에 걸리면 통째로 건너뛴다.
      // 1밀리초 뒤로 물려 잡아 그 시각을 다시 포함시키고, 이미 본 메시지는 아래에서 걸러낸다.
      const oldest = new Date(messages[0].createdAt);
      const cursor = new Date(oldest.getTime() + 1).toISOString();
      const res = await fetch(
        `/api/chat/conversations/${conversationId}/messages?cursor=${encodeURIComponent(cursor)}`,
      );
      if (!res.ok) {
        setHasMore(false);
        return;
      }
      const body = (await res.json()) as { messages: ChatMessageView[] };
      if (body.messages.length === 0) {
        setHasMore(false);
        return;
      }
      // 이미 화면에 있는 메시지는 걸러낸다(커서를 물려 잡았으므로 겹칠 수 있다).
      const olderOrdered = [...body.messages].reverse().filter((m) => !seenIds.current.has(m._id));
      if (olderOrdered.length === 0) {
        setHasMore(false);
        return;
      }
      const container = scrollRef.current;
      const prevScrollHeight = container?.scrollHeight ?? 0;
      for (const m of olderOrdered) seenIds.current.add(m._id);
      setMessages((prev) => [...olderOrdered, ...prev]);
      setHasMore(body.messages.length >= HISTORY_LIMIT_HINT);
      requestAnimationFrame(() => {
        if (container) container.scrollTop = container.scrollHeight - prevScrollHeight;
      });
    } finally {
      setLoadingMore(false);
    }
  }

  function handleScroll(event: React.UIEvent<HTMLDivElement>) {
    if (event.currentTarget.scrollTop <= 0) void loadOlder();
  }

  // WS 진행 개선 — 토큰이 없으면 아예 연결을 시도하지 않는다(REST가 항상 신뢰 가능한 경로).
  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    let socket: import("socket.io-client").Socket | undefined;

    (async () => {
      const { io } = await import("socket.io-client");
      if (cancelled) return;
      socket = io(wsUrl ?? process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:4000", {
        auth: { token: accessToken },
      });
      socket.emit("join", conversationId);
      socket.on("message", (msg: WsIncomingMessage) => appendMessage(msg));
    })().catch(() => {
      // WS는 최선형(best-effort) 업그레이드 — 실패해도 REST 경로는 계속 동작한다.
    });

    return () => {
      cancelled = true;
      socket?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, conversationId, wsUrl]);

  /**
   * 소켓을 못 여는 동안에도 상대 메시지가 보이도록 주기적으로 확인한다.
   *
   * 소켓은 액세스 토큰이 있을 때만 열리는데 지금 앱은 토큰을 클라이언트에 두지 않는다.
   * 그 상태로는 방을 열어 둔 채로는 상대 말이 영영 안 보여서, 거래 얘기 중에 답답해진다.
   * 화면을 보고 있을 때만 확인하고, 소켓이 열려 있으면 이 경로는 쓰지 않는다.
   */
  useEffect(() => {
    if (accessToken) return;
    let stopped = false;

    async function poll() {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const res = await fetch(`/api/chat/conversations/${conversationId}/messages`);
        if (!res.ok || stopped) return;
        const body = (await res.json()) as { messages: ChatMessageView[] };
        if (stopped) return;
        // 서버는 최신순으로 주므로 뒤집어서 오래된 것부터 붙인다(이미 본 건 appendMessage가 거른다).
        for (const m of [...body.messages].reverse()) appendMessage(m);
      } catch {
        // 잠깐 실패해도 다음 차례에 다시 확인한다.
      }
    }

    const timer = setInterval(() => void poll(), 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, conversationId]);

  async function sendText(event?: React.FormEvent, skipProfanityCheck = false) {
    event?.preventDefault();
    setSendError(null);
    if (sending) return;
    if (!text.trim()) {
      setSendError(t("emptyMessage"));
      return;
    }
    // 비속어가 섞였으면 한 번 물어본다 — 그래도 보내겠다면 그대로 보낸다(막지는 않는다).
    if (!skipProfanityCheck && maskProfanity(text).hit) {
      setProfanityWarned(true);
      return;
    }
    setProfanityWarned(false);
    setSending(true);
    try {
      const res = await fetch(`/api/chat/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "text", text }),
      });
      if (!res.ok) {
        const code = await readErrorCode(res);
        setSendError(t(ERROR_KEYS[code ?? ""] ?? "failed"));
        return;
      }
      const body = (await res.json()) as { message: ChatMessageView };
      appendMessage(body.message);
      setText("");
    } catch {
      setSendError(t("failed"));
    } finally {
      setSending(false);
    }
  }

  /** 파일을 고르면 바로 보내지 않고 미리보기를 띄운다 — 잘못 고른 사진이 그대로 나가지 않게. */
  function pickImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setSendError(null);
    setPendingImage({ file, url: URL.createObjectURL(file) });
  }

  function cancelImage() {
    if (pendingImage) URL.revokeObjectURL(pendingImage.url);
    setPendingImage(null);
  }

  async function sendImage() {
    const file = pendingImage?.file;
    if (!file) return;
    setSendError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const uploadRes = await fetch("/api/products/images", { method: "POST", body: form });
      if (!uploadRes.ok) {
        const code = await readErrorCode(uploadRes);
        setSendError(t(ERROR_KEYS[code ?? ""] ?? "invalidImage"));
        return;
      }
      const uploaded = (await uploadRes.json()) as { path: string };

      const res = await fetch(`/api/chat/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "image", imagePath: uploaded.path }),
      });
      if (!res.ok) {
        const code = await readErrorCode(res);
        setSendError(t(ERROR_KEYS[code ?? ""] ?? "failed"));
        return;
      }
      const body = (await res.json()) as { message: ChatMessageView };
      appendMessage(body.message);
      cancelImage(); // 미리보기 정리(objectURL 해제 포함)
    } catch {
      setSendError(t("failed"));
    } finally {
      setUploading(false);
    }
  }

  /** 이 방을 내 목록에서 치운다 — 상대에겐 그대로 남고, 상대가 새 메시지를 보내면 다시 보인다. */
  async function leaveRoom() {
    if (leaving) return;
    if (!window.confirm(t("leaveConfirm"))) return;
    setLeaving(true);
    try {
      const res = await fetch(`/api/chat/conversations/${conversationId}/leave`, { method: "POST" });
      if (!res.ok) {
        setSendError(t("failed"));
        return;
      }
      window.location.href = "/chat";
    } catch {
      setSendError(t("failed"));
    } finally {
      setLeaving(false);
    }
  }

  // 차단/신고 대상은 conversationId로만 넘긴다 — 상대의 원본 userId를 클라이언트가 들고 있을 필요가 없다(#5/G8).
  async function toggleBlock() {
    setBlockError(null);
    try {
      const res = await fetch(`/api/chat/${blocked ? "unblock" : "block"}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId }),
      });
      if (!res.ok) {
        const code = await readErrorCode(res);
        setBlockError(t(ERROR_KEYS[code ?? ""] ?? "failed"));
        return;
      }
      setBlocked((prev) => !prev);
    } catch {
      setBlockError(t("failed"));
    }
  }

  async function submitReport(event: React.FormEvent) {
    event.preventDefault();
    setReportError(null);
    if (reportSubmitting) return;
    setReportSubmitting(true);
    try {
      // 고른 사유(+선택 상세)를 합쳐 보낸다 — 서버는 사유 문자열만 저장한다.
      const detail = reportDetail.trim();
      const reason = detail ? `${t(`reportReason.${reportReason}`)} — ${detail}` : t(`reportReason.${reportReason}`);
      const res = await fetch("/api/chat/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetType: "user", conversationId, reason }),
      });
      if (!res.ok) {
        const code = await readErrorCode(res);
        setReportError(t(ERROR_KEYS[code ?? ""] ?? "failed"));
        return;
      }
      setReportSent(true);
      setReporting(false);
      setReportReason("");
      setReportDetail("");
    } catch {
      setReportError(t("failed"));
    } finally {
      setReportSubmitting(false);
    }
  }

  // 이력 로딩 중에도 타이핑은 막지 않는다 — 전송 버튼만 히스토리 로딩이 끝날 때까지 비활성화한다.
  // 어느 쪽이든 차단이면 보낼 수 없다. 단 "해제"는 내가 건 차단만 풀 수 있다.
  const composerDisabled = sending || uploading || blocked || blockedByOther;
  const sendDisabled = composerDisabled || loadingHistory;

  return (
    <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar nickname={otherNickname} size={40} />
          <div className="flex min-w-0 flex-col">
            <h1 className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-50">{otherNickname}</h1>
            {productTitle && <p className="truncate text-xs text-zinc-400 dark:text-zinc-500">{productTitle}</p>}
            <a
              href={`/products/${productId}`}
              className="truncate text-xs text-emerald-600 hover:underline dark:text-emerald-400"
            >
              {t("viewProduct")}
            </a>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {/*
            상대가 나를 차단했으면 "차단하기"는 의미가 없어 감춘다.
            다만 내가 걸어 둔 차단은 언제든 풀 수 있어야 하므로, 그 경우에는 계속 보여준다
            (양쪽이 서로 차단했을 때 내 차단만 영영 못 푸는 상황을 막는다 — 아래 안내가 상황을 설명한다).
          */}
          {(!blockedByOther || blocked) && (
          <button
            type="button"
            onClick={() => void toggleBlock()}
            className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-semibold text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {blocked ? t("unblock") : t("block")}
          </button>
          )}
          <button
            type="button"
            onClick={() => setReporting((v) => !v)}
            className="rounded-lg px-2.5 py-1 text-xs font-semibold text-zinc-500 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            {t("report")}
          </button>
          <button
            type="button"
            onClick={() => void leaveRoom()}
            disabled={leaving}
            className="rounded-lg px-2.5 py-1 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950"
          >
            {t("leaveRoom")}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2 px-4 pt-3">
        {blockedByOther && (
          <p className="rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {t("blockedByOtherState")}
          </p>
        )}
        {blocked && (
          <p className="rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {t("blockedState")}
          </p>
        )}
        {blockError && (
          <p role="alert" className="text-sm text-red-600">
            {blockError}
          </p>
        )}

        {reporting && (
          <form onSubmit={submitReport} className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {t("reportReasonLegend")}
              </legend>
              {REPORT_REASONS.map((code) => (
                <label key={code} className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                  <input
                    type="radio"
                    name="reportReason"
                    value={code}
                    checked={reportReason === code}
                    onChange={(e) => setReportReason(e.target.value)}
                    className="accent-emerald-600"
                  />
                  {t(`reportReason.${code}`)}
                </label>
              ))}
            </fieldset>
            <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
              {t("reportDetailLabel")}
              <textarea
                value={reportDetail}
                onChange={(e) => setReportDetail(e.target.value)}
                rows={2}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
            </label>
            <div className="flex gap-2">
              <Button type="submit" disabled={reportSubmitting || !reportReason}>
                {t("reportSubmit")}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setReporting(false)}>
                {t("cancel")}
              </Button>
            </div>
          </form>
        )}
        {reportSent && (
          <p aria-live="polite" className="text-sm text-emerald-700 dark:text-emerald-400">
            {t("reportSent")}
          </p>
        )}
        {reportError && (
          <p role="alert" className="text-sm text-red-600">
            {reportError}
          </p>
        )}

        {historyError && (
          <p role="alert" className="text-sm text-red-600">
            {historyError}
          </p>
        )}
      </div>

      {loadingHistory ? (
        <div className="flex h-[420px] items-center justify-center text-sm text-zinc-400 dark:text-zinc-500">
          {t("loading")}
        </div>
      ) : (
        <div ref={scrollRef} onScroll={handleScroll} className="flex h-[420px] flex-col gap-2 overflow-y-auto px-4 py-3">
          {hasMore && (
            <button
              type="button"
              onClick={() => void loadOlder()}
              disabled={loadingMore}
              className="mx-auto rounded-full px-3 py-1 text-xs text-zinc-500 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              {loadingMore ? t("loading") : t("loadOlder")}
            </button>
          )}

          <ul className="flex flex-col gap-2">
            {messages.map((m) => (
              <li key={m._id} className={`flex flex-col ${m.mine ? "items-end" : "items-start"}`}>
                <div
                  className={`max-w-[75%] rounded-2xl px-3 py-2 ${
                    m.mine
                      ? "rounded-br-sm bg-emerald-600 text-white"
                      : "rounded-bl-sm bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                  }`}
                >
                  {m.kind === "text" ? (
                    <>
                      <p className="whitespace-pre-wrap text-sm">{renderWithSensitive(m)}</p>
                      {m.sensitive?.map((span, i) => {
                        const key = `${m._id}:${i}`;
                        return (
                          <div key={key} className="mt-1 flex flex-col items-start gap-1">
                            <p className="text-xs opacity-80">
                              {span.kind === "phone" ? t("sensitivePhoneNotice") : t("sensitiveAccountNotice")}
                            </p>
                            {/* 상대가 알려준 번호는 그 자리에서 사기 이력을 확인할 수 있게 한다. */}
                            {!m.mine && (
                              <button
                                type="button"
                                onClick={() => checkFraud(key, span.digits)}
                                disabled={fraudChecking === key}
                                className="text-xs font-medium underline underline-offset-2 disabled:opacity-60"
                              >
                                {fraudChecking === key ? t("fraudChecking") : t("fraudCheck")}
                              </button>
                            )}
                            {fraudResults[key] && (
                              <p className="text-xs font-medium">
                                {fraudResults[key]}{" "}
                                <span className="font-normal opacity-70">({t("fraudMockNote")})</span>
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/media/${m.imagePath}`}
                      alt={t("imageMessageAlt")}
                      className="h-32 w-32 rounded-lg object-cover"
                    />
                  )}
                </div>
                {m.masked && (
                  <span
                    title={t("maskedBadge")}
                    className="mt-0.5 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                  >
                    {t("maskedBadge")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 사진은 고른 뒤 한 번 확인하고 보낸다 */}
      {pendingImage && (
        <div className="flex items-center gap-3 border-t border-zinc-200 p-3 dark:border-zinc-800">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={pendingImage.url} alt={t("imageMessageAlt")} className="h-20 w-20 rounded-lg object-cover" />
          <div className="flex flex-col gap-2">
            <span className="text-sm text-zinc-700 dark:text-zinc-300">{t("imagePreviewTitle")}</span>
            <div className="flex gap-2">
              <Button type="button" onClick={() => void sendImage()} disabled={uploading}>
                {t("imageSend")}
              </Button>
              <Button type="button" variant="secondary" onClick={cancelImage} disabled={uploading}>
                {t("cancel")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 비속어가 섞였을 때 한 번 물어본다 — 막지는 않는다 */}
      {profanityWarned && (
        <div className="flex flex-wrap items-center gap-2 border-t border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <span>{t("profanityWarning")}</span>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              // 확인했으니 검사 없이 그대로 보낸다.
              setProfanityWarned(false);
              void sendText(undefined, true);
            }}
          >
            {t("profanitySendAnyway")}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setProfanityWarned(false)}>
            {t("cancel")}
          </Button>
        </div>
      )}

      <form onSubmit={sendText} className="flex gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800" noValidate>
        <label className="flex-1">
          <span className="sr-only">{t("messagePlaceholder")}</span>
          <Input
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setProfanityWarned(false);
            }}
            placeholder={t("messagePlaceholder")}
            disabled={composerDisabled}
          />
        </label>
        <label className="flex cursor-pointer items-center rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
          {t("imageButton")}
          <input
            type="file"
            accept="image/*"
            onChange={pickImage}
            disabled={composerDisabled}
            className="hidden"
          />
        </label>
        <Button type="submit" disabled={sendDisabled}>
          {t("send")}
        </Button>
      </form>

      {sendError && (
        <p role="alert" className="px-3 pb-3 text-sm text-red-600">
          {sendError}
        </p>
      )}
    </div>
  );
}
