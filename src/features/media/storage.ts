import { unlink } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { getEnv } from "@/features/_shared/env";

/**
 * 저장된 미디어 파일 하나를 지운다(프로필 사진 교체·제거·탈퇴 정리용).
 *
 * 두 가지 원칙:
 * 1. 절대 던지지 않는다 — 파일 정리는 곁다리 작업이라 실패해도 요청까지 실패시키면 안 된다.
 *    (DB는 이미 바뀌었는데 응답만 500이 되는 상황을 막는다.) 실패는 로그만 남긴다.
 * 2. MEDIA_DIR 안으로만 한정한다 — 경로는 DB에 저장된 상대경로("avatars/xxx.webp")지만,
 *    값이 오염됐을 가능성을 가정하고 media 라우트와 같은 방식으로 검증한다:
 *    join으로 루트에 붙이고(절대경로 세그먼트가 와도 루트가 리셋되지 않는다) resolve로 ".."를 접은 뒤,
 *    최종 경로가 루트 안인지 다시 확인한다. 벗어나면 아무것도 지우지 않는다.
 */
export async function deleteStoredMedia(relativePath: string | null | undefined): Promise<void> {
  if (!relativePath) return;
  if (relativePath.includes("\0")) return;

  const root = resolve(getEnv().MEDIA_DIR);
  let target: string;
  try {
    target = resolve(join(root, relativePath));
  } catch {
    return;
  }
  if (!target.startsWith(root + sep)) {
    console.warn("[media] 저장 디렉터리 밖 경로라 삭제하지 않는다");
    return;
  }

  try {
    await unlink(target);
  } catch (err) {
    // 이미 없으면 정리된 것과 같으니 조용히 넘어간다.
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return;
    console.warn("[media] 파일 삭제 실패", code ?? "unknown");
  }
}
