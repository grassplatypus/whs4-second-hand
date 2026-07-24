/**
 * Prisma의 P2002(고유 제약 위반)를 구조적으로 감지한다. 무거운
 * PrismaClientKnownRequestError를 import하지 않아 목 객체로도 테스트 가능하다.
 *
 * 문서화된 형태(`meta.target`이 컬럼명 배열)와 이 저장소가 실제로 쓰는
 * @prisma/adapter-pg(드라이버 어댑터) 형태를 둘 다 커버한다 — 어댑터 경로에서는
 * `meta.target` 자체가 없고, 대신 `meta.driverAdapterError.cause.constraint`에
 * Postgres 유니크 인덱스명(예: `User_nickname_key`)이 실린다(실 Postgres로 재현 확인).
 */

type UnknownRecord = Record<string, unknown>;

function isRecord(v: unknown): v is UnknownRecord {
  return typeof v === "object" && v !== null;
}

export function isUniqueViolation(err: unknown): boolean {
  return isRecord(err) && (err as { code?: unknown }).code === "P2002";
}

/** meta 전체를 얕게 훑어(깊이 제한) 문자열 값을 전부 모으는 방어적 폴백. */
function collectMetaStrings(meta: unknown, depth = 3): string[] {
  if (!isRecord(meta) || depth < 0) return [];
  const out: string[] = [];
  for (const value of Object.values(meta)) {
    if (typeof value === "string") {
      out.push(value);
    } else if (Array.isArray(value)) {
      for (const v of value) if (typeof v === "string") out.push(v);
    } else if (isRecord(value)) {
      out.push(...collectMetaStrings(value, depth - 1));
    }
  }
  return out;
}

/**
 * P2002 에러에서 충돌한 컬럼/제약 이름 후보를 최대한 뽑아 소문자로 정규화해 반환한다.
 * 순서대로 시도한다: (a) `meta.target`이 문자열 배열, (b) `meta.target`이 문자열,
 * (c) `meta.driverAdapterError.cause.constraint`, (d) 그 외 meta 하위의 문자열 전부.
 */
export function uniqueViolationTargets(err: unknown): string[] {
  if (!isRecord(err)) return [];
  const meta = (err as { meta?: unknown }).meta;
  if (!isRecord(meta)) return [];

  const targets: string[] = [];

  const target = meta.target;
  if (Array.isArray(target)) {
    for (const t of target) if (typeof t === "string") targets.push(t);
  } else if (typeof target === "string") {
    targets.push(...target.split(/[,\s]+/).filter(Boolean));
  }

  const driverAdapterError = meta.driverAdapterError;
  if (isRecord(driverAdapterError)) {
    const cause = driverAdapterError.cause;
    const constraint = isRecord(cause) ? cause.constraint : undefined;
    if (typeof constraint === "string") targets.push(constraint);
  }

  if (targets.length === 0) targets.push(...collectMetaStrings(meta));

  return targets.map((t) => t.toLowerCase());
}

/**
 * target 문자열이 candidate 컬럼을 가리키는지 판정한다. 완전 일치(컬럼명 배열 케이스)
 * 뿐 아니라 Postgres의 `<Table>_<column>_key` 관례를 토큰 단위로 인식해, 예를 들어
 * `user_nickname_key`는 candidate `nickname`과는 매칭되지만 `emailblindindex`와는
 * 매칭되지 않는다(부분 문자열 오검출 방지).
 */
function tokenMatches(target: string, candidate: string): boolean {
  const t = target.toLowerCase();
  const c = candidate.toLowerCase();
  if (t === c) return true;
  return t.includes(`_${c}_`) || t.startsWith(`${c}_`) || t.endsWith(`_${c}`);
}

export function uniqueViolationOn(err: unknown, ...candidates: string[]): boolean {
  if (!isUniqueViolation(err)) return false;
  const targets = uniqueViolationTargets(err);
  return targets.some((t) => candidates.some((c) => tokenMatches(t, c)));
}
