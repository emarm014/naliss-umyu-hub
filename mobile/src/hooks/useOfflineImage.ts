import { useEffect, useState, useRef } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import { mmkvStorage } from '../stores/mmkv.storage';

// Dedicated cache subdirectory inside the app's document directory
const getCacheBase = (): string => {
    const fs = FileSystem as any;
    const docDir: string =
        fs.Paths?.document?.uri ||
        fs.documentDirectory ||
        fs.cacheDirectory ||
        '';
    const base = docDir.endsWith('/') ? docDir : `${docDir}/`;
    return `${base}avatar_cache/`;
};

const AVATAR_CACHE_DIR = getCacheBase();
const MMKV_CACHE_MAP_KEY = 'avatar-offline-cache-map';

/**
 * Deterministic, filesystem-safe hash from a URL string.
 * Uses a simple but effective DJB2-style hash to avoid collisions while
 * keeping filenames short and clean.
 */
const urlToFilename = (url: string): string => {
    let hash = 5381;
    for (let i = 0; i < url.length; i++) {
        hash = ((hash << 5) + hash + url.charCodeAt(i)) >>> 0;
    }
    // Extract extension from URL (jpg, png, webp) or default to jpg
    const extMatch = url.match(/\.(jpg|jpeg|png|webp|gif)(\?|$)/i);
    const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
    return `avatar_${hash.toString(16)}.${ext}`;
};

/**
 * Read the MMKV-backed URLâ†’localPath mapping.
 */
const getCacheMap = (): Record<string, string> => {
    try {
        const raw = mmkvStorage.getItem(MMKV_CACHE_MAP_KEY);
        if (typeof raw === 'string') return JSON.parse(raw);
    } catch { /* corrupt data â€” reset */ }
    return {};
};

const setCacheMap = (map: Record<string, string>) => {
    mmkvStorage.setItem(MMKV_CACHE_MAP_KEY, JSON.stringify(map));
};

/**
 * Ensure the avatar cache directory exists (one-shot per app session).
 */
let dirCreated = false;
const ensureCacheDir = async () => {
    if (dirCreated) return;
    try {
        const info = await FileSystem.getInfoAsync(AVATAR_CACHE_DIR);
        if (!info.exists) {
            await FileSystem.makeDirectoryAsync(AVATAR_CACHE_DIR, { intermediates: true });
        }
        dirCreated = true;
    } catch {
        // Retry once
        try {
            await FileSystem.makeDirectoryAsync(AVATAR_CACHE_DIR, { intermediates: true });
            dirCreated = true;
        } catch { /* give up â€” fallback to remote */ }
    }
};

// In-flight download deduplication map (prevents parallel downloads for the same URL)
const inflightDownloads = new Map<string, Promise<string | null>>();

/**
 * Core function: resolve a remote image URL to a local cached URI.
 * Returns the local path if cached, otherwise downloads in the background
 * and returns the local path on success or the remote URL as fallback.
 */
export const getOfflineImageUri = async (remoteUrl: string): Promise<string> => {
    if (!remoteUrl || remoteUrl.trim() === '') return '';

    const filename = urlToFilename(remoteUrl);
    const localUri = `${AVATAR_CACHE_DIR}${filename}`;

    // 1. Fast path â€” check MMKV map first (zero I/O)
    const map = getCacheMap();
    if (map[remoteUrl]) {
        // Verify the file still exists on disk
        try {
            const info = await FileSystem.getInfoAsync(map[remoteUrl]);
            if (info.exists && (info as any).size > 0) {
                return map[remoteUrl];
            }
        } catch { /* file gone â€” re-download */ }
        // Stale entry â€” remove it
        delete map[remoteUrl];
        setCacheMap(map);
    }

    // 2. Check disk directly (in case MMKV was cleared but file persists)
    try {
        const info = await FileSystem.getInfoAsync(localUri);
        if (info.exists && (info as any).size > 0) {
            // Re-register in MMKV
            const freshMap = getCacheMap();
            freshMap[remoteUrl] = localUri;
            setCacheMap(freshMap);
            return localUri;
        }
    } catch { /* ignore */ }

    // 3. Download â€” deduplicate parallel requests for the same URL
    if (inflightDownloads.has(remoteUrl)) {
        const result = await inflightDownloads.get(remoteUrl);
        return result || remoteUrl;
    }

    const downloadPromise = (async (): Promise<string | null> => {
        try {
            if (!remoteUrl.startsWith('http://') && !remoteUrl.startsWith('https://')) {
                return remoteUrl.startsWith('file://') ? remoteUrl : `file://${remoteUrl}`;
            }
            await ensureCacheDir();
            const result = await FileSystem.downloadAsync(remoteUrl, localUri);
            if (!result?.uri) return null;

            // Validate download
            const fileInfo = await FileSystem.getInfoAsync(result.uri);
            if ((fileInfo as any).size === 0) {
                await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch((err) => console.error('[OfflineImage] delete zero-size file failed:', err));
                return null;
            }

            // Persist mapping
            const latestMap = getCacheMap();
            latestMap[remoteUrl] = result.uri;
            setCacheMap(latestMap);

            return result.uri;
        } catch {
            return null; // Network offline or download failed â€” caller gets remote URL
        } finally {
            inflightDownloads.delete(remoteUrl);
        }
    })();

    inflightDownloads.set(remoteUrl, downloadPromise);
    const downloaded = await downloadPromise;
    return downloaded || remoteUrl;
};

/**
 * React hook: resolves a remote avatar URL to a local cached URI.
 * Returns the best available source string (local or remote fallback).
 *
 * Usage:
 * ```tsx
 * const imgSource = useOfflineImage(remoteAvatarUrl);
 * <Image source={{ uri: imgSource }} />
 * ```
 */
export const useOfflineImage = (remoteUrl: string | null | undefined): string => {
    const [imgSource, setImgSource] = useState<string>(remoteUrl || '');
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    useEffect(() => {
        if (!remoteUrl) {
            setImgSource('');
            return;
        }

        // Start with the remote URL for instant display
        setImgSource(remoteUrl);

        // Then resolve to cached version in background
        getOfflineImageUri(remoteUrl).then((resolved) => {
            if (mountedRef.current && resolved) {
                setImgSource(resolved);
            }
        });
    }, [remoteUrl]);

    return imgSource;
};
