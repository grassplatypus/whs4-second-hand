// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "@/features/_shared/error";
import { REFRESH_COOKIE } from "@/features/auth/cookies";

const currentUserFromRefresh = vi.fn();
const saveProductImage = vi.fn();
const userFindUnique = vi.fn();

vi.mock("@/features/_shared/prisma", () => ({
  prisma: { user: { findUnique: (...args: unknown[]) => userFindUnique(...args) } },
}));
vi.mock("@/features/auth/session", () => ({ currentUserFromRefresh: (...args: unknown[]) => currentUserFromRefresh(...args) }));
vi.mock("@/features/products/images", () => ({ saveProductImage: (...args: unknown[]) => saveProductImage(...args) }));

const { POST } = await import("./route");

function reqWithForm(form: FormData | null, cookie?: string): Request {
  if (form === null) {
    return new Request("http://localhost/api/products/images", {
      method: "POST",
      headers: cookie ? { cookie } : {},
      body: "not-a-multipart-body",
    });
  }
  return new Request("http://localhost/api/products/images", {
    method: "POST",
    headers: cookie ? { cookie } : {},
    body: form,
  });
}

describe("POST /api/products/images — active USER", () => {
  beforeEach(() => {
    currentUserFromRefresh.mockReset();
    saveProductImage.mockReset();
    userFindUnique.mockReset();
    userFindUnique.mockResolvedValue({ role: "USER", deletedAt: null });
  });

  it("401 UNAUTHENTICATED for a guest", async () => {
    currentUserFromRefresh.mockResolvedValue(null);
    const form = new FormData();
    form.set("file", new File(["x"], "a.jpg", { type: "image/jpeg" }));
    const res = await POST(reqWithForm(form));
    expect(res.status).toBe(401);
    expect(saveProductImage).not.toHaveBeenCalled();
  });

  it("400 INVALID_IMAGE when there's no file field", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    const form = new FormData();
    form.set("caption", "hello");
    const res = await POST(reqWithForm(form, `${REFRESH_COOKIE}=tok`));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "INVALID_IMAGE" });
    expect(saveProductImage).not.toHaveBeenCalled();
  });

  it("propagates the service's validation rejection (e.g. oversized/non-image)", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    saveProductImage.mockImplementationOnce(async () => {
      throw new AppError("INVALID_IMAGE", "이미지는 5MB 이하여야 해요.", 413);
    });
    const form = new FormData();
    form.set("file", new File(["x"], "a.jpg", { type: "image/jpeg" }));
    const res = await POST(reqWithForm(form, `${REFRESH_COOKIE}=tok`));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: "INVALID_IMAGE" });
  });

  it("201s and returns {path} on success", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    saveProductImage.mockResolvedValue({ path: "products/uuid.jpg" });
    const form = new FormData();
    form.set("file", new File(["x"], "a.jpg", { type: "image/jpeg" }));
    const res = await POST(reqWithForm(form, `${REFRESH_COOKIE}=tok`));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ path: "products/uuid.jpg" });
  });
});
