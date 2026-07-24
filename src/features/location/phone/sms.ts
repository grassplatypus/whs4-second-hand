import { getEnv } from "@/features/_shared/env";

export interface Sms {
  send(phonePlaintext: string, code: string): Promise<void>;
}

/** 테스트용. 발송 내역을 메모리에 담는다. 전화번호는 남기지 않고 코드만 캡처한다. */
export class MemorySms implements Sms {
  readonly sent: { code: string }[] = [];
  async send(_phone: string, code: string): Promise<void> {
    this.sent.push({ code });
  }
}

/** dev 목: 콘솔에 '발송됨'만(코드·전화번호 평문은 남기지 않음). */
class ConsoleSms implements Sms {
  async send(): Promise<void> {
    console.log("[SMS] 인증코드 발송(목)"); // 코드·전화 미기록
  }
}

let cached: Sms | null = null;

export function getSms(): Sms {
  if (cached) return cached;
  const env = getEnv();
  // OCTOMO_API_KEY 있으면 실 Octomo(이후). 지금은 목.
  cached = new ConsoleSms();
  if (env.OCTOMO_API_KEY) {
    console.warn("[SMS] OCTOMO 설정됐으나 미구현 — 코드는 콘솔 목");
  }
  return cached;
}

export function setSmsForTest(s: Sms | null): void {
  cached = s;
}
