// 데모 시드 — 실행 중인 서버(localhost:3000)에 실제 API로 판매자·상품을 넣는다.
// Node fetch + UTF-8 소스라 한글이 깨지지 않는다(Git Bash curl 우회).
//   실행: node scripts/seed-demo.mjs
const BASE = process.env.BASE ?? "http://localhost:3000";
const PW = "hunter2hunter2";
const stamp = Date.now().toString(36);

/** 쿠키 저장 fetch 래퍼(유저별 세션 유지). */
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

let seq = 0;
async function makeSeller({ nick, sido, sigungu, dong, products }) {
  const c = client();
  const email = `demo-${stamp}-${seq++}@example.com`;
  let r = await c("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, phone: "010-1234-5678", nickname: `${nick}${stamp}`, password: PW, passwordConfirm: PW, consent: true }),
  });
  if (!r.ok) throw new Error(`register ${nick}: ${r.status} ${await r.text()}`);
  r = await c("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password: PW }) });
  if (!r.ok) throw new Error(`login ${nick}: ${r.status}`);
  r = await c("/api/auth/location", { method: "POST", body: JSON.stringify({ sido, sigungu, dong }) });
  if (!r.ok) throw new Error(`location ${nick}: ${r.status} ${await r.text()}`);
  for (const p of products) {
    r = await c("/api/products", { method: "POST", body: JSON.stringify(p) });
    if (!r.ok) throw new Error(`product ${p.title}: ${r.status} ${await r.text()}`);
  }
  console.log(`  ✓ ${nick} (${sigungu} ${dong}) — ${products.length}개 상품`);
}

const SELLERS = [
  {
    nick: "강남마켓", sido: "서울특별시", sigungu: "강남구", dong: "역삼동",
    products: [
      { title: "아이폰 14 프로 128GB 딥퍼플", description: "1년 사용, 액정 무파손. 케이스·필름 항상 사용했어요. 배터리 성능 92%.", price: 850000, category: "DIGITAL", directPlace: "역삼역 3번 출구" },
      { title: "에어팟 프로 2세대", description: "구성품 전부 있어요. 소음 제거 잘 됩니다.", price: 180000, category: "DIGITAL" },
      { title: "허먼밀러 에어론 의자 B사이즈", description: "재택근무용으로 샀는데 이사 가서 처분해요. 상태 좋아요.", price: 450000, category: "FURNITURE", directPlace: "역삼동 직거래" },
    ],
  },
  {
    nick: "마포마켓", sido: "서울특별시", sigungu: "마포구", dong: "합정동",
    products: [
      { title: "코베아 캠핑 텐트 4인용", description: "두 번 사용했어요. 방수 잘 되고 설치 간편합니다.", price: 90000, category: "SPORTS" },
      { title: "나이키 에어줌 페가수스 270mm", description: "몇 번 안 신었어요. 러닝화 찾으시는 분께.", price: 55000, category: "CLOTHING" },
      { title: "바라짜 엔코어 커피 그라인더", description: "홈카페용. 원두 갈이 균일해요. 청소 완료.", price: 40000, category: "APPLIANCE", directPlace: "합정역 인근" },
    ],
  },
  {
    nick: "부산마켓", sido: "부산광역시", sigungu: "해운대구", dong: "우동",
    products: [
      { title: "닌텐도 스위치 OLED 화이트", description: "젤다 티어스 오브 더 킹덤 칩 포함. 풀박스.", price: 280000, category: "DIGITAL", directPlace: "해운대역" },
      { title: "다이슨 슈퍼소닉 헤어드라이어", description: "선물 받았는데 안 써서 팝니다. 미개봉에 가까워요.", price: 250000, category: "BEAUTY" },
      { title: "무라카미 하루키 장편소설 전집", description: "상태 깨끗해요. 노르웨이의 숲 포함 12권.", price: 60000, category: "BOOK" },
      { title: "유모차 (스토케 익스플로리)", description: "아기 커서 정리해요. 클리닝 완료, 하자 없음.", price: 120000, category: "ETC", directPlace: "우동 직거래 선호" },
    ],
  },
];

console.log("데모 시드 시작...");
for (const s of SELLERS) await makeSeller(s);
console.log("완료. 상품 " + SELLERS.reduce((n, s) => n + s.products.length, 0) + "개 등록됨.");
