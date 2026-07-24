import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { AppError } from "@/features/_shared/error";
import { getEnv } from "@/features/_shared/env";

const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_DIMENSION = 1600;
const OUTPUT_EXTENSION = "webp";

function invalidImage(message: string, status = 400): AppError {
  return new AppError("INVALID_IMAGE", message, status);
}

/**
 * 상품 이미지 업로드. 원본 업로드는 sharp로 재처리한다:
 * - EXIF/GPS 등 메타데이터를 절대 출력에 복사하지 않는다(.withMetadata() 호출 금지) —
 *   앱 전체가 사용자 홈 위치 보호를 위해 좌표를 대략(~1.1km) 단위로만 저장하는데,
 *   업로드 사진의 GPS EXIF가 그대로 남으면 이 설계 전체가 무의미해진다.
 * - .rotate()로 EXIF 방향 태그를 픽셀에 반영한 뒤 태그 자체는 버린다.
 * - 최대 변 1600px로 축소(확대는 하지 않음), webp로 재인코딩해 저장/전송 용량도 줄인다.
 * 저장 파일명은 항상 서버가 생성한 uuid — 클라이언트가 보낸 파일명은
 * 1차 검증(선언 mime, 크기)에만 쓰고 저장 경로에는 절대 쓰지 않는다(경로 트래버설 방지의 핵심).
 * 저장 확장자는 입력이 아니라 출력 포맷(webp)으로 고정된다.
 */
export async function saveProductImage(file: File): Promise<{ path: string }> {
  if (!file || typeof file.arrayBuffer !== "function") {
    throw invalidImage("이미지 파일을 첨부해 주세요.");
  }
  if (!file.type || !file.type.startsWith("image/")) {
    throw invalidImage("이미지 파일만 업로드할 수 있어요.");
  }
  if (file.size > MAX_SIZE_BYTES) {
    throw invalidImage("이미지는 5MB 이하여야 해요.", 413);
  }

  const inputBuffer = Buffer.from(await file.arrayBuffer());

  let processedBuffer: Buffer;
  try {
    processedBuffer = await sharp(inputBuffer, { failOn: "error" })
      .rotate()
      .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    throw invalidImage("이미지 파일을 처리할 수 없어요. 다른 파일로 시도해 주세요.");
  }

  const mediaDir = getEnv().MEDIA_DIR;
  const productsDir = join(mediaDir, "products");
  const filename = `${randomUUID()}.${OUTPUT_EXTENSION}`;
  const fullPath = join(productsDir, filename);

  try {
    await mkdir(productsDir, { recursive: true });
    await writeFile(fullPath, processedBuffer);
  } catch {
    throw new AppError("UPLOAD_FAILED", "이미지 업로드에 실패했어요. 잠시 후 다시 시도해 주세요.", 503);
  }

  return { path: `products/${filename}` };
}
