import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/stores/theme.store';
import { useAuthStore } from '../../src/stores';
import { COLORS } from '../../src/constants/Colors';

function NotifToggle({ icon, label, description, value, onToggle, colors }: any) {
    return (
        <View style={[styles.notifToggleItem, { borderBottomColor: colors.divider }]}>
            <View style={styles.notifToggleLeft}>
                <View style={[styles.notifToggleIconBg, { backgroundColor: COLORS.actionMint }]}>
                    <Ionicons name={icon} size={18} color={COLORS.primary} />
                </View>
                <View style={styles.notifToggleText}>
                    <Text style={[styles.notifToggleLabel, { color: colors.text }]}>{label}</Text>
                    <Text style={[styles.notifToggleDesc, { color: colors.textMuted }]}>{description}</Text>
                </View>
            </View>
            <Switch
                value={value}
                onValueChange={onToggle}
                trackColor={{ false: '#e2e8f0', true: '#a7f3d0' }}
                thumbColor={value ? COLORS.primary : '#fff'}
            />
        </View>
    );
}

export default function NotificationsSettingsScreen() {
    const router = useRouter();
    const { colors } = useTheme();
    const storeProfile = useAuthStore(s => s.profile);
    const updatePreferences = useAuthStore(s => s.updatePreferences);

    const [isSavingNotifs, setIsSavingNotifs] = useState(false);
    const [notifSettings, setNotifSettings] = useState({
        notif_announcements: (storeProfile as any)?.notif_announcements ?? true,
        notif_events: (storeProfile as any)?.notif_events ?? true,
        notif_messages: (storeProfile as any)?.notif_messages ?? true,
        notif_materials: (storeProfile as any)?.notif_materials ?? true,
    });

    useEffect(() => {
        if (storeProfile) {
            setNotifSettings(prev => ({
                notif_announcements: (storeProfile as any)?.notif_announcements ?? prev.notif_announcements,
                notif_events: (storeProfile as any)?.notif_events ?? prev.notif_events,
                notif_messages: (storeProfile as any)?.notif_messages ?? prev.notif_messages,
                notif_materials: (storeProfile as any)?.notif_materials ?? prev.notif_materials,
            }));
        }
    }, [storeProfile]);

    const handleSave = async () => {
        setIsSavingNotifs(true);
        try {
            const savePromise = updatePreferences(notifSettings);
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000));
            await Promise.race([savePromise, timeoutPromise]);
            Alert.alert('Saved', 'Notification preferences updated.');
            router.back();
        } catch (e: any) {
            if (e.message === 'timeout') {
                Alert.alert('Network Error', 'The request timed out. Please check your internet connection.');
            } else {
                Alert.alert('Error', 'Failed to save preferences. Please try again.');
            }
        } finally {
            setIsSavingNotifs(false);
        }
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
            <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
                <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                    <Ionicons name="arrow-back" size={24} color={colors.text} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: colors.text }]}>Notifications</Text>
                <TouchableOpacity onPress={handleSave} disabled={isSavingNotifs} style={styles.saveHeaderButton}>
                    {isSavingNotifs ? (
                        <ActivityIndicator size="small" color="#10b981" />
                    ) : (
                        <Text style={styles.saveHeaderText}>Save</Text>
                    )}
                </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent}>
                <View style={[styles.menuCard, { backgroundColor: colors.card }]}>
                    <NotifToggle
                        icon="megaphone"
                        label="Announcements"
                        description="Receive notifications for new announcements"
                        value={notifSettings.notif_announcements}
                        onToggle={(val: boolean) => setNotifSettings(prev => ({ ...prev, notif_announcements: val }))}
                        colors={colors}
                    />
                    <NotifToggle
                        icon="calendar"
                        label="Events"
                        description="Get reminded about upcoming events"
                        value={notifSettings.notif_events}
                        onToggle={(val: boolean) => setNotifSettings(prev => ({ ...prev, notif_events: val }))}
                        colors={colors}
                    />
                    <NotifToggle
                        icon="chatbubble-ellipses"
                        label="Messages"
                        description="Notifications for group chat messages"
                        value={notifSettings.notif_messages}
                        onToggle={(val: boolean) => setNotifSettings(prev => ({ ...prev, notif_messages: val }))}
                        colors={colors}
                    />
                    <NotifToggle
                        icon="folder"
                        label="New Materials"
                        description="Alert when new study materials are uploaded"
                        value={notifSettings.notif_materials}
                        onToggle={(val: boolean) => setNotifSettings(prev => ({ ...prev, notif_materials: val }))}
                        colors={colors}
                    />
                </View>
            </ScrollView>
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
    menuCard: {
        borderRadius: 20,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: '#e2e8f0', // Adjust dynamically if needed
    },
    notifToggleItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 16,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
    },
    notifToggleLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        marginRight: 12,
    },
    notifToggleIconBg: {
        width: 40,
        height: 40,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    notifToggleText: {
        flex: 1,
    },
    notifToggleLabel: {
        fontFamily: 'Inter-SemiBold',
        fontSize: 15,
    },
    notifToggleDesc: {
        fontFamily: 'Inter-Regular',
        fontSize: 12,
        marginTop: 2,
    },
});
