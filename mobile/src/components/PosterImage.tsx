import React, { useState, useEffect, useCallback } from 'react';
import { StyleSheet, View, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNetworkStore } from '../stores/network.store';
import * as FileSystem from 'expo-file-system/legacy';
import { getAssetCache, upsertAssetCache } from '../lib/database';

interface PosterImageProps {
  uri: string | null | undefined;
  fallbackUri?: string;
  style?: any;
  gradientColors: [string, string];
}

const globalPosterMemoryCache: Record<string, string> = {};

const generateEntityId = (url: string) => {
    return 'poster_' + url.replace(/[^a-zA-Z0-9]/g, '_').slice(-60);
};

export function PosterImage({
  uri,
  fallbackUri,
  style,
  gradientColors,
}: PosterImageProps) {
  const isOnline = useNetworkStore((s) => s.isOnline);
  const targetUri = uri || fallbackUri || '';
  
  const entityId = targetUri ? generateEntityId(targetUri) : '';
  const preCachedUri = entityId ? globalPosterMemoryCache[entityId] : null;

  const [localUri, setLocalUri] = useState<string | null>(preCachedUri);
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>(
    preCachedUri ? 'loaded' : (targetUri ? 'loading' : 'error')
  );

  useEffect(() => {
    let isMounted = true;

    if (!targetUri) {
      if (isMounted) setStatus('error');
      return;
    }

    if (preCachedUri) {
      return;
    }

    const loadAsset = async () => {
        try {
            // 1. Check SQLite
            const cached = await getAssetCache(entityId);
            if (cached?.local_path && cached.remote_url === targetUri) {
                const fileInfo = await FileSystem.getInfoAsync(cached.local_path);
                if (fileInfo.exists) {
                    globalPosterMemoryCache[entityId] = cached.local_path;
                    if (isMounted) {
                        setLocalUri(cached.local_path);
                        setStatus('loaded');
                    }
                    return;
                }
            }

            // 2. Skip download if it's already a local file
            if (!targetUri.startsWith('http://') && !targetUri.startsWith('https://')) {
                const local = targetUri.startsWith('file://') ? targetUri : `file://${targetUri}`;
                if (isMounted) {
                    setLocalUri(local);
                    setStatus('loaded');
                }
                return;
            }

            // 3. Download from network
            const fileUri = `${FileSystem.documentDirectory}${entityId}.jpg`;
            const result = await FileSystem.downloadAsync(targetUri, fileUri);
            
            if (result.status === 200) {
                await upsertAssetCache(entityId, targetUri, result.uri, 'poster');
                globalPosterMemoryCache[entityId] = result.uri;
                if (isMounted) {
                    setLocalUri(result.uri);
                    setStatus('loaded');
                }
            } else {
                if (isMounted) setStatus('error');
            }
        } catch (err) {
            console.warn('[PosterImage] Failed to load poster:', err);
            if (isMounted) setStatus('error');
        }
    };

    loadAsset();

    return () => {
        isMounted = false;
    };
  }, [targetUri, entityId, preCachedUri]);

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
      {(localUri || targetUri) ? (
        <Image
          source={{ uri: localUri || targetUri }}
          style={[StyleSheet.absoluteFill, { opacity: status === 'loaded' ? 1 : 0 }]}
          resizeMode="cover"
          onLoad={() => setStatus('loaded')}
          onError={() => {
              if (!localUri) setStatus('error');
          }}
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
