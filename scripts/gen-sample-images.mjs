// 카테고리별 예시 상품 이미지를 생성한다(sharp, 그라디언트 + 이모지 + 라벨).
// 결과: public/samples/<category>.webp — ProductCard의 썸네일 폴백/데모 시드에 쓴다.
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "samples");
await mkdir(OUT, { recursive: true });

const CATS = [
  { key: "DIGITAL", label: "디지털/가전", emoji: "📱", c1: "#6366f1", c2: "#8b5cf6" },
  { key: "APPLIANCE", label: "생활가전", emoji: "🔌", c1: "#0ea5e9", c2: "#06b6d4" },
  { key: "FURNITURE", label: "가구/인테리어", emoji: "🛋️", c1: "#f59e0b", c2: "#d97706" },
  { key: "CLOTHING", label: "의류", emoji: "👕", c1: "#ec4899", c2: "#db2777" },
  { key: "BOOK", label: "도서", emoji: "📚", c1: "#10b981", c2: "#059669" },
  { key: "BEAUTY", label: "뷰티", emoji: "💄", c1: "#f43f5e", c2: "#e11d48" },
  { key: "SPORTS", label: "스포츠/레저", emoji: "⚽", c1: "#22c55e", c2: "#16a34a" },
  { key: "ETC", label: "기타", emoji: "📦", c1: "#64748b", c2: "#475569" },
];

const W = 600, H = 600;
for (const cat of CATS) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${cat.c1}"/><stop offset="1" stop-color="${cat.c2}"/>
    </linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>
    <text x="50%" y="44%" font-size="180" text-anchor="middle" dominant-baseline="central">${cat.emoji}</text>
    <text x="50%" y="72%" font-size="44" fill="#ffffff" font-family="sans-serif" font-weight="700" text-anchor="middle" opacity="0.95">${cat.label}</text>
  </svg>`;
  const path = join(OUT, `${cat.key}.webp`);
  await sharp(Buffer.from(svg)).webp({ quality: 82 }).toFile(path);
  console.log("✓", path);
}
console.log("완료: 8개 카테고리 예시 이미지 생성됨(public/samples/).");
