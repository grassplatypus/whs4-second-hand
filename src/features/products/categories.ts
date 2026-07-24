export const CATEGORIES = [
  "DIGITAL",
  "APPLIANCE",
  "FURNITURE",
  "CLOTHING",
  "BOOK",
  "BEAUTY",
  "SPORTS",
  "ETC",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const STATUSES = ["SELLING", "RESERVED", "SOLD"] as const;
export type Status = (typeof STATUSES)[number];

/**
 * 상태 버튼 노출 여부만 결정하는 UI용 사본이다 — 실제 전이 허용 여부는 언제나
 * 서버(features/products/status.ts의 TRANSITIONS)가 최종 판단한다.
 */
export const STATUS_TRANSITIONS: Record<Status, Status[]> = {
  SELLING: ["RESERVED", "SOLD"],
  RESERVED: ["SELLING", "SOLD"],
  SOLD: [],
};
