// @vitest-environment node
import { describe, it, expect } from "vitest";
import { coarsen, getGeocoder } from "./geocoder";
import { makeMockGeocoder } from "./mock";
import { KakaoGeocoder } from "./kakao";

describe("coarsen", () => {
  it("rounds coordinates to 2 decimal places (~1.1km grid)", () => {
    expect(coarsen(37.123456, 127.987654)).toEqual({ lat: 37.12, lng: 127.99 });
  });

  it("rounds up at the .x5+ boundary (not truncation)", () => {
    expect(coarsen(37.126, 0)).toEqual({ lat: 37.13, lng: 0 });
  });

  it("rounds down below the .x5 boundary", () => {
    expect(coarsen(37.124, 0)).toEqual({ lat: 37.12, lng: 0 });
  });

  it("handles negative values sanely without crashing", () => {
    expect(coarsen(-37.126, -127.124)).toEqual({ lat: -37.13, lng: -127.12 });
  });

  it("handles zero and whole numbers", () => {
    expect(coarsen(0, 100)).toEqual({ lat: 0, lng: 100 });
  });
});

describe("mock geocoder", () => {
  const region = { sido: "서울특별시", sigungu: "강남구", dong: "역삼동" };

  it("is deterministic: same RegionInput -> same coordinates", async () => {
    const geocoder = makeMockGeocoder();
    const a = await geocoder.geocode(region);
    const b = await geocoder.geocode({ ...region });
    expect(a).toEqual(b);
  });

  it("returns coordinates within Korea's rough bounds", async () => {
    const geocoder = makeMockGeocoder();
    const { lat, lng } = await geocoder.geocode(region);
    expect(lat).toBeGreaterThanOrEqual(33);
    expect(lat).toBeLessThanOrEqual(39);
    expect(lng).toBeGreaterThanOrEqual(124);
    expect(lng).toBeLessThanOrEqual(132);
  });

  it("returns a region string containing the input neighborhood", async () => {
    const geocoder = makeMockGeocoder();
    const { region: regionStr } = await geocoder.geocode(region);
    expect(regionStr).toContain(region.dong);
    expect(regionStr).toContain(region.sigungu);
    expect(regionStr).toContain(region.sido);
  });

  it("returns different coordinates for different neighborhoods", async () => {
    const geocoder = makeMockGeocoder();
    const a = await geocoder.geocode(region);
    const b = await geocoder.geocode({ sido: "부산광역시", sigungu: "해운대구", dong: "우동" });
    expect(a.lat !== b.lat || a.lng !== b.lng).toBe(true);
  });

  it("makes no network calls (network-free)", async () => {
    const originalFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = (() => {
      called = true;
      throw new Error("fetch should not be called by the mock geocoder");
    }) as typeof fetch;
    try {
      const geocoder = makeMockGeocoder();
      await geocoder.geocode(region);
      expect(called).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("getGeocoder", () => {
  it("returns the mock geocoder when KAKAO_LOCAL_API_KEY is absent", () => {
    expect(process.env.KAKAO_LOCAL_API_KEY).toBeFalsy();
    const geocoder = getGeocoder();
    expect(geocoder).not.toBeInstanceOf(KakaoGeocoder);
  });
});
