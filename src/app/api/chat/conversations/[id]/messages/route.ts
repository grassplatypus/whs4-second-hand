import { prisma } from "@/features/_shared/prisma";
import { withErrorHandling, AppError } from "@/features/_shared/error";
import { requireActiveUser } from "@/features/auth/rbac";
import { getChatRepo } from "@/features/chat/repo";
import { listMessages, sendMessage, type DeliveredMessage } from "@/features/chat/service";

type RouteCtx = { params: Promise<{ id: string }> };

const VALID_KINDS = new Set(["text", "image"]);

/** 참여자에게 실제로 내려주는 메시지 모양 — 서버가 계산한 mine만 실어 보내고 senderId(상대의 원본 userId 노출 경로)는 뺀다. */
function toMessageView(message: DeliveredMessage, userId: string) {
  return {
    _id: message._id,
    conversationId: message.conversationId,
    kind: message.kind,
    text: message.text,
    imagePath: message.imagePath,
    masked: message.masked,
    createdAt: message.createdAt,
    mine: message.senderId === userId,
    // 전화번호·계좌로 보이는 구간 — 화면에서 밑줄로 표시하고 조심하라고 알린다.
    ...(message.sensitive?.length ? { sensitive: message.sensitive } : {}),
  };
}

// 참여자 격리(제3자 403)는 서비스가 conversationId로 확인한다 — 인증된 userId만 넘긴다.
export const GET = withErrorHandling(async (req: Request, ctx?: unknown) => {
  const current = await requireActiveUser(prisma, req);
  const { id } = await (ctx as RouteCtx).params;

  const url = new URL(req.url);
  const cursorParam = url.searchParams.get("cursor");
  let cursor: Date | undefined;
  if (cursorParam) {
    cursor = new Date(cursorParam);
    if (Number.isNaN(cursor.getTime())) {
      throw new AppError("INVALID_INPUT", "커서 값이 올바르지 않아요.", 400);
    }
  }

  const messages = await listMessages(getChatRepo(), current.userId, id, cursor);
  return Response.json({ messages: messages.map((m) => toMessageView(m, current.userId)) });
});

// 전송자는 항상 인증된 userId — 클라이언트가 body로 다른 senderId를 실어 보낼 수 없다.
export const POST = withErrorHandling(async (req: Request, ctx?: unknown) => {
  const current = await requireActiveUser(prisma, req);
  const { id } = await (ctx as RouteCtx).params;

  const body = await req.json().catch(() => ({}));
  const { kind, text, imagePath } = body as { kind?: unknown; text?: unknown; imagePath?: unknown };
  if (typeof kind !== "string" || !VALID_KINDS.has(kind)) {
    throw new AppError("INVALID_INPUT", "메시지 종류가 올바르지 않아요.", 400);
  }

  const message = await sendMessage(getChatRepo(), current.userId, id, {
    kind: kind as "text" | "image",
    text: typeof text === "string" ? text : undefined,
    imagePath: typeof imagePath === "string" ? imagePath : undefined,
  });
  return Response.json({ message: toMessageView(message, current.userId) }, { status: 201 });
});
