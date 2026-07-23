export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public httpStatus: number = 400,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export interface ClientError {
  body: { code: string; message: string };
  status: number;
}

export function toClientError(err: unknown): ClientError {
  if (err instanceof AppError) {
    return { body: { code: err.code, message: err.message }, status: err.httpStatus };
  }
  // 알 수 없는 에러: 내부 정보 절대 노출 금지. 에러 종류명만 로그(입력 조각·PII 유입 방지).
  console.error("[UNHANDLED]", err instanceof Error ? err.name : "unknown");
  return {
    body: { code: "INTERNAL", message: "문제가 생겼어요. 잠시 후 다시 시도해 주세요." },
    status: 500,
  };
}

type RouteHandler = (req: Request, ctx?: unknown) => Promise<Response> | Response;

export function withErrorHandling(handler: RouteHandler): RouteHandler {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      const { body, status } = toClientError(err);
      return Response.json(body, { status });
    }
  };
}
