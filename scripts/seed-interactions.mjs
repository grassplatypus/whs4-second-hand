// 데모 상호작용 시드 — 데모유저(구매자)와 샘플판매자 사이에 채팅·에스크로를 만든다.
// 목적: /chat·/escrow 페이지를 채우고, 채팅방/거래방(날짜 타임라인) 렌더를 실제로 굴려 결함을 드러낸다.
const BASE = process.env.BASE ?? "http://localhost:3000";
const PW = "demo12345";

function client() {
  let cookie = "";
  return async (path, opts = {}) => {
    const res = await fetch(BASE + path, {
      ...opts,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(opts.headers ?? {}) },
    });
    const sc = res.headers.getSetCookie?.() ?? [];
    if (sc.length) cookie = sc.map((c) => c.split(";")[0]).join("; ");
    return res;
  };
}
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };

async function ensureUser(c, email, nick) {
  await c("/api/auth/register", { method: "POST", body: JSON.stringify({ email, phone: "010-1234-5678", nickname: nick, password: PW, passwordConfirm: PW, consent: true }) });
  const r = await c("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password: PW }) });
  if (!r.ok) throw new Error(`login ${email}: ${r.status} ${await r.text()}`);
}

// 1) 샘플판매자 + 상품
const seller = client();
await ensureUser(seller, "sample-seller@example.com", "샘플판매자");
await seller("/api/auth/location", { method: "POST", body: JSON.stringify({ sido: "서울특별시", sigungu: "송파구", dong: "잠실동" }) });
const prodRes = await seller("/api/products", { method: "POST", body: JSON.stringify({ title: "삼성 갤럭시 버즈3 프로", description: "미개봉 새제품이에요. 색상 화이트. 직거래·택배 모두 가능합니다.", price: 150000, category: "DIGITAL", directPlace: "잠실역" }) });
const { id: productId } = await j(prodRes);
console.log("샘플판매자 상품:", productId);

// 2) 데모유저(구매자)
const buyer = client();
await ensureUser(buyer, "demo@example.com", "데모유저");

// 3) 채팅: 구매자 시작 → 판매자 답장 → 구매자 재답
const conv = await j(await buyer("/api/chat/conversations", { method: "POST", body: JSON.stringify({ productId, firstText: "안녕하세요! 버즈3 프로 아직 판매하시나요?" }) }));
const conversationId = conv.conversationId;
console.log("대화:", conversationId);
// 판매자가 답장하려면 판매자 세션이 대화에 참여자로 접근 가능해야 함(판매자 = 상품 소유자)
await seller(`/api/chat/conversations/${conversationId}/messages`, { method: "POST", body: JSON.stringify({ kind: "text", text: "네 판매 중이에요! 잠실역에서 직거래 가능합니다." }) });
await buyer(`/api/chat/conversations/${conversationId}/messages`, { method: "POST", body: JSON.stringify({ kind: "text", text: "좋아요, 내일 저녁 어떠세요?" }) });

// 4) 에스크로: 요청 → 판매자 수락 → 구매자 입금(FUNDED)
const esc = await j(await buyer("/api/escrow", { method: "POST", body: JSON.stringify({ productId, amount: 150000 }) }));
const escrowId = esc.id;
console.log("에스크로:", escrowId);
await seller(`/api/escrow/${escrowId}/accept`, { method: "POST" });
await buyer(`/api/escrow/${escrowId}/fund`, { method: "POST" });

// 5) 두 번째 에스크로: 조정 단계에 머무름(REQUESTED, 판매자 counter) — 다양한 상태 노출
const esc2 = await j(await buyer("/api/escrow", { method: "POST", body: JSON.stringify({ productId, amount: 130000 }) }));
if (esc2.id) await seller(`/api/escrow/${esc2.id}/counter`, { method: "POST", body: JSON.stringify({ amount: 145000 }) });

console.log("완료: 채팅 1건(메시지 3), 에스크로 2건(FUNDED 1, 조정중 1) 시드됨.");
console.log("확인: /chat, /escrow, /chat/" + conversationId + ", /escrow/" + escrowId);
