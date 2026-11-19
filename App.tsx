import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  StatusBar,
  Image,
  BackHandler,
  Linking,
  AppState as RNAppState,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import mobileAds, {
  AdsConsent,
  RewardedAd,
  RewardedAdEventType,
  AdEventType,
} from 'react-native-google-mobile-ads';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import {
  analyzeClawMachine,
  AnalysisResult,
  fetchRemoteConfig,
  DEFAULT_CONFIG,
  RemoteConfig,
} from './src/services/gemini';
import AnalysisOverlay from './src/components/AnalysisOverlay';
import ErrorBoundary from './src/components/ErrorBoundary';
import FeedbackPrompt from './src/components/FeedbackPrompt';
import { ADMOB_REWARDED_ID } from './src/constants/Config';

const rewarded = RewardedAd.createForAdRequest(ADMOB_REWARDED_ID);

// 빌드 시 app.json이 앱에 내장된다 — android/app/build.gradle의 versionCode와 같이 올릴 것.
// 0이면(iOS 등) 버전 비교를 하지 않는다.
const APP_VERSION_CODE =
  Platform.OS === 'android' ? Number(Constants.expoConfig?.android?.versionCode ?? 0) : 0;
const STORE_URL = 'market://details?id=com.dollsai.app';
const STORE_WEB_URL = 'https://play.google.com/store/apps/details?id=com.dollsai.app';

const openStore = () => {
  Linking.openURL(STORE_URL).catch(() => Linking.openURL(STORE_WEB_URL).catch(() => {}));
};

// 광고 주기(분석 N회당 1회)는 서버 /config의 adEvery로 정한다. 받기 전·실패 시 기본 3회.
const AD_WAIT_TIMEOUT = 5000; // 광고 로드 대기 한도
const AD_SHOW_WATCHDOG = 8000; // show() 후 아무 이벤트도 안 올 때 결과를 풀어주는 한도
const AD_RETRY_BASE = 2000; // 로드 실패 재시도 기준 지연
const AD_MAX_RETRY = 4; // no-fill 무한 요청 루프 방지
// 광고 주기 카운터를 앱 재시작 후에도 유지한다 — 메모리에만 두면 매 실행 첫 분석마다 광고가 뜬다.
const ANALYZE_COUNT_KEY = 'analyzeCount';

// failed: 재시도 가능한 오류로 선택 Alert을 띄운 상태(촬영 사진은 그대로 보인다)
type AppState = 'camera' | 'analyzing' | 'ad' | 'result' | 'failed';
// ad 상태 안의 단계: offer = 사용자가 광고 시청을 직접 선택하기 전, loading = 선택 후 로드/표시 대기
type AdPhase = 'offer' | 'loading';

export default function App() {
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [appState, setAppState] = useState<AppState>('camera');
  const [adPhase, setAdPhase] = useState<AdPhase>('offer');
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  // 마커 좌표(0~100%)를 사진 위에 정확히 얹으려면 표시 박스가 원본 비율과 같아야 한다.
  const [capturedAspect, setCapturedAspect] = useState(3 / 4);
  // 원격 설정: 화면 표시용 state + 분석 콜백에서 최신 값을 읽기 위한 ref
  const [config, setConfig] = useState<RemoteConfig>(DEFAULT_CONFIG);
  const configRef = useRef<RemoteConfig>(DEFAULT_CONFIG);
  const pendingResultRef = useRef<AnalysisResult | null>(null);
  const analyzeCountRef = useRef(0);
  const waitingForAdRef = useRef(false);
  const busyRef = useRef(false); // 촬영/분석 중복 실행 방지
  // 분석마다 1씩 올린다. 취소되면 값이 바뀌어, 늦게 도착한 응답을 버릴 수 있다.
  const analysisIdRef = useRef(0);
  const retryRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  // 보류 중인 분석 결과를 화면에 띄운다. 여러 경로에서 호출되므로 멱등하게 동작해야 한다.
  const revealResult = useCallback(() => {
    clearWatchdog();
    if (pendingResultRef.current) {
      setAnalysisResult(pendingResultRef.current);
      pendingResultRef.current = null;
      setAppState('result');
    }
  }, [clearWatchdog]);

  // 카메라로 완전히 되돌린다. 진행 중인 분석이 있으면 그 응답은 analysisIdRef로 무시된다.
  const resetToCamera = useCallback(() => {
    analysisIdRef.current += 1;
    busyRef.current = false;
    clearWatchdog();
    pendingResultRef.current = null;
    waitingForAdRef.current = false;
    setAnalysisResult(null);
    setCapturedUri(null);
    setAppState('camera');
  }, [clearWatchdog]);

  // 라이브러리의 load()는 이미 로드됐거나 요청이 진행 중이면 조용히 무시된다.
  // 따라서 로드 상태를 React state로 복제하지 않고 rewarded.loaded를 그대로 신뢰한다.
  const loadAd = useCallback(() => {
    if (rewarded.loaded) return;
    try {
      rewarded.load();
    } catch {
      // 로드 실패는 ERROR 이벤트에서 처리
    }
  }, []);

  // show()는 로드되지 않은 상태에서 "동기적으로" throw하므로 .catch()로는 잡히지 않는다.
  const showAd = useCallback((): boolean => {
    try {
      const shown = rewarded.show() as unknown;
      if (shown && typeof (shown as Promise<void>).catch === 'function') {
        (shown as Promise<void>).catch(() => revealResult());
      }
      // 표시 자체가 실패하거나 이벤트가 유실되면 영구 대기하므로 감시 타이머를 건다.
      clearWatchdog();
      watchdogRef.current = setTimeout(() => {
        watchdogRef.current = null;
        revealResult();
      }, AD_SHOW_WATCHDOG);
      return true;
    } catch {
      return false;
    }
  }, [revealResult, clearWatchdog]);

  useEffect(() => {
    fetchRemoteConfig().then((c) => {
      configRef.current = c;
      setConfig(c);
    });
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(ANALYZE_COUNT_KEY)
      .then((v) => {
        const n = parseInt(v ?? '0', 10);
        // 읽기 전에 이미 분석이 끝났을 수 있으므로 큰 값을 유지한다.
        if (Number.isFinite(n)) analyzeCountRef.current = Math.max(analyzeCountRef.current, n);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const unsubLoaded = rewarded.addAdEventListener(RewardedAdEventType.LOADED, () => {
      retryRef.current = 0;
      // 광고를 기다리는 중이었으면 바로 표시
      if (waitingForAdRef.current) {
        waitingForAdRef.current = false;
        if (!showAd()) revealResult();
      }
    });

    const unsubEarned = rewarded.addAdEventListener(
      RewardedAdEventType.EARNED_REWARD,
      revealResult
    );

    // 광고가 실제로 떴으면 감시 타이머 해제 (사용자가 30초 광고를 볼 수도 있다)
    const unsubOpened = rewarded.addAdEventListener(AdEventType.OPENED, clearWatchdog);

    const unsubClosed = rewarded.addAdEventListener(AdEventType.CLOSED, () => {
      revealResult();
      // CLOSED 시점에 라이브러리가 내부 플래그를 초기화하므로 이제 다시 로드할 수 있다.
      loadAd();
    });

    const unsubError = rewarded.addAdEventListener(AdEventType.ERROR, (error) => {
      waitingForAdRef.current = false;
      revealResult();
      if (__DEV__) console.warn('[ad] load/show 실패:', error);
      // no-fill이 계속되면 즉시 재요청은 무한 루프가 된다 → 지수 백오프 + 재시도 상한
      if (retryRef.current < AD_MAX_RETRY) {
        const delay = AD_RETRY_BASE * Math.pow(2, retryRef.current);
        retryRef.current += 1;
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          loadAd();
        }, delay);
      }
    });

    // EEA·영국 사용자는 광고 전에 동의(UMP)를 받아야 한다(AdMob 정책). 해당 지역이 아니거나
    // AdMob에 개인정보 메시지가 없으면 아무 창도 뜨지 않는다. 동의 처리 실패가 광고를 막진 않는다.
    // 그다음 SDK 초기화 후 광고 로드 (실패해도 앱은 계속 동작해야 한다)
    AdsConsent.gatherConsent()
      .catch((e) => {
        if (__DEV__) console.warn('[ad] 동의 정보 갱신 실패:', e);
      })
      .then(() => mobileAds().initialize())
      .then(loadAd)
      .catch((e) => {
        if (__DEV__) console.warn('[ad] SDK 초기화 실패:', e);
      });

    return () => {
      unsubLoaded();
      unsubEarned();
      unsubOpened();
      unsubClosed();
      unsubError();
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (watchdogRef.current) clearTimeout(watchdogRef.current);
    };
  }, [showAd, revealResult, loadAd, clearWatchdog]);

  // 설정 앱에서 권한을 켜고 돌아오면 다시 확인한다 (훅은 자동으로 갱신하지 않는다).
  useEffect(() => {
    const sub = RNAppState.addEventListener('change', (s) => {
      if (s === 'active' && permission && !permission.granted) getPermission();
    });
    return () => sub.remove();
  }, [permission, getPermission]);

  // 리사이즈된 사진(base64)을 분석하고 광고/결과 흐름으로 넘긴다. 실패 시 같은 사진으로 재시도할 수 있다.
  const runAnalysis = useCallback(
    async (image: string) => {
      const id = ++analysisIdRef.current;
      busyRef.current = true;
      setAppState('analyzing');

      try {
        const result = await analyzeClawMachine(image);
        if (id !== analysisIdRef.current) return; // 사용자가 취소함
        pendingResultRef.current = result;

        // 기계를 못 찾은 사진은 재촬영 안내만 보여준다 — 광고도, 광고 주기 카운트도 없다.
        if (result.noMachine) {
          revealResult();
          loadAd();
          return;
        }

        analyzeCountRef.current += 1;
        AsyncStorage.setItem(ANALYZE_COUNT_KEY, String(analyzeCountRef.current)).catch(() => {});

        // 분석 N회당 1회 광고 — 1번째부터 표시(N=3이면 1, 4, 7...)해 첫 실행에서도 광고가 동작한다.
        // N이 0 이하면 서버에서 광고를 끈 것이다.
        const adEvery = configRef.current.adEvery;
        const shouldShowAd = adEvery > 0 && (analyzeCountRef.current - 1) % adEvery === 0;
        if (!shouldShowAd) {
          revealResult();
          loadAd(); // 다음 차례를 위해 미리 로드
          return;
        }

        // 보상형 광고는 사용자가 직접 시청을 선택해야 한다(AdMob 정책) → 선택 화면을 먼저 띄운다.
        setAdPhase('offer');
        setAppState('ad');
        loadAd();
      } catch (error: any) {
        if (id !== analysisIdRef.current) return;
        pendingResultRef.current = null;
        const message = error?.message || '인형뽑기 기계를 분석하는데 실패했습니다.\n다시 시도해주세요.';
        if (error?.retryable) {
          setAppState('failed');
          Alert.alert(
            '분석 실패',
            message,
            [
              { text: '다시 찍기', style: 'cancel', onPress: resetToCamera },
              { text: '같은 사진으로 재시도', onPress: () => runAnalysis(image) },
            ],
            { cancelable: false }
          );
        } else {
          resetToCamera();
          Alert.alert('분석 실패', message);
        }
      } finally {
        if (id === analysisIdRef.current) busyRef.current = false;
      }
    },
    [loadAd, revealResult, resetToCamera]
  );

  const handleAnalyze = useCallback(async () => {
    // appState 검사는 await 이전 값이라 연타를 막지 못한다 → ref로 실제 진행 여부를 잠근다.
    if (busyRef.current || !cameraRef.current || appState !== 'camera') return;
    busyRef.current = true;
    // 리사이즈 도중 "취소"를 누르면 resetToCamera가 id를 올린다 → 이후 단계로 넘어가지 않는다.
    const startId = analysisIdRef.current;

    let image: string;
    try {
      // 사진 촬영
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.6,
        base64: false,
        shutterSound: false,
      });

      if (!photo?.uri) {
        throw new Error('사진 촬영에 실패했습니다.');
      }

      // 촬영 이미지 고정 표시
      setCapturedUri(photo.uri);
      setAppState('analyzing');

      // 이미지 리사이즈 (800px) + base64 변환 → 토큰 사용량 대폭 절감
      const resized = await manipulateAsync(
        photo.uri,
        [{ resize: { width: 800 } }],
        { compress: 0.5, format: SaveFormat.JPEG, base64: true }
      );

      if (!resized.base64) {
        throw new Error('이미지 처리에 실패했습니다.');
      }

      // 리사이즈 결과는 EXIF 회전이 픽셀에 반영된 상태이고 AI가 실제로 본 이미지이므로,
      // 마커 좌표계 기준으로 원본 photo.width/height보다 신뢰할 수 있다.
      if (resized.width && resized.height) {
        setCapturedAspect(resized.width / resized.height);
      }
      image = resized.base64;
    } catch (error: any) {
      if (startId !== analysisIdRef.current) return;
      resetToCamera();
      Alert.alert('촬영 실패', error?.message || '사진을 처리하지 못했습니다.\n다시 시도해주세요.');
      return;
    }

    if (startId !== analysisIdRef.current) return;
    await runAnalysis(image);
  }, [appState, runAnalysis, resetToCamera]);

  // 사용자가 광고 시청을 선택함
  const handleWatchAd = useCallback(() => {
    setAdPhase('loading');
    if (rewarded.loaded) {
      if (!showAd()) {
        // 표시 실패 → 결과부터 보여주고 다음 광고를 다시 로드
        revealResult();
        loadAd();
      }
      return;
    }
    // 로드 대기 (완료되면 LOADED 리스너가 자동 표시)
    waitingForAdRef.current = true;
    loadAd();
    setTimeout(() => {
      if (waitingForAdRef.current) {
        waitingForAdRef.current = false;
        revealResult();
      }
    }, AD_WAIT_TIMEOUT);
  }, [showAd, revealResult, loadAd]);

  // 안드로이드 뒤로가기: 기본 동작은 앱 종료라 분석 도중 누르면 결과가 통째로 사라진다.
  // 결과 화면은 AnalysisOverlay가 직접 처리한다(공유 카드부터 닫아야 하므로).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (appState === 'analyzing' || appState === 'failed') {
        resetToCamera();
        return true;
      }
      if (appState === 'ad') {
        // 광고 표시 대기 중에는 무시, 선택 화면에서는 "다시 찍기"와 같다
        if (adPhase === 'offer') resetToCamera();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [appState, adPhase, resetToCamera]);

  // 카메라가 아닌 상태 = 촬영 이미지 고정 표시
  const showFrozenImage = appState !== 'camera' && capturedUri;
  const updateAvailable = APP_VERSION_CODE > 0 && APP_VERSION_CODE < config.latestVersionCode;

  // 서버 응답 형식을 깨는 변경 등으로 구버전을 더 지원할 수 없을 때 서버에서 올린다(MIN_VERSION_CODE).
  if (APP_VERSION_CODE > 0 && APP_VERSION_CODE < config.minVersionCode) {
    return (
      <View style={styles.centered}>
        <Text style={styles.permTitle}>업데이트가 필요해요</Text>
        <Text style={styles.permDesc}>
          분석 서버가 새 버전으로 바뀌었어요.{'\n'}최신 버전으로 업데이트한 뒤 이용해주세요.
        </Text>
        <TouchableOpacity style={styles.permBtn} onPress={openStore}>
          <Text style={styles.permBtnText}>업데이트하기</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!permission) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#00e676" />
      </View>
    );
  }

  if (!permission.granted) {
    // "다시 묻지 않음" 상태에서는 requestPermission()이 아무 창도 띄우지 않는다 → 설정으로 보낸다
    const blocked = !permission.canAskAgain;
    return (
      <View style={styles.centered}>
        <Text style={styles.permTitle}>카메라 권한 필요</Text>
        <Text style={styles.permDesc}>
          인형뽑기 기계를 분석하려면{'\n'}카메라 접근 권한이 필요합니다.
          {blocked && '\n\n설정 > 권한에서 카메라를 허용해주세요.'}
        </Text>
        <TouchableOpacity
          style={styles.permBtn}
          onPress={blocked ? () => Linking.openSettings() : requestPermission}
        >
          <Text style={styles.permBtnText}>{blocked ? '설정 열기' : '권한 허용하기'}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ErrorBoundary onReset={resetToCamera}>
      <View style={styles.container}>
        <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

        {/* 카메라 뷰 — 촬영 화면에서만 켠다(결과를 보는 동안 계속 돌면 발열·배터리 소모) */}
        {appState === 'camera' ? (
          <CameraView ref={cameraRef} style={styles.camera} facing="back">
            <View style={styles.topBar}>
              <Text style={styles.appTitle}>뽑기 AI</Text>
              <Text style={styles.appSubtitle}>인형뽑기 기계를 비추세요</Text>
              {!!config.notice && <Text style={styles.notice}>{config.notice}</Text>}
              {updateAvailable && (
                <TouchableOpacity onPress={openStore}>
                  <Text style={styles.updateBanner}>새 버전이 나왔어요 · 업데이트 ›</Text>
                </TouchableOpacity>
              )}
            </View>

            <FeedbackPrompt />

            <View style={styles.guideFrame}>
              <View style={[styles.corner, styles.cornerTL]} />
              <View style={[styles.corner, styles.cornerTR]} />
              <View style={[styles.corner, styles.cornerBL]} />
              <View style={[styles.corner, styles.cornerBR]} />
            </View>

            <View style={styles.bottomBar}>
              <View style={styles.guideTips}>
                <Text style={styles.guideTip}>· 집게와 출구(투입구)가 한 화면에 나오게</Text>
                <Text style={styles.guideTip}>· 렌즈를 유리에 가까이 대면 반사가 줄어요</Text>
              </View>
              <TouchableOpacity style={styles.analyzeBtn} onPress={handleAnalyze}>
                <View style={styles.analyzeBtnInner}>
                  <Text style={styles.analyzeBtnIcon}>O</Text>
                </View>
                <Text style={styles.analyzeBtnText}>분석하기</Text>
              </TouchableOpacity>
            </View>
          </CameraView>
        ) : (
          <View style={styles.camera} />
        )}

        {/* 촬영된 이미지 (분석중/결과 상태에서 카메라 자리에 표시) */}
        {showFrozenImage && (
          <Image source={{ uri: capturedUri }} style={styles.frozenImage} resizeMode="cover" />
        )}

        {/* 분석 중 오버레이 */}
        {appState === 'analyzing' && (
          <View style={styles.analyzingOverlay}>
            <View style={styles.analyzingCard}>
              <ActivityIndicator size="large" color="#00e676" />
              <Text style={styles.analyzingText}>AI 분석 중...</Text>
              <Text style={styles.analyzingSubtext}>
                인형 위치, 크기, 형태를 분석하고 있습니다
              </Text>
              <Text style={styles.analyzingSubtext}>보통 20초 안팎 걸려요</Text>
              <TouchableOpacity style={styles.cancelBtn} onPress={resetToCamera}>
                <Text style={styles.cancelBtnText}>취소</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* 광고: 시청 선택 화면 → 선택 후 로드/표시 대기 */}
        {appState === 'ad' && (
          <View style={styles.analyzingOverlay}>
            {adPhase === 'offer' ? (
              <View style={styles.analyzingCard}>
                <Text style={styles.offerTitle}>분석 완료!</Text>
                <Text style={styles.offerDesc}>
                  짧은 광고를 보면{'\n'}추천 타겟과 공략법을 확인할 수 있어요
                </Text>
                <TouchableOpacity style={styles.offerBtn} onPress={handleWatchAd}>
                  <Text style={styles.offerBtnText}>광고 보고 결과 확인</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.cancelBtn} onPress={resetToCamera}>
                  <Text style={styles.cancelBtnText}>다시 찍기</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.analyzingCard}>
                <ActivityIndicator size="small" color="#ffab00" />
                <Text style={styles.analyzingText}>광고를 불러오는 중...</Text>
              </View>
            )}
          </View>
        )}

        {/* 분석 결과 오버레이 (이미지 위에 반투명 표시) */}
        {appState === 'result' && analysisResult && capturedUri && (
          <AnalysisOverlay
            result={analysisResult}
            imageUri={capturedUri}
            imageAspect={capturedAspect}
            onClose={resetToCamera}
          />
        )}
      </View>
    </ErrorBoundary>
  );
}

const CORNER_SIZE = 30;
const CORNER_WIDTH = 3;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  centered: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  camera: {
    flex: 1,
  },
  frozenImage: {
    ...StyleSheet.absoluteFillObject,
  },
  // 상단 바
  topBar: {
    paddingTop: Platform.OS === 'ios' ? 60 : 48,
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
  },
  appTitle: {
    color: '#00e676',
    fontSize: 22,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  appSubtitle: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    marginTop: 4,
  },
  notice: {
    color: '#ffd54f',
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
  },
  updateBanner: {
    color: '#00e676',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 8,
  },
  // 가이드 프레임
  guideFrame: {
    flex: 1,
    margin: 40,
  },
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: CORNER_WIDTH,
    borderLeftWidth: CORNER_WIDTH,
    borderColor: '#00e676',
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: CORNER_WIDTH,
    borderRightWidth: CORNER_WIDTH,
    borderColor: '#00e676',
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: CORNER_WIDTH,
    borderLeftWidth: CORNER_WIDTH,
    borderColor: '#00e676',
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: CORNER_WIDTH,
    borderRightWidth: CORNER_WIDTH,
    borderColor: '#00e676',
  },
  // 하단 바
  bottomBar: {
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    paddingTop: 12,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
  },
  guideTips: {
    marginBottom: 12,
  },
  guideTip: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12,
    lineHeight: 18,
  },
  analyzeBtn: {
    alignItems: 'center',
  },
  analyzeBtnInner: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#00e676',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#00e676',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 8,
  },
  analyzeBtnIcon: {
    fontSize: 28,
    color: '#000',
    fontWeight: 'bold',
  },
  analyzeBtnText: {
    color: '#fff',
    fontSize: 14,
    marginTop: 8,
    fontWeight: '600',
  },
  // 분석 중 오버레이
  analyzingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  analyzingCard: {
    backgroundColor: 'rgba(20,20,40,0.9)',
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  analyzingText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 14,
  },
  analyzingSubtext: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    marginTop: 6,
  },
  cancelBtn: {
    marginTop: 18,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  cancelBtnText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    textDecorationLine: 'underline',
  },
  // 광고 시청 선택
  offerTitle: {
    color: '#00e676',
    fontSize: 20,
    fontWeight: 'bold',
  },
  offerDesc: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 10,
  },
  offerBtn: {
    marginTop: 20,
    backgroundColor: '#00e676',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
  },
  offerBtnText: {
    color: '#000',
    fontSize: 16,
    fontWeight: 'bold',
  },
  // 권한 화면
  permTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  permDesc: {
    color: '#aaa',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  permBtn: {
    backgroundColor: '#00e676',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
  },
  permBtnText: {
    color: '#000',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
