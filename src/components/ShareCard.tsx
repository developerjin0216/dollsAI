import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { AnalysisResult, Target } from '../services/gemini';

interface Props {
  result: AnalysisResult;
  imageUri: string;
  /** 원본 사진의 가로/세로 비율. 마커 좌표계를 사진과 일치시키는 데 쓴다. */
  imageAspect?: number;
  /** bestTarget을 제외한 타겟들. 중복 판정 로직이 갈라지지 않도록 부모가 계산해 넘긴다. */
  otherTargets: Target[];
  onClose: () => void;
}

const MARKER_SIZE = 22;
const CLAW_MARKER_SIZE = 24;
const CARD_MAX_WIDTH = 380;
const CARD_PADDING = 14;

const rateColor = (r: number) =>
  r >= 70 ? '#00e676' : r >= 40 ? '#ffab00' : '#ff1744';

export default function ShareCard({
  result,
  imageUri,
  imageAspect,
  otherTargets,
  onClose,
}: Props) {
  const cardRef = useRef<View>(null);
  const [busy, setBusy] = useState(false);
  const { width, height } = useWindowDimensions();

  const aspect = imageAspect && imageAspect > 0 ? imageAspect : 4 / 3;
  const best = result.bestTarget;
  const claw = result.claw;

  // 카드 전체가 한 화면에 들어와야 캡처가 잘리지 않는다.
  // 폭·높이를 모두 aspect에서 유도해 사진 비율을 정확히 보존한다 —
  // 비율이 어긋나면 %좌표 마커가 전부 엉뚱한 인형 위에 찍힌다.
  const cardWidth = Math.min(width - 40, CARD_MAX_WIDTH);
  const innerWidth = cardWidth - CARD_PADDING * 2;
  const maxImageHeight = height * 0.4;
  const imageWidth = Math.min(innerWidth, maxImageHeight * aspect);
  const imageHeight = imageWidth / aspect;

  const handleShare = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('공유 불가', '이 기기에서는 공유 기능을 사용할 수 없습니다.');
        return;
      }
      const uri = await captureRef(cardRef, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
      });
      await Sharing.shareAsync(uri, {
        mimeType: 'image/png',
        dialogTitle: '분석 결과 공유',
      });
    } catch (e) {
      if (__DEV__) console.warn('[share] 카드 생성/공유 실패:', e);
      Alert.alert('공유 실패', '이미지를 만들지 못했습니다.\n다시 시도해주세요.');
    } finally {
      setBusy(false);
    }
  }, [busy]);

  return (
    <View style={styles.backdrop}>
      {/* 캡처 대상 — collapsable={false} 가 없으면 안드로이드에서 뷰가 합쳐져 캡처가 비어 나온다. */}
      <View
        ref={cardRef}
        collapsable={false}
        style={[styles.card, { width: cardWidth, padding: CARD_PADDING }]}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.brand}>뽑기 AI</Text>
          <Text style={styles.brandTag}>AI 인형뽑기 공략</Text>
        </View>

        <View style={[styles.imageBox, { width: imageWidth, height: imageHeight }]}>
          <Image
            source={{ uri: imageUri }}
            style={styles.image}
            resizeMode="contain"
          />
          {claw && (
            <View
              style={[
                styles.clawMarker,
                { left: `${claw.positionX ?? 50}%`, top: `${claw.positionY ?? 20}%` },
              ]}
            >
              <Text style={styles.clawMarkerText}>{'⬇'}</Text>
            </View>
          )}
          <View
            style={[
              styles.marker,
              {
                left: `${best.positionX}%`,
                top: `${best.positionY}%`,
                borderColor: '#00e676',
                backgroundColor: 'rgba(0,230,118,0.3)',
              },
            ]}
          >
            <Text style={[styles.markerText, { color: '#00e676' }]}>{'★'}</Text>
          </View>
          {otherTargets.map((t, i) => (
            <View
              key={i}
              style={[
                styles.marker,
                {
                  left: `${t.positionX}%`,
                  top: `${t.positionY}%`,
                  borderColor: rateColor(t.successRate),
                  backgroundColor: 'rgba(0,0,0,0.5)',
                },
              ]}
            >
              <Text style={[styles.markerText, { color: rateColor(t.successRate) }]}>
                {i + 1}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.rateRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rateLabel}>추천 타겟</Text>
            <Text style={styles.targetName} numberOfLines={1}>
              {'★ '}
              {best.name}
            </Text>
          </View>
          <View style={styles.rateBox}>
            <Text style={[styles.rateValue, { color: rateColor(best.successRate) }]}>
              {best.successRate}%
            </Text>
            <Text style={styles.rateCaption}>성공률</Text>
          </View>
        </View>

        {!!best.grabPoint && (
          <View style={styles.grabBox}>
            <Text style={styles.grabLabel}>집게 포인트</Text>
            <Text style={styles.grabText} numberOfLines={3}>
              {best.grabPoint}
            </Text>
          </View>
        )}

        <Text style={styles.watermark}>
          Play 스토어에서 <Text style={styles.watermarkStrong}>뽑기 AI</Text> 검색
        </Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.shareBtn, busy && styles.shareBtnDisabled]}
          onPress={handleShare}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator size="small" color="#000" />
          ) : (
            <Text style={styles.shareBtnText}>이미지로 공유하기</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={busy}>
          <Text style={styles.cancelBtnText}>닫기</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: Platform.OS === 'ios' ? 50 : 38,
  },
  card: {
    backgroundColor: '#0a0a1e',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,230,118,0.35)',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  brand: {
    color: '#00e676',
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  brandTag: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 11,
  },
  imageBox: {
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#000',
    alignSelf: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  marker: {
    position: 'absolute',
    width: MARKER_SIZE,
    height: MARKER_SIZE,
    borderRadius: MARKER_SIZE / 2,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: -MARKER_SIZE / 2,
    marginTop: -MARKER_SIZE / 2,
  },
  markerText: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  clawMarker: {
    position: 'absolute',
    width: CLAW_MARKER_SIZE,
    height: CLAW_MARKER_SIZE,
    borderRadius: CLAW_MARKER_SIZE / 2,
    borderWidth: 2,
    borderColor: '#e040fb',
    backgroundColor: 'rgba(224,64,251,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: -CLAW_MARKER_SIZE / 2,
    marginTop: -CLAW_MARKER_SIZE / 2,
  },
  clawMarkerText: {
    fontSize: 12,
    color: '#e040fb',
  },
  rateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
  },
  rateLabel: {
    color: '#888',
    fontSize: 11,
    marginBottom: 2,
  },
  targetName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  rateBox: {
    alignItems: 'center',
  },
  rateValue: {
    fontSize: 28,
    fontWeight: 'bold',
    lineHeight: 32,
  },
  rateCaption: {
    color: '#888',
    fontSize: 10,
  },
  grabBox: {
    backgroundColor: 'rgba(255,171,0,0.12)',
    borderRadius: 8,
    padding: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#ffab00',
    marginTop: 10,
  },
  grabLabel: {
    color: '#ffab00',
    fontSize: 10,
    fontWeight: 'bold',
    marginBottom: 3,
  },
  grabText: {
    color: '#fff',
    fontSize: 12,
    lineHeight: 18,
  },
  watermark: {
    color: '#555',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 12,
  },
  watermarkStrong: {
    color: '#00e676',
    fontWeight: 'bold',
  },
  // 캡처 영역 밖 — 카드에는 포함되지 않는다.
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 18,
  },
  shareBtn: {
    backgroundColor: '#00e676',
    paddingHorizontal: 26,
    paddingVertical: 13,
    borderRadius: 12,
    minWidth: 170,
    alignItems: 'center',
  },
  shareBtnDisabled: {
    opacity: 0.6,
  },
  shareBtnText: {
    color: '#000',
    fontSize: 15,
    fontWeight: 'bold',
  },
  cancelBtn: {
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  cancelBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
