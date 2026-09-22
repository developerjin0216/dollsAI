import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

interface Props {
  children: React.ReactNode;
  /** 폴백 화면에서 "처음으로 돌아가기"를 누르면 호출 — 앱 상태를 카메라 화면으로 되돌린다. */
  onReset?: () => void;
}

interface State {
  hasError: boolean;
}

// 렌더 중 예외(예: <Text> 자식에 문자열이 아닌 값이 도달)가 발생하면 앱 전체가
// 죽는 대신 한국어 폴백 화면을 보여주고, 카메라 상태로 복구할 수 있게 한다.
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    if (__DEV__) console.error('[ErrorBoundary]', error, errorInfo.componentStack);
  }

  handleReset = () => {
    // 문제를 일으킨 데이터로 다시 그리면 같은 자리에서 또 죽는다.
    // 부모 상태를 먼저 초기화한 뒤 폴백을 해제한다 (같은 배치로 함께 반영됨).
    this.props.onReset?.();
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>문제가 발생했습니다</Text>
          <Text style={styles.desc}>
            화면을 표시하는 중 오류가 발생했습니다.{'\n'}처음 화면으로 돌아가 다시 시도해주세요.
          </Text>
          <TouchableOpacity style={styles.button} onPress={this.handleReset}>
            <Text style={styles.buttonText}>처음으로 돌아가기</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  title: {
    color: '#fff',
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  desc: {
    color: '#aaa',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  button: {
    backgroundColor: '#00e676',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
  },
  buttonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
