# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

"뽑기 AI" (Dolls AI) — a React Native/Expo mobile app that uses AI to analyze claw machine photos and provide prize-grabbing strategies. Users take a photo of a claw machine, the app sends it to a vision LLM for analysis, shows a rewarded ad, then displays strategic recommendations in Korean. The vision call goes through a **Cloudflare Worker proxy** (`server/`) that holds the provider keys and prompts; the app never sees an API key. The Worker runs the vision model on **Cloudflare Workers AI** (`@cf/meta/llama-4-scout-17b-16e-instruct`) via the `AI` binding — in-Worker execution means no external API key and no geo restriction.

## Development Commands

```bash
npm start          # Start Expo dev server
npm run android    # Run on Android (expo run:android — local native build)
npm run ios        # Run on iOS (expo run:ios — local native build)
npm run web        # Run web version
```

### Android Local Build (primary workflow)

Builds are done in **Android Studio** (open the `android/` folder) or via Gradle directly. Do **not** use `eas build`, `expo prebuild`, or `expo run:*` unless explicitly asked.

```bash
cd android && ./gradlew assembleRelease   # Build release APK
cd android && ./gradlew bundleRelease     # Build release AAB (for Play Store)
```

The Gradle release build runs Metro (`expo export:embed`) to embed the JS bundle and inline `EXPO_PUBLIC_*` values, so **`.env` must exist at the repo root at build time** (it's gitignored — absent on fresh checkouts → `EXPO_PUBLIC_ANALYZE_URL` becomes an empty string and every analysis fails with the config error). Debug builds run from Android Studio still need a Metro dev server (`npx expo start`) for JS.

**The Worker must be deployed before building an app release**, because the app is useless without a reachable `EXPO_PUBLIC_ANALYZE_URL`. Order: deploy `server/` → copy the printed URL into `.env` → Gradle build.

⚠️ **`.env` is NOT a tracked Gradle input.** Editing it does not invalidate `createBundleReleaseJsAndAssets`, so Gradle reports `BUILD SUCCESSFUL` while silently reusing the previous JS bundle with the *old* inlined values. After any `.env` change you must force a re-bundle:

```bash
cd android && find app/build -name "index.android.bundle" -delete && ./gradlew bundleRelease
```

Always verify the shipped bundle rather than trusting the build result — extract `base/assets/index.android.bundle` from the AAB and grep it. Note it is **Hermes bytecode**, and non-ASCII strings are stored as **UTF-16**, so a UTF-8 search for Korean text gives false negatives; search both encodings.

### Signing Config After Prebuild

If `expo prebuild --clean` is ever run, the `android/` folder is regenerated and **all custom config is lost**. You must restore:
1. Release signing config in `android/app/build.gradle` (see `signing.gradle` for the config block)
2. `android/local.properties` with the correct Android SDK path

### EAS Build (cloud, only when explicitly requested)

```bash
eas build --profile production    # Production build (auto-increments version)
eas submit --profile production   # Submit to stores
```

## Architecture

### App Flow (State Machine)

The app uses a simple 4-state machine in `App.tsx` instead of navigation:

`camera` → `analyzing` → `ad` → `result`

- **camera**: `expo-camera` viewfinder with capture button (captures at quality 0.6)
- **analyzing**: Resizes image (800px width, 0.5 compression) and sends base64 to the vision API
- **ad**: Displays a Google AdMob rewarded ad (pending result held in `useRef`)
- **result**: `AnalysisOverlay` renders the photo with a claw marker (magenta ↓), numbered target markers, a "best target" star, claw analysis, confidence bar, strategy, tips, and a `Powered by <apiSource>` footer. The image box uses `aspectRatio` from the captured photo with `resizeMode="contain"` — markers are absolutely positioned by `positionX/Y` percentage, so the box aspect **must** equal the photo aspect or every marker lands on the wrong prize. The aspect comes from the `manipulateAsync` output (EXIF rotation baked into pixels, and it is the exact image the model saw), not from `takePictureAsync`.

### Key Patterns

- **API layer / security boundary**: `src/services/gemini.ts` is a thin client that POSTs `{ image }` to `${EXPO_PUBLIC_ANALYZE_URL}/analyze` with an `x-app-key` header. **It contains no provider keys and no prompts.** All vision calls, prompts, and the provider chain live in the Worker (`server/src/`).
  **Never reintroduce a provider key into the app.** `EXPO_PUBLIC_*` values are inlined by Metro as plaintext string literals at build time, so anything placed there is extractable from the shipped APK/AAB. `EXPO_PUBLIC_APP_KEY` is deliberately different in kind: it only identifies the app to the Worker, is rotatable server-side via `wrangler secret put APP_SECRET` without touching provider keys, and is backed by optional per-IP rate limiting.
  Prompts live in `server/src/prompts.ts` so analysis quality can be changed by redeploying the Worker with **no app release**. Changing the JSON schema still requires updating the app's `AnalysisResult` types.
  Provider history — **do not try to restore these**:
  - **GitHub Models (`gpt-4o-mini`) was fully retired on 2026-07-30.** Both `models.inference.ai.azure.com` and `models.github.ai` return HTTP 410 `github_models_retirement_brownout`. It cannot be revived; this took the app's only provider offline and forced the migration to Gemini.
  - **Groq** was removed earlier: the configured `meta-llama/llama-4-scout-17b-16e-instruct` returns 404 (model gone), and the only vision-capable model on that account (`qwen/qwen3.6-27b`) rejects a single photo under the free 8000 TPM cap.
  - **Calling Gemini directly from the Worker fails for most Korean users.** Cloudflare executes near the client, Korean traffic frequently lands on the Hong Kong (HKG) colo, and Google returns `400 FAILED_PRECONDITION "User location is not supported for the API use."` there. `[placement] mode = "smart"` did **not** fix it (0/6 success). Gemini is only viable behind a US-region host, so it is kept as an optional second entry that is skipped unless `GEMINI_API_KEY` is set. The Worker detects this body text and surfaces a distinct `GEO_BLOCKED` code.
  - **Workers AI has no such restriction** because it runs inside the Worker, needs no key, and is free up to 10,000 neurons/day (≈150 analyses; ~60–70 neurons each). Measured 8/8 success, ~6.0 s average — faster than Gemini's 10–13 s.
  - `providers()` entries are tagged `kind: 'binding' | 'http'`; adding a paid fallback (Claude/OpenAI) is just another `'http'` entry — chain, timeout, normalization, and error mapping already handle it.
  - **`extractJson()` is load-bearing.** Llama 4 Scout appends a stray extra `}` after otherwise-valid JSON ~40% of the time, which made `JSON.parse` fail. The extractor scans from the first `{` to the brace-balanced close (string- and escape-aware), ignoring anything before or after. Do not replace it with a plain `JSON.parse` of the trimmed text.
  The prompt (`SYSTEM_PROMPT` + `ANALYSIS_PROMPT`, both Korean-output, `response_format: json_object`, temperature 0.3, `max_tokens` 4000) is tuned for a weak vision model on one 800px JPEG: it scores 9 spatial grab factors per prize (position, grab point, obstacles, wall distance, overlap, push potential, slip risk, claw-entry space, chute distance), computes `successRate = 10 + (n × 10)` from how many are *visibly confirmed*, then applies caps (absolute 80 because grip strength is payout-controlled and unknowable from a photo; 20 buried / 25 wall-pinned / 30 no claw-entry gap / 30 prize machine / 35 unclear shape / 40 claw narrower than prize / 60 chute not found). It also encodes real Korean arcade technique vocabulary (정통 파지, 후킹, 밀어넣기, 굴리기, 틈새 끼우기, 투입구 걸치기, 벽 떼기) and caps verbosity per field so the JSON fits `max_tokens`.
  **The JSON schema example uses `<...>` placeholders, not realistic values, on purpose** — with concrete sample values (e.g. `"노란 곰 인형"`, `successRate 60`) gpt-4o-mini copies the example verbatim instead of analyzing the photo. This was observed, not theorized; keep values placeholder-shaped. The Worker walks its `providers()` list in order, **skipping any provider whose key is unset** (so an unset `GEMINI_API_KEY` cleanly degrades to primary-only — check `/health` to see which are live), returning the first success; each call gets a 25-second `AbortController` timeout. The served provider comes back as `apiSource` and is shown in the overlay footer. Response normalization (`normalizeTarget`/`asText`/`num`) runs **on both sides** — the Worker is the source of truth, and the app repeats it as defense-in-depth because the app cannot be hotfixed without store review:
  - `confidence` is **always derived** as `bestTarget.successRate / 100`; the model's own `confidence` is ignored, because emitting `70` instead of `0.7` is common and clamping that to `[0,1]` yields exactly `1` → a misleading 100% bar.
  - `difficulty` is **always recomputed** from `successRate` (≥70 easy / ≥40 medium / else hard); the model regularly contradicts its own band, which shows as a green success bar beside a red difficulty label.
  - Every string field goes through `asText()` — an object or array reaching a `<Text>` child is a fatal render crash, and there is no ErrorBoundary.
  - `num()` coerces strings/objects so a non-numeric `successRate`/`positionX` cannot leak `NaN` into text or `%` style values.
  - `finish_reason === 'length'` is detected and thrown as `TRUNCATED` so a response cut off mid-JSON falls back to the next provider instead of dying in `JSON.parse`.
  - When `EXPO_PUBLIC_ANALYZE_URL` is empty (a build made without `.env`), the app fails immediately with a distinct configuration message instead of a "retry" message that retrying can never fix.
  - The Worker inspects the statuses of **all** failed providers (401/403 → 429 → 5xx priority) and returns a stable error **code**; the app maps codes to Korean via `ERROR_MESSAGES`. So an actionable 429 from the primary isn't masked by a parse error from the fallback, and user-facing wording can change without redeploying the Worker.
- **Image optimization**: Photos are resized to 800px width at 0.5 compression via `expo-image-manipulator` before API submission to minimize token usage.
- **Ad flow**: Rewarded ads load preemptively and the analysis result is held in `pendingResultRef` until the ad resolves, then revealed by the idempotent `revealResult()`. Ads show on every 3rd analysis starting with the **1st** (`(analyzeCountRef.current - 1) % AD_EVERY === 0` → 1st, 4th, 7th…), so the flow is observable on a fresh install. Critical invariants, all learned from real bugs — do not regress them:
  - **Never mirror the ad's loaded state in React state.** `MobileAd.load()` early-returns when `_loaded || _isLoadCalled`, and those flags reset *only* on `CLOSED`/`ERROR`. A `setAdLoaded(false)` + `load()` pair while an ad is already loaded desyncs React from the native side permanently and no `LOADED` event ever fires again — ads then never show for the rest of the session. Always read `rewarded.loaded` at the point of use.
  - **`show()` throws synchronously** when not loaded, so `rewarded.show().catch(...)` cannot catch it — it must be wrapped in `try/catch` or the error escapes to the analysis catch and shows a bogus `분석 실패` alert.
  - A watchdog (`AD_SHOW_WATCHDOG`, cleared on `AdEventType.OPENED`) prevents a permanent hang on the ad screen, since the native module does not surface `onAdFailedToShowFullScreenContent`.
  - The `ERROR` listener uses exponential backoff with a retry cap (`AD_MAX_RETRY`); immediate re-`load()` on a persistent no-fill is a tight infinite request loop.
- **Dev/Prod ads**: `Config.ts` uses `__DEV__` to switch between Google test ad IDs (development) and real ad IDs (production). Never hardcode real ad IDs in dev.
- **Styling**: Dark theme with neon green (#00e676) accent. Platform-aware padding for iOS/Android safe areas.
- **Language**: All UI text and AI responses are in Korean.

## Configuration

- **Expo SDK 54** with new architecture enabled (`newArchEnabled: true`)
- **Native folders**: `ios/` and `android/` are gitignored and generated by `expo prebuild`, but the committed-locally `android/` folder is built directly with Gradle (see above) — do not re-run prebuild unless explicitly asked, or custom signing/SDK config is wiped. Do not add native modules that require manual linking.
- **TypeScript** in strict mode (extends `expo/tsconfig.base`)
- **Bundle ID**: `com.dollsai.app` (both platforms); AdMob app ID `ca-app-pub-3640943750342373~9300730008` is set in `app.json` plugins.
- **Environment** (`.env`, gitignored): `EXPO_PUBLIC_ANALYZE_URL` (Worker URL) and `EXPO_PUBLIC_APP_KEY` (must equal the Worker's `APP_SECRET`). Read via `src/constants/Config.ts`. `EXPO_PUBLIC_*` vars are inlined at build time — restart the Expo dev server after editing `.env`. **No provider keys belong here.**
- **Worker secrets** (`server/`, never in git or the bundle): `APP_SECRET` (required), `GEMINI_API_KEY` (optional, and largely ineffective from HKG — see above) — registered with `wrangler secret put`. Local dev reads `server/.dev.vars` (gitignored). Deploy and troubleshooting steps are in `server/README.md`. Secret changes take **1–2 minutes** to propagate; an immediate retest can still fail with the old value.
- **Models**: `@cf/meta/llama-4-scout-17b-16e-instruct` (Workers AI, primary) — defined in `providers()` in `server/src/index.ts`. Requires the `[ai] binding = "AI"` block in `wrangler.toml`. Swapping providers/models requires **only a Worker redeploy, no app release** — this is the whole point of the proxy.
- **Release signing**: keystore is `release.keystore` at the repo root (also gitignored); the `signingConfigs.release` block to paste into `android/app/build.gradle` lives in `signing.gradle`.
- **No test framework** is currently configured
- **scripts/ directory**: Standalone Node.js tooling (icon generation via Sharp) with its own `node_modules`. Not part of the Expo app bundle.
