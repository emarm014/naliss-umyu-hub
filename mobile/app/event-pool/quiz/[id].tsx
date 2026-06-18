import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, SafeAreaView, ActivityIndicator, Alert, BackHandler } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../src/api/supabase/client';
import { useTheme } from '../../../src/stores/theme.store';
import { useAuthStore } from '../../../src/stores';
import { useQuizStore } from '../../../src/stores/quiz.store';
import { useSentryScreen } from '../../../src/hooks/useSentryScreen';
import { differenceInSeconds } from 'date-fns';

type QuizQuestion = {
    id: string;
    question_text: string;
    options: string[];
    points: number;
    difficulty_level: string;
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

    const answers = getAnswers(id);

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
                    .select('id, title, status, end_time')
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
                    .single();
                
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
        initQuiz();
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
                handleFinalSubmit(true);
            } else {
                setTimeLeft(diff);
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [poolInfo?.end_time, serverTimeOffset, isLoading]);

    const handleFinalSubmit = async (autoSubmitted = false) => {
        if (isSubmittingGlobal) return;
        
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
        const result = await submitQuiz(id);
        if (result.success) {
            clearAnswers(id);
            Alert.alert('Quiz Completed!', `Your answers have been securely evaluated. Score: ${result.score}`, [
                { text: 'OK', onPress: () => router.back() }
            ]);
        } else {
            Alert.alert('Submission Failed', result.error || 'Please try again. Your answers are saved locally.');
        }
    };

    const handleOptionSelect = (qId: string, option: string) => {
        setAnswer(id, qId, option);
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

            <ScrollView contentContainerStyle={styles.content} bounces={false}>
                <View style={[styles.questionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Text style={[styles.questionText, { color: colors.text }]}>{currentQ.question_text}</Text>
                    
                    <View style={styles.optionsList}>
                        {currentQ.options.map((opt, idx) => {
                            const isSelected = answers[currentQ.id] === opt;
                            return (
                                <TouchableOpacity
                                    key={idx}
                                    style={[
                                        styles.optionBtn,
                                        { 
                                            backgroundColor: isSelected ? `${colors.primary}20` : 'transparent',
                                            borderColor: isSelected ? colors.primary : colors.border
                                        }
                                    ]}
                                    onPress={() => handleOptionSelect(currentQ.id, opt)}
                                    activeOpacity={0.7}
                                >
                                    <View style={[styles.radioOuter, { borderColor: isSelected ? colors.primary : colors.textMuted }]}>
                                        {isSelected && <View style={[styles.radioInner, { backgroundColor: colors.primary }]} />}
                                    </View>
                                    <Text style={[styles.optionText, { color: colors.text }]}>{opt}</Text>
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                </View>
            </ScrollView>

            <View style={[styles.footer, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
                <TouchableOpacity 
                    style={[styles.navBtn, { opacity: currentIndex === 0 ? 0.3 : 1 }]} 
                    disabled={currentIndex === 0}
                    onPress={() => setCurrentIndex(prev => prev - 1)}
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
                        onPress={() => setCurrentIndex(prev => prev + 1)}
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
