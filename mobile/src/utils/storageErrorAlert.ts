import { Alert, Linking, Platform } from 'react-native';

let shown = false;

export function showStorageErrorAlert() {
    if (Platform.OS === 'web' || shown) return;
    
    shown = true;
    Alert.alert(
        'Storage Error',
        'Your device is having trouble saving data. This usually happens if your device is out of storage space, or if app permissions are corrupted.\n\nPlease try the following:\n1. Free up some space on your device\n2. Go to Settings → Apps → Naliss Hub\n3. Tap "Clear Data" or "Clear Storage"\n4. Reopen the app',
        [
            { 
                text: 'Open Settings', 
                onPress: () => {
                    shown = false; // Reset so it can be shown again if they return without fixing
                    Linking.openSettings().catch(() => {});
                } 
            },
            { 
                text: 'Later', 
                style: 'cancel',
                onPress: () => {
                    // Allow it to be shown again after 5 minutes
                    setTimeout(() => { shown = false; }, 5 * 60 * 1000);
                }
            },
        ]
    );
}
