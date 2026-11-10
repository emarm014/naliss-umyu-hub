import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert, BackHandler, TextInput, AppState, AppStateStatus } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../src/api/supabase/client';
import { useTheme } from '../../../src/stores/theme.store';
import { useAuthStore } from '../../../src/stores';
import { useDebateStore, DebateState, DebateRound } from '../../../src/stores/debate.store';
import { useSentryScreen } from '../../../src/hooks/useSentryScreen';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { normalizeError } from '../../../src/utils/sentry';

export default function DebateEngineScreen() {
    useSentryScreen('DebateEngine');
    const { id } = useLocalSearchParams<{ id: string }>();
    const { colors, isDark } = useTheme();
    const user = useAuthStore((s: any) => s.profile);
    const insets = useSafeAreaInsets();

    const advanceTurn = useDebateStore((s) => s.advanceTurn);
    const submitEntry = useDebateStore((s) => s.submitEntry);
    const isSubmittingGlobal = useDebateStore((s) => s.isSubmitting);
    const isAdvancingGlobal = useDebateStore((s) => s.isAdvancing);
    const markRoundSubmitted = useDebateStore((s) => s.markRoundSubmitted);
    const hasSubmittedRound = useDebateStore((s) => s.hasSubmittedRound);

    const [poolInfo, setPoolInfo] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [serverTimeOffset, setServerTimeOffset] = useState(0);
    const [debateState, setDebateState] = useState<DebateState | null>(null);

    // Turn timer
    const [turnTimeLeft, setTurnTimeLeft] = useState<number | null>(null);

    // Argument input
    const [argumentText, setArgumentText] = useState('');

    // Speaker name cache
    const [speakerNames, setSpeakerNames] = useState<Record<string, string>>({});

    // AppState ref
    const appStateRef = useRef<AppStateStatus>(AppState.currentState);

    const isModerator = user?.role === 'moderator' || user?.role === 'super_admin';
    const currentRound: DebateRound | null = debateState?.rounds?.[debateState.current_round_index] || null;
    const isMyTurn = !!user?.id && debateState?.active_speaker_id === user.id;
    const isDebateFinished = debateState?.completed_at != null || (debateState && debateState.current_round_index >= debateState.rounds.length);
    const totalRounds = debateState?.rounds?.length || 0;
    const currentRoundDisplay = debateState ? Math.min(debateState.current_round_index + 1, totalRounds) : 0;

    // Check if current round was already submitted by this user
    const currentRoundAlreadySubmitted = debateState && id
        ? hasSubmittedRound(id, debateState.current_round_index)
        : false;

    // Handle back button
    useEffect(() => {
        const backAction = () => {
            Alert.alert("Exit Debate Room?", "Are you sure you want to leave the debate room?", [
                { text: "Cancel", style: "cancel" },
                { text: "YES, Exit", onPress: () => router.back() }
            ]);
            return true;
        };

        const backHandler = BackHandler.addEventListener("hardwareBackPress", backAction);
        return () => backHandler.remove();
    }, []);

    // Initialize debate
    useEffect(() => {
        const initDebate = async () => {
            if (!id || !user) return;
            setIsLoading(true);
            try {
                // 1. Fetch pool
                const { data: poolData, error: poolError } = await (supabase as any)
                    .from('event_pools')
                    .select('id, title, status, end_time, target_constraints, description, type')
                    .eq('id', id)
                    .maybeSingle();

                if (poolError) throw normalizeError(poolError);
                if (!poolData) {
                    Alert.alert('Not Found', 'This debate could not be found.');
                    router.back();
                    return;
                }
                if (poolData.status !== 'live' && poolData.status !== 'completed') {
                    Alert.alert('Closed', 'This debate is no longer active.');
                    router.back();
                    return;
                }
                setPoolInfo(poolData);

                // 2. Extract debate state
                const ds = poolData.target_constraints?.debate_state as DebateState | undefined;
                if (ds) {
                    setDebateState(ds);
                }

                // 3. Fetch server time
                const { data: serverTimeData } = await supabase.rpc('get_server_time');
                if (serverTimeData) {
                    const serverDate = new Date(serverTimeData).getTime();
                    setServerTimeOffset(serverDate - Date.now());
                }

                // 4. Fetch speaker names
                if (ds?.rounds) {
                    const speakerIds = [...new Set(ds.rounds.map(r => r.speaker_id).filter(Boolean))];
                    if (speakerIds.length > 0) {
                        const { data: usersData } = await (supabase as any)
                            .from('users')
                            .select('id, full_name')
                            .in('id', speakerIds);

                        if (usersData) {
                            const nameMap: Record<string, string> = {};
                            usersData.forEach((u: any) => { nameMap[u.id] = u.full_name; });
                            setSpeakerNames(nameMap);
                        }
                    }
                }

            } catch (err: any) {
                console.error('Init Debate Error:', err);
                Alert.alert('Error', 'Failed to load debate room.');
                router.back();
            } finally {
                setIsLoading(false);
            }
        };

        initDebate();
    }, [id, user]);

    // Compute turn deadline timestamp
    const turnDeadline = useMemo(() => {
        if (!debateState?.turn_ends_at) return null;
        return new Date(debateState.turn_ends_at).getTime();
    }, [debateState?.turn_ends_at]);

    // Turn timer
    useEffect(() => {
        if (!turnDeadline || isDebateFinished) {
            setTurnTimeLeft(null);
            return;
        }

        const currentEstimatedServerTime = Date.now() + serverTimeOffset;
        const initialTimeLeft = Math.max(0, Math.floor((turnDeadline - currentEstimatedServerTime) / 1000));
        setTurnTimeLeft(initialTimeLeft);

        if (initialTimeLeft <= 0) return;

        let lastTickTime = Date.now();
        const interval = setInterval(() => {
            const nowClient = Date.now();
            let deltaSecs = Math.round((nowClient - lastTickTime) / 1000);
            if (deltaSecs <= 0) deltaSecs = 1;
            lastTickTime = nowClient;

            setTurnTimeLeft(prev => {
                if (prev === null) return null;
                const next = prev - deltaSecs;
                if (next <= 0) {
                    clearInterval(interval);
                    return 0;
                }
                return next;
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [turnDeadline, serverTimeOffset, isDebateFinished]);

    // AppState reconciliation
    const reconcileTurnTimer = useCallback(() => {
        if (!turnDeadline || isDebateFinished) return;

        const currentEstimatedServerTime = Date.now() + serverTimeOffset;
        const remaining = Math.max(0, Math.floor((turnDeadline - currentEstimatedServerTime) / 1000));
        setTurnTimeLeft(remaining);
    }, [turnDeadline, serverTimeOffset, isDebateFinished]);

    useEffect(() => {
        const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
            if (
                appStateRef.current.match(/inactive|background/) &&
                nextAppState === 'active'
            ) {
                reconcileTurnTimer();
            }
            appStateRef.current = nextAppState;
        });

        return () => subscription.remove();
    }, [reconcileTurnTimer]);

    // =====================================================================
    // REALTIME SUBSCRIPTION: Sync debate state across all devices
    // =====================================================================
    useEffect(() => {
        if (!id) return;

        const { realtimeManager } = require('../../../src/lib/realtimeManager');
        const unsubPool = realtimeManager.registerPoolListener((payload: any) => {
            if (payload?.eventType === 'UPDATE' && payload?.new?.id === id) {
                const newPool = payload.new as any;
                setPoolInfo((prev: any) => prev ? { ...prev, ...newPool } : newPool);
                const ds = newPool.target_constraints?.debate_state as DebateState | undefined;
                if (ds) {
                    setDebateState(ds);
                    setArgumentText('');
                }
                if (newPool.status === 'completed') {
                    Alert.alert('Debate Concluded', 'The debate has been concluded by the moderator.');
                }
            }
        });
        if (true) return () => { unsubPool(); };
        const channel = supabase.channel(`debate_pool_${id}`)
            .on('postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'event_pools', filter: `id=eq.${id}` },
                (payload) => {
                    if (payload.new) {
                        const newPool = payload.new as any;
                        setPoolInfo((prev: any) => prev ? { ...prev, ...newPool } : newPool);

                        // Update debate state from realtime
                        const ds = newPool.target_constraints?.debate_state as DebateState | undefined;
                        if (ds) {
                            setDebateState(ds);
                            setArgumentText(''); // Reset input on round change
                        }

                        // If pool status changed to completed
                        if (newPool.status === 'completed') {
                            Alert.alert('Debate Concluded', 'The debate has been concluded by the moderator.');
                        }
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [id]);

    // =====================================================================
    // ACTIONS
    // =====================================================================
    const handleAdvanceTurn = async () => {
        if (!id || isAdvancingGlobal) return;

        const roundLabel = debateState && debateState.current_round_index < totalRounds - 1
            ? 'Advance to next speaker?'
            : 'This will end the debate. Proceed?';

        Alert.alert('Advance Turn', roundLabel, [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Advance', onPress: async () => {
                    const result = await advanceTurn(id);
                    if (result.success) {
                        if (result.data?.finished) {
                            Alert.alert('Debate Concluded', 'All rounds have been completed.');
                        }
                        // Realtime subscription will sync the new state
                    } else {
                        Alert.alert('Failed', result.error || 'Could not advance the debate turn.');
                    }
                }
            }
        ]);
    };

    const handleSubmitArgument = async () => {
        if (!id || !argumentText.trim() || isSubmittingGlobal || !isMyTurn || currentRoundAlreadySubmitted) return;

        const content = {
            text: argumentText.trim(),
            word_count: argumentText.trim().split(/\s+/).filter(Boolean).length,
            submitted_client_time: new Date().toISOString(),
        };

        const result = await submitEntry(id, content);

        if (result.success) {
            markRoundSubmitted(id, debateState?.current_round_index || 0);
            setArgumentText('');
            Alert.alert('Argument Submitted', `Your argument for "${currentRound?.round_name || 'this round'}" has been recorded.`);
        } else {
            Alert.alert('Submission Failed', result.error || 'Please try again.');
        }
    };

    const handleExtendTime = async () => {
        if (!id || !debateState || !debateState.turn_ends_at || isAdvancingGlobal) return;
        try {
            const newEndTime = new Date(new Date(debateState.turn_ends_at).getTime() + 30000).toISOString();
            const updatedConstraints = {
                ...poolInfo?.target_constraints,
                debate_state: {
                    ...debateState,
                    turn_ends_at: newEndTime
                }
            };
            await (supabase as any).from('event_pools').update({ target_constraints: updatedConstraints }).eq('id', id);
        } catch (e) {
            Alert.alert("Error", "Could not extend time");
        }
    };

    const handlePointOfOrder = () => {
        if (!id || !user) return;
        supabase.channel(`debate_pool_${id}`).send({
            type: 'broadcast',
            event: 'point_of_order',
            payload: { user_id: user.id, name: user.full_name }
        });
        Alert.alert("Raised Hand", "The moderator has been pinged for a point of order.");
    };

    // =====================================================================
    // RENDERING
    // =====================================================================
    if (isLoading) {
        return (
            <SafeAreaView style={[styles.centered, { backgroundColor: colors.background }]}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={{ marginTop: 10, color: colors.text }}>Entering debate chamber...</Text>
            </SafeAreaView>
        );
    }

    const formatTime = (secs: number) => {
        const m = Math.floor(secs / 60);
        const s = secs % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    const isTurnExpired = turnTimeLeft === 0;
    const activeSpeakerName = debateState?.active_speaker_id
        ? speakerNames[debateState.active_speaker_id] || 'Speaker'
        : null;

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
            {/* Header */}
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
                <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
                    <Ionicons name="close" size={28} color={colors.text} />
                </TouchableOpacity>
                <View style={styles.headerCenter}>
                    <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>Debate Room</Text>
                    <Text style={[styles.subtitle, { color: colors.textMuted }]}>{poolInfo?.title}</Text>
                </View>
                {!isDebateFinished && (
                    <View style={[styles.roundBadge, { backgroundColor: isDark ? '#334155' : '#f1f5f9' }]}>
                        <Text style={[styles.roundBadgeText, { color: colors.text }]}>
                            {currentRoundDisplay}/{totalRounds}
                        </Text>
                    </View>
                )}
            </View>

            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                {/* Description */}
                {poolInfo?.description && (
                    <Text style={[styles.instructions, { color: colors.textMuted }]}>
                        {poolInfo.description}
                    </Text>
                )}

                {/* Debate finished banner */}
                {isDebateFinished && (
                    <View style={[styles.finishedBanner, { backgroundColor: isDark ? '#1e293b' : '#f0fdf4', borderColor: isDark ? '#334155' : '#bbf7d0' }]}>
                        <Ionicons name="checkmark-done-circle" size={24} color="#059669" />
                        <Text style={[styles.finishedText, { color: colors.text }]}>
                            Debate Concluded — All rounds have been completed.
                        </Text>
                    </View>
                )}

                {/* Active turn indicator */}
                {!isDebateFinished && currentRound && (
                    <>
                        {/* Turn timer + floor indicator */}
                        {isMyTurn ? (
                            <View style={[styles.floorBanner, { backgroundColor: isTurnExpired ? '#EF4444' : turnTimeLeft !== null && turnTimeLeft < 30 ? '#F59E0B' : '#10B981' }]}>
                                <View style={styles.floorBannerTop}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                        <Ionicons name="mic" size={24} color="#fff" />
                                        {turnTimeLeft !== null && turnTimeLeft > 0 && !isTurnExpired && (
                                            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#EF4444', opacity: 0.8 }} />
                                        )}
                                    </View>
                                    <Text style={styles.floorBannerTitle}>Your Floor</Text>
                                    <View style={styles.turnTimerBadge}>
                                        <Text style={[styles.turnTimerText, isTurnExpired && { color: '#fef2f2' }]}>
                                            {isTurnExpired ? 'EXPIRED' : (turnTimeLeft !== null ? formatTime(turnTimeLeft) : '--:--')}
                                        </Text>
                                    </View>
                                </View>
                                <Text style={styles.floorBannerSubtitle}>
                                    {isTurnExpired ? 'TIME EXPIRED - FLOOR MUST BE YIELDED' : `${currentRound.round_name} • ${currentRound.speaker_side.toUpperCase()}`}
                                </Text>
                            </View>
                        ) : (
                            <View style={[styles.floorBanner, { backgroundColor: isDark ? '#1e293b' : '#f8fafc', borderWidth: 1, borderColor: currentRound.speaker_side === 'affirmative' ? '#10B981' : '#3B82F6' }]}>
                                <View style={styles.floorBannerTop}>
                                    <View style={[styles.avatarCircle, { backgroundColor: currentRound.speaker_side === 'affirmative' ? '#10B981' : '#3B82F6' }]}>
                                        <Text style={styles.avatarInitials}>{activeSpeakerName?.substring(0,2).toUpperCase()}</Text>
                                    </View>
                                    <View style={{ flex: 1, marginLeft: 10 }}>
                                        <Text style={[styles.floorBannerTitle, { color: isDark ? '#f8fafc' : '#0f172a' }]}>
                                            Listening to {activeSpeakerName}
                                        </Text>
                                        <Text style={[styles.floorBannerSubtitle, { color: isDark ? '#94a3b8' : '#64748b', marginTop: 2 }]}>
                                            {currentRound.speaker_side.toUpperCase()}
                                        </Text>
                                    </View>
                                    <View style={[styles.turnTimerBadge, { backgroundColor: isTurnExpired ? '#EF4444' : turnTimeLeft !== null && turnTimeLeft < 30 ? '#F59E0B' : 'rgba(0,0,0,0.1)' }]}>
                                        <Text style={[styles.turnTimerText, { color: isTurnExpired || (turnTimeLeft !== null && turnTimeLeft < 30) ? '#fff' : (isDark ? '#e2e8f0' : '#334155') }]}>
                                            {isTurnExpired ? 'EXPIRED' : (turnTimeLeft !== null ? formatTime(turnTimeLeft) : '--:--')}
                                        </Text>
                                    </View>
                                </View>
                                
                                <TouchableOpacity onPress={handlePointOfOrder} style={styles.pointOfOrderBtn}>
                                    <Ionicons name="hand-right" size={16} color={isDark ? '#cbd5e1' : '#475569'} />
                                    <Text style={[styles.pointOfOrderText, { color: isDark ? '#cbd5e1' : '#475569' }]}>Raise Hand / Point of Order</Text>
                                </TouchableOpacity>
                            </View>
                        )}

                        {/* Argument input (only active speaker) */}
                        {isMyTurn && !isTurnExpired && !currentRoundAlreadySubmitted && (
                            <View style={styles.inputSection}>
                                <Text style={[styles.inputLabel, { color: colors.text }]}>Your Argument</Text>
                                <TextInput
                                    style={[
                                        styles.argumentInput,
                                        { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }
                                    ]}
                                    multiline
                                    scrollEnabled
                                    placeholder="Type your argument or key points here..."
                                    placeholderTextColor={colors.textMuted}
                                    value={argumentText}
                                    onChangeText={setArgumentText}
                                    textAlignVertical="top"
                                    editable={!isSubmittingGlobal}
                                />
                                <TouchableOpacity
                                    style={[
                                        styles.submitArgBtn,
                                        { backgroundColor: isTurnExpired ? '#EF4444' : '#059669' },
                                        (!argumentText.trim() && !isTurnExpired || isSubmittingGlobal) && { opacity: 0.5 }
                                    ]}
                                    onPress={handleSubmitArgument}
                                    disabled={(!argumentText.trim() && !isTurnExpired) || isSubmittingGlobal}
                                >
                                    <Text style={styles.submitArgBtnText}>
                                        {isSubmittingGlobal ? 'Submitting...' : 'Yield Floor / Conclude Turn Early'}
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        )}

                        {/* Already submitted indicator */}
                        {isMyTurn && currentRoundAlreadySubmitted && (
                            <View style={[styles.submittedBanner, { backgroundColor: isDark ? '#1e293b' : '#f0fdf4', borderColor: isDark ? '#334155' : '#86efac' }]}>
                                <Ionicons name="checkmark-circle" size={20} color="#059669" />
                                <Text style={[styles.submittedText, { color: isDark ? '#86efac' : '#166534' }]}>
                                    Argument submitted for this round
                                </Text>
                            </View>
                        )}

                        {/* Turn expired indicator */}
                        {isMyTurn && isTurnExpired && !currentRoundAlreadySubmitted && (
                            <View style={[styles.submittedBanner, { backgroundColor: isDark ? '#1e293b' : '#fef2f2', borderColor: isDark ? '#334155' : '#fca5a5' }]}>
                                <Ionicons name="time-outline" size={20} color="#ef4444" />
                                <Text style={[styles.submittedText, { color: '#ef4444' }]}>
                                    Speaking time has expired for this round
                                </Text>
                            </View>
                        )}
                    </>
                )}

                {/* Rounds timeline */}
                <View style={styles.timelineSection}>
                    <Text style={[styles.timelineTitle, { color: colors.text }]}>Debate Timeline</Text>
                    {debateState?.rounds.map((round, index) => {
                        const isActive = !isDebateFinished && debateState.current_round_index === index;
                        const isCompleted = debateState.current_round_index > index;
                        const speakerName = speakerNames[round.speaker_id] || 'TBD';

                        return (
                            <View key={index} style={[
                                styles.timelineItem,
                                { borderLeftColor: isActive ? '#059669' : isCompleted ? '#94a3b8' : colors.border }
                            ]}>
                                <View style={[
                                    styles.timelineDot,
                                    {
                                        backgroundColor: isActive ? '#059669' : isCompleted ? '#94a3b8' : colors.border,
                                    }
                                ]}>
                                    {isCompleted && <Ionicons name="checkmark" size={10} color="#fff" />}
                                    {isActive && <View style={styles.activeDotInner} />}
                                </View>
                                <View style={styles.timelineContent}>
                                    <Text style={[
                                        styles.timelineRoundName,
                                        { color: isActive ? '#059669' : colors.text },
                                        isActive && styles.timelineActive
                                    ]}>
                                        {round.round_name}
                                    </Text>
                                    <Text style={[styles.timelineSpeaker, { color: colors.textMuted }]}>
                                        {speakerName} • {round.speaker_side} • {round.duration_sec}s
                                    </Text>
                                </View>
                            </View>
                        );
                    })}
                </View>
            </ScrollView>

            {/* Moderator controls */}
            {isModerator && !isDebateFinished && (
                <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background, paddingBottom: Math.max(insets.bottom + 16, 16) }]}>
                    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                        <TouchableOpacity
                            onPress={handleExtendTime}
                            disabled={isAdvancingGlobal}
                            style={[styles.advanceBtn, { flex: 1, backgroundColor: '#10B981', paddingVertical: 10 }]}
                        >
                            <Ionicons name="time" size={18} color="#fff" />
                            <Text style={[styles.advanceBtnText, { fontSize: 14 }]}>+30s Time</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            onPress={handleAdvanceTurn}
                            disabled={isAdvancingGlobal}
                            style={[styles.advanceBtn, { flex: 1, backgroundColor: '#EF4444', paddingVertical: 10 }]}
                        >
                            <Ionicons name="mic-off" size={18} color="#fff" />
                            <Text style={[styles.advanceBtnText, { fontSize: 14 }]}>Mute Speaker</Text>
                        </TouchableOpacity>
                    </View>
                    <TouchableOpacity
                        onPress={handleAdvanceTurn}
                        disabled={isAdvancingGlobal}
                        style={[
                            styles.advanceBtn,
                            { backgroundColor: '#2563eb' },
                            isAdvancingGlobal && { opacity: 0.5 }
                        ]}
                    >
                        <Ionicons name="play-forward" size={20} color="#fff" />
                        <Text style={styles.advanceBtnText}>
                            {isAdvancingGlobal
                                ? 'Advancing...'
                                : debateState && debateState.current_round_index >= totalRounds - 1
                                    ? 'End Debate'
                                    : 'Advance to Next Turn'
                            }
                        </Text>
                    </TouchableOpacity>
                </View>
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    centered: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
    },
    closeBtn: {
        padding: 4,
    },
    headerCenter: {
        flex: 1,
        marginLeft: 12,
    },
    title: {
        fontSize: 18,
        fontWeight: 'bold',
    },
    subtitle: {
        fontSize: 12,
    },
    roundBadge: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
    },
    roundBadgeText: {
        fontSize: 13,
        fontWeight: '700',
        fontVariant: ['tabular-nums'],
    },
    content: {
        padding: 16,
        paddingBottom: 100,
    },
    instructions: {
        fontSize: 14,
        lineHeight: 20,
        marginBottom: 16,
    },
    finishedBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
        marginBottom: 16,
    },
    finishedText: {
        fontSize: 14,
        fontWeight: '600',
        flex: 1,
    },
    // Floor banner
    floorBanner: {
        padding: 16,
        borderRadius: 12,
        marginBottom: 16,
    },
    floorBannerTop: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    floorBannerTitle: {
        fontSize: 16,
        fontWeight: '700',
        color: '#fff',
        flex: 1,
    },
    turnTimerBadge: {
        backgroundColor: 'rgba(0,0,0,0.2)',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 8,
    },
    turnTimerText: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 16,
        fontVariant: ['tabular-nums'],
    },
    floorBannerSubtitle: {
        color: 'rgba(255,255,255,0.8)',
        fontSize: 13,
        marginTop: 6,
        fontWeight: '500',
    },
    // Input section
    inputSection: {
        marginBottom: 16,
    },
    inputLabel: {
        fontSize: 14,
        fontWeight: '600',
        marginBottom: 8,
    },
    argumentInput: {
        minHeight: 120,
        borderRadius: 12,
        borderWidth: 1,
        padding: 14,
        fontSize: 15,
        lineHeight: 22,
    },
    submitArgBtn: {
        marginTop: 12,
        paddingVertical: 12,
        borderRadius: 10,
        alignItems: 'center',
    },
    submitArgBtnText: {
        color: '#fff',
        fontSize: 15,
        fontWeight: 'bold',
    },
    // Submitted / expired indicators
    submittedBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        padding: 12,
        borderRadius: 10,
        borderWidth: 1,
        marginBottom: 16,
    },
    submittedText: {
        fontSize: 13,
        fontWeight: '600',
        flex: 1,
    },
    // Timeline
    timelineSection: {
        marginTop: 8,
    },
    timelineTitle: {
        fontSize: 16,
        fontWeight: '700',
        marginBottom: 16,
    },
    timelineItem: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingLeft: 16,
        paddingBottom: 20,
        borderLeftWidth: 2,
        marginLeft: 8,
    },
    timelineDot: {
        width: 18,
        height: 18,
        borderRadius: 9,
        position: 'absolute',
        left: -10,
        top: 0,
        justifyContent: 'center',
        alignItems: 'center',
    },
    activeDotInner: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#fff',
    },
    timelineContent: {
        marginLeft: 8,
        flex: 1,
    },
    timelineRoundName: {
        fontSize: 14,
        fontWeight: '500',
    },
    timelineActive: {
        fontWeight: '700',
    },
    timelineSpeaker: {
        fontSize: 12,
        marginTop: 2,
    },
    // Footer (moderator controls)
    footer: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        padding: 16,
        borderTopWidth: 1,
    },
    advanceBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 14,
        borderRadius: 10,
    },
    advanceBtnText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: 'bold',
    },
    avatarCircle: {
        width: 44,
        height: 44,
        borderRadius: 22,
        justifyContent: 'center',
        alignItems: 'center',
    },
    avatarInitials: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 18,
    },
    pointOfOrderBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        marginTop: 14,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: 'rgba(150, 150, 150, 0.2)',
    },
    pointOfOrderText: {
        fontSize: 14,
        fontWeight: '600',
    },
});
