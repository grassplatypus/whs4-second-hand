import { createHash } from "node:crypto";
import type { Geocoder, RegionInput, GeoResult } from "./geocoder";

export function makeMockGeocoder(): Geocoder {
  return {
    async geocode(input: RegionInput): Promise<GeoResult> {
      const region = `${input.sido} ${input.sigungu} ${input.dong}`.trim();
      const h = createHash("sha256").update(region).digest();
      // 위도 33~39, 경도 124~132 범위로 매핑(대한민국)
      const lat = 33 + (h.readUInt32BE(0) % 6000) / 1000; // 33.000~38.999
      const lng = 124 + (h.readUInt32BE(4) % 8000) / 1000; // 124.000~131.999
      return { lat, lng, region };
    },
  };
}
