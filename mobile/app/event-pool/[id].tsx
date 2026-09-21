import { SafeAreaView } from 'react-native-safe-area-context';
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, TextInput, Alert, Image } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../src/api/supabase/client';
import { useTheme } from '../../src/stores/theme.store';
import { useAuthStore } from '../../src/stores';
import { useSentryScreen } from '../../src/hooks/useSentryScreen';
import { format, differenceInSeconds, isBefore } from 'date-fns';
import { mmkvStorage } from '../../src/stores/mmkv.storage';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { uploadLocalFileToCloudinary } from '../../src/lib/cloudinary';

type EventPoolDetail = {
    id: string;
    title: string;
    type: string;
    status: 'draft' | 'scheduled' | 'live' | 'paused' | 'completed' | 'archived';
    participation_rule: 'open' | 'level_based' | 'department_based' | 'individual_selection' | 'team_based';
    target_constraints: Record<string, any>;
    start_time: string;
    end_time: string;
    description?: string;
};

type QuizQuestion = {
    id: string;
    question_text: string;
    options: string[];
    points: number;
    question_type: string;
    media_url: string | null;
};

type LeaderboardEntry = {
    id: string;
    user_id: string;
    final_score: number;
    completed_at: string;
    winner_position?: number | null;
    users?: {
        full_name: string;
        username: string;
        avatar_url: string;
        level?: string;
    };
};

type TabId = 'overview' | 'live' | 'leaderboard' | 'results';

export default function EventPoolRoom() {
    useSentryScreen('EventPoolRoom');
    const { id } = useLocalSearchParams<{ id: string }>();
    const { colors, isDark } = useTheme();
    const user = useAuthStore(s => s.profile);

    const [pool, setPool] = useState<EventPoolDetail | null>(null);
    const [questions, setQuestions] = useState<QuizQuestion[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<TabId>('overview');
    const [isSubmitting, setIsSubmitting] = useState(false);
    
    // Status & Submission Lock
    const [tick, setTick] = useState(0);
    const [hasSubmitted, setHasSubmitted] = useState(false);
    const [submissionData, setSubmissionData] = useState<any>(null);

    // Server time offset & Timer
    const [serverTimeOffset, setServerTimeOffset] = useState(0);
    const [timeLeftSeconds, setTimeLeftSeconds] = useState<number | null>(null);
    const [isTimeUp, setIsTimeUp] = useState(false);
    const [poolStartedAt, setPoolStartedAt] = useState<number | null>(null);

    // Quiz State
    const [currentIndex, setCurrentIndex] = useState(0);
    const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
    const [questionTimeLeft, setQuestionTimeLeft] = useState<number | null>(null);
    const [feedbackMap, setFeedbackMap] = useState<Record<string, string>>({});

    // Essay State
    const [essayText, setEssayText] = useState('');

    // Challenge State
    const [challengeMediaUrl, setChallengeMediaUrl] = useState<string | null>(null);
    const [challengeMediaType, setChallengeMediaType] = useState<string | null>(null);

    // Leaderboard State
    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
    const [isLoadingLeaderboard, setIsLoadingLeaderboard] = useState(false);

    useEffect(() => {
        const initRoom = async () => {
            if (!id) return;
            try {
                // 1. Fetch server time
                const startFetch = Date.now();
                const { data: timeData } = await supabase.rpc('get_server_time');
                if (timeData) {
                    const latency = (Date.now() - startFetch) / 2;
                    setServerTimeOffset(new Date(timeData).getTime() - Date.now() + latency);
                }

                // 2. Fetch pool details
                const { data: poolData, error: poolErr } = await (supabase as any)
                    .from('event_pools')
                    .select('*')
                    .eq('id', id)
                    .maybeSingle();
                if (poolErr) throw poolErr;
                if (!poolData) {
                    Alert.alert('Not Found', 'This event pool could not be found.');
                    router.back();
                    return;
                }
                setPool(poolData as EventPoolDetail);

                // 3. If quiz, fetch questions
                if (poolData.type === 'quiz') {
                    const { data: qData, error: qErr } = await (supabase as any)
                        .from('pool_quiz_questions_safe')
                        .select('id, question_text, options, points, question_type, media_url')
                        .eq('pool_id', id)
                        .order('created_at', { ascending: true });
                    if (qErr) console.error('Failed to fetch questions:', qErr);
                    setQuestions((qData || []) as QuizQuestion[]);
                }

                // 4. Restore Progress from MMKV Synchronous Storage
                const savedProgress = await mmkvStorage.getItem(`pool_progress_${user?.id || 'anon'}_${id}`);
                if (savedProgress) {
                    let parsed = null;
                    try { parsed = savedProgress ? JSON.parse(savedProgress) : null; } catch { parsed = null; }
                    if (parsed.startedAt) setPoolStartedAt(parsed.startedAt);
                    else setPoolStartedAt(Date.now());

                    if (poolData.type === 'quiz') {
                        if (parsed.quizAnswers) setQuizAnswers(parsed.quizAnswers);
                        if (parsed.currentIndex !== undefined) setCurrentIndex(parsed.currentIndex);
                        if (parsed.feedbackMap) setFeedbackMap(parsed.feedbackMap);
                    }
                    if (poolData.type === 'essay' && parsed.essayText) setEssayText(parsed.essayText);
                    if (poolData.type === 'challenge' && parsed.challengeMediaUrl) {
                        setChallengeMediaUrl(parsed.challengeMediaUrl);
                        setChallengeMediaType(parsed.challengeMediaType);
                    }
                } else {
                    setPoolStartedAt(Date.now());
                }

                // 5. Fetch user submission if exists
                if (user) {
                    const { data: subData } = await (supabase as any)
                        .from('pool_submissions')
                        .select('payload')
                        .eq('pool_id', id)
                        .eq('user_id', user.id)
                        .maybeSingle();
                    if (subData) {
                        setHasSubmitted(true);
                        setSubmissionData(subData.payload);
                    } else {
                        // Fallback check for participants table if payload is empty
                        const { data: partData } = await (supabase as any)
                            .from('pool_participants')
                            .select('*')
                            .eq('pool_id', id)
                            .eq('user_id', user.id)
                            .maybeSingle();
                        if (partData?.completed_at) {
                            setHasSubmitted(true);
                        }
                    }
                }

            } catch (err) {
                console.error('Failed to init room:', err);
            } finally {
                setIsLoading(false);
            }
        };

        initRoom();

        const channel = supabase.channel(`pool_live_${id}`)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'event_pools', filter: `id=eq.${id}` }, (payload) => {
                if (payload.new) {
                    setPool(prev => prev ? { ...prev, ...payload.new } as EventPoolDetail : null);
                }
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [id]);

    // Tick for dynamic status
    useEffect(() => {
        const interval = setInterval(() => setTick(t => t + 1), 1000);
        return () => clearInterval(interval);
    }, []);

    const computedStatus = useMemo(() => {
        if (!pool) return 'loading';
        if (pool.status === 'draft') return 'draft';
        if (pool.status === 'completed' || pool.status === 'archived') return pool.status;
        
        const now = new Date(Date.now() + serverTimeOffset);
        const start = pool.start_time ? new Date(pool.start_time) : null;
        const end = pool.end_time ? new Date(pool.end_time) : null;

        if (start && isBefore(now, start)) return 'scheduled';
        if (end && isBefore(end, now)) return 'completed';
        return 'live';
    }, [pool, serverTimeOffset, tick]);

    const handleFinalSubmit = async (autoSubmitted: boolean = false, customPayload?: any) => {
        if (!pool || !user) return;
        if (pool.type === 'voting' || pool.type === 'talent') return; // Handled in dedicated engines
        
        setIsSubmitting(true);
        try {
            let answersPayload: any = {};
            if (customPayload) {
                answersPayload = customPayload;
            } else {
                if (pool.type === 'quiz') answersPayload = quizAnswers;
                else if (pool.type === 'essay') answersPayload = { text: essayText };
                else if (pool.type === 'challenge') answersPayload = { file_url: challengeMediaUrl, file_type: challengeMediaType };
            }
            let rpcError;
            
            if (pool.type === 'quiz') {
                const { error } = await supabase.rpc('submit_quiz', {
                    p_pool_id: pool.id,
                    p_answers: answersPayload
                });
                rpcError = error;
            } else if (pool.type === 'essay' || pool.type === 'challenge') {
                const { error } = await supabase.rpc('submit_manual_evaluation', {
                    p_pool_id: pool.id,
                    p_payload: answersPayload
                });
                rpcError = error;
            } else {
                throw new Error(`Unsupported pool type: ${pool.type}`);
            }

            if (rpcError) throw rpcError;
            
            await mmkvStorage.removeItem(`pool_progress_${user?.id || 'anon'}_${id}`);
            
            if (!autoSubmitted) {
                Alert.alert('Success', 'Your submission has been securely recorded.', [{ text: 'OK' }]);
            }
        } catch (err) {
            console.error('Submission failed:', err);
            if (!autoSubmitted) Alert.alert('Error', 'Failed to submit. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    // Save Progress logic (Debounced)
    useEffect(() => {
        if (!id || isLoading || !pool || isSubmitting || !poolStartedAt) return;
        
        const timeoutId = setTimeout(async () => {
            try {
                let dataToSave: any = { startedAt: poolStartedAt };
                if (pool.type === 'quiz') dataToSave = { ...dataToSave, quizAnswers, currentIndex, feedbackMap };
                else if (pool.type === 'essay') dataToSave = { ...dataToSave, essayText };
                else if (pool.type === 'challenge') dataToSave = { ...dataToSave, challengeMediaUrl, challengeMediaType };
                
                await mmkvStorage.setItem(`pool_progress_${user?.id || 'anon'}_${id}`, JSON.stringify(dataToSave));
            } catch (e) {
                console.error('Failed to save progress locally:', e);
            }
        }, 500);

        return () => clearTimeout(timeoutId);
    }, [quizAnswers, currentIndex, feedbackMap, essayText, challengeMediaUrl, id, isLoading, pool, isSubmitting, poolStartedAt]);

    // Leaderboard Fetching Logic
    useEffect(() => {
        if (activeTab === 'leaderboard' && pool?.id) {
            const fetchLeaderboard = async () => {
                setIsLoadingLeaderboard(true);
                try {
                    let query = (supabase as any)
                        .from('pool_participants')
                        .select('id, user_id, final_score, completed_at, winner_position, users:user_id (full_name, username, avatar_url, level)')
                        .eq('pool_id', pool.id);

                    if (pool.type === 'quiz') {
                        query = query.order('final_score', { ascending: false })
                                     .order('completed_at', { ascending: true })
                                     .limit(10); // Show top 10 as winners for auto-graded quizzes
                    } else {
                        query = query.not('winner_position', 'is', null)
                                     .order('winner_position', { ascending: true })
                                     .limit(50);
                    }
                    
                    const { data, error } = await query;
                    
                    if (error) throw error;
                    setLeaderboard((data || []) as LeaderboardEntry[]);
                } catch (e) {
                    console.error('Failed to fetch leaderboard:', e);
                } finally {
                    setIsLoadingLeaderboard(false);
                }
            };
            fetchLeaderboard();
        }
    }, [activeTab, pool?.id]);

    const isParticipant = useMemo(() => {
        if (!pool || !user) return false;
        if (pool.participation_rule === 'open') return true;

        if (pool.participation_rule === 'level_based') {
            const levels = pool.target_constraints?.levels || [];
            if (user.level && levels.includes(user.level)) return true;
        }

        if (pool.participation_rule === 'department_based') {
            const deptId = pool.target_constraints?.department_id;
            if (user.department_id && deptId === user.department_id) return true;
        }

        if (pool.participation_rule === 'individual_selection') {
            const selectedUsers = pool.target_constraints?.selected_users || [];
            if (selectedUsers.includes(user.id)) return true;
        }

        return false;
    }, [pool, user]);

    // Timer logic
    useEffect(() => {
        if (!pool || isTimeUp || !isParticipant || isSubmitting) return;
        
        const interval = setInterval(() => {
            const now = new Date(Date.now() + serverTimeOffset);
            let totalTimeUp = false;

            if (pool.end_time) {
                const target = new Date(pool.end_time);
                if (isBefore(target, now)) totalTimeUp = true;
                else setTimeLeftSeconds(differenceInSeconds(target, now));
            }

            if (pool.target_constraints?.total_time_limit_sec && poolStartedAt) {
                const target = new Date(poolStartedAt + pool.target_constraints.total_time_limit_sec * 1000);
                if (isBefore(target, now)) totalTimeUp = true;
                else {
                    const diff = differenceInSeconds(target, now);
                    if (timeLeftSeconds === null || diff < timeLeftSeconds) {
                        setTimeLeftSeconds(diff);
                    }
                }
            }

            if (totalTimeUp) {
                setIsTimeUp(true);
                setTimeLeftSeconds(0);
                clearInterval(interval);
                handleFinalSubmit(true);
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [pool, serverTimeOffset, isTimeUp, isParticipant, poolStartedAt, isSubmitting]);

    // Per-question timer
    useEffect(() => {
        if (!pool || pool.type !== 'quiz' || !pool.target_constraints?.time_limit_per_question_sec || isTimeUp || isSubmitting) return;

        setQuestionTimeLeft(pool.target_constraints.time_limit_per_question_sec);

        const interval = setInterval(() => {
            setQuestionTimeLeft(prev => {
                if (prev === null) return null;
                if (prev <= 1) {
                    setTimeout(() => {
                        if (currentIndex < questions.length - 1) {
                            setCurrentIndex(c => c + 1);
                        } else {
                            if (!isSubmitting && !isTimeUp) handleFinalSubmit(true);
                        }
                    }, 0);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [currentIndex, pool, isTimeUp, isSubmitting, questions.length]);

    const cardBg = colors.card;
    const textColor = colors.text;
    const subtextColor = colors.textMuted;
    const borderColor = colors.border;
    const brandColor = colors.primary;

    const renderTabs = () => {
        const tabs: { id: TabId; label: string }[] = [
            { id: 'overview', label: 'Overview' },
            { id: 'live', label: 'Live Action' },
            { id: 'leaderboard', label: 'Winners' },
            { id: 'results', label: 'Results' },
        ];

        return (
            <View style={[styles.tabBar, { borderBottomColor: borderColor }]}>
                {tabs.map(tab => {
                    const isActive = activeTab === tab.id;
                    return (
                        <TouchableOpacity
                            key={tab.id}
                            style={[styles.tabItem, isActive && { borderBottomColor: brandColor }]}
                            onPress={() => setActiveTab(tab.id)}
                        >
                            <Text style={[styles.tabText, isActive ? { color: brandColor, fontWeight: '700' } : { color: subtextColor }]}>
                                {tab.label}
                            </Text>
                        </TouchableOpacity>
                    );
                })}
            </View>
        );
    };

    const renderOverview = () => {
        if (!pool) return null;
        return (
            <ScrollView contentContainerStyle={styles.contentContainer}>
                {pool.target_constraints?.media_url ? (
                    <Image 
                        source={{ uri: pool.target_constraints.media_url }} 
                        style={{ width: '100%', height: 220, borderRadius: 16, marginBottom: 16 }} 
                        resizeMode="cover" 
                    />
                ) : null}

                <View style={[styles.infoCard, { backgroundColor: cardBg, borderColor }]}>
                    <Text style={[styles.sectionTitle, { color: textColor }]}>Event Rules & Info</Text>
                    <Text style={[styles.bodyText, { color: subtextColor, marginTop: 8 }]}>
                        {pool.description || "Welcome to the event room. Please review the criteria and schedule carefully before the live action begins."}
                    </Text>
                    
                    <View style={styles.metaDataList}>
                        <View style={styles.metaRow}>
                            <Ionicons name="time-outline" size={18} color={subtextColor} />
                            <Text style={[styles.metaText, { color: textColor }]}>
                                Starts: {pool.start_time ? format(new Date(pool.start_time), 'MMM d, yyyy h:mm a') : 'TBA'}
                            </Text>
                        </View>
                        <View style={styles.metaRow}>
                            <Ionicons name="time-outline" size={18} color={subtextColor} />
                            <Text style={[styles.metaText, { color: textColor }]}>
                                Ends: {pool.end_time ? format(new Date(pool.end_time), 'MMM d, yyyy h:mm a') : 'TBA'}
                            </Text>
                        </View>
                        <View style={styles.metaRow}>
                            <Ionicons name="people-outline" size={18} color={subtextColor} />
                            <Text style={[styles.metaText, { color: textColor }]}>
                                Eligibility: {pool.participation_rule.replace('_', ' ').toUpperCase()}
                            </Text>
                        </View>
                    </View>

                    {pool.target_constraints?.instructions ? (
                        <View style={{ marginTop: 24, paddingTop: 24, borderTopWidth: 1, borderTopColor: borderColor }}>
                            <Text style={[styles.sectionTitle, { color: textColor, marginBottom: 8 }]}>Participant Instructions</Text>
                            <Text style={[styles.bodyText, { color: subtextColor }]}>
                                {pool.target_constraints.instructions}
                            </Text>
                        </View>
                    ) : null}
                </View>
            </ScrollView>
        );
    };

    const handleQuizOptionSelect = async (qId: string, option: string) => {
        if (isTimeUp || isSubmitting) return;
        
        const q = questions.find(x => x.id === qId);
        if (!q) return;

        const isStrict = pool?.target_constraints?.strict_once_off_selection;
        const isMultiple = q.question_type === 'multiple';

        if (isStrict && quizAnswers[qId] && !isMultiple) return; // Locked

        let newAnswer = option;
        if (isMultiple) {
            const currentArr = quizAnswers[qId] ? quizAnswers[qId].split(', ') : [];
            if (currentArr.includes(option)) {
                newAnswer = currentArr.filter(x => x !== option).join(', ');
            } else {
                currentArr.push(option);
                newAnswer = currentArr.join(', ');
            }
        }

        setQuizAnswers(prev => ({ ...prev, [qId]: newAnswer }));

        if (pool?.target_constraints?.instant_feedback && !isMultiple && isStrict) {
            try {
                const { data, error } = await supabase.rpc('check_quiz_answer', { p_question_id: qId });
                if (!error && data) {
                    setFeedbackMap(prev => ({ ...prev, [qId]: data }));
                }
            } catch(e) {}
        }
    };

    const renderQuizEngine = () => {
        if (questions.length === 0) {
            return (
                <View style={styles.centeredContainer}>
                    <Text style={{ color: subtextColor }}>No questions available for this quiz.</Text>
                </View>
            );
        }

        const q = questions[currentIndex];
        const selected = quizAnswers[q.id];

        return (
            <ScrollView contentContainerStyle={styles.contentContainer}>
                {timeLeftSeconds !== null && (
                    <View style={[styles.timerBanner, isTimeUp && { backgroundColor: '#ef4444' }]}>
                        <Ionicons name="timer-outline" size={18} color="#fff" />
                        <Text style={styles.timerText}>
                            {isTimeUp ? 'TIME UP! AUTO-SUBMITTING...' : `Time Left: ${Math.floor(timeLeftSeconds / 60)}:${(timeLeftSeconds % 60).toString().padStart(2, '0')}`}
                        </Text>
                    </View>
                )}

                <View style={styles.quizHeader}>
                    <Text style={[styles.quizProgress, { color: subtextColor }]}>Question {currentIndex + 1} of {questions.length}</Text>
                    <Text style={[styles.quizPoints, { color: brandColor }]}>{q.points} Points</Text>
                </View>

                {questionTimeLeft !== null && (
                    <View style={{ backgroundColor: isDark ? '#334155' : '#e2e8f0', height: 4, borderRadius: 2, marginVertical: 8, overflow: 'hidden' }}>
                        <View style={{ backgroundColor: brandColor, height: '100%', width: `${(questionTimeLeft / (pool?.target_constraints?.time_limit_per_question_sec || 1)) * 100}%` }} />
                    </View>
                )}

                {q.media_url ? (
                    <Image source={{ uri: q.media_url }} style={{ width: '100%', height: 200, borderRadius: 12, marginBottom: 16 }} resizeMode="cover" />
                ) : null}

                <Text style={[styles.questionText, { color: textColor }]}>{q.question_text}</Text>

                <View style={styles.optionsContainer}>
                    {q.options?.map((opt, i) => {
                        const currentAns = quizAnswers[q.id];
                        const isSelected = q.question_type === 'multiple' 
                            ? (currentAns ? currentAns.split(', ').includes(opt) : false)
                            : currentAns === opt;

                        const isStrict = pool?.target_constraints?.strict_once_off_selection;
                        const isLocked = isStrict && !!currentAns && q.question_type !== 'multiple';

                        const correctFeedback = feedbackMap[q.id];
                        let bgColor = cardBg;
                        let bdrColor = borderColor;

                        if (isSelected) {
                            bgColor = isDark ? `${brandColor}15` : `${brandColor}10`;
                            bdrColor = brandColor;
                        }

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
                                key={i}
                                disabled={isTimeUp || isSubmitting || isLocked}
                                onPress={() => handleQuizOptionSelect(q.id, opt)}
                                style={[
                                    styles.optionCard,
                                    { backgroundColor: bgColor, borderColor: bdrColor },
                                ]}
                            >
                                <View style={[styles.optionRadio, q.question_type === 'multiple' && { borderRadius: 4 }, isSelected && { borderColor: bdrColor }]}>
                                    {isSelected && <View style={[styles.optionRadioInner, q.question_type === 'multiple' && { borderRadius: 2 }, { backgroundColor: bdrColor }]} />}
                                </View>
                                <Text style={[styles.optionText, { color: textColor }, isSelected && { fontWeight: '600' }]}>{opt}</Text>
                            </TouchableOpacity>
                        );
                    })}
                </View>

                <View style={styles.quizNavigation}>
                    <TouchableOpacity 
                        disabled={currentIndex === 0 || isTimeUp || isSubmitting} 
                        style={[styles.navBtn, (currentIndex === 0 || isTimeUp) && { opacity: 0.5 }]}
                        onPress={() => setCurrentIndex(i => i - 1)}
                    >
                        <Text style={[styles.navBtnText, { color: textColor }]}>Previous</Text>
                    </TouchableOpacity>

                    {currentIndex < questions.length - 1 ? (
                        <TouchableOpacity 
                            disabled={isTimeUp || isSubmitting}
                            style={[styles.navBtnPrimary, { backgroundColor: brandColor }, isTimeUp && { opacity: 0.5 }]}
                            onPress={() => setCurrentIndex(i => i + 1)}
                        >
                            <Text style={styles.navBtnPrimaryText}>Next</Text>
                        </TouchableOpacity>
                    ) : (
                        <TouchableOpacity 
                            disabled={isTimeUp || isSubmitting}
                            style={[styles.navBtnPrimary, { backgroundColor: '#f59e0b' }, (isTimeUp || isSubmitting) && { opacity: 0.5 }]}
                            onPress={() => Alert.alert('Submit Quiz', 'Are you sure you want to finalize your answers?', [{ text: 'Cancel', style: 'cancel' }, { text: 'Submit', onPress: () => handleFinalSubmit(false) }])}
                        >
                            <Text style={styles.navBtnPrimaryText}>{isSubmitting ? 'Submitting...' : 'Final Submit'}</Text>
                        </TouchableOpacity>
                    )}
                </View>
            </ScrollView>
        );
    };



    const renderLiveAction = () => {
        if (!pool) return null;

        if (computedStatus === 'draft') {
            return (
                <View style={styles.centeredContainer}>
                    <Ionicons name="lock-closed-outline" size={48} color={subtextColor} style={{ marginBottom: 16 }} />
                    <Text style={[styles.bannerTitle, { color: textColor }]}>Pending Setup</Text>
                    <Text style={[styles.bannerText, { color: subtextColor }]}>This event is currently being prepared.</Text>
                </View>
            );
        }

        if (computedStatus === 'scheduled') {
            const start = pool.start_time ? new Date(pool.start_time) : new Date();
            const now = new Date(Date.now() + serverTimeOffset);
            const diffSeconds = differenceInSeconds(start, now);
            
            let countdownStr = 'Soon';
            if (diffSeconds > 0) {
                const d = Math.floor(diffSeconds / (3600 * 24));
                const h = Math.floor((diffSeconds % (3600 * 24)) / 3600);
                const m = Math.floor((diffSeconds % 3600) / 60);
                const s = diffSeconds % 60;
                if (d > 0) countdownStr = `${d}d ${h}h ${m}m`;
                else countdownStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
            }

            return (
                <View style={styles.centeredContainer}>
                    <Ionicons name="time-outline" size={48} color={subtextColor} style={{ marginBottom: 16 }} />
                    <Text style={[styles.bannerTitle, { color: textColor }]}>Event Starting Soon</Text>
                    <Text style={[styles.bannerText, { color: subtextColor }]}>The action room will open in:</Text>
                    <Text style={{ fontSize: 32, fontWeight: '800', color: brandColor, marginTop: 12 }}>{countdownStr}</Text>
                </View>
            );
        }

        if (computedStatus === 'completed' || computedStatus === 'archived') {
            return (
                <View style={styles.centeredContainer}>
                    <Ionicons name="checkmark-done-circle-outline" size={48} color={subtextColor} style={{ marginBottom: 16 }} />
                    <Text style={[styles.bannerTitle, { color: textColor }]}>Event Finished</Text>
                    <Text style={[styles.bannerText, { color: subtextColor }]}>Waiting for official results soon. Please check the results tab.</Text>
                </View>
            );
        }

        if (hasSubmitted) {
            return (
                <View style={styles.centeredContainer}>
                    <Ionicons name="shield-checkmark-outline" size={48} color={brandColor} style={{ marginBottom: 16 }} />
                    <Text style={[styles.bannerTitle, { color: textColor }]}>Submission Recorded</Text>
                    <Text style={[styles.bannerText, { color: subtextColor, marginBottom: 16 }]}>
                        You have already submitted your participation for this event. 
                        Your actions have been securely recorded.
                    </Text>
                    {submissionData && typeof submissionData === 'object' && Object.keys(submissionData).length > 0 && (
                        <View style={{ backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.02)', padding: 16, borderRadius: 12, width: '100%', marginTop: 12 }}>
                            <Text style={{ fontWeight: '700', marginBottom: 8, color: textColor }}>Submission History:</Text>
                            {Object.entries(submissionData).map(([k, v]) => (
                                <Text key={k} style={{ color: subtextColor, fontSize: 13, marginBottom: 4 }} numberOfLines={1}>
                                    <Text style={{ fontWeight: '600' }}>{k.substring(0, 8)}...</Text>: {String(v)}
                                </Text>
                            ))}
                        </View>
                    )}
                </View>
            );
        }

        if (!isParticipant) {
            return (
                <View style={styles.centeredContainer}>
                    <View style={styles.audienceBanner}>
                        <Ionicons name="eye-outline" size={32} color="#f59e0b" style={{ marginBottom: 12 }} />
                        <Text style={[styles.bannerTitle, { color: textColor }]}>Audience Mode</Text>
                        <Text style={[styles.bannerText, { color: subtextColor }]}>
                            You are viewing this room as an official observer. Submissions and interactions are restricted to eligible participants.
                        </Text>
                    </View>
                </View>
            );
        }

        if (pool.type === 'voting' || pool.type === 'talent') {
            return (
                <View style={styles.centeredContainer}>
                    <Ionicons name="checkbox-outline" size={48} color={brandColor} style={{ marginBottom: 16 }} />
                    <Text style={[styles.bannerTitle, { color: textColor }]}>
                        {pool.type === 'voting' ? 'Debate Voting Room' : 'Talent Show Voting Room'}
                    </Text>
                    <Text style={[styles.bannerText, { color: subtextColor, marginBottom: 24, textAlign: 'center' }]}>
                        Submit your vote.
                    </Text>
                    <TouchableOpacity 
                        style={[styles.navBtnPrimary, { backgroundColor: brandColor, paddingHorizontal: 32 }]}
                        onPress={() => router.push((`/event-pool/voting/${id}`) as any)}
                    >
                        <Text style={styles.navBtnPrimaryText}>Enter Voting Room</Text>
                    </TouchableOpacity>
                </View>
            );
        }

        if (pool.type === 'quiz') {
            return (
                <View style={styles.centeredContainer}>
                    <Ionicons name="school-outline" size={48} color={brandColor} style={{ marginBottom: 16 }} />
                    <Text style={[styles.bannerTitle, { color: textColor }]}>Quiz Competition</Text>
                    <Text style={[styles.bannerText, { color: subtextColor, marginBottom: 24, textAlign: 'center' }]}>
                        This is a secure, timed quiz environment. Ensure you have a stable connection before proceeding.
                    </Text>
                    <TouchableOpacity 
                        style={[styles.navBtnPrimary, { backgroundColor: brandColor, paddingHorizontal: 32 }]}
                        onPress={() => router.push((`/event-pool/quiz/${id}`) as any)}
                    >
                        <Text style={styles.navBtnPrimaryText}>Enter Secure Quiz Room</Text>
                    </TouchableOpacity>
                </View>
            );
        }
        if (pool.type === 'essay') {
            return (
                <View style={styles.centeredContainer}>
                    <Ionicons name="document-text-outline" size={48} color={brandColor} style={{ marginBottom: 16 }} />
                    <Text style={[styles.bannerTitle, { color: textColor }]}>Essay Competition</Text>
                    <Text style={[styles.bannerText, { color: subtextColor, marginBottom: 24, textAlign: 'center' }]}>
                        This is a secure writing environment. Your text will be automatically saved to your device disk.
                    </Text>
                    <TouchableOpacity 
                        style={[styles.navBtnPrimary, { backgroundColor: brandColor, paddingHorizontal: 32 }]}
                        onPress={() => router.push((`/event-pool/essay/${id}`) as any)}
                    >
                        <Text style={styles.navBtnPrimaryText}>Enter Writing Room</Text>
                    </TouchableOpacity>
                </View>
            );
        }
        if (pool.type === 'challenge') {
            return (
                <View style={styles.centeredContainer}>
                    <Ionicons name="cloud-upload-outline" size={48} color={brandColor} style={{ marginBottom: 16 }} />
                    <Text style={[styles.bannerTitle, { color: textColor }]}>Challenge Competition</Text>
                    <Text style={[styles.bannerText, { color: subtextColor, marginBottom: 24, textAlign: 'center' }]}>
                        You will be asked to securely upload a media or document file.
                    </Text>
                    <TouchableOpacity 
                        style={[styles.navBtnPrimary, { backgroundColor: brandColor, paddingHorizontal: 32 }]}
                        onPress={() => router.push((`/event-pool/challenge/${id}`) as any)}
                    >
                        <Text style={styles.navBtnPrimaryText}>Enter Upload Room</Text>
                    </TouchableOpacity>
                </View>
            );
        }
        if (pool.type === 'debate') {
            return (
                <View style={styles.centeredContainer}>
                    <Ionicons name="chatbubbles-outline" size={48} color={brandColor} style={{ marginBottom: 16 }} />
                    <Text style={[styles.bannerTitle, { color: textColor }]}>Debate Arena</Text>
                    <Text style={[styles.bannerText, { color: subtextColor, marginBottom: 24, textAlign: 'center' }]}>
                        A structured debate with timed rounds and floor control. Enter the chamber to participate or observe.
                    </Text>
                    <TouchableOpacity 
                        style={[styles.navBtnPrimary, { backgroundColor: brandColor, paddingHorizontal: 32 }]}
                        onPress={() => router.push((`/event-pool/debate/${id}`) as any)}
                    >
                        <Text style={styles.navBtnPrimaryText}>Enter Debate Chamber</Text>
                    </TouchableOpacity>
                </View>
            );
        }

        return (
            <View style={styles.centeredContainer}>
                <Ionicons name="rocket-outline" size={48} color={brandColor} style={{ marginBottom: 16 }} />
                <Text style={[styles.bannerTitle, { color: textColor }]}>Participant Console</Text>
                <Text style={[styles.bannerText, { color: subtextColor }]}>Action Console Ready...</Text>
            </View>
        );
    };

    const renderLeaderboard = () => {
        if (isLoadingLeaderboard) {
            return (
                <View style={styles.centeredContainer}>
                    <ActivityIndicator size="large" color={brandColor} />
                </View>
            );
        }

        if (leaderboard.length === 0) {
            return (
                <View style={styles.centeredContainer}>
                    <Ionicons name="podium-outline" size={48} color={subtextColor} style={{ marginBottom: 16, opacity: 0.5 }} />
                    <Text style={[styles.bannerTitle, { color: textColor }]}>Winners Pending</Text>
                    <Text style={[styles.bannerText, { color: subtextColor }]}>Winners will be declared and featured here once evaluations are completed.</Text>
                </View>
            );
        }

        return (
            <ScrollView contentContainerStyle={styles.leaderboardContainer}>
                {leaderboard.map((entry, index) => {
                    const isMe = user?.id === entry.user_id;
                    const rank = entry.winner_position || index + 1;
                    let rankColor = subtextColor;
                    if (rank === 1) rankColor = '#fbbf24'; // Gold
                    else if (rank === 2) rankColor = '#94a3b8'; // Silver
                    else if (rank === 3) rankColor = '#b45309'; // Bronze

                    return (
                        <View key={entry.id} style={[styles.leaderboardCard, { backgroundColor: cardBg, borderColor: isMe ? brandColor : borderColor }, isMe && { borderWidth: 2 }]}>
                            <View style={[styles.rankBadge, { backgroundColor: rank <= 3 ? `${rankColor}15` : 'transparent' }]}>
                                <Text style={[styles.rankText, { color: rank <= 3 ? rankColor : subtextColor }]}>#{rank}</Text>
                            </View>
                            <View style={styles.leaderboardInfo}>
                                <Text style={[styles.leaderboardName, { color: isMe ? brandColor : textColor }]} numberOfLines={1}>
                                    {entry.users?.full_name || entry.users?.username || 'Anonymous Participant'}
                                </Text>
                                {entry.users?.level && (
                                    <Text style={[styles.leaderboardTime, { color: subtextColor }]}>
                                        Level {entry.users.level}
                                    </Text>
                                )}
                            </View>
                            <View style={styles.scoreBadge}>
                                <Text style={styles.scoreText}>{entry.final_score} PTS</Text>
                            </View>
                        </View>
                    );
                })}
            </ScrollView>
        );
    };

    const renderResults = () => {
        return (
            <View style={styles.centeredContainer}>
                <Ionicons name="medal-outline" size={48} color={subtextColor} style={{ marginBottom: 16, opacity: 0.5 }} />
                <Text style={[styles.bannerTitle, { color: textColor }]}>Results Gallery</Text>
                <Text style={[styles.bannerText, { color: subtextColor }]}>Final historical summaries and winners will be published here upon completion.</Text>
            </View>
        );
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
            <View style={[styles.header, { borderBottomColor: borderColor }]}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                    <Ionicons name="arrow-back" size={24} color={textColor} />
                </TouchableOpacity>
                <View style={styles.headerTitleContainer}>
                    <Text style={[styles.headerTitle, { color: textColor }]} numberOfLines={1}>
                        {pool?.title || 'Loading Room...'}
                    </Text>
                </View>
                <View style={styles.roleBadgeContainer}>
                    {pool && (
                        <View style={[styles.roleBadge, { backgroundColor: isParticipant ? 'rgba(16, 185, 129, 0.15)' : 'rgba(148, 163, 184, 0.15)' }]}>
                            <Text style={[styles.roleBadgeText, { color: isParticipant ? brandColor : subtextColor }]}>
                                {isParticipant ? 'PLAYER' : 'AUDIENCE'}
                            </Text>
                        </View>
                    )}
                </View>
            </View>

            {renderTabs()}

            {isLoading ? (
                <View style={styles.centeredContainer}>
                    <ActivityIndicator size="large" color={brandColor} />
                </View>
            ) : (
                <View style={styles.contentArea}>
                    {activeTab === 'overview' && renderOverview()}
                    {activeTab === 'live' && renderLiveAction()}
                    {activeTab === 'leaderboard' && renderLeaderboard()}
                    {activeTab === 'results' && renderResults()}
                </View>
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
    backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'flex-start' },
    headerTitleContainer: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
    headerTitle: { fontSize: 16, fontWeight: '700' },
    roleBadgeContainer: { width: 60, alignItems: 'flex-end' },
    roleBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
    roleBadgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
    tabBar: { flexDirection: 'row', borderBottomWidth: 1 },
    tabItem: { flex: 1, paddingVertical: 14, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
    tabText: { fontSize: 13, fontWeight: '600', letterSpacing: 0.3 },
    contentArea: { flex: 1 },
    contentContainer: { padding: 16 },
    infoCard: { padding: 20, borderRadius: 12, borderWidth: 1 },
    sectionTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
    bodyText: { fontSize: 15, lineHeight: 22 },
    metaDataList: { marginTop: 20, gap: 12 },
    metaRow: { flexDirection: 'row', alignItems: 'center' },
    metaText: { fontSize: 14, marginLeft: 8, fontWeight: '500' },
    centeredContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
    audienceBanner: { alignItems: 'center', padding: 24, backgroundColor: 'rgba(245, 158, 11, 0.05)', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(245, 158, 11, 0.2)' },
    bannerTitle: { fontSize: 20, fontWeight: '700', marginBottom: 12, textAlign: 'center' },
    bannerText: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
    
    // Timer
    timerBanner: { backgroundColor: '#f59e0b', borderRadius: 8, padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
    timerText: { color: '#fff', fontSize: 15, fontWeight: '700', marginLeft: 8 },

    // Quiz Engine
    quizHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
    quizProgress: { fontSize: 14, fontWeight: '600' },
    quizPoints: { fontSize: 14, fontWeight: '800' },
    questionText: { fontSize: 18, fontWeight: '600', lineHeight: 26, marginBottom: 24 },
    optionsContainer: { gap: 12, marginBottom: 32 },
    optionCard: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 12, borderWidth: 1 },
    optionRadio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#cbd5e1', marginRight: 12, alignItems: 'center', justifyContent: 'center' },
    optionRadioInner: { width: 10, height: 10, borderRadius: 5 },
    optionText: { fontSize: 15, flex: 1 },
    quizNavigation: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    navBtn: { paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.05)' },
    navBtnText: { fontSize: 15, fontWeight: '600' },
    navBtnPrimary: { paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8 },
    navBtnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '600' },

    // Essay Engine
    essayHeadline: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
    essayInstructions: { fontSize: 14, lineHeight: 20, marginBottom: 16 },
    essayInput: { borderWidth: 1, borderRadius: 12, padding: 16, height: 250, fontSize: 15, lineHeight: 24 },
    essayFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 },
    wordCount: { fontSize: 13, fontWeight: '600' },

    // Leaderboard
    leaderboardContainer: { padding: 16, gap: 12 },
    leaderboardCard: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 12, borderWidth: 1 },
    rankBadge: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
    rankText: { fontSize: 16, fontWeight: '800' },
    leaderboardInfo: { flex: 1 },
    leaderboardName: { fontSize: 16, fontWeight: '600', marginBottom: 4 },
    leaderboardTime: { fontSize: 12, fontWeight: '500' },
    scoreBadge: { backgroundColor: '#059669', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
    scoreText: { color: '#fff', fontSize: 14, fontWeight: '700', letterSpacing: 0.5 },

    // Challenge Engine
    challengeActionRow: { flexDirection: 'row', gap: 16, marginBottom: 24 },
    uploadBtn: { flex: 1, padding: 24, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
    uploadBtnText: { marginTop: 8, fontSize: 14, fontWeight: '600' },
    filePreview: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 12, borderWidth: 1, marginBottom: 16 },
    previewText: { fontSize: 14, fontWeight: '600', flex: 1 },

    // Voting Engine
    voteCard: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 12, borderWidth: 1, marginBottom: 12 },
    voteInfo: { flex: 1, paddingRight: 16 },
    voteName: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
    voteDesc: { fontSize: 13, lineHeight: 18 },
    radioCircle: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
    radioFill: { width: 12, height: 12, borderRadius: 6 }
});
