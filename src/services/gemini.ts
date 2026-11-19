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
  /** 사진에서 인형뽑기 기계를 찾지 못함 → 광고 없이 재촬영 안내 */
  noMachine?: boolean;
  /** 분석에 쓰인 서버 프롬프트 버전 — 피드백과 함께 돌려보내 성공률 보정에 쓴다 */
  promptVersion?: string;
}

// ── 분석은 Cloudflare Worker 프록시를 통해서만 호출한다 ──────────────────
// 공급자 API 키와 프롬프트는 서버에만 존재한다. EXPO_PUBLIC_* 값은
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
  QUOTA_EXCEEDED: '오늘 분석 가능한 횟수를 모두 사용했습니다.\n잠시 후 다시 이용해주세요.',
  GEO_BLOCKED: 'AI 서버에 일시적인 문제가 있습니다.\n잠시 후 다시 시도해주세요.',
  ANALYZE_FAILED: '분석에 실패했습니다.\n다시 시도해주세요.',
  BAD_JSON: '요청을 처리하지 못했습니다.\n앱을 최신 버전으로 업데이트해주세요.',
};

// 같은 사진으로 다시 보내도 결과가 달라질 수 없는 오류. 나머지는 "같은 사진으로 재시도"를 제공한다.
const NON_RETRYABLE = new Set([
  'UNAUTHORIZED',
  'IMAGE_TOO_LARGE',
  'BAD_IMAGE',
  'BAD_JSON',
  'NO_PROVIDER',
  'QUOTA_EXCEEDED',
]);

// Error 서브클래스는 Babel 변환 후 instanceof가 깨질 수 있어 속성으로 표시한다.
function fail(message: string, retryable: boolean): Error {
  const e: any = new Error(message);
  e.retryable = retryable;
  return e;
}

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
  // confidence는 서버와 똑같이 항상 성공률에서 파생한다 — 모델 값(70 같은 0~100 실수)을 믿으면 100% 바가 된다.
  raw.confidence = Math.min(Math.max(raw.bestTarget.successRate / 100, 0), 1);
  // 서버가 noMachine을 주지 않는 구버전이어도 같은 규칙으로 판정한다(정상 분석의 성공률은 최소 10).
  raw.noMachine =
    raw.noMachine === true ||
    raw.bestTarget.successRate === 0 ||
    raw.bestTarget.name.includes('찾지 못했');
  return raw as AnalysisResult;
}

export async function analyzeClawMachine(base64Image: string): Promise<AnalysisResult> {
  if (!ANALYZE_URL) {
    if (__DEV__) {
      console.error('[analyzeClawMachine] EXPO_PUBLIC_ANALYZE_URL이 비어 있습니다 — 빌드 시점에 .env가 없었습니다.');
    }
    throw fail('앱 설정 오류입니다.\n앱을 최신 버전으로 업데이트해주세요.', false);
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
      throw fail(
        (code && ERROR_MESSAGES[code]) || '분석 중 오류가 발생했습니다.\n다시 시도해주세요.',
        !(code && NON_RETRYABLE.has(code)),
      );
    }

    const result = normalize(payload?.result);
    result.apiSource = payload?.apiSource ?? undefined;
    result.promptVersion = typeof payload?.promptVersion === 'string' ? payload.promptVersion : undefined;
    return result;
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw fail('분석 시간이 초과되었습니다.\n잠시 후 다시 시도해주세요.', true);
    }
    if (err?.message === 'PARSE_ERROR') {
      throw fail('분석 결과를 읽지 못했습니다.\n다시 시도해주세요.', true);
    }
    // fetch 자체 실패(네트워크 없음 등)
    if (err instanceof TypeError) {
      throw fail('네트워크 연결을 확인해주세요.', true);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── 운영: 원격 설정 / 뽑기 결과 피드백 ─────────────────────────────
// 둘 다 부가 기능이다. 실패해도 분석 흐름을 막지 않도록 예외를 밖으로 내보내지 않는다.

export interface RemoteConfig {
  /** 분석 N회당 광고 1회. 0 이하 = 광고 끄기 */
  adEvery: number;
  /** 촬영 화면 상단 공지 */
  notice: string | null;
  /** 이 versionCode보다 낮으면 강제 업데이트 */
  minVersionCode: number;
  /** 이 versionCode보다 낮으면 업데이트 안내 */
  latestVersionCode: number;
}

export const DEFAULT_CONFIG: RemoteConfig = {
  adEvery: 3,
  notice: null,
  minVersionCode: 0,
  latestVersionCode: 0,
};

const baseUrl = () => ANALYZE_URL.replace(/\/+$/, '');

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchRemoteConfig(): Promise<RemoteConfig> {
  if (!ANALYZE_URL) return DEFAULT_CONFIG;
  try {
    const res = await fetchWithTimeout(`${baseUrl()}/config`, {}, 5000);
    if (!res.ok) return DEFAULT_CONFIG;
    const c: any = await res.json();
    return {
      adEvery: Math.min(Math.max(Math.round(num(c?.adEvery, DEFAULT_CONFIG.adEvery)), 0), 20),
      notice: asText(c?.notice).trim().slice(0, 120) || null,
      minVersionCode: Math.max(Math.round(num(c?.minVersionCode, 0)), 0),
      latestVersionCode: Math.max(Math.round(num(c?.latestVersionCode, 0)), 0),
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export type FeedbackOutcome = 'success' | 'fail' | 'skipped';

export function sendFeedback(fb: {
  outcome: FeedbackOutcome;
  successRate: number;
  apiSource?: string;
  promptVersion?: string;
}): void {
  if (!ANALYZE_URL) return;
  fetchWithTimeout(
    `${baseUrl()}/feedback`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(APP_KEY ? { 'x-app-key': APP_KEY } : {}),
      },
      body: JSON.stringify(fb),
    },
    8000
  ).catch(() => {});
}
