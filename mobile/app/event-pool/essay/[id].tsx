import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, SafeAreaView, ActivityIndicator, Alert, BackHandler, TextInput } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../src/api/supabase/client';
import { useTheme } from '../../../src/stores/theme.store';
import { useAuthStore } from '../../../src/stores';
import { useCompositionStore } from '../../../src/stores/composition.store';
import { useSentryScreen } from '../../../src/hooks/useSentryScreen';
import { differenceInSeconds } from 'date-fns';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function EssayEngineScreen() {
    useSentryScreen('EssayEngine');
    const { id } = useLocalSearchParams<{ id: string }>();
    const { colors, isDark } = useTheme();
    const user = useAuthStore((s: any) => s.profile);
    
    const setEssayDraft = useCompositionStore((s: any) => s.setEssayDraft);
    const getEssayDraft = useCompositionStore((s: any) => s.getEssayDraft);
    const submitEvaluation = useCompositionStore((s: any) => s.submitEvaluation);
    const clearDraft = useCompositionStore((s: any) => s.clearDraft);
    const isSubmittingGlobal = useCompositionStore((s: any) => s.isSubmitting);
    
    const [poolInfo, setPoolInfo] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [timeLeft, setTimeLeft] = useState<number | null>(null);
    const [serverTimeOffset, setServerTimeOffset] = useState(0);
    const [poolStartedAt, setPoolStartedAt] = useState<number>(Date.now());
    const [essayText, setEssayText] = useState(getEssayDraft(id));

    const maxWords = poolInfo?.target_constraints?.max_words || 500;
    const currentWords = essayText.trim().split(/\s+/).filter((w: string) => w.length > 0).length;
    const isOverLimit = currentWords > maxWords;

    // Handle back button protection
    useEffect(() => {
        const backAction = () => {
            Alert.alert("Hold on!", "Are you sure you want to exit? Your draft is safely saved to your device, but the clock will keep ticking.", [
                { text: "Cancel", style: "cancel" },
                { text: "YES, Exit", onPress: () => router.back() }
            ]);
            return true;
        };

        const backHandler = BackHandler.addEventListener("hardwareBackPress", backAction);
        return () => backHandler.remove();
    }, []);

    // Auto-save typing to MMKV store
    useEffect(() => {
        if (id) {
            setEssayDraft(id, essayText);
        }
    }, [essayText, id]);

    useEffect(() => {
        const initEssay = async () => {
            if (!id || !user) return;
            setIsLoading(true);
            try {
                // Fetch Pool Status & Deadline
                const { data: poolData, error: poolError } = await (supabase as any)
                    .from('event_pools')
                    .select('id, title, description, status, end_time, target_constraints')
                    .eq('id', id)
                    .single();
                
                if (poolError) throw poolError;
                if (poolData.status !== 'live') {
                    Alert.alert('Closed', 'This event is no longer active.');
                    router.back();
                    return;
                }
                setPoolInfo(poolData);

                // Fetch Server Time
                const { data: serverTimeData } = await supabase.rpc('get_server_time');
                if (serverTimeData) {
                    const serverDate = new Date(serverTimeData).getTime();
                    const localDate = Date.now();
                    setServerTimeOffset(serverDate - localDate);
                }

                // Check if already submitted
                const { data: existingSub } = await (supabase as any)
                    .from('pool_submissions')
                    .select('id')
                    .eq('pool_id', id)
                    .eq('user_id', user.id)
                    .single();
                
                if (existingSub) {
                    Alert.alert('Already Submitted', 'You have already submitted your essay.');
                    router.back();
                    return;
                }

            } catch (err: any) {
                console.error('Init Error:', err);
                Alert.alert('Error', 'Failed to load essay environment.');
                router.back();
            } finally {
                setIsLoading(false);
            }
        };

        const loadOrSetStartTime = async () => {
            if (!id) return;
            try {
                const key = `poolStartedAt_${id}`;
                const existing = await AsyncStorage.getItem(key);
                if (existing) {
                    setPoolStartedAt(parseInt(existing, 10));
                } else {
                    const now = Date.now();
                    await AsyncStorage.setItem(key, now.toString());
                    setPoolStartedAt(now);
                }
            } catch(e) {}
        };

        initEssay();
        loadOrSetStartTime();
    }, [id, user]);

    // Timer logic
    useEffect(() => {
        if (isLoading || !poolInfo) return;

        const interval = setInterval(() => {
            const adjustedNow = new Date(Date.now() + serverTimeOffset);
            let timeIsUp = false;

            if (poolInfo.end_time) {
                const endDate = new Date(poolInfo.end_time);
                if (differenceInSeconds(endDate, adjustedNow) <= 0) timeIsUp = true;
                else setTimeLeft(differenceInSeconds(endDate, adjustedNow));
            }

            if (poolInfo.target_constraints?.total_time_limit_sec) {
                const targetDate = new Date(poolStartedAt + poolInfo.target_constraints.total_time_limit_sec * 1000);
                if (differenceInSeconds(targetDate, adjustedNow) <= 0) timeIsUp = true;
                else {
                    const diff = differenceInSeconds(targetDate, adjustedNow);
                    if (timeLeft === null || diff < timeLeft) setTimeLeft(diff);
                }
            }

            if (timeIsUp) {
                clearInterval(interval);
                setTimeLeft(0);
                handleFinalSubmit(true);
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [poolInfo, serverTimeOffset, isLoading, poolStartedAt]);

    const handleFinalSubmit = async (autoSubmitted = false) => {
        if (isSubmittingGlobal) return;
        
        if (!autoSubmitted && isOverLimit) {
            return Alert.alert('Word Limit Exceeded', `Your essay is ${currentWords - maxWords} words over the limit.`);
        }

        if (!autoSubmitted) {
            return Alert.alert(
                'Submit Essay',
                'Are you sure you want to finalize your submission? This cannot be undone.',
                [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Submit Now', onPress: executeSubmit }
                ]
            );
        }
        
        executeSubmit();
    };

    const executeSubmit = async () => {
        const payload = { text: essayText };
        const result = await submitEvaluation(id, payload);
        
        if (result.success) {
            clearDraft(id);
            Alert.alert('Submitted Successfully!', 'Your essay has been securely locked in for administrative review.', [
                { text: 'OK', onPress: () => router.back() }
            ]);
        } else {
            Alert.alert('Submission Failed', result.error || 'Please try again. Your draft is still saved locally.');
        }
    };

    if (isLoading) {
        return (
            <SafeAreaView style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={{ marginTop: 10, color: colors.text }}>Securing environment...</Text>
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
                    <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>Essay Engine</Text>
                    <Text style={[styles.subtitle, { color: colors.textMuted }]}>{poolInfo?.title}</Text>
                </View>
                <View style={[styles.timerBadge, { backgroundColor: timeLeft && timeLeft < 60 ? '#ef4444' : '#059669' }]}>
                    <Text style={styles.timerText}>
                        {timeLeft !== null ? formatTime(timeLeft) : '--:--'}
                    </Text>
                </View>
            </View>

            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                <Text style={[styles.instructions, { color: colors.text }]}>
                    {poolInfo?.description || 'Write your response in the area below. Your progress is automatically saved to your device disk instantly.'}
                </Text>

                <TextInput
                    style={[
                        styles.essayInput, 
                        { backgroundColor: colors.card, color: colors.text, borderColor: isOverLimit ? '#ef4444' : colors.border }
                    ]}
                    multiline
                    scrollEnabled
                    editable={!isTimeUp && !isSubmittingGlobal}
                    placeholder="Start typing your essay here..."
                    placeholderTextColor={colors.textMuted}
                    value={essayText}
                    onChangeText={setEssayText}
                    textAlignVertical="top"
                />

                <View style={styles.footerRow}>
                    <Text style={[styles.wordCount, { color: isOverLimit ? '#ef4444' : colors.textMuted }]}>
                        {currentWords} / {maxWords} words
                    </Text>
                    
                    <TouchableOpacity 
                        style={[
                            styles.submitBtn, 
                            { backgroundColor: '#059669' },
                            (isOverLimit || isTimeUp || isSubmittingGlobal || currentWords === 0) && { opacity: 0.5 }
                        ]} 
                        onPress={() => handleFinalSubmit(false)}
                        disabled={isOverLimit || isTimeUp || isSubmittingGlobal || currentWords === 0}
                    >
                        <Text style={styles.submitText}>
                            {isSubmittingGlobal ? 'Submitting...' : 'Submit Essay'}
                        </Text>
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
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
        alignItems: 'center',
        paddingHorizontal: 8,
    },
    title: {
        fontSize: 16,
        fontWeight: 'bold',
    },
    subtitle: {
        fontSize: 12,
        marginTop: 2,
    },
    timerBadge: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
    },
    timerText: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 14,
        fontVariant: ['tabular-nums'],
    },
    content: {
        padding: 16,
        flexGrow: 1,
    },
    instructions: {
        fontSize: 14,
        lineHeight: 20,
        marginBottom: 16,
    },
    essayInput: {
        flex: 1,
        minHeight: 300,
        borderRadius: 12,
        borderWidth: 1,
        padding: 16,
        fontSize: 16,
        lineHeight: 24,
    },
    footerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 16,
        paddingBottom: 24,
    },
    wordCount: {
        fontSize: 14,
        fontWeight: '600',
    },
    submitBtn: {
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 24,
        elevation: 2,
    },
    submitText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: 'bold',
    }
});
