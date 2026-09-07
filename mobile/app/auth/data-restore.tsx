import { SafeAreaView } from 'react-native-safe-area-context';
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  TouchableOpacity,
  Alert,
  StatusBar,
  Dimensions,
  BackHandler } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { NalissLogo } from '../../src/components/NalissLogo';
import { useDataRestoreStore } from '../../src/stores/data-restore.store';
import { useGlobalSyncStore } from '../../src/stores/globalSync.store';
import { useAuthStore } from '../../src/stores/auth.store';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width } = Dimensions.get('window');

export default function DataRestoreScreen() {
  const router = useRouter();
  const { restoreInProgress, progress, currentStep, error } = useDataRestoreStore();
  const [hasStarted, setHasStarted] = useState(false);

  // Animated values
  const progressAnim = useRef(new Animated.Value(0)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.8)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Entry animations
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeIn, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      }),
      Animated.spring(logoScale, {
        toValue: 1,
        friction: 4,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  // Smooth progress bar animation
  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: progress,
      duration: 400,
      useNativeDriver: false,
      easing: Easing.out(Easing.cubic),
    }).start();
  }, [progress]);

  // Pulse animation during restore
  useEffect(() => {
    if (!restoreInProgress) return;
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.05,
          duration: 1000,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [restoreInProgress]);

  // Block hardware back button during restore
  useEffect(() => {
    if (!restoreInProgress) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => subscription.remove();
  }, [restoreInProgress]);

  // Auto-navigate when complete
  useEffect(() => {
    if (progress >= 100 && hasStarted) {
      const timer = setTimeout(() => {
        useDataRestoreStore.getState().completeRestore();
        router.replace('/(tabs)' as any);
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, [progress, hasStarted]);

  const handleRestore = async () => {
    setHasStarted(true);
    useDataRestoreStore.getState().startRestore();

    try {
      await useGlobalSyncStore.getState().restoreAllData((prog, step) => {
        useDataRestoreStore.getState().setProgress(prog, step);
      });
      useDataRestoreStore.getState().completeRestore();
    } catch (err: any) {
      useDataRestoreStore.getState().setError(err?.message || 'Restore failed');
    }
  };

  const handleBackgroundRestore = () => {
    if (restoreInProgress) {
      Alert.alert(
        'Restore in Progress',
        'Data is being downloaded. It will continue in the background.',
        [
          { text: 'Wait here', style: 'cancel' },
          {
            text: 'Continue to App',
            style: 'default',
            onPress: () => {
              useDataRestoreStore.getState().skipRestore();
              router.replace('/(tabs)' as any);
            },
          },
        ]
      );
      return;
    }

    // Start restore in the background
    useDataRestoreStore.getState().startRestore();
    useGlobalSyncStore.getState().restoreAllData((prog, step) => {
      useDataRestoreStore.getState().setProgress(prog, step);
    }).then(() => {
      useDataRestoreStore.getState().completeRestore();
    }).catch(() => {
      // silently ignore background restore errors
    });

    // Mark DownloadTracker as "done" — restoreAllData above handles everything.
    // This prevents initialize() from running restoreUserDownloads() as a duplicate.
    const userId = useAuthStore.getState().user?.id;
    if (userId) {
      AsyncStorage.setItem(`download_restore_${userId}`, 'true').catch(() => {});
    }

    useDataRestoreStore.getState().skipRestore();
    router.replace('/(tabs)' as any);
  };

  const handleCancel = () => {
    if (restoreInProgress) {
      Alert.alert(
        'Cancel Restore',
        'Are you sure you want to cancel? You will start fresh on this device.',
        [
          { text: 'Wait here', style: 'cancel' },
          {
            text: 'Cancel Restore',
            style: 'destructive',
            onPress: async () => {
              // Prevent restoreUserDownloads from running after cancel
              const userId = useAuthStore.getState().user?.id;
              if (userId) {
                await AsyncStorage.setItem(`download_restore_${userId}`, 'true');
                await AsyncStorage.setItem(`download_restore_progress_${userId}`, '');
              }
              useDataRestoreStore.getState().skipRestore();
              router.replace('/(tabs)' as any);
            },
          },
        ]
      );
      return;
    }

    // Prevent restoreUserDownloads from running after cancel
    const userId = useAuthStore.getState().user?.id;
    if (userId) {
      AsyncStorage.setItem(`download_restore_${userId}`, 'true').catch(() => {});
    }
    useDataRestoreStore.getState().skipRestore();
    router.replace('/(tabs)' as any);
  };

  const handleRetry = () => {
    useDataRestoreStore.getState().setProgress(0, '');
    handleRestore();
  };

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#042f2e" />
      <LinearGradient
        colors={['#042f2e', '#064e3b', '#065f46']}
        style={styles.gradient}
      >
        <SafeAreaView style={styles.safeArea}>
          <Animated.View style={[styles.content, { opacity: fadeIn }]}>
            {/* Logo */}
            <Animated.View style={[styles.logoContainer, { transform: [{ scale: restoreInProgress ? pulseAnim : logoScale }] }]}>
              <NalissLogo size={90} rounded />
            </Animated.View>

            {/* Title */}
            <Text style={styles.title}>
              {hasStarted ? 'Restoring Your Data' : 'Welcome Back!'}
            </Text>
            <Text style={styles.subtitle}>
              {hasStarted
                ? 'Please wait while we set everything up on this device'
                : "It looks like you're on a new device. Would you like to restore your data from your previous device?"
              }
            </Text>

            {/* Progress Section */}
            {hasStarted && (
              <Animated.View style={[styles.progressSection, { opacity: fadeIn }]}>
                {/* Progress Bar */}
                <View style={styles.progressBarBg}>
                  <Animated.View style={[styles.progressBarFill, { width: progressWidth as any }]}>
                    <LinearGradient
                      colors={['#10b981', '#34d399', '#6ee7b7']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={StyleSheet.absoluteFill}
                    />
                  </Animated.View>
                </View>

                {/* Percentage */}
                <Text style={styles.percentText}>{Math.round(progress)}%</Text>

                {/* Current Step */}
                <View style={styles.stepRow}>
                  {restoreInProgress && progress < 100 && (
                    <Ionicons name="sync" size={14} color="#6ee7b7" style={{ marginRight: 6 }} />
                  )}
                  {progress >= 100 && (
                    <Ionicons name="checkmark-circle" size={16} color="#6ee7b7" style={{ marginRight: 6 }} />
                  )}
                  <Text style={styles.stepText}>{currentStep}</Text>
                </View>
              </Animated.View>
            )}

            {/* Error State */}
            {error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={18} color="#fca5a5" />
                <Text style={styles.errorText}>{error}</Text>
                <TouchableOpacity style={styles.retryBtn} onPress={handleRetry}>
                  <Ionicons name="refresh" size={16} color="#fff" />
                  <Text style={styles.retryBtnText}>Retry</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Spacer */}
            <View style={{ flex: 1 }} />

            {/* Action Buttons */}
            {!hasStarted && !error && (
              <View style={styles.buttonSection}>
                <TouchableOpacity style={styles.restoreBtn} onPress={handleRestore} activeOpacity={0.8}>
                  <LinearGradient
                    colors={['#10b981', '#059669']}
                    style={styles.restoreBtnGradient}
                  >
                    <Ionicons name="cloud-download-outline" size={22} color="#fff" />
                    <Text style={styles.restoreBtnText}>Restore My Data</Text>
                  </LinearGradient>
                </TouchableOpacity>

                <TouchableOpacity style={styles.skipBtn} onPress={handleBackgroundRestore} activeOpacity={0.7}>
                  <Text style={styles.skipBtnText}>Continue and restore in the background</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel} activeOpacity={0.7}>
                  <Text style={styles.cancelBtnText}>Cancel and start fresh</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* During restore — only allow skip if not in progress */}
            {hasStarted && !error && progress < 100 && (
              <View style={styles.buttonSection}>
                <Text style={styles.warningText}>
                  Please keep the app open until restore completes
                </Text>
              </View>
            )}

            {/* Completed */}
            {progress >= 100 && hasStarted && (
              <View style={styles.buttonSection}>
                <View style={styles.completedRow}>
                  <Ionicons name="checkmark-circle" size={24} color="#6ee7b7" />
                  <Text style={styles.completedText}>Restore complete! Launching...</Text>
                </View>
              </View>
            )}
          </Animated.View>
        </SafeAreaView>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  gradient: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 32,
    paddingTop: 60,
    paddingBottom: 40,
    alignItems: 'center',
  },
  logoContainer: {
    marginBottom: 32,
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  title: {
    fontFamily: 'Inter-Bold',
    fontSize: 26,
    color: '#fff',
    textAlign: 'center',
    marginBottom: 12,
    letterSpacing: 0.3,
  },
  subtitle: {
    fontFamily: 'Inter-Medium',
    fontSize: 15,
    color: '#a7f3d0',
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 8,
    marginBottom: 40,
  },
  progressSection: {
    width: '100%',
    alignItems: 'center',
    marginTop: 8,
  },
  progressBarBg: {
    width: '100%',
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 16,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
    overflow: 'hidden',
  },
  percentText: {
    fontFamily: 'Inter-Bold',
    fontSize: 42,
    color: '#fff',
    marginBottom: 8,
    letterSpacing: 1,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: {
    fontFamily: 'Inter-Medium',
    fontSize: 14,
    color: '#a7f3d0',
  },
  errorBox: {
    backgroundColor: 'rgba(220, 38, 38, 0.15)',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    width: '100%',
    borderWidth: 1,
    borderColor: 'rgba(220, 38, 38, 0.3)',
  },
  errorText: {
    fontFamily: 'Inter-Medium',
    fontSize: 13,
    color: '#fca5a5',
    textAlign: 'center',
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginTop: 4,
  },
  retryBtnText: {
    fontFamily: 'Inter-Bold',
    fontSize: 13,
    color: '#fff',
  },
  buttonSection: {
    width: '100%',
    alignItems: 'center',
    gap: 16,
    paddingBottom: 20,
  },
  restoreBtn: {
    width: '100%',
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  restoreBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
  },
  restoreBtnText: {
    fontFamily: 'Inter-Bold',
    fontSize: 16,
    color: '#fff',
    letterSpacing: 0.3,
  },
  skipBtn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  skipBtnText: {
    fontFamily: 'Inter-Medium',
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
    textDecorationLine: 'underline',
  },
  cancelBtn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    marginTop: -8,
  },
  cancelBtnText: {
    fontFamily: 'Inter-Medium',
    fontSize: 13,
    color: 'rgba(239, 68, 68, 0.7)',
    textDecorationLine: 'underline',
  },
  warningText: {
    fontFamily: 'Inter-Medium',
    fontSize: 13,
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
  },
  completedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  completedText: {
    fontFamily: 'Inter-Bold',
    fontSize: 16,
    color: '#6ee7b7',
  },
});
