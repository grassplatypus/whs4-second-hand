/**
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { isUniqueViolation, uniqueViolationOn, uniqueViolationTargets } from "./prisma-error";

const documentedShape = { code: "P2002", meta: { target: ["nickname"] } };

// 실 @prisma/adapter-pg(7.8.0) + 실 Postgres로 재현 확인한 진짜 형태: constraint는
// 객체이며 { fields: string[] } 또는 { index: "<Table>_<col>_key" } 둘 중 하나다.
// 아래 두 shape가 이 회귀 가드의 주된 커버리지다 — 문자열 constraint는 실제로는
// 절대 오지 않는다(예전 목이 착각하고 있던 형태).
const realFieldsShape = {
  code: "P2002",
  meta: { modelName: "User", driverAdapterError: { cause: { constraint: { fields: ["nickname"] } } } },
};
const realIndexShape = {
  code: "P2002",
  meta: { modelName: "User", driverAdapterError: { cause: { constraint: { index: "User_nickname_key" } } } },
};
const realFieldsShapeEmail = {
  code: "P2002",
  meta: { modelName: "User", driverAdapterError: { cause: { constraint: { fields: ["emailBlindIndex"] } } } },
};
// 문자열 constraint는 실 어댑터에서는 나오지 않지만, 해로울 게 없어 방어적으로 계속
// 받아준다 — 그 경로가 죽지 않았는지 확인하는 부차적 테스트.
const legacyStringConstraintShape = {
  code: "P2002",
  meta: { modelName: "User", driverAdapterError: { cause: { constraint: "User_nickname_key" } } },
};

describe("isUniqueViolation", () => {
  it("is true for P2002 in any shape", () => {
    expect(isUniqueViolation(documentedShape)).toBe(true);
    expect(isUniqueViolation(realFieldsShape)).toBe(true);
    expect(isUniqueViolation(realIndexShape)).toBe(true);
  });

  it("is false for non-P2002 errors, non-objects, and null", () => {
    expect(isUniqueViolation({ code: "P2003" })).toBe(false);
    expect(isUniqueViolation(new Error("boom"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation("P2002")).toBe(false);
  });
});

describe("uniqueViolationTargets", () => {
  it("reads the documented meta.target array shape", () => {
    expect(uniqueViolationTargets(documentedShape)).toEqual(["nickname"]);
  });

  it("reads the REAL @prisma/adapter-pg constraint shape: { fields: string[] }", () => {
    expect(uniqueViolationTargets(realFieldsShape)).toEqual(["nickname"]);
  });

  it("reads the REAL @prisma/adapter-pg constraint shape: { index: string }", () => {
    expect(uniqueViolationTargets(realIndexShape)).toEqual(["user_nickname_key"]);
  });

  it("splits a string meta.target (e.g. some non-pg connectors)", () => {
    expect(uniqueViolationTargets({ code: "P2002", meta: { target: "nickname" } })).toEqual(["nickname"]);
  });

  it("still reads a string constraint defensively (never occurs in practice, kept harmless)", () => {
    expect(uniqueViolationTargets(legacyStringConstraintShape)).toEqual(["user_nickname_key"]);
  });

  it("returns an empty list when there is nothing to find", () => {
    expect(uniqueViolationTargets({ code: "P2002" })).toEqual([]);
    expect(uniqueViolationTargets({ code: "P2002", meta: {} })).toEqual([]);
  });
});

describe("uniqueViolationOn", () => {
  it("matches the nickname constraint across the documented and BOTH real adapter shapes", () => {
    expect(uniqueViolationOn(documentedShape, "nickname")).toBe(true);
    expect(uniqueViolationOn(realFieldsShape, "nickname")).toBe(true);
    expect(uniqueViolationOn(realIndexShape, "nickname")).toBe(true);
  });

  it("does not cross-match emailBlindIndex against a nickname constraint (no false positive)", () => {
    expect(uniqueViolationOn(documentedShape, "emailBlindIndex")).toBe(false);
    expect(uniqueViolationOn(realFieldsShape, "emailBlindIndex")).toBe(false);
    expect(uniqueViolationOn(realIndexShape, "emailBlindIndex")).toBe(false);
  });

  it("matches the emailBlindIndex constraint (real { fields } shape) without matching nickname", () => {
    expect(uniqueViolationOn(realFieldsShapeEmail, "emailBlindIndex")).toBe(true);
    expect(uniqueViolationOn(realFieldsShapeEmail, "nickname")).toBe(false);
  });

  it("matches the emailBlindIndex constraint in both documented and real { index } shapes without matching nickname", () => {
    const documented = { code: "P2002", meta: { target: ["emailBlindIndex"] } };
    const realIndex = {
      code: "P2002",
      meta: { driverAdapterError: { cause: { constraint: { index: "User_emailBlindIndex_key" } } } },
    };
    expect(uniqueViolationOn(documented, "emailBlindIndex")).toBe(true);
    expect(uniqueViolationOn(realIndex, "emailBlindIndex")).toBe(true);
    expect(uniqueViolationOn(documented, "nickname")).toBe(false);
    expect(uniqueViolationOn(realIndex, "nickname")).toBe(false);
  });

  it("matches a compound constraint (provider, providerUserId) by either column token, real { fields } shape", () => {
    const adapter = {
      code: "P2002",
      meta: { driverAdapterError: { cause: { constraint: { fields: ["provider", "providerUserId"] } } } },
    };
    expect(uniqueViolationOn(adapter, "providerUserId")).toBe(true);
    expect(uniqueViolationOn(adapter, "nickname")).toBe(false);
  });

  it("matches a compound constraint by either column token, real { index } shape", () => {
    const adapter = {
      code: "P2002",
      meta: { driverAdapterError: { cause: { constraint: { index: "AuthIdentity_provider_providerUserId_key" } } } },
    };
    expect(uniqueViolationOn(adapter, "providerUserId")).toBe(true);
    expect(uniqueViolationOn(adapter, "nickname")).toBe(false);
  });

  it("accepts any of several candidates", () => {
    expect(uniqueViolationOn(documentedShape, "emailBlindIndex", "nickname")).toBe(true);
  });

  it("is false for a P2002 whose target names neither candidate column", () => {
    expect(uniqueViolationOn({ code: "P2002", meta: { target: ["someOtherColumn"] } }, "nickname", "emailBlindIndex")).toBe(
      false,
    );
  });

  it("is false for a non-P2002 error even if meta happens to mention the column", () => {
    expect(uniqueViolationOn({ code: "P2003", meta: { target: ["nickname"] } }, "nickname")).toBe(false);
    expect(uniqueViolationOn({ code: "P2003" }, "nickname")).toBe(false);
    expect(uniqueViolationOn(new Error("boom"), "nickname")).toBe(false);
  });
});
