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

const { width } = Dimensions.get('window');

export default function NewsScreen() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  
  const [news, setNews] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);

  const fetchNews = useCallback(async (pageIndex: number = 0) => {
    if (pageIndex > 0) setIsFetchingMore(true);
    
    try {
      const { data, error } = await supabase
        .from('news')
        .select('*')
        .order('created_at', { ascending: false })
        .range(pageIndex * 20, (pageIndex * 20) + 19);

      if (error) throw error;
      const items = (data || []) as any[];
      
      setHasMore(items.length >= 20);
      setNews(prev => pageIndex === 0 ? items : [...prev, ...items]);
      setPage(pageIndex);
    } catch (err) {
      console.error('Error fetching news:', err);
    } finally {
      setIsLoading(false);
      setIsFetchingMore(false);
    }
  }, []);

  useEffect(() => {
    fetchNews(0);
  }, [fetchNews]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await fetchNews(0);
    setIsRefreshing(false);
  };

  const handleLoadMore = () => {
    if (!hasMore || isFetchingMore || isLoading) return;
    fetchNews(page + 1);
  };

  const renderItem = ({ item }: { item: any }) => {
    const cardBg = isDark ? '#1E2638' : '#FFFFFF';
    const textColor = isDark ? '#FFFFFF' : '#0f172a'; // dark navy title
    const bodyColor = isDark ? '#cbd5e1' : '#475569'; // dark grey body text
    const borderColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';

    let formattedDate = '';
    if (item.created_at) {
      try {
        formattedDate = format(new Date(item.created_at), 'MMM d, yyyy');
      } catch (e) {
        formattedDate = '';
      }
    }

    return (
      <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
        {item.image_url ? (
          <View style={styles.heroContainer}>
            <Image 
              source={{ uri: item.image_url }} 
              style={styles.heroImage}
              resizeMode="cover"
            />
            {item.category && (
              <View style={styles.badgeOverlay}>
                <Text style={styles.badgeText}>{item.category.toUpperCase()}</Text>
              </View>
            )}
          </View>
        ) : (
          item.category && (
            <View style={[styles.badgeOverlay, { position: 'relative', alignSelf: 'flex-start', margin: 16, marginBottom: 0 }]}>
              <Text style={styles.badgeText}>{item.category.toUpperCase()}</Text>
            </View>
          )
        )}
        
        <View style={styles.cardContent}>
          <Text style={[styles.title, { color: textColor }]} numberOfLines={2}>
            {item.title}
          </Text>
          
          <View style={styles.metadataRow}>
            <Ionicons name="calendar-outline" size={14} color={bodyColor} />
            <Text style={[styles.dateText, { color: bodyColor }]}>{formattedDate}</Text>
          </View>

          <Text style={[styles.bodyText, { color: bodyColor }]} numberOfLines={3}>
            {item.content}
          </Text>

          <TouchableOpacity style={styles.readMoreButton}>
            <Text style={styles.readMoreText}>Read More</Text>
            <Ionicons name="chevron-forward" size={16} color={COLORS.primary} />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 10, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Campus News</Text>
        <View style={{ width: 40 }} />
      </View>

      {isLoading && news.length === 0 ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : (
        <FlatList
          data={news}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 20 }]}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />
          }
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            isFetchingMore ? (
              <View style={styles.footerLoader}>
                <ActivityIndicator size="small" color={COLORS.primary} />
              </View>
            ) : null
          }
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
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 3,
  },
  heroContainer: {
    width: '100%',
    height: 200,
    position: 'relative',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  badgeOverlay: {
    position: 'absolute',
    top: 16,
    left: 16,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  cardContent: {
    padding: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 28,
    marginBottom: 8,
  },
  metadataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 6,
  },
  dateText: {
    fontSize: 13,
    fontWeight: '500',
  },
  bodyText: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 16,
  },
  readMoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
  },
  readMoreText: {
    color: COLORS.primary,
    fontSize: 15,
    fontWeight: '600',
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
