import React, { useState } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    Alert,
    ScrollView,
    StyleSheet,
    ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../src/api/supabase/client';
import { useAuthStore } from '../../src/stores/auth.store';
import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/stores/theme.store';

export default function DeleteAccountScreen() {
    const router = useRouter();
    const { colors } = useTheme();
    const [confirmationText, setConfirmationText] = useState('');
    const [isDeleting, setIsDeleting] = useState(false);
    const user = useAuthStore(state => state.profile);
    const userEmail = user?.email || '';

    const handleDeleteAccount = async () => {
        // Validate confirmation
        if (confirmationText.toLowerCase().trim() !== userEmail.toLowerCase().trim()) {
            Alert.alert('Mismatch', `Please type "${userEmail}" to confirm.`);
            return;
        }

        Alert.alert(
            'Delete Account Permanently',
            'This action CANNOT be undone. All your messages, profile data, and files will be permanently deleted.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete Forever',
                    style: 'destructive',
                    onPress: executeDelete,
                },
            ]
        );
    };

    const executeDelete = async () => {
        setIsDeleting(true);
        try {
            const userId = useAuthStore.getState().session?.user?.id;
            if (!userId) throw new Error('No user session found');

            // Step 1: Call server to delete all user data
            const { error: rpcError } = await supabase.rpc('delete_user_account', {
                user_id_to_delete: userId,
            });

            if (rpcError) throw rpcError;

            // Step 2: Sign out from Supabase
            await supabase.auth.signOut({ scope: 'global' });

            // Step 3: Clear ALL local data
            await clearAllLocalData();

            // Step 4: Reset auth store and navigate to login
            useAuthStore.getState().setSession(null);
            useAuthStore.getState().setProfile(null);

            Alert.alert(
                'Account Deleted',
                'Your account and all associated data have been permanently deleted.',
                [{ text: 'OK', onPress: () => router.replace('/auth/login' as any) }]
            );
        } catch (error: any) {
            console.error('[DeleteAccount] Failed:', error);
            Alert.alert(
                'Deletion Failed',
                error.message || 'Could not delete your account. Please try again or contact support.',
            );
        } finally {
            setIsDeleting(false);
        }
    };

    const clearAllLocalData = async () => {
        try {
            // Use the centralized wipe logic that deletes SQLite, Vault, and MMKV
            const { useAuthStore } = require('../../src/stores/auth.store');
            await useAuthStore.getState().removeLocalData();

            // Clear temporary cache directory as a bonus
            try {
                const cacheDir = FileSystem.cacheDirectory;
                if (cacheDir) {
                    const files = await FileSystem.readDirectoryAsync(cacheDir);
                    for (const file of files) {
                        try {
                            await FileSystem.deleteAsync(cacheDir + file, { idempotent: true });
                        } catch (e) { /* skip individual errors */ }
                    }
                }
            } catch (e) { /* non-critical */ }

            console.log('[DeleteAccount] Local data completely cleared');
        } catch (error) {
            console.warn('[DeleteAccount] Failed to clear some local data:', error);
            // Don't throw — account is already deleted server-side
        }
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
            <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
                <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                    <Ionicons name="arrow-back" size={24} color={colors.text} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: colors.text }]}>Delete Account</Text>
                <View style={{ width: 32 }} />
            </View>

            <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
                <Text style={styles.title}>Delete Account</Text>
            <Text style={styles.warning}>
                This action is permanent and cannot be undone. The following data will be
                permanently deleted:
            </Text>

            <View style={styles.dataList}>
                <DataItem icon="💬" text="All your chat messages" />
                <DataItem icon="👤" text="Your profile information" />
                <DataItem icon="📁" text="Downloaded files and cached media" />
                <DataItem icon="🔑" text="Your account and authentication data" />
                <DataItem icon="📱" text="All active sessions on other devices" />
            </View>

            <Text style={styles.confirmLabel}>
                Type <Text style={styles.confirmEmail}>{userEmail}</Text> to confirm:
            </Text>
            <TextInput
                style={styles.input}
                value={confirmationText}
                onChangeText={setConfirmationText}
                placeholder={userEmail}
                placeholderTextColor="#888"
                autoCapitalize="none"
                autoCorrect={false}
            />

            <TouchableOpacity
                style={[
                    styles.deleteButton,
                    (isDeleting || confirmationText.toLowerCase().trim() !== userEmail.toLowerCase().trim())
                        && styles.deleteButtonDisabled,
                ]}
                onPress={handleDeleteAccount}
                disabled={isDeleting || confirmationText.toLowerCase().trim() !== userEmail.toLowerCase().trim()}
            >
                {isDeleting ? (
                    <ActivityIndicator color="#fff" />
                ) : (
                    <Text style={styles.deleteButtonText}>Delete My Account</Text>
                )}
            </TouchableOpacity>
            </ScrollView>
        </SafeAreaView>
    );
}

function DataItem({ icon, text }: { icon: string; text: string }) {
    return (
        <View style={styles.dataItem}>
            <Text style={styles.dataIcon}>{icon}</Text>
            <Text style={styles.dataText}>{text}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    scrollView: { flex: 1 },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
    },
    backButton: {
        padding: 4,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
    },
    content: { padding: 24 },
    title: { fontSize: 24, fontWeight: '700', color: '#d32f2f', marginBottom: 16 },
    warning: { fontSize: 15, color: '#666', lineHeight: 22, marginBottom: 24 },
    dataList: { backgroundColor: '#fff5f5', borderRadius: 12, padding: 16, marginBottom: 24 },
    dataItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
    dataIcon: { fontSize: 20, marginRight: 12 },
    dataText: { fontSize: 15, color: '#333' },
    confirmLabel: { fontSize: 15, color: '#333', marginBottom: 12 },
    confirmEmail: { fontWeight: '700', color: '#d32f2f' },
    input: {
        borderWidth: 1, borderColor: '#ddd', borderRadius: 8,
        padding: 14, fontSize: 16, marginBottom: 24,
        backgroundColor: '#fafafa',
    },
    deleteButton: {
        backgroundColor: '#d32f2f', borderRadius: 12, padding: 16,
        alignItems: 'center', marginBottom: 40,
    },
    deleteButtonDisabled: { backgroundColor: '#ffcdd2' },
    deleteButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
