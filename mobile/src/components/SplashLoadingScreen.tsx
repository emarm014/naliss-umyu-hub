import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { NalissLogo } from './NalissLogo';
import { COLORS } from '../constants/Colors';
import { useThemeStore } from '../stores/theme.store';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface SplashLoadingScreenProps {
  message?: string;
}

export function SplashLoadingScreen({ message }: SplashLoadingScreenProps) {
  const { isDark } = useThemeStore();
  const insets = useSafeAreaInsets();

  const pulseAnim = useRef(new Animated.Value(0.95)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const taglineOpacity = useRef(new Animated.Value(0)).current;
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    // Fade in the whole screen components
    Animated.timing(opacityAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();

    // Fade in tagline shortly after logo appears
    Animated.sequence([
      Animated.delay(300),
      Animated.timing(taglineOpacity, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      })
    ]).start();

    // Subtle logo pulse
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.02,
          duration: 1200,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.96,
          duration: 1200,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }),
      ])
    ).start();

    // Staggered dot loading bounce
    const animateDot = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0.3, duration: 400, useNativeDriver: true }),
        ])
      ).start();

    animateDot(dot1, 0);
    animateDot(dot2, 200);
    animateDot(dot3, 400);
  }, []);

  // Theme-specific colors
  const gradientColors = isDark
    ? ['#0b1329', '#022c22'] as const  // Premium Dark Navy to Forest Green
    : ['#ffffff', '#f0fdf4'] as const; // Premium Clean White to Soft Mint Green

  const titleColor = isDark ? '#ffffff' : COLORS.primary;
  const taglineColor = isDark ? '#a7f3d0' : '#047857'; // Mint green / Forest green
  const subtitleColor = isDark ? '#94a3b8' : '#64748b'; // Muted description

  return (
    <LinearGradient colors={gradientColors} style={styles.container}>
      <Animated.View style={[styles.content, { opacity: opacityAnim }]}>
        {/* Pulsing Brand Logo */}
        <Animated.View style={{ transform: [{ scale: pulseAnim }], marginBottom: 20 }}>
          <NalissLogo size={140} rounded />
        </Animated.View>

        {/* Title */}
        <Text style={[styles.title, { color: titleColor }]}>
          NALISS UMYU HUB
        </Text>

        {/* Dynamic Tagline / Slogan with Fade-in */}
        <Animated.Text style={[styles.tagline, { color: taglineColor, opacity: taglineOpacity }]}>
          Information is Light
        </Animated.Text>

        {/* Optional Sub-message */}
        {message && (
          <Text style={[styles.submessage, { color: subtitleColor }]}>
            {message}
          </Text>
        )}

        {/* Dot Loaders */}
        <View style={styles.dotsRow}>
          {[dot1, dot2, dot3].map((dot, i) => (
            <Animated.View
              key={i}
              style={[
                styles.dot,
                {
                  backgroundColor: isDark ? '#34d399' : COLORS.primary,
                  opacity: dot,
                },
              ]}
            />
          ))}
        </View>
      </Animated.View>

      <View style={[styles.footer, { bottom: Math.max(insets.bottom + 16, 40) }]}>
        <Text style={[styles.copyright, { color: isDark ? 'rgba(255,255,255,0.25)' : '#94a3b8' }]}>
          UMYU CHAPTER â€¢ Â© 2026
        </Text>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  title: {
    fontSize: 22,
    fontFamily: 'Inter-Bold',
    letterSpacing: 2,
    marginBottom: 4,
    textAlign: 'center',
  },
  tagline: {
    fontSize: 13,
    fontFamily: 'Inter-SemiBold',
    letterSpacing: 3,
    textTransform: 'uppercase',
    marginBottom: 20,
    textAlign: 'center',
  },
  submessage: {
    fontSize: 12,
    fontFamily: 'Inter-Medium',
    marginBottom: 24,
    textAlign: 'center',
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  footer: {
    position: 'absolute',
    bottom: 40,
    alignItems: 'center',
  },
  copyright: {
    fontSize: 10,
    fontFamily: 'Inter-Medium',
    letterSpacing: 1.5,
  },
});
