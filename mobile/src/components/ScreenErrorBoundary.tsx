import React from 'react';
import * as Sentry from '@sentry/react-native';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/Colors';

interface State { hasError: boolean; error: string | null; }

/**
 * Wraps a screen so that if any child throws a runtime error,
 * it shows a friendly "something went wrong" message with a retry button
 * instead of the full black error screen.
 *
 * Usage:
 *   <ScreenErrorBoundary>
 *     <YourScreen />
 *   </ScreenErrorBoundary>
 */
export class ScreenErrorBoundary extends React.Component<
  { children: React.ReactNode; onRetry?: () => void },
  State
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any): State {
    return { hasError: true, error: error?.message || 'Unknown error' };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    Sentry.captureException(error, {
      tags: { location: 'ScreenErrorBoundary' },
      extra: { componentStack: info.componentStack },
    });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
    this.props.onRetry?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={styles.container}>
          <View style={styles.content}>
            <View style={styles.iconWrap}>
              <Ionicons name="alert-circle-outline" size={56} color="#94a3b8" />
            </View>
            <Text style={styles.title}>Could not load this page</Text>
            <Text style={styles.subtitle}>
              Some content may be missing or incomplete. Tap retry to try again.
            </Text>
            <TouchableOpacity style={styles.btn} onPress={this.handleRetry}>
              <Ionicons name="refresh" size={18} color="#fff" />
              <Text style={styles.btnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  iconWrap: {
    width: 96, height: 96, borderRadius: 28,
    backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center',
    marginBottom: 20,
  },
  title: { fontFamily: 'Inter-Bold', fontSize: 20, color: '#0f172a', textAlign: 'center', marginBottom: 10 },
  subtitle: { fontFamily: 'Inter-Regular', fontSize: 14, color: '#64748b', textAlign: 'center', lineHeight: 22, marginBottom: 28 },
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: COLORS.primary, paddingHorizontal: 24, paddingVertical: 14,
    borderRadius: 16,
  },
  btnText: { fontFamily: 'Inter-Bold', fontSize: 15, color: '#fff' },
});
