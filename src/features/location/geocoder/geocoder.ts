import { getEnv } from "@/features/_shared/env";
import { makeMockGeocoder } from "./mock";
import { KakaoGeocoder } from "./kakao";

export interface RegionInput {
  sido: string;
  sigungu: string;
  dong: string;
}
export interface GeoResult {
  lat: number;
  lng: number;
  region: string;
}
export interface Geocoder {
  geocode(input: RegionInput): Promise<GeoResult>;
}

/** 저장 좌표는 동네 중심으로 거칠게(소수 2자리 ≈1.1km) — 집 특정 방지. */
export function coarsen(lat: number, lng: number): { lat: number; lng: number } {
  return { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 };
}

export function getGeocoder(): Geocoder {
  const key = getEnv().KAKAO_LOCAL_API_KEY;
  return key ? new KakaoGeocoder(key) : makeMockGeocoder();
}
