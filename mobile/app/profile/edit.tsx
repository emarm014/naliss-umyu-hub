import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Alert, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/stores/theme.store';
import { useAuthStore } from '../../src/stores';
import { captureUIError } from '../../src/utils/sentry';

export default function EditProfileScreen() {
    const router = useRouter();
    const { colors, isDark } = useTheme();
    const storeProfile = useAuthStore(s => s.profile);
    const updateProfile = useAuthStore(s => s.updateProfile);

    const [isSaving, setIsSaving] = useState(false);
    const [editData, setEditData] = useState({
        username: storeProfile?.username || '',
        motivation: (storeProfile as any)?.motivation || '',
        hobbies: (storeProfile as any)?.hobbies || '',
        biography: (storeProfile as any)?.biography || '',
    });

    const handleSave = async () => {
        if (!storeProfile?.id) return;

        const trimmedUsername = editData.username.trim();
        if (trimmedUsername && !/^[a-z0-9_]{3,30}$/.test(trimmedUsername)) {
            Alert.alert('Invalid Username', 'Username must be 3–30 characters and can only contain lowercase letters, numbers, and underscores.');
            return;
        }

        setIsSaving(true);
        try {
            const editableUpdates = {
                username: trimmedUsername,
                motivation: editData.motivation.trim(),
                hobbies: editData.hobbies.trim(),
                biography: editData.biography.trim(),
            };

            await updateProfile(editableUpdates);
            router.back();
            Alert.alert('Success', 'Profile updated successfully');
        } catch (err: any) {
            captureUIError('EditProfileScreen.saveProfile', err);
            const msg = err?.message || '';
            if (msg.includes('unique') || msg.includes('duplicate') || msg.includes('users_username_key')) {
                Alert.alert('Username Taken', `"${editData.username}" is already in use. Please choose a different username.`);
            } else if (msg.includes('fetch') || msg.includes('network') || msg.includes('connection')) {
                router.back();
                Alert.alert('Saved Locally', 'Your changes have been saved on this device and will sync when your connection is restored.');
            } else {
                Alert.alert('Error', `Failed to save: ${msg || 'Please try again.'}`);
            }
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
            <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
                <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                    <Ionicons name="close" size={24} color={colors.text} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: colors.text }]}>Edit Profile</Text>
                <TouchableOpacity onPress={handleSave} disabled={isSaving} style={styles.saveHeaderButton}>
                    {isSaving ? (
                        <ActivityIndicator size="small" color="#10b981" />
                    ) : (
                        <Text style={styles.saveHeaderText}>Save</Text>
                    )}
                </TouchableOpacity>
            </View>

            <KeyboardAvoidingView 
                style={{ flex: 1 }} 
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
                <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
                    <View style={styles.formGroup}>
                        <Text style={[styles.label, { color: colors.textSecondary }]}>Username</Text>
                        <TextInput
                            style={[styles.input, { color: colors.text, backgroundColor: colors.card, borderColor: colors.border }]}
                            value={editData.username}
                            onChangeText={(text) => setEditData(prev => ({ ...prev, username: text.toLowerCase() }))}
                            placeholder="Enter username"
                            placeholderTextColor={colors.textMuted}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                        <Text style={[styles.helperText, { color: colors.textMuted }]}>
                            3-30 characters, letters, numbers, and underscores only.
                        </Text>
                    </View>

                    <View style={styles.formGroup}>
                        <Text style={[styles.label, { color: colors.textSecondary }]}>Biography</Text>
                        <TextInput
                            style={[styles.input, styles.textArea, { color: colors.text, backgroundColor: colors.card, borderColor: colors.border }]}
                            value={editData.biography}
                            onChangeText={(text) => setEditData(prev => ({ ...prev, biography: text }))}
                            placeholder="Tell us about yourself..."
                            placeholderTextColor={colors.textMuted}
                            multiline
                            numberOfLines={4}
                            textAlignVertical="top"
                        />
                    </View>

                    <View style={styles.formGroup}>
                        <Text style={[styles.label, { color: colors.textSecondary }]}>Motivation / Quote</Text>
                        <TextInput
                            style={[styles.input, { color: colors.text, backgroundColor: colors.card, borderColor: colors.border }]}
                            value={editData.motivation}
                            onChangeText={(text) => setEditData(prev => ({ ...prev, motivation: text }))}
                            placeholder="Your favorite quote or motivation..."
                            placeholderTextColor={colors.textMuted}
                        />
                    </View>

                    <View style={styles.formGroup}>
                        <Text style={[styles.label, { color: colors.textSecondary }]}>Hobbies</Text>
                        <TextInput
                            style={[styles.input, { color: colors.text, backgroundColor: colors.card, borderColor: colors.border }]}
                            value={editData.hobbies}
                            onChangeText={(text) => setEditData(prev => ({ ...prev, hobbies: text }))}
                            placeholder="e.g. Reading, Coding, Music"
                            placeholderTextColor={colors.textMuted}
                        />
                        <Text style={[styles.helperText, { color: colors.textMuted }]}>
                            Separate hobbies with commas.
                        </Text>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
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
    saveHeaderButton: {
        paddingVertical: 4,
        paddingHorizontal: 8,
    },
    saveHeaderText: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#10b981',
    },
    scrollContent: {
        padding: 16,
        paddingBottom: 40,
    },
    formGroup: {
        marginBottom: 20,
    },
    label: {
        fontSize: 14,
        fontWeight: '600',
        marginBottom: 8,
        marginLeft: 4,
    },
    input: {
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        fontSize: 16,
    },
    textArea: {
        minHeight: 100,
    },
    helperText: {
        fontSize: 12,
        marginTop: 6,
        marginLeft: 4,
    },
});
