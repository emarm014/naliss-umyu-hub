import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Sentry from '@sentry/react-native';
import { Alert, Platform } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';

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

const getUTI = (mimeType: string): string => {
    const mime = mimeType.toLowerCase();
    if (mime.includes('pdf')) return 'com.adobe.pdf';
    if (mime.includes('msword') || mime.includes('wordprocessingml')) return 'com.microsoft.word.doc';
    if (mime.includes('powerpoint') || mime.includes('presentationml')) return 'com.microsoft.powerpoint.ppt';
    if (mime.includes('excel') || mime.includes('spreadsheetml')) return 'com.microsoft.excel.xls';
    if (mime.includes('text/plain')) return 'public.plain-text';
    if (mime.includes('csv')) return 'public.comma-separated-values-text';
    return 'public.data';
};

const launchExternal = async (localUri: string, fileName: string) => {
    const extMatch = fileName.match(/\.[0-9a-z]+$/i);
    const ext = extMatch ? extMatch[0].toLowerCase() : '';
    const mimeType = MIME_MAP[ext] || 'application/pdf'; // Default to PDF for unknown documents rather than octet-stream to force document viewers

    if (Platform.OS === 'android') {
        const fileUri = localUri.startsWith('file://') ? localUri : `file://${localUri}`;

        // Wrap native bridge calls in a timeout to prevent indefinite hangs.
        // If ProGuard strips FileProvider or IntentLauncher native classes,
        // getContentUriAsync/startActivityAsync hang forever on the native bridge.
        const NATIVE_TIMEOUT_MS = 10000;

        const contentUri = await Promise.race([
            FileSystem.getContentUriAsync(fileUri),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('getContentUriAsync timed out — native module may be missing')), NATIVE_TIMEOUT_MS)
            ),
        ]);

        await Promise.race([
            IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
                data: contentUri,
                flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
                type: mimeType,
            }),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('IntentLauncher timed out — native module may be missing')), NATIVE_TIMEOUT_MS)
            ),
        ]);
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
        
        const uti = getUTI(mimeType);
        await Sharing.shareAsync(fileUri, { 
            mimeType, 
            UTI: uti, 
            dialogTitle: `Open ${fileName}` 
        });
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
                            Sentry.captureException(err, { tags: { section: 'documentOpener' } });
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
                Sentry.captureException(err, { tags: { section: 'documentOpener' } });
                Alert.alert('No App Available', 'No app available on your device supports opening this file format. Please use the In-App Viewer.');
            }),
        },
        { text: 'Cancel', style: 'cancel' },
    ]);
};
