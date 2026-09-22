# dollsai-analyze — 분석 프록시 Worker

앱에서 공급자 API 키를 제거하기 위한 Cloudflare Worker입니다.
비전 모델 호출·프롬프트·응답 정규화가 모두 여기서 일어나고, 앱은 사진만 보냅니다.

```
앱 ──POST /analyze { image }──▶ Worker ──▶ Workers AI: Llama 4 Scout  (1차, 무료·키 불필요)
                                      └──▶ Gemini 2.5 Flash           (2차, 키 있을 때만)
```

### 공급자 이력 — 되돌리지 말 것

- **GitHub Models(gpt-4o-mini): 2026-07-30 완전 종료.** `models.inference.ai.azure.com` /
  `models.github.ai` 모두 HTTP 410 `github_models_retirement_brownout`. 복구 불가.
- **Gemini 직접 호출은 한국 사용자에게 대부분 실패한다.** Cloudflare는 사용자와 가까운 콜로에서
  실행되는데 한국 트래픽은 홍콩(HKG)에 자주 배치되고, Google은 그 지역에
  `400 FAILED_PRECONDITION "User location is not supported for the API use."` 를 반환한다.
  `[placement] mode = "smart"` 로도 해결되지 않았다(6/6 실패). 미국 리전 호스팅을 경유할 때만 쓸 수 있다.
- **Workers AI는 Worker 내부에서 실행되어 이 문제가 없다.** 외부 키도 필요 없다. 그래서 1차로 쓴다.
  실측 8/8 성공, 평균 6.0초.
- Groq: `llama-4-scout` 모델 id가 404이고, 이미지 지원 모델(qwen3.6-27b)은 무료 8000 TPM 제한에 걸린다.

### 무료 한도

Workers 무료 플랜은 **하루 10,000 뉴런**입니다. 분석 1건당 대략 60~70 뉴런이므로
**하루 약 150건**까지 무료입니다. 초과하면 요청이 실패하므로, 트래픽이 늘면
Workers Paid($5/월, 1,000뉴런당 $0.011 ≈ 분석 1건당 1원 수준)로 올리면 됩니다.

**왜 필요한가:** `EXPO_PUBLIC_*` 환경변수는 빌드 시 JS 번들에 평문 문자열로 인라인됩니다.
APK/AAB를 압축 해제하면 누구나 키를 꺼낼 수 있으므로, 공급자 키는 앱에 둘 수 없습니다.

## 최초 배포

> **선행 조건: Cloudflare 계정 이메일 인증.**
> 인증 전에는 배포가 `code: 10034` (`You need to verify your email address to use Workers`)로 거부됩니다.
> 가입 메일의 인증 링크를 누르거나, 대시보드에서 재발송하세요.

> **순서가 중요합니다.** `wrangler secret put` 은 Worker가 **이미 존재할 때만** 동작합니다.
> 존재하지 않으면 `code: 10007` (`This Worker does not exist on your account`)이 납니다.
> 따라서 **먼저 배포 → 그다음 secret 등록** 순서로 진행합니다.

```bash
cd server
npm install
npx wrangler login

# 1) 먼저 배포해서 Worker를 생성한다 (이 시점엔 키가 없어 분석은 실패한다)
npm run deploy

# 2) 그다음 secret을 등록한다 (번들·git에 절대 들어가지 않음)
npx wrangler secret put APP_SECRET       # 앱의 EXPO_PUBLIC_APP_KEY와 동일한 값
# GEMINI_API_KEY 는 선택 — 넣지 않으면 Workers AI 만 사용한다(권장).
# 넣더라도 한국 콜로(HKG)에서는 지역 차단으로 실패하니 실효가 거의 없다.

# 3) secret은 즉시 반영된다. /health 로 확인한다.
curl https://<배포URL>/health
```

배포 후 출력되는 URL(`https://dollsai-analyze.<계정>.workers.dev`)을
앱 루트 `.env` 의 `EXPO_PUBLIC_ANALYZE_URL` 에 넣고 **앱을 다시 빌드**해야 합니다.

## 확인

```bash
curl https://<배포URL>/health
# {"ok":true,"providers":["Llama 4 Scout (Workers AI)"]}
```

`providers` 가 빈 배열(`[]`)이면 secret이 아직 등록되지 않은 상태입니다 —
이 상태에서 분석을 호출하면 `500 NO_PROVIDER` 가 돌아옵니다. 위 2)단계를 실행하세요.

앱 키 검증 확인 (401이 나와야 정상):

```bash
curl -X POST https://<배포URL>/analyze -H "Content-Type: application/json" -d '{"image":"x"}'
```

## 로그

```bash
npm run tail   # wrangler tail — 공급자 실패 원인이 여기 찍힙니다
```

## IP당 호출 제한 (선택, 권장)

KV를 바인딩하면 IP당 횟수 제한이 켜집니다. 바인딩이 없으면 제한 없이 동작합니다.

```bash
npx wrangler kv namespace create RATE_LIMIT
```

출력된 `id` 를 `wrangler.toml` 의 `[[kv_namespaces]]` 블록에 채우고 주석을 해제한 뒤 재배포하세요.
한도는 `wrangler.toml` 의 `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_SEC` 로 조정합니다.

## 프롬프트 수정

`src/prompts.ts` 만 고쳐 재배포하면 **앱 업데이트 없이** 분석 품질을 바꿀 수 있습니다.
단, JSON 스키마(키 이름·타입)를 바꾸면 앱의 `src/services/gemini.ts` 타입도 함께 맞춰야 합니다.

## 보안 메모

- `APP_SECRET` 은 앱 번들에서 추출될 수 있습니다. 공급자 키와 달리 **서버에서 즉시 교체**할 수 있고
  호출 제한과 함께 무단 사용 비용을 올리는 장치이지, 강한 인증이 아닙니다.
  더 강하게 막으려면 Play Integrity API 검증을 추가하세요.
- 남용이 의심되면 `wrangler secret put APP_SECRET` 으로 값을 바꾸고 앱을 새 키로 재배포하면 됩니다.
  이때 공급자 키는 건드릴 필요가 없습니다 — 이것이 프록시의 핵심 이점입니다.
