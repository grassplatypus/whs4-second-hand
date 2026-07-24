import type { PrismaClient } from "@prisma/client";

/**
 * 채팅 서비스가 쓰는 DB 표면만 노출한다(상품·닉네임 조회용).
 * 채팅 문서 자체는 Mongo(ChatRepo)에 저장되고, 여기서는 상품 소유자 확인과
 * 상대방 닉네임 조회에만 prisma를 쓴다 — 이메일/전화 등은 select하지 않는다.
 */
export type ChatDb = Pick<PrismaClient, "product" | "user">;
