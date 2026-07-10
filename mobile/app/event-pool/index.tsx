import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, SafeAreaView, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { supabase } from '../../src/api/supabase/client';
import { useTheme } from '../../src/stores/theme.store';
import { useSentryScreen } from '../../src/hooks/useSentryScreen';
import {   isBefore, differenceInSeconds } from 'date-fns';

const { width } = Dimensions.get('window');

type EventPool = {
    id: string;
    title: string;
    type: string;
    status: 'live' | 'scheduled' | 'draft' | 'completed';
    start_time: string;
    end_time: string;
    participation_rule: string;
};

export default function EventPoolDashboard() {
    useSentryScreen('EventPoolDashboard');
    const { colors, isDark } = useTheme();
    const [pools, setPools] = useState<EventPool[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [serverTimeOffset, setServerTimeOffset] = useState<number>(0);
    const [tick, setTick] = useState(0);

    const fetchServerTimeOffset = async () => {
        try {
            const startFetch = Date.now();
            const { data, error } = await supabase.rpc('get_server_time');
            if (error) throw error;
            if (data) {
                const endFetch = Date.now();
                const latency = (endFetch - startFetch) / 2;
                const serverTime = new Date(data).getTime();
                const deviceTime = Date.now();
                setServerTimeOffset(serverTime - deviceTime + latency);
            }
        } catch (err) {
            console.error('Failed to sync server time:', err);
        }
    };

    const fetchPools = async () => {
        try {
            const { data, error } = await (supabase as any)
                .from('event_pools')
                .select('*')
                .in('status', ['live', 'scheduled'])
                .order('start_time', { ascending: true });
            
            if (error) throw error;
            setPools((data as EventPool[]) || []);
        } catch (err) {
            console.error('Failed to fetch event pools:', err);
        } finally {
            setIsLoading(false);
            setRefreshing(false);
        }
    };

    const loadData = async () => {
        await fetchServerTimeOffset();
        await fetchPools();
    };

    useEffect(() => {
        loadData();
        const interval = setInterval(() => setTick(t => t + 1), 1000);
        return () => clearInterval(interval);
    }, []);

    const onRefresh = () => {
        setRefreshing(true);
        loadData();
    };

    const getServerTime = () => new Date(Date.now() + serverTimeOffset);

    const livePools = useMemo(() => pools.filter(p => p.status === 'live'), [pools]);
    const scheduledPools = useMemo(() => pools.filter(p => p.status === 'scheduled'), [pools]);

    const cardBg = isDark ? '#1E2638' : '#FFFFFF';
    const textColor = isDark ? '#FFFFFF' : '#0f172a';
    const subtextColor = isDark ? '#94a3b8' : '#64748b';
    const borderColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';

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

    const renderPoolCard = (item: EventPool, isLive: boolean) => {
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
                    {isLive ? (
                        <TouchableOpacity 
                            style={styles.joinBtn}
                            onPress={() => router.push({ pathname: "/event-pool/[id]", params: { id: item.id } } as any)}
                        >
                            <Ionicons name="enter-outline" size={18} color="#fff" />
                            <Text style={styles.joinBtnText}>Join Event Room</Text>
                        </TouchableOpacity>
                    ) : (
                        <View style={styles.countdownContainer}>
                            <Ionicons name="time-outline" size={16} color={subtextColor} />
                            <Text style={[styles.countdownText, { color: subtextColor }]}>
                                Starts in: <Text style={{ color: textColor, fontWeight: '700' }}>{formatCountdown(item.start_time)}</Text>
                            </Text>
                        </View>
                    )}
                </View>
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
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
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
                        <Text style={[styles.sectionTitle, { color: textColor }]}>Upcoming Scheduled Events</Text>
                        {scheduledPools.map(pool => renderPoolCard(pool, false))}
                    </View>
                )}

                {!isLoading && livePools.length === 0 && scheduledPools.length === 0 && (
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
    card: {
        borderRadius: 12,
        borderWidth: 1,
        marginBottom: 16,
        padding: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
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
        fontWeight: '600',
        marginBottom: 4,
        lineHeight: 22,
    },
    subtitle: {
        fontSize: 12,
        fontWeight: '500',
        letterSpacing: 0.5,
    },
    statusBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
    },
    statusDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        marginRight: 4,
    },
    statusText: {
        fontSize: 10,
        fontWeight: '700',
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
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 8,
        width: '100%',
    },
    joinBtnText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '600',
        marginLeft: 6,
    },
    countdownContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.02)',
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 8,
        width: '100%',
    },
    countdownText: {
        fontSize: 14,
        marginLeft: 6,
    },
    emptyState: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 60,
    },
    emptyTitle: {
        fontSize: 18,
        fontWeight: '600',
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
