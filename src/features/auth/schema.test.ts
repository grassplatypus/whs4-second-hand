import { describe, it, expect } from "vitest";
import { registerSchema, loginSchema, availabilitySchema } from "./schema";

const valid = {
  email: "user@example.com",
  phone: "010-1234-5678",
  nickname: "풀숲",
  password: "hunter2hunter2",
  passwordConfirm: "hunter2hunter2",
  consent: true,
};

describe("registerSchema", () => {
  it("accepts a valid payload", () => {
    expect(registerSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a bad email", () => {
    expect(registerSchema.safeParse({ ...valid, email: "nope" }).success).toBe(false);
  });

  it("rejects a short password", () => {
    expect(registerSchema.safeParse({ ...valid, password: "short", passwordConfirm: "short" }).success).toBe(false);
  });

  it("rejects a mismatched confirmation", () => {
    expect(registerSchema.safeParse({ ...valid, passwordConfirm: "different-one" }).success).toBe(false);
  });

  it("rejects missing consent", () => {
    expect(registerSchema.safeParse({ ...valid, consent: false }).success).toBe(false);
  });

  it("rejects a malformed phone", () => {
    expect(registerSchema.safeParse({ ...valid, phone: "abc" }).success).toBe(false);
  });

  it("rejects a phone with fewer than 9 digits (hyphens only don't count)", () => {
    expect(registerSchema.safeParse({ ...valid, phone: "---------" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, phone: "01-234-567" }).success).toBe(false); // 8 digits
  });

  it("trims surrounding whitespace from the nickname", () => {
    const parsed = registerSchema.safeParse({ ...valid, nickname: " 풀숲 " });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.nickname).toBe("풀숲");
  });
});

describe("loginSchema", () => {
  it("accepts email + password", () => {
    expect(loginSchema.safeParse({ email: "user@example.com", password: "x" }).success).toBe(true);
  });

  it("rejects an empty password", () => {
    expect(loginSchema.safeParse({ email: "user@example.com", password: "" }).success).toBe(false);
  });
});

describe("availabilitySchema", () => {
  it("accepts exactly one field", () => {
    expect(availabilitySchema.safeParse({ nickname: "풀숲" }).success).toBe(true);
    expect(availabilitySchema.safeParse({ email: "user@example.com" }).success).toBe(true);
  });

  it("rejects zero or both fields", () => {
    expect(availabilitySchema.safeParse({}).success).toBe(false);
    expect(availabilitySchema.safeParse({ nickname: "풀숲", email: "user@example.com" }).success).toBe(false);
  });

  // registerSchema와 규칙이 어긋나면 "쓸 수 있어요" 판정 후 가입이 400으로 막히는
  // 불일치가 생긴다(리뷰 수정 3).
  it("rejects a 1-char nickname (must match registerSchema's min(2))", () => {
    expect(availabilitySchema.safeParse({ nickname: "a" }).success).toBe(false);
  });

  it("trims whitespace from the nickname before checking", () => {
    const parsed = availabilitySchema.safeParse({ nickname: " 풀숲 " });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.nickname).toBe("풀숲");
  });
});
