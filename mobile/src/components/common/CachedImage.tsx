import React, { useEffect, useState } from 'react';
import { Image, ImageStyle, StyleProp, View, ActivityIndicator, TouchableOpacity, Alert, Text } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { getAssetCache, upsertAssetCache } from '../../lib/database';
import { useThemeStore } from '../../stores/theme.store';
import { saveMediaToDevice } from '../../utils/mediaSaver';
import { showToast } from './overlays';
import { Ionicons } from '@expo/vector-icons';

interface CachedImageProps {
    entityId: string;
    remoteUrl: string | null | undefined;
    assetType: 'user' | 'executive' | 'lecturer' | 'gallery' | 'gallery_cover';
    style?: StyleProp<ImageStyle>;
    resizeMode?: 'cover' | 'contain' | 'stretch' | 'repeat' | 'center';
    fallbackName?: string | null;
    fallbackInitials?: string | null;
}

export function CachedImage({ entityId, remoteUrl, assetType, style, resizeMode = 'cover', fallbackName, fallbackInitials }: CachedImageProps) {
    const [localUri, setLocalUri] = useState<string | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [hasError, setHasError] = useState<boolean>(false);
    const { colors, isDark } = useThemeStore();

    const handleLongPress = async () => {
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
                        if (isMounted) {
                            setLocalUri(cached.local_path);
                            setLoading(false);
                        }
                        return;
                    }
                }

                // 2.5. If the provided remoteUrl is already a local file path, skip downloading
                if (remoteUrl.startsWith('file://')) {
                    if (isMounted) {
                        setLocalUri(remoteUrl);
                        setLoading(false);
                    }
                    return;
                }

                // 3. Download if not found or URL changed
                // Fix: Unique, stable filename layout preventing disk clutter
                const filename = `${assetType}_${entityId}.jpg`;
                const fileUri = `${FileSystem.documentDirectory}${filename}`;
                
                const result = await FileSystem.downloadAsync(remoteUrl, fileUri);
                
                if (result.status === 200) {
                    // 4. Save to SQLite
                    await upsertAssetCache(entityId, remoteUrl, result.uri, assetType);
                    
                    if (isMounted) {
                        setLocalUri(result.uri);
                    }
                }
            } catch (err) {
                console.error('Failed to load cached image:', err);
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
        return (
            <TouchableOpacity
                style={[style, { backgroundColor: isDark ? '#1e293b' : '#e2e8f0', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }]}
                onLongPress={handleLongPress}
                activeOpacity={0.9}
            >
                {initials ? (
                    <Text style={{ fontSize: Math.min((style as any)?.width || 48, 48) * 0.4, fontWeight: '700', color: isDark ? '#64748b' : '#94a3b8' }}>
                        {initials}
                    </Text>
                ) : (
                    <Ionicons name="person" size={Math.min((style as any)?.width || 48, 48) * 0.5} color={isDark ? '#475569' : '#94a3b8'} />
                )}
            </TouchableOpacity>
        );
    }

    return (
        <TouchableOpacity 
            style={[style, { overflow: 'hidden' }]} 
            onLongPress={handleLongPress}
            activeOpacity={0.9}
        >
            <Image
                source={{ uri: localUri || remoteUrl! }}
                style={{ width: '100%', height: '100%' }}
                resizeMode={resizeMode}
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
