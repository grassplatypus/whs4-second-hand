/**
 * Prisma의 P2002(고유 제약 위반)를 구조적으로 감지한다. 무거운
 * PrismaClientKnownRequestError를 import하지 않아 목 객체로도 테스트 가능하다.
 *
 * 문서화된 형태(`meta.target`이 컬럼명 배열)와 이 저장소가 실제로 쓰는
 * @prisma/adapter-pg(드라이버 어댑터) 형태를 둘 다 커버한다 — 어댑터 경로에서는
 * `meta.target` 자체가 없고, 대신 `meta.driverAdapterError.cause.constraint`에
 * 실린다. 실 @prisma/adapter-pg(7.8.0) + 실 Postgres로 재현 확인한 결과, 이
 * `constraint`는 문자열이 아니라 **객체**다 — `{ fields: string[] }`(컬럼명 배열,
 * 우선) 또는 `{ index: "User_nickname_key" }`(Postgres 유니크 인덱스명) 둘 중
 * 하나의 형태로 온다. 아래 코드는 이 두 객체 형태를 명시적으로 처리한다(문자열
 * constraint도 혹시 몰라 계속 받아준다 — 해로울 게 없다).
 */

type UnknownRecord = Record<string, unknown>;

function isRecord(v: unknown): v is UnknownRecord {
  return typeof v === "object" && v !== null;
}

export function isUniqueViolation(err: unknown): boolean {
  return isRecord(err) && (err as { code?: unknown }).code === "P2002";
}

/**
 * collectMetaStrings 폴백에서 제외할 노이즈 토큰. 이런 값들은 컬럼/제약명이 아니라
 * 에러 메타 자체를 서술하는 값이라 후보로 잘못 채택되면(예: modelName "User" ->
 * "user") 미래에 candidate가 우연히 겹칠 때 오검출을 낳는다.
 */
const META_NOISE_KEYS = new Set(["modelname"]);
const META_NOISE_VALUES = new Set(["23505", "uniqueconstraintviolation"]);

/** meta 전체를 얕게 훑어(깊이 제한) 문자열 값을 전부 모으는 방어적 폴백. */
function collectMetaStrings(meta: unknown, depth = 3): string[] {
  if (!isRecord(meta) || depth < 0) return [];
  const out: string[] = [];
  for (const [key, value] of Object.entries(meta)) {
    if (META_NOISE_KEYS.has(key.toLowerCase())) continue;
    if (typeof value === "string") {
      if (!META_NOISE_VALUES.has(value.toLowerCase())) out.push(value);
    } else if (Array.isArray(value)) {
      for (const v of value) {
        if (typeof v === "string" && !META_NOISE_VALUES.has(v.toLowerCase())) out.push(v);
      }
    } else if (isRecord(value)) {
      out.push(...collectMetaStrings(value, depth - 1));
    }
  }
  return out;
}

/**
 * P2002 에러에서 충돌한 컬럼/제약 이름 후보를 최대한 뽑아 소문자로 정규화해 반환한다.
 * 순서대로 시도한다: (a) `meta.target`이 문자열 배열, (b) `meta.target`이 문자열,
 * (c) `meta.driverAdapterError.cause.constraint`가 객체인 실제 형태
 * (`{fields}`/`{index}`) — 명시적으로 처리, (d) 같은 자리의 constraint가 문자열인
 * 경우(안 쓰이지만 방어적으로 유지), (e) 위에서 하나도 못 찾았을 때만 meta 하위의
 * 문자열 전부를 훑는 폴백.
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
    if (isRecord(constraint)) {
      // 실 @prisma/adapter-pg 형태: { fields: string[] } 또는 { index: string }.
      const fields = constraint.fields;
      if (Array.isArray(fields)) {
        for (const f of fields) if (typeof f === "string") targets.push(f);
      }
      const index = constraint.index;
      if (typeof index === "string") targets.push(index);
    } else if (typeof constraint === "string") {
      targets.push(constraint);
    }
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
