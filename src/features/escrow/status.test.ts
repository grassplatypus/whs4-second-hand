import { describe, it, expect } from "vitest";
import type { EscrowStatus } from "@prisma/client";
import { TRANSITIONS, assertTransition } from "./status";

const ALL: EscrowStatus[] = [
  "REQUESTED",
  "ACCEPTED",
  "FUNDED",
  "RELEASED",
  "REFUNDED",
  "CANCELLED",
  "DISPUTED",
];

describe("에스크로 상태 전이", () => {
  it("유효 전이를 통과시킨다", () => {
    expect(() => assertTransition("REQUESTED", "ACCEPTED")).not.toThrow();
    expect(() => assertTransition("REQUESTED", "CANCELLED")).not.toThrow();
    expect(() => assertTransition("ACCEPTED", "FUNDED")).not.toThrow();
    expect(() => assertTransition("ACCEPTED", "CANCELLED")).not.toThrow();
    expect(() => assertTransition("FUNDED", "RELEASED")).not.toThrow();
    expect(() => assertTransition("FUNDED", "REFUNDED")).not.toThrow();
    expect(() => assertTransition("FUNDED", "DISPUTED")).not.toThrow();
    expect(() => assertTransition("DISPUTED", "RELEASED")).not.toThrow();
    expect(() => assertTransition("DISPUTED", "REFUNDED")).not.toThrow();
  });

  it("무효 전이는 409로 막는다", () => {
    const invalid: [EscrowStatus, EscrowStatus][] = [
      ["REQUESTED", "FUNDED"],
      ["REQUESTED", "RELEASED"],
      ["ACCEPTED", "RELEASED"],
      ["ACCEPTED", "REFUNDED"],
      ["FUNDED", "ACCEPTED"],
      ["FUNDED", "CANCELLED"],
      ["DISPUTED", "FUNDED"],
    ];
    for (const [cur, next] of invalid) {
      expect(() => assertTransition(cur, next), `${cur}→${next}`).toThrowError(
        expect.objectContaining({ code: "INVALID_TRANSITION", httpStatus: 409 }),
      );
    }
  });

  it("종착 상태(RELEASED/REFUNDED/CANCELLED)는 어디로도 재전이할 수 없다", () => {
    for (const terminal of ["RELEASED", "REFUNDED", "CANCELLED"] as EscrowStatus[]) {
      expect(TRANSITIONS[terminal]).toEqual([]);
      for (const next of ALL) {
        expect(() => assertTransition(terminal, next), `${terminal}→${next}`).toThrow();
      }
    }
  });
});
