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
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import mobileAds, {
  RewardedAd,
  RewardedAdEventType,
  AdEventType,
} from 'react-native-google-mobile-ads';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { analyzeClawMachine, AnalysisResult } from './src/services/gemini';
import AnalysisOverlay from './src/components/AnalysisOverlay';
import ErrorBoundary from './src/components/ErrorBoundary';
import { ADMOB_REWARDED_ID } from './src/constants/Config';

const rewarded = RewardedAd.createForAdRequest(ADMOB_REWARDED_ID);

const AD_EVERY = 3; // 분석 3회당 1회 광고 (1, 4, 7...번째)
const AD_WAIT_TIMEOUT = 5000; // 광고 로드 대기 한도
const AD_SHOW_WATCHDOG = 8000; // show() 후 아무 이벤트도 안 올 때 결과를 풀어주는 한도
const AD_RETRY_BASE = 2000; // 로드 실패 재시도 기준 지연
const AD_MAX_RETRY = 4; // no-fill 무한 요청 루프 방지

type AppState = 'camera' | 'analyzing' | 'ad' | 'result';

export default function App() {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [appState, setAppState] = useState<AppState>('camera');
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  // 마커 좌표(0~100%)를 사진 위에 정확히 얹으려면 표시 박스가 원본 비율과 같아야 한다.
  const [capturedAspect, setCapturedAspect] = useState(3 / 4);
  const pendingResultRef = useRef<AnalysisResult | null>(null);
  const analyzeCountRef = useRef(0);
  const waitingForAdRef = useRef(false);
  const busyRef = useRef(false); // 촬영/분석 중복 실행 방지
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

    // AdMob SDK 초기화 후 광고 로드 (실패해도 앱은 계속 동작해야 한다)
    mobileAds()
      .initialize()
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

  const handleAnalyze = useCallback(async () => {
    // appState 검사는 await 이전 값이라 연타를 막지 못한다 → ref로 실제 진행 여부를 잠근다.
    if (busyRef.current || !cameraRef.current || appState !== 'camera') return;
    busyRef.current = true;

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

      // AI 분석
      const result = await analyzeClawMachine(resized.base64);
      pendingResultRef.current = result;
      analyzeCountRef.current += 1;

      // 분석 3회당 1회 광고 — 1번째부터 표시(1, 4, 7...)해 첫 실행에서도 광고가 동작한다.
      const shouldShowAd = (analyzeCountRef.current - 1) % AD_EVERY === 0;

      if (!shouldShowAd) {
        revealResult();
        loadAd(); // 다음 차례를 위해 미리 로드
        return;
      }

      setAppState('ad');
      if (rewarded.loaded) {
        if (!showAd()) {
          // 표시 실패 → 결과부터 보여주고 다음 광고를 다시 로드
          revealResult();
          loadAd();
        }
      } else {
        // 로드 대기 (완료되면 LOADED 리스너가 자동 표시)
        waitingForAdRef.current = true;
        loadAd();
        setTimeout(() => {
          if (waitingForAdRef.current) {
            waitingForAdRef.current = false;
            revealResult();
          }
        }, AD_WAIT_TIMEOUT);
      }
    } catch (error: any) {
      setAppState('camera');
      setCapturedUri(null);
      pendingResultRef.current = null;
      Alert.alert(
        '분석 실패',
        error?.message || '인형뽑기 기계를 분석하는데 실패했습니다.\n다시 시도해주세요.'
      );
    } finally {
      busyRef.current = false;
    }
  }, [appState, loadAd, showAd, revealResult]);

  const handleCloseResult = useCallback(() => {
    setAnalysisResult(null);
    setCapturedUri(null);
    setAppState('camera');
  }, []);

  // 렌더 오류(ErrorBoundary) 복구: 문제를 일으켰을 수 있는 결과/보류 데이터를
  // 전부 비우고 카메라 상태로 완전히 되돌린다.
  const handleErrorReset = useCallback(() => {
    clearWatchdog();
    pendingResultRef.current = null;
    waitingForAdRef.current = false;
    setAnalysisResult(null);
    setCapturedUri(null);
    setAppState('camera');
  }, [clearWatchdog]);

  // 카메라가 아닌 상태 = 촬영 이미지 고정 표시
  const showFrozenImage = appState !== 'camera' && capturedUri;

  if (!permission) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#00e676" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.centered}>
        <Text style={styles.permTitle}>카메라 권한 필요</Text>
        <Text style={styles.permDesc}>
          인형뽑기 기계를 분석하려면{'\n'}카메라 접근 권한이 필요합니다.
        </Text>
        <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
          <Text style={styles.permBtnText}>권한 허용하기</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ErrorBoundary onReset={handleErrorReset}>
      <View style={styles.container}>
        <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

        {/* 카메라 뷰 (항상 뒤에 유지) */}
        <CameraView ref={cameraRef} style={styles.camera} facing="back">
          {!showFrozenImage && (
            <>
              <View style={styles.topBar}>
                <Text style={styles.appTitle}>뽑기 AI</Text>
                <Text style={styles.appSubtitle}>인형뽑기 기계를 비추세요</Text>
              </View>

              <View style={styles.guideFrame}>
                <View style={[styles.corner, styles.cornerTL]} />
                <View style={[styles.corner, styles.cornerTR]} />
                <View style={[styles.corner, styles.cornerBL]} />
                <View style={[styles.corner, styles.cornerBR]} />
              </View>

              <View style={styles.bottomBar}>
                <TouchableOpacity style={styles.analyzeBtn} onPress={handleAnalyze}>
                  <View style={styles.analyzeBtnInner}>
                    <Text style={styles.analyzeBtnIcon}>O</Text>
                  </View>
                  <Text style={styles.analyzeBtnText}>분석하기</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </CameraView>

        {/* 촬영된 이미지 (분석중/결과 상태에서 카메라 위에 덮음) */}
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
            </View>
          </View>
        )}

        {/* 광고 대기 오버레이 */}
        {appState === 'ad' && (
          <View style={styles.analyzingOverlay}>
            <View style={styles.analyzingCard}>
              <ActivityIndicator size="small" color="#ffab00" />
              <Text style={styles.analyzingText}>잠시만 기다려주세요...</Text>
            </View>
          </View>
        )}

        {/* 분석 결과 오버레이 (이미지 위에 반투명 표시) */}
        {appState === 'result' && analysisResult && capturedUri && (
          <AnalysisOverlay
            result={analysisResult}
            imageUri={capturedUri}
            imageAspect={capturedAspect}
            onClose={handleCloseResult}
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
    paddingTop: 16,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
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
