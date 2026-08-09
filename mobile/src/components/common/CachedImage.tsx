import React, { useEffect, useState } from 'react';
import { Image, ImageStyle, StyleProp, View, ActivityIndicator, TouchableOpacity, Alert, Text } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { getAssetCache, upsertAssetCache } from '../../lib/database';
import { useThemeStore } from '../../stores/theme.store';
import { saveMediaToDevice } from '../../utils/mediaSaver';
import { showToast } from './overlays';
import { Ionicons } from '@expo/vector-icons';

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
    try {
        setSyncItem('global_image_cache', JSON.stringify(globalMemoryCache));
    } catch (e) {}
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
    onPress?: (localUri: string | null) => void;
}

export function CachedImage({ entityId, remoteUrl, assetType, style, resizeMode = 'cover', fallbackName, fallbackInitials, blurRadius, onPress }: CachedImageProps) {
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
            // Legacy cache (just a string path). We must miss the cache so SQLite can verify the URL.
        }
    }
    
    const [localUri, setLocalUri] = useState<string | null>(preCachedUri);
    const [loading, setLoading] = useState<boolean>(!preCachedUri);
    const [hasError, setHasError] = useState<boolean>(false);
    const { colors, isDark } = useThemeStore();

    const handleLongPress = async () => {
        const uriToSave = localUri || remoteUrl;
        if (!uriToSave) return;
        const result = await saveMediaToDevice(uriToSave, 'image');
        if (result.success) {
            showToast('âœ“ Saved to Device');
        } else {
            Alert.alert('Save Failed', result.error || 'Could not save the image to your device.');
        }
    };

    useEffect(() => {
        let isMounted = true;
        setHasError(false);
        
        // If it's already solved via memory cache, do not show loaders or run async SQLite queries
        if (preCachedUri) {
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
                    if (fileInfo.exists) {
                        globalMemoryCache[entityId] = JSON.stringify({ url: remoteUrl, path: cached.local_path });
                        saveGlobalCache();
                        if (isMounted) {
                            setLocalUri(cached.local_path);
                            setLoading(false);
                        }
                        return;
                    }
                }

                // 2.5. If the provided remoteUrl is already a local file path or non-http URI, skip downloading
                if (!remoteUrl.startsWith('http://') && !remoteUrl.startsWith('https://')) {
                    if (isMounted) {
                        setLocalUri(remoteUrl.startsWith('file://') ? remoteUrl : `file://${remoteUrl}`);
                        setLoading(false);
                    }
                    return;
                }

                // 3. Download if not found or URL changed
                // Use a short hash of the remoteUrl to ensure the filename changes when the avatar updates,
                // forcing React Native to render the new image.
                const urlHash = remoteUrl.split('/').pop()?.replace(/[^a-zA-Z0-9]/g, '').slice(-10) || Date.now().toString();
                const filename = `${assetType}_${entityId}_${urlHash}.jpg`;
                const fileUri = `${FileSystem.documentDirectory}${filename}`;
                
                // Clean up the old file if it exists and is different to prevent disk clutter
                if (cached?.local_path && cached.local_path !== fileUri) {
                    try { await FileSystem.deleteAsync(cached.local_path, { idempotent: true }); } catch (e) {}
                }

                const result = await FileSystem.downloadAsync(remoteUrl, fileUri);
                
                if (result.status === 200) {
                    // 4. Save to SQLite
                    await upsertAssetCache(entityId, remoteUrl, result.uri, assetType);
                    
                    globalMemoryCache[entityId] = JSON.stringify({ url: remoteUrl, path: result.uri });
                    saveGlobalCache();
                    if (isMounted) {
                        setLocalUri(result.uri);
                    }
                }
            } catch (err: any) {
                // Use debug-level logging to avoid flooding Sentry breadcrumbs when offline
                const isNet = err?.message?.includes('Network') || err?.message?.includes('Unable to resolve host');
                if (!isNet) {
                    console.warn('[CachedImage] Failed to load image:', err);
                }
                if (isMounted) setHasError(true);
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
    }, [entityId, remoteUrl, assetType]);

    const initials = fallbackInitials || (fallbackName ? fallbackName.slice(0, 2).toUpperCase() : null);

    if ((!localUri && !remoteUrl) || hasError) {
        let fallbackIcon = "person";
        if (assetType === 'announcement_cover') fallbackIcon = "megaphone-outline";
        else if (assetType === 'event_cover') fallbackIcon = "calendar-outline";
        else if (assetType === 'group_avatar') fallbackIcon = "people";
        else if (assetType !== 'user' && assetType !== 'user_avatar') fallbackIcon = "image-outline";

        return (
            <TouchableOpacity
                style={[style, { backgroundColor: isDark ? '#1e293b' : '#e2e8f0', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }]}
                onLongPress={handleLongPress}
                onPress={() => onPress?.(localUri)}
                activeOpacity={0.9}
            >
                {initials ? (
                    <Text style={{ fontSize: Math.min((style as any)?.width || 48, 48) * 0.4, fontWeight: '700', color: isDark ? '#64748b' : '#94a3b8' }}>
                        {initials}
                    </Text>
                ) : (
                    <Ionicons name={fallbackIcon as any} size={Math.min((style as any)?.width || 48, 48) * 0.5} color={isDark ? '#475569' : '#94a3b8'} />
                )}
            </TouchableOpacity>
        );
    }

    return (
        <TouchableOpacity 
            style={[style, { overflow: 'hidden' }]} 
            onLongPress={handleLongPress}
            onPress={() => onPress?.(localUri)}
            activeOpacity={0.9}
        >
            <Image
                source={{ uri: localUri || remoteUrl! }}
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
        </TouchableOpacity>
    );
}
