/**
 * ============================================================================
 * 🛑 ARCHITECTURAL INVARIANT: DO NOT MODIFY THE MODAL SHELL 🛑
 * ============================================================================
 * This viewer uses a strict native `<Modal animationType="slide">`. 
 * This ensures that the opening/closing animation runs entirely on the Android 
 * native UI thread, preventing the Hermes JS engine from freezing during 
 * heavy media mounts (PDFs, large videos).
 * 
 * To prevent regressions, DO NOT:
 * 1. Replace the native <Modal> with a custom JS-driven animated view.
 * 2. Add Animated.parallel/Animated.timing to the root opening sequence.
 * 3. Use continuous JS-driven pan responders that intercept the native PDF/Video scroll.
 * 4. Remove `useNativeDriver: true` from the header/footer auto-fade animations.
 * 
 * If you are an LLM or developer adding features, respect these boundaries.
 * ============================================================================
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  Dimensions,
  Platform,
  ActivityIndicator,
  Alert,
  ScrollView,
  useWindowDimensions,
  TouchableWithoutFeedback,
  FlatList,
  InteractionManager,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/Colors';
import { useTheme } from '../../stores/theme.store';
import { extractFileNameFromUrl, getVaultFilePath } from '../../utils/download';
import { Video, ResizeMode, Audio } from 'expo-av';
import { WebView } from 'react-native-webview';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sentry from '@sentry/react-native';
import { trackViewerEvent, captureViewerError } from '../../utils/sentry';
import { SafeOverlayContainer, showToast } from './overlays';
import {  saveMediaToDevice, shareMedia } from '../../utils/mediaSaver';
import Pdf from 'react-native-pdf';
import { CustomVideoPlayer } from './CustomVideoPlayer';
import { getAssetCacheByUrl } from '../../lib/database';

const { width, height } = Dimensions.get('window');

// expo-file-system SDK 55 uses Paths API; cast as any for backward compat
const getCacheBase = (): string => {
    const fs = FileSystem as any;
    const cacheDir: string =
        fs.Paths?.document?.uri ||
        fs.documentDirectory ||
        '';
    const base = cacheDir.endsWith('/') ? cacheDir : `${cacheDir}/`;
    return `${base}naliss_viewer/`;
};
const VIEWER_CACHE = getCacheBase();

// Remove fl_inline â€” causes HTTP 400 on Cloudinary raw files
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
    // No extension or image extension â€” trust /image/upload/ as-is
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

export interface ViewerMediaItem {
  uri: string;
  type: 'image' | 'video' | 'pdf' | 'audio' | 'document';
  name: string;
  fileId?: string;
}

export interface UniversalViewerProps {
  isVisible: boolean;
  onClose: () => void;
  fileUri: string;           // remote Cloudinary URL
  fileType: 'image' | 'video' | 'pdf' | 'audio' | 'document';
  fileName: string;
  fileId?: string;           // material/past_question id â€” used to find vault file
  mediaList?: ViewerMediaItem[];
  initialIndex?: number;
  showDownload?: boolean;
  showShare?: boolean;
  isHalfScreen?: boolean;
  onViewProfile?: () => void;
}

interface ViewerContentProps {
  isDownloading: boolean;
  downloadProgress: number;
  downloadError: string | null;
  localUri: string | null;
  fileType: 'image' | 'video' | 'pdf' | 'audio' | 'document';
  fileUri: string;
  fileName: string;
  onRetry: () => void;
  onImageError: () => void;
  pdfEngine: 'local' | 'local_hd' | 'google' | 'microsoft';
  isOffline: boolean;
  onSingleTap?: () => void;
  isHalfScreen?: boolean;
  readyToPlay?: boolean;
  videoResizeMode?: ResizeMode;
}

interface ZoomableImageProps {
  uri: string;
  onImageError: () => void;
  isHalfScreen?: boolean;
  onSingleTap?: () => void;
}

const ZoomableImage: React.FC<ZoomableImageProps> = ({ uri, onImageError, isHalfScreen, onSingleTap }) => {
  const { height } = useWindowDimensions();
  return (
    <ScrollView
      maximumZoomScale={5}
      minimumZoomScale={1}
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}
    >
      <TouchableWithoutFeedback onPress={onSingleTap}>
        <Image
          source={{ uri }}
          style={[styles.image, isHalfScreen && { height: height * 0.45 }]}
          resizeMode="contain"
          onError={onImageError}
        />
      </TouchableWithoutFeedback>
    </ScrollView>
  );
};

const ViewerContent: React.FC<ViewerContentProps> = ({
  isDownloading,
  downloadProgress,
  downloadError,
  localUri,
  fileType,
  fileUri,
  fileName,
  onRetry,
  onImageError,
  pdfEngine,
  isOffline,
  onSingleTap,
  isHalfScreen,
  readyToPlay = true,
  videoResizeMode = ResizeMode.CONTAIN,
}) => {
  const { colors } = useTheme();

  if (isDownloading || (!readyToPlay && (fileType === 'video' || fileType === 'audio'))) {
    return (
      <View style={styles.center}>
        <View style={styles.progressRing}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
        <Text style={[styles.loadingText, { color: colors.text }]}>
          {downloadProgress > 0 ? `Loading... ${downloadProgress}%` : 'Preparing file...'}
        </Text>
        {downloadProgress > 0 && (
          <View style={styles.progressBarOuter}>
            <View style={[styles.progressBarInner, { width: `${downloadProgress}%` as any }]} />
          </View>
        )}
      </View>
    );
  }

  if (downloadError) {
    return (
      <View style={styles.center}>
        <Ionicons name="alert-circle-outline" size={56} color="#ef4444" />
        <Text style={styles.errorText}>{downloadError}</Text>
        <TouchableOpacity style={[styles.retryButton, { borderColor: colors.border }]} onPress={onRetry}>
          <Text style={[styles.retryText, { color: colors.text }]}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!localUri) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={[styles.loadingText, { color: colors.text }]}>Preparing file...</Text>
      </View>
    );
  }

  switch (fileType) {
    case 'image':
      return <ZoomableImage uri={localUri} onImageError={onImageError} isHalfScreen={isHalfScreen} onSingleTap={onSingleTap} />;

    case 'video':
      return <CustomVideoPlayer source={{ uri: localUri.startsWith('http') ? localUri : `file://${localUri}` }} resizeMode={videoResizeMode} onSingleTap={onSingleTap} autoPlay />;

    case 'audio':
      return <AudioPlayer uri={localUri} fileName={fileName} />;

    case 'pdf':
    case 'document':
      return (
        <View style={{ flex: 1 }}>
          {pdfEngine === 'local' && (
            <PdfJsViewer localUri={localUri} remoteUrl={fileUri} scaleMultiplier={1.0} onSingleTap={onSingleTap} />
          )}
          {pdfEngine === 'local_hd' && (
            <PdfJsViewer localUri={localUri} remoteUrl={fileUri} scaleMultiplier={1.8} onSingleTap={onSingleTap} />
          )}
          {pdfEngine === 'google' && (
            <GooglePdfViewer remoteUrl={fileUri} isOffline={isOffline} />
          )}
          {pdfEngine === 'microsoft' && (
            <MicrosoftPdfViewer remoteUrl={fileUri} isOffline={isOffline} />
          )}
        </View>
      );

    default:
      return (
        <View style={styles.center}>
          <Ionicons name="document-outline" size={56} color={COLORS.textMuted} />
          <Text style={[styles.loadingText, { color: colors.text }]}>Format not supported for preview.</Text>
        </View>
      );
  }
};

/**
 * Universal In-App Viewer V3.0 â€” Full Offline Support
 *
 * For ALL media types:
 *  1. Check vault (naliss_vault/) â€” file was previously downloaded by user
 *  2. Check viewer cache (naliss_viewer/) â€” file was previously previewed
 *  3. Download to viewer cache if not found
 *  4. Render from local URI â€” works 100% offline after first open
 */
function ViewerItemSlide({
  item,
  isVisible,
  pdfEngine,
  isHalfScreen,
  onSingleTap,
  videoResizeMode,
}: {
  item: ViewerMediaItem;
  isVisible: boolean;
  pdfEngine: 'local' | 'local_hd' | 'google' | 'microsoft';
  isHalfScreen?: boolean;
  onSingleTap?: () => void;
  videoResizeMode?: ResizeMode;
}) {
  const [localUri, setLocalUri] = React.useState<string | null>(null);
  const [isDownloading, setIsDownloading] = React.useState(false);
  const [downloadProgress, setDownloadProgress] = React.useState(0);
  const [downloadError, setDownloadError] = React.useState<string | null>(null);
  const [isOffline, setIsOffline] = React.useState(false);
  const [retryKey, setRetryKey] = React.useState(0);
  const [readyToPlay, setReadyToPlay] = React.useState(false);
  const lastProcessedUriRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!isVisible) {
      lastProcessedUriRef.current = null;
      setReadyToPlay(false);
      return;
    }
    if (!item.uri) return;
    if (lastProcessedUriRef.current === item.uri + retryKey) {
      // Prevent re-processing identical URI on parent re-renders
      return;
    }
    lastProcessedUriRef.current = item.uri + retryKey;

    trackViewerEvent({ stage: 'open', uri: item.uri, fileType: item.type, fileName: item.name, fileId: item.fileId });

    if (item.uri.startsWith('file://') || item.uri.startsWith('/')) {
      trackViewerEvent({ stage: 'vault_hit', uri: item.uri, fileType: item.type, fileName: item.name });
      setLocalUri(item.uri.startsWith('file://') ? item.uri : `file://${item.uri}`);
      setIsOffline(true);
      setIsDownloading(false);
      return;
    }

    let cancelled = false;
    let downloadResumed: FileSystem.DownloadResumable | null = null;
    
    // FIX: Defer the ENTIRE file-resolution pipeline until the modal
    // slide-up animation completes. Previously only readyToPlay was
    // deferred, but the FileSystem.getInfoAsync bridge calls and the
    // resulting state-update cascade were still running during the
    // animation, causing frame drops and perceived freezes.
    setIsDownloading(true);
    setDownloadError(null);
    setLocalUri(null);
    setDownloadProgress(0);

    const resolve = async () => {
      try {
        if (item.fileId) {
          const vaultPath = getVaultFilePath(item.fileId, item.name, item.uri);
          const vaultInfo = await FileSystem.getInfoAsync(vaultPath);
          if (vaultInfo.exists && (vaultInfo as any).size > 0) {
            trackViewerEvent({ stage: 'vault_hit', uri: item.uri, fileType: item.type, fileName: item.name, fileId: item.fileId });
            if (!cancelled) {
              setLocalUri(vaultPath);
              setIsOffline(true);
              setIsDownloading(false);
            }
            return;
          } else {
            trackViewerEvent({ stage: 'vault_miss', uri: item.uri, fileType: item.type, fileName: item.name, fileId: item.fileId });
          }
        }

        const cachedSqlitePath = await getAssetCacheByUrl(item.uri);
        if (cachedSqlitePath) {
          const sqliteFileInfo = await FileSystem.getInfoAsync(cachedSqlitePath);
          if (sqliteFileInfo.exists && (sqliteFileInfo as any).size > 0) {
            trackViewerEvent({ stage: 'cache_hit', uri: item.uri, fileType: item.type, fileName: item.name });
            if (!cancelled) {
              setLocalUri(cachedSqlitePath);
              setIsOffline(true);
              setIsDownloading(false);
            }
            return;
          }
        }

        const viewerUrl = getViewerUrl(item.uri);
        const destinationPath = item.fileId
          ? getVaultFilePath(item.fileId, item.name, item.uri)
          : (() => {
              const realName = extractFileNameFromUrl(viewerUrl, item.name);
              let safeName = realName.replace(/[^a-zA-Z0-9._-]/g, '_');
              const lowerName = safeName.toLowerCase();
              if (item.type === 'video' && !lowerName.match(/\.(mp4|mkv|webm|avi|mov|flv|3gp|wmv)$/)) safeName += '.mp4';
              else if (item.type === 'audio' && !lowerName.match(/\.(mp3|wav|m4a|aac|ogg|wma)$/)) safeName += '.mp3';
              else if (item.type === 'pdf' && !lowerName.endsWith('.pdf')) safeName += '.pdf';
              else if (item.type === 'image' && !lowerName.match(/\.(jpg|jpeg|png|gif|webp|bmp)$/)) safeName += '.jpg';
              return `${VIEWER_CACHE}${safeName}`;
            })();

        if (!viewerUrl.startsWith('http://') && !viewerUrl.startsWith('https://')) {
          if (!cancelled) {
            setLocalUri(viewerUrl.startsWith('file://') ? viewerUrl : `file://${viewerUrl}`);
            setIsOffline(true);
            setIsDownloading(false);
          }
          return;
        }

        // For video and audio, skip full file download to allow instant streaming playback
        if (item.type === 'video' || item.type === 'audio') {
          if (!cancelled) {
            trackViewerEvent({ stage: 'stream_start', uri: viewerUrl, fileType: item.type, fileName: item.name });
            setLocalUri(viewerUrl);
            setIsOffline(false); // It's streaming from network
            setIsDownloading(false);
          }
          return;
        }

        const destDir = destinationPath.substring(0, destinationPath.lastIndexOf('/') + 1);
        const dirInfo = await FileSystem.getInfoAsync(destDir);
        if (!dirInfo.exists) {
          await FileSystem.makeDirectoryAsync(destDir, { intermediates: true });
        }

        const cachedInfo = await FileSystem.getInfoAsync(destinationPath);
        if (cachedInfo.exists && (cachedInfo as any).size > 0) {
          trackViewerEvent({ stage: 'cache_hit', uri: item.uri, fileType: item.type, fileName: item.name });
          if (!cancelled) {
            setLocalUri(destinationPath);
            setIsOffline(true);
            setIsDownloading(false);
          }
          return;
        }

        trackViewerEvent({ stage: 'download_start', uri: viewerUrl, fileType: item.type, fileName: item.name });

        const callback = (p: FileSystem.DownloadProgressData) => {
          if (!cancelled && p.totalBytesExpectedToWrite > 0) {
            setDownloadProgress(Math.round((p.totalBytesWritten / p.totalBytesExpectedToWrite) * 100));
          }
        };

        downloadResumed = FileSystem.createDownloadResumable(viewerUrl, destinationPath, {}, callback);
        const result = await downloadResumed.downloadAsync();

        if (!cancelled) {
          if (result && result.status === 200) {
            trackViewerEvent({ stage: 'download_ok', uri: item.uri, fileType: item.type, fileName: item.name });
            setLocalUri(result.uri);
            setIsOffline(false);
          } else {
            trackViewerEvent({ stage: 'download_fail', uri: item.uri, fileType: item.type, fileName: item.name, error: `HTTP ${result?.status || 'unknown'}` });
            setDownloadError('Could not load file. Tap retry.');
          }
          setIsDownloading(false);
        }
      } catch (err: any) {
        if (!cancelled) {
          const errMsg = err?.message || String(err) || '';
          const isNet = errMsg.includes('Network') || errMsg.includes('Unable to resolve host') || errMsg.includes('connect') || errMsg.includes('Unknown host');
          captureViewerError('download_fail', err, { uri: item.uri, fileType: item.type, fileName: item.name, fileId: item.fileId });
          if (isNet) {
            setDownloadError('Network connection required to view full size media. Please connect to the internet and tap retry.');
          } else {
            setLocalUri(item.uri);
          }
          setIsDownloading(false);
        }
      }
    };

    // Gate everything behind InteractionManager so bridge calls and
    // state-update cascades don't compete with the modal animation.
    const interactionHandle = InteractionManager.runAfterInteractions(() => {
      if (!cancelled) {
        setReadyToPlay(true);
        resolve();
      }
    });
    return () => {
      cancelled = true;
      if (interactionHandle) interactionHandle.cancel();
      if (downloadResumed) {
        downloadResumed.pauseAsync().catch(() => {});
      }
    };
  }, [item.uri, isVisible, retryKey]);

  return (
    <ViewerContent
      isDownloading={isDownloading}
      downloadProgress={downloadProgress}
      downloadError={downloadError}
      localUri={localUri}
      fileType={item.type}
      fileUri={item.uri}
      fileName={item.name}
      onRetry={() => setRetryKey(k => k + 1)}
      onImageError={() => {
        trackViewerEvent({ stage: 'render_error', uri: item.uri, fileType: item.type, fileName: item.name, error: 'Image could not be displayed' });
        captureViewerError('render_error', new Error('Image render failed'), { uri: item.uri, fileType: item.type, fileName: item.name, fileId: item.fileId });
        setDownloadError('Image could not be displayed.');
      }}
      pdfEngine={pdfEngine}
      isOffline={isOffline}
      onSingleTap={onSingleTap}
      isHalfScreen={isHalfScreen}
      readyToPlay={readyToPlay}
      videoResizeMode={videoResizeMode}
    />
  );
}

/**
 * Universal In-App Viewer V3.0 — Full Offline Support
 */
export const UniversalViewer: React.FC<UniversalViewerProps> = ({
  isVisible,
  onClose,
  fileUri,
  fileType,
  fileName,
  fileId,
  mediaList,
  initialIndex = 0,
  showDownload = true,
  showShare = true,
  isHalfScreen = false,
  onViewProfile,
}) => {
  console.log('>>> [VIEWER MOUNT 1] UniversalViewer rendered, visible =', isVisible);

  React.useEffect(() => {
    console.log('>>> [VIEWER EFFECT 2] Viewer effect triggered with URI =', fileUri);
  }, [fileUri, isVisible]);

  const { width, height } = useWindowDimensions();
  const { colors, isDark } = useTheme();
  const isLandscape = width > height;
  const [showControls, setShowControls] = React.useState(false);

  React.useEffect(() => {
    if (isLandscape) {
      setShowControls(false);
    } else {
      setShowControls(true);
    }
  }, [isLandscape]);

  const shouldShowControls = !isLandscape || showControls;

  const activeMediaList = mediaList && mediaList.length > 1 ? mediaList : [{
    uri: fileUri,
    type: fileType,
    name: fileName,
    fileId: fileId,
  }];
  const isMultiItem = activeMediaList.length > 1;

  const [currentIndex, setCurrentIndex] = React.useState(initialIndex);

  React.useEffect(() => {
    if (isVisible) {
      setCurrentIndex(initialIndex && initialIndex < activeMediaList.length ? initialIndex : 0);
    }
  }, [isVisible, initialIndex, mediaList]);

  const activeItem = activeMediaList[currentIndex] || activeMediaList[0];
  const [pdfEngine, setPdfEngine] = React.useState<'local' | 'local_hd' | 'google' | 'microsoft'>('local');

  const VIDEO_ASPECT_MODES = [
    { mode: ResizeMode.CONTAIN, label: 'FIT' },
    { mode: ResizeMode.COVER,   label: 'CROP' },
    { mode: ResizeMode.STRETCH, label: 'FULL' },
  ] as const;
  const [videoAspectIndex, setVideoAspectIndex] = React.useState<number>(0);
  const cycleVideoResizeMode = () => {
    setVideoAspectIndex((prev) => (prev + 1) % VIDEO_ASPECT_MODES.length);
  };

  const [isSaved, setIsSaved] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isSharing, setIsSharing] = React.useState(false);

  if (!isVisible) return null;

  const mimeMap: Record<string, string> = {
    image: 'image/jpeg',
    video: 'video/mp4',
    pdf: 'application/pdf',
    audio: 'audio/mpeg',
    document: '*/*',
  };

  const saveToDevice = async () => {
    try {
      setIsSaving(true);
      trackViewerEvent({ stage: 'save', uri: activeItem.uri, fileType: activeItem.type, fileName: activeItem.name });
      
      const mimeType = mimeMap[activeItem.type] || 'application/octet-stream';
      const result = await saveMediaToDevice(activeItem.uri, mimeType, activeItem.name);
      
      if (result.success) {
        setIsSaved(true);
        showToast('✓ Saved to Device');
        setTimeout(() => setIsSaved(false), 3000);
      } else {
        Alert.alert('Save Failed', result.error || 'Could not save the file.');
      }
    } catch (err: any) {
      captureViewerError('save', err, { uri: activeItem.uri, fileType: activeItem.type, fileName: activeItem.name });
      Alert.alert('Error', 'Could not save file.');
    } finally {
      setIsSaving(false);
    }
  };

  const shareFile = async () => {
    if (isSharing) return;
    setIsSharing(true);
    try {
      trackViewerEvent({ stage: 'share', uri: activeItem.uri, fileType: activeItem.type, fileName: activeItem.name });
      
      const mimeType = mimeMap[activeItem.type] || 'application/octet-stream';
      await shareMedia(activeItem.uri, mimeType, activeItem.name);
      
    } catch (err: any) {
      captureViewerError('share', err, { uri: activeItem.uri, fileType: activeItem.type, fileName: activeItem.name });
      Alert.alert('Error', 'Could not share this file.');
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <Modal
      visible={isVisible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000000' }]}>
        <View style={styles.container}>
          
          {/* Main Content Area (Rendered first so header floats on top) */}
          <View style={styles.content}>
            {isMultiItem ? (
              <FlatList
                data={activeMediaList}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                snapToInterval={width}
                snapToAlignment="center"
                decelerationRate="fast"
                initialScrollIndex={initialIndex && initialIndex < activeMediaList.length ? initialIndex : 0}
                getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
                onMomentumScrollEnd={(e) => {
                  const idx = Math.round(e.nativeEvent.contentOffset.x / width);
                  if (idx >= 0 && idx < activeMediaList.length) {
                    setCurrentIndex(idx);
                  }
                }}
                keyExtractor={(item, index) => `viewer-${item.fileId || item.uri}-${index}`}
                renderItem={({ item }) => (
                  <View style={{ width, height: '100%', justifyContent: 'center' }}>
                    <ViewerItemSlide
                      item={item}
                      isVisible={isVisible}
                      pdfEngine={pdfEngine}
                      isHalfScreen={isHalfScreen}
                      onSingleTap={() => setShowControls(!showControls)}
                      videoResizeMode={VIDEO_ASPECT_MODES[videoAspectIndex].mode}
                    />
                  </View>
                )}
              />
            ) : (
              <ViewerItemSlide
                item={activeMediaList[0]}
                isVisible={isVisible}
                pdfEngine={pdfEngine}
                isHalfScreen={isHalfScreen}
                onSingleTap={() => setShowControls(!showControls)}
                videoResizeMode={VIDEO_ASPECT_MODES[videoAspectIndex].mode}
              />
            )}
          </View>

          {/* Floating Header */}
          {shouldShowControls && (
            <View style={styles.header}>
              <TouchableOpacity onPress={() => {
                trackViewerEvent({ stage: 'close', uri: activeItem.uri, fileType: activeItem.type, fileName: activeItem.name });
                onClose();
              }} style={styles.closeButton}>
                <Ionicons name="arrow-back" size={26} color={colors.text} />
              </TouchableOpacity>

              <View style={styles.titleContainer}>
                <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
                  {isMultiItem ? `${currentIndex + 1} of ${activeMediaList.length}` : activeItem.name}
                </Text>
              </View>

              {activeItem.type === 'video' ? (
                <View style={styles.videoActionCluster}>
                  {/* Aspect Ratio Badge Stepper */}
                  <TouchableOpacity
                    style={styles.aspectBadge}
                    onPress={cycleVideoResizeMode}
                    hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
                  >
                    <Ionicons name="scan-outline" size={14} color={colors.text} style={{ marginRight: 4 }} />
                    <Text style={[styles.aspectText, { color: colors.text }]}>{VIDEO_ASPECT_MODES[videoAspectIndex].label}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={{ width: 40 }} />
              )}
            </View>
          )}

          {/* PDF Engine Switcher Bar */}
          {shouldShowControls && (activeItem.type === 'pdf' || activeItem.type === 'document') && (
            <View style={engineStyles.bar}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8, paddingHorizontal: 12 }}
              >
                <TouchableOpacity
                  style={[engineStyles.btn, pdfEngine === 'local' && engineStyles.btnActive]}
                  onPress={() => setPdfEngine('local')}
                >
                  <Ionicons name="document-text-outline" size={14} color={pdfEngine === 'local' ? '#000' : '#fff'} />
                  <Text style={[engineStyles.btnText, pdfEngine === 'local' && engineStyles.btnTextActive]}>Fit Width</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[engineStyles.btn, pdfEngine === 'local_hd' && engineStyles.btnActive]}
                  onPress={() => setPdfEngine('local_hd')}
                >
                  <Ionicons name="sparkles-outline" size={14} color={pdfEngine === 'local_hd' ? '#000' : '#fff'} />
                  <Text style={[engineStyles.btnText, pdfEngine === 'local_hd' && engineStyles.btnTextActive]}>Closer View</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    engineStyles.btn,
                    pdfEngine === 'google' && engineStyles.btnActive,
                  ]}
                  onPress={() => setPdfEngine('google')}
                >
                  <Ionicons name="logo-google" size={14} color={pdfEngine === 'google' ? '#000' : '#fff'} />
                  <Text style={[engineStyles.btnText, pdfEngine === 'google' && engineStyles.btnTextActive]}>Google Web</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    engineStyles.btn,
                    pdfEngine === 'microsoft' && engineStyles.btnActive,
                  ]}
                  onPress={() => setPdfEngine('microsoft')}
                >
                  <Ionicons name="logo-windows" size={14} color={pdfEngine === 'microsoft' ? '#000' : '#fff'} />
                  <Text style={[engineStyles.btnText, pdfEngine === 'microsoft' && engineStyles.btnTextActive]}>MS View</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          )}

          {/* Floating Footer */}
          {shouldShowControls && (showDownload || showShare || onViewProfile) && (
            <View style={[styles.footer, { backgroundColor: isDark ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.8)' }]}>
              {showDownload && (
                <TouchableOpacity
                  style={[styles.footerAction, isSaving && { opacity: 0.5 }]}
                  onPress={saveToDevice}
                  disabled={isSaving}
                >
                  {isSaving ? (
                    <ActivityIndicator size="small" color={colors.text} />
                  ) : (
                    <View>
                      <Ionicons
                        name={isSaved ? 'checkmark' : 'download-outline'}
                        size={24}
                        color={isSaved ? '#10b981' : colors.text}
                      />
                    </View>
                  )}
                  <Text style={[styles.footerActionText, { color: colors.text }, isSaved && { color: '#10b981' }]}>
                    {isSaved ? 'Saved!' : 'Save'}
                  </Text>
                </TouchableOpacity>
              )}
              {showShare && (
                <TouchableOpacity
                  style={[styles.footerAction, isSharing && { opacity: 0.5 }]}
                  onPress={shareFile}
                  disabled={isSharing}
                >
                  {isSharing ? (
                    <ActivityIndicator size="small" color={colors.text} />
                  ) : (
                    <View>
                      <Ionicons name="share-social-outline" size={24} color={colors.text} />
                    </View>
                  )}
                  <Text style={[styles.footerActionText, { color: colors.text }]}>Share</Text>
                </TouchableOpacity>
              )}
              {onViewProfile && (
                <TouchableOpacity style={styles.footerAction} onPress={onViewProfile}>
                  <Ionicons name="person-circle-outline" size={20} color={COLORS.primary} />
                  <Text style={[styles.footerActionText, { color: colors.text }]}>View Full Profile</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
};

// ——— Video Player — expo-av native player ————————————————————————
function VideoPlayer({ localUri, remoteUrl, onSingleTap }: { localUri: string | null; remoteUrl: string; onSingleTap?: () => void }) {
  const rawSrc = localUri || remoteUrl;
  const videoSrc = rawSrc && !rawSrc.startsWith('http') && !rawSrc.startsWith('file://')
    ? `file://${rawSrc}`
    : rawSrc;

  return (
    <View style={styles.videoContainer}>
      <CustomVideoPlayer
        source={{ uri: videoSrc }}
        resizeMode={ResizeMode.CONTAIN}
        autoPlay={true}
        showControls={true}
        onSingleTap={onSingleTap}
      />
    </View>
  );
}

// Google Document Viewer for high-clarity remote vector rendering
function GooglePdfViewer({ remoteUrl, isOffline }: { remoteUrl: string; isOffline: boolean }) {
  if (isOffline || !remoteUrl.startsWith('http')) {
    return (
      <View style={styles.center}>
        <Ionicons name="cloud-offline-outline" size={48} color={COLORS.textMuted} />
        <Text style={[styles.loadingText, { marginTop: 12 }]}>Google Viewer Unavailable Offline</Text>
        <Text style={[styles.errorText, { fontSize: 12, marginTop: 4, fontWeight: 'normal', color: '#64748b' }]}>
          Please select Local Standard or Local HD engines for offline use.
        </Text>
      </View>
    );
  }

  const viewerUrl = `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(remoteUrl)}`;
  return (
    <WebView
      source={{ uri: viewerUrl }}
      style={styles.webview}
      originWhitelist={['*']}
      javaScriptEnabled
      domStorageEnabled
      startInLoadingState
      renderLoading={() => (
        <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: '#fff' }]}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading Google Document Viewer...</Text>
        </View>
      )}
    />
  );
}

// Microsoft Office Online Viewer for high-clarity remote vector rendering
function MicrosoftPdfViewer({ remoteUrl, isOffline }: { remoteUrl: string; isOffline: boolean }) {
  if (isOffline || !remoteUrl.startsWith('http')) {
    return (
      <View style={styles.center}>
        <Ionicons name="cloud-offline-outline" size={48} color={COLORS.textMuted} />
        <Text style={[styles.loadingText, { marginTop: 12 }]}>Microsoft Viewer Unavailable Offline</Text>
        <Text style={[styles.errorText, { fontSize: 12, marginTop: 4, fontWeight: 'normal', color: '#64748b' }]}>
          Please select Local Standard or Local HD engines for offline use.
        </Text>
      </View>
    );
  }

  const viewerUrl = `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(remoteUrl)}`;
  return (
    <WebView
      source={{ uri: viewerUrl }}
      style={styles.webview}
      originWhitelist={['*']}
      javaScriptEnabled
      domStorageEnabled
      startInLoadingState
      renderLoading={() => (
        <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: '#fff' }]}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading MS Office Web Viewer...</Text>
        </View>
      )}
    />
  );
}

function PdfJsViewer({ localUri, remoteUrl, scaleMultiplier = 1.0, onSingleTap }: { localUri: string | null, remoteUrl: string, scaleMultiplier?: number, onSingleTap?: () => void }) {
  const { colors, isDark } = useTheme();
  const [zoom, setZoom] = React.useState(scaleMultiplier);
  const [numPages, setNumPages] = React.useState<number>(0);
  const [currentPage, setCurrentPage] = React.useState<number>(1);
  const [rotation, setRotation] = React.useState<number>(0);
  const [pdfLoaded, setPdfLoaded] = React.useState(false);
  const [hasError, setHasError] = React.useState(false);

  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (!pdfLoaded && !hasError) {
      timer = setTimeout(() => {
        setHasError(true);
      }, 15000); // 15s timeout
    }
    return () => clearTimeout(timer);
  }, [pdfLoaded, hasError]);

  let source;
  if (localUri) {
    source = { uri: localUri.startsWith('file://') ? localUri : `file://${localUri}`, cache: true };
  } else {
    source = { uri: remoteUrl, cache: true };
  }

  const rotContainer = rotation !== 0
    ? { transform: [{ rotate: `${rotation}deg` }] }
    : {};

  if (hasError) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
        <Ionicons name="alert-circle-outline" size={56} color="#f59e0b" style={{ marginBottom: 12 }} />
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700', marginBottom: 8, textAlign: 'center' }}>
          Unable to Load PDF
        </Text>
        <Text style={{ color: colors.text, opacity: 0.7, fontSize: 14, textAlign: 'center', marginBottom: 20, lineHeight: 20 }}>
          The file may be corrupted, empty, or failed to download over your network connection.
        </Text>
        <TouchableOpacity
          style={{ backgroundColor: COLORS.primary || '#3b82f6', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 8 }}
          onPress={() => setHasError(false)}
        >
          <Text style={{ color: '#fff', fontWeight: '600', fontSize: 14 }}>Try Loading Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[{ flex: 1, width: '100%' }, rotContainer]}>
        <Pdf
          source={source}
          style={{ flex: 1, width: '100%', backgroundColor: colors.background }}
          scale={zoom}
          minScale={0.5}
          maxScale={5.0}
          singlePage={false}
          enableAntialiasing={true}
          enablePaging={false}
          fitPolicy={0}
          spacing={16}
          onLoadComplete={(count) => { setNumPages(count); setPdfLoaded(true); setHasError(false); }}
          onPageChanged={(page) => { setCurrentPage(page); }}
          onPageSingleTap={() => onSingleTap?.()}
          onError={(error) => {
            console.warn('[PDF] Rendering error:', error);
            setHasError(true);
          }}
        />
      </View>

      <View style={[pdfCtrl.container, { backgroundColor: isDark ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.9)', borderTopColor: colors.border }]}>
        <TouchableOpacity style={[pdfCtrl.btn, { backgroundColor: colors.card }]} onPress={() => setZoom(z => Math.max(0.5, +(z - 0.25).toFixed(2)))}>
          <Ionicons name="remove" size={18} color={colors.text} />
        </TouchableOpacity>
        <Text style={[pdfCtrl.label, { color: colors.text }]}>{Math.round(zoom * 100)}%</Text>
        <TouchableOpacity style={[pdfCtrl.btn, { backgroundColor: colors.card }]} onPress={() => setZoom(z => Math.min(5, +(z + 0.25).toFixed(2)))}>
          <Ionicons name="add" size={18} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity style={[pdfCtrl.btn, { backgroundColor: colors.card }]} onPress={() => setZoom(scaleMultiplier)}>
          <Ionicons name="resize" size={16} color={colors.text} />
        </TouchableOpacity>
        <View style={pdfCtrl.divider} />
        <TouchableOpacity style={[pdfCtrl.btn, { backgroundColor: colors.card }]} onPress={() => setRotation(r => (r + 90) % 360)}>
          <Ionicons name="refresh-outline" size={18} color={colors.text} />
        </TouchableOpacity>
        <View style={pdfCtrl.divider} />
        <View style={[pdfCtrl.pageBadge, { backgroundColor: colors.card }]}>
          <Ionicons name="document-text-outline" size={12} color={colors.text} />
          <Text style={[pdfCtrl.pageText, { color: colors.text }]}>{currentPage}/{numPages || '?'}</Text>
        </View>
      </View>
    </View>
  );
}

const pdfCtrl = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#0f172a',
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
  },
  btn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: '#e2e8f0',
    minWidth: 40,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  divider: {
    width: 1,
    height: 24,
    backgroundColor: '#334155',
    marginHorizontal: 4,
  },
  pageBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#1e293b',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  pageText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94a3b8',
    fontVariant: ['tabular-nums'],
  },
});

function AudioPlayer({ uri, fileName }: { uri: string; fileName: string }) {
  const { colors, isDark } = useTheme();
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
      <View style={[audioStyles.iconWrap, { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : '#fef3c7' }]}>
        <Ionicons name="musical-notes" size={48} color={COLORS.primary} />
      </View>
      <Text style={[audioStyles.name, { color: colors.text }]} numberOfLines={2}>{fileName}</Text>
      {error ? (
        <Text style={audioStyles.error}>{error}</Text>
      ) : (
        <>
          <View style={[audioStyles.progressBar, { backgroundColor: colors.border }]}>
            <View style={[audioStyles.progressFill, { width: `${progress * 100}%` as any }]} />
          </View>
          <View style={audioStyles.timeRow}>
            <Text style={[audioStyles.time, { color: colors.text }]}>{fmt(position)}</Text>
            <Text style={[audioStyles.time, { color: colors.text }]}>{fmt(duration)}</Text>
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

// â”€â”€ Styles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    position: 'absolute',
    top: Platform.OS === 'ios' ? 100 : 90,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingVertical: 10,
    paddingHorizontal: 8,
    gap: 8,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  btnActive: {
    backgroundColor: '#ffffff',
    borderColor: '#ffffff',
  },
  btnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#ffffff',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  btnTextActive: {
    color: '#000000',
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 50 : 40,
    paddingBottom: 15,
    paddingHorizontal: 15,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 10,
  },
  closeButton: { padding: 8 },
  titleContainer: { flex: 1, paddingHorizontal: 15 },
  title: { fontSize: 18, fontWeight: '600', color: '#ffffff' },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  subtitle: { fontSize: 10, fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1 },
  offlineBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#16a34a', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, gap: 3 },
  offlineBadgeText: { fontSize: 8, fontWeight: '800', color: '#fff', textTransform: 'uppercase', letterSpacing: 0.5 },
  actionButton: { padding: 8 },
  videoActionCluster: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  aspectBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(30, 30, 30, 0.85)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.15)' },
  aspectText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  circleButtonCompact: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(30, 30, 30, 0.85)', borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.15)', justifyContent: 'center', alignItems: 'center' },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  webview: { flex: 1, width },
  image: { width, height: '100%', resizeMode: 'contain', backgroundColor: '#000000' },
  videoContainer: { flex: 1, backgroundColor: '#000000', justifyContent: 'center' },
  video: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000000',
    alignSelf: 'center',
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  progressRing: { marginBottom: 16 },
  progressBarOuter: { width: '80%', height: 4, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 2, overflow: 'hidden', marginTop: 12 },
  progressBarInner: { height: '100%', backgroundColor: '#ffffff', borderRadius: 2 },
  loadingText: { marginTop: 8, fontSize: 14, fontWeight: '500', color: '#ffffff', textAlign: 'center' },
  errorText: { marginTop: 16, fontSize: 14, fontWeight: '600', color: '#ef4444', textAlign: 'center', maxWidth: 280, lineHeight: 22 },
  retryButton: { marginTop: 24, paddingHorizontal: 32, paddingVertical: 12, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 16 },
  retryText: { fontSize: 14, fontWeight: '800', color: '#ffffff', textTransform: 'uppercase', letterSpacing: 1 },
  footer: { 
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row', 
    justifyContent: 'center', 
    padding: 20, 
    paddingBottom: Platform.OS === 'ios' ? 40 : 30,
    backgroundColor: 'rgba(0,0,0,0.5)', 
    gap: 24,
    zIndex: 10,
  },
  footerAction: { alignItems: 'center', justifyContent: 'center', gap: 6, minWidth: 60 },
  footerActionText: { fontSize: 13, fontWeight: '500', color: '#ffffff' },
  placeholderContainer: { flex: 1, padding: 40, alignItems: 'center', justifyContent: 'center' },
  placeholderText: { fontSize: 14, color: '#64748b', marginTop: 10 },
  fileNameText: { fontSize: 18, fontWeight: '800', color: COLORS.black, marginVertical: 10, textAlign: 'center' },
  landscapeOverlayHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
    backgroundColor: 'rgba(255,255,255,0.95)',
  },
  landscapeOverlayTabs: {
    position: 'absolute',
    top: 75,
    left: 0,
    right: 0,
    zIndex: 2,
    backgroundColor: 'rgba(241,245,249,0.95)',
  },
  landscapeOverlayFooter: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 2,
    backgroundColor: 'rgba(255,255,255,0.95)',
  },
});
