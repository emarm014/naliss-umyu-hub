import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

export const saveCategorizedFileToDevice = async (cacheUri: string, filename: string) => {
  try {
    // 1. Extract the file extension to determine target sub-folder categorization
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    let subFolder = 'NALISS Documents'; // Default fallback container

    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
      subFolder = 'NALISS Images';
    } else if (['mp4', 'mov', 'mkv', '3gp'].includes(ext)) {
      subFolder = 'NALISS Videos';
    } else if (['mp3', 'wav', 'aac', 'm4a'].includes(ext)) {
      subFolder = 'NALISS Audio';
    }

    // 2. Cross-Platform Native System Exporter (Offline-Ready)
    const isSharingAvailable = await Sharing.isAvailableAsync();
    if (isSharingAvailable && Platform.OS !== 'android') {
      await Sharing.shareAsync(cacheUri, {
        dialogTitle: `Save ${filename} to ${subFolder}`,
        UTI: 'public.item'
      });
      return;
    }

    if (Platform.OS === 'android') {
      const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (permissions.granted) {
        const directoryUri = permissions.directoryUri;
        // SAF creates the file inside the user-selected directory
        const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
          directoryUri,
          filename,
          'application/octet-stream'
        );
        const base64Content = await FileSystem.readAsStringAsync(cacheUri, { encoding: FileSystem.EncodingType.Base64 });
        await FileSystem.writeAsStringAsync(fileUri, base64Content, { encoding: FileSystem.EncodingType.Base64 });
        return;
      } else {
        if (isSharingAvailable) {
          await Sharing.shareAsync(cacheUri, {
            dialogTitle: `Save ${filename} to ${subFolder}`,
            UTI: 'public.item'
          });
        }
      }
    } else {
      if (isSharingAvailable) {
        await Sharing.shareAsync(cacheUri, {
          dialogTitle: `Save ${filename} to ${subFolder}`,
          UTI: 'public.item'
        });
      }
    }
  } catch (error) {
    console.error("Offline-ready categorized file operation failure:", error);
    throw error;
  }
};
