import { ANALYZE_URL, APP_KEY } from '../constants/Config';

export interface ClawInfo {
  size: string;
  position: string;
  positionX: number;
  positionY: number;
  strength: string;
  openWidth: string;
}

export interface Target {
  name: string;
  type: 'plush' | 'box' | 'figure' | 'other';
  position: string;
  positionX: number;
  positionY: number;
  size: string;
  difficulty: 'easy' | 'medium' | 'hard';
  successRate: number; // 0~100, 9가지 요소 종합 성공 확률
  reason: string;
  grabPoint: string;
  grabDetail: string;
}

export interface AnalysisResult {
  claw: ClawInfo;
  targets: Target[];
  bestTarget: Target;
  strategy: string;
  confidence: number;
  tips: string[];
  apiSource?: string;
}

// ── 분석은 Cloudflare Worker 프록시를 통해서만 호출한다 ──────────────────
// 공급자 API 키(GitHub·Groq)와 프롬프트는 서버에만 존재한다. EXPO_PUBLIC_* 값은
// 빌드 시 JS 번들에 문자열로 박히므로, 앱에는 절대 공급자 키를 두지 않는다.
// APP_KEY는 앱 식별용이며 추출될 수 있지만, 서버에서 즉시 교체 가능하고
// 호출 제한과 함께 동작해 공급자 키와 위험도가 전혀 다르다.

const REQUEST_TIMEOUT = 45000; // 서버가 공급자 2곳을 순차로 시도할 수 있어 넉넉히 잡는다.

// 서버 오류 코드 → 사용자에게 보여줄 한국어 문구
const ERROR_MESSAGES: Record<string, string> = {
  UNAUTHORIZED: '앱 인증에 실패했습니다.\n앱을 최신 버전으로 업데이트해주세요.',
  RATE_LIMITED: '이용량이 많아 잠시 제한되었습니다.\n잠시 후 다시 시도해주세요.',
  PROVIDER_RATE_LIMIT: '요청이 너무 많습니다.\n잠시 후 다시 시도해주세요.',
  PROVIDER_AUTH: '서버 인증 오류가 발생했습니다.\n잠시 후 다시 시도해주세요.',
  PROVIDER_UNAVAILABLE: 'AI 서버에 일시적인 문제가 있습니다.\n잠시 후 다시 시도해주세요.',
  TIMEOUT: '분석 시간이 초과되었습니다.\n잠시 후 다시 시도해주세요.',
  TRUNCATED: '분석 결과가 너무 길어 처리하지 못했습니다.\n다시 시도해주세요.',
  IMAGE_TOO_LARGE: '사진 용량이 너무 큽니다.\n다시 촬영해주세요.',
  BAD_IMAGE: '사진을 처리할 수 없습니다.\n다시 촬영해주세요.',
  NO_PROVIDER: '서버 설정 오류입니다.\n잠시 후 다시 시도해주세요.',
};

// ── 방어적 정규화 ────────────────────────────────────────────────
// 서버도 같은 정규화를 하지만, 앱은 스토어 심사 없이 고칠 수 없으므로
// 서버가 예상 밖 값을 주더라도 화면이 깨지지 않도록 한 번 더 막는다.

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// 문자열 자리에 객체/배열이 오면 <Text> 자식으로 렌더될 때 앱이 죽는다.
function asText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join('\n');
  if (typeof v === 'object') return Object.values(v as object).map(asText).filter(Boolean).join(' ');
  return '';
}

const TARGET_TEXT_FIELDS = ['name', 'position', 'size', 'reason', 'grabPoint', 'grabDetail'] as const;

function normalizeTarget(t: any): any {
  const out: any = t && typeof t === 'object' ? t : {};
  TARGET_TEXT_FIELDS.forEach((k) => {
    out[k] = asText(out[k]);
  });
  out.type = ['plush', 'box', 'figure', 'other'].includes(out.type) ? out.type : 'other';
  out.successRate = Math.min(Math.max(Math.round(num(out.successRate, 0)), 0), 100);
  // difficulty는 successRate에서 항상 다시 계산 — 성공률 바 색과 난이도 색이 어긋나지 않게.
  out.difficulty =
    out.successRate >= 70 ? 'easy' : out.successRate >= 40 ? 'medium' : 'hard';
  out.positionX = Math.min(Math.max(num(out.positionX, 50), 0), 100);
  out.positionY = Math.min(Math.max(num(out.positionY, 50), 0), 100);
  return out;
}

function normalize(raw: any): AnalysisResult {
  if (!raw?.bestTarget || typeof raw.bestTarget !== 'object' || !raw.strategy) {
    throw new Error('PARSE_ERROR');
  }
  raw.bestTarget = normalizeTarget(raw.bestTarget);
  raw.targets = (Array.isArray(raw.targets) ? raw.targets : [])
    .filter((t: any) => t && typeof t === 'object')
    .map(normalizeTarget);

  const claw = raw.claw && typeof raw.claw === 'object' ? raw.claw : {};
  raw.claw = {
    size: asText(claw.size) || '확인 불가',
    position: asText(claw.position),
    positionX: Math.min(Math.max(num(claw.positionX, 50), 0), 100),
    positionY: Math.min(Math.max(num(claw.positionY, 20), 0), 100),
    strength: asText(claw.strength) || '확인 불가',
    openWidth: asText(claw.openWidth) || '확인 불가',
  };

  raw.strategy = asText(raw.strategy);
  raw.tips = (Array.isArray(raw.tips) ? raw.tips : []).map(asText).filter(Boolean);
  raw.confidence = Math.min(Math.max(num(raw.confidence, raw.bestTarget.successRate / 100), 0), 1);
  return raw as AnalysisResult;
}

export async function analyzeClawMachine(base64Image: string): Promise<AnalysisResult> {
  if (!ANALYZE_URL) {
    if (__DEV__) {
      console.error('[analyzeClawMachine] EXPO_PUBLIC_ANALYZE_URL이 비어 있습니다 — 빌드 시점에 .env가 없었습니다.');
    }
    throw new Error('앱 설정 오류입니다.\n앱을 최신 버전으로 업데이트해주세요.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(`${ANALYZE_URL.replace(/\/+$/, '')}/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(APP_KEY ? { 'x-app-key': APP_KEY } : {}),
      },
      body: JSON.stringify({ image: base64Image }),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const code = payload?.error as string | undefined;
      if (__DEV__) console.warn('[analyzeClawMachine] 서버 오류:', response.status, code);
      throw new Error(
        (code && ERROR_MESSAGES[code]) || '분석 중 오류가 발생했습니다.\n다시 시도해주세요.',
      );
    }

    const result = normalize(payload?.result);
    result.apiSource = payload?.apiSource ?? undefined;
    return result;
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('분석 시간이 초과되었습니다.\n잠시 후 다시 시도해주세요.');
    }
    if (err?.message === 'PARSE_ERROR') {
      throw new Error('분석 결과를 읽지 못했습니다.\n다시 시도해주세요.');
    }
    // fetch 자체 실패(네트워크 없음 등)
    if (err instanceof TypeError) {
      throw new Error('네트워크 연결을 확인해주세요.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
