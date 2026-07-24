import { MongoClient, type Db } from "mongodb";
import { getEnv } from "@/features/_shared/env";

/** 채팅 Mongo 컬렉션 이름 상수 — repo.ts 전체에서 이 상수만 사용한다. */
export const COLLECTIONS = {
  conversations: "conversations",
  messages: "messages",
  blocks: "blocks",
  reports: "reports",
} as const;

let client: MongoClient | null = null;
let db: Db | null = null;

/**
 * 채팅용 Mongo Db를 lazy singleton으로 반환한다.
 * 최초 호출 시에만 연결하고, 이후 호출은 캐시된 인스턴스를 재사용한다.
 */
export async function getChatDb(): Promise<Db> {
  if (db) return db;
  const url = getEnv().MONGO_URL;
  client = new MongoClient(url);
  await client.connect();
  db = client.db();
  return db;
}

/**
 * 테스트 전용 훅 — 실제 Mongo 연결 없이 Db를 주입하거나(fake/mock),
 * null을 넘겨 캐시를 리셋한다. 앱 코드에서는 호출하지 않는다.
 */
export function setChatDbForTest(value: Db | null): void {
  db = value;
}
