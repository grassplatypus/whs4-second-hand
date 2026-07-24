// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "@/features/_shared/error";

const getPublicProfile = vi.fn();

vi.mock("@/features/_shared/prisma", () => ({ prisma: {} }));
vi.mock("@/features/profile/service", async () => {
  const actual = await vi.importActual<typeof import("@/features/profile/service")>("@/features/profile/service");
  return { ...actual, getPublicProfile: (...args: unknown[]) => getPublicProfile(...args) };
});

const { GET } = await import("./route");

function ctx(nickname: string) {
  return { params: Promise.resolve({ nickname }) };
}

describe("GET /api/profile/[nickname] — public, no auth", () => {
  beforeEach(() => {
    getPublicProfile.mockReset();
  });

  it("returns only the public subset without any auth cookie", async () => {
    getPublicProfile.mockResolvedValue({ nickname: "n1", bio: "hi", region: "서울 강남구", phoneVerified: true, createdAt: new Date(0) });
    const res = await GET(new Request("http://localhost/api/profile/n1"), ctx("n1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ nickname: "n1", bio: "hi", region: "서울 강남구", phoneVerified: true, createdAt: new Date(0).toISOString() });
    expect(getPublicProfile).toHaveBeenCalledWith(expect.anything(), "n1");
  });

  it("404 NOT_FOUND when the user doesn't exist", async () => {
    getPublicProfile.mockRejectedValue(new AppError("NOT_FOUND", "사용자를 찾을 수 없어요.", 404));
    const res = await GET(new Request("http://localhost/api/profile/ghost"), ctx("ghost"));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "NOT_FOUND" });
  });

  it("handles nicknames with literal % unchanged (no double-decode 500)", async () => {
    getPublicProfile.mockResolvedValue({ nickname: "100%off", bio: "discount", region: "서울", phoneVerified: false, createdAt: new Date(0) });
    const res = await GET(new Request("http://localhost/api/profile/100%25off"), ctx("100%off"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ nickname: "100%off", bio: "discount", region: "서울", phoneVerified: false, createdAt: new Date(0).toISOString() });
    expect(getPublicProfile).toHaveBeenCalledWith(expect.anything(), "100%off");
  });
});
