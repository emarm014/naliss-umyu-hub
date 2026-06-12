import React, { useState, useEffect, useRef } from 'react';
import { Image, ImageProps, View, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Network from 'expo-network';
import { registerOnlineCallback } from '../stores/network.store';

interface CachedImageProps extends Omit<ImageProps, 'source'> {
    source: { uri: string } | number | any;
    cacheKey?: string;
    fallbackImage?: any;
    showLoader?: boolean;
}

const cacheDirectory = `${FileSystem.documentDirectory}image_vault/`;
let isDirChecked = false;

const ensureDirExists = async () => {
    if (isDirChecked) return;
    try {
        const info = await FileSystem.getInfoAsync(cacheDirectory);
        if (!info.exists) {
            await FileSystem.makeDirectoryAsync(cacheDirectory, { intermediates: true });
        }
        isDirChecked = true;
    } catch (e) {
        console.warn('Failed to ensure cache dir', e);
    }
};

const generateHash = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(36) + str.length.toString();
};

// Supabase URL Optimization Interceptor
const getOptimizedUrl = (url: string) => {
    if (!url.includes('/storage/v1/object/public/')) return url;
    
    try {
        const urlObj = new URL(url);
        // Force compression arguments via URL params
        if (!urlObj.searchParams.has('width')) urlObj.searchParams.set('width', '800');
        if (!urlObj.searchParams.has('quality')) urlObj.searchParams.set('quality', '75');
        if (!urlObj.searchParams.has('format')) urlObj.searchParams.set('format', 'webp');
        
        // Supabase requires '/render/image/public/' endpoint for image transformations
        if (urlObj.pathname.includes('/object/public/')) {
            urlObj.pathname = urlObj.pathname.replace('/object/public/', '/render/image/public/');
        }
        return urlObj.toString();
    } catch {
        return url;
    }
};

// High-Performance Singleton Throttling Queue
class ImageDownloadQueue {
    private activeCount = 0;
    private maxConcurrent = 4;
    private queue: { uri: string; localUri: string; resolve: (status: number) => void; reject: (err: any) => void }[] = [];

    enqueue(uri: string, localUri: string): Promise<number> {
        return new Promise((resolve, reject) => {
            this.queue.push({ uri, localUri, resolve, reject });
            this.processQueue();
        });
    }

    private async processQueue() {
        if (this.activeCount >= this.maxConcurrent || this.queue.length === 0) return;

        const task = this.queue.shift();
        if (!task) return;

        this.activeCount++;
        try {
            const result = await FileSystem.downloadAsync(task.uri, task.localUri);
            if (result.status !== 200) {
                // Defensive File Deletion: Silently scrap HTTP 429 / 503 error payloads
                await FileSystem.deleteAsync(task.localUri, { idempotent: true });
            }
            task.resolve(result.status);
        } catch (err) {
            task.reject(err);
        } finally {
            this.activeCount--;
            this.processQueue();
        }
    }
}
const downloadQueue = new ImageDownloadQueue();

export const CachedImage: React.FC<CachedImageProps> = ({ source, cacheKey, fallbackImage, showLoader = false, style, ...props }) => {
    const [imgSource, setImgSource] = useState<any>(null);
    const [failed, setFailed] = useState(false);
    const isMounted = useRef(true);

    const checkAndLoadImage = async () => {
        if (typeof source !== 'object' || !source?.uri || !source.uri.startsWith('http')) {
            if (isMounted.current) setImgSource(source);
            return;
        }

        const optimizedUri = getOptimizedUrl(source.uri);
        const extMatch = optimizedUri.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i);
        const ext = extMatch ? extMatch[1] : 'webp';
        const uniqueKey = cacheKey || generateHash(optimizedUri);
        const localUri = `${cacheDirectory}${uniqueKey}.${ext}`;

        try {
            await ensureDirExists();
            
            // 1. IF Local File Exists: Immediately render local path
            const info = await FileSystem.getInfoAsync(localUri);
            if (info.exists && (info as any).size > 0) { // Protect against 0-byte corrupt files
                if (isMounted.current) {
                    setImgSource({ uri: `file://${localUri}` });
                    setFailed(false);
                }
                return;
            }

            // 2. IF Local File Does Not Exist
            const netInfo = await Network.getNetworkStateAsync();
            if (netInfo.isConnected && netInfo.isInternetReachable !== false) {
                // Online: Render remote immediately
                if (isMounted.current) {
                    setImgSource({ uri: optimizedUri });
                }
                
                // Enqueue background download via singleton throttle
                downloadQueue.enqueue(optimizedUri, localUri).catch(() => {});
            } else {
                // Offline/Weak Connection without cache
                if (isMounted.current) {
                    setFailed(true);
                    if (fallbackImage) {
                        setImgSource(fallbackImage);
                    } else {
                        setImgSource({ uri: optimizedUri });
                    }
                }
            }
        } catch (err) {
            if (isMounted.current) {
                setFailed(true);
                setImgSource(fallbackImage || { uri: optimizedUri });
            }
        }
    };

    useEffect(() => {
        isMounted.current = true;
        checkAndLoadImage();
        return () => {
            isMounted.current = false;
        };
    }, [source?.uri, cacheKey]);

    // Background Network Sync Synchronization
    useEffect(() => {
        if (failed && source?.uri?.startsWith('http')) {
            const unsubscribe = registerOnlineCallback(() => {
                if (isMounted.current) {
                    const optimizedUri = getOptimizedUrl(source.uri);
                    const extMatch = optimizedUri.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i);
                    const ext = extMatch ? extMatch[1] : 'webp';
                    const uniqueKey = cacheKey || generateHash(optimizedUri);
                    const localUri = `${cacheDirectory}${uniqueKey}.${ext}`;

                    // Enqueue background sync via throttle queue
                    downloadQueue.enqueue(optimizedUri, localUri)
                        .then((status) => {
                            if (status === 200 && isMounted.current) {
                                setImgSource({ uri: `file://${localUri}` });
                                setFailed(false);
                            }
                        })
                        .catch(() => {});
                }
            });
            return () => unsubscribe();
        }
    }, [failed, source?.uri, cacheKey]);

    if (!imgSource && !failed && showLoader) {
        return (
            <View style={[style, styles.placeholder]}>
                <ActivityIndicator color="#005A36" size="small" />
            </View>
        );
    }

    if (!imgSource) {
        return <View style={[style, styles.placeholder]} />;
    }

    return (
        <Image 
            source={imgSource} 
            style={style} 
            fadeDuration={0} // Eliminated memory leak crossfades
            resizeMethod={Platform.OS === 'android' ? 'resize' : 'auto'} // Downsamples bitmap to native bounds
            {...props} 
        />
    );
};

const styles = StyleSheet.create({
    placeholder: {
        backgroundColor: '#e2e8f0',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    }
});
