import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { withErrorHandling, AppError } from "@/features/_shared/error";
import { getEnv } from "@/features/_shared/env";

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function notFound(): AppError {
  return new AppError("NOT_FOUND", "파일을 찾을 수 없어요.", 404);
}

/**
 * 미디어 정적 서빙 — 공개, 인증 불필요.
 *
 * 경로 트래버설 방지(이 라우트의 핵심 요구사항):
 * 1. 세그먼트에 null byte가 섞여 있으면 즉시 거부.
 * 2. mediaRoot 기준으로 path.join(join은 절대경로 세그먼트가 와도 앞의 루트를 리셋하지 않는다 —
 *    resolve()와 달리 안전) 한 뒤, 그 결과를 다시 resolve()로 정규화해 "."/".."를 모두 접는다.
 * 3. 정규화된 최종 경로가 mediaRoot 자신이거나 `mediaRoot + sep`로 시작하는지 반드시 재확인한다
 *    — 세그먼트 자체 검사만으로는(예: "..\\..\\etc") 불충분해서, 이 최종 포함 검사가 실제 방어선이다.
 * 어느 단계에서든 벗어나면 404(존재 자체를 알리지 않음).
 */
export const GET = withErrorHandling(async (_req: Request, ctx?: unknown) => {
  const { path: segments } = await (ctx as { params: Promise<{ path?: string[] }> }).params;
  if (!Array.isArray(segments) || segments.length === 0) throw notFound();
  if (segments.some((s) => s.includes("\0"))) throw notFound();

  const mediaRoot = resolve(getEnv().MEDIA_DIR);

  let requestedPath: string;
  try {
    requestedPath = resolve(join(mediaRoot, ...segments));
  } catch {
    throw notFound();
  }

  const withinRoot = requestedPath === mediaRoot || requestedPath.startsWith(mediaRoot + sep);
  if (!withinRoot) throw notFound();

  let data: Buffer;
  try {
    data = await readFile(requestedPath);
  } catch {
    throw notFound();
  }

  const ext = extname(requestedPath).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
  return new Response(new Uint8Array(data), { headers: { "content-type": contentType } });
});
