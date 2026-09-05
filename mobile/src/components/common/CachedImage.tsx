import React, { useEffect, useState } from 'react';
import { Image, ImageStyle, StyleProp, View, ActivityIndicator, TouchableOpacity, Alert, Text } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { getAssetCache, upsertAssetCache } from '../../lib/database';
import { useThemeStore } from '../../stores/theme.store';
import { saveMediaToDevice } from '../../utils/mediaSaver';
import { showToast } from './overlays';
import { Ionicons } from '@expo/vector-icons';
import { useNetworkStore } from '../../stores/network.store';

import { getSyncItem, setSyncItem } from '../../stores/mmkv.storage';

// In-Memory Fast Cache to prevent UI flashing and 'half a second disappear' effect
// Loaded synchronously from MMKV on boot
let globalMemoryCache: Record<string, string> = {};
try {
    const cached = getSyncItem('global_image_cache');
    if (cached) {
        globalMemoryCache = JSON.parse(cached);
    }
} catch (e) {}

const saveGlobalCache = () => {
  setSyncItem('global_image_cache', JSON.stringify(globalMemoryCache));
};

export type AssetType = 'user' | 'executive' | 'lecturer' | 'gallery' | 'gallery_cover' | 'avatar' | 'chat_media' | 'fyb_poster' | 'announcement_cover' | 'news_image' | (string & {});

interface CachedImageProps {
    entityId: string;
    remoteUrl: string | null | undefined;
    assetType: AssetType;
    style?: StyleProp<ImageStyle>;
    resizeMode?: 'cover' | 'contain' | 'stretch' | 'repeat' | 'center';
    fallbackName?: string | null;
    fallbackInitials?: string | null;
    blurRadius?: number;
    onPress?: (uri?: string) => void;
    onLongPress?: () => void;
}

export function CachedImage({ entityId, remoteUrl, assetType, style, resizeMode = 'cover', fallbackName, fallbackInitials, blurRadius, onPress, onLongPress }: CachedImageProps) {
    // Initialize synchronously if the file is already cached in memory or is a local file
    const isLocalFile = remoteUrl && !remoteUrl.startsWith('http://') && !remoteUrl.startsWith('https://');
    let preCachedUri = isLocalFile ? (remoteUrl.startsWith('file://') ? remoteUrl : `file://${remoteUrl}`) : null;
    
    if (!preCachedUri && entityId && globalMemoryCache[entityId]) {
        try {
            const parsed = JSON.parse(globalMemoryCache[entityId]);
            if (parsed.url === remoteUrl) {
                preCachedUri = parsed.path;
            }
        } catch (e) {
            // Legacy cache (just a string path). Migrate it by clearing it so SQLite takes over.
            const legacyPath = globalMemoryCache[entityId];
            if (typeof legacyPath === 'string') {
                delete globalMemoryCache[entityId];
                saveGlobalCache();
            }
        }
    }
    
    const [localUri, setLocalUri] = useState<string | null>(preCachedUri);
    const [loading, setLoading] = useState<boolean>(!preCachedUri);
    const [hasError, setHasError] = useState<boolean>(false);
    const [retryCount, setRetryCount] = useState<number>(0);
    const { colors, isDark } = useThemeStore();

    const handleLongPress = async () => {
        if (onLongPress) {
            onLongPress();
            return;
        }

        const uriToSave = localUri || remoteUrl;
        if (!uriToSave) return;
        const result = await saveMediaToDevice(uriToSave, 'image');
        if (result.success) {
            showToast('✓ Saved to Device');
        } else {
            Alert.alert('Save Failed', result.error || 'Could not save the image to your device.');
        }
    };

    useEffect(() => {
        let isMounted = true;
        setHasError(false);
        
        // If it's already solved via memory cache, and we haven't failed yet, do not show loaders or run async SQLite queries
        if (preCachedUri && retryCount === 0) {
            return;
        }

        const loadAsset = async () => {
            if (!entityId || !remoteUrl) {
                if (isMounted) {
                    setLoading(false);
                }
                return;
            }

            try {
                // 1. Check SQLite for existing cache
                const cached = await getAssetCache(entityId);
                
                if (cached?.local_path && cached.remote_url === remoteUrl) {
                    // 2. Verify file exists
                    const fileInfo = await FileSystem.getInfoAsync(cached.local_path);
                    if (fileInfo.exists && (fileInfo as any).size > 0) {
                        if (retryCount > 0) {
                            // File exists but failed to render (corrupt). Delete it to force re-download.
                            try { await FileSystem.deleteAsync(cached.local_path, { idempotent: true }); } catch (e) {}
                        } else {
                            globalMemoryCache[entityId] = JSON.stringify({ url: remoteUrl, path: cached.local_path });
                            saveGlobalCache();
                            if (isMounted) {
                                setLocalUri(cached.local_path);
                                setHasError(false); // ← CRITICAL: reset error so cached image can render
                                setLoading(false);
                            }
                            return;
                        }
                    }
                }

                // 2.5. If the provided remoteUrl is already a local file path or non-http URI, skip downloading
                if (!remoteUrl.startsWith('http://') && !remoteUrl.startsWith('https://')) {
                    if (isMounted) {
                        setLocalUri(remoteUrl.startsWith('file://') ? remoteUrl : `file://${remoteUrl}`);
                        setHasError(false);
                        setLoading(false);
                    }
                    return;
                }

                // 3. If offline, don't attempt download — let the UI fall back to remoteUrl
                if (!useNetworkStore.getState().isOnline) {
                    if (isMounted) {
                        setLocalUri(null); // Force remote URL fallback
                        // Don't set hasError yet, let Image.onError handle it
                        setLoading(false);
                    }
                    return;
                }

                // 4. Download if not found or URL changed (online only)
                // Use a short hash of the remoteUrl to ensure the filename changes when the avatar updates,
                // forcing React Native to render the new image.
                const urlHash = remoteUrl.split('/').pop()?.replace(/[^a-zA-Z0-9]/g, '').slice(-10) || Date.now().toString();
                const filename = `${assetType}_${entityId}_${urlHash}.jpg`;
                const fileUri = `${FileSystem.documentDirectory}${filename}`;
                const tempUri = `${FileSystem.documentDirectory}tmp_${Date.now()}_${filename}`;
                
                // Download to a temp file first (Atomic Swap)
                const result = await FileSystem.downloadAsync(remoteUrl, tempUri);
                
                if (result.status === 200) {
                    const info = await FileSystem.getInfoAsync(tempUri);
                    if (info.exists && (info as any).size > 0) {
                        // Clean up the old file if it exists and is different
                        if (cached?.local_path && cached.local_path !== fileUri) {
                            try { await FileSystem.deleteAsync(cached.local_path, { idempotent: true }); } catch (e) {}
                        }
                        // Move temp file to final destination
                        await FileSystem.moveAsync({ from: tempUri, to: fileUri });

                        // 5. Save to SQLite
                        await upsertAssetCache(entityId, remoteUrl, fileUri, assetType);
                        
                        globalMemoryCache[entityId] = JSON.stringify({ url: remoteUrl, path: fileUri });
                        saveGlobalCache();
                        if (isMounted) {
                            setLocalUri(fileUri);
                            setHasError(false);
                        }
                    } else {
                        // Download succeeded but file is empty/invalid
                        try { await FileSystem.deleteAsync(tempUri, { idempotent: true }); } catch (e) {}
                        if (isMounted) setLocalUri(null); // Fallback to remote URL
                    }
                } else {
                    // Download failed (e.g. 404, offline midway)
                    if (isMounted) setLocalUri(null); // Fallback to remote URL
                }
            } catch (err: any) {
                // Use debug-level logging to avoid flooding Sentry breadcrumbs when offline
                const isNet = err?.message?.includes('Network') || err?.message?.includes('Unable to resolve host');
                if (!isNet) {
                    console.warn('[CachedImage] Failed to load image:', err);
                }
                if (isMounted) setLocalUri(null); // Fallback to remote URL
            } finally {
                if (isMounted) {
                    setLoading(false);
                }
            }
        };

        loadAsset();

        return () => {
            isMounted = false;
        };
    }, [entityId, remoteUrl, assetType, retryCount]);

    const initials = fallbackInitials || (fallbackName ? fallbackName.slice(0, 2).toUpperCase() : null);

    const hasTouchHandler = !!onPress || !!onLongPress;
    const TouchWrapper = hasTouchHandler ? TouchableOpacity : (View as any);
    const touchProps = hasTouchHandler ? {
        activeOpacity: 0.9,
        onPress: () => { if (onPress) { onPress(localUri || undefined); } },
        onLongPress: handleLongPress,
    } : {};

    // OFFLINE-SAFE RENDER: If we have a localUri, ALWAYS use it — even if hasError was set
    // by a previous failed network attempt. localUri from SQLite cache is authoritative.
    if (localUri) {
        return (
            <TouchWrapper 
                style={[style, { overflow: 'hidden' }]} 
                {...touchProps}
            >
                <Image
                    source={{ uri: localUri }}
                    style={{ width: '100%', height: '100%' }}
                    resizeMode={resizeMode}
                    blurRadius={blurRadius}
                    onLoad={() => { setLoading(false); setHasError(false); }}
                    onError={() => { 
                        if (retryCount === 0) {
                            // Local file is corrupt or missing from new device — clear cache and retry
                            if (entityId && globalMemoryCache[entityId]) {
                                delete globalMemoryCache[entityId];
                                saveGlobalCache();
                            }
                            setLocalUri(null); 
                            setLoading(true); 
                            setHasError(false); 
                            setRetryCount(1); // Trigger useEffect to re-download
                        } else {
                            setLocalUri(null); 
                            setLoading(false); 
                            setHasError(true); 
                        }
                    }}
                />
                {loading && (
                    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', backgroundColor: isDark ? 'rgba(15,23,42,0.5)' : 'rgba(241,245,249,0.5)' }}>
                        <ActivityIndicator color="#059669" size="small" />
                    </View>
                )}
            </TouchWrapper>
        );
    }

    if (!remoteUrl || hasError) {
        let fallbackIcon = "person";
        if (assetType === 'announcement_cover') fallbackIcon = "megaphone-outline";
        else if (assetType === 'event_cover') fallbackIcon = "calendar-outline";
        else if (assetType === 'group_avatar') fallbackIcon = "people";
        else if (assetType !== 'user' && assetType !== 'user_avatar') fallbackIcon = "image-outline";

        return (
            <TouchWrapper
                style={[style, { backgroundColor: isDark ? '#1e293b' : '#e2e8f0', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }]}
                {...touchProps}
            >
                {initials ? (
                    <Text style={{ fontSize: Math.min((style as any)?.width || 48, 48) * 0.4, fontWeight: '700', color: isDark ? '#64748b' : '#94a3b8' }}>
                        {initials}
                    </Text>
                ) : (
                    <Ionicons name={fallbackIcon as any} size={Math.min((style as any)?.width || 48, 48) * 0.5} color={isDark ? '#475569' : '#94a3b8'} />
                )}
            </TouchWrapper>
        );
    }

    // Only reach here when localUri is null AND remoteUrl exists AND no error yet
    // This means we're still loading from cache or network
    return (
        <TouchWrapper 
            style={[style, { overflow: 'hidden' }]} 
            {...touchProps}
        >
            <Image
                source={{ uri: remoteUrl }}
                style={{ width: '100%', height: '100%' }}
                resizeMode={resizeMode}
                blurRadius={blurRadius}
                onLoad={() => { setLoading(false); setHasError(false); }}
                onError={() => { setLoading(false); setHasError(true); }}
            />
            {loading && (
                <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', backgroundColor: isDark ? 'rgba(15,23,42,0.5)' : 'rgba(241,245,249,0.5)' }}>
                    <ActivityIndicator color="#059669" size="small" />
                </View>
            )}
        </TouchWrapper>
    );
}
