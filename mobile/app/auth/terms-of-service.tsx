import React, { useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

const TERMS_OF_SERVICE_URL = 'https://naliss-umyu-hub.vercel.app/terms'; // Placeholder

export default function TermsOfServiceScreen() {
    const [loading, setLoading] = useState(true);

    return (
        <View style={styles.container}>
            {loading && (
                <View style={styles.loader}>
                    <ActivityIndicator size="large" color="#059669" />
                </View>
            )}
            <WebView
                source={{ uri: TERMS_OF_SERVICE_URL }}
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
