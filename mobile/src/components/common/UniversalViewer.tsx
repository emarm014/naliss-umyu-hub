import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Image,
  TouchableOpacity,
  Dimensions,
  Platform,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/Colors';
import { extractFileNameFromUrl, getVaultFilePath } from '../../utils/download';
import { Video, ResizeMode, Audio } from 'expo-av';
import { WebView } from 'react-native-webview';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import { BlurView } from 'expo-blur';

const { width, height } = Dimensions.get('window');

// expo-file-system SDK 55 uses Paths API; cast as any for backward compat
const getCacheBase = (): string => {
    const fs = FileSystem as any;
    const cacheDir: string =
        fs.Paths?.cache?.uri ||
        fs.cacheDirectory ||
        '';
    const base = cacheDir.endsWith('/') ? cacheDir : `${cacheDir}/`;
    return `${base}naliss_viewer/`;
};
const VIEWER_CACHE = getCacheBase();

// Remove fl_inline — causes HTTP 400 on Cloudinary raw files
function getCleanUrl(url: string): string {
  return url
    .replace('/raw/upload/fl_inline/', '/raw/upload/')
    .replace('/fl_inline/', '/');
}

// Apply correct Cloudinary resource type for PDFs/docs stored under /image/upload/
// Cloudinary stores PDFs under /image/upload/ but they must be served via /raw/upload/
// to get the actual file bytes instead of an image transformation error.
// NOTE: If the URL has no file extension (e.g. Cloudinary public_id without ext),
// we trust the resource type in the URL path (/image/upload/ = image, /raw/upload/ = raw).
function getViewerUrl(url: string): string {
  const clean = getCleanUrl(url);
  if (!clean.includes('cloudinary.com')) return clean;
  if (clean.includes('/raw/upload/')) return clean;
  if (clean.includes('/video/upload/')) return clean;
  if (clean.includes('/image/upload/')) {
    const lower = clean.toLowerCase();
    // Only convert to /raw/upload/ if there is an explicit non-image extension
    const hasNonImageExt = lower.match(/\.(pdf|doc|docx|ppt|pptx|xls|xlsx|txt|zip|rar|csv)(\?|$)/);
    if (hasNonImageExt) {
      return clean.replace('/image/upload/', '/raw/upload/');
    }
    // No extension or image extension — trust /image/upload/ as-is
    // (Cloudinary public IDs without extensions are images when under /image/upload/)
    return clean;
  }
  return clean;
}

// Get Cloudinary page image URL for Visual Scan Engine
function getCloudinaryPageUrl(url: string, page: number): string | null {
  const match = url.match(/res\.cloudinary\.com\/([^/]+)\/(?:raw|image)\/upload\/(?:v\d+\/)?(.+)$/);
  if (!match) return null;
  const [, cloud, path] = match;
  const pathNoExt = path.replace(/\.[^.]+$/, '');
  return `https://res.cloudinary.com/${cloud}/image/upload/pg_${page},w_1200,c_limit,f_jpg,q_auto:best/${pathNoExt}.jpg`;
}

interface UniversalViewerProps {
  isVisible: boolean;
  onClose: () => void;
  fileUri: string;           // remote Cloudinary URL
  fileType: 'image' | 'video' | 'pdf' | 'audio' | 'document';
  fileName: string;
  fileId?: string;           // material/past_question id — used to find vault file
  showDownload?: boolean;
}

/**
 * Universal In-App Viewer V3.0 — Full Offline Support
 *
 * For ALL media types:
 *  1. Check vault (naliss_vault/) — file was previously downloaded by user
 *  2. Check viewer cache (naliss_viewer/) — file was previously previewed
 *  3. Download to viewer cache if not found
 *  4. Render from local URI — works 100% offline after first open
 *
 * Rendering:
 *  - PDF/Document: iOS native WebView, Android base64 embed
 *  - Video: expo-av Video (local or remote)
 *  - Image: React Native Image (local or remote)
 *  - Audio: expo-av Audio with progress bar
 */
export const UniversalViewer: React.FC<UniversalViewerProps> = ({
  isVisible,
  onClose,
  fileUri,
  fileType,
  fileName,
  fileId,
  showDownload = true,
}) => {
  const [localUri, setLocalUri] = React.useState<string | null>(null);
  const [isDownloading, setIsDownloading] = React.useState(false);
  const [downloadProgress, setDownloadProgress] = React.useState(0);
  const [downloadError, setDownloadError] = React.useState<string | null>(null);
  const [isOffline, setIsOffline] = React.useState(false);
  const [retryKey, setRetryKey] = React.useState(0);
  const [pdfEngine, setPdfEngine] = React.useState<'native' | 'scan'>('native');

  // Resolve local URI for any file type
  React.useEffect(() => {
    if (!isVisible) return;

    // Already a local file — open instantly, no download needed
    if (fileUri.startsWith('file://')) {
      setLocalUri(fileUri);
      setIsOffline(true);
      setIsDownloading(false);
      return;
    }

    let cancelled = false;
    setIsDownloading(true);
    setDownloadError(null);
    setLocalUri(null);
    setDownloadProgress(0);

    const resolve = async () => {
      try {
        // 1. Check vault first (user explicitly downloaded it)
        if (fileId) {
          const vaultPath = getVaultFilePath(fileId, fileName);
          const vaultInfo = await FileSystem.getInfoAsync(vaultPath);
          if (vaultInfo.exists && (vaultInfo as any).size > 0) {
            if (!cancelled) {
              setLocalUri(vaultPath);
              setIsOffline(true);
              setIsDownloading(false);
            }
            return;
          }
        }

        // 2. Check viewer cache (previously previewed)
        const dirInfo = await FileSystem.getInfoAsync(VIEWER_CACHE);
        if (!dirInfo.exists) {
          await FileSystem.makeDirectoryAsync(VIEWER_CACHE, { intermediates: true });
        }

        // Use viewer URL (applies fl_attachment for non-image files)
        const viewerUrl = getViewerUrl(fileUri);
        const realName = extractFileNameFromUrl(viewerUrl, fileName);
        const safeName = realName.replace(/[^a-zA-Z0-9._-]/g, '_');
        const cachePath = `${VIEWER_CACHE}${safeName}`;

        const cacheInfo = await FileSystem.getInfoAsync(cachePath);
        // Only use cache if file exists AND has real content (size > 0 bytes)
        if (cacheInfo.exists && (cacheInfo as any).size > 0) {
          if (!cancelled) {
            setLocalUri(cachePath);
            setIsOffline(true);
            setIsDownloading(false);
          }
          return;
        }
        // Delete empty cached file before re-downloading
        if (cacheInfo.exists) {
          await FileSystem.deleteAsync(cachePath, { idempotent: true });
        }

        // 3. Download to viewer cache
        const downloadResumable = FileSystem.createDownloadResumable(
          viewerUrl,
          cachePath,
          {
            headers: {
              'Accept': '*/*',
              'User-Agent': 'NALISS-Hub/1.0',
            },
          },
          (progress) => {
            const pct = progress.totalBytesExpectedToWrite > 0
              ? Math.round((progress.totalBytesWritten / progress.totalBytesExpectedToWrite) * 100)
              : 0;
            if (!cancelled) setDownloadProgress(pct);
          }
        );

        const result = await downloadResumable.downloadAsync();
        if (!cancelled) {
          if (result && result.status === 200) {
            // File downloaded successfully — use it directly
            setLocalUri(result.uri);
            setIsOffline(false);
          } else {
            setDownloadError('Could not load file. Tap retry.');
          }
          setIsDownloading(false);
        }
      } catch {
        if (!cancelled) {
          setDownloadError('Could not load file. Tap retry.');
          setIsDownloading(false);
        }
      }
    };

    resolve();
    return () => { cancelled = true; };
  }, [isVisible, fileUri, fileType, fileName, fileId, retryKey]);

  // Reset when closed
  React.useEffect(() => {
    if (!isVisible) {
      setLocalUri(null);
      setIsDownloading(false);
      setDownloadError(null);
      setDownloadProgress(0);
      setIsOffline(false);
    }
  }, [isVisible]);

  if (!isVisible) return null;

  // Loading state
  const renderLoading = () => (
    <View style={styles.center}>
      <View style={styles.progressRing}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
      <Text style={styles.loadingText}>
        {downloadProgress > 0 ? `Loading... ${downloadProgress}%` : 'Preparing file...'}
      </Text>
      {downloadProgress > 0 && (
        <View style={styles.progressBarOuter}>
          <View style={[styles.progressBarInner, { width: `${downloadProgress}%` as any }]} />
        </View>
      )}
    </View>
  );

  // Error state
  const renderError = () => (
    <View style={styles.center}>
      <Ionicons name="alert-circle-outline" size={56} color="#ef4444" />
      <Text style={styles.errorText}>{downloadError}</Text>
      <TouchableOpacity
        style={styles.retryButton}
        onPress={() => {
          setDownloadError(null);
          setLocalUri(null);
          setIsDownloading(true);
          setDownloadProgress(0);
          setRetryKey(k => k + 1);
        }}
      >
        <Text style={styles.retryText}>Retry</Text>
      </TouchableOpacity>
    </View>
  );

  const renderContent = () => {
    if (isDownloading) return renderLoading();
    if (downloadError) return renderError();
    if (!localUri) return renderLoading();

    switch (fileType) {
      // ── IMAGE ──────────────────────────────────────────────────────────
      case 'image':
        return (
          <Image
            source={{ uri: localUri }}
            style={styles.image}
            resizeMode="contain"
            onError={() => setDownloadError('Image could not be displayed.')}
          />
        );

      // ── VIDEO ──────────────────────────────────────────────────────────
      case 'video':
        return <VideoPlayer localUri={localUri} remoteUrl={fileUri} />;

      // ── AUDIO ──────────────────────────────────────────────────────────
      case 'audio':
        return <AudioPlayer uri={localUri} fileName={fileName} />;

      // ── PDF / DOCUMENT ─────────────────────────────────────────────────
      case 'pdf':
      case 'document': {
        // PDF.js Canvas renderer — same engine on iOS and Android, online + offline
        return (
          <View style={{ flex: 1 }}>
            <PdfJsViewer localUri={localUri} remoteUrl={fileUri} />
          </View>
        );
      }

      default:
        return (
          <View style={styles.center}>
            <Ionicons name="document-outline" size={56} color={COLORS.textMuted} />
            <Text style={styles.loadingText}>Format not supported for preview.</Text>
          </View>
        );
    }
  };

  const [isSaved, setIsSaved] = React.useState(false);

  const saveToDevice = async () => {
    try {
      const uriToSave = localUri || fileUri;
      if (!uriToSave) return;

      // Use expo-media-library for images/videos (saves to camera roll)
      // For documents, use sharing (saves via system dialog)
      if (fileType === 'image' || fileType === 'video') {
        const MediaLibrary = await import('expo-media-library');
        const { status } = await MediaLibrary.requestPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission needed', 'Please grant media library access to save files.');
          return;
        }
        await MediaLibrary.saveToLibraryAsync(uriToSave);
        setIsSaved(true);
        setTimeout(() => setIsSaved(false), 3000);
      } else {
        // PDF/document — use sharing dialog to save
        if (!(await Sharing.isAvailableAsync())) {
          Alert.alert('Unavailable', 'Saving is not supported on this device.');
          return;
        }
        const realFileName = extractFileNameFromUrl(fileUri, fileName);
        await Sharing.shareAsync(uriToSave, { dialogTitle: `Save ${realFileName}` });
      }
    } catch {
      Alert.alert('Error', 'Could not save the file.');
    }
  };

  const shareFile = async () => {
    try {
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('Unavailable', 'Sharing is not supported on this device.');
        return;
      }
      await Sharing.shareAsync(localUri || fileUri);
    } catch {
      Alert.alert('Error', 'Could not share this file.');
    }
  };

  return (
    <Modal visible={isVisible} animationType="slide" transparent>
      <BlurView intensity={80} style={StyleSheet.absoluteFill}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Ionicons name="close" size={24} color={COLORS.black} />
            </TouchableOpacity>
            <View style={styles.titleContainer}>
              <Text style={styles.title} numberOfLines={1}>{fileName}</Text>
              <View style={styles.badgeRow}>
                <Text style={styles.subtitle}>IN-APP VIEWER</Text>
                {isOffline && (
                  <View style={styles.offlineBadge}>
                    <Ionicons name="cloud-offline" size={10} color="#fff" />
                    <Text style={styles.offlineBadgeText}>OFFLINE READY</Text>
                  </View>
                )}
              </View>
            </View>
            {showDownload && (
              <TouchableOpacity style={styles.actionButton} onPress={shareFile}>
                <Ionicons name="share-social-outline" size={24} color={COLORS.black} />
              </TouchableOpacity>
            )}
          </View>

          {/* Content */}
          <View style={styles.content}>{renderContent()}</View>

          {/* Footer */}
          <View style={styles.footer}>
            <TouchableOpacity style={styles.footerAction} onPress={saveToDevice}>
              <Ionicons
                name={isSaved ? 'checkmark-circle' : 'cloud-download-outline'}
                size={20}
                color={isSaved ? '#10b981' : COLORS.primary}
              />
              <Text style={[styles.footerActionText, isSaved && { color: '#10b981' }]}>
                {isSaved ? 'Saved!' : 'Save to Device'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.footerAction} onPress={shareFile}>
              <Ionicons name="share-social-outline" size={20} color={COLORS.primary} />
              <Text style={styles.footerActionText}>Share</Text>
            </TouchableOpacity>
          </View>
        </View>
      </BlurView>
    </Modal>
  );
};

// ── Visual Scan Engine for Mobile (Cloudinary page images) ───────────────────
function MobileVisualScan({ url }: { url: string }) {
  const MAX_PAGES = 50;
  const [pages, setPages] = React.useState<number[]>([1]);
  const [failed, setFailed] = React.useState<Set<number>>(new Set());

  const pageUrl = (page: number) => {
    const match = url.match(/res\.cloudinary\.com\/([^/]+)\/(?:raw|image)\/upload\/(?:v\d+\/)?(.+)$/);
    if (!match) return null;
    const [, cloud, path] = match;
    const pathNoExt = path.replace(/\.[^.]+$/, '');
    return `https://res.cloudinary.com/${cloud}/image/upload/pg_${page},w_1200,c_limit,f_jpg,q_auto:best/${pathNoExt}.jpg`;
  };

  if (!url.includes('res.cloudinary.com')) {
    return (
      <View style={styles.center}>
        <Ionicons name="alert-circle-outline" size={40} color="#f59e0b" />
        <Text style={styles.loadingText}>Visual Scan requires Cloudinary URL</Text>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#e2e8f0' }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      {pages.map(page => {
        const imgUrl = pageUrl(page);
        if (!imgUrl || failed.has(page)) return null;
        return (
          <View key={page} style={{ alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: 10, fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1 }}>
              Page {page}
            </Text>
            <Image
              source={{ uri: imgUrl }}
              style={{ width: width - 32, height: (width - 32) * 1.4, borderRadius: 12, backgroundColor: '#fff' }}
              resizeMode="contain"
              onLoad={() => {
                if (page < MAX_PAGES) {
                  setPages(prev => prev.includes(page + 1) ? prev : [...prev, page + 1]);
                }
              }}
              onError={() => setFailed(prev => new Set([...prev, page]))}
            />
          </View>
        );
      })}
    </ScrollView>
  );
}

// ── Video Player — HTML5 WebView (same as admin) + expo-av fallback ──────────
// Primary: HTML5 <video> in WebView — handles streaming, seeking, all formats
// Fallback: expo-av Video component (tap "Native Player" button)
function VideoPlayer({ localUri, remoteUrl }: { localUri: string | null; remoteUrl: string }) {
  const [useNative, setUseNative] = React.useState(false);
  const videoSrc = localUri || remoteUrl;

  if (useNative) {
    return (
      <View style={styles.videoContainer}>
        <Video
          source={{ uri: videoSrc }}
          rate={1.0}
          volume={1.0}
          isMuted={false}
          resizeMode={ResizeMode.CONTAIN}
          shouldPlay={false}
          useNativeControls
          style={styles.video}
          onError={() => setUseNative(false)}
        />
        <TouchableOpacity
          onPress={() => setUseNative(false)}
          style={videoStyles.switchBtn}
        >
          <Ionicons name="globe-outline" size={14} color="#fff" />
          <Text style={videoStyles.switchBtnText}>Web Player</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // HTML5 video player — same approach as admin InstitutionalDocumentViewer
  const srcJson = JSON.stringify(videoSrc);
  const html = `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:#000;width:100%;height:100%;display:flex;align-items:center;justify-content:center}
video{width:100%;max-height:100vh;outline:none}
#err{display:none;flex-direction:column;align-items:center;justify-content:center;
gap:12px;color:#ef4444;padding:24px;text-align:center;min-height:60vh}
#err p{color:#94a3b8;font-size:13px}
</style></head><body>
<video id="v" src=${srcJson} controls playsinline preload="metadata"
  onerror="document.getElementById('v').style.display='none';document.getElementById('err').style.display='flex'">
  <source src=${srcJson}>
</video>
<div id="err">
  <strong style="color:#ef4444">Video could not be played</strong>
  <p>Try the Native Player option below</p>
</div>
</body></html>`;

  return (
    <View style={styles.videoContainer}>
      <WebView
        source={{ html }}
        style={{ flex: 1, backgroundColor: '#000' }}
        originWhitelist={['*']}
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        mixedContentMode="always"
        javaScriptEnabled
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback
        allowsFullscreenVideo
      />
      <TouchableOpacity
        onPress={() => setUseNative(true)}
        style={videoStyles.switchBtn}
      >
        <Ionicons name="phone-portrait-outline" size={14} color="#fff" />
        <Text style={videoStyles.switchBtnText}>Native Player</Text>
      </TouchableOpacity>
    </View>
  );
}

const videoStyles = StyleSheet.create({
  switchBtn: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  switchBtnText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});

// PDF.js Canvas Renderer - works on Android + iOS, online + offline
function PdfJsViewer({ localUri, remoteUrl }: { localUri: string | null; remoteUrl: string }) {
  const [html, setHtml] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const build = async () => {
      try {
        let pdfSrc;
        if (localUri) {
          const base64 = await FileSystem.readAsStringAsync(localUri, { encoding: 'base64' });
          pdfSrc = 'data:application/pdf;base64,' + base64;
        } else {
          pdfSrc = remoteUrl;
        }
        if (cancelled) return;
        const srcJson = JSON.stringify(pdfSrc);
        const htmlContent = '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=3"><style>*{margin:0;padding:0;box-sizing:border-box}html,body{background:#1e293b;font-family:-apple-system,sans-serif}#toolbar{position:sticky;top:0;z-index:100;background:#0f172a;padding:10px 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #334155}#toolbar span{color:#94a3b8;font-size:12px;font-weight:600}#toolbar strong{color:#f1f5f9;font-size:13px}#pages{padding:16px;display:flex;flex-direction:column;gap:16px;align-items:center}.pw{position:relative;box-shadow:0 4px 24px rgba(0,0,0,.4);border-radius:8px;overflow:hidden}canvas{display:block;max-width:100%}.pn{position:absolute;bottom:8px;right:10px;background:rgba(0,0,0,.55);color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px}#loading{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;gap:16px;color:#94a3b8}.sp{width:40px;height:40px;border:3px solid #334155;border-top-color:#064e3b;border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}#err{display:none;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;gap:12px;color:#ef4444;padding:24px;text-align:center}#err p{color:#94a3b8;font-size:13px;line-height:1.5}</style></head><body><div id="toolbar"><span>PDF VIEWER</span><strong id="pc">Loading...</strong></div><div id="loading"><div class="sp"></div><span>Rendering...</span></div><div id="err"><strong>Could not render PDF</strong><p id="em">The file may be corrupted.</p></div><div id="pages"></div><script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script><script>(async()=>{const ld=document.getElementById("loading"),er=document.getElementById("err"),em=document.getElementById("em"),pg=document.getElementById("pages"),pc=document.getElementById("pc");try{pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";const src=' + srcJson + ';const pdf=await pdfjsLib.getDocument(src).promise;const tot=pdf.numPages;ld.style.display="none";pc.textContent=tot+" page"+(tot!==1?"s":"");const dpr=window.devicePixelRatio||2;const vw=window.innerWidth-32;for(let i=1;i<=tot;i++){const page=await pdf.getPage(i);const us=page.getViewport({scale:1});const sc=(vw/us.width)*dpr;const vp=page.getViewport({scale:sc});const wrap=document.createElement("div");wrap.className="pw";wrap.style.width=(vp.width/dpr)+"px";const cv=document.createElement("canvas");cv.width=vp.width;cv.height=vp.height;cv.style.width=(vp.width/dpr)+"px";cv.style.height=(vp.height/dpr)+"px";await page.render({canvasContext:cv.getContext("2d"),viewport:vp}).promise;const num=document.createElement("div");num.className="pn";num.textContent=i+" / "+tot;wrap.appendChild(cv);wrap.appendChild(num);pg.appendChild(wrap);}}catch(e){ld.style.display="none";er.style.display="flex";em.textContent=e?.message||"Unknown error";}})()</script></body></html>';
        if (!cancelled) { setHtml(htmlContent); setLoading(false); }
      } catch (e: any) {
        if (!cancelled) { setError(e?.message || 'Could not prepare PDF viewer.'); setLoading(false); }
      }
    };
    build();
    return () => { cancelled = true; };
  }, [localUri, remoteUrl]);

  if (loading) return React.createElement(View, {style: styles.center}, React.createElement(ActivityIndicator, {size: 'large', color: COLORS.primary}), React.createElement(Text, {style: styles.loadingText}, 'Preparing PDF viewer...'));
  if (error || !html) return React.createElement(View, {style: styles.center}, React.createElement(Ionicons, {name: 'alert-circle-outline', size: 48, color: '#ef4444'}), React.createElement(Text, {style: styles.errorText}, error || 'Render failed'));
  return React.createElement(WebView, {source: {html}, style: styles.webview, originWhitelist: ['*'], allowFileAccess: true, allowFileAccessFromFileURLs: true, allowUniversalAccessFromFileURLs: true, mixedContentMode: 'always', javaScriptEnabled: true, domStorageEnabled: true, startInLoadingState: true, onError: () => setError('WebView failed to load.')});
}

function AudioPlayer({ uri, fileName }: { uri: string; fileName: string }) {
  const [sound, setSound] = React.useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const [position, setPosition] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    return () => { sound?.unloadAsync(); };
  }, [sound]);

  const loadAndPlay = async () => {
    try {
      setIsLoading(true);
      setError(null);
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound: newSound } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: true },
        (status) => {
          if (status.isLoaded) {
            setPosition(status.positionMillis || 0);
            setDuration(status.durationMillis || 0);
            setIsPlaying(status.isPlaying);
            if (status.didJustFinish) setIsPlaying(false);
          }
        }
      );
      setSound(newSound);
      setIsPlaying(true);
    } catch {
      setError('Could not play audio.');
    } finally {
      setIsLoading(false);
    }
  };

  const togglePlay = async () => {
    if (!sound) { loadAndPlay(); return; }
    if (isPlaying) await sound.pauseAsync();
    else await sound.playAsync();
  };

  const fmt = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  const progress = duration > 0 ? position / duration : 0;

  return (
    <View style={audioStyles.container}>
      <View style={audioStyles.iconWrap}>
        <Ionicons name="musical-notes" size={48} color={COLORS.primary} />
      </View>
      <Text style={audioStyles.name} numberOfLines={2}>{fileName}</Text>
      {error ? (
        <Text style={audioStyles.error}>{error}</Text>
      ) : (
        <>
          <View style={audioStyles.progressBar}>
            <View style={[audioStyles.progressFill, { width: `${progress * 100}%` as any }]} />
          </View>
          <View style={audioStyles.timeRow}>
            <Text style={audioStyles.time}>{fmt(position)}</Text>
            <Text style={audioStyles.time}>{fmt(duration)}</Text>
          </View>
        </>
      )}
      <TouchableOpacity style={audioStyles.playBtn} onPress={togglePlay} disabled={isLoading}>
        {isLoading
          ? <ActivityIndicator color="#fff" />
          : <Ionicons name={isPlaying ? 'pause' : 'play'} size={32} color="#fff" />
        }
      </TouchableOpacity>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const audioStyles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 16 },
  iconWrap: { width: 96, height: 96, borderRadius: 24, backgroundColor: '#fef3c7', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  name: { fontSize: 16, fontWeight: '800', color: '#1e293b', textAlign: 'center', maxWidth: 280 },
  progressBar: { width: '100%', height: 6, backgroundColor: '#e2e8f0', borderRadius: 3, overflow: 'hidden', marginTop: 8 },
  progressFill: { height: '100%', backgroundColor: COLORS.primary, borderRadius: 3 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%' },
  time: { fontSize: 12, fontWeight: '600', color: '#94a3b8' },
  playBtn: { width: 72, height: 72, borderRadius: 36, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', marginTop: 8, shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 16, elevation: 8 },
  error: { fontSize: 13, color: '#ef4444', textAlign: 'center', fontWeight: '600' },
});

const engineStyles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    padding: 8,
    gap: 8,
  },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  btnActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  btnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  btnTextActive: {
    color: '#fff',
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.97)',
    marginTop: Platform.OS === 'ios' ? 60 : 40,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  closeButton: { padding: 8, backgroundColor: '#f8fafc', borderRadius: 12 },
  titleContainer: { flex: 1, paddingHorizontal: 15 },
  title: { fontSize: 16, fontWeight: '800', color: COLORS.black },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  subtitle: { fontSize: 10, fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1 },
  offlineBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#16a34a', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, gap: 3 },
  offlineBadgeText: { fontSize: 8, fontWeight: '800', color: '#fff', textTransform: 'uppercase', letterSpacing: 0.5 },
  actionButton: { padding: 8 },
  content: { flex: 1 },
  webview: { flex: 1, width },
  image: { width, height: height * 0.75, backgroundColor: '#f1f5f9' },
  videoContainer: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  video: { width, height: width * (9 / 16) },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  progressRing: { marginBottom: 16 },
  progressBarOuter: { width: '80%', height: 6, backgroundColor: '#e2e8f0', borderRadius: 3, overflow: 'hidden', marginTop: 12 },
  progressBarInner: { height: '100%', backgroundColor: COLORS.primary, borderRadius: 3 },
  loadingText: { marginTop: 8, fontSize: 14, fontWeight: '600', color: '#64748b', textAlign: 'center' },
  errorText: { marginTop: 16, fontSize: 14, fontWeight: '600', color: '#ef4444', textAlign: 'center', maxWidth: 280, lineHeight: 22 },
  retryButton: { marginTop: 24, paddingHorizontal: 32, paddingVertical: 12, backgroundColor: COLORS.primary, borderRadius: 16 },
  retryText: { fontSize: 14, fontWeight: '800', color: '#fff', textTransform: 'uppercase', letterSpacing: 1 },
  footer: { flexDirection: 'row', padding: 20, borderTopWidth: 1, borderTopColor: '#f1f5f9', gap: 12 },
  footerAction: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc', paddingVertical: 12, borderRadius: 16, gap: 8 },
  footerActionText: { fontSize: 12, fontWeight: '700', color: COLORS.black },
  placeholderContainer: { flex: 1, padding: 40, alignItems: 'center', justifyContent: 'center' },
  placeholderText: { fontSize: 14, color: '#64748b', marginTop: 10 },
  fileNameText: { fontSize: 18, fontWeight: '800', color: COLORS.black, marginVertical: 10, textAlign: 'center' },
});
