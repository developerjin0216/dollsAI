// ============================================
// 분석 프록시 (Cloudflare Worker)
//
// ⚠️ 공급자 API 키(GitHub·Groq)를 여기에 다시 넣지 말 것.
// EXPO_PUBLIC_* 값은 빌드 시 JS 번들에 평문 문자열로 인라인되므로,
// APK를 압축 해제하면 누구나 추출할 수 있다. 공급자 키는 server/ 의
// Worker secret으로만 보관한다 (server/README.md 참고).
// ============================================
export const ANALYZE_URL = process.env.EXPO_PUBLIC_ANALYZE_URL ?? '';

// 앱 식별용 키. 번들에서 추출될 수 있지만 서버에서 즉시 교체할 수 있고,
// IP당 호출 제한과 함께 무단 사용 비용을 올리는 용도다. (공급자 키와 위험도가 다름)
export const APP_KEY = process.env.EXPO_PUBLIC_APP_KEY ?? '';

// ============================================
// AdMob 설정
// 테스트 광고 ID (개발용) - 출시 전 실제 ID로 교체
// ============================================
export const ADMOB_REWARDED_ID = __DEV__
  ? 'ca-app-pub-3940256099942544/5224354917' // Google 테스트 광고 ID
  : 'ca-app-pub-3640943750342373/7511562650'; // 실제 리워드 광고 ID
