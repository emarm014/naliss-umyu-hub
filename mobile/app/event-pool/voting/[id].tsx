import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, SafeAreaView, ActivityIndicator, Alert, BackHandler, Image } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../src/api/supabase/client';
import { useTheme } from '../../../src/stores/theme.store';
import { useAuthStore } from '../../../src/stores';
import { useVotingStore } from '../../../src/stores/voting.store';
import { useSentryScreen } from '../../../src/hooks/useSentryScreen';
import { differenceInSeconds } from 'date-fns';

type Candidate = {
    id: string;
    user_id: string;
    answers: {
        text?: string;
        file_url?: string;
        file_type?: string;
    };
    users: {
        full_name: string;
        username: string;
        avatar_url: string | null;
    } | null;
};

export default function VotingEngineScreen() {
    useSentryScreen('VotingEngine');
    const { id } = useLocalSearchParams<{ id: string }>();
    const { colors, isDark } = useTheme();
    const user = useAuthStore((s: any) => s.profile);

    const setVoteDraft = useVotingStore((s) => s.setVoteDraft);
    const getVoteDraft = useVotingStore((s) => s.getVoteDraft);
    const submitVote = useVotingStore((s) => s.submitVote);
    const clearVoteDraft = useVotingStore((s) => s.clearVoteDraft);
    const isSubmittingGlobal = useVotingStore((s) => s.isSubmitting);

    const [poolInfo, setPoolInfo] = useState<any>(null);
    const [candidates, setCandidates] = useState<Candidate[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [timeLeft, setTimeLeft] = useState<number | null>(null);
    const [serverTimeOffset, setServerTimeOffset] = useState(0);
    const [selectedCandidateId, setSelectedCandidateId] = useState<string>(getVoteDraft(id || ''));

    // Handle back button protection
    useEffect(() => {
        const backAction = () => {
            Alert.alert("Exit Voting Room?", "Are you sure you want to exit? Your selected candidate draft is saved, but the voting clock is still running.", [
                { text: "Cancel", style: "cancel" },
                { text: "YES, Exit", onPress: () => router.back() }
            ]);
            return true;
        };

        const backHandler = BackHandler.addEventListener("hardwareBackPress", backAction);
        return () => backHandler.remove();
    }, []);

    // Auto-save selection to Zustand/MMKV store
    useEffect(() => {
        if (id && selectedCandidateId) {
            setVoteDraft(id, selectedCandidateId);
        }
    }, [selectedCandidateId, id]);

    useEffect(() => {
        const initVoting = async () => {
            if (!id || !user) return;
            setIsLoading(true);
            try {
                // 1. Fetch Pool Status & Deadline
                const { data: poolData, error: poolError } = await (supabase as any)
                    .from('event_pools')
                    .select('id, title, description, status, end_time, target_constraints')
                    .eq('id', id)
                    .single();

                if (poolError) throw poolError;
                if (poolData.status !== 'live') {
                    Alert.alert('Closed', 'This event pool is no longer live.');
                    router.back();
                    return;
                }
                setPoolInfo(poolData);

                // 2. Fetch Server Time
                const { data: serverTimeData } = await supabase.rpc('get_server_time');
                if (serverTimeData) {
                    const serverDate = new Date(serverTimeData).getTime();
                    const localDate = Date.now();
                    setServerTimeOffset(serverDate - localDate);
                }

                // 3. Check if user already voted
                const { data: existingSub } = await (supabase as any)
                    .from('pool_submissions')
                    .select('id')
                    .eq('pool_id', id)
                    .eq('user_id', user.id)
                    .single();

                if (existingSub) {
                    Alert.alert('Already Voted', 'You have already cast your vote in this event.');
                    router.back();
                    return;
                }

                // 4. Fetch Candidates (other pool participants who submitted work to be voted on)
                const { data: submissionData, error: submissionErr } = await (supabase as any)
                    .from('pool_submissions')
                    .select('id, user_id, answers, users:user_id(full_name, username, avatar_url)')
                    .eq('pool_id', id);

                if (submissionErr) throw submissionErr;
                setCandidates((submissionData || []) as Candidate[]);

            } catch (err: any) {
                console.error('Init Voting Error:', err);
                Alert.alert('Error', 'Failed to load voting room.');
                router.back();
            } finally {
                setIsLoading(false);
            }
        };

        initVoting();
    }, [id, user]);

    // Timer logic
    useEffect(() => {
        if (!poolInfo?.end_time || isLoading) return;

        const interval = setInterval(() => {
            const adjustedNow = new Date(Date.now() + serverTimeOffset);
            const endDate = new Date(poolInfo.end_time);
            const diff = differenceInSeconds(endDate, adjustedNow);

            if (diff <= 0) {
                clearInterval(interval);
                setTimeLeft(0);
                Alert.alert('Time Up', 'Voting has ended for this event.');
                router.back();
            } else {
                setTimeLeft(diff);
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [poolInfo?.end_time, serverTimeOffset, isLoading]);

    const handleVoteSubmit = async () => {
        if (isSubmittingGlobal || !selectedCandidateId) return;

        Alert.alert(
            'Confirm Vote',
            'Are you sure you want to lock in your vote? This action is permanent and cannot be modified.',
            [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Submit Vote', onPress: executeVoteSubmission }
            ]
        );
    };

    const executeVoteSubmission = async () => {
        if (!id) return;
        const result = await submitVote(id, selectedCandidateId);
        
        if (result.success) {
            clearVoteDraft(id);
            Alert.alert('Vote Cast!', 'Your vote has been securely recorded on the server.', [
                { text: 'OK', onPress: () => router.back() }
            ]);
        } else {
            Alert.alert('Failed to Vote', result.error || 'Please try again. Your selection is still saved locally.');
        }
    };

    if (isLoading) {
        return (
            <SafeAreaView style={[styles.centered, { backgroundColor: colors.background }]}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={{ marginTop: 10, color: colors.text }}>Securing voting booth...</Text>
            </SafeAreaView>
        );
    }

    const formatTime = (secs: number) => {
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        const s = secs % 60;
        if (h > 0) return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    const isTimeUp = timeLeft === 0;

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
                <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
                    <Ionicons name="close" size={28} color={colors.text} />
                </TouchableOpacity>
                <View style={styles.headerCenter}>
                    <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>Voting Room</Text>
                    <Text style={[styles.subtitle, { color: colors.textMuted }]}>{poolInfo?.title}</Text>
                </View>
                <View style={[styles.timerBadge, { backgroundColor: timeLeft && timeLeft < 60 ? '#ef4444' : colors.primary }]}>
                    <Text style={styles.timerText}>
                        {timeLeft !== null ? formatTime(timeLeft) : '--:--'}
                    </Text>
                </View>
            </View>

            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                <Text style={[styles.instructions, { color: colors.text }]}>
                    {poolInfo?.description || 'Select one of the presentation entries below to cast your vote.'}
                </Text>

                {candidates.length === 0 ? (
                    <View style={styles.emptyContainer}>
                        <Ionicons name="people-outline" size={48} color={colors.textMuted} />
                        <Text style={{ color: colors.textMuted, marginTop: 12, textAlign: 'center' }}>
                            No entries have been submitted to vote on yet.
                        </Text>
                    </View>
                ) : (
                    candidates.map((c) => {
                        const isSelected = selectedCandidateId === c.user_id;
                        return (
                            <TouchableOpacity
                                key={c.id}
                                disabled={isTimeUp || isSubmittingGlobal}
                                onPress={() => setSelectedCandidateId(c.user_id)}
                                style={[
                                    styles.card,
                                    { backgroundColor: colors.card, borderColor: isSelected ? colors.primary : colors.border },
                                    isSelected && { borderWidth: 2, shadowColor: colors.primary, shadowOpacity: 0.1, shadowRadius: 8, elevation: 4 }
                                ]}
                            >
                                <View style={styles.cardHeader}>
                                    <View style={styles.avatarContainer}>
                                        {c.users?.avatar_url ? (
                                            <Image source={{ uri: c.users.avatar_url }} style={styles.avatar} />
                                        ) : (
                                            <View style={[styles.avatarPlaceholder, { backgroundColor: colors.border }]}>
                                                <Text style={{ color: colors.text, fontWeight: '700' }}>
                                                    {c.users?.full_name?.substring(0, 2).toUpperCase() || 'U'}
                                                </Text>
                                            </View>
                                        )}
                                        <View style={styles.nameDetails}>
                                            <Text style={[styles.fullName, { color: colors.text }]}>{c.users?.full_name || 'Anonymous'}</Text>
                                            <Text style={[styles.username, { color: colors.textMuted }]}>@{c.users?.username || 'user'}</Text>
                                        </View>
                                    </View>
                                    <View style={[styles.selectionCircle, { borderColor: isSelected ? colors.primary : colors.textMuted }]}>
                                        {isSelected && <View style={[styles.selectionFill, { backgroundColor: colors.primary }]} />}
                                    </View>
                                </View>

                                {c.answers?.text && (
                                    <View style={styles.submissionTextContainer}>
                                        <Text style={[styles.submissionText, { color: colors.text }]} numberOfLines={5}>
                                            {c.answers.text}
                                        </Text>
                                    </View>
                                )}

                                {c.answers?.file_url && (
                                    <View style={styles.fileLinkContainer}>
                                        <Ionicons name="document-attach-outline" size={16} color={colors.primary} />
                                        <Text style={[styles.fileLinkText, { color: colors.primary }]} numberOfLines={1}>
                                            View attached entry file
                                        </Text>
                                    </View>
                                )}
                            </TouchableOpacity>
                        );
                    })
                )}
            </ScrollView>

            <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
                <TouchableOpacity
                    disabled={!selectedCandidateId || isTimeUp || isSubmittingGlobal}
                    onPress={handleVoteSubmit}
                    style={[
                        styles.submitBtn,
                        { backgroundColor: colors.primary },
                        (!selectedCandidateId || isTimeUp || isSubmittingGlobal) && { opacity: 0.5 }
                    ]}
                >
                    <Text style={styles.submitText}>
                        {isSubmittingGlobal ? 'Locking in vote...' : 'Cast Final Vote'}
                    </Text>
                </TouchableOpacity>
            </View>
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
    timerBadge: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
    },
    timerText: {
        color: '#FFFFFF',
        fontWeight: 'bold',
        fontSize: 14,
    },
    content: {
        padding: 16,
        paddingBottom: 100,
    },
    instructions: {
        fontSize: 14,
        lineHeight: 20,
        marginBottom: 20,
    },
    emptyContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 60,
    },
    card: {
        borderRadius: 12,
        borderWidth: 1,
        padding: 16,
        marginBottom: 16,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    avatarContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    avatar: {
        width: 40,
        height: 40,
        borderRadius: 20,
    },
    avatarPlaceholder: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
    },
    nameDetails: {
        marginLeft: 12,
        flex: 1,
    },
    fullName: {
        fontSize: 15,
        fontWeight: '600',
    },
    username: {
        fontSize: 12,
    },
    selectionCircle: {
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 2,
        justifyContent: 'center',
        alignItems: 'center',
        marginLeft: 12,
    },
    selectionFill: {
        width: 12,
        height: 12,
        borderRadius: 6,
    },
    submissionTextContainer: {
        marginTop: 12,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: 'rgba(128,128,128,0.1)',
    },
    submissionText: {
        fontSize: 14,
        lineHeight: 20,
    },
    fileLinkContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 12,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: 'rgba(128,128,128,0.1)',
    },
    fileLinkText: {
        marginLeft: 6,
        fontSize: 13,
        fontWeight: '500',
    },
    footer: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        padding: 16,
        borderTopWidth: 1,
    },
    submitBtn: {
        paddingVertical: 14,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    submitText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: 'bold',
    },
});
