import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "@/features/_shared/error";
import { getEnv } from "@/features/_shared/env";

const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);

function invalidImage(message: string, status = 400): AppError {
  return new AppError("INVALID_IMAGE", message, status);
}

/** 클라이언트가 제공한 파일명에서 확장자만 추출한다 — 이 값은 화이트리스트 검사에만 쓰이고,
 * 저장 경로에는 절대 반영되지 않는다(경로 문자열 자체가 아니라 소문자 확장자 토큰 하나뿐이라
 * 트래버설 문자를 옮길 수 없다). */
function extractExtension(filename: string): string | null {
  const idx = filename.lastIndexOf(".");
  if (idx <= 0 || idx === filename.length - 1) return null;
  return filename.slice(idx + 1).toLowerCase();
}

/**
 * 상품 이미지 업로드. 저장 파일명은 항상 서버가 생성한 uuid — 클라이언트가 보낸 파일명은
 * 확장자 화이트리스트 검사에만 쓰고 저장 경로에는 절대 쓰지 않는다(경로 트래버설 방지의 핵심).
 */
export async function saveProductImage(file: File): Promise<{ path: string }> {
  if (!file || typeof file.arrayBuffer !== "function") {
    throw invalidImage("이미지 파일을 첨부해 주세요.");
  }
  if (!file.type || !file.type.startsWith("image/")) {
    throw invalidImage("이미지 파일만 업로드할 수 있어요.");
  }
  const ext = extractExtension(file.name ?? "");
  if (!ext || !ALLOWED_EXTENSIONS.has(ext)) {
    throw invalidImage("지원하지 않는 이미지 형식이에요. (jpg/jpeg/png/webp/gif만 가능)");
  }
  if (file.size > MAX_SIZE_BYTES) {
    throw invalidImage("이미지는 5MB 이하여야 해요.", 413);
  }

  const mediaDir = getEnv().MEDIA_DIR;
  const productsDir = join(mediaDir, "products");
  const filename = `${randomUUID()}.${ext}`;
  const fullPath = join(productsDir, filename);

  try {
    await mkdir(productsDir, { recursive: true });
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(fullPath, buffer);
  } catch {
    throw new AppError("UPLOAD_FAILED", "이미지 업로드에 실패했어요. 잠시 후 다시 시도해 주세요.", 503);
  }

  return { path: `products/${filename}` };
}
