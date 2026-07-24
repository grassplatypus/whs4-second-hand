import { AppError } from "@/features/_shared/error";
import type { Geocoder, RegionInput, GeoResult } from "./geocoder";

const ENDPOINT = "https://dapi.kakao.com/v2/local/search/address.json";

export class KakaoGeocoder implements Geocoder {
  constructor(private apiKey: string) {}
  async geocode(input: RegionInput): Promise<GeoResult> {
    const region = `${input.sido} ${input.sigungu} ${input.dong}`.trim();
    const res = await fetch(`${ENDPOINT}?query=${encodeURIComponent(region)}`, {
      headers: { Authorization: `KakaoAK ${this.apiKey}` },
    });
    if (!res.ok) throw new AppError("GEOCODE_FAILED", "위치를 찾지 못했어요.", 502);
    const body = (await res.json()) as { documents?: { x: string; y: string }[] };
    const first = body.documents?.[0];
    if (!first) throw new AppError("GEOCODE_FAILED", "위치를 찾지 못했어요.", 502);
    return { lat: Number(first.y), lng: Number(first.x), region };
  }
}
