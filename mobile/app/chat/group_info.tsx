import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Platform, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../src/stores/theme.store';
import { COLORS } from '../../src/constants/Colors';
import { supabase } from '../../src/api/supabase/client';
import { useGroupStore } from '../../src/stores/group.store';
import { useAuthStore } from '../../src/stores/auth.store';
import { getCleanAvatarUrl } from '../../src/utils/avatar';
import { CachedImage } from '../../src/components/common/CachedImage';
import { NalissLogo } from '../../src/components/NalissLogo';

export default function GroupInfoScreen() {
    const { id } = useLocalSearchParams();
    const router = useRouter();
    const { colors, isDark } = useTheme();
    const { user: currentUser } = useAuthStore();
    
    // Use the existing group store to get group details
    const group = useGroupStore(state => state.groups.find(g => g.id === id));
    
    const [members, setMembers] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let mounted = true;
        
        const fetchMembers = async () => {
            if (!id || typeof id !== 'string') return;
            
            // Fast path: cached members
            const cached = useGroupStore.getState().getGroupMembers(id as string);
            if (cached && cached.length > 0 && mounted) {
                setMembers(cached);
                setIsLoading(false);
            }

            // Fetch latest from network
            try {
                const { data, error } = await (supabase as any).from('group_members')
                    .select('*, user:users(*, department:departments(name))')
                    .eq('group_id', id as string);

                if (error) throw error;
                const fetched = (data as any[])?.map(m => m.user).filter(Boolean) || [];
                
                if (mounted) {
                    setMembers(fetched);
                    setIsLoading(false);
                }
                useGroupStore.getState().setGroupMembers(id as string, fetched);
            } catch (error) {
                if (mounted && members.length === 0) {
                    setIsLoading(false);
                }
            }
        };

        fetchMembers();

        return () => { mounted = false; };
    }, [id]);

    const renderMemberItem = useCallback(({ item: member }: { item: any }) => {
        const isYou = member.id === currentUser?.id;
        
        return (
            <TouchableOpacity
                style={[styles.memberItem, { borderBottomColor: colors.border }]}
                onPress={() => {
                    // Navigate to full-screen user profile
                    router.push(`/chat/user_profile?id=${member.id}`);
                }}
            >
                <CachedImage 
                    remoteUrl={getCleanAvatarUrl(member.avatar_url)} 
                    style={styles.memberAvatar} 
                    entityId={`member_${member.id}`} 
                    assetType="user" 
                    fallbackName={member.full_name || member.username} 
                />
                <View style={styles.memberInfo}>
                    <View style={styles.memberNameRow}>
                        <Text style={[styles.memberFullName, { color: colors.text }]}>
                            {isYou ? `${member.full_name} (You)` : member.full_name}
                        </Text>
                        {(() => {
                            const { useNetworkStore } = require('../../src/stores/network.store');
                            const isOnline = useNetworkStore.getState().isOnline;
                            if (!isOnline) return null;
                            
                            const isUserOnline = isYou || (member.last_active_at && (new Date().getTime() - new Date(member.last_active_at).getTime() < 300000));
                            if (isUserOnline) {
                                return <View style={styles.memberOnlineDot} />;
                            }
                            return null;
                        })()}
                    </View>
                    <Text style={styles.memberUsername}>@{member.username}</Text>
                </View>
                <View style={[styles.memberLevelBadge, { backgroundColor: isDark ? '#334155' : '#f1f5f9' }]}>
                    <Text style={[styles.memberLevelText, { color: isDark ? '#94a3b8' : '#64748b' }]}>{member.level}</Text>
                </View>
            </TouchableOpacity>
        );
    }, [currentUser?.id, colors, isDark, router]);

    // Calculate count
    const hasCurrentUser = members.some(m => m.id === currentUser?.id);
    const totalCount = hasCurrentUser ? members.length : members.length + 1;

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
            <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
                <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                    <Ionicons name="chevron-back" size={24} color={colors.text} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: colors.text }]}>Group Info</Text>
                <View style={{ width: 32 }} />
            </View>

            <FlatList
                data={members}
                keyExtractor={(item) => item.id}
                renderItem={renderMemberItem}
                ListHeaderComponent={() => (
                    <View style={styles.groupHeaderContainer}>
                        <View style={[styles.groupAvatarContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                            {(() => {
                                const cleanUrl = getCleanAvatarUrl(group?.avatar_url);
                                return cleanUrl ? (
                                    <CachedImage
                                        remoteUrl={cleanUrl}
                                        style={styles.groupAvatar}
                                        entityId={`group_avatar_${id}`}
                                        assetType="avatar"
                                    />
                                ) : (
                                    <NalissLogo size={80} />
                                );
                            })()}
                        </View>
                        <Text style={[styles.groupName, { color: colors.text }]}>{group?.name || 'Group Chat'}</Text>
                        {group?.description ? (
                            <Text style={styles.groupDescription}>{group.description}</Text>
                        ) : null}

                        <View style={[styles.membersCountContainer, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
                            <Text style={styles.membersCountText}>
                                {totalCount} {totalCount === 1 ? 'member' : 'members'}
                            </Text>
                        </View>
                    </View>
                )}
                contentContainerStyle={{ paddingBottom: 24 }}
            />
            {isLoading && members.length === 0 && (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color="#10b981" />
                </View>
            )}
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
    groupHeaderContainer: {
        alignItems: 'center',
        paddingTop: 32,
        paddingBottom: 0,
    },
    groupAvatarContainer: {
        width: 120,
        height: 120,
        borderRadius: 60,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        marginBottom: 16,
        overflow: 'hidden',
    },
    groupAvatar: {
        width: '100%',
        height: '100%',
    },
    groupName: {
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 8,
        textAlign: 'center',
        paddingHorizontal: 24,
    },
    groupDescription: {
        fontSize: 15,
        color: '#64748b',
        textAlign: 'center',
        paddingHorizontal: 32,
        marginBottom: 24,
    },
    membersCountContainer: {
        width: '100%',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        marginTop: 16,
    },
    membersCountText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#10b981',
        textTransform: 'uppercase',
    },
    memberItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    memberAvatar: {
        width: 48,
        height: 48,
        borderRadius: 24,
        marginRight: 12,
        backgroundColor: '#e2e8f0',
        overflow: 'hidden',
    },
    memberInfo: {
        flex: 1,
        justifyContent: 'center',
    },
    memberNameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 2,
    },
    memberFullName: {
        fontSize: 16,
        fontWeight: '600',
    },
    memberOnlineDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#10b981',
    },
    memberUsername: {
        fontSize: 14,
        color: '#64748b',
    },
    memberLevelBadge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
        marginLeft: 8,
    },
    memberLevelText: {
        fontSize: 12,
        fontWeight: '600',
    },
    loadingContainer: {
        position: 'absolute',
        top: '50%',
        left: 0,
        right: 0,
        alignItems: 'center',
    }
});
