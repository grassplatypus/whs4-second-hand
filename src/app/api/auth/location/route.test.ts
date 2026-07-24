// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { REFRESH_COOKIE } from "@/features/auth/cookies";

const currentUserFromRefresh = vi.fn();
const setLocation = vi.fn();
const getGeocoder = vi.fn(() => ({ geocode: vi.fn() }));
const userFindUnique = vi.fn();

vi.mock("@/features/_shared/prisma", () => ({
  prisma: { user: { findUnique: (...args: unknown[]) => userFindUnique(...args) } },
}));
vi.mock("@/features/auth/session", () => ({ currentUserFromRefresh: (...args: unknown[]) => currentUserFromRefresh(...args) }));
vi.mock("@/features/location/geocoder/geocoder", () => ({ getGeocoder: () => getGeocoder() }));
vi.mock("@/features/location/service", async () => {
  const actual = await vi.importActual<typeof import("@/features/location/service")>("@/features/location/service");
  return { ...actual, setLocation: (...args: unknown[]) => setLocation(...args) };
});

const { POST } = await import("./route");

function req(body: unknown, cookie?: string): Request {
  return new Request("http://localhost/api/auth/location", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/location", () => {
  beforeEach(() => {
    currentUserFromRefresh.mockReset();
    setLocation.mockReset();
    userFindUnique.mockReset();
    userFindUnique.mockResolvedValue({ role: "USER", deletedAt: null });
  });

  it("401 UNAUTHENTICATED without a valid refresh session", async () => {
    currentUserFromRefresh.mockResolvedValue(null);
    const res = await POST(req({ sido: "서울", sigungu: "강남구", dong: "역삼동" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(setLocation).not.toHaveBeenCalled();
  });

  it("400 INVALID_INPUT when a required field is missing/empty", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    const res = await POST(req({ sido: "", sigungu: "강남구", dong: "역삼동" }, `${REFRESH_COOKIE}=tok`));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "INVALID_INPUT" });
    expect(setLocation).not.toHaveBeenCalled();
  });

  it("succeeds and returns only the region (no coordinates) when authenticated with valid input", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "u1" });
    setLocation.mockResolvedValue({ region: "서울특별시 강남구 역삼동" });
    const res = await POST(req({ sido: "서울", sigungu: "강남구", dong: "역삼동" }, `${REFRESH_COOKIE}=tok`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ region: "서울특별시 강남구 역삼동" });
    expect(setLocation).toHaveBeenCalledWith(
      expect.anything(),
      "u1",
      { sido: "서울", sigungu: "강남구", dong: "역삼동" },
      expect.anything(),
      expect.anything(),
    );
  });
});
