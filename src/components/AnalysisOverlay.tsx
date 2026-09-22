import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Platform,
} from 'react-native';
import { AnalysisResult, Target } from '../services/gemini';
import ShareCard from './ShareCard';

interface Props {
  result: AnalysisResult;
  imageUri: string;
  /** 원본 사진의 가로/세로 비율. 마커 좌표계를 사진과 일치시키는 데 쓴다. */
  imageAspect?: number;
  onClose: () => void;
}

const MARKER_SIZE = 28;
const CLAW_MARKER_SIZE = 32;

const difficultyColor = (d: string) => {
  switch (d) {
    case 'easy':
      return '#00e676';
    case 'medium':
      return '#ffab00';
    case 'hard':
      return '#ff1744';
    default:
      return '#fff';
  }
};

const difficultyLabel = (d: string) => {
  switch (d) {
    case 'easy':
      return '쉬움';
    case 'medium':
      return '보통';
    case 'hard':
      return '어려움';
    default:
      return d;
  }
};

const typeLabel = (t: string) => {
  switch (t) {
    case 'plush':
      return '인형';
    case 'box':
      return '상자';
    case 'figure':
      return '피규어';
    default:
      return '기타';
  }
};

const rateColor = (r: number) =>
  r >= 70 ? '#00e676' : r >= 40 ? '#ffab00' : '#ff1744';

function TargetMarker({
  target,
  index,
  isBest,
}: {
  target: Target;
  index: number;
  isBest: boolean;
}) {
  const color = isBest ? '#00e676' : difficultyColor(target.difficulty);
  return (
    <View
      style={[
        styles.marker,
        {
          left: `${target.positionX}%`,
          top: `${target.positionY}%`,
          borderColor: color,
          backgroundColor: isBest ? 'rgba(0,230,118,0.3)' : 'rgba(0,0,0,0.5)',
        },
      ]}
    >
      <Text style={[styles.markerText, { color }]}>
        {isBest ? '\u2605' : index + 1}
      </Text>
    </View>
  );
}

function TargetCard({
  target,
  index,
  isBest,
}: {
  target: Target;
  index: number;
  isBest: boolean;
}) {
  const color = isBest ? '#00e676' : difficultyColor(target.difficulty);
  return (
    <View style={[styles.targetCard, isBest && styles.bestTargetCard]}>
      <View style={styles.targetHeader}>
        <View
          style={[
            styles.cardMarker,
            {
              borderColor: color,
              backgroundColor: isBest
                ? 'rgba(0,230,118,0.3)'
                : 'rgba(0,0,0,0.5)',
            },
          ]}
        >
          <Text style={[styles.cardMarkerText, { color }]}>
            {isBest ? '\u2605' : index + 1}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          {isBest && (
            <View style={styles.bestBadge}>
              <Text style={styles.bestBadgeText}>BEST TARGET</Text>
            </View>
          )}
          <Text style={styles.targetName}>{target.name}</Text>
        </View>
      </View>
      <View style={styles.targetMeta}>
        {target.type && (
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>유형</Text>
            <Text style={styles.metaValue}>{typeLabel(target.type)}</Text>
          </View>
        )}
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>위치</Text>
          <Text style={styles.metaValue}>{target.position}</Text>
        </View>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>크기</Text>
          <Text style={styles.metaValue}>{target.size}</Text>
        </View>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>난이도</Text>
          <Text
            style={[
              styles.metaValue,
              { color: difficultyColor(target.difficulty) },
            ]}
          >
            {difficultyLabel(target.difficulty)}
          </Text>
        </View>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>성공률</Text>
          <Text style={[styles.metaValue, { color: rateColor(target.successRate) }]}>
            {target.successRate}%
          </Text>
        </View>
      </View>
      <Text style={styles.targetReason}>{target.reason}</Text>
      <View style={styles.grabPointBox}>
        <Text style={styles.grabPointLabel}>집게 포인트</Text>
        <Text style={styles.grabPointText}>{target.grabPoint}</Text>
      </View>
      {target.grabDetail && (
        <View style={styles.grabDetailBox}>
          <Text style={styles.grabDetailLabel}>상세 공략법</Text>
          <Text style={styles.grabDetailText}>{target.grabDetail}</Text>
        </View>
      )}
    </View>
  );
}

export default function AnalysisOverlay({ result, imageUri, imageAspect, onClose }: Props) {
  const [sharing, setSharing] = React.useState(false);
  const confidencePercent = Math.round(result.confidence * 100);
  const claw = result.claw;
  // 사진 비율이 없으면 4:3으로 가정 (마커가 어긋나지 않도록 contain으로 렌더)
  const aspect = imageAspect && imageAspect > 0 ? imageAspect : 4 / 3;

  // bestTarget이 targets에 중복돼 있으면 정확히 그 항목 하나만 제외한다.
  // (이름/위치 문자열 비교로 걸러내면 표현이 조금 달라질 때 카드가 두 번 그려지거나
  //  이름이 같은 다른 상품이 사라진다.)
  const otherTargets = React.useMemo(() => {
    const b = result.bestTarget;
    let bestIdx = result.targets.indexOf(b);
    if (bestIdx === -1) {
      bestIdx = result.targets.findIndex(
        (t) =>
          t.name === b.name &&
          Math.abs(t.positionX - b.positionX) < 5 &&
          Math.abs(t.positionY - b.positionY) < 5,
      );
    }
    return bestIdx === -1
      ? result.targets
      : result.targets.filter((_, i) => i !== bestIdx);
  }, [result]);

  return (
    <View style={styles.overlay}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>분석 결과</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => setSharing(true)} style={styles.shareBtn}>
            <Text style={styles.shareBtnText}>공유</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeBtnText}>X</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={styles.scrollArea} showsVerticalScrollIndicator={false}>
        {/* Image with markers */}
        <View style={[styles.imageContainer, { aspectRatio: aspect }]}>
          <Image
            source={{ uri: imageUri }}
            style={styles.image}
            resizeMode="contain"
          />
          {/* Claw marker */}
          {claw && (
            <View
              style={[
                styles.clawMarker,
                {
                  left: `${claw.positionX ?? 50}%`,
                  top: `${claw.positionY ?? 20}%`,
                },
              ]}
            >
              <Text style={styles.clawMarkerText}>{'\u2B07'}</Text>
            </View>
          )}
          {/* Best target marker */}
          <TargetMarker target={result.bestTarget} index={0} isBest />
          {/* Other target markers */}
          {otherTargets.map((target, i) => (
            <TargetMarker key={i} target={target} index={i} isBest={false} />
          ))}
        </View>

        {/* Claw Info */}
        {claw && (
          <View style={styles.clawBox}>
            <Text style={styles.sectionTitle}>집게 분석</Text>
            <View style={styles.clawMeta}>
              <View style={styles.clawMetaItem}>
                <Text style={styles.metaLabel}>크기</Text>
                <Text style={styles.clawMetaValue}>{claw.size}</Text>
              </View>
              <View style={styles.clawMetaItem}>
                <Text style={styles.metaLabel}>파지력</Text>
                <Text style={styles.clawMetaValue}>{claw.strength}</Text>
              </View>
              <View style={styles.clawMetaItem}>
                <Text style={styles.metaLabel}>벌림 폭</Text>
                <Text style={styles.clawMetaValue}>{claw.openWidth}</Text>
              </View>
            </View>
          </View>
        )}

        {/* Confidence */}
        <View style={styles.confidenceBar}>
          <Text style={styles.confidenceLabel}>성공 확률</Text>
          <View style={styles.confidenceTrack}>
            <View
              style={[
                styles.confidenceFill,
                {
                  width: `${confidencePercent}%`,
                  backgroundColor:
                    confidencePercent >= 70
                      ? '#00e676'
                      : confidencePercent >= 40
                        ? '#ffab00'
                        : '#ff1744',
                },
              ]}
            />
          </View>
          <Text style={styles.confidenceText}>{confidencePercent}%</Text>
        </View>

        {/* Best Target */}
        <TargetCard target={result.bestTarget} index={0} isBest />

        {/* Strategy */}
        <View style={styles.strategyBox}>
          <Text style={styles.sectionTitle}>공략 전략</Text>
          <Text style={styles.strategyText}>{result.strategy}</Text>
        </View>

        {/* Tips */}
        {result.tips && result.tips.length > 0 && (
          <View style={styles.tipsBox}>
            <Text style={styles.sectionTitle}>꿀팁</Text>
            {result.tips.map((tip, i) => (
              <View key={i} style={styles.tipRow}>
                <Text style={styles.tipBullet}>*</Text>
                <Text style={styles.tipText}>{tip}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Other Targets */}
        {otherTargets.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { marginTop: 16 }]}>
              기타 타겟 ({otherTargets.length}개)
            </Text>
            {otherTargets.map((target, i) => (
              <TargetCard key={i} target={target} index={i} isBest={false} />
            ))}
          </>
        )}

        {result.apiSource && (
          <Text style={styles.apiSource}>Powered by {result.apiSource}</Text>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {sharing && (
        <ShareCard
          result={result}
          imageUri={imageUri}
          imageAspect={imageAspect}
          otherTargets={otherTargets}
          onClose={() => setSharing(false)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0a0a1e',
    paddingTop: Platform.OS === 'ios' ? 50 : 38,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  shareBtn: {
    height: 36,
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: '#00e676',
    justifyContent: 'center',
    alignItems: 'center',
  },
  shareBtnText: {
    color: '#000',
    fontSize: 14,
    fontWeight: 'bold',
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  scrollArea: {
    flex: 1,
    paddingHorizontal: 16,
  },
  // Image + markers
  imageContainer: {
    width: '100%',
    // height는 aspectRatio(원본 사진 비율)로 결정된다 — 마커 %좌표가 사진과 정확히 일치해야 한다.
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
    backgroundColor: '#000',
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
    borderWidth: 2.5,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: -MARKER_SIZE / 2,
    marginTop: -MARKER_SIZE / 2,
  },
  markerText: {
    fontSize: 13,
    fontWeight: 'bold',
  },
  clawMarker: {
    position: 'absolute',
    width: CLAW_MARKER_SIZE,
    height: CLAW_MARKER_SIZE,
    borderRadius: CLAW_MARKER_SIZE / 2,
    borderWidth: 2.5,
    borderColor: '#e040fb',
    backgroundColor: 'rgba(224,64,251,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: -CLAW_MARKER_SIZE / 2,
    marginTop: -CLAW_MARKER_SIZE / 2,
  },
  clawMarkerText: {
    fontSize: 16,
    color: '#e040fb',
  },
  // Claw info
  clawBox: {
    backgroundColor: 'rgba(224,64,251,0.1)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 3,
    borderLeftColor: '#e040fb',
  },
  clawMeta: {
    flexDirection: 'row',
    gap: 16,
  },
  clawMetaItem: {
    flex: 1,
  },
  clawMetaValue: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '500',
    marginTop: 2,
  },
  // Confidence
  confidenceBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 10,
  },
  confidenceLabel: {
    color: '#aaa',
    fontSize: 13,
  },
  confidenceTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  confidenceFill: {
    height: '100%',
    borderRadius: 4,
  },
  confidenceText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    minWidth: 42,
    textAlign: 'right',
  },
  // Target cards
  targetCard: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  bestTargetCard: {
    borderColor: '#00e676',
    borderWidth: 2,
    backgroundColor: 'rgba(0, 230, 118, 0.08)',
  },
  targetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  cardMarker: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardMarkerText: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  bestBadge: {
    backgroundColor: '#00e676',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
    marginBottom: 4,
  },
  bestBadgeText: {
    color: '#000',
    fontSize: 11,
    fontWeight: 'bold',
  },
  targetName: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  targetMeta: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 10,
    flexWrap: 'wrap',
  },
  metaItem: {
    alignItems: 'center',
  },
  metaLabel: {
    color: '#888',
    fontSize: 11,
    marginBottom: 2,
  },
  metaValue: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  targetReason: {
    color: '#ccc',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 10,
  },
  grabPointBox: {
    backgroundColor: 'rgba(255,171,0,0.12)',
    borderRadius: 8,
    padding: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#ffab00',
    marginBottom: 8,
  },
  grabPointLabel: {
    color: '#ffab00',
    fontSize: 11,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  grabPointText: {
    color: '#fff',
    fontSize: 13,
    lineHeight: 19,
  },
  grabDetailBox: {
    backgroundColor: 'rgba(41,121,255,0.1)',
    borderRadius: 8,
    padding: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#2979ff',
  },
  grabDetailLabel: {
    color: '#2979ff',
    fontSize: 11,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  grabDetailText: {
    color: '#ddd',
    fontSize: 13,
    lineHeight: 20,
  },
  // Strategy
  strategyBox: {
    backgroundColor: 'rgba(41, 121, 255, 0.1)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#2979ff',
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  strategyText: {
    color: '#ddd',
    fontSize: 14,
    lineHeight: 22,
  },
  // Tips
  tipsBox: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  tipRow: {
    flexDirection: 'row',
    marginBottom: 6,
    gap: 8,
  },
  tipBullet: {
    color: '#ffab00',
    fontSize: 14,
    fontWeight: 'bold',
  },
  tipText: {
    color: '#ccc',
    fontSize: 13,
    lineHeight: 19,
    flex: 1,
  },
  apiSource: {
    color: '#555',
    fontSize: 11,
    textAlign: 'center' as const,
    marginTop: 16,
  },
});
