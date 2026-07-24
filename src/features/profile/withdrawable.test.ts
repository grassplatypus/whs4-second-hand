// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { assertWithdrawable, defaultWithdrawGuard, type WithdrawGuard } from "./withdrawable";
import { AppError } from "@/features/_shared/error";
import type { AuthDb } from "@/features/auth/db";

const fakeDb = {} as AuthDb;

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
