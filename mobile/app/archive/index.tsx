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

export default function ArchiveScreen() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  
  const [archives, setArchives] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [downloadedIds, setDownloadedIds] = useState<Record<string, boolean>>({});
  const [downloadingIds, setDownloadingIds] = useState<Record<string, boolean>>({});
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const isOnline = useNetworkStore(s => s.isOnline);

  const [viewerVisible, setViewerVisible] = useState(false);
  const [readerUrl, setReaderUrl] = useState<string>('');
  const [readerFileType, setReaderFileType] = useState<'image' | 'video' | 'pdf' | 'audio' | 'document'>('document');
  const [readerTitle, setReaderTitle] = useState('');

  const fetchArchives = useCallback(async (pageIndex: number = 0) => {
    if (pageIndex > 0) setIsFetchingMore(true);
    
    try {
      const { data, error } = await supabase
        .from('archives')
        .select('*')
        .order('created_at', { ascending: false })
        .range(pageIndex * 20, (pageIndex * 20) + 19);

      if (error) throw error;
      const items = (data || []) as any[];
      
      setHasMore(items.length >= 20);
      setArchives(prev => pageIndex === 0 ? items : [...prev, ...items]);
      setPage(pageIndex);
      
      const cacheStatus: Record<string, boolean> = {};
      for (const item of items) {
        const displayName = extractFileNameFromUrl(item.file_url, item.title);
        const safeName = displayName.replace(/[^a-z0-9._-]/gi, '_').toLowerCase();
        const vaultFileName = `${item.id}_${safeName}`;
        const isInVault = await checkFileExists(vaultFileName, item.file_url, item.id);
        if (isInVault) {
          cacheStatus[item.id] = true;
        }
      }
      setDownloadedIds(prev => ({ ...prev, ...cacheStatus }));
    } catch (err) {
      console.error('Error fetching archives:', err);
      if (pageIndex === 0) Alert.alert('Error', 'Failed to load archives');
    } finally {
      setIsLoading(false);
      setIsFetchingMore(false);
    }
  }, []);

  useEffect(() => {
    fetchArchives(0);
  }, [fetchArchives]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await fetchArchives(0);
    setIsRefreshing(false);
  };

  const handleLoadMore = () => {
    if (!hasMore || isFetchingMore || isLoading) return;
    fetchArchives(page + 1);
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

      setReaderUrl(fileUri);
      setReaderFileType(fileType);
      setReaderTitle(displayName);
      setViewerVisible(true);
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
      setDownloadingIds(prev => ({ ...prev, [item.id]: true }));
      const displayName = extractFileNameFromUrl(item.file_url, item.title);
      const resultUri = await downloadFile(item.file_url, item.id, displayName);
      if (resultUri) {
        setDownloadedIds(prev => ({ ...prev, [item.id]: true }));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setDownloadingIds(prev => ({ ...prev, [item.id]: false }));
    }
  };

  const renderItem = ({ item }: { item: any }) => {
    const isDownloaded = downloadedIds[item.id];
    const isDownloading = downloadingIds[item.id];
    
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
            {item.description ? (
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
          </View>

          <View style={[styles.resActions, { marginLeft: 8 }]}>
            <TouchableOpacity onPress={() => handleRead(item)} style={[styles.actionBtn, { backgroundColor: isDownloaded ? (isDark ? '#22543D' : '#DCFCE7') : (isDark ? '#0284c7' : '#f1f5f9') }]}>
              <Ionicons name={isDownloaded ? 'book' : 'eye-outline'} size={16} color={isDownloaded ? '#166534' : (isDark ? '#ffffff' : '#475569')} />
            </TouchableOpacity>
            
            <TouchableOpacity
              onPress={() => handleDownload(item)}
              style={[styles.actionBtn, { backgroundColor: isDark ? '#334155' : '#F1F5F9', marginLeft: 8 }]}
              disabled={isDownloaded || isDownloading}
            >
              {isDownloading ? (
                <ActivityIndicator size="small" color="#10B981" />
              ) : (
                <Ionicons 
                  name={isDownloaded ? 'checkmark-circle' : 'cloud-download'} 
                  size={16} 
                  color="#10B981"
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
