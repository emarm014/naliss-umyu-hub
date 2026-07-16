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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/Colors';
import { extractFileNameFromUrl, getVaultFilePath } from '../../utils/download';
import { Video, ResizeMode, Audio } from 'expo-av';
import { WebView } from 'react-native-webview';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { BlurView } from 'expo-blur';
import * as Sentry from '@sentry/react-native';
import { SafeOverlayContainer, showToast } from './overlays';
import {  saveMediaToDevice, shareMedia } from '../../utils/mediaSaver';
import Pdf from 'react-native-pdf';

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
}

interface ZoomableImageProps {
  uri: string;
  onImageError: () => void;
  isHalfScreen?: boolean;
}

const ZoomableImage: React.FC<ZoomableImageProps> = ({ uri, onImageError, isHalfScreen }) => {
  const { height } = useWindowDimensions();
  return (
    <ScrollView
      maximumZoomScale={5}
      minimumZoomScale={1}
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}
    >
      <Image
        source={{ uri }}
        style={[styles.image, isHalfScreen && { height: height * 0.45 }]}
        resizeMode="contain"
        onError={onImageError}
      />
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
}) => {
  if (isDownloading) {
    return (
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
  }

  if (downloadError) {
    return (
      <View style={styles.center}>
        <Ionicons name="alert-circle-outline" size={56} color="#ef4444" />
        <Text style={styles.errorText}>{downloadError}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={onRetry}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!localUri) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Preparing file...</Text>
      </View>
    );
  }

  switch (fileType) {
    case 'image':
      return <ZoomableImage uri={localUri} onImageError={onImageError} isHalfScreen={isHalfScreen} />;

    case 'video':
      return <VideoPlayer localUri={localUri} remoteUrl={fileUri} />;

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
          <Text style={styles.loadingText}>Format not supported for preview.</Text>
        </View>
      );
  }
};

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
  showShare = true,
  isHalfScreen = false,
  onViewProfile,
}) => {
  const { width, height } = useWindowDimensions();
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

  const [localUri, setLocalUri] = React.useState<string | null>(null);
  const [isDownloading, setIsDownloading] = React.useState(false);
  const [downloadProgress, setDownloadProgress] = React.useState(0);
  const [downloadError, setDownloadError] = React.useState<string | null>(null);
  const [isOffline, setIsOffline] = React.useState(false);
  const [retryKey, setRetryKey] = React.useState(0);
  const [pdfEngine, setPdfEngine] = React.useState<'local' | 'local_hd' | 'google' | 'microsoft'>('local');

  // Resolve local URI for any file type
  React.useEffect(() => {
    if (!isVisible) return;

    // Already a local file — open instantly, no download needed
    // Handles both file:// URIs and bare absolute paths (/data/user/0/...)
    if (fileUri.startsWith('file://') || fileUri.startsWith('/')) {
      setLocalUri(fileUri.startsWith('file://') ? fileUri : `file://${fileUri}`);
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
          const vaultPath = getVaultFilePath(fileId, fileName, fileUri);
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

        // Use viewer URL (applies fl_attachment for non-image files)
        const viewerUrl = getViewerUrl(fileUri);

        // 3. Download file — to vault path when fileId is available (eliminates dual cache),
        //    otherwise to viewer cache
        const destinationPath = fileId
          ? getVaultFilePath(fileId, fileName, fileUri)
          : (() => {
              const realName = extractFileNameFromUrl(viewerUrl, fileName);
              let safeName = realName.replace(/[^a-zA-Z0-9._-]/g, '_');
              const lowerName = safeName.toLowerCase();
              if (fileType === 'video' && !lowerName.match(/\.(mp4|mkv|webm|avi|mov|flv|3gp|wmv)$/)) safeName += '.mp4';
              else if (fileType === 'audio' && !lowerName.match(/\.(mp3|wav|m4a|aac|ogg|wma)$/)) safeName += '.mp3';
              else if (fileType === 'pdf' && !lowerName.endsWith('.pdf')) safeName += '.pdf';
              else if (fileType === 'image' && !lowerName.match(/\.(jpg|jpeg|png|gif|webp|bmp)$/)) safeName += '.jpg';
              return `${VIEWER_CACHE}${safeName}`;
            })();

        const destDir = destinationPath.substring(0, destinationPath.lastIndexOf('/') + 1);
        const dirInfo = await FileSystem.getInfoAsync(destDir);
        if (!dirInfo.exists) {
          await FileSystem.makeDirectoryAsync(destDir, { intermediates: true });
        }

        // Check if file already exists at destination
        const existingInfo = await FileSystem.getInfoAsync(destinationPath);
        if (existingInfo.exists && (existingInfo as any).size > 0) {
          if (!cancelled) {
            setLocalUri(destinationPath);
            setIsOffline(true);
            setIsDownloading(false);
          }
          return;
        }
        if (existingInfo.exists) {
          await FileSystem.deleteAsync(destinationPath, { idempotent: true });
        }

        const downloadResumable = FileSystem.createDownloadResumable(
          viewerUrl,
          destinationPath,
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
      } catch (err) {
        if (!cancelled) {
          Sentry.captureException(err, {
            tags: { location: 'UniversalViewer.resolve', fileType },
            extra: { fileUri, fileName, fileId },
          });
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
      setPdfEngine('local');
    }
  }, [isVisible]);

  const [isSaved, setIsSaved] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);

  if (!isVisible) return null;

  const mimeMap: Record<string, string> = {
    image: 'image/jpeg',
    video: 'video/mp4',
    pdf: 'application/pdf',
    audio: 'audio/mpeg',
    document: 'application/octet-stream',
  };

  const saveToDevice = async () => {
    try {
      let fileToSave = localUri;

      // If not cached locally, download first, then save
      if (!fileToSave || (!fileToSave.startsWith('file://') && !fileToSave.startsWith('/'))) {
        setIsSaving(true);
        const viewerUrl = getViewerUrl(fileUri);
        const destPath = fileId
          ? getVaultFilePath(fileId, fileName, fileUri)
          : `${FileSystem.cacheDirectory}temp_save_${Date.now()}_${fileName}`;

        const destDir = destPath.substring(0, destPath.lastIndexOf('/') + 1);
        const dirInfo = await FileSystem.getInfoAsync(destDir);
        if (!dirInfo.exists) {
          await FileSystem.makeDirectoryAsync(destDir, { intermediates: true });
        }

        const resumable = FileSystem.createDownloadResumable(viewerUrl, destPath);
        const result = await resumable.downloadAsync();
        if (!result || result.status !== 200) {
          Alert.alert('Save Failed', 'Could not download the file before saving.');
          setIsSaving(false);
          return;
        }
        fileToSave = result.uri;
        setIsSaving(false);
      }

      const fileUriNorm = fileToSave.startsWith('file://') ? fileToSave : `file://${fileToSave}`;
      const mimeType = mimeMap[fileType] || 'application/octet-stream';
      const result = await saveMediaToDevice(fileUriNorm, mimeType, fileName);

      if (result.success) {
        setIsSaved(true);
        showToast('✓ Saved to Device');
        setTimeout(() => setIsSaved(false), 3000);
      } else {
        Alert.alert('Save Failed', result.error || 'Could not save the file to your device.');
      }
    } catch (err: any) {
      Sentry.captureException(err, { tags: { location: 'UniversalViewer.saveToDevice' }, extra: { fileType, fileName } });
      Alert.alert('Error', 'Could not save the file to public storage. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const shareFile = async () => {
    try {
      const uriToShare = localUri
        ? (localUri.startsWith('file://') ? localUri : `file://${localUri}`)
        : fileUri;
      const mimeType = mimeMap[fileType] || 'application/octet-stream';
      const result = await shareMedia(uriToShare, mimeType, fileName);
      if (!result.success) {
        Alert.alert('Unavailable', result.error || 'Could not share this file.');
      }
    } catch (err: any) {
      Sentry.captureException(err, { tags: { location: 'UniversalViewer.shareFile' }, extra: { fileType, fileName } });
      Alert.alert('Error', 'Could not share this file.');
    }
  };

  return (
    <SafeOverlayContainer
      visible={isVisible}
      onClose={onClose}
      animationType="slide-up"
      dismissible={false}
      overlayStyle={StyleSheet.absoluteFill}
    >
      <BlurView intensity={80} style={StyleSheet.absoluteFill}>
        <View style={[
          styles.container, 
          isLandscape && { marginTop: 0, borderRadius: 0 },
          isHalfScreen && { marginTop: height * 0.45, borderTopLeftRadius: 32, borderTopRightRadius: 32 }
        ]}>
          {/* Header */}
          {shouldShowControls && (
            <View style={[styles.header, isLandscape && styles.landscapeOverlayHeader]}>
            {/* Left: Cancel (X) */}
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

            {/* Right: Balance placeholder (removed redundant back arrow) */}
            <View style={{ width: 40 }} />
            </View>
          )}

          {/* PDF Engine Switcher Bar */}
          {shouldShowControls && (fileType === 'pdf' || fileType === 'document') && (
            <View style={[engineStyles.bar, isLandscape && styles.landscapeOverlayTabs]}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8, paddingHorizontal: 12 }}
              >
                <TouchableOpacity
                  style={[engineStyles.btn, pdfEngine === 'local' && engineStyles.btnActive]}
                  onPress={() => setPdfEngine('local')}
                >
                  <Ionicons name="document-text-outline" size={14} color={pdfEngine === 'local' ? '#fff' : '#64748b'} />
                  <Text style={[engineStyles.btnText, pdfEngine === 'local' && engineStyles.btnTextActive]}>Fit Width</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[engineStyles.btn, pdfEngine === 'local_hd' && engineStyles.btnActive]}
                  onPress={() => setPdfEngine('local_hd')}
                >
                  <Ionicons name="sparkles-outline" size={14} color={pdfEngine === 'local_hd' ? '#fff' : '#64748b'} />
                  <Text style={[engineStyles.btnText, pdfEngine === 'local_hd' && engineStyles.btnTextActive]}>Closer View</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    engineStyles.btn,
                    pdfEngine === 'google' && engineStyles.btnActive,
                    isOffline && { opacity: 0.5 }
                  ]}
                  onPress={() => setPdfEngine('google')}
                >
                  <Ionicons name="logo-google" size={14} color={pdfEngine === 'google' ? '#fff' : '#64748b'} />
                  <Text style={[engineStyles.btnText, pdfEngine === 'google' && engineStyles.btnTextActive]}>Google Web</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    engineStyles.btn,
                    pdfEngine === 'microsoft' && engineStyles.btnActive,
                    isOffline && { opacity: 0.5 }
                  ]}
                  onPress={() => setPdfEngine('microsoft')}
                >
                  <Ionicons name="logo-windows" size={14} color={pdfEngine === 'microsoft' ? '#fff' : '#64748b'} />
                  <Text style={[engineStyles.btnText, pdfEngine === 'microsoft' && engineStyles.btnTextActive]}>MS View</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          )}

          {/* Content */}
          <TouchableWithoutFeedback onPress={() => setShowControls(!showControls)}>
            <View style={[styles.content, isLandscape && { position: 'absolute', top: 0, left: 0, width, height, zIndex: 1 }]}>
              <ViewerContent
                isDownloading={isDownloading}
                downloadProgress={downloadProgress}
                downloadError={downloadError}
                localUri={localUri}
                fileType={fileType}
                fileUri={fileUri}
                fileName={fileName}
                onRetry={() => {
                  setDownloadError(null);
                  setLocalUri(null);
                  setIsDownloading(true);
                  setDownloadProgress(0);
                  setRetryKey(k => k + 1);
                }}
                onImageError={() => setDownloadError('Image could not be displayed.')}
                pdfEngine={pdfEngine}
                isOffline={isOffline}
                onSingleTap={() => setShowControls(!showControls)}
                isHalfScreen={isHalfScreen}
              />
            </View>
          </TouchableWithoutFeedback>

          {/* Footer — shown when download/share is enabled OR onViewProfile exists */}
          {shouldShowControls && (showDownload || showShare || onViewProfile) && (
            <View style={[styles.footer, !showShare && !showDownload && { justifyContent: 'center' }, isLandscape && styles.landscapeOverlayFooter]}>
              {showDownload && (
              <TouchableOpacity
                style={[styles.footerAction, ((!localUri && isDownloading) || isSaving) && { opacity: 0.5 }]}
                onPress={saveToDevice}
                disabled={(isDownloading && !localUri) || isSaving}
              >
                {isSaving ? (
                  <ActivityIndicator size="small" color={COLORS.primary} />
                ) : (
                  <Ionicons
                    name={isSaved ? 'checkmark-circle' : 'cloud-download-outline'}
                    size={20}
                    color={isSaved ? '#10b981' : COLORS.primary}
                  />
                )}
                <Text style={[styles.footerActionText, isSaved && { color: '#10b981' }]}>
                  {isSaving ? 'Saving…' : isSaved ? 'Saved!' : 'Save to Device'}
                </Text>
              </TouchableOpacity>
              )}
              {showShare && (
                <TouchableOpacity style={styles.footerAction} onPress={shareFile}>
                  <Ionicons name="share-social-outline" size={20} color={COLORS.primary} />
                  <Text style={styles.footerActionText}>Share</Text>
                </TouchableOpacity>
              )}
              {onViewProfile && (
                <TouchableOpacity style={styles.footerAction} onPress={onViewProfile}>
                  <Ionicons name="person-circle-outline" size={20} color={COLORS.primary} />
                  <Text style={styles.footerActionText}>View Full Profile</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </BlurView>
    </SafeOverlayContainer>
  );
};

// ── Video Player — expo-av native player ─────────────────────────────────────
function VideoPlayer({ localUri, remoteUrl }: { localUri: string | null; remoteUrl: string }) {
  const rawSrc = localUri || remoteUrl;
  const videoSrc = rawSrc && !rawSrc.startsWith('http') && !rawSrc.startsWith('file://')
    ? `file://${rawSrc}`
    : rawSrc;

  return (
    <View style={styles.videoContainer}>
      <Video
        source={{ uri: videoSrc } as any}
        rate={1.0}
        volume={1.0}
        isMuted={false}
        resizeMode={ResizeMode.CONTAIN}
        shouldPlay={false}
        useNativeControls={true}
        style={styles.video}
        onError={(err) => {
          Sentry.captureException(new Error(`expo-av Video error: ${JSON.stringify(err)}`), {
            tags: { location: 'UniversalViewer.VideoPlayer' },
            extra: { videoSrc },
          });
          Alert.alert('Playback Error', 'Could not play this video. The file may be corrupted or in an unsupported format.');
        }}
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

// react-native-pdf Hardware Accelerated Renderer — full-width, zoom, rotation, page counter
function PdfJsViewer({ localUri, remoteUrl, scaleMultiplier = 1.0, onSingleTap }: {
  localUri: string | null;
  remoteUrl: string;
  scaleMultiplier?: number;
  onSingleTap?: () => void;
}) {
  const [numPages, setNumPages] = React.useState(0);
  const [currentPage, setCurrentPage] = React.useState(1);
  const [rotation, setRotation] = React.useState(0);
  const [zoom, setZoom] = React.useState(scaleMultiplier);

  let source;
  if (localUri) {
    source = { uri: localUri.startsWith('file://') ? localUri : `file://${localUri}`, cache: true };
  } else {
    source = { uri: remoteUrl, cache: true };
  }

  const rotContainer = rotation !== 0
    ? { transform: [{ rotate: `${rotation}deg` }] }
    : {};

  return (
    <View style={{ flex: 1, backgroundColor: '#1e293b' }}>
      <View style={[{ flex: 1, width: '100%' }, rotContainer]}>
        <Pdf
          source={source}
          style={{ flex: 1, width: '100%', backgroundColor: 'transparent' }}
          scale={zoom}
          minScale={0.5}
          maxScale={5.0}
          singlePage={false}
          enableAntialiasing={true}
          enablePaging={false}
          fitPolicy={0}
          spacing={16}
          onLoadComplete={(count) => { setNumPages(count); }}
          onPageChanged={(page) => { setCurrentPage(page); }}
          onPageSingleTap={() => onSingleTap?.()}
          onError={(error) => {
            Sentry.captureException(new Error(`PDF rendering error: ${error}`));
          }}
        />
      </View>

      <View style={pdfCtrl.container}>
        <TouchableOpacity style={pdfCtrl.btn} onPress={() => setZoom(z => Math.max(0.5, +(z - 0.25).toFixed(2)))}>
          <Ionicons name="remove" size={18} color="#fff" />
        </TouchableOpacity>
        <Text style={pdfCtrl.label}>{Math.round(zoom * 100)}%</Text>
        <TouchableOpacity style={pdfCtrl.btn} onPress={() => setZoom(z => Math.min(5, +(z + 0.25).toFixed(2)))}>
          <Ionicons name="add" size={18} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity style={pdfCtrl.btn} onPress={() => setZoom(scaleMultiplier)}>
          <Ionicons name="resize" size={16} color="#fff" />
        </TouchableOpacity>
        <View style={pdfCtrl.divider} />
        <TouchableOpacity style={pdfCtrl.btn} onPress={() => setRotation(r => (r + 90) % 360)}>
          <Ionicons name="refresh-outline" size={18} color="#fff" />
        </TouchableOpacity>
        <View style={pdfCtrl.divider} />
        <View style={pdfCtrl.pageBadge}>
          <Ionicons name="document-text-outline" size={12} color="#94a3b8" />
          <Text style={pdfCtrl.pageText}>{currentPage}/{numPages || '?'}</Text>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
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
  videoContainer: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
  video: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#000000',
    alignSelf: 'stretch',
  },
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
