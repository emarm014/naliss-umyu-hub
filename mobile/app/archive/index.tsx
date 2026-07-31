import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Platform,
  Alert
} from 'react-native';
import { supabase } from '../../src/api/supabase/client';
import { UniversalViewer } from '../../src/components/common/UniversalViewer';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../src/constants/Colors';
import { useTheme } from '../../src/stores/theme.store';
import { useNetworkStore } from '../../src/stores/network.store';
import { downloadFile, extractFileNameFromUrl, checkFileExists, getVaultFilePath } from '../../src/utils/download';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { cacheEntityList, getCachedEntityList } from '../../src/lib/database';
import { mmkvStorage } from '../../src/stores/mmkv.storage';

import { useArchiveStore } from '../../src/stores/archive.store';

export default function ArchiveScreen() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  
  const archives = useArchiveStore(s => s.archives);
  const isLoading = useArchiveStore(s => s.isLoading);
  const isFetchingMore = useArchiveStore(s => s.isFetchingMore);
  const hasMore = useArchiveStore(s => s.hasMore);
  const page = useArchiveStore(s => s.page);
  const fetchArchives = useArchiveStore(s => s.fetchArchives);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [downloadedIds, setDownloadedIds] = useState<Record<string, boolean>>({});
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number | null>>({});
  
  const isOnline = useNetworkStore(s => s.isOnline);

  const [viewerVisible, setViewerVisible] = useState(false);
  const [readerUrl, setReaderUrl] = useState<string>('');
  const [readerFileType, setReaderFileType] = useState<'image' | 'video' | 'pdf' | 'audio' | 'document'>('document');
  const [readerTitle, setReaderTitle] = useState('');

  const markAsRead = useArchiveStore(s => s.markAsRead);

  useEffect(() => {
    markAsRead();
    fetchArchives(0);
  }, [fetchArchives, markAsRead]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await fetchArchives(0, true);
    setIsRefreshing(false);
  };

  const handleLoadMore = () => {
    if (!hasMore || isFetchingMore || isLoading) return;
    fetchArchives(page + 1);
  };

  const openExternalDocument = async (vaultPath: string, rawMime: string, fileName: string) => {
    try {
      const fileUri = vaultPath.startsWith('file://') ? vaultPath : `file://${vaultPath}`;
      const nameLower = (fileName || vaultPath).toLowerCase();

      // Deduce precise MIME type for Android ACTION_VIEW intent so only supported viewer apps are presented
      let mimeType = rawMime || 'application/octet-stream';
      if (nameLower.endsWith('.pdf')) mimeType = 'application/pdf';
      else if (nameLower.endsWith('.doc')) mimeType = 'application/msword';
      else if (nameLower.endsWith('.docx')) mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      else if (nameLower.endsWith('.xls')) mimeType = 'application/vnd.ms-excel';
      else if (nameLower.endsWith('.xlsx')) mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      else if (nameLower.endsWith('.ppt')) mimeType = 'application/vnd.ms-powerpoint';
      else if (nameLower.endsWith('.pptx')) mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      else if (nameLower.endsWith('.txt')) mimeType = 'text/plain';
      else if (nameLower.endsWith('.csv')) mimeType = 'text/csv';

      if (Platform.OS === 'android') {
        const IntentLauncher = require('expo-intent-launcher');
        const FileSystem = require('expo-file-system');

        // Convert file:// URI to content:// URI so target app is granted read permissions
        const contentUri = await FileSystem.getContentUriAsync(fileUri);

        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
          data: contentUri,
          flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
          type: mimeType,
        });
      } else {
        const Sharing = require('expo-sharing');
        const isAvail = await Sharing.isAvailableAsync();
        if (!isAvail) {
          Alert.alert(
            'No App Available',
            'No app available on your device supports opening this file format. Please use the In-App Viewer.'
          );
          return;
        }
        await Sharing.shareAsync(fileUri, { mimeType });
      }
    } catch (err: any) {
      console.warn('Failed to open archive with external app:', err);
      Alert.alert(
        'No App Available',
        'No app available on your device supports opening this file format. Please use the In-App Viewer.'
      );
    }
  };

  const handleRead = async (item: any) => {
    if (!item.file_url) return;
    try {
      let fileType = item.file_type || 'document';
      const displayName = extractFileNameFromUrl(item.file_url, item.title);
      
      let fileUri = item.file_url;
      const safeName = displayName.replace(/[^a-z0-9._-]/gi, '_').toLowerCase();
      const vaultFileName = `${item.id}_${safeName}`;
      const isInVault = await checkFileExists(vaultFileName, item.file_url, item.id);
      
      if (!isInVault && !isOnline) {
        Alert.alert(
          'Offline Mode',
          "This reference resource hasn't been saved to your device yet. Please connect to the internet to download."
        );
        return;
      }
      
      if (isInVault) {
        fileUri = getVaultFilePath(item.id, displayName, item.file_url);
      }

      const url = (item.file_url || '').toLowerCase();
      const type = (item.file_type || '').toLowerCase();
      const name = (displayName || item.title || '').toLowerCase();

      const isImage = type === 'image' || url.match(/\.(jpg|jpeg|png|webp|gif|svg|bmp|tiff|heic)$/) !== null || name.match(/\.(jpg|jpeg|png|webp|gif|svg)$/) !== null;
      const isVideo = type === 'video' || url.match(/\.(mp4|mov|avi|webm|mkv|m4v)$/) !== null || name.match(/\.(mp4|mov|avi|webm)$/) !== null;

      // Images and Videos MUST open directly in the in-app viewer with no external app option
      if (isImage || isVideo || !isInVault) {
        setReaderUrl(fileUri);
        setReaderFileType(fileType);
        setReaderTitle(displayName);
        setViewerVisible(true);
        return;
      }

      // Documents (PDF, Word, PPT, Excel, Text, etc.) ask user to open in-app or open with another app
      const vaultPath = getVaultFilePath(item.id, displayName, item.file_url);
      Alert.alert('Open File', displayName, [
        {
          text: 'Open in App',
          onPress: () => {
            setReaderUrl(fileUri);
            setReaderFileType(fileType);
            setReaderTitle(displayName);
            setViewerVisible(true);
          },
        },
        {
          text: 'Open with Other App',
          onPress: () => openExternalDocument(vaultPath, item.file_type, displayName),
        },
        { text: 'Cancel', style: 'cancel' },
      ]);
    } catch (err) {
      Alert.alert('Error', 'Could not open the viewer.');
    }
  };

  const handleDownload = async (item: any) => {
    if (!item.file_url) return;
    
    if (!isOnline) {
      Alert.alert('Offline Mode', 'Please connect to the internet to download resources.');
      return;
    }
    
    try {
      setDownloadProgress(prev => ({ ...prev, [item.id]: 1 }));
      const displayName = extractFileNameFromUrl(item.file_url, item.title);
      const resultUri = await downloadFile(
        item.file_url,
        item.id,
        displayName,
        (p: number) => {
          const pct = Math.round(p * 100);
          setDownloadProgress(prev => ({ ...prev, [item.id]: Math.max(pct, 1) }));
        }
      );
      if (resultUri) {
        setDownloadedIds(prev => ({ ...prev, [item.id]: true }));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setDownloadProgress(prev => ({ ...prev, [item.id]: null }));
    }
  };

  const renderItem = ({ item }: { item: any }) => {
    const isDownloaded = downloadedIds[item.id];
    const progress = downloadProgress[item.id];
    const isDownloading = progress !== null && progress !== undefined;
    
    const cardBg = isDark ? '#1E2638' : '#FFFFFF';
    const borderCol = isDark ? '#2D3748' : '#E2E8F0';
    const textPrimary = isDark ? '#FFFFFF' : '#0f172a';
    const textMuted = isDark ? '#A0AEC0' : '#64748b';
    
    const isPdf = item.file_type === 'pdf';
    const isVideo = item.file_type === 'video';
    const isImg = item.file_type === 'image';

    const iconConfig = isPdf
      ? { label: 'PDF', bg: '#FEE2E2', color: '#EF4444', icon: 'document-text' }
      : isImg
      ? { label: 'IMG', bg: '#FEF3C7', color: '#D97706', icon: 'image' }
      : isVideo
      ? { label: 'VID', bg: '#F3E8FF', color: '#9333EA', icon: 'film' }
      : { label: 'DOC', bg: '#DBEAFE', color: '#2563EB', icon: 'document' };

    return (
      <View style={[styles.card, { backgroundColor: cardBg, borderColor: borderCol }]}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: textPrimary }]} numberOfLines={2}>{item.title}</Text>
            {item.description && item.description.trim().toLowerCase() !== item.title.trim().toLowerCase() ? (
              <Text style={[styles.description, { color: textMuted }]} numberOfLines={2}>{item.description}</Text>
            ) : null}
          </View>
        </View>

        <View style={[{ flexDirection: 'row', alignItems: 'center', backgroundColor: isDark ? '#2D3748' : '#F8FAFC', padding: 12, borderRadius: 16, borderWidth: 1, borderColor: isDark ? '#4A5568' : '#E2E8F0' }, isDownloaded && { borderColor: '#005A36', backgroundColor: isDark ? '#1C4532' : '#F0FDF4' }]}>
          <View style={[styles.iconBox, { backgroundColor: iconConfig.bg }]}>
            <Ionicons name={iconConfig.icon as any} size={20} color={iconConfig.color} />
          </View>
          
          <View style={[styles.resInfo, { marginLeft: 12, flex: 1 }]}>
            <Text style={[{ fontFamily: 'Inter-SemiBold', fontSize: 13, color: textPrimary }]} numberOfLines={1}>
              {extractFileNameFromUrl(item.file_url, item.title)}
            </Text>
            <View style={styles.metaRow}>
              {item.file_size ? <Text style={[styles.metaText, { color: textMuted }]}>{item.file_size}</Text> : null}
              {isDownloaded && (
                <View style={[styles.offlinePill, { marginLeft: 6 }]}>
                  <Ionicons name="checkmark-circle" size={10} color="#166534" />
                  <Text style={styles.offlineText}>Saved</Text>
                </View>
              )}
            </View>
            
            {/* Download Progress Bar */}
            {isDownloading && (
              <View style={{ marginTop: 6 }}>
                <View style={{ height: 4, backgroundColor: isDark ? '#374151' : '#E2E8F0', borderRadius: 2, overflow: 'hidden' }}>
                  <View style={{ height: '100%', width: `${progress}%`, backgroundColor: '#10B981', borderRadius: 2 }} />
                </View>
                <Text style={{ fontFamily: 'Inter-Bold', fontSize: 10, color: '#10B981', marginTop: 2 }}>{progress}%</Text>
              </View>
            )}
          </View>

          <View style={[styles.resActions, { marginLeft: 8 }]}>
            <TouchableOpacity onPress={() => handleRead(item)} style={[styles.actionBtn, { backgroundColor: isDownloaded ? (isDark ? '#22543D' : '#DCFCE7') : (isDark ? '#0284c7' : '#f1f5f9') }]}>
              <Ionicons name={isDownloaded ? 'book' : 'eye-outline'} size={16} color={isDownloaded ? '#166534' : (isDark ? '#ffffff' : '#475569')} />
            </TouchableOpacity>
            
            <TouchableOpacity
              onPress={() => handleDownload(item)}
              disabled={isDownloaded || isDownloading}
              style={[styles.actionBtn, { marginLeft: 8 }, isDownloading ? { backgroundColor: '#D1FAE5' } : isDownloaded ? { backgroundColor: isDark ? '#22543D' : '#DCFCE7' } : { backgroundColor: isDark ? '#334155' : '#F1F5F9' }]}
            >
              {isDownloading ? (
                <ActivityIndicator size="small" color="#10B981" />
              ) : (
                <Ionicons 
                  name={isDownloaded ? 'checkmark-circle' : 'cloud-download'} 
                  size={16} 
                  color={isDownloaded ? '#166534' : '#10B981'}
                />
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Institutional Archive</Text>
      </View>

      {isLoading ? (
        <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={archives}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContainer}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            isFetchingMore ? <ActivityIndicator size="small" color={COLORS.primary} style={{ marginTop: 20 }} /> : null
          }
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />
          }
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Ionicons name="library-outline" size={40} color={isDark ? '#4ade80' : COLORS.textMuted} style={{ marginBottom: 16 }} />
              <Text style={[styles.emptyTitle, { color: isDark ? '#FFFFFF' : COLORS.text }]}>No archives found</Text>
              <Text style={[styles.emptyText, { color: isDark ? '#94a3b8' : COLORS.textMuted }]}>
                Check back later for new institutional research items.
              </Text>
            </View>
          }
        />
      )}

      <UniversalViewer
        isVisible={viewerVisible}
        onClose={() => setViewerVisible(false)}
        fileUri={readerUrl}
        fileType={readerFileType}
        fileName={readerTitle}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1 },
  backButton: { padding: 4, marginRight: 12 },
  headerTitle: { fontFamily: 'Inter-Bold', fontSize: 18 },
  listContainer: { padding: 16, paddingBottom: 40 },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 16, flexDirection: 'column', alignItems: 'stretch' },
  title: { fontFamily: 'Inter-Bold', fontSize: 16, marginBottom: 4 },
  description: { fontFamily: 'Inter-Medium', fontSize: 13 },
  iconBox: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  resInfo: { flex: 1, marginLeft: 12 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  metaText: { fontFamily: 'Inter-Medium', fontSize: 12 },
  offlinePill: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#DCFCE7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, gap: 2 },
  offlineText: { fontFamily: 'Inter-Bold', fontSize: 9, color: '#166534' },
  resActions: { flexDirection: 'row', alignItems: 'center' },
  actionBtn: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  emptyCard: { padding: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent', borderRadius: 24, borderWidth: 1, borderColor: 'transparent', marginTop: 20 },
  emptyTitle: { fontFamily: 'Inter-Bold', fontSize: 16, marginBottom: 8 },
  emptyText: { fontFamily: 'Inter-Medium', fontSize: 13, textAlign: 'center' },
});
