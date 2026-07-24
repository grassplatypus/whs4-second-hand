// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let mediaDir: string;
let secretDir: string;

async function loadGET() {
  vi.stubEnv("MEDIA_DIR", mediaDir);
  vi.resetModules();
  return (await import("./route")).GET;
}

function ctx(segments: string[]) {
  return { params: Promise.resolve({ path: segments }) };
}

describe("GET /api/media/[...path] — public, path-traversal must be impossible", () => {
  beforeEach(async () => {
    mediaDir = await mkdtemp(join(tmpdir(), "grass-media-root-"));
    secretDir = await mkdtemp(join(tmpdir(), "grass-media-secret-"));
    await mkdir(join(mediaDir, "products"), { recursive: true });
    await writeFile(join(mediaDir, "products", "abc.jpg"), Buffer.from([1, 2, 3]));
    await writeFile(join(secretDir, "passwd"), "root:x:0:0::/root:/bin/bash");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await rm(mediaDir, { recursive: true, force: true });
    await rm(secretDir, { recursive: true, force: true });
  });

  it("200s and serves a real file inside MEDIA_DIR with the right content-type", async () => {
    const GET = await loadGET();
    const res = await GET(new Request("http://localhost/api/media/products/abc.jpg"), ctx(["products", "abc.jpg"]));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    const body = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(body)).toEqual([1, 2, 3]);
  });

  it("404s for a missing file (does not leak existence)", async () => {
    const GET = await loadGET();
    const res = await GET(new Request("http://localhost/api/media/products/ghost.jpg"), ctx(["products", "ghost.jpg"]));
    expect(res.status).toBe(404);
  });

  it("rejects a '..' segment that escapes MEDIA_DIR via a sibling directory", async () => {
    const GET = await loadGET();
    const escapeSegments = [...join(secretDir).split(/[\\/]/).filter(Boolean).slice(-1), "passwd"];
    // Build a request that walks up out of mediaDir and back down into secretDir's leaf folder + file.
    const segments = ["..", ...escapeSegments];
    const res = await GET(new Request("http://localhost/api/media/" + segments.join("/")), ctx(segments));
    expect(res.status).toBe(404);
  });

  it("rejects classic '../../etc/passwd'-style traversal", async () => {
    const GET = await loadGET();
    const segments = ["..", "..", "..", "..", "etc", "passwd"];
    const res = await GET(new Request("http://localhost/api/media/" + segments.join("/")), ctx(segments));
    expect(res.status).toBe(404);
  });

  it("rejects a segment containing a null byte", async () => {
    const GET = await loadGET();
    const segments = ["products", "abc.jpg\0.png"];
    const res = await GET(new Request("http://localhost/api/media/products/abc.jpg%00.png"), ctx(segments));
    expect(res.status).toBe(404);
  });

  it("rejects an absolute-path style segment (drive/root injection)", async () => {
    const GET = await loadGET();
    const segments = ["C:\\Windows\\system32\\drivers\\etc\\hosts"];
    const res = await GET(new Request("http://localhost/api/media/" + encodeURIComponent(segments[0])), ctx(segments));
    // Either 404 (file doesn't exist under the neutralized path) — the important
    // invariant is that it never actually returns the real Windows hosts file.
    expect(res.status).toBe(404);
  });

  it("404s when no path segments are given", async () => {
    const GET = await loadGET();
    const res = await GET(new Request("http://localhost/api/media/"), ctx([]));
    expect(res.status).toBe(404);
  });
});
