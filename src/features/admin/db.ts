import type { PrismaClient } from "@prisma/client";

/**
 * 관리자 서비스가 쓰는 Postgres 표면. 신고(Mongo)는 ChatRepo로 별도 주입한다.
 * 모든 관리자 액션은 authAuditLog에 남긴다(누가·무엇을·대상).
 */
export type AdminDb = Pick<PrismaClient, "user" | "product" | "escrow" | "authAuditLog">;
