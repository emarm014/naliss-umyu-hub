import { SafeAreaView } from 'react-native-safe-area-context';
import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert, BackHandler, TextInput, AppState, AppStateStatus } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../src/api/supabase/client';
import { useTheme } from '../../../src/stores/theme.store';
import { useAuthStore } from '../../../src/stores';
import { useCompositionStore } from '../../../src/stores/composition.store';
import { useSentryScreen } from '../../../src/hooks/useSentryScreen';
import { useQuizStore } from '../../../src/stores/quiz.store';
import * as DocumentPicker from 'expo-document-picker';
import { uploadLocalFileToCloudinary } from '../../../src/lib/cloudinary';
import { normalizeError } from '../../../src/utils/sentry';

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
    const getLastSavedAt = useCompositionStore((s: any) => s.getLastSavedAt);
    
    const [poolInfo, setPoolInfo] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [timeLeft, setTimeLeft] = useState<number | null>(null);
    const [serverTimeOffset, setServerTimeOffset] = useState(0);
    const [poolStartedAt, setPoolStartedAt] = useState<number>(Date.now());
    const [essayText, setEssayText] = useState(getEssayDraft(id));
    const [hasSubmitted, setHasSubmitted] = useState(false);

    // Attachment state (two-stage upload)
    const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [attachmentFileName, setAttachmentFileName] = useState<string | null>(null);

    // Draft saved indicator
    const [lastSavedDisplay, setLastSavedDisplay] = useState<string | null>(null);
    const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // AppState ref for backgrounding
    const appStateRef = useRef<AppStateStatus>(AppState.currentState);

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

    // =====================================================================
    // DEBOUNCED DRAFT PERSISTENCE (500ms)
    // =====================================================================
    useEffect(() => {
        if (!id || isLoading) return;

        // Clear previous debounce timer
        if (draftTimerRef.current) {
            clearTimeout(draftTimerRef.current);
        }

        draftTimerRef.current = setTimeout(() => {
            setEssayDraft(id, essayText);
            // Update display timestamp
            const now = new Date();
            setLastSavedDisplay(
                `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`
            );
        }, 500);

        return () => {
            if (draftTimerRef.current) {
                clearTimeout(draftTimerRef.current);
            }
        };
    }, [essayText, id, isLoading]);

    // Show initial saved timestamp from store on mount
    useEffect(() => {
        if (!id) return;
        const savedAt = getLastSavedAt(id);
        if (savedAt) {
            const d = new Date(savedAt);
            setLastSavedDisplay(
                `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`
            );
        }
    }, [id]);

    useEffect(() => {
        const initEssay = async () => {
            if (!id || !user) return;
            setIsLoading(true);
            try {
                // Fetch Pool Status & Deadline
                const { data: poolData, error: poolError } = await (supabase as any)
                    .from('event_pools')
                    .select('id, title, status, end_time, target_constraints')
                    .eq('id', id)
                    .maybeSingle();
                
                if (poolError) throw normalizeError(poolError);
                if (!poolData) {
                    Alert.alert('Not Found', 'This essay event could not be found.');
                    router.back();
                    return;
                }
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
                    .maybeSingle();
                
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

        initEssay();
        loadOrSetStartTime();
    }, [id, user]);

    // Compute deadline timestamp
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
                    setTimeLeft(0);
                    setTimeout(() => handleFinalSubmit(true), Math.floor(Math.random() * 4000));
                    return 0;
                }
                return next;
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [poolInfo, serverTimeOffset, isLoading, poolStartedAt, deadlineTimestamp]);

    // =====================================================================
    // APPSTATE LIFECYCLE — DRIFT RECONCILIATION
    // =====================================================================
    const reconcileTimerOnForeground = useCallback(() => {
        if (isSubmittingGlobal || hasSubmitted || deadlineTimestamp === null) return;

        const currentEstimatedServerTime = Date.now() + serverTimeOffset;
        const remainingSeconds = Math.max(0, Math.floor((deadlineTimestamp - currentEstimatedServerTime) / 1000));

        if (remainingSeconds <= 0) {
            console.warn('[EssayTimer] Time expired in background. Forcing emergency auto-submit.');
            handleFinalSubmit(true);
        } else {
            setTimeLeft(remainingSeconds);
        }
    }, [serverTimeOffset, deadlineTimestamp, isSubmittingGlobal, hasSubmitted]);

    useEffect(() => {
        const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
            if (
                appStateRef.current.match(/inactive|background/) &&
                nextAppState === 'active'
            ) {
                reconcileTimerOnForeground();
            }
            appStateRef.current = nextAppState;
        });

        return () => subscription.remove();
    }, [reconcileTimerOnForeground]);

    // =====================================================================
    // TWO-STAGE UPLOAD PIPELINE: ATTACHMENT FIRST, RPC SECOND
    // =====================================================================
    const pickAttachment = async () => {
        try {
            const result = await DocumentPicker.getDocumentAsync({
                type: [
                    'application/pdf',
                    'application/msword',
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    'image/*'
                ]
            });
            if (!result.canceled && result.assets[0]) {
                const asset = result.assets[0];
                await uploadAttachment(asset.uri, asset.name || 'attachment', asset.mimeType || 'application/octet-stream');
            }
        } catch (e) {
            console.error('Document Picker Error:', e);
        }
    };

    const uploadAttachment = async (uri: string, fileName: string, mimeType: string) => {
        setIsUploading(true);
        setUploadProgress(0);
        setAttachmentFileName(fileName);
        try {
            const folder = `event_pools/${id}`;
            const url = await uploadLocalFileToCloudinary(
                uri,
                fileName,
                folder,
                mimeType,
                (progress: number) => setUploadProgress(progress)
            );
            if (url) {
                setAttachmentUrl(url);
                setUploadProgress(100);
            }
        } catch (e: any) {
            Alert.alert(
                'Upload Failed', 
                e?.message || 'There was an error uploading your file. Please check your connection and try again.',
                [
                    { text: 'Dismiss', style: 'cancel' },
                    { text: 'Retry', onPress: () => uploadAttachment(uri, fileName, mimeType) }
                ]
            );
            setAttachmentUrl(null);
            setAttachmentFileName(null);
        } finally {
            setIsUploading(false);
        }
    };

    const removeAttachment = () => {
        setAttachmentUrl(null);
        setAttachmentFileName(null);
        setUploadProgress(0);
    };

    // =====================================================================
    // SUBMISSION WITH ERROR RECOVERY
    // =====================================================================
    const handleFinalSubmit = async (autoSubmitted = false) => {
        if (isSubmittingGlobal || hasSubmitted) return;
        
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
        // Stage 1 is already complete if attachment exists (uploaded via pickAttachment)
        // Stage 2: Atomic RPC submission
        setHasSubmitted(true);

        const payload: Record<string, any> = {
            text: essayText.trim(),
            attachment_url: attachmentUrl || null,
        };

        const result = await submitEvaluation(id, payload);
        
        if (result.success) {
            clearDraft(id);
            Alert.alert('Submitted Successfully!', 'Your essay has been securely locked in for administrative review.', [
                { text: 'OK', onPress: () => router.back() }
            ]);
        } else {
            // DO NOT clear the draft on failure — preserve every word
            if (!result.error?.toLowerCase().includes('already')) {
                setHasSubmitted(false);
            }
            Alert.alert(
                'Submission Failed', 
                result.error || 'Please try again. Your draft is still saved locally.',
                [
                    { text: 'OK' },
                    ...(!result.error?.toLowerCase().includes('already') 
                        ? [{ text: 'Retry Submission', onPress: executeSubmit }] 
                        : [])
                ]
            );
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
                    editable={!isTimeUp && !isSubmittingGlobal && !hasSubmitted}
                    placeholder="Start typing your essay here..."
                    placeholderTextColor={colors.textMuted}
                    value={essayText}
                    onChangeText={setEssayText}
                    textAlignVertical="top"
                />

                {/* Draft saved indicator */}
                <View style={styles.draftIndicatorRow}>
                    {lastSavedDisplay && (
                        <View style={styles.draftSavedContainer}>
                            <Ionicons name="checkmark-circle" size={14} color="#10b981" />
                            <Text style={[styles.draftSavedText, { color: colors.textMuted }]}>
                                Draft saved locally at {lastSavedDisplay}
                            </Text>
                        </View>
                    )}
                </View>

                {/* Attachment section */}
                <View style={[styles.attachmentSection, { borderColor: colors.border }]}>
                    <Text style={[styles.attachmentLabel, { color: colors.text }]}>Attachment (Optional)</Text>

                    {!attachmentUrl && !isUploading && (
                        <TouchableOpacity 
                            style={[styles.attachBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
                            onPress={pickAttachment}
                            disabled={isTimeUp || isSubmittingGlobal || hasSubmitted}
                        >
                            <Ionicons name="attach-outline" size={20} color="#059669" />
                            <Text style={[styles.attachBtnText, { color: colors.text }]}>Attach PDF / Document / Image</Text>
                        </TouchableOpacity>
                    )}

                    {isUploading && (
                        <View style={styles.uploadProgressContainer}>
                            <View style={styles.uploadProgressHeader}>
                                <ActivityIndicator size="small" color={colors.primary} />
                                <Text style={[styles.uploadProgressLabel, { color: colors.textMuted }]}>
                                    Uploading {attachmentFileName}...
                                </Text>
                                <Text style={[styles.uploadProgressPct, { color: colors.primary }]}>
                                    {uploadProgress}%
                                </Text>
                            </View>
                            <View style={[styles.progressBarTrack, { backgroundColor: isDark ? '#334155' : '#e2e8f0' }]}>
                                <View style={[styles.progressBarFill, { backgroundColor: colors.primary, width: `${uploadProgress}%` }]} />
                            </View>
                        </View>
                    )}

                    {attachmentUrl && !isUploading && (
                        <View style={[styles.attachmentPreview, { backgroundColor: colors.card, borderColor: colors.border }]}>
                            <View style={styles.attachmentPreviewHeader}>
                                <Ionicons name="checkmark-circle" size={20} color="#10b981" />
                                <Text style={[styles.attachmentPreviewName, { color: colors.text }]} numberOfLines={1}>
                                    {attachmentFileName || 'File uploaded'}
                                </Text>
                            </View>
                            <TouchableOpacity 
                                onPress={removeAttachment}
                                disabled={isTimeUp || isSubmittingGlobal || hasSubmitted}
                            >
                                <Text style={styles.removeAttachmentText}>Remove</Text>
                            </TouchableOpacity>
                        </View>
                    )}
                </View>

                <View style={styles.footerRow}>
                    <Text style={[styles.wordCount, { color: isOverLimit ? '#ef4444' : colors.textMuted }]}>
                        {currentWords} / {maxWords} words
                    </Text>
                    
                    <TouchableOpacity 
                        style={[
                            styles.submitBtn, 
                            { backgroundColor: '#059669' },
                            (isOverLimit || isTimeUp || isSubmittingGlobal || hasSubmitted || currentWords === 0 || isUploading) && { opacity: 0.5 }
                        ]} 
                        onPress={() => handleFinalSubmit(false)}
                        disabled={isOverLimit || isTimeUp || isSubmittingGlobal || hasSubmitted || currentWords === 0 || isUploading}
                    >
                        <Text style={styles.submitText}>
                            {isSubmittingGlobal ? 'Submitting...' : hasSubmitted ? 'Submitted' : 'Submit Essay'}
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
        minHeight: 250,
        borderRadius: 12,
        borderWidth: 1,
        padding: 16,
        fontSize: 16,
        lineHeight: 24,
    },
    draftIndicatorRow: {
        minHeight: 24,
        marginTop: 8,
        marginBottom: 4,
    },
    draftSavedContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    draftSavedText: {
        fontSize: 12,
        fontWeight: '500',
    },
    attachmentSection: {
        marginTop: 12,
        paddingTop: 12,
        borderTopWidth: 1,
    },
    attachmentLabel: {
        fontSize: 14,
        fontWeight: '600',
        marginBottom: 8,
    },
    attachBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 14,
        borderRadius: 10,
        borderWidth: 1,
        borderStyle: 'dashed',
        gap: 8,
    },
    attachBtnText: {
        fontSize: 14,
        fontWeight: '500',
    },
    uploadProgressContainer: {
        padding: 12,
    },
    uploadProgressHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 8,
    },
    uploadProgressLabel: {
        flex: 1,
        fontSize: 13,
    },
    uploadProgressPct: {
        fontSize: 14,
        fontWeight: '700',
        fontVariant: ['tabular-nums'],
    },
    progressBarTrack: {
        height: 6,
        borderRadius: 3,
        overflow: 'hidden',
    },
    progressBarFill: {
        height: '100%',
        borderRadius: 3,
    },
    attachmentPreview: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 12,
        borderRadius: 10,
        borderWidth: 1,
    },
    attachmentPreviewHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        flex: 1,
    },
    attachmentPreviewName: {
        fontSize: 14,
        fontWeight: '500',
        flex: 1,
    },
    removeAttachmentText: {
        color: '#ef4444',
        fontSize: 13,
        fontWeight: '600',
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
