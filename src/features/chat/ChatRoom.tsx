"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Input } from "@/features/shell/ui";
import { Avatar } from "@/features/shell/Avatar";

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
}

/** WS(진행 개선)는 out-of-scope 서버가 원본 Message(senderId 포함)를 그대로 브로드캐스트한다 — REST와 형태를 맞추기 위해 수신 시 변환한다. */
interface WsIncomingMessage {
  _id: string;
  conversationId: string;
  senderId: string;
  kind: "text" | "image";
  text?: string;
  imagePath?: string;
  masked: boolean;
  createdAt: string;
}

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

async function readErrorCode(res: Response): Promise<string | undefined> {
  const body = await res.json().catch(() => ({ code: undefined }));
  return (body as { code?: string }).code;
}

export interface ChatRoomProps {
  conversationId: string;
  /** 내 자신의 userId — 실시간(WS) 수신 메시지의 mine을 계산하는 데만 쓰이며 렌더링되지 않는다. */
  currentUserId: string;
  otherNickname: string;
  productId: string;
  productTitle?: string;
  /** 재입장 시 즉시 정확한 상태를 보여주기 위해 서버(페이지)가 미리 조회해 넣어준다(#4/G9 — 양방향 차단 확인). */
  initialBlocked?: boolean;
  /**
   * WS 실시간 수신은 진행 개선(progressive enhancement)이다 — 앱이 아직 액세스 토큰을 클라이언트에
   * 보관하지 않으므로(별도 과제) 기본값은 undefined이고, 이 경우 소켓을 아예 열지 않는다.
   * REST(이력 조회 + 전송)만으로 채팅이 온전히 동작해야 하며, 토큰이 주어질 때만 살아있는 업그레이드를 시도한다.
   */
  accessToken?: string;
  wsUrl?: string;
}

const HISTORY_LIMIT_HINT = 50; // 서버 DEFAULT_MESSAGE_LIMIT과 맞춘 힌트 — 정확한 값이 아니어도 "더 있을 수도" 판단에는 충분하다.

export function ChatRoom({
  conversationId,
  currentUserId,
  otherNickname,
  productId,
  productTitle,
  initialBlocked = false,
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

  const [blocked, setBlocked] = useState(initialBlocked);
  const [blockError, setBlockError] = useState<string | null>(null);

  const [reporting, setReporting] = useState(false);
  const [reportReason, setReportReason] = useState("");
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

  /** 스크롤이 맨 위에 닿으면(또는 버튼으로) 커서 기반으로 이전 메시지를 더 불러온다 — 전체를 한 번에 로드하지 않는다(#3). */
  async function loadOlder() {
    if (loadingMore || !hasMore || loadingHistory || messages.length === 0) return;
    setLoadingMore(true);
    try {
      const oldestCreatedAt = messages[0].createdAt;
      const res = await fetch(
        `/api/chat/conversations/${conversationId}/messages?cursor=${encodeURIComponent(oldestCreatedAt)}`,
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
      const olderOrdered = [...body.messages].reverse();
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
      socket.on("message", (msg: WsIncomingMessage) =>
        appendMessage({
          _id: msg._id,
          conversationId: msg.conversationId,
          kind: msg.kind,
          text: msg.text,
          imagePath: msg.imagePath,
          masked: msg.masked,
          createdAt: msg.createdAt,
          mine: msg.senderId === currentUserId,
        }),
      );
    })().catch(() => {
      // WS는 최선형(best-effort) 업그레이드 — 실패해도 REST 경로는 계속 동작한다.
    });

    return () => {
      cancelled = true;
      socket?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, conversationId, wsUrl, currentUserId]);

  async function sendText(event: React.FormEvent) {
    event.preventDefault();
    setSendError(null);
    if (sending) return;
    if (!text.trim()) {
      setSendError(t("emptyMessage"));
      return;
    }
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

  async function sendImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
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
    } catch {
      setSendError(t("failed"));
    } finally {
      setUploading(false);
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
      const res = await fetch("/api/chat/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetType: "user", conversationId, reason: reportReason }),
      });
      if (!res.ok) {
        const code = await readErrorCode(res);
        setReportError(t(ERROR_KEYS[code ?? ""] ?? "failed"));
        return;
      }
      setReportSent(true);
      setReporting(false);
      setReportReason("");
    } catch {
      setReportError(t("failed"));
    } finally {
      setReportSubmitting(false);
    }
  }

  // 이력 로딩 중에도 타이핑은 막지 않는다 — 전송 버튼만 히스토리 로딩이 끝날 때까지 비활성화한다.
  const composerDisabled = sending || uploading || blocked;
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
          <button
            type="button"
            onClick={() => void toggleBlock()}
            className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-semibold text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {blocked ? t("unblock") : t("block")}
          </button>
          <button
            type="button"
            onClick={() => setReporting((v) => !v)}
            className="rounded-lg px-2.5 py-1 text-xs font-semibold text-zinc-500 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            {t("report")}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2 px-4 pt-3">
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
          <form onSubmit={submitReport} className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
            <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
              {t("reportReasonPlaceholder")}
              <textarea
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value)}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
            </label>
            <div className="flex gap-2">
              <Button type="submit" disabled={reportSubmitting}>
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
                    <p className="whitespace-pre-wrap text-sm">{m.text}</p>
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

      <form onSubmit={sendText} className="flex gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800" noValidate>
        <label className="flex-1">
          <span className="sr-only">{t("messagePlaceholder")}</span>
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("messagePlaceholder")}
            disabled={composerDisabled}
          />
        </label>
        <label className="flex cursor-pointer items-center rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
          {t("imageButton")}
          <input
            type="file"
            accept="image/*"
            onChange={(e) => void sendImage(e)}
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
