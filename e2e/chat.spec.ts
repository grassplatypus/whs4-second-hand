import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

// 실 DB + 실 Mongo 필요: docker compose up -d db mongo, MONGO_URL이 호스트에서 접근 가능한 값으로
// 설정돼 있어야 한다(repo가 실 Mongo에 붙는다 — chat.spec.ts만의 특별한 요구사항, 다른 스펙들은 Postgres만 있으면 된다).
const unique = () => `e2echat${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
const PASSWORD = "hunter2hunter2";
const PHONE = "010-1234-5678"; // e2e/auth.spec.ts류와 동일 — register가 전화번호 유일성을 강제하지 않는다.

// e2e/auth.spec.ts·products.spec.ts와 동일 사유: Chromium 기본 Accept-Language가 en-US라
// 쿠키 없는 첫 방문에서 한국어 폴백이 깨진다 — locale을 ko-KR로 고정.
test.use({ locale: "ko-KR" });

async function registerAndLogin(
  request: APIRequestContext,
  id: string,
): Promise<{ email: string }> {
  const email = `${id}@example.com`;
  const reg = await request.post("/api/auth/register", {
    data: {
      email,
      phone: PHONE,
      nickname: id,
      password: PASSWORD,
      passwordConfirm: PASSWORD,
      consent: true,
    },
  });
  expect(reg.status()).toBe(201);

  const login = await request.post("/api/auth/login", { data: { email, password: PASSWORD } });
  expect(login.ok()).toBeTruthy();
  return { email };
}

async function setLocation(request: APIRequestContext): Promise<void> {
  const res = await request.post("/api/auth/location", {
    data: { sido: "서울특별시", sigungu: "강남구", dong: "역삼동" },
  });
  expect(res.ok()).toBeTruthy();
}

// 1x1 투명 PNG(유효한 이미지) — e2e/products.spec.ts와 동일한 최소 실물 이미지.
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

test("판매자는 자기 상품에 채팅을 시작할 수 없다 (SELF_CHAT 400)", async ({ context }) => {
  const sellerId = unique();
  await registerAndLogin(context.request, sellerId);
  await setLocation(context.request);

  const create = await context.request.post("/api/products", {
    data: { title: "셀프챗 테스트 상품", description: "설명", price: 1000, category: "ETC" },
  });
  expect(create.status()).toBe(201);
  const { id: productId } = await create.json();

  const attempt = await context.request.post("/api/chat/conversations", {
    data: { productId, firstText: "제 상품인데 채팅해볼게요" },
  });
  expect(attempt.status()).toBe(400);
  expect((await attempt.json()).code).toBe("SELF_CHAT");
});

test("채팅 슬라이스 전체: 시작→마스킹→이미지-후-답장 규칙→3자 격리→차단→신고, GUEST 401, PII 없음", async ({
  browser,
}) => {
  const sellerCtx = await browser.newContext({ locale: "ko-KR" });
  const buyerCtx = await browser.newContext({ locale: "ko-KR" });
  const thirdCtx = await browser.newContext({ locale: "ko-KR" });

  try {
    const sellerId = unique();
    const buyerId = unique();
    const thirdId = unique();

    const { email: sellerEmail } = await registerAndLogin(sellerCtx.request, sellerId);
    await setLocation(sellerCtx.request);
    const { email: buyerEmail } = await registerAndLogin(buyerCtx.request, buyerId);
    await registerAndLogin(thirdCtx.request, thirdId);

    // 판매자 상품 등록 — 위치가 있어야 상품을 만들 수 있다.
    const create = await sellerCtx.request.post("/api/products", {
      data: { title: "아이패드 팝니다", description: "상태 좋아요", price: 300000, category: "DIGITAL" },
    });
    expect(create.status()).toBe(201);
    const { id: productId } = await create.json();

    // 1) 구매자가 채팅 시작(첫 메시지는 텍스트) → 201, conversationId + 마스킹 없는 정상 텍스트.
    const start = await buyerCtx.request.post("/api/chat/conversations", {
      data: { productId, firstText: "안녕하세요, 구매하고 싶어요" },
    });
    expect(start.status()).toBe(201);
    const startBody = await start.json();
    const conversationId: string = startBody.conversationId;
    expect(typeof conversationId).toBe("string");
    expect(startBody.message.kind).toBe("text");
    expect(startBody.message.masked).toBe(false);
    expect(startBody.message.text).toBe("안녕하세요, 구매하고 싶어요");

    // 목록에 방금 만든 대화가 나타나야 한다 — 상대(판매자)는 닉네임만 노출.
    const listAfterStart = await buyerCtx.request.get("/api/chat/conversations");
    expect(listAfterStart.ok()).toBeTruthy();
    const listAfterStartBody = await listAfterStart.json();
    const listedConv = listAfterStartBody.conversations.find(
      (c: { conversationId: string }) => c.conversationId === conversationId,
    );
    expect(listedConv).toBeDefined();
    expect(listedConv.otherNickname).toBe(sellerId);
    expect(listedConv.productId).toBe(productId);

    // 2) 구매자가 비속어(시발)를 보낸다 — 전달되는 텍스트에 원문이 남지 않아야 한다(마스킹).
    const profanitySend = await buyerCtx.request.post(`/api/chat/conversations/${conversationId}/messages`, {
      data: { kind: "text", text: "저 진짜 시발 화나네요" },
    });
    expect(profanitySend.status()).toBe(201);
    const profanityMsg = await profanitySend.json();
    expect(profanityMsg.message.masked).toBe(true);
    expect(profanityMsg.message.text).not.toContain("시발");
    expect(profanityMsg.message).not.toHaveProperty("rawText");
    const profanityMessageId: string = profanityMsg.message._id;

    // GET 목록에서도 마찬가지로 원문이 새지 않는다(저장 자체가 마스킹본).
    const messagesAfterProfanity = await buyerCtx.request.get(
      `/api/chat/conversations/${conversationId}/messages`,
    );
    expect(messagesAfterProfanity.ok()).toBeTruthy();
    const messagesAfterProfanityBody = await messagesAfterProfanity.json();
    expect(JSON.stringify(messagesAfterProfanityBody)).not.toContain("시발");
    expect(JSON.stringify(messagesAfterProfanityBody)).not.toContain("rawText");

    // 3) 상대(판매자)가 아직 한 번도 답하지 않은 상태에서 구매자가 이미지를 보내면 차단돼야 한다.
    const imageTooEarly = await buyerCtx.request.post(`/api/chat/conversations/${conversationId}/messages`, {
      data: { kind: "image", imagePath: "products/placeholder.webp" },
    });
    expect(imageTooEarly.status()).toBe(400);
    expect((await imageTooEarly.json()).code).toBe("IMAGE_BEFORE_REPLY");

    // 4) 판매자가 답장하면 — 그 뒤로는 구매자가 이미지를 보낼 수 있어야 한다.
    const sellerReply = await sellerCtx.request.post(`/api/chat/conversations/${conversationId}/messages`, {
      data: { kind: "text", text: "네, 언제 거래하면 좋을까요?" },
    });
    expect(sellerReply.status()).toBe(201);
    const sellerReplyBody = await sellerReply.json();
    const sellerUserId: string = sellerReplyBody.message.senderId;
    expect(typeof sellerUserId).toBe("string");

    const upload = await buyerCtx.request.post("/api/products/images", {
      multipart: {
        file: { name: "photo.png", mimeType: "image/png", buffer: Buffer.from(TINY_PNG_BASE64, "base64") },
      },
    });
    expect(upload.status()).toBe(201);
    const { path: imagePath } = await upload.json();

    const imageAfterReply = await buyerCtx.request.post(`/api/chat/conversations/${conversationId}/messages`, {
      data: { kind: "image", imagePath },
    });
    expect(imageAfterReply.status()).toBe(201);
    const imageAfterReplyBody = await imageAfterReply.json();
    expect(imageAfterReplyBody.message.kind).toBe("image");
    expect(imageAfterReplyBody.message.imagePath).toBe(imagePath);

    // 5) 제3자(대화 참여자가 아닌 유저)의 메시지 조회는 403 FORBIDDEN이어야 한다(참여자 격리).
    const thirdPartyRead = await thirdCtx.request.get(`/api/chat/conversations/${conversationId}/messages`);
    expect(thirdPartyRead.status()).toBe(403);
    expect((await thirdPartyRead.json()).code).toBe("FORBIDDEN");

    // 6) 구매자가 판매자를 차단하면 판매자의 전송이 막힌다(양방향 체크) → 차단 해제하면 다시 된다.
    const block = await buyerCtx.request.post("/api/chat/block", { data: { targetId: sellerUserId } });
    expect(block.ok()).toBeTruthy();
    expect(await block.json()).toEqual({ ok: true });

    const sellerSendWhileBlocked = await sellerCtx.request.post(
      `/api/chat/conversations/${conversationId}/messages`,
      { data: { kind: "text", text: "아직 거기 계신가요?" } },
    );
    expect(sellerSendWhileBlocked.status()).toBe(403);
    expect((await sellerSendWhileBlocked.json()).code).toBe("BLOCKED");

    const unblock = await buyerCtx.request.post("/api/chat/unblock", { data: { targetId: sellerUserId } });
    expect(unblock.ok()).toBeTruthy();
    expect(await unblock.json()).toEqual({ ok: true });

    const sellerSendAfterUnblock = await sellerCtx.request.post(
      `/api/chat/conversations/${conversationId}/messages`,
      { data: { kind: "text", text: "다시 왔어요" } },
    );
    expect(sellerSendAfterUnblock.status()).toBe(201);

    // 7) 신고 — 아까 보낸 비속어 메시지를 신고한다.
    const report = await buyerCtx.request.post("/api/chat/report", {
      data: { targetType: "message", targetId: profanityMessageId, reason: "부적절한 언어 사용" },
    });
    expect(report.ok()).toBeTruthy();
    expect(await report.json()).toEqual({ ok: true });

    // 8) GUEST(세션 없음, 쿠키 자체가 없는 별도 컨텍스트)는 어떤 채팅 엔드포인트도 401이어야 한다.
    const guestCtx = await browser.newContext({ locale: "ko-KR" });
    try {
      const guestStart = await guestCtx.request.post("/api/chat/conversations", {
        data: { productId, firstText: "게스트 시도" },
      });
      expect(guestStart.status()).toBe(401);
      expect((await guestStart.json()).code).toBe("UNAUTHENTICATED");

      const guestList = await guestCtx.request.get("/api/chat/conversations");
      expect(guestList.status()).toBe(401);
      expect((await guestList.json()).code).toBe("UNAUTHENTICATED");

      const guestMessages = await guestCtx.request.get(`/api/chat/conversations/${conversationId}/messages`);
      expect(guestMessages.status()).toBe(401);
      expect((await guestMessages.json()).code).toBe("UNAUTHENTICATED");

      const guestBlock = await guestCtx.request.post("/api/chat/block", { data: { targetId: sellerUserId } });
      expect(guestBlock.status()).toBe(401);
      expect((await guestBlock.json()).code).toBe("UNAUTHENTICATED");

      const guestReport = await guestCtx.request.post("/api/chat/report", {
        data: { targetType: "message", targetId: profanityMessageId, reason: "x" },
      });
      expect(guestReport.status()).toBe(401);
      expect((await guestReport.json()).code).toBe("UNAUTHENTICATED");
    } finally {
      await guestCtx.close();
    }

    // 9) PII 없음 — 대화 목록/메시지 목록 어디에도 이메일·전화번호가 없어야 한다.
    const finalList = await buyerCtx.request.get("/api/chat/conversations");
    const finalListBody = await finalList.json();
    const finalMessages = await buyerCtx.request.get(`/api/chat/conversations/${conversationId}/messages`);
    const finalMessagesBody = await finalMessages.json();
    const combined = JSON.stringify(finalListBody) + JSON.stringify(finalMessagesBody);
    expect(combined).not.toContain(sellerEmail);
    expect(combined).not.toContain(buyerEmail);
    expect(combined).not.toContain(PHONE);
    expect(combined).not.toContain("01012345678");

    // 10) 페이지 레벨 — /chat 목록과 /chat/[id] 방이 실제로 렌더되는지 확인한다.
    const buyerPage: Page = await buyerCtx.newPage();
    await buyerPage.goto("/chat");
    await expect(buyerPage.getByRole("heading", { name: "채팅" })).toBeVisible();
    await expect(buyerPage.getByText(sellerId)).toBeVisible();

    await buyerPage.goto(`/chat/${conversationId}`);
    await expect(buyerPage.getByRole("heading", { name: sellerId })).toBeVisible();
    await expect(buyerPage.getByRole("link", { name: "상품 보기" })).toBeVisible();
    const roomHtml = await buyerPage.content();
    expect(roomHtml).not.toContain("시발");
    expect(roomHtml).not.toContain(sellerEmail);
    expect(roomHtml).not.toContain(buyerEmail);
    await buyerPage.close();

    // WS 실시간: 접근토큰을 아직 클라이언트에 보관하지 않아(진행 개선/best-effort, ChatRoom accessToken prop
    // 참고) 이 페이지는 WS 연결을 아예 시도하지 않는다 — REST만으로 위 전체 흐름이 이미 증명됐다.
    // WS 서버 자체의 인증 미들웨어(무효/부재 토큰 거부·참여자만 join·마스킹 브로드캐스트)는
    // src/server/ws/{chat,server}.test.ts의 실 socket.io 통합 유닛 테스트가 이미 커버한다.
  } finally {
    await sellerCtx.close();
    await buyerCtx.close();
    await thirdCtx.close();
  }
});
