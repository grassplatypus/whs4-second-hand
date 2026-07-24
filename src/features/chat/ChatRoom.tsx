"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * DeliveredMessage(서비스가 반환하는 안전 모양)를 그대로 따르되 createdAt만 JSON 직렬화라 문자열이다.
 * rawText는 애초에 이 타입에 없다 — 서버가 절대 내려주지 않으므로 화면도 마스킹본만 다룬다.
 */
export interface ChatMessageView {
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
  currentUserId: string;
  otherId: string;
  otherNickname: string;
  productId: string;
  /**
   * WS 실시간 수신은 진행 개선(progressive enhancement)이다 — 앱이 아직 액세스 토큰을 클라이언트에
   * 보관하지 않으므로(별도 과제) 기본값은 undefined이고, 이 경우 소켓을 아예 열지 않는다.
   * REST(이력 조회 + 전송)만으로 채팅이 온전히 동작해야 하며, 토큰이 주어질 때만 살아있는 업그레이드를 시도한다.
   */
  accessToken?: string;
  wsUrl?: string;
}

export function ChatRoom({
  conversationId,
  currentUserId,
  otherId,
  otherNickname,
  productId,
  accessToken,
  wsUrl,
}: ChatRoomProps) {
  const t = useTranslations("chat");

  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);

  const [blocked, setBlocked] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);

  const [reporting, setReporting] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportSent, setReportSent] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const seenIds = useRef<Set<string>>(new Set());

  function appendMessage(message: ChatMessageView) {
    if (seenIds.current.has(message._id)) return;
    seenIds.current.add(message._id);
    setMessages((prev) => [...prev, message]);
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
      socket.on("message", (msg: ChatMessageView) => appendMessage(msg));
    })().catch(() => {
      // WS는 최선형(best-effort) 업그레이드 — 실패해도 REST 경로는 계속 동작한다.
    });

    return () => {
      cancelled = true;
      socket?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, conversationId, wsUrl]);

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

  async function toggleBlock() {
    setBlockError(null);
    try {
      const res = await fetch(`/api/chat/${blocked ? "unblock" : "block"}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetId: otherId }),
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
        body: JSON.stringify({ targetType: "user", targetId: otherId, reason: reportReason }),
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

  return (
    <div className="flex w-full max-w-lg flex-col gap-4">
      <div className="flex items-center justify-between border-b pb-2">
        <div className="flex flex-col">
          <h1 className="text-lg font-semibold">{otherNickname}</h1>
          <a href={`/products/${productId}`} className="text-xs text-blue-600 underline">
            {t("viewProduct")}
          </a>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void toggleBlock()} className="rounded border px-2 py-1 text-xs">
            {blocked ? t("unblock") : t("block")}
          </button>
          <button
            type="button"
            onClick={() => setReporting((v) => !v)}
            className="rounded border px-2 py-1 text-xs"
          >
            {t("report")}
          </button>
        </div>
      </div>

      {blocked && <p className="text-xs text-zinc-500">{t("blockedState")}</p>}
      {blockError && (
        <p role="alert" className="text-sm text-red-600">
          {blockError}
        </p>
      )}

      {reporting && (
        <form onSubmit={submitReport} className="flex flex-col gap-2 rounded border p-2">
          <label className="flex flex-col gap-1 text-sm">
            {t("reportReasonPlaceholder")}
            <textarea
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              className="rounded border px-2 py-1"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={reportSubmitting}
              className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              {t("reportSubmit")}
            </button>
            <button type="button" onClick={() => setReporting(false)} className="rounded border px-3 py-2 text-sm">
              {t("cancel")}
            </button>
          </div>
        </form>
      )}
      {reportSent && (
        <p aria-live="polite" className="text-sm text-green-700">
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

      <ul className="flex flex-col gap-2">
        {messages.map((m) => {
          const mine = m.senderId === currentUserId;
          return (
            <li key={m._id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
              <div className={`max-w-xs rounded px-3 py-2 ${mine ? "bg-black text-white" : "bg-zinc-100"}`}>
                {m.kind === "text" ? (
                  <p className="whitespace-pre-wrap">{m.text}</p>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/media/${m.imagePath}`} alt="" className="h-32 w-32 rounded object-cover" />
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <form onSubmit={sendText} className="flex gap-2" noValidate>
        <label className="flex-1">
          <span className="sr-only">{t("messagePlaceholder")}</span>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("messagePlaceholder")}
            className="w-full rounded border px-2 py-1"
          />
        </label>
        <label className="rounded border px-2 py-1 text-sm">
          {t("imageButton")}
          <input type="file" accept="image/*" onChange={(e) => void sendImage(e)} disabled={uploading} className="hidden" />
        </label>
        <button
          type="submit"
          disabled={sending || uploading || loadingHistory}
          className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          {t("send")}
        </button>
      </form>

      {sendError && (
        <p role="alert" className="text-sm text-red-600">
          {sendError}
        </p>
      )}
    </div>
  );
}
