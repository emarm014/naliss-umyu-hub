import React from 'react';
import {
  StyleSheet, View, Text, FlatList, TouchableOpacity,
  RefreshControl, ActivityIndicator, Dimensions
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { supabase } from '../../src/api/supabase/client';
import { mmkvStorage } from '../../src/stores/mmkv.storage';
import { useTheme } from '../../src/stores/theme.store';
import { Header } from '../../src/components/common/Header';
import { CachedImage } from '../../src/components/common/CachedImage';
import { useSentryScreen } from '../../src/hooks/useSentryScreen';

const { width } = Dimensions.get('window');
const TOPICS_CACHE_KEY = 'gallery_topics_cache';

export default function GalleryScreen() {
  useSentryScreen('GalleryScreen');
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const { data: topics = [], isLoading, refetch, isRefetching } = useQuery<any[]>({
    queryKey: ['gallery_topics'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gallery_topics')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      const result = data || [];
      // Cache for offline
      Promise.resolve(mmkvStorage.setItem(TOPICS_CACHE_KEY, JSON.stringify(result))).catch(() => {});
      return result;
    },
    staleTime: 5 * 60 * 1000,
  });

  const renderHeader = () => (
    <View style={styles.heroContainer}>
      <LinearGradient
        colors={[colors.primary, '#0369a1']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.heroGradient, { borderRadius: 24 }]}
      >
        <View style={styles.heroContent}>
          <View style={styles.heroIconContainer}>
            <Ionicons name="images" size={32} color={colors.white} />
          </View>
          <Text style={[styles.heroTitle, { color: colors.white }]}>
            Welcome to the Departmental Gallery
          </Text>
          <Text style={[styles.heroSubtitle, { color: 'rgba(255,255,255,0.8)' }]}>
            Explore moments and memories from the Library and Information Science Students, UMYU
          </Text>
        </View>
        
        {/* Decorative elements */}
        <View style={styles.decorCircle1} />
        <View style={styles.decorCircle2} />
      </LinearGradient>
    </View>
  );

  const renderTopic = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={[styles.topicCard, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={() => router.push(`/gallery/${item.id}` as any)}
      activeOpacity={0.7}
    >
      <View style={[styles.coverContainer, { backgroundColor: colors.background }]}>
        {item.cover_image ? (
          <CachedImage
            remoteUrl={item.cover_image}
            style={styles.coverImage}
            resizeMode="cover"
            entityId={item.id}
            assetType="gallery_cover"
          />
        ) : (
          <View style={[styles.placeholderCover, { backgroundColor: isDark ? '#1f2937' : '#f3f4f6' }]}>
            <Ionicons name="image-outline" size={48} color={colors.textSecondary} />
          </View>
        )}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.8)']}
          style={styles.coverGradient}
        >
          <Text style={styles.topicDate}>
            {format(new Date(item.created_at), 'MMM d, yyyy')}
          </Text>
        </LinearGradient>
      </View>
      <View style={styles.topicInfo}>
        <Text style={[styles.topicTitle, { color: colors.text }]} numberOfLines={2}>
          {item.title}
        </Text>
        {item.description ? (
          <Text style={[styles.topicDescription, { color: colors.textSecondary }]} numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <Header title="Gallery" showBack />
      
      <FlatList
        data={topics}
        keyExtractor={item => item.id}
        renderItem={renderTopic}
        ListHeaderComponent={renderHeader}
        contentContainerStyle={styles.listContent}
        numColumns={2}
        columnWrapperStyle={styles.row}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Ionicons name="images-outline" size={64} color={colors.border} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>No Albums Yet</Text>
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                Check back later for new photos and memories.
              </Text>
            </View>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    padding: 16,
    paddingBottom: 40,
  },
  heroContainer: {
    marginBottom: 24,
  },
  heroGradient: {
    padding: 24,
    overflow: 'hidden',
  },
  heroContent: {
    position: 'relative',
    zIndex: 2,
    alignItems: 'center',
    textAlign: 'center',
  },
  heroIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  heroTitle: {
    fontSize: 22,
    fontFamily: 'Inter-Bold',
    textAlign: 'center',
    marginBottom: 8,
    lineHeight: 30,
  },
  heroSubtitle: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 10,
  },
  decorCircle1: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(255,255,255,0.1)',
    top: -50,
    right: -50,
  },
  decorCircle2: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: 'rgba(255,255,255,0.1)',
    bottom: -30,
    left: -30,
  },
  row: {
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  topicCard: {
    width: (width - 48) / 2, // 2 columns, 16px padding on sides + 16px gap
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  coverContainer: {
    height: 140,
    width: '100%',
    position: 'relative',
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
  placeholderCover: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 60,
    justifyContent: 'flex-end',
    padding: 10,
  },
  topicDate: {
    color: 'white',
    fontSize: 11,
    fontFamily: 'Inter-Medium',
  },
  topicInfo: {
    padding: 12,
  },
  topicTitle: {
    fontSize: 14,
    fontFamily: 'Inter-SemiBold',
    lineHeight: 20,
  },
  topicDescription: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    marginTop: 4,
    lineHeight: 16,
  },
  emptyState: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: 'Inter-SemiBold',
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    textAlign: 'center',
    marginTop: 8,
  },
});
