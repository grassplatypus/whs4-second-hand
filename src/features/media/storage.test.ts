// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let mediaDir: string;
let outsideDir: string;

async function loadDelete() {
  vi.stubEnv("MEDIA_DIR", mediaDir);
  vi.resetModules();
  return (await import("./storage")).deleteStoredMedia;
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

describe("deleteStoredMedia — 저장 디렉터리 안만 지우고, 실패해도 던지지 않는다", () => {
  beforeEach(async () => {
    mediaDir = await mkdtemp(join(tmpdir(), "grass-media-"));
    outsideDir = await mkdtemp(join(tmpdir(), "grass-outside-"));
    await mkdir(join(mediaDir, "avatars"), { recursive: true });
    await writeFile(join(mediaDir, "avatars", "old.webp"), Buffer.from([1, 2, 3]));
    await writeFile(join(outsideDir, "secret.txt"), "건드리면 안 되는 파일");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await rm(mediaDir, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  });

  it("MEDIA_DIR 안의 파일은 실제로 지운다", async () => {
    const deleteStoredMedia = await loadDelete();
    await deleteStoredMedia("avatars/old.webp");
    expect(await exists(join(mediaDir, "avatars", "old.webp"))).toBe(false);
  });

  it("경로 탈출(..)은 무시하고 바깥 파일을 건드리지 않는다", async () => {
    const deleteStoredMedia = await loadDelete();
    // mediaDir과 outsideDir은 같은 임시 디렉터리 형제라 ".." 하나면 실제로 닿는 경로다.
    const escape = join("..", outsideDir.split(/[\\/]/).pop()!, "secret.txt");
    await expect(deleteStoredMedia(escape)).resolves.toBeUndefined();
    expect(await exists(join(outsideDir, "secret.txt"))).toBe(true);
  });

  it("없는 파일·빈 경로여도 던지지 않는다", async () => {
    const deleteStoredMedia = await loadDelete();
    await expect(deleteStoredMedia("avatars/없는파일.webp")).resolves.toBeUndefined();
    await expect(deleteStoredMedia(null)).resolves.toBeUndefined();
    await expect(deleteStoredMedia(undefined)).resolves.toBeUndefined();
  });
});
