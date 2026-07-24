import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useTheme } from '../../src/stores/theme.store';
import { COLORS } from '../../src/constants/Colors';
import { supabase } from '../../src/api/supabase/client';
import { getCleanAvatarUrl } from '../../src/utils/avatar';
import { CachedImage } from '../../src/components/common/CachedImage';
import { NalissLogo } from '../../src/components/NalissLogo';

export default function UserProfileScreen() {
    const { id, initialData } = useLocalSearchParams();
    const router = useRouter();
    const { colors, isDark } = useTheme();

    // Try to use initial data if available
    let parsedInitial = null;
    try {
        if (initialData && typeof initialData === 'string') {
            parsedInitial = JSON.parse(initialData);
        }
    } catch {}

    const [profile, setProfile] = useState<any>(parsedInitial);
    const [isLoading, setIsLoading] = useState(!parsedInitial);
    const [isOnline, setIsOnline] = useState(false);

    useEffect(() => {
        let mounted = true;
        
        const fetchProfile = async () => {
            if (!id || typeof id !== 'string') return;
            
            try {
                const { data, error } = await supabase.from('users')
                    .select('*, department:departments(name)')
                    .eq('id', id)
                    .single();

                if (error) throw error;
                if (mounted && data) {
                    setProfile(data);
                    
                    // Check online status
                    const isUserOnline = data.last_active_at && (new Date().getTime() - new Date(data.last_active_at).getTime() < 300000);
                    setIsOnline(!!isUserOnline);
                }
            } catch (error) {
                // handle error
            } finally {
                if (mounted) setIsLoading(false);
            }
        };

        fetchProfile();

        return () => { mounted = false; };
    }, [id]);

    const handleBack = () => router.back();

    if (isLoading && !profile) {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
                <View style={styles.header}>
                    <TouchableOpacity style={styles.backButton} onPress={handleBack}>
                        <Ionicons name="chevron-back" size={24} color={colors.text} />
                    </TouchableOpacity>
                </View>
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color="#10b981" />
                </View>
            </SafeAreaView>
        );
    }

    if (!profile) {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
                <View style={styles.header}>
                    <TouchableOpacity style={styles.backButton} onPress={handleBack}>
                        <Ionicons name="chevron-back" size={24} color={colors.text} />
                    </TouchableOpacity>
                </View>
                <View style={styles.loadingContainer}>
                    <Text style={{ color: colors.text }}>Profile not found.</Text>
                </View>
            </SafeAreaView>
        );
    }

    const cleanAvatarUrl = getCleanAvatarUrl(profile?.avatar_url);

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
            <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
                <TouchableOpacity style={styles.backButton} onPress={handleBack}>
                    <Ionicons name="chevron-back" size={24} color={colors.text} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: colors.text }]}>Contact Info</Text>
                <View style={{ width: 32 }} />
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
                <View style={[styles.profileHeaderContainer, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
                    <View style={[styles.avatarContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                        {cleanAvatarUrl ? (
                            <CachedImage
                                remoteUrl={cleanAvatarUrl}
                                style={styles.avatar}
                                entityId={`user_avatar_${profile.id}`}
                                assetType="avatar"
                            />
                        ) : (
                            <NalissLogo size={80} />
                        )}
                    </View>
                    <Text style={[styles.profileName, { color: colors.text }]}>
                        {profile.full_name || profile.username || 'User'}
                    </Text>
                    <Text style={styles.profileUsername}>@{profile.username || 'unknown'}</Text>
                    
                    <View style={styles.onlineStatusRow}>
                        <View style={[styles.onlineDot, { backgroundColor: isOnline ? '#10B981' : '#94a3b8' }]} />
                        <Text style={styles.onlineText}>
                            {isOnline ? 'Online' : 'Offline'}
                        </Text>
                    </View>
                </View>

                {/* About / Bio Section */}
                <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Text style={[styles.sectionTitle, { color: colors.primary }]}>About</Text>
                    <Text style={[styles.bioText, { color: colors.text }]}>
                        {profile.biography || profile.bio || 'Available'}
                    </Text>
                </View>

                {/* Info Card Section */}
                <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={styles.infoRow}>
                        <Ionicons name="school-outline" size={20} color="#059669" />
                        <View style={styles.infoTextGroup}>
                            <Text style={styles.infoLabel}>Level</Text>
                            <Text style={[styles.infoValue, { color: colors.text }]}>{profile.level || 'N/A'}</Text>
                        </View>
                    </View>
                    <View style={[styles.divider, { backgroundColor: colors.border }]} />
                    <View style={styles.infoRow}>
                        <Ionicons name="library-outline" size={20} color="#059669" />
                        <View style={styles.infoTextGroup}>
                            <Text style={styles.infoLabel}>Department</Text>
                            <Text style={[styles.infoValue, { color: colors.text }]}>{profile.department?.name || 'Library and Information Science'}</Text>
                        </View>
                    </View>
                    <View style={[styles.divider, { backgroundColor: colors.border }]} />
                    <View style={styles.infoRow}>
                        <Ionicons name="calendar-outline" size={20} color="#059669" />
                        <View style={styles.infoTextGroup}>
                            <Text style={styles.infoLabel}>Joined</Text>
                            <Text style={[styles.infoValue, { color: colors.text }]}>
                                {profile.created_at ? format(new Date(profile.created_at), 'MMMM yyyy') : 'Recently'}
                            </Text>
                        </View>
                    </View>
                </View>

                {/* Motivation Section */}
                {(profile.motivation) ? (
                    <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <Text style={[styles.sectionTitle, { color: colors.primary }]}>Motivation / Quote</Text>
                        <View style={[styles.quoteCard, { backgroundColor: isDark ? '#1e293b' : '#f8fafc' }]}>
                            <Ionicons name="chatbubble-ellipses-outline" size={18} color="#059669" style={{ marginRight: 10, marginTop: 2 }} />
                            <Text style={[styles.quoteText, { color: colors.text }]}>
                                {profile.motivation}
                            </Text>
                        </View>
                    </View>
                ) : null}

                {/* Hobbies Section */}
                {profile.hobbies ? (
                    <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <Text style={[styles.sectionTitle, { color: colors.primary }]}>Hobbies</Text>
                        <View style={styles.hobbiesRow}>
                            {(typeof profile.hobbies === 'string' ? profile.hobbies.split(',').map((s: string) => s.trim()) : (profile.hobbies || [])).map((hobby: string, idx: number) => (
                                hobby ? (
                                    <View key={idx} style={[styles.hobbyChip, { backgroundColor: isDark ? '#1e293b' : '#f1f5f9' }]}>
                                        <Text style={[styles.hobbyChipText, { color: isDark ? '#cbd5e1' : '#475569' }]}>{hobby}</Text>
                                    </View>
                                ) : null
                            ))}
                        </View>
                    </View>
                ) : null}

            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
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
    profileHeaderContainer: {
        alignItems: 'center',
        paddingVertical: 32,
        borderBottomWidth: 1,
        marginBottom: 16,
    },
    avatarContainer: {
        width: 140,
        height: 140,
        borderRadius: 70,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        marginBottom: 16,
        overflow: 'hidden',
    },
    avatar: {
        width: '100%',
        height: '100%',
    },
    profileName: {
        fontSize: 26,
        fontWeight: 'bold',
        marginBottom: 4,
        textAlign: 'center',
    },
    profileUsername: {
        fontSize: 16,
        color: '#64748b',
        marginBottom: 12,
    },
    onlineStatusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    onlineDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
    },
    onlineText: {
        fontSize: 14,
        color: '#64748b',
        fontWeight: '500',
    },
    section: {
        paddingHorizontal: 20,
        paddingVertical: 16,
        borderTopWidth: 1,
        borderBottomWidth: 1,
        marginBottom: 16,
    },
    sectionTitle: {
        fontSize: 14,
        fontWeight: 'bold',
        marginBottom: 8,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    bioText: {
        fontSize: 16,
        lineHeight: 24,
    },
    infoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
    },
    infoTextGroup: {
        marginLeft: 16,
        flex: 1,
    },
    infoLabel: {
        fontSize: 13,
        color: '#64748b',
        marginBottom: 2,
    },
    infoValue: {
        fontSize: 16,
        fontWeight: '500',
    },
    divider: {
        height: 1,
        width: '100%',
        marginLeft: 36,
    },
    quoteCard: {
        flexDirection: 'row',
        padding: 16,
        borderRadius: 12,
        marginTop: 8,
    },
    quoteText: {
        fontSize: 15,
        fontStyle: 'italic',
        lineHeight: 22,
        flex: 1,
    },
    hobbiesRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 8,
    },
    hobbyChip: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
    },
    hobbyChipText: {
        fontSize: 14,
        fontWeight: '500',
    },
});
