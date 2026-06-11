import React, { useRef, useState, useEffect } from 'react';
import { FlatList, View, Image, Dimensions, useWindowDimensions, TouchableOpacity, Text, StyleSheet, Alert, StatusBar } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Video, ResizeMode } from 'expo-av';
import * as Sharing from 'expo-sharing';
import { saveCategorizedFileToDevice } from '../src/utils/fileSaver';
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
  
  const flatListRef = useRef<FlatList>(null);
  const [currentIndex, setCurrentIndex] = useState(startIndex);
  const [isSaved, setIsSaved] = useState(false);

  const activeItem = mediaFiles[currentIndex];

  const saveToDevice = async () => {
    if (!activeItem) return;
    try {
      await saveCategorizedFileToDevice(
        activeItem.media_url,
        activeItem.name || `media_${Date.now()}.jpg`
      );
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 3000);
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
    }
  }).current;

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
        renderItem={({ item }) => (
          <View style={{ width: screenWidth, height: screenHeight, justifyContent: 'center', alignItems: 'center' }}>
            {item.content_type?.includes('video') ? (
              <Video
                source={{ uri: item.media_url }}
                style={{ width: '100%', height: '100%' }}
                resizeMode={ResizeMode.CONTAIN}
                useNativeControls
                shouldPlay={false}
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
      <View style={styles.header}>
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

      {/* Bottom Footer Controls */}
      <View style={styles.footer}>
        <BlurView intensity={80} style={StyleSheet.absoluteFill} />
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
  );
}

const styles = StyleSheet.create({
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 90,
    paddingTop: 40,
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
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 80,
    paddingBottom: 20,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden'
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
