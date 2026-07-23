import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, SafeAreaView, Dimensions, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { supabase } from '../../src/api/supabase/client';
import { useTheme } from '../../src/stores/theme.store';
import { useAuthStore } from '../../src/stores/auth.store';
import { useEventPoolStore, EventPool } from '../../src/stores/event-pool.store';
import { useSentryScreen } from '../../src/hooks/useSentryScreen';
import { isBefore, differenceInSeconds } from 'date-fns';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { mmkvStorage } from '../../src/stores/mmkv.storage';

const { width } = Dimensions.get('window');
const CACHE_KEY = 'event_pools_cache';

export default function EventPoolDashboard() {
    useSentryScreen('EventPoolDashboard');
    const { colors, isDark } = useTheme();
    const queryClient = useQueryClient();
    const { profile } = useAuthStore();
    
    const [tick, setTick] = useState(0);
    const [securingTicketId, setSecuringTicketId] = useState<string | null>(null);

    const pools = useEventPoolStore(s => s.pools);
    const isLoading = useEventPoolStore(s => s.isLoading);
    const fetchPools = useEventPoolStore(s => s.fetchPools);
    const serverTimeOffset = useEventPoolStore(s => s.serverTimeOffset);
    const [isRefetching, setIsRefetching] = useState(false);

    const refetch = async () => {
        setIsRefetching(true);
        await fetchPools(true);
        setIsRefetching(false);
    };

    useEffect(() => {
        fetchPools();
    }, [fetchPools]);

    const { data: myApplications = [] } = useQuery({
        queryKey: ['my_pool_applications', profile?.id],
        queryFn: async () => {
            if (!profile?.id) return [];
            const { data } = await (supabase as any).from('pool_applications').select('pool_id, status').eq('user_id', profile.id);
            return (data || []) as any[];
        },
        enabled: !!profile?.id
    });

    useEffect(() => {
        const interval = setInterval(() => setTick(t => t + 1), 1000);
        return () => clearInterval(interval);
    }, []);

    const getServerTime = () => new Date(Date.now() + serverTimeOffset);

    const livePools = useMemo(() => pools.filter(p => p.status === 'live').reverse(), [pools]);
    const scheduledPools = useMemo(() => pools.filter(p => p.status === 'scheduled').reverse(), [pools]);
    const completedPools = useMemo(() => pools.filter(p => p.status === 'completed'), [pools]);

    const cardBg = colors.card;
    const textColor = colors.text;
    const subtextColor = colors.textMuted;
    const borderColor = colors.border;

    const formatCountdown = (targetDateStr: string) => {
        if (!targetDateStr) return 'TBA';
        const now = getServerTime();
        const target = new Date(targetDateStr);
        if (isBefore(target, now)) return 'Starting now...';
        
        const diffSeconds = differenceInSeconds(target, now);
        const d = Math.floor(diffSeconds / (3600 * 24));
        const h = Math.floor((diffSeconds % (3600 * 24)) / 3600);
        const m = Math.floor((diffSeconds % 3600) / 60);
        const s = diffSeconds % 60;

        if (d > 0) return `${d}d ${h}h ${m}m`;
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    const handleSecureTicket = async (poolId: string) => {
        if (!profile) return;
        setSecuringTicketId(poolId);
        try {
            const { data, error } = await supabase.rpc('secure_event_ticket', { p_pool_id: poolId });
            if (error) {
                alert(error.message);
            } else {
                alert('Application Submitted! 🎉 Waiting for admin approval.');
                queryClient.invalidateQueries({ queryKey: ['my_pool_applications'] });
                refetch();
            }
        } catch (e: any) {
            alert('Failed to secure ticket: ' + e.message);
        } finally {
            setSecuringTicketId(null);
        }
    };

    const renderPoolCard = (item: EventPool, isLive: boolean) => {
        const isRegistrationEnabled = item.target_constraints?.enable_registration ?? true;
        const maxParticipants = item.target_constraints?.max_participants;
        const currentParticipants = item.target_constraints?.selected_users?.length || 0;
        const isRegistered = item.target_constraints?.selected_users?.includes(profile?.id);
        const myApp = myApplications.find((app: any) => app.pool_id === item.id);
        const appStatus = myApp?.status || (isRegistered ? 'approved' : null);
        const isFull = maxParticipants && currentParticipants >= maxParticipants;
        
        let eligibilityMsg = null;
        if (item.participation_rule === 'level_based' && item.target_constraints?.allowed_levels) {
            if (!item.target_constraints.allowed_levels.includes(profile?.level?.toString())) {
                eligibilityMsg = `Level ${profile?.level} not eligible`;
            }
        } else if (item.participation_rule === 'department_based' && item.target_constraints?.allowed_departments) {
            if (!item.target_constraints.allowed_departments.includes(profile?.department_id)) {
                eligibilityMsg = 'Department not eligible';
            }
        } else if (item.participation_rule === 'individual_selection') {
            if (!isRegistered) {
                eligibilityMsg = 'Invite-only event';
            }
        }

        return (
            <View key={item.id} style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
                <View style={styles.cardHeader}>
                    <View style={styles.titleContainer}>
                        <Text style={[styles.title, { color: textColor }]} numberOfLines={2}>{item.title}</Text>
                        <Text style={[styles.subtitle, { color: subtextColor }]}>
                            {item.type.toUpperCase()} • {item.participation_rule.replace('_', ' ').toUpperCase()}
                        </Text>
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: isLive ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)' }]}>
                        <View style={[styles.statusDot, { backgroundColor: isLive ? '#10b981' : '#f59e0b' }]} />
                        <Text style={[styles.statusText, { color: isLive ? '#10b981' : '#f59e0b' }]}>
                            {isLive ? 'LIVE' : 'SCHEDULED'}
                        </Text>
                    </View>
                </View>

                <View style={styles.cardFooter}>
                    <View style={{ flex: 1 }}>
                        {!isLive && (
                            <View style={[styles.countdownContainer, { marginBottom: 12 }]}>
                                <Ionicons name="time-outline" size={16} color={subtextColor} />
                                <Text style={[styles.countdownText, { color: subtextColor }]}>
                                    Starts in: <Text style={{ color: textColor, fontWeight: '700' }}>{formatCountdown(item.start_time)}</Text>
                                </Text>
                            </View>
                        )}
                        
                        {maxParticipants && (
                            <View style={styles.ticketProgressContainer}>
                                <View style={styles.ticketProgressHeader}>
                                    <Text style={[styles.ticketProgressLabel, { color: subtextColor }]}>Tickets Secured</Text>
                                    <Text style={[styles.ticketProgressValue, { color: textColor }]}>
                                        {currentParticipants} / {maxParticipants}
                                    </Text>
                                </View>
                                <View style={styles.ticketProgressBarBg}>
                                    <View style={[
                                        styles.ticketProgressBarFill, 
                                        { width: `${Math.min((currentParticipants / maxParticipants) * 100, 100)}%`, backgroundColor: isFull ? '#ef4444' : '#3b82f6' }
                                    ]} />
                                </View>
                            </View>
                        )}

                        {isLive ? (
                            <TouchableOpacity 
                                style={[styles.joinBtn, (!isRegistered && !isRegistrationEnabled) && { backgroundColor: '#9ca3af' }]}
                                onPress={() => router.push({ pathname: "/event-pool/[id]", params: { id: item.id } } as any)}
                                disabled={!isRegistered && !isRegistrationEnabled}
                            >
                                <Ionicons name="enter-outline" size={18} color="#fff" />
                                <Text style={styles.joinBtnText}>Join Event Room</Text>
                            </TouchableOpacity>
                        ) : (
                            <View>
                                {isRegistered || appStatus === 'approved' ? (
                                    <View style={[styles.joinBtn, { backgroundColor: '#22c55e' }]}>
                                        <Ionicons name="ticket" size={18} color="#fff" />
                                        <Text style={styles.joinBtnText}>Ticket Secured</Text>
                                    </View>
                                ) : appStatus === 'pending' ? (
                                    <View style={[styles.joinBtn, { backgroundColor: '#eab308' }]}>
                                        <Ionicons name="time" size={18} color="#fff" />
                                        <Text style={styles.joinBtnText}>Pending Approval</Text>
                                    </View>
                                ) : appStatus === 'rejected' ? (
                                    <View style={[styles.joinBtn, { backgroundColor: '#ef4444' }]}>
                                        <Ionicons name="close-circle" size={18} color="#fff" />
                                        <Text style={styles.joinBtnText}>Application Denied</Text>
                                    </View>
                                ) : eligibilityMsg ? (
                                    <View style={[styles.joinBtn, { backgroundColor: '#f3f4f6' }]}>
                                        <Ionicons name="lock-closed" size={18} color="#9ca3af" />
                                        <Text style={[styles.joinBtnText, { color: '#9ca3af' }]}>{eligibilityMsg}</Text>
                                    </View>
                                ) : isFull ? (
                                    null
                                ) : isRegistrationEnabled ? (
                                    <TouchableOpacity 
                                        style={[styles.joinBtn, { opacity: securingTicketId === item.id ? 0.7 : 1 }]}
                                        onPress={() => handleSecureTicket(item.id)}
                                        disabled={securingTicketId === item.id}
                                    >
                                        <Ionicons name="add-circle-outline" size={18} color="#fff" />
                                        <Text style={styles.joinBtnText}>
                                            {securingTicketId === item.id ? 'Securing...' : 'Apply for Ticket'}
                                        </Text>
                                    </TouchableOpacity>
                                ) : (
                                    <View style={[styles.joinBtn, { backgroundColor: '#f3f4f6' }]}>
                                        <Ionicons name="lock-closed" size={18} color="#9ca3af" />
                                        <Text style={[styles.joinBtnText, { color: '#9ca3af' }]}>Registration Closed</Text>
                                    </View>
                                )}
                            </View>
                        )}
                    </View>
                </View>
            </View>
        );
    };

    const renderCompletedCard = (item: EventPool) => {
        const winner = item.featured_students?.[0]?.users;
        return (
            <View key={item.id} style={[styles.card, { backgroundColor: cardBg, borderColor, opacity: 0.95 }]}>
                <View style={styles.cardHeader}>
                    <View style={styles.titleContainer}>
                        <Text style={[styles.title, { color: textColor }]} numberOfLines={2}>{item.title}</Text>
                        <Text style={[styles.subtitle, { color: subtextColor }]}>
                            ENDED • {new Date(item.end_time || item.start_time).toLocaleDateString()}
                        </Text>
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: 'rgba(156, 163, 175, 0.15)' }]}>
                        <Ionicons name="checkmark-done" size={12} color="#6b7280" style={{ marginRight: 4 }} />
                        <Text style={[styles.statusText, { color: '#6b7280' }]}>COMPLETED</Text>
                    </View>
                </View>

                {winner ? (
                    <View style={styles.winnerContainer}>
                        <View style={styles.winnerBadge}>
                            <Ionicons name="trophy" size={16} color="#d97706" />
                        </View>
                        {winner.avatar_url ? (
                            <Image source={{ uri: winner.avatar_url }} style={styles.winnerAvatar} />
                        ) : (
                            <View style={styles.winnerAvatarPlaceholder}>
                                <Ionicons name="person" size={20} color="#9ca3af" />
                            </View>
                        )}
                        <View style={styles.winnerInfo}>
                            <Text style={[styles.winnerName, { color: textColor }]}>{winner.full_name}</Text>
                            <Text style={[styles.winnerUsername, { color: subtextColor }]}>Event Winner</Text>
                        </View>
                    </View>
                ) : (
                    <View style={[styles.countdownContainer, { backgroundColor: 'transparent', paddingHorizontal: 0 }]}>
                        <Text style={[styles.countdownText, { color: subtextColor, fontStyle: 'italic', marginLeft: 0 }]}>
                            Evaluating results...
                        </Text>
                    </View>
                )}
            </View>
        );
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
            <View style={[styles.header, { borderBottomColor: borderColor }]}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                    <Ionicons name="arrow-back" size={24} color={textColor} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: textColor }]}>Event Pool</Text>
                <View style={{ width: 40 }} />
            </View>

            <ScrollView 
                contentContainerStyle={styles.scrollContent}
                refreshControl={
                    <RefreshControl refreshing={isRefetching && !isLoading} onRefresh={refetch} tintColor={colors.primary} />
                }
            >
                {livePools.length > 0 && (
                    <View style={styles.section}>
                        <Text style={[styles.sectionTitle, { color: textColor }]}>Active Competitions / Live Rooms</Text>
                        {livePools.map(pool => renderPoolCard(pool, true))}
                    </View>
                )}

                {scheduledPools.length > 0 && (
                    <View style={[styles.section, { marginTop: livePools.length > 0 ? 24 : 0 }]}>
                        <Text style={[styles.sectionTitle, { color: textColor }]}>Upcoming Events</Text>
                        {scheduledPools.map(pool => renderPoolCard(pool, false))}
                    </View>
                )}

                {completedPools.length > 0 && (
                    <View style={[styles.section, { marginTop: (livePools.length > 0 || scheduledPools.length > 0) ? 32 : 0 }]}>
                        <View style={styles.historyHeader}>
                            <Ionicons name="time" size={20} color={subtextColor} />
                            <Text style={[styles.sectionTitle, { color: textColor, marginBottom: 0, marginLeft: 8 }]}>Past Events & Winners</Text>
                        </View>
                        <Text style={[styles.historySubtitle, { color: subtextColor }]}>History of previous competitions and their champions.</Text>
                        {completedPools.map(pool => renderCompletedCard(pool))}
                    </View>
                )}

                {!isLoading && pools.length === 0 && (
                    <View style={styles.emptyState}>
                        <Ionicons name="trophy-outline" size={64} color={subtextColor} style={{ opacity: 0.5 }} />
                        <Text style={[styles.emptyTitle, { color: textColor }]}>No Events Available</Text>
                        <Text style={[styles.emptySubtitle, { color: subtextColor }]}>Check back later for upcoming competitions and challenges.</Text>
                    </View>
                )}
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
    backBtn: {
        width: 40,
        height: 40,
        justifyContent: 'center',
        alignItems: 'flex-start',
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '700',
    },
    scrollContent: {
        padding: 16,
        paddingBottom: 40,
    },
    section: {
        marginBottom: 8,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '700',
        marginBottom: 16,
        letterSpacing: 0.3,
    },
    historyHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    historySubtitle: {
        fontSize: 13,
        marginBottom: 16,
    },
    card: {
        borderRadius: 16,
        borderWidth: 1,
        marginBottom: 16,
        padding: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 2,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 16,
    },
    titleContainer: {
        flex: 1,
        paddingRight: 12,
    },
    title: {
        fontSize: 17,
        fontWeight: '700',
        marginBottom: 4,
        lineHeight: 22,
    },
    subtitle: {
        fontSize: 12,
        fontWeight: '600',
        letterSpacing: 0.5,
    },
    statusBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 12,
    },
    statusDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        marginRight: 6,
    },
    statusText: {
        fontSize: 10,
        fontWeight: '800',
        letterSpacing: 0.5,
    },
    cardFooter: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 4,
    },
    joinBtn: {
        backgroundColor: '#10b981',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 12,
        width: '100%',
    },
    joinBtnText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '700',
        marginLeft: 8,
    },
    countdownContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.03)',
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 8,
        width: '100%',
    },
    countdownText: {
        fontSize: 14,
        marginLeft: 6,
    },
    ticketProgressContainer: {
        marginBottom: 12,
    },
    ticketProgressHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 6,
    },
    ticketProgressLabel: {
        fontSize: 12,
        fontWeight: '600',
    },
    ticketProgressValue: {
        fontSize: 12,
        fontWeight: '800',
    },
    ticketProgressBarBg: {
        height: 6,
        backgroundColor: '#e5e7eb',
        borderRadius: 3,
        overflow: 'hidden',
    },
    ticketProgressBarFill: {
        height: '100%',
        borderRadius: 3,
    },
    winnerContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(245, 158, 11, 0.05)',
        borderWidth: 1,
        borderColor: 'rgba(245, 158, 11, 0.2)',
        padding: 12,
        borderRadius: 12,
        marginTop: 4,
    },
    winnerBadge: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: 'rgba(245, 158, 11, 0.15)',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    winnerAvatar: {
        width: 40,
        height: 40,
        borderRadius: 20,
        marginRight: 12,
        borderWidth: 2,
        borderColor: '#f59e0b',
    },
    winnerAvatarPlaceholder: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#f3f4f6',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
        borderWidth: 2,
        borderColor: '#e5e7eb',
    },
    winnerInfo: {
        flex: 1,
    },
    winnerName: {
        fontSize: 15,
        fontWeight: '700',
    },
    winnerUsername: {
        fontSize: 13,
        fontWeight: '500',
        marginTop: 2,
    },
    emptyState: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 60,
    },
    emptyTitle: {
        fontSize: 18,
        fontWeight: '700',
        marginTop: 16,
        marginBottom: 8,
    },
    emptySubtitle: {
        fontSize: 14,
        textAlign: 'center',
        paddingHorizontal: 32,
        lineHeight: 20,
    }
});
