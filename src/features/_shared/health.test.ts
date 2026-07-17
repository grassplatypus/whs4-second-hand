import { describe, it, expect, vi } from "vitest";
import { checkHealth } from "./health";

describe("checkHealth", () => {
  it("returns ok when db query succeeds", async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) };
    const res = await checkHealth(db as any);
    expect(res.status).toBe("ok");
    expect(res.db).toBe(true);
    expect(typeof res.ts).toBe("string");
  });

  it("reports db false when query throws", async () => {
    const db = { $queryRaw: vi.fn().mockRejectedValue(new Error("down")) };
    const res = await checkHealth(db as any);
    expect(res.status).toBe("degraded");
    expect(res.db).toBe(false);
  });
});
