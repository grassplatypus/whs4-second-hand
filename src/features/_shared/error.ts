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

export function toClientError(err: unknown, _isProd: boolean): ClientError {
  if (err instanceof AppError) {
    return { body: { code: err.code, message: err.message }, status: err.httpStatus };
  }
  // 알 수 없는 에러: 내부 정보 절대 노출 금지, 서버 로그에만 상세
  console.error("[UNHANDLED]", err);
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
      const { body, status } = toClientError(err, process.env.NODE_ENV === "production");
      return Response.json(body, { status });
    }
  };
}
