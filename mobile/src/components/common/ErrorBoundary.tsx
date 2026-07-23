import React from 'react';
import * as Sentry from '@sentry/react-native';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/Colors';
import { NalissLogo } from '../NalissLogo';
import { useAuthStore } from '../../stores/auth.store';
import { useSignupStore } from '../../stores/signup.store';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface Props {
  error: Error;
  retry: () => Promise<void>;
}

/**
 * Premium, branded Error Boundary for NALISS UMYU HUB.
 * Replaces the generic Expo Router error screen with a professional recovery UI.
 */
export function ErrorBoundary({ error, retry }: Props) {
  // Report every crash boundary hit to Sentry with full stack
  React.useEffect(() => {
    Sentry.captureException(error, {
      tags: { location: 'ErrorBoundary.root' },
      extra: { stack: error.stack },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  const handleHardReset = async () => {
    try {
      // Wipe all local persistence to clear corrupted state
      const keys = await AsyncStorage.getAllKeys();
      await AsyncStorage.multiRemove(keys);
      
      // Reset core stores
      useAuthStore.getState().signOut();
      useSignupStore.getState().reset();

      // Force reload the app (best-effort â€” expo-updates may not be installed)
      try {
        const Updates = require('expo-updates');
        if (Updates?.reloadAsync) {
          await Updates.reloadAsync();
        }
      } catch {
        // expo-updates not available â€” fallback to retry
      }
    } catch {
      // Fallback
      retry();
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <NalissLogo size={80} rounded />
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.subtitle}>
            NALISS UMYU HUB encountered an unexpected error. We've logged the incident and our team will investigate.
          </Text>
        </View>

        <View style={styles.errorCard}>
          <View style={styles.errorHeader}>
            <Ionicons name="bug-outline" size={20} color="#dc2626" />
            <Text style={styles.errorLabel}>Error Details</Text>
          </View>
          <Text style={styles.errorText}>{error.message}</Text>
          {error.stack && (
            <Text style={styles.stackTrace} numberOfLines={5}>
              {error.stack}
            </Text>
          )}
        </View>

        <View style={styles.actions}>
          <TouchableOpacity 
            style={styles.retryBtn} 
            onPress={retry}
            activeOpacity={0.8}
          >
            <Ionicons name="refresh" size={20} color="#fff" />
            <Text style={styles.retryText}>Try Again</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.resetBtn} 
            onPress={handleHardReset}
            activeOpacity={0.7}
          >
            <Ionicons name="trash-outline" size={18} color="#ef4444" />
            <Text style={styles.resetText}>Clear App Data & Reset</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            If this problem persists, please contact NALISS IT Support.
          </Text>
          <Text style={styles.versionText}>v1.0.4-stabilized</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  content: {
    padding: 24,
    alignItems: 'center',
    paddingTop: 60,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  title: {
    fontSize: 24,
    fontFamily: 'Inter-Bold',
    color: '#0f172a',
    marginTop: 24,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 12,
  },
  errorCard: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#fee2e2',
    marginBottom: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
  },
  errorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  errorLabel: {
    fontSize: 12,
    fontFamily: 'Inter-Bold',
    color: '#dc2626',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  errorText: {
    fontSize: 15,
    fontFamily: 'Inter-SemiBold',
    color: '#1e293b',
    lineHeight: 22,
  },
  stackTrace: {
    fontSize: 11,
    fontFamily: 'Inter-Regular',
    color: '#94a3b8',
    marginTop: 12,
    padding: 10,
    backgroundColor: '#f8fafc',
    borderRadius: 8,
  },
  actions: {
    width: '100%',
    gap: 16,
  },
  retryBtn: {
    backgroundColor: COLORS.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: 56,
    borderRadius: 18,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  retryText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: 'Inter-Bold',
  },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 50,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#fee2e2',
  },
  resetText: {
    color: '#ef4444',
    fontSize: 14,
    fontFamily: 'Inter-SemiBold',
  },
  footer: {
    marginTop: 40,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 12,
    fontFamily: 'Inter-Medium',
    color: '#94a3b8',
    textAlign: 'center',
  },
  versionText: {
    fontSize: 10,
    fontFamily: 'Inter-Bold',
    color: '#cbd5e1',
    marginTop: 8,
    letterSpacing: 2,
  },
});
