import React, { useEffect, useState } from 'react';
import { 
    View, Text, StyleSheet, TouchableOpacity, Modal, 
    FlatList, ActivityIndicator 
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { format } from 'date-fns';
import { supabase } from '../api/supabase/client';
import { useTheme } from '../stores/theme.store';
import { CachedImage } from './common/CachedImage';
import { sendPushNotification } from '../utils/notifications';

interface Congratulator {
    id: string;
    user_id: string;
    created_at: string;
    users: {
        id: string;
        full_name: string;
        username: string;
        avatar_url: string | null;
        level: string | null;
    };
}

export function FeaturedStudentCongratsCard({ userId }: { userId: string }) {
    const { colors, isDark } = useTheme();
    const [featuredId, setFeaturedId] = useState<string | null>(null);
    const [featuredTitle, setFeaturedTitle] = useState<string>('Featured Student');
    const [congratulators, setCongratulators] = useState<Congratulator[]>([]);
    const [totalCount, setTotalCount] = useState<number>(0);
    const [modalVisible, setModalVisible] = useState<boolean>(false);
    const [sendingAppreciationId, setSendingAppreciationId] = useState<string | null>(null);
    const [appreciatedIds, setAppreciatedIds] = useState<Record<string, boolean>>({});

    useEffect(() => {
        if (!userId) return;
        fetchFeaturedAndCongrats();
    }, [userId]);

    const fetchFeaturedAndCongrats = async () => {
        try {
            // Find active feature owned by this user
            const { data: featDataRaw } = await (supabase.from('featured_students') as any)
                .select('id, title, total_congratulations')
                .eq('user_id', userId)
                .eq('is_active', true)
                .order('published_at', { ascending: false })
                .limit(1)
                .single();

            const featData = featDataRaw as any;

            if (!featData) {
                setFeaturedId(null);
                return;
            }

            setFeaturedId(featData.id);
            setFeaturedTitle(featData.title);
            setTotalCount(featData.total_congratulations || 0);

            // Fetch list of congratulators
            const { data: congratsData } = await supabase
                .from('student_congratulations')
                .select(`
                    id, user_id, created_at,
                    users!student_congratulations_user_id_fkey ( id, full_name, username, avatar_url, level )
                `)
                .eq('featured_student_id' as any, featData.id as any)
                .order('created_at', { ascending: false });

            if (congratsData) {
                setCongratulators(congratsData as any as Congratulator[]);
                setTotalCount(congratsData.length);
            }
        } catch (e) {
            console.log('[FeaturedStudentCongratsCard] error fetching:', e);
        }
    };

    // Realtime listener for incoming congratulations
    useEffect(() => {
        if (!featuredId) return;

        const channel = supabase
            .channel(`home_fyb_congrats_${featuredId}_${Date.now()}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'student_congratulations',
                    filter: `featured_student_id=eq.${featuredId}`,
                },
                async (payload) => {
                    const newUserId = payload.new.user_id;
                    if (newUserId === userId) return;

                    const { data: userData } = await (supabase.from('users') as any)
                        .select('id, full_name, username, avatar_url, level')
                        .eq('id', newUserId)
                        .single();

                    if (userData) {
                        const newCongratulator: Congratulator = {
                            id: payload.new.id,
                            user_id: newUserId,
                            created_at: payload.new.created_at || new Date().toISOString(),
                            users: userData as any,
                        };

                        setCongratulators((prev) => [newCongratulator, ...prev.filter((c) => c.user_id !== newUserId)]);
                        setTotalCount((prev) => prev + 1);
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [featuredId, userId]);

    const handleSendAppreciation = async (targetUser: any) => {
        if (!targetUser?.id || sendingAppreciationId || appreciatedIds[targetUser.id]) return;

        setSendingAppreciationId(targetUser.id);
        try {
            await sendPushNotification({
                targetUserIds: [targetUser.id],
                title: '💕 Appreciation Received!',
                body: `The Featured Student sent you appreciation: "Thank you so much for the love! 💕"`,
                data: { type: 'fyb_appreciation' },
            });
            setAppreciatedIds((prev) => ({ ...prev, [targetUser.id]: true }));
        } catch (e) {
            console.error('Failed to send appreciation:', e);
        } finally {
            setSendingAppreciationId(null);
        }
    };

    if (!featuredId || totalCount === 0) return null;

    const latestCongratulator = congratulators[0]?.users;
    const firstUserText = latestCongratulator?.full_name || 'A student';
    const subText = totalCount > 1 
        ? `${firstUserText} and ${totalCount - 1} other${totalCount - 1 > 1 ? 's' : ''} congratulated you!`
        : `${firstUserText} (${latestCongratulator?.level ? `Level ${latestCongratulator.level}` : 'Student'}) congratulated you!`;

    return (
        <>
            {/* SINGLE DEDICATED AGGREGATED CARD */}
            <TouchableOpacity 
                style={[styles.cardContainer, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => setModalVisible(true)}
                activeOpacity={0.85}
            >
                <LinearGradient 
                    colors={['#059669', '#005A36']} 
                    start={{ x: 0, y: 0 }} 
                    end={{ x: 1, y: 0 }} 
                    style={styles.cardHeaderGradient}
                >
                    <View style={styles.headerRow}>
                        <Ionicons name="sparkles" size={16} color="#FFF" />
                        <Text style={styles.headerTitle}>YOUR FEATURED STUDENT CONGRATULATIONS</Text>
                    </View>
                    <View style={styles.countBadge}>
                        <Ionicons name="heart" size={14} color="#ef4444" />
                        <Text style={styles.countText}>{totalCount}</Text>
                    </View>
                </LinearGradient>

                <View style={styles.cardBody}>
                    <View style={styles.avatarsStack}>
                        {congratulators.slice(0, 3).map((c, i) => (
                            <CachedImage 
                                key={`stack-avatar-${c.id}`} 
                                remoteUrl={c.users?.avatar_url} 
                                style={[styles.stackAvatar, { zIndex: 10 - i, marginLeft: i > 0 ? -12 : 0 }]} 
                                entityId={c.user_id} 
                                assetType="user" 
                            />
                        ))}
                    </View>

                    <View style={styles.textContainer}>
                        <Text style={[styles.mainMessage, { color: colors.text }]} numberOfLines={1}>
                            {subText}
                        </Text>
                        <Text style={[styles.subHint, { color: colors.textMuted }]}>
                            Tap to view all student profiles who congratulated you • Realtime
                        </Text>
                    </View>

                    <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                </View>
            </TouchableOpacity>

            {/* CONGRATULATORS LIST MODAL SHEET */}
            <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={() => setModalVisible(false)}>
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalSheet, { backgroundColor: colors.card }]}>
                        <View style={styles.modalHeader}>
                            <View style={styles.modalTitleRow}>
                                <Ionicons name="heart" size={22} color="#ef4444" />
                                <Text style={[styles.modalTitle, { color: colors.text }]}>
                                    Students Who Congratulated You ({totalCount})
                                </Text>
                            </View>
                            <TouchableOpacity onPress={() => setModalVisible(false)} style={styles.closeBtn}>
                                <Ionicons name="close-circle" size={26} color={colors.textMuted} />
                            </TouchableOpacity>
                        </View>

                        <FlatList
                            data={congratulators}
                            keyExtractor={(item) => item.id}
                            contentContainerStyle={{ padding: 16 }}
                            renderItem={({ item }) => {
                                const u = item.users;
                                const isAppreciated = appreciatedIds[u?.id];
                                return (
                                    <View style={[styles.userRow, { borderBottomColor: colors.border }]}>
                                        <TouchableOpacity 
                                            style={styles.userInfo} 
                                            onPress={() => {
                                                setModalVisible(false);
                                                router.push(`/chat/user_profile?id=${u?.id}` as any);
                                            }}
                                            activeOpacity={0.8}
                                        >
                                            <CachedImage remoteUrl={u?.avatar_url} style={styles.userAvatar} entityId={u?.id || ''} assetType="user" />
                                            <View style={{ flex: 1 }}>
                                                <Text style={[styles.userName, { color: colors.text }]} numberOfLines={1}>
                                                    {u?.full_name || 'Anonymous Student'}
                                                </Text>
                                                <Text style={[styles.userMeta, { color: colors.textMuted }]}>
                                                    @{u?.username || 'user'} • {u?.level ? `Level ${u.level}` : 'LIS Dept'}
                                                </Text>
                                            </View>
                                        </TouchableOpacity>

                                        <TouchableOpacity
                                            style={[
                                                styles.appreciateBtn,
                                                isAppreciated && styles.appreciatedBtn
                                            ]}
                                            onPress={() => handleSendAppreciation(u)}
                                            disabled={isAppreciated || sendingAppreciationId === u?.id}
                                            activeOpacity={0.8}
                                        >
                                            {sendingAppreciationId === u?.id ? (
                                                <ActivityIndicator size="small" color="#fff" />
                                            ) : (
                                                <Text style={[styles.appreciateBtnText, isAppreciated && { color: colors.textMuted }]}>
                                                    {isAppreciated ? 'Appreciated 💕' : 'Appreciate 💕'}
                                                </Text>
                                            )}
                                        </TouchableOpacity>
                                    </View>
                                );
                            }}
                        />
                    </View>
                </View>
            </Modal>
        </>
    );
}

const styles = StyleSheet.create({
    cardContainer: {
        borderRadius: 20,
        overflow: 'hidden',
        borderWidth: 1.5,
        marginBottom: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 10,
        elevation: 4,
    },
    cardHeaderGradient: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 10,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    headerTitle: {
        color: '#FFFFFF',
        fontSize: 11,
        fontWeight: '900',
        letterSpacing: 0.8,
        textTransform: 'uppercase',
    },
    countBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.95)',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 14,
        gap: 4,
    },
    countText: {
        fontSize: 13,
        fontWeight: '900',
        color: '#ef4444',
    },
    cardBody: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 14,
        gap: 12,
    },
    avatarsStack: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    stackAvatar: {
        width: 38,
        height: 38,
        borderRadius: 19,
        borderWidth: 2,
        borderColor: '#FFFFFF',
    },
    textContainer: {
        flex: 1,
    },
    mainMessage: {
        fontSize: 14,
        fontWeight: '800',
        marginBottom: 2,
    },
    subHint: {
        fontSize: 11,
        fontWeight: '500',
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    modalSheet: {
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        maxHeight: '80%',
        minHeight: '40%',
    },
    modalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 20,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(0,0,0,0.08)',
    },
    modalTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    modalTitle: {
        fontSize: 17,
        fontWeight: '800',
    },
    closeBtn: {
        padding: 4,
    },
    userRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 12,
        borderBottomWidth: 1,
    },
    userInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        flex: 1,
        marginRight: 10,
    },
    userAvatar: {
        width: 44,
        height: 44,
        borderRadius: 22,
    },
    userName: {
        fontSize: 15,
        fontWeight: '800',
    },
    userMeta: {
        fontSize: 12,
        fontWeight: '500',
        marginTop: 2,
    },
    appreciateBtn: {
        backgroundColor: '#059669',
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 20,
    },
    appreciatedBtn: {
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: 'rgba(0,0,0,0.15)',
    },
    appreciateBtnText: {
        color: '#FFFFFF',
        fontSize: 12,
        fontWeight: '800',
    },
});
