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
export function getMailer(): Mailer {
  if (cached) return cached;
  const env = getEnv();
  // SMTP_* 있으면 실 메일러(이후 구현). 지금은 목.
  cached = env.SMTP_HOST ? new ConsoleMailer() : new ConsoleMailer();
  return cached;
}

export function setMailerForTest(m: Mailer | null): void {
  cached = m;
}
