import React, { useState, useEffect, useCallback } from 'react';
import { StyleSheet, View, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNetworkStore } from '../stores/network.store';

interface PosterImageProps {
  uri: string | null | undefined;
  fallbackUri?: string;
  style?: any;
  gradientColors: [string, string];
}

export function PosterImage({
  uri,
  fallbackUri,
  style,
  gradientColors,
}: PosterImageProps) {
  const isOnline = useNetworkStore((s) => s.isOnline);
  const targetUri = uri || fallbackUri || '';

  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>(
    targetUri ? 'loading' : 'error'
  );
  const [retryKey, setRetryKey] = useState(0);
  const [currentUri, setCurrentUri] = useState(targetUri);

  // Sync state if URI props change
  useEffect(() => {
    const next = uri || fallbackUri || '';
    if (next !== currentUri) {
      setCurrentUri(next);
      setStatus(next ? 'loading' : 'error');
    }
  }, [uri, fallbackUri, currentUri]);

  // Offline or error handler
  const handleError = useCallback(() => {
    if (currentUri !== fallbackUri && fallbackUri) {
      setCurrentUri(fallbackUri);
      setStatus('loading');
    } else {
      setStatus('error');
    }
  }, [currentUri, fallbackUri]);

  // Handle auto-retries when coming back online or if a temporary glitch happens
  useEffect(() => {
    if (status !== 'error') return;
    // Don't retry if offline
    if (!isOnline) return;

    const t = setTimeout(() => {
      setStatus('loading');
      setRetryKey((k) => k + 1);
    }, 5000); // 5 seconds interval
    return () => clearTimeout(t);
  }, [status, isOnline]);

  return (
    <View style={[style, styles.container]}>
      {/* 1. Underlying Placeholder Gradient (Always rendered) */}
      <LinearGradient
        colors={gradientColors}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />

      {/* 2. Shimmer overlay while loading */}
      {status === 'loading' && (
        <View style={[StyleSheet.absoluteFill, styles.shimmer]} />
      )}

      {/* 3. Actual Image */}
      {currentUri ? (
        <Image
          key={`${currentUri}-${retryKey}`}
          source={{ uri: currentUri, cache: 'force-cache' }}
          style={[StyleSheet.absoluteFill, { opacity: status === 'loaded' ? 1 : 0 }]}
          resizeMode="cover"
          onLoad={() => setStatus('loaded')}
          onError={handleError}
          fadeDuration={200}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  shimmer: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
});
