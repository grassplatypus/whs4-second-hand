import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { AppError } from "@/features/_shared/error";
import { getEnv } from "@/features/_shared/env";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8MB
const AVATAR_SIZE = 400;

/**
 * 프로필 사진 저장. 상품 이미지와 같은 방침으로 sharp 재처리:
 * EXIF/GPS 제거(회전만 반영), 400x400 정사각 커버 크롭, webp 재인코딩 → 개인정보·용량 최소화.
 * uuid 파일명으로 경로 추측/트래버설을 막는다.
 */
export async function saveAvatar(file: File): Promise<{ path: string }> {
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new AppError("INVALID_IMAGE", "이미지 파일을 첨부해 주세요.", 400);
  }
  const input = Buffer.from(await file.arrayBuffer());
  if (input.byteLength === 0) throw new AppError("INVALID_IMAGE", "빈 파일이에요.", 400);
  if (input.byteLength > MAX_UPLOAD_BYTES) {
    throw new AppError("IMAGE_TOO_LARGE", "이미지는 8MB 이하만 올릴 수 있어요.", 400);
  }

  let processed: Buffer;
  try {
    processed = await sharp(input, { failOn: "error" })
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover" })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    throw new AppError("INVALID_IMAGE", "이미지를 처리할 수 없어요. 다른 파일을 올려 주세요.", 400);
  }

  const dir = join(getEnv().MEDIA_DIR, "avatars");
  const filename = `${randomUUID()}.webp`;
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, filename), processed);
  } catch {
    throw new AppError("UPLOAD_FAILED", "업로드에 실패했어요. 잠시 후 다시 시도해 주세요.", 503);
  }
  return { path: `avatars/${filename}` };
}
