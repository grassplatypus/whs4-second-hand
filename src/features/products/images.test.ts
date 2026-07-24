// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let mediaDir: string;

async function loadSaveProductImage() {
  vi.stubEnv("MEDIA_DIR", mediaDir);
  vi.resetModules();
  return (await import("./images")).saveProductImage;
}

function jpegFile(name: string, sizeBytes = 10): File {
  return new File([new Uint8Array(sizeBytes)], name, { type: "image/jpeg" });
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

  it("rejects a disallowed extension even with an image/* mime type", async () => {
    const saveProductImage = await loadSaveProductImage();
    const file = new File(["<svg/>"], "a.svg", { type: "image/svg+xml" });
    await expect(saveProductImage(file)).rejects.toMatchObject({ code: "INVALID_IMAGE", httpStatus: 400 });
  });

  it("rejects a file with no extension", async () => {
    const saveProductImage = await loadSaveProductImage();
    const file = new File(["x"], "noext", { type: "image/jpeg" });
    await expect(saveProductImage(file)).rejects.toMatchObject({ code: "INVALID_IMAGE", httpStatus: 400 });
  });

  it("rejects an oversized file (>5MB) with 413", async () => {
    const saveProductImage = await loadSaveProductImage();
    const file = jpegFile("big.jpg", 5 * 1024 * 1024 + 1);
    await expect(saveProductImage(file)).rejects.toMatchObject({ code: "INVALID_IMAGE", httpStatus: 413 });
  });

  it("stores the file under a server-generated uuid name, never the client filename", async () => {
    const saveProductImage = await loadSaveProductImage();
    const file = jpegFile("../../evil-name.jpg");
    const result = await saveProductImage(file);

    expect(result.path).toMatch(/^products\/[0-9a-f-]{36}\.jpg$/);
    expect(result.path).not.toContain("evil-name");
    expect(result.path).not.toContain("..");

    const written = await readdir(join(mediaDir, "products"));
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(/^[0-9a-f-]{36}\.jpg$/);
  });

  it("generates a distinct uuid filename per upload", async () => {
    const saveProductImage = await loadSaveProductImage();
    const a = await saveProductImage(new File([new Uint8Array(4)], "a.png", { type: "image/png" }));
    const b = await saveProductImage(new File([new Uint8Array(4)], "b.png", { type: "image/png" }));
    expect(a.path).not.toBe(b.path);
  });

  it("503 UPLOAD_FAILED when the destination can't be created (fs failure)", async () => {
    // media/products는 반드시 디렉터리여야 하는데, 미리 같은 이름의 "파일"을 만들어
    // mkdir(recursive:true)가 실패하도록 강제한다(fs 목킹 없이 진짜 실패를 재현).
    await writeFile(join(mediaDir, "products"), "not a directory");
    const saveProductImage = await loadSaveProductImage();
    const file = jpegFile("a.jpg");
    await expect(saveProductImage(file)).rejects.toMatchObject({ code: "UPLOAD_FAILED", httpStatus: 503 });
  });
});
