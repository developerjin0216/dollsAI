import { SYSTEM_PROMPT, ANALYSIS_PROMPT } from './prompts';

export interface Env {
  // wrangler secret put ...
  GEMINI_API_KEY?: string;
  APP_SECRET?: string;
  // wrangler.toml [vars]
  MAX_IMAGE_CHARS?: string;
  RATE_LIMIT_MAX?: string;
  RATE_LIMIT_WINDOW_SEC?: string;
  // 선택 바인딩 — 없으면 IP 제한을 건너뛴다.
  RATE_LIMIT?: KVNamespace;
}

interface Provider {
  name: string;
  model: string;
  /** 'binding' = Cloudflare Workers AI(env.AI), 'http' = OpenAI 호환 엔드포인트 */
  kind: 'binding' | 'http';
  url?: string;
  key?: string;
  extra?: Record<string, unknown>;
}

const PER_CALL_TIMEOUT = 25000;

// Gemini 2.5 Flash (OpenAI 호환 엔드포인트). 무료 할당량이 있고 비전·한국어·JSON을 지원한다.
//
// GitHub Models(gpt-4o-mini)는 **제거**했다: 2026-07-30자로 완전 종료되어
// 두 엔드포인트(models.inference.ai.azure.com / models.github.ai) 모두 HTTP 410
// `github_models_retirement_brownout` 을 반환한다. 되살릴 방법이 없다.
//
// Groq도 제외: llama-4-scout 모델 id가 404이고, 이미지를 받는 유일한 모델
// (qwen3.6-27b)은 무료 8000 TPM 제한 때문에 사진 1장도 통과하지 못한다.
//
// 유료 폴백(Claude·OpenAI)을 붙이려면 이 배열에 항목을 추가하기만 하면 된다.
function providers(env: Env): Provider[] {
  const list: Provider[] = [
    // 1차: Cloudflare Workers AI. Worker 내부에서 실행되어 지역 차단이 없고 외부 키도 필요 없다.
    { name: 'Llama 4 Scout (Workers AI)', kind: 'binding', model: '@cf/meta/llama-4-scout-17b-16e-instruct' },
  ];
  // 2차(선택): Gemini. ⚠️ Cloudflare 콜로가 HKG면 Google이 400
  // "User location is not supported for the API use." 를 반환하므로 한국 사용자에겐 대부분 실패한다.
  // 미국 리전 호스팅을 경유할 때만 실효가 있다. 키가 없으면 자동으로 건너뛴다.
  if (env.GEMINI_API_KEY) {
    list.push({
      name: 'Gemini 2.5 Flash',
      kind: 'http',
      url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      model: 'gemini-2.5-flash',
      key: env.GEMINI_API_KEY,
      extra: { reasoning_effort: 'low' },
    });
  }
  return list;
}

// ── 응답 정규화 ──────────────────────────────────────────────
// 앱은 스토어 심사를 거쳐야 고칠 수 있으므로, 모델이 뱉는 이상값은 전부 여기서 막는다.

// 모델은 JSON 앞뒤에 설명·코드펜스·여분의 닫는 괄호를 붙이는 일이 잦다.
// 첫 '{' 부터 괄호가 균형을 이루는 지점까지만 잘라내 그 부분만 파싱한다.
// (문자열 리터럴 안의 괄호·이스케이프는 세지 않는다.)
export function extractJson(raw: string): string {
  const s = raw
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();
  const start = s.indexOf('{');
  if (start < 0) return s;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === '\\') {
      if (inStr) esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return s.slice(start);
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

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
  // difficulty는 모델 값을 믿지 않고 successRate에서 다시 계산 (밴드를 자주 어긴다).
  out.difficulty =
    out.successRate >= 70 ? 'easy' : out.successRate >= 40 ? 'medium' : 'hard';
  out.positionX = Math.min(Math.max(num(out.positionX, 50), 0), 100);
  out.positionY = Math.min(Math.max(num(out.positionY, 50), 0), 100);
  return out;
}

function normalize(parsed: any) {
  parsed.bestTarget = normalizeTarget(parsed.bestTarget);
  parsed.targets = (Array.isArray(parsed.targets) ? parsed.targets : [])
    .filter((t: any) => t && typeof t === 'object')
    .map(normalizeTarget);

  const claw = parsed.claw && typeof parsed.claw === 'object' ? parsed.claw : {};
  parsed.claw = {
    size: asText(claw.size) || '확인 불가',
    position: asText(claw.position),
    positionX: Math.min(Math.max(num(claw.positionX, 50), 0), 100),
    positionY: Math.min(Math.max(num(claw.positionY, 20), 0), 100),
    strength: asText(claw.strength) || '확인 불가',
    openWidth: asText(claw.openWidth) || '확인 불가',
  };

  parsed.strategy = asText(parsed.strategy);
  parsed.tips = (Array.isArray(parsed.tips) ? parsed.tips : []).map(asText).filter(Boolean);
  // confidence는 항상 파생 — 모델이 0~1 대신 0~100을 주는 실수가 흔하다.
  parsed.confidence = Math.min(Math.max(parsed.bestTarget.successRate / 100, 0), 1);
  return parsed;
}

function buildMessages(image: string) {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: ANALYSIS_PROMPT },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image}` } },
      ],
    },
  ];
}

async function callProvider(p: Provider, image: string, colo: string, env: Env): Promise<any> {
  let text: string;
  let finishReason: string | undefined;

  if (p.kind === 'binding') {
    // Workers AI: Worker 내부 실행이라 fetch도 외부 키도 없다.
    const out: any = await (env as any).AI.run(p.model, {
      messages: buildMessages(image),
      temperature: 0.3,
      max_tokens: 4000,
      ...p.extra,
    });
    const c = out?.choices?.[0];
    finishReason = c?.finish_reason;
    text = typeof c?.message?.content === 'string' ? c.message.content : (out?.response ?? '');
  } else {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PER_CALL_TIMEOUT);
    try {
      const res = await fetch(p.url!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.key}` },
        body: JSON.stringify({
          model: p.model,
          messages: buildMessages(image),
          temperature: 0.3,
          max_tokens: 4000,
          response_format: { type: 'json_object' },
          ...p.extra,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        // 상태코드만으로는 원인을 알 수 없다(특히 Gemini는 잘못된 키에도 400을 준다).
        const detail = await res.text().catch(() => '');
        console.warn(`${p.name} HTTP ${res.status} [colo:${colo}] 본문: ${detail.slice(0, 300)}`);
        // Gemini는 미지원 지역에서 400 FAILED_PRECONDITION을 준다 → 지역 문제로 구분해 올린다.
        if (res.status === 400 && detail.includes('User location is not supported')) {
          throw new Error('GEO_BLOCKED');
        }
        throw new Error(`API_ERROR:${res.status}`);
      }

      const data: any = await res.json();
      const choice = data?.choices?.[0];
      finishReason = choice?.finish_reason;
      text = choice?.message?.content ?? '';
    } finally {
      clearTimeout(timer);
    }
  }

  if (!text) throw new Error('EMPTY');
  if (finishReason === 'length') throw new Error('TRUNCATED');

  const parsed = JSON.parse(extractJson(String(text)));
  if (!parsed?.bestTarget || typeof parsed.bestTarget !== 'object' || !parsed.strategy) {
    throw new Error('PARSE_ERROR');
  }
  return normalize(parsed);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// KV가 바인딩된 경우에만 IP당 호출 횟수를 제한한다. 초과 시 true.
async function rateLimited(request: Request, env: Env): Promise<boolean> {
  if (!env.RATE_LIMIT) return false;
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const max = parseInt(env.RATE_LIMIT_MAX ?? '30', 10);
  const windowSec = parseInt(env.RATE_LIMIT_WINDOW_SEC ?? '3600', 10);
  const key = `rl:${ip}`;
  const current = parseInt((await env.RATE_LIMIT.get(key)) ?? '0', 10);
  if (current >= max) return true;
  // 창 단위 카운터: TTL로 자동 만료시킨다 (정확한 슬라이딩 윈도우는 불필요).
  await env.RATE_LIMIT.put(key, String(current + 1), { expirationTtl: windowSec });
  return false;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // 실행 콜로. Gemini 미지원 지역(HKG 등) 진단에 필요하다.
    const colo = ((request as any).cf?.colo as string) ?? 'unknown';

    if (url.pathname === '/health') {
      return json(200, { ok: true, providers: providers(env).map((p) => p.name) });
    }
    if (url.pathname !== '/analyze') return json(404, { error: 'NOT_FOUND' });
    if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });

    // 앱 식별 키. 번들에서 추출될 수 있지만, 공급자 키와 달리 서버에서 즉시 교체할 수 있고
    // 호출 제한과 함께 무단 사용의 비용을 크게 올린다.
    if (env.APP_SECRET && request.headers.get('x-app-key') !== env.APP_SECRET) {
      return json(401, { error: 'UNAUTHORIZED' });
    }

    const maxChars = parseInt(env.MAX_IMAGE_CHARS ?? '700000', 10);
    const declared = Number(request.headers.get('content-length') ?? '0');
    if (declared && declared > maxChars + 4096) {
      return json(413, { error: 'IMAGE_TOO_LARGE' });
    }

    if (await rateLimited(request, env)) {
      return json(429, { error: 'RATE_LIMITED' });
    }

    let image: unknown;
    try {
      const body: any = await request.json();
      image = body?.image;
    } catch {
      return json(400, { error: 'BAD_JSON' });
    }
    if (typeof image !== 'string' || image.length < 1000) {
      return json(400, { error: 'BAD_IMAGE' });
    }
    if (image.length > maxChars) {
      return json(413, { error: 'IMAGE_TOO_LARGE' });
    }

    const list = providers(env);
    if (list.length === 0) {
      console.error('공급자 키가 설정되지 않았습니다 — wrangler secret put 을 실행하세요.');
      return json(500, { error: 'NO_PROVIDER' });
    }

    const statuses: number[] = [];
    let sawAbort = false;
    let lastMessage = '';

    for (const p of list) {
      try {
        const result = await callProvider(p, image, colo, env);
        return json(200, { result, apiSource: p.name });
      } catch (err: any) {
        lastMessage = err?.message ?? '';
        if (lastMessage.startsWith('API_ERROR:')) {
          statuses.push(parseInt(lastMessage.split(':')[1], 10));
        }
        if (err?.name === 'AbortError') sawAbort = true;
        console.warn(`${p.name} 실패: ${lastMessage || err}`);
      }
    }

    // 가장 설명력 있는 실패 원인을 코드로 돌려준다 (앱이 한국어 문구로 변환).
    if (statuses.some((s) => s === 401 || s === 403)) return json(502, { error: 'PROVIDER_AUTH' });
    if (statuses.some((s) => s === 429)) return json(429, { error: 'PROVIDER_RATE_LIMIT' });
    if (statuses.some((s) => s >= 500)) return json(502, { error: 'PROVIDER_UNAVAILABLE' });
    if (lastMessage === 'GEO_BLOCKED') {
      console.error(`지역 차단: colo=${colo} 에서 Gemini 호출 불가 — smart placement 설정을 확인할 것`);
      return json(502, { error: 'GEO_BLOCKED' });
    }
    if (sawAbort) return json(504, { error: 'TIMEOUT' });
    if (lastMessage === 'TRUNCATED') return json(502, { error: 'TRUNCATED' });
    return json(502, { error: 'ANALYZE_FAILED' });
  },
};
