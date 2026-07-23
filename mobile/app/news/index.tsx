import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Image,
  Dimensions,
  Platform
} from 'react-native';
import { supabase } from '../../src/api/supabase/client';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../src/constants/Colors';
import { useTheme } from '../../src/stores/theme.store';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { format } from 'date-fns';
import { useNewsStore } from '../../src/stores/news.store';
import { cacheEntityList, getCachedEntityList } from '../../src/lib/database';
import { UniversalViewer } from '../../src/components/common/UniversalViewer';
import { CachedImage } from '../../src/components/common/CachedImage';

const { width } = Dimensions.get('window');

const NewsCard = ({ 
  item, 
  isDark, 
  colors, 
  onImagePress 
}: { 
  item: any; 
  isDark: boolean; 
  colors: any; 
  onImagePress: (url: string, title: string) => void;
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const cardBg = isDark ? '#1E2638' : '#FFFFFF';
  const textColor = isDark ? '#FFFFFF' : '#0f172a';
  const bodyColor = isDark ? '#cbd5e1' : '#475569';
  const borderColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';

  let formattedDate = '';
  if (item.created_at) {
    try {
      formattedDate = format(new Date(item.created_at), 'MMM d, yyyy');
    } catch (e) {
      formattedDate = '';
    }
  }

  const hasFiles = item.files && Array.isArray(item.files) && item.files.length > 0;
  const imageUrls: string[] = hasFiles 
      ? item.files.map((f: any) => typeof f === 'string' ? f : (f.uri || f.url)).filter(Boolean)
      : (item.image_url ? [item.image_url] : []);

  const totalImages = imageUrls.length;
  const isLongContent = item.content && item.content.length > 180;

  return (
    <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
      {/* Top Header Bar — Category Tag & Date (NEVER overlaps image or body text) */}
      <View style={styles.cardTopHeader}>
        <View style={[styles.categoryBadge, { backgroundColor: COLORS.primary || '#3b82f6' }]}>
          <Ionicons name="pricetag-outline" size={11} color="#FFFFFF" style={{ marginRight: 4 }} />
          <Text style={styles.categoryBadgeText}>
            {(item.category || 'GENERAL').toUpperCase()}
          </Text>
        </View>

        {formattedDate ? (
          <View style={styles.dateRow}>
            <Ionicons name="calendar-outline" size={13} color={isDark ? '#94a3b8' : '#64748b'} />
            <Text style={[styles.dateText, { color: isDark ? '#94a3b8' : '#64748b' }]}>{formattedDate}</Text>
          </View>
        ) : null}
      </View>

      {/* Clickable Image Section */}
      {totalImages === 1 ? (
        <TouchableOpacity 
          style={styles.heroContainer} 
          activeOpacity={0.9}
          onPress={() => onImagePress(imageUrls[0], item.title)}
        >
          <CachedImage 
            remoteUrl={imageUrls[0]} 
            style={styles.heroImage}
            resizeMode="cover"
            entityId={`${item.id}_hero_0`}
            assetType="news_image"
          />
          <View style={styles.imageTapHint}>
            <Ionicons name="expand-outline" size={16} color="#FFFFFF" />
            <Text style={styles.imageTapHintText}>Tap to view & save</Text>
          </View>
        </TouchableOpacity>
      ) : totalImages > 1 ? (
        <View style={styles.albumContainer}>
          <View style={styles.albumGrid}>
            {imageUrls.slice(0, 4).map((url, index) => {
              let itemStyle: any = styles.albumGridItemHalf;
              if (totalImages === 3 && index === 0) itemStyle = styles.albumGridItemFull;

              return (
                <TouchableOpacity 
                  key={index} 
                  style={itemStyle}
                  activeOpacity={0.88}
                  onPress={() => onImagePress(url, item.title)}
                >
                  <CachedImage 
                    remoteUrl={url} 
                    style={styles.albumGridImage} 
                    resizeMode="cover" 
                    entityId={`${item.id}_album_${index}`}
                    assetType="news_image"
                  />
                  {index === 3 && totalImages > 4 && (
                    <View style={styles.albumMoreOverlay}>
                      <Text style={styles.albumMoreText}>+{totalImages - 4}</Text>
                      <Text style={styles.albumMoreSubText}>View All</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ) : null}
      
      {/* Content Area */}
      <View style={styles.cardContent}>
        <Text style={[styles.title, { color: textColor }]}>
          {item.title}
        </Text>

        <Text 
          style={[styles.bodyText, { color: bodyColor }]} 
          numberOfLines={isExpanded ? undefined : 4}
        >
          {item.content}
        </Text>

        {isLongContent && (
          <TouchableOpacity 
            style={styles.readMoreButton} 
            onPress={() => setIsExpanded(!isExpanded)}
            activeOpacity={0.7}
          >
            <Text style={styles.readMoreText}>{isExpanded ? 'Show Less' : 'Read Full Story'}</Text>
            <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={16} color={COLORS.primary} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

export default function NewsScreen() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  
  const news = useNewsStore(s => s.news);
  const isLoading = useNewsStore(s => s.isLoading);
  const fetchNews = useNewsStore(s => s.fetchNews);
  const markAsRead = useNewsStore(s => s.markAsRead);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Full-Screen Image Viewer State
  const [viewerState, setViewerState] = useState<{
    isVisible: boolean;
    fileUri: string;
    fileName: string;
  }>({
    isVisible: false,
    fileUri: '',
    fileName: '',
  });

  useEffect(() => {
    markAsRead();
    fetchNews();
  }, [fetchNews, markAsRead]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await fetchNews(true);
    setIsRefreshing(false);
  };

  const handleLoadMore = () => {
    // Pagination is currently limited to 100 in the store for offline stability.
    // Future update could support infinite scroll if needed.
  };

  const handleOpenImage = (url: string, title: string) => {
    const cleanName = title ? `${title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20)}.jpg` : 'campus_news.jpg';
    setViewerState({
      isVisible: true,
      fileUri: url,
      fileName: cleanName,
    });
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 10, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Campus News</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Main List */}
      {isLoading && news.length === 0 ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : (
        <FlatList
          data={news}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <NewsCard 
              item={item} 
              isDark={isDark} 
              colors={colors} 
              onImagePress={handleOpenImage} 
            />
          )}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 20 }]}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />
          }
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="newspaper-outline" size={64} color={colors.textMuted} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>No News Available</Text>
              <Text style={[styles.emptySub, { color: colors.textMuted }]}>
                Check back later for updates from the campus.
              </Text>
            </View>
          }
        />
      )}

      {/* Interactive Full-Screen Viewer with Save to Device functionality */}
      <UniversalViewer
        isVisible={viewerState.isVisible}
        onClose={() => setViewerState(prev => ({ ...prev, isVisible: false }))}
        fileUri={viewerState.fileUri}
        fileType="image"
        fileName={viewerState.fileName}
        showDownload={true}
        showShare={true}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  listContent: {
    padding: 16,
    gap: 20,
  },
  card: {
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.07,
    shadowRadius: 14,
    elevation: 4,
  },
  cardTopHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
  },
  categoryBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  dateText: {
    fontSize: 12,
    fontWeight: '600',
  },
  heroContainer: {
    width: '100%',
    height: 230,
    position: 'relative',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  imageTapHint: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.65)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  imageTapHintText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },
  albumContainer: {
    width: '100%',
    overflow: 'hidden',
  },
  albumGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 2,
    backgroundColor: '#000',
  },
  albumGridItemHalf: {
    flexBasis: '49.5%',
    flexGrow: 1,
    aspectRatio: 1.1,
  },
  albumGridItemFull: {
    width: '100%',
    aspectRatio: 1.6,
  },
  albumGridImage: {
    width: '100%',
    height: '100%',
  },
  albumMoreOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  albumMoreText: {
    color: '#FFF',
    fontSize: 26,
    fontWeight: '800',
  },
  albumMoreSubText: {
    color: '#E2E8F0',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  cardContent: {
    padding: 18,
    paddingTop: 14,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 26,
    marginBottom: 10,
  },
  bodyText: {
    fontSize: 15,
    lineHeight: 24,
  },
  readMoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    marginTop: 12,
    paddingVertical: 4,
  },
  readMoreText: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  footerLoader: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySub: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
});
