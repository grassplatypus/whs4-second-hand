// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import {
  assertWithdrawable,
  defaultWithdrawGuard,
  createWithdrawGuard,
  RECENT_SOLD_COOLDOWN_DAYS,
  type WithdrawGuard,
  type WithdrawRules,
} from "./withdrawable";
import { AppError } from "@/features/_shared/error";
import type { AuthDb } from "@/features/auth/db";

const fakeDb = {} as AuthDb;

/** 전부 0/false(통과)인 규칙에서 시작해 필요한 것만 덮어쓴다. */
function rules(over: Partial<WithdrawRules> = {}): WithdrawRules {
  return {
    countActiveEscrows: vi.fn().mockResolvedValue(0),
    countActiveSales: vi.fn().mockResolvedValue(0),
    hasRecentSold: vi.fn().mockResolvedValue(false),
    ...over,
  };
}

describe("assertWithdrawable", () => {
  it("passes with the default guard (no-op)", async () => {
    await expect(assertWithdrawable(fakeDb, "u1")).resolves.toBeUndefined();
  });

  it("passes when defaultWithdrawGuard is passed explicitly", async () => {
    await expect(assertWithdrawable(fakeDb, "u1", defaultWithdrawGuard)).resolves.toBeUndefined();
  });

  it("propagates a custom guard's rejection (e.g. 거래중 block)", async () => {
    const blockingGuard: WithdrawGuard = {
      async assert() {
        throw new AppError("WITHDRAW_BLOCKED", "진행 중인 거래가 있어 탈퇴할 수 없어요.", 409);
      },
    };
    await expect(assertWithdrawable(fakeDb, "u1", blockingGuard)).rejects.toMatchObject({
      code: "WITHDRAW_BLOCKED",
      httpStatus: 409,
    });
  });

  it("calls the injected guard with the db and userId it was given", async () => {
    const assertFn = vi.fn().mockResolvedValue(undefined);
    const guard: WithdrawGuard = { assert: assertFn };

    await assertWithdrawable(fakeDb, "u1", guard);

    expect(assertFn).toHaveBeenCalledWith(fakeDb, "u1");
  });
});

describe("createWithdrawGuard (합성 규칙)", () => {
  it("모든 조건이 깨끗하면 통과한다", async () => {
    const guard = createWithdrawGuard(rules());
    await expect(guard.assert(fakeDb, "u1")).resolves.toBeUndefined();
  });

  it("진행 중 에스크로가 있으면 409로 막는다", async () => {
    const guard = createWithdrawGuard(rules({ countActiveEscrows: vi.fn().mockResolvedValue(1) }));
    await expect(guard.assert(fakeDb, "u1")).rejects.toMatchObject({ code: "WITHDRAW_BLOCKED", httpStatus: 409 });
  });

  it("판매중/예약중 상품이 있으면 409로 막는다", async () => {
    const guard = createWithdrawGuard(rules({ countActiveSales: vi.fn().mockResolvedValue(2) }));
    await expect(guard.assert(fakeDb, "u1")).rejects.toMatchObject({ code: "WITHDRAW_BLOCKED", httpStatus: 409 });
  });

  it("최근 판매완료가 있으면 409로 막는다(쿨다운)", async () => {
    const guard = createWithdrawGuard(rules({ hasRecentSold: vi.fn().mockResolvedValue(true) }));
    await expect(guard.assert(fakeDb, "u1")).rejects.toMatchObject({ code: "WITHDRAW_BLOCKED", httpStatus: 409 });
  });

  it("에스크로를 가장 먼저 검사한다(다른 조회는 부르지 않는다)", async () => {
    const r = rules({ countActiveEscrows: vi.fn().mockResolvedValue(1) });
    const guard = createWithdrawGuard(r);
    await expect(guard.assert(fakeDb, "u1")).rejects.toMatchObject({ code: "WITHDRAW_BLOCKED" });
    expect(r.countActiveSales).not.toHaveBeenCalled();
    expect(r.hasRecentSold).not.toHaveBeenCalled();
  });

  it("hasRecentSold에 기본 쿨다운 일수를 넘긴다", async () => {
    const r = rules();
    const guard = createWithdrawGuard(r);
    await guard.assert(fakeDb, "u1");
    expect(r.hasRecentSold).toHaveBeenCalledWith("u1", RECENT_SOLD_COOLDOWN_DAYS);
  });
});
