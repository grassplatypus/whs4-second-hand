// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "@/features/_shared/error";
import { REFRESH_COOKIE } from "@/features/auth/cookies";

const currentUserFromRefresh = vi.fn();
const changeStatus = vi.fn();
const userFindUnique = vi.fn();

vi.mock("@/features/_shared/prisma", () => ({
  prisma: { user: { findUnique: (...args: unknown[]) => userFindUnique(...args) } },
}));
vi.mock("@/features/auth/session", () => ({ currentUserFromRefresh: (...args: unknown[]) => currentUserFromRefresh(...args) }));
vi.mock("@/features/products/status", async () => {
  const actual = await vi.importActual<typeof import("@/features/products/status")>("@/features/products/status");
  return { ...actual, changeStatus: (...args: unknown[]) => changeStatus(...args) };
});

const { POST } = await import("./route");

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function req(body: unknown, cookie?: string): Request {
  return new Request("http://localhost/api/products/p1/status", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

describe("POST /api/products/[id]/status — active USER; ownership+transition enforced in the service", () => {
  beforeEach(() => {
    currentUserFromRefresh.mockReset();
    changeStatus.mockReset();
    userFindUnique.mockReset();
    userFindUnique.mockResolvedValue({ role: "USER", deletedAt: null });
  });

  it("401 UNAUTHENTICATED for a guest", async () => {
    currentUserFromRefresh.mockResolvedValue(null);
    const res = await POST(req({ status: "SOLD" }), ctx("p1"));
    expect(res.status).toBe(401);
    expect(changeStatus).not.toHaveBeenCalled();
  });

  it("400 INVALID_INPUT for a bogus status value", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "owner" });
    const res = await POST(req({ status: "DROP_TABLE" }, `${REFRESH_COOKIE}=tok`), ctx("p1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "INVALID_INPUT" });
    expect(changeStatus).not.toHaveBeenCalled();
  });

  it("200s {ok:true} for a valid transition by the owner", async () => {
    currentUserFromRefresh.mockResolvedValue({ userId: "owner" });
    changeStatus.mockResolvedValue(undefined);
    const res = await POST(req({ status: "RESERVED" }, `${REFRESH_COOKIE}=tok`), ctx("p1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(changeStatus).toHaveBeenCalledWith(expect.anything(), "owner", "p1", "RESERVED");
  });
});
