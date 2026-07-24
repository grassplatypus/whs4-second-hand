import { getEnv } from "@/features/_shared/env";

export interface Mailer {
  send(to: string, subject: string, body: string): Promise<void>;
}

/** 테스트·개발용. 실 SMTP 없이 발송 내역을 메모리에 담는다. 코드는 로그에 남기지 않는다. */
export class MemoryMailer implements Mailer {
  readonly sent: { to: string; subject: string; body: string }[] = [];
  async send(to: string, subject: string, body: string): Promise<void> {
    this.sent.push({ to, subject, body });
  }
}

/** dev 목: 콘솔에 '메일 발송됨'만(코드 평문·수신자 이메일은 남기지 않음). */
class ConsoleMailer implements Mailer {
  async send(): Promise<void> {
    console.log("[MAILER] OTP 메일 발송(목)");
  }
}

let cached: Mailer | null = null;
let warnedSmtpConfiguredButUnimplemented = false;

export function getMailer(): Mailer {
  if (cached) return cached;
  const env = getEnv();
  // TODO: real SMTP transport (scope: 이후). 지금은 SMTP_HOST 설정 여부와 무관하게 항상 콘솔 목이다.
  if (env.SMTP_HOST && !warnedSmtpConfiguredButUnimplemented) {
    warnedSmtpConfiguredButUnimplemented = true;
    console.warn(
      "[MAILER] SMTP_HOST가 설정돼 있지만 실 SMTP 발송은 아직 구현되지 않았습니다 — 코드는 콘솔로만 나갑니다.",
    );
  }
  cached = new ConsoleMailer();
  return cached;
}

export function setMailerForTest(m: Mailer | null): void {
  cached = m;
}
