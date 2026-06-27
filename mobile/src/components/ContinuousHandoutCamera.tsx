import React, { useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Text, ScrollView, Image, SafeAreaView } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface Props {
  onFinishCapture: (uris: string[]) => void;
  onClose: () => void;
}

export const ContinuousHandoutCamera = ({ onFinishCapture, onClose }: Props) => {
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [localQueue, setLocalQueue] = useState<string[]>([]);

  const insets = useSafeAreaInsets();
  const DASHBOARD_MIN_BOTTOM = 40;
  const safeBottomOffset = Math.max(insets.bottom + 16, DASHBOARD_MIN_BOTTOM);

  if (!permission) return <View style={styles.container} />;
  
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permissionText}>NALISS HUB needs camera hardware permissions to capture handouts.</Text>
        <TouchableOpacity onPress={requestPermission} style={styles.btn}>
          <Text style={styles.btnText}>Grant Camera Access</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onClose} style={[styles.btn, { marginTop: 12, backgroundColor: 'transparent', borderWidth: 1, borderColor: '#FFF' }]}>
          <Text style={styles.btnText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const snapCurrentPage = async () => {
    if (cameraRef.current) {
      // Take high-quality picture frame stream asynchronously
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.85, skipProcessing: true });
      if (photo?.uri) {
        // Append immediately to the session array state queue without resetting or closing the lens view
        setLocalQueue(prev => [...prev, photo.uri]);
      }
    }
  };

  return (
    <View style={styles.container}>
      <CameraView facing="back" ref={cameraRef} style={StyleSheet.absoluteFillObject}>
        
        <SafeAreaView style={styles.topControlRow}>
          <TouchableOpacity onPress={onClose} style={styles.closeControlCircle}>
            <Ionicons color="#FFF" name="close" size={24} />
          </TouchableOpacity>
          <Text style={styles.counterTitle}>{localQueue.length} Pages Captured</Text>
          <TouchableOpacity onPress={() => onFinishCapture(localQueue)} style={styles.finishPillBtn}>
            <Text style={styles.finishText}>Done</Text>
          </TouchableOpacity>
        </SafeAreaView>

        
        <View style={[styles.bottomDashboardContainer, { bottom: safeBottomOffset }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbnailCarousel}>
            {localQueue.map((uri, index) => (
              <Image key={index} source={{ uri }} style={styles.queuedThumbImage} />
            ))}
          </ScrollView>

          
          <View style={styles.shutterRowAlignment}>
            <TouchableOpacity onPress={snapCurrentPage} style={styles.masterOuterShutterRing}>
              <View style={styles.innerSolidShutterCircle} />
            </TouchableOpacity>
          </View>
        </View>
      </CameraView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', ...StyleSheet.absoluteFillObject, zIndex: 9999 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#121212', padding: 24, ...StyleSheet.absoluteFillObject, zIndex: 9999 },
  permissionText: { color: '#FFF', textAlign: 'center', marginBottom: 20, fontSize: 16 },
  btn: { backgroundColor: '#005A36', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  btnText: { color: '#FFF', fontWeight: 'bold' },
  topControlRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, paddingHorizontal: 20, width: '100%' },
  closeControlCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  counterTitle: { color: '#FFF', fontWeight: '600', fontSize: 16, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  finishPillBtn: { backgroundColor: '#005A36', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  finishText: { color: '#FFF', fontWeight: 'bold' },
  bottomDashboardContainer: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  thumbnailCarousel: { maxHeight: 70, marginBottom: 20, paddingHorizontal: 20, width: '100%' },
  queuedThumbImage: { width: 50, height: 70, borderRadius: 4, marginRight: 10, borderWidth: 1, borderColor: '#FFF' },
  shutterRowAlignment: { justifyContent: 'center', alignItems: 'center' },
  masterOuterShutterRing: { width: 84, height: 84, borderRadius: 42, borderWidth: 4, borderColor: '#FFF', justifyContent: 'center', alignItems: 'center' },
  innerSolidShutterCircle: { width: 68, height: 68, borderRadius: 34, backgroundColor: '#FFF' }
});
