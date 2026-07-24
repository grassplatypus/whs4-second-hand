/**
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { isUniqueViolation, uniqueViolationOn, uniqueViolationTargets } from "./prisma-error";

const documentedShape = { code: "P2002", meta: { target: ["nickname"] } };
const adapterShape = {
  code: "P2002",
  meta: { modelName: "User", driverAdapterError: { cause: { constraint: "User_nickname_key" } } },
};

describe("isUniqueViolation", () => {
  it("is true for P2002 in either shape", () => {
    expect(isUniqueViolation(documentedShape)).toBe(true);
    expect(isUniqueViolation(adapterShape)).toBe(true);
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

  it("reads the real @prisma/adapter-pg nested constraint shape", () => {
    expect(uniqueViolationTargets(adapterShape)).toEqual(["user_nickname_key"]);
  });

  it("splits a string meta.target (e.g. some non-pg connectors)", () => {
    expect(uniqueViolationTargets({ code: "P2002", meta: { target: "nickname" } })).toEqual(["nickname"]);
  });

  it("returns an empty list when there is nothing to find", () => {
    expect(uniqueViolationTargets({ code: "P2002" })).toEqual([]);
    expect(uniqueViolationTargets({ code: "P2002", meta: {} })).toEqual([]);
  });
});

describe("uniqueViolationOn", () => {
  it("matches the nickname constraint in BOTH the documented and real adapter shapes", () => {
    expect(uniqueViolationOn(documentedShape, "nickname")).toBe(true);
    expect(uniqueViolationOn(adapterShape, "nickname")).toBe(true);
  });

  it("does not cross-match emailBlindIndex against a nickname constraint (no false positive)", () => {
    expect(uniqueViolationOn(documentedShape, "emailBlindIndex")).toBe(false);
    expect(uniqueViolationOn(adapterShape, "emailBlindIndex")).toBe(false);
  });

  it("matches the emailBlindIndex constraint in both shapes without matching nickname", () => {
    const documented = { code: "P2002", meta: { target: ["emailBlindIndex"] } };
    const adapter = {
      code: "P2002",
      meta: { driverAdapterError: { cause: { constraint: "User_emailBlindIndex_key" } } },
    };
    expect(uniqueViolationOn(documented, "emailBlindIndex")).toBe(true);
    expect(uniqueViolationOn(adapter, "emailBlindIndex")).toBe(true);
    expect(uniqueViolationOn(documented, "nickname")).toBe(false);
    expect(uniqueViolationOn(adapter, "nickname")).toBe(false);
  });

  it("matches a compound constraint (provider, providerUserId) by either column token", () => {
    const adapter = {
      code: "P2002",
      meta: { driverAdapterError: { cause: { constraint: "AuthIdentity_provider_providerUserId_key" } } },
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
  });
});
