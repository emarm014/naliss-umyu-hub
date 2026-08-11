import React, { useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

const PRIVACY_POLICY_URL = 'https://naliss-umyu-hub.vercel.app/privacy-policy'; // Placeholder

export default function PrivacyPolicyScreen() {
    const [loading, setLoading] = useState(true);

    return (
        <View style={styles.container}>
            {loading && (
                <View style={styles.loader}>
                    <ActivityIndicator size="large" color="#059669" />
                </View>
            )}
            <WebView
                source={{ uri: PRIVACY_POLICY_URL }}
                onLoadStart={() => setLoading(true)}
                onLoadEnd={() => setLoading(false)}
                style={styles.webview}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fff' },
    loader: {
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        justifyContent: 'center', alignItems: 'center', zIndex: 1,
        backgroundColor: '#fff',
    },
    webview: { flex: 1 },
});
