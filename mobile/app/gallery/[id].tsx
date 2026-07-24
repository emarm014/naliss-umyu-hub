import React, { useState, useRef } from 'react';
import {
  StyleSheet, View, Text, FlatList, TouchableOpacity,
  Dimensions, ActivityIndicator, Modal, ScrollView,
  SafeAreaView, Alert, Platform, Pressable
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../../src/api/supabase/client';
import { mmkvStorage } from '../../src/stores/mmkv.storage';
import { useTheme } from '../../src/stores/theme.store';
import { Header } from '../../src/components/common/Header';
import { CachedImage } from '../../src/components/common/CachedImage';
import { useSentryScreen } from '../../src/hooks/useSentryScreen';
import { LinearGradient } from 'expo-linear-gradient';
import { ResizeMode, Video } from 'expo-av';

const { width, height } = Dimensions.get('window');

import { useGalleryStore } from '../../src/stores/gallery.store';

export default function GalleryTopicScreen() {
  useSentryScreen('GalleryTopicScreen');
  const { id } = useLocalSearchParams();
  const { colors, isDark } = useTheme();
  
  const [selectedMediaIndex, setSelectedMediaIndex] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  const topicIdStr = typeof id === 'string' ? id : id[0];
  
  const [topic, setTopic] = useState<any>(null);
  
  const mediaByTopic = useGalleryStore(s => s.mediaByTopic);
  const isLoadingMediaDict = useGalleryStore(s => s.isLoadingMedia);
  
  const fetchTopicDetails = useGalleryStore(s => s.fetchTopicDetails);
  const fetchMedia = useGalleryStore(s => s.fetchMedia);

  const media = mediaByTopic[topicIdStr] || [];
  const isLoading = isLoadingMediaDict[topicIdStr] || false;

  React.useEffect(() => {
      fetchTopicDetails(topicIdStr).then(t => { if (t) setTopic(t) });
      fetchMedia(topicIdStr);
  }, [topicIdStr, fetchTopicDetails, fetchMedia]);

  const downloadMediaToDevice = async (url: string, filename: string) => {
    try {
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return url.startsWith('file://') ? url : `file://${url}`;
      }
      const fileUri = `${(FileSystem as any).cacheDirectory || 'file:///tmp/'}${filename}`;
      const downloadResult = await FileSystem.downloadAsync(url, fileUri);
      return downloadResult.uri;
    } catch (e) {
      console.error(e);
      return null;
    }
  };

  const handleShare = async (mediaItem: any) => {
    try {
      setIsSaving(true);
      const isVideo = mediaItem.media_type === 'video';
      const filename = `naliss_share_${mediaItem.id}.${isVideo ? 'mp4' : 'jpg'}`;
      const localUri = await downloadMediaToDevice(mediaItem.media_url, filename);
      
      if (localUri) {
        const isAvailable = await Sharing.isAvailableAsync();
        if (isAvailable) {
          await Sharing.shareAsync(localUri);
        } else {
          Alert.alert('Sharing not available on this device');
        }
      }
    } catch (error) {
      Alert.alert('Error', 'Could not share this item.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveToDevice = async (mediaItem: any) => {
    try {
      setIsSaving(true);
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please grant permission to save media to your gallery.');
        return;
      }
      
      const isVideo = mediaItem.media_type === 'video';
      const filename = `naliss_${mediaItem.id}.${isVideo ? 'mp4' : 'jpg'}`;
      const localUri = await downloadMediaToDevice(mediaItem.media_url, filename);
      
      if (localUri) {
        await MediaLibrary.saveToLibraryAsync(localUri);
        Alert.alert('Saved!', 'Media has been saved to your device gallery.');
      }
    } catch (error) {
      Alert.alert('Error', 'Could not save this item.');
    } finally {
      setIsSaving(false);
    }
  };

  const renderGridItem = ({ item, index }: { item: any, index: number }) => {
    const isVideo = item.media_type === 'video';
    
    // Dynamic width based on media length
    let itemWidth = (width - 4) / 3;
    let itemHeight = itemWidth;
    
    if (media.length === 1) {
      itemWidth = width - 4;
      itemHeight = width * 0.75;
    } else if (media.length === 2) {
      itemWidth = (width - 4) / 2;
      itemHeight = itemWidth;
    }

    return (
      <TouchableOpacity
        style={[styles.gridItem, { width: itemWidth, height: itemHeight }]}
        onPress={() => setSelectedMediaIndex(index)}
        activeOpacity={0.8}
      >
        <CachedImage
          remoteUrl={item.media_url}
          style={styles.gridImage}
          resizeMode="cover"
          entityId={item.id}
          assetType="gallery"
        />
        {isVideo && (
          <View style={styles.videoIndicator}>
            <Ionicons name="play-circle" size={32} color="rgba(255,255,255,0.9)" />
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const renderFullScreenItem = ({ item }: { item: any }) => {
    const isVideo = item.media_type === 'video';
    return (
      <View style={{ width, height: height - 100, justifyContent: 'center', alignItems: 'center' }}>
        {isVideo ? (
          <Video
            source={{ uri: item.media_url }}
            style={{ width, height: width * (16 / 9) }}
            useNativeControls
            resizeMode={ResizeMode.CONTAIN}
            isLooping
          />
        ) : (
          <ScrollView
            maximumZoomScale={3}
            minimumZoomScale={1}
            contentContainerStyle={styles.scrollContent}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
          >
            <CachedImage
              remoteUrl={item.media_url}
              style={{ width, height: height - 100 } as any}
              resizeMode="contain"
              entityId={item.id}
              assetType="gallery"
            />
          </ScrollView>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Header title={topic?.title || 'Album'} showBack />
      
      {topic?.description && (
        <View style={[styles.descriptionContainer, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <Text style={[styles.description, { color: colors.text }]}>{topic.description}</Text>
        </View>
      )}

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : media.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="images-outline" size={48} color={colors.textSecondary} />
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No media in this album yet.</Text>
        </View>
      ) : (
        <FlatList
          data={media}
          keyExtractor={item => item.id}
          renderItem={renderGridItem}
          numColumns={media.length === 1 ? 1 : media.length === 2 ? 2 : 3}
          key={media.length === 1 ? 'one' : media.length === 2 ? 'two' : 'three'}
          contentContainerStyle={styles.gridContent}
        />
      )}

      <Modal
        visible={selectedMediaIndex !== null}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setSelectedMediaIndex(null)}
      >
        <View style={styles.modalContainer}>
          <SafeAreaView style={styles.modalHeader}>
            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => setSelectedMediaIndex(null)}
            >
              <Ionicons name="close" size={28} color="white" />
            </TouchableOpacity>
            
            <View style={styles.headerActions}>
              {isSaving ? (
                <ActivityIndicator size="small" color="white" style={{ marginRight: 16 }} />
              ) : (
                <>
                  <Text style={[styles.counterText, { color: colors.textSecondary }]}>
                    {topic?.total_media || media.length} Items
                  </Text>
                  <TouchableOpacity
                    style={styles.iconButton}
                    onPress={() => handleSaveToDevice(media[selectedMediaIndex!])}
                  >
                    <Ionicons name="download-outline" size={24} color="white" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.iconButton}
                    onPress={() => handleShare(media[selectedMediaIndex!])}
                  >
                    <Ionicons name="share-social-outline" size={24} color="white" />
                  </TouchableOpacity>
                </>
              )}
            </View>
          </SafeAreaView>

          <FlatList
            ref={flatListRef}
            data={media}
            keyExtractor={item => item.id}
            renderItem={renderFullScreenItem}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            removeClippedSubviews={false}
            initialScrollIndex={selectedMediaIndex || 0}
            getItemLayout={(data, index) => ({ length: width, offset: width * index, index })}
            onScrollToIndexFailed={info => {
              const wait = new Promise(resolve => setTimeout(resolve, 100));
              wait.then(() => {
                flatListRef.current?.scrollToIndex({ index: info.index, animated: false });
              });
            }}
            onMomentumScrollEnd={(e) => {
              const newIndex = Math.round(e.nativeEvent.contentOffset.x / width);
              if (newIndex !== selectedMediaIndex) {
                setSelectedMediaIndex(newIndex);
              }
            }}
          />

          <SafeAreaView style={styles.modalFooter}>
            <Text style={styles.counterText}>
              {selectedMediaIndex !== null ? selectedMediaIndex + 1 : 0} / {media.length}
            </Text>
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  descriptionContainer: {
    padding: 16,
    borderBottomWidth: 1,
  },
  description: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    lineHeight: 20,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyText: {
    marginTop: 12,
    fontFamily: 'Inter-Medium',
  },
  gridContent: {
    padding: 2,
  },
  gridItem: {
    width: (width - 4) / 3,
    height: (width - 4) / 3,
    padding: 1,
    position: 'relative',
  },
  gridImage: {
    width: '100%',
    height: '100%',
    backgroundColor: '#333',
  },
  videoIndicator: {
    position: 'absolute',
    inset: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: 'black',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? 20 : 0,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconButton: {
    padding: 12,
  },
  scrollContent: {
    justifyContent: 'center',
    alignItems: 'center',
    flexGrow: 1,
  },
  modalFooter: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  counterText: {
    color: 'white',
    fontFamily: 'Inter-Medium',
    fontSize: 14,
  }
});
