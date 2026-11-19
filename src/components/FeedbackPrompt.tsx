import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as StoreReview from 'expo-store-review';
import { AnalysisResult, FeedbackOutcome, sendFeedback } from '../services/gemini';

// 결과는 플레이 "전"에 보므로 결과 화면에서 성공 여부를 물을 수 없다.
// 마지막으로 본 결과를 기기에 남겨 두었다가, 기계 앞에서 몇 판 해볼 시간이 지난 뒤
// 다음 촬영 화면에서 한 번만 묻는다.
const LAST_KEY = 'lastAnalysis';
const REVIEW_KEY = 'reviewRequested';
const ASK_AFTER_MS = 3 * 60 * 1000;
const ASK_WITHIN_MS = 24 * 60 * 60 * 1000;

interface LastAnalysis {
  name: string;
  successRate: number;
  apiSource?: string;
  promptVersion?: string;
  at: number;
  asked: boolean;
}

/** 사용자가 실제로 본 결과만 기록한다(AnalysisOverlay가 표시될 때 호출). */
export function rememberAnalysis(result: AnalysisResult): void {
  if (result.noMachine) return;
  const v: LastAnalysis = {
    name: result.bestTarget.name,
    successRate: result.bestTarget.successRate,
    apiSource: result.apiSource,
    promptVersion: result.promptVersion,
    at: Date.now(),
    asked: false,
  };
  AsyncStorage.setItem(LAST_KEY, JSON.stringify(v)).catch(() => {});
}

async function loadPending(): Promise<LastAnalysis | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as LastAnalysis;
    if (v.asked || typeof v.name !== 'string' || typeof v.successRate !== 'number') return null;
    const age = Date.now() - v.at;
    return age >= ASK_AFTER_MS && age <= ASK_WITHIN_MS ? v : null;
  } catch {
    return null;
  }
}

/** 촬영 화면에 붙는 "지난번 그 인형 뽑았어요?" 카드. 카메라 화면이 열릴 때마다 새로 마운트된다. */
export default function FeedbackPrompt() {
  const [pending, setPending] = useState<LastAnalysis | null>(null);
  const [thanks, setThanks] = useState<string | null>(null);

  const check = useCallback(() => {
    loadPending().then(setPending);
  }, []);

  useEffect(() => {
    check();
    // 앱을 내려 두고 플레이한 뒤 돌아오는 경우
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check();
    });
    return () => sub.remove();
  }, [check]);

  useEffect(() => {
    if (!thanks) return;
    const t = setTimeout(() => setThanks(null), 2500);
    return () => clearTimeout(t);
  }, [thanks]);

  // outcome이 null이면 닫기(✕): 서버에 보내지 않고 다시 묻지도 않는다.
  const answer = useCallback(
    async (outcome: FeedbackOutcome | null) => {
      const p = pending;
      setPending(null);
      if (!p) return;
      AsyncStorage.setItem(LAST_KEY, JSON.stringify({ ...p, asked: true })).catch(() => {});
      if (!outcome) return;

      sendFeedback({
        outcome,
        successRate: p.successRate,
        apiSource: p.apiSource,
        promptVersion: p.promptVersion,
      });

      if (outcome === 'success') {
        setThanks('축하해요! 🎉');
        // 리뷰 요청은 성공 직후에 평생 한 번만. 실제 노출 여부·빈도는 Play가 다시 제한한다.
        try {
          if (!(await AsyncStorage.getItem(REVIEW_KEY)) && (await StoreReview.isAvailableAsync())) {
            await AsyncStorage.setItem(REVIEW_KEY, '1');
            await StoreReview.requestReview();
          }
        } catch {
          // 리뷰 창은 부가 기능 — 실패해도 무시
        }
      } else if (outcome === 'fail') {
        setThanks('아쉬워요. 알려주셔서 고마워요');
      }
    },
    [pending]
  );

  if (thanks) {
    return (
      <View style={styles.card}>
        <Text style={styles.thanks}>{thanks}</Text>
      </View>
    );
  }
  if (!pending) return null;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.question} numberOfLines={2}>
          지난번 「{pending.name}」 뽑으셨어요?
        </Text>
        <TouchableOpacity onPress={() => answer(null)} hitSlop={12}>
          <Text style={styles.close}>✕</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.btnRow}>
        <TouchableOpacity style={[styles.btn, styles.btnSuccess]} onPress={() => answer('success')}>
          <Text style={styles.btnSuccessText}>뽑았어요!</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={() => answer('fail')}>
          <Text style={styles.btnText}>실패했어요</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={() => answer('skipped')}>
          <Text style={styles.btnText}>안 했어요</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(20,20,40,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(0,230,118,0.35)',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  question: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 21,
  },
  close: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 16,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  btn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  btnSuccess: {
    backgroundColor: '#00e676',
  },
  btnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  btnSuccessText: {
    color: '#000',
    fontSize: 13,
    fontWeight: 'bold',
  },
  thanks: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
});
