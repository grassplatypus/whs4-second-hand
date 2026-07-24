/**
 * 닉네임으로 결정적 아바타를 그린다 — 저장소·업로드 불필요. 서버·클라이언트 어디서나 쓸 수 있는 순수 컴포넌트.
 * 같은 닉네임은 항상 같은 색/이니셜을 낸다(해시 기반 HSL).
 */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function Avatar({
  nickname,
  size = 40,
  src,
}: {
  nickname: string;
  size?: number;
  /** 업로드한 프로필 사진 경로(media). 없으면 닉네임 기반 이니셜 아바타로 폴백. */
  src?: string | null;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/media/${src}`}
        alt={nickname}
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  const h = hash(nickname);
  const hue = h % 360;
  const bg = `hsl(${hue} 65% 55%)`;
  const bg2 = `hsl(${(hue + 40) % 360} 65% 45%)`;
  // 한글/영문 첫 글자(코드포인트 단위 — 서러게이트 안전)
  const initial = [...nickname.trim()][0]?.toUpperCase() ?? "?";
  const id = `av${h}`;
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label={nickname} className="shrink-0 rounded-full">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={bg} />
          <stop offset="1" stopColor={bg2} />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="20" fill={`url(#${id})`} />
      <text
        x="20"
        y="21"
        dominantBaseline="central"
        textAnchor="middle"
        fontSize="18"
        fontWeight="600"
        fill="#fff"
        fontFamily="system-ui, sans-serif"
      >
        {initial}
      </text>
    </svg>
  );
}
