// 데모 전체 시드 — 상품·대화·안전거래·약속·후기·프로필 사진까지 한 번에 채운다.
// 실행 중인 서버(localhost:3000)에 실제 API로 넣으므로 검증·권한 규칙을 그대로 통과한다.
//   실행: node scripts/seed-demo-full.mjs
import sharp from "sharp";

const BASE = process.env.BASE ?? "http://localhost:3000";
const PW = "demo12345";

function client() {
  let cookie = "";
  return async (path, opts = {}) => {
    const isForm = opts.body instanceof FormData;
    const res = await fetch(BASE + path, {
      ...opts,
      headers: {
        ...(isForm ? {} : { "content-type": "application/json" }),
        ...(cookie ? { cookie } : {}),
        ...(opts.headers ?? {}),
      },
    });
    const sc = res.headers.getSetCookie?.() ?? [];
    if (sc.length) cookie = sc.map((c) => c.split(";")[0]).join("; ");
    return res;
  };
}
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };

async function ensureUser(c, email, nickname) {
  await c("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, phone: "010-1234-5678", nickname, password: PW, passwordConfirm: PW, consent: true }),
  });
  const r = await c("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password: PW }) });
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`);
}

/** 닉네임으로 결정적 색을 만든 간단한 프로필 사진(데모용). */
async function uploadAvatar(c, nickname) {
  let h = 0;
  for (const ch of nickname) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const hue = Math.abs(h) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">
    <rect width="400" height="400" fill="hsl(${hue} 60% 55%)"/>
    <circle cx="200" cy="160" r="70" fill="rgba(255,255,255,0.85)"/>
    <ellipse cx="200" cy="330" rx="120" ry="90" fill="rgba(255,255,255,0.85)"/>
  </svg>`;
  const webp = await sharp(Buffer.from(svg)).webp({ quality: 82 }).toBuffer();
  const fd = new FormData();
  fd.append("file", new Blob([webp], { type: "image/webp" }), "avatar.webp");
  const r = await c("/api/profile/avatar", { method: "POST", body: fd });
  return r.ok;
}

console.log("데모 전체 시드 시작…");

// 1) 판매자(샘플) — 프로필 사진 + 상품
const seller = client();
await ensureUser(seller, "sample-seller@example.com", "샘플판매자");
await uploadAvatar(seller, "샘플판매자");
await seller("/api/auth/location", { method: "POST", body: JSON.stringify({ sido: "서울특별시", sigungu: "송파구", dong: "잠실동" }) });

const productIds = [];
for (const p of [
  { title: "삼성 갤럭시 버즈3 프로", description: "미개봉 새제품이에요. 색상 화이트. 직거래·택배 모두 가능합니다.", price: 150000, category: "DIGITAL", directPlace: "잠실역" },
  { title: "브롬톤 자전거 M6L", description: "3년 탔지만 관리 잘 했어요. 접이식이라 보관 편해요.", price: 1250000, category: "SPORTS", directPlace: "잠실 한강공원" },
  { title: "이케아 책상 (린몬/알렉스)", description: "이사 때문에 내놔요. 상판 깨끗합니다.", price: 60000, category: "FURNITURE" },
]) {
  const r = await j(await seller("/api/products", { method: "POST", body: JSON.stringify(p) }));
  if (r.id) productIds.push(r.id);
}
console.log(`  ✓ 샘플판매자: 프로필 사진 + 상품 ${productIds.length}개`);

// 2) 데모유저(구매자) — 프로필 사진
const buyer = client();
await ensureUser(buyer, "demo@example.com", "데모유저");
await uploadAvatar(buyer, "데모유저");
console.log("  ✓ 데모유저: 프로필 사진");

// 3) 채팅 — 대화 + 답장 (읽음/안읽음 상태도 자연스럽게 남는다)
const conv = await j(await buyer("/api/chat/conversations", {
  method: "POST",
  body: JSON.stringify({ productId: productIds[0], firstText: "안녕하세요! 버즈3 프로 아직 판매하시나요?" }),
}));
const conversationId = conv.conversationId;
if (conversationId) {
  await seller(`/api/chat/conversations/${conversationId}/messages`, { method: "POST", body: JSON.stringify({ kind: "text", text: "네 판매 중이에요! 잠실역에서 직거래 가능합니다." }) });
  await buyer(`/api/chat/conversations/${conversationId}/messages`, { method: "POST", body: JSON.stringify({ kind: "text", text: "좋아요, 내일 저녁 7시 어떠세요?" }) });
  console.log("  ✓ 채팅 1건(메시지 3)");
}

// 4) 안전거래 — 완료(정산)까지 + 약속 + 후기
const esc = await j(await buyer("/api/escrow", { method: "POST", body: JSON.stringify({ productId: productIds[0], amount: 150000 }) }));
if (esc.id) {
  await seller(`/api/escrow/${esc.id}/accept`, { method: "POST" });
  const meetAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await buyer(`/api/escrow/${esc.id}/meetup`, { method: "POST", body: JSON.stringify({ place: "잠실역 2번 출구", at: meetAt }) });
  await buyer(`/api/escrow/${esc.id}/fund`, { method: "POST" });
  await buyer(`/api/escrow/${esc.id}/confirm`, { method: "POST" });
  // 정산이 끝났으니 서로 후기를 남긴다.
  await buyer(`/api/escrow/${esc.id}/review`, { method: "POST", body: JSON.stringify({ rating: "GOOD", comment: "시간 잘 지키시고 상태도 설명 그대로였어요!" }) });
  await seller(`/api/escrow/${esc.id}/review`, { method: "POST", body: JSON.stringify({ rating: "GOOD", comment: "친절하게 거래해 주셔서 편했어요." }) });
  console.log("  ✓ 안전거래 1건(약속·정산·양쪽 후기)");
}

// 5) 진행 중 거래 하나 더(조정 단계) — 화면에서 다양한 상태를 볼 수 있게
const esc2 = await j(await buyer("/api/escrow", { method: "POST", body: JSON.stringify({ productId: productIds[1], amount: 1100000 }) }));
if (esc2.id) {
  await seller(`/api/escrow/${esc2.id}/counter`, { method: "POST", body: JSON.stringify({ amount: 1200000 }) });
  console.log("  ✓ 안전거래 1건(가격 조정 중)");
}

console.log("완료. /products · /chat · /escrow · /u/샘플판매자 에서 확인하세요.");
