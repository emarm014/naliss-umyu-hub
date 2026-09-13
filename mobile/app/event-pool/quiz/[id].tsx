import { SafeAreaView } from 'react-native-safe-area-context';
import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert, BackHandler, Animated, Image, AppState, AppStateStatus } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../src/api/supabase/client';
import { useTheme } from '../../../src/stores/theme.store';
import { useAuthStore } from '../../../src/stores';
import { useQuizStore } from '../../../src/stores/quiz.store';
import { useSentryScreen } from '../../../src/hooks/useSentryScreen';



type QuizQuestion = {
    id: string;
    question_text: string;
    options: string[];
    points: number;
    difficulty_level: string;
    question_type: string;
    media_url: string | null;
};

export default function QuizEngineScreen() {
    useSentryScreen('QuizEngine');
    const { id } = useLocalSearchParams<{ id: string }>();
    const { colors, isDark } = useTheme();
    const user = useAuthStore(s => s.profile);
    
    // Quiz Store
    const setAnswer = useQuizStore(s => s.setAnswer);
    const getAnswers = useQuizStore(s => s.getAnswers);
    const submitQuiz = useQuizStore(s => s.submitQuiz);
    const clearAnswers = useQuizStore(s => s.clearAnswers);
    const isSubmittingGlobal = useQuizStore(s => s.isSubmitting);
    
    const [questions, setQuestions] = useState<QuizQuestion[]>([]);
    const [poolInfo, setPoolInfo] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [timeLeft, setTimeLeft] = useState<number | null>(null);
    const [serverTimeOffset, setServerTimeOffset] = useState(0);
    const [poolStartedAt, setPoolStartedAt] = useState<number>(Date.now());
    const [questionTimeLeft, setQuestionTimeLeft] = useState<number | null>(null);
    const [feedbackMap, setFeedbackMap] = useState<Record<string, string>>({});

    const fadeAnim = useRef(new Animated.Value(1)).current;
    const appStateRef = useRef<AppStateStatus>(AppState.currentState);
    const pollingFallbackRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const [hasSubmitted, setHasSubmitted] = useState(false);

    const answers = getAnswers(id);

    const animateTransition = (callback: () => void) => {
        Animated.timing(fadeAnim, {
            toValue: 0,
            duration: 150,
            useNativeDriver: true,
        }).start(() => {
            callback();
            Animated.timing(fadeAnim, {
                toValue: 1,
                duration: 200,
                useNativeDriver: true,
            }).start();
        });
    };

    useEffect(() => {
        // Prevent back button on Android to prevent accidental exits
        const backAction = () => {
            Alert.alert("Hold on!", "Are you sure you want to exit the quiz? Your time will keep ticking.", [
                { text: "Cancel", style: "cancel" },
                { text: "YES, Exit", onPress: () => router.back() }
            ]);
            return true;
        };

        const backHandler = BackHandler.addEventListener("hardwareBackPress", backAction);
        return () => backHandler.remove();
    }, []);

    useEffect(() => {
        const initQuiz = async () => {
            if (!id || !user) return;
            setIsLoading(true);
            try {
                // 1. Fetch Pool Status & Deadline
                const { data: poolData, error: poolError } = await (supabase as any)
                    .from('event_pools')
                    .select('id, title, status, end_time, target_constraints')
                    .eq('id', id)
                    .single();
                
                if (poolError) throw poolError;
                if (poolData.status !== 'live') {
                    Alert.alert('Quiz Closed', 'This quiz is no longer active.');
                    router.back();
                    return;
                }
                setPoolInfo(poolData);

                // 2. Fetch Server Time to calculate accurate offset
                const { data: serverTimeData } = await supabase.rpc('get_server_time');
                if (serverTimeData) {
                    const serverDate = new Date(serverTimeData).getTime();
                    const localDate = Date.now();
                    setServerTimeOffset(serverDate - localDate);
                }

                // 3. Check if already submitted
                const { data: existingSub } = await (supabase as any)
                    .from('pool_submissions')
                    .select('id')
                    .eq('pool_id', id)
                    .eq('user_id', user.id)
                    .maybeSingle();
                
                if (existingSub) {
                    Alert.alert('Already Submitted', 'You have already completed this quiz.');
                    router.back();
                    return;
                }

                // 4. Fetch Questions securely
                const { data: qData, error: qError } = await supabase.rpc('get_safe_quiz_questions', { p_pool_id: id });
                if (qError) throw qError;
                
                // Shuffle options for each question to prevent pattern guessing
                const shuffledQs = ((qData as unknown as any[]) || []).map((q: any) => ({
                    ...q,
                    options: [...(q.options || [])].sort(() => Math.random() - 0.5)
                }));
                
                setQuestions(shuffledQs);

            } catch (err: any) {
                console.error('Quiz Init Error:', err);
                Alert.alert('Error', 'Failed to load quiz. Please try again.');
                router.back();
            } finally {
                setIsLoading(false);
            }
        };

        const loadOrSetStartTime = async () => {
            if (!id) return;
            try {
                const store = useQuizStore.getState();
                const existing = store.getPoolStartTime(id);
                if (existing) {
                    setPoolStartedAt(existing);
                } else {
                    // Call the secure start_quiz RPC on the server to lock in start time
                    await supabase.rpc('start_quiz', { p_pool_id: id });
                    
                    const { data: serverTimeData } = await supabase.rpc('get_server_time');
                    const now = serverTimeData ? new Date(serverTimeData).getTime() : Date.now();
                    store.setPoolStartTime(id, now);
                    setPoolStartedAt(now);
                }
            } catch(e) {}
        };

        initQuiz();
        loadOrSetStartTime();
    }, [id, user]);

    // Compute a stable absolute deadline timestamp (ms) from pool constraints.
    // This is the single source of truth for "when does this quiz end" and is
    // used by both the tick-based timer and the AppState reconciliation logic.
    const deadlineTimestamp = useMemo(() => {
        if (!poolInfo) return null;
        let deadline = Infinity;

        if (poolInfo.end_time) {
            deadline = Math.min(deadline, new Date(poolInfo.end_time).getTime());
        }

        if (poolInfo.target_constraints?.total_time_limit_sec && poolStartedAt) {
            deadline = Math.min(
                deadline,
                poolStartedAt + poolInfo.target_constraints.total_time_limit_sec * 1000
            );
        }

        return deadline === Infinity ? null : deadline;
    }, [poolInfo, poolStartedAt]);

    // Timer logic
    useEffect(() => {
        if (isLoading || !poolInfo || deadlineTimestamp === null) return;

        // Initialize timeLeft once based on server-offset corrected times
        const currentEstimatedServerTime = Date.now() + serverTimeOffset;
        const initialTimeLeft = Math.max(0, Math.floor((deadlineTimestamp - currentEstimatedServerTime) / 1000));

        setTimeLeft(initialTimeLeft);

        if (initialTimeLeft <= 0) {
            handleFinalSubmit(true);
            return;
        }

        let lastTickTime = Date.now();
        const interval = setInterval(() => {
            const nowClient = Date.now();
            let deltaSecs = Math.round((nowClient - lastTickTime) / 1000);
            // Protect against negative deltas due to client clock rollback
            if (deltaSecs <= 0) deltaSecs = 1;
            lastTickTime = nowClient;

            setTimeLeft(prev => {
                if (prev === null) return null;
                const next = prev - deltaSecs;
                if (next <= 0) {
                    clearInterval(interval);
                    handleFinalSubmit(true);
                    return 0;
                }
                return next;
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [poolInfo, serverTimeOffset, isLoading, poolStartedAt, deadlineTimestamp]);

    // Per-question timer
    useEffect(() => {
        if (isLoading || !poolInfo?.target_constraints?.time_limit_per_question_sec || isSubmittingGlobal) return;

        setQuestionTimeLeft(poolInfo.target_constraints.time_limit_per_question_sec);

        const interval = setInterval(() => {
            setQuestionTimeLeft(prev => {
                if (prev === null) return null;
                if (prev <= 1) {
                    setTimeout(() => {
                        if (currentIndex < questions.length - 1) {
                            animateTransition(() => setCurrentIndex(i => i + 1));
                        } else {
                            handleFinalSubmit(true);
                        }
                    }, 0);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [currentIndex, poolInfo, isLoading, isSubmittingGlobal, questions.length]);

    const handleFinalSubmit = async (autoSubmitted = false) => {
        if (isSubmittingGlobal || hasSubmitted) return;
        
        if (!autoSubmitted) {
            const unanswered = questions.filter(q => !answers[q.id]).length;
            if (unanswered > 0) {
                return Alert.alert(
                    'Unanswered Questions',
                    `You have ${unanswered} unanswered question(s). Are you sure you want to submit?`,
                    [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Submit Anyway', onPress: executeSubmit }
                    ]
                );
            }
        }
        
        executeSubmit();
    };

    const executeSubmit = async () => {
        setHasSubmitted(true);
        const result = await submitQuiz(id);
        if (result.success) {
            clearAnswers(id);
            Alert.alert('Quiz Completed!', `Your answers have been securely evaluated. Score: ${result.score}`, [
                { text: 'OK', onPress: () => router.back() }
            ]);
        } else {
            // Allow retry on failure (but not on "already submitted" errors)
            if (!result.error?.toLowerCase().includes('already')) {
                setHasSubmitted(false);
            }
            Alert.alert('Submission Failed', result.error || 'Please try again. Your answers are saved locally.');
        }
    };

    // =====================================================================
    // APPSTATE LIFECYCLE — DRIFT RECONCILIATION
    // =====================================================================
    const reconcileQuizTimerOnForeground = useCallback(() => {
        if (isSubmittingGlobal || hasSubmitted || deadlineTimestamp === null) return;

        const currentEstimatedServerTime = Date.now() + serverTimeOffset;
        const remainingSeconds = Math.max(0, Math.floor((deadlineTimestamp - currentEstimatedServerTime) / 1000));

        if (remainingSeconds <= 0) {
            // Time fully expired while app was minimized.
            // Force immediate submission with current saved answers to beat the 30s server grace window.
            console.warn('[QuizTimer] Time expired in background. Forcing emergency auto-submit.');
            handleFinalSubmit(true);
        } else {
            // Update local state timer immediately so the UI skips forward without tick lag
            setTimeLeft(remainingSeconds);
        }
    }, [serverTimeOffset, deadlineTimestamp, isSubmittingGlobal, hasSubmitted]);

    useEffect(() => {
        const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
            if (
                appStateRef.current.match(/inactive|background/) &&
                nextAppState === 'active'
            ) {
                // App just came back to foreground
                reconcileQuizTimerOnForeground();
            }
            appStateRef.current = nextAppState;
        });

        return () => subscription.remove();
    }, [reconcileQuizTimerOnForeground]);

    // =====================================================================
    // REALTIME CHANNEL — POOL STATUS + RECONNECTION FALLBACK
    // =====================================================================
    const triggerPollingFallback = useCallback(() => {
        // Only start one polling loop
        if (pollingFallbackRef.current) return;

        console.warn('[QuizRT] Channel disconnected. Falling back to 15s polling.');
        pollingFallbackRef.current = setInterval(async () => {
            try {
                const { data, error } = await (supabase as any)
                    .from('event_pools')
                    .select('id, title, status, end_time, target_constraints')
                    .eq('id', id)
                    .single();
                if (!error && data) {
                    setPoolInfo((prev: any) => prev ? { ...prev, ...data } : data);
                }
            } catch (e) {
                console.error('[QuizRT] Polling fallback error:', e);
            }
        }, 15_000);
    }, [id]);

    const clearPollingFallback = useCallback(() => {
        if (pollingFallbackRef.current) {
            clearInterval(pollingFallbackRef.current);
            pollingFallbackRef.current = null;
        }
    }, []);

    useEffect(() => {
        if (!id) return;

        const channel = supabase.channel(`quiz_pool_${id}_${Date.now()}`)
            .on('postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'event_pools', filter: `id=eq.${id}` },
                (payload) => {
                    if (payload.new) {
                        setPoolInfo((prev: any) => prev ? { ...prev, ...payload.new } : payload.new);
                    }
                }
            )
            .on('system' as any, {} as any, (payload: any) => {
                if (
                    payload.status === 'CHANNEL_ERROR' ||
                    payload.status === 'TIMED_OUT' ||
                    payload.status === 'CLOSED'
                ) {
                    triggerPollingFallback();
                }
                if (payload.status === 'SUBSCRIBED') {
                    clearPollingFallback();
                }
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
            clearPollingFallback();
        };
    }, [id, triggerPollingFallback, clearPollingFallback]);

    const handleOptionSelect = async (qId: string, option: string) => {
        const q = questions.find(x => x.id === qId);
        if (!q) return;

        const isStrict = poolInfo?.target_constraints?.strict_once_off_selection;
        const isMultiple = q.question_type === 'multiple';
        const currentAns = answers[qId];

        if (isStrict && currentAns && !isMultiple) return; // Locked

        let newAnswer = option;
        if (isMultiple) {
            const currentArr = currentAns ? currentAns.split(', ') : [];
            if (currentArr.includes(option)) {
                newAnswer = currentArr.filter((x: string) => x !== option).join(', ');
            } else {
                currentArr.push(option);
                newAnswer = currentArr.join(', ');
            }
        }

        setAnswer(id, qId, newAnswer);

        // Instant feedback if strict once-off and single choice
        if (poolInfo?.target_constraints?.instant_feedback && !isMultiple && isStrict) {
            try {
                const { data, error } = await supabase.rpc('check_quiz_answer', { p_question_id: qId });
                if (!error && data) {
                    setFeedbackMap(prev => ({ ...prev, [qId]: data }));
                }
            } catch(e) {}
        }
    };

    if (isLoading) {
        return (
            <SafeAreaView style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={{ marginTop: 10, color: colors.text }}>Securing connection...</Text>
            </SafeAreaView>
        );
    }

    if (questions.length === 0) {
        return (
            <SafeAreaView style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }}>
                <Text style={{ color: colors.text }}>No questions available for this quiz.</Text>
                <TouchableOpacity onPress={() => router.back()} style={{ padding: 10, backgroundColor: colors.primary, borderRadius: 8, marginTop: 20 }}>
                    <Text style={{ color: 'white' }}>Go Back</Text>
                </TouchableOpacity>
            </SafeAreaView>
        );
    }

    const currentQ = questions[currentIndex];
    
    // Format timer: MM:SS or HH:MM:SS
    const formatTime = (secs: number) => {
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        const s = secs % 60;
        if (h > 0) return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    const isLastQuestion = currentIndex === questions.length - 1;

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
                <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
                    <Ionicons name="close" size={28} color={colors.text} />
                </TouchableOpacity>
                <View style={styles.headerCenter}>
                    <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>{poolInfo?.title}</Text>
                    <Text style={[styles.subtitle, { color: colors.textMuted }]}>
                        Question {currentIndex + 1} of {questions.length}
                    </Text>
                </View>
                <View style={[styles.timerBadge, { backgroundColor: timeLeft && timeLeft < 60 ? '#ef4444' : colors.primary }]}>
                    <Text style={styles.timerText}>
                        {timeLeft !== null ? formatTime(timeLeft) : '--:--'}
                    </Text>
                </View>
            </View>

            {questionTimeLeft !== null && (
                <View style={{ backgroundColor: isDark ? '#334155' : '#e2e8f0', height: 4, width: '100%', overflow: 'hidden' }}>
                    <View style={{ backgroundColor: colors.primary, height: '100%', width: `${(questionTimeLeft / (poolInfo?.target_constraints?.time_limit_per_question_sec || 1)) * 100}%` }} />
                </View>
            )}

            <ScrollView contentContainerStyle={styles.content} bounces={false}>
                <Animated.View style={[styles.questionCard, { backgroundColor: colors.card, borderColor: colors.border, opacity: fadeAnim }]}>
                    {currentQ.media_url ? (
                        <Image source={{ uri: currentQ.media_url }} style={{ width: '100%', height: 200, borderRadius: 12, marginBottom: 16 }} resizeMode="cover" />
                    ) : null}
                    <Text style={[styles.questionText, { color: colors.text }]}>{currentQ.question_text}</Text>
                    
                    <View style={styles.optionsList}>
                        {currentQ.options.map((opt, idx) => {
                            const currentAns = answers[currentQ.id];
                            const isSelected = currentQ.question_type === 'multiple'
                                ? (currentAns ? currentAns.split(', ').includes(opt) : false)
                                : currentAns === opt;

                            const isStrict = poolInfo?.target_constraints?.strict_once_off_selection;
                            const isLocked = isStrict && !!currentAns && currentQ.question_type !== 'multiple';
                            const correctFeedback = feedbackMap[currentQ.id];

                            const emeraldAccent = '#059669';
                            let bgColor = isSelected ? `${emeraldAccent}20` : 'transparent';
                            let bdrColor = isSelected ? emeraldAccent : colors.border;

                            if (correctFeedback && isLocked) {
                                if (correctFeedback.includes(opt)) {
                                    bgColor = isDark ? 'rgba(16, 185, 129, 0.2)' : '#d1fae5';
                                    bdrColor = '#10b981';
                                } else if (isSelected) {
                                    bgColor = isDark ? 'rgba(239, 68, 68, 0.2)' : '#fee2e2';
                                    bdrColor = '#ef4444';
                                }
                            }

                            return (
                                <TouchableOpacity
                                    key={idx}
                                    disabled={isLocked || isSubmittingGlobal}
                                    style={[
                                        styles.optionBtn,
                                        { 
                                            backgroundColor: bgColor,
                                            borderColor: bdrColor
                                        }
                                    ]}
                                    onPress={() => handleOptionSelect(currentQ.id, opt)}
                                    activeOpacity={0.7}
                                >
                                    <View style={[styles.radioOuter, { borderColor: isSelected ? emeraldAccent : colors.textMuted }]}>
                                        {isSelected && <View style={[styles.radioInner, { backgroundColor: emeraldAccent }]} />}
                                    </View>
                                    <Text style={[styles.optionText, { color: colors.text }]}>{opt}</Text>
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                </Animated.View>
            </ScrollView>

            <View style={[styles.footer, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
                <TouchableOpacity 
                    style={[styles.navBtn, { opacity: currentIndex === 0 ? 0.3 : 1 }]} 
                    disabled={currentIndex === 0}
                    onPress={() => animateTransition(() => setCurrentIndex(prev => prev - 1))}
                >
                    <Ionicons name="chevron-back" size={24} color={colors.text} />
                    <Text style={[styles.navText, { color: colors.text }]}>Prev</Text>
                </TouchableOpacity>

                {isLastQuestion ? (
                    <TouchableOpacity 
                        style={[styles.submitBtn, { backgroundColor: colors.primary }]} 
                        onPress={() => handleFinalSubmit(false)}
                        disabled={isSubmittingGlobal}
                    >
                        <Text style={styles.submitText}>
                            {isSubmittingGlobal ? 'Submitting...' : 'Submit Quiz'}
                        </Text>
                    </TouchableOpacity>
                ) : (
                    <TouchableOpacity 
                        style={[styles.navBtn, { opacity: isLastQuestion ? 0.3 : 1 }]} 
                        disabled={isLastQuestion}
                        onPress={() => animateTransition(() => setCurrentIndex(prev => prev + 1))}
                    >
                        <Text style={[styles.navText, { color: colors.text }]}>Next</Text>
                        <Ionicons name="chevron-forward" size={24} color={colors.text} />
                    </TouchableOpacity>
                )}
            </View>
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
    questionCard: {
        borderRadius: 16,
        padding: 20,
        borderWidth: 1,
    },
    questionText: {
        fontSize: 18,
        fontWeight: '600',
        lineHeight: 28,
        marginBottom: 24,
    },
    optionsList: {
        gap: 12,
    },
    optionBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
    },
    radioOuter: {
        width: 20,
        height: 20,
        borderRadius: 10,
        borderWidth: 2,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    radioInner: {
        width: 10,
        height: 10,
        borderRadius: 5,
    },
    optionText: {
        fontSize: 16,
        flex: 1,
        lineHeight: 22,
    },
    footer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        borderTopWidth: 1,
    },
    navBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 8,
    },
    navText: {
        fontSize: 16,
        fontWeight: '600',
        marginHorizontal: 4,
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
