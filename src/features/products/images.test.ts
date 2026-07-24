// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

let mediaDir: string;

async function loadSaveProductImage() {
  vi.stubEnv("MEDIA_DIR", mediaDir);
  vi.resetModules();
  return (await import("./images")).saveProductImage;
}

/** 진짜 이미지가 아닌(디코딩 불가) 바이트를 image/* mime으로 위장한 파일 — sharp가
 * 실제 내용을 보고 거부하는지 검증한다(선언된 mime만으로는 통과시키지 않음). */
function corruptImageFile(name: string, sizeBytes = 32): File {
  const bytes = new Uint8Array(sizeBytes).fill(1);
  return new File([bytes], name, { type: "image/jpeg" });
}

/** sharp로 실제 픽셀 이미지를 생성해 File로 감싼다. GPS를 포함한 EXIF를 심을 수 있어
 * "업로드 후 메타데이터가 사라지는가"를 진짜 라운드트립으로 검증할 수 있다. */
async function realImageFile(
  name: string,
  opts: { width?: number; height?: number; withGpsExif?: boolean } = {},
): Promise<File> {
  const { width = 400, height = 300, withGpsExif = false } = opts;
  let pipeline = sharp({
    create: { width, height, channels: 3, background: { r: 180, g: 90, b: 40 } },
  }).jpeg();

  if (withGpsExif) {
    pipeline = pipeline.withExif({
      IFD0: {
        Make: "TestCam",
        Model: "TestModel",
        GPSLatitude: "37/1 33/1 0/1",
        GPSLatitudeRef: "N",
        GPSLongitude: "127/1 0/1 0/1",
        GPSLongitudeRef: "E",
      },
    });
  }

  const buffer = await pipeline.toBuffer();
  return new File([buffer], name, { type: "image/jpeg" });
}

describe("saveProductImage", () => {
  beforeEach(async () => {
    mediaDir = await mkdtemp(join(tmpdir(), "grass-media-"));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await rm(mediaDir, { recursive: true, force: true });
  });

  it("rejects a non-image mime type", async () => {
    const saveProductImage = await loadSaveProductImage();
    const file = new File(["hi"], "a.txt", { type: "text/plain" });
    await expect(saveProductImage(file)).rejects.toMatchObject({ code: "INVALID_IMAGE", httpStatus: 400 });
  });

  it("rejects content sharp can't decode even with an image/* mime type", async () => {
    const saveProductImage = await loadSaveProductImage();
    const file = corruptImageFile("a.svg");
    await expect(saveProductImage(file)).rejects.toMatchObject({ code: "INVALID_IMAGE", httpStatus: 400 });
  });

  it("rejects an oversized file (>5MB) with 413", async () => {
    const saveProductImage = await loadSaveProductImage();
    const bytes = new Uint8Array(5 * 1024 * 1024 + 1);
    const file = new File([bytes], "big.jpg", { type: "image/jpeg" });
    await expect(saveProductImage(file)).rejects.toMatchObject({ code: "INVALID_IMAGE", httpStatus: 413 });
  });

  it("strips EXIF/GPS metadata from the stored image (core privacy guarantee)", async () => {
    const saveProductImage = await loadSaveProductImage();
    const file = await realImageFile("gps-photo.jpg", { withGpsExif: true });

    // 업로드 전에 실제로 GPS EXIF가 심겨 있었는지부터 확인한다(라운드트립이 진짜여야 의미가 있다).
    const inputBuffer = Buffer.from(await file.arrayBuffer());
    const inputMeta = await sharp(inputBuffer).metadata();
    expect(inputMeta.exif).toBeDefined();

    const result = await saveProductImage(file);
    const writtenBuffer = await (await import("node:fs/promises")).readFile(join(mediaDir, result.path));
    const outputMeta = await sharp(writtenBuffer).metadata();

    expect(outputMeta.exif).toBeUndefined();
  });

  it("downsizes an oversized image to a 1600px-longest-side cap without upscaling", async () => {
    const saveProductImage = await loadSaveProductImage();
    const file = await realImageFile("huge.jpg", { width: 3000, height: 2000 });

    const result = await saveProductImage(file);
    const writtenBuffer = await (await import("node:fs/promises")).readFile(join(mediaDir, result.path));
    const outputMeta = await sharp(writtenBuffer).metadata();

    expect(outputMeta.width).toBeLessThanOrEqual(1600);
    expect(outputMeta.height).toBeLessThanOrEqual(1600);
    // 원본 3000x2000의 가로세로 비율(3:2)이 유지되어야 한다.
    expect(outputMeta.width).toBe(1600);
    expect(outputMeta.height).toBe(1067);
  });

  it("never upscales a small image", async () => {
    const saveProductImage = await loadSaveProductImage();
    const file = await realImageFile("small.jpg", { width: 200, height: 100 });

    const result = await saveProductImage(file);
    const writtenBuffer = await (await import("node:fs/promises")).readFile(join(mediaDir, result.path));
    const outputMeta = await sharp(writtenBuffer).metadata();

    expect(outputMeta.width).toBe(200);
    expect(outputMeta.height).toBe(100);
  });

  it("stores the file under a server-generated uuid name with the output extension, never the client filename", async () => {
    const saveProductImage = await loadSaveProductImage();
    const file = await realImageFile("../../evil-name.jpg");
    const result = await saveProductImage(file);

    expect(result.path).toMatch(/^products\/[0-9a-f-]{36}\.webp$/);
    expect(result.path).not.toContain("evil-name");
    expect(result.path).not.toContain("..");

    const written = await readdir(join(mediaDir, "products"));
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(/^[0-9a-f-]{36}\.webp$/);

    // 재인코딩된 출력 포맷도 webp여야 한다(입력이 jpeg였어도).
    const writtenBuffer = await (await import("node:fs/promises")).readFile(join(mediaDir, result.path));
    const outputMeta = await sharp(writtenBuffer).metadata();
    expect(outputMeta.format).toBe("webp");
  });

  it("generates a distinct uuid filename per upload", async () => {
    const saveProductImage = await loadSaveProductImage();
    const a = await saveProductImage(await realImageFile("a.png"));
    const b = await saveProductImage(await realImageFile("b.png"));
    expect(a.path).not.toBe(b.path);
  });

  it("503 UPLOAD_FAILED when the destination can't be created (fs failure)", async () => {
    // media/products는 반드시 디렉터리여야 하는데, 미리 같은 이름의 "파일"을 만들어
    // mkdir(recursive:true)가 실패하도록 강제한다(fs 목킹 없이 진짜 실패를 재현).
    await writeFile(join(mediaDir, "products"), "not a directory");
    const saveProductImage = await loadSaveProductImage();
    const file = await realImageFile("a.jpg");
    await expect(saveProductImage(file)).rejects.toMatchObject({ code: "UPLOAD_FAILED", httpStatus: 503 });
  });
});
