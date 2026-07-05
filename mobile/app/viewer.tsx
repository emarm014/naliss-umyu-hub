import React, { useRef, useState, useEffect } from 'react';
import { FlatList, View, Image, Dimensions, useWindowDimensions, TouchableOpacity, Text, StyleSheet, Alert, StatusBar } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import * as Sharing from 'expo-sharing';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { saveCategorizedFileToDevice, saveMediaToDevice } from '../src/utils/mediaSaver';
import { showToast } from '../src/components/common/overlays';
import { BlurView } from 'expo-blur';
import { UniversalViewer } from '../src/components/common/UniversalViewer';

export default function ViewerScreen() {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const params = useLocalSearchParams();
  const router = useRouter();

  // If no mediaArray is passed, fallback to the old single UniversalViewer
  if (!params.mediaArray) {
    const { uri, name, type } = params as any;
    if (!uri) return null;
    return (
      <UniversalViewer
        isVisible={true}
        onClose={() => router.back()}
        fileUri={uri}
        fileType={(type as any) || 'image'}
        fileName={name || 'File Preview'}
      />
    );
  }

  // Parse incoming media list payload array safely
  const mediaFiles = JSON.parse(params.mediaArray as string || '[]');
  const startIndex = parseInt(params.selectedIndex as string || '0', 10);
  
  const insets = useSafeAreaInsets();
  const flatListRef = useRef<FlatList>(null);
  const activeVideoRef = useRef<Video>(null);
  const [currentIndex, setCurrentIndex] = useState(startIndex);
  const [isSaved, setIsSaved] = useState(false);
  const [videoStatus, setVideoStatus] = useState<any>({});

  const activeItem = mediaFiles[currentIndex];

  const saveToDevice = async () => {
    if (!activeItem) return;
    try {
      const result = await saveMediaToDevice(
        activeItem.media_url,
        activeItem.content_type || 'image',
        activeItem.name
      );
      if (result.success) {
        setIsSaved(true);
        showToast('✓ Saved to Device');
        setTimeout(() => setIsSaved(false), 3000);
      } else {
        Alert.alert('Save Failed', result.error || 'Could not save the file to your device.');
      }
    } catch (error) {
      Alert.alert('Save Failed', 'Could not save the file to your device.');
    }
  };

  const shareFile = async () => {
    if (!activeItem) return;
    try {
      const isAvailable = await Sharing.isAvailableAsync();
      if (!isAvailable) {
        Alert.alert('Unavailable', 'Sharing is not supported on this device.');
        return;
      }
      await Sharing.shareAsync(activeItem.media_url);
    } catch (error) {
      Alert.alert('Error', 'Could not share this file.');
    }
  };

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems && viewableItems.length > 0) {
      setCurrentIndex(viewableItems[0].index);
      setIsSaved(false); // Reset saved state when swiping
      setVideoStatus({}); // Reset video status
    }
  }).current;

  const togglePlay = async () => {
    if (!activeVideoRef.current) return;
    if (videoStatus.isPlaying) {
      await activeVideoRef.current.pauseAsync();
    } else {
      await activeVideoRef.current.playAsync();
    }
  };

  const fmt = (ms: number | undefined) => {
    if (!ms || isNaN(ms)) return '00:00';
    const s = Math.floor(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000000' }}>
      <StatusBar hidden />
      <FlatList
        ref={flatListRef}
        data={mediaFiles}
        horizontal
        pagingEnabled // ⚡ MANDATORY: Automatically snaps each image perfectly to the full screen edge
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item, index) => item.id || `media_${index}`}
        initialScrollIndex={startIndex}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
        getItemLayout={(_, index) => ({
          length: screenWidth,
          offset: screenWidth * index,
          index,
        })}
        renderItem={({ item, index }) => (
          <View style={{ width: screenWidth, height: screenHeight, justifyContent: 'center', alignItems: 'center' }}>
            {item.content_type?.includes('video') ? (
              <Video
                ref={index === currentIndex ? activeVideoRef : null}
                source={{ uri: item.media_url }}
                style={{ width: '100%', height: '100%' }}
                resizeMode={ResizeMode.CONTAIN}
                useNativeControls={false}
                shouldPlay={index === currentIndex}
                onPlaybackStatusUpdate={(status) => {
                  if (index === currentIndex) setVideoStatus(status);
                }}
              />
            ) : (
              <Image
                source={{ uri: item.media_url }}
                style={{ width: '100%', height: '100%' }}
                resizeMode="contain" // Guarantees the image isn't clipped or stretched out
              />
            )}
          </View>
        )}
      />
      
      {/* Top Header Controls */}
      <View style={[styles.header, { paddingTop: insets.top + 12, height: insets.top + 50 }]}>
        <BlurView intensity={80} style={StyleSheet.absoluteFill} />
        <TouchableOpacity onPress={() => router.back()} style={styles.iconButton}>
          <Ionicons name="arrow-back" size={24} color="#FFF" />
        </TouchableOpacity>
        
        <View style={styles.titleContainer}>
          <Text style={styles.title} numberOfLines={1}>{activeItem?.name || 'Media Viewer'}</Text>
          <Text style={styles.subtitle}>{currentIndex + 1} of {mediaFiles.length}</Text>
        </View>
        
        <View style={{ width: 40 }} />
      </View>

      {/* Main Safe Layout Column - Bottom Control Interface */}
      <View style={styles.mainSafeLayoutColumn}>
        
        {/* Upper Sub-Container: Timeline & Controls (Only for Video) */}
        {activeItem?.content_type?.includes('video') && (
          <View style={styles.upperSubContainer}>
            <TouchableOpacity onPress={togglePlay} style={{ marginRight: 12 }}>
              <Ionicons name={videoStatus.isPlaying ? 'pause' : 'play'} size={24} color="#FFF" />
            </TouchableOpacity>
            
            <Text style={styles.timeText}>{fmt(videoStatus.positionMillis)}</Text>
            
            <View style={styles.timelineTrack}>
              <View 
                style={[
                  styles.timelineProgress, 
                  { width: `${videoStatus.durationMillis ? ((videoStatus.positionMillis || 0) / videoStatus.durationMillis) * 100 : 0}%` }
                ]} 
              />
            </View>
            
            <Text style={styles.timeText}>{fmt(videoStatus.durationMillis)}</Text>
          </View>
        )}

        {/* Lower Sub-Container: Utility Actions */}
        <View style={[styles.bottomActionBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <TouchableOpacity style={styles.footerAction} onPress={saveToDevice}>
            <Ionicons name={isSaved ? 'checkmark-circle' : 'cloud-download-outline'} size={24} color={isSaved ? '#10b981' : '#FFF'} />
            <Text style={[styles.footerActionText, isSaved && { color: '#10b981' }]}>
              {isSaved ? 'Saved!' : 'Save'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.footerAction} onPress={shareFile}>
            <Ionicons name="share-social-outline" size={24} color="#FFF" />
            <Text style={styles.footerActionText}>Share</Text>
          </TouchableOpacity>
        </View>
        
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden'
  },
  iconButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  titleContainer: {
    flex: 1,
    alignItems: 'center',
  },
  title: {
    color: '#FFF',
    fontSize: 16,
    fontFamily: 'Inter-SemiBold',
  },
  subtitle: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    fontFamily: 'Inter-Medium',
    marginTop: 2,
  },
  mainSafeLayoutColumn: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    width: '100%',
    flexDirection: 'column',
    justifyContent: 'flex-end',
  },
  upperSubContainer: {
    width: '100%',
    backgroundColor: 'rgba(0,0,0,0.5)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 20,
  },
  bottomActionBar: {
    width: '100%',
    backgroundColor: 'rgba(0,0,0,0.5)',
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  timelineTrack: {
    flex: 1,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 2,
    marginHorizontal: 12,
  },
  timelineProgress: {
    height: '100%',
    backgroundColor: '#10b981',
    borderRadius: 2,
  },
  timeText: {
    color: '#FFF',
    fontSize: 12,
    fontFamily: 'Inter-Medium',
  },
  footerAction: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
  },
  footerActionText: {
    color: '#FFF',
    fontSize: 12,
    fontFamily: 'Inter-Medium',
    marginTop: 4,
  }
});
