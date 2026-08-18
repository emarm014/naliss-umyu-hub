import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Alert, Platform } from 'react-native';
import IntentLauncher from 'expo-intent-launcher';

const MIME_MAP: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.txt': 'text/plain',
    '.csv': 'text/csv'
};

export interface DocumentOpenOptions {
    localUri: string;
    fileType?: string;
    fileName: string;
    onOpenInApp?: (file: { uri: string; type: string; name: string }) => void;
}

const launchExternal = async (localUri: string, fileName: string) => {
    const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
    const mimeType = MIME_MAP[ext] || 'application/octet-stream';

    if (Platform.OS === 'android') {
        const fileUri = localUri.startsWith('file://') ? localUri : `file://${localUri}`;
        const contentUri = await FileSystem.getContentUriAsync(fileUri);
        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
            data: contentUri,
            flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
            type: mimeType,
        });
    } else {
        const fileUri = localUri.startsWith('file://') ? localUri : `file://${localUri}`;
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
};

export const openDocumentWith = async (options: DocumentOpenOptions) => {
    const { localUri, fileType, fileName, onOpenInApp } = options;

    if (Platform.OS === 'android' && localUri.startsWith('file://')) {
        try {
            const fileInfo = await FileSystem.getInfoAsync(localUri);
            if (fileInfo.exists) {
                Alert.alert('Open File', fileName, [
                    {
                        text: 'Open in App',
                        onPress: () => {
                            if (onOpenInApp) {
                                onOpenInApp({
                                    uri: localUri,
                                    type: fileType || 'document',
                                    name: fileName,
                                });
                            }
                        },
                    },
                    {
                        text: 'Open with Other App',
                        onPress: () => launchExternal(localUri, fileName).catch(err => {
                            console.warn('Failed to open with external app:', err);
                            Alert.alert('No App Available', 'No app available on your device supports opening this file format. Please use the In-App Viewer.');
                        }),
                    },
                    { text: 'Cancel', style: 'cancel' },
                ]);
                return;
            }
        } catch (e) {
            console.error('Document opener error:', e);
        }
    }

    // iOS and Fallback: just show the open with alert
    Alert.alert('Open File', fileName, [
        {
            text: 'Open in App',
            onPress: () => {
                if (onOpenInApp) {
                    onOpenInApp({
                        uri: localUri,
                        type: fileType || 'document',
                        name: fileName,
                    });
                }
            },
        },
        {
            text: 'Open with Other App',
            onPress: () => launchExternal(localUri, fileName).catch(err => {
                console.warn('Failed to open with external app:', err);
                Alert.alert('No App Available', 'No app available on your device supports opening this file format. Please use the In-App Viewer.');
            }),
        },
        { text: 'Cancel', style: 'cancel' },
    ]);
};
