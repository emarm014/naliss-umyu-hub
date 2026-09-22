import { SafeAreaView } from 'react-native-safe-area-context';
import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert, BackHandler, AppState, AppStateStatus } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../src/api/supabase/client';
import { useTheme } from '../../../src/stores/theme.store';
import { useAuthStore } from '../../../src/stores';
import { useCompositionStore } from '../../../src/stores/composition.store';
import { useSentryScreen } from '../../../src/hooks/useSentryScreen';
import * as DocumentPicker from 'expo-document-picker';
import { useQuizStore } from '../../../src/stores/quiz.store';
import * as ImagePicker from 'expo-image-picker';
import { uploadLocalFileToCloudinary } from '../../../src/lib/cloudinary';
import { normalizeError } from '../../../src/utils/sentry';

export default function ChallengeEngineScreen() {
    useSentryScreen('ChallengeEngine');
    const { id } = useLocalSearchParams<{ id: string }>();
    const { colors, isDark } = useTheme();
    const user = useAuthStore((s: any) => s.profile);
    
    const setChallengeDraft = useCompositionStore((s: any) => s.setChallengeDraft);
    const getChallengeDraft = useCompositionStore((s: any) => s.getChallengeDraft);
    const submitEvaluation = useCompositionStore((s: any) => s.submitEvaluation);
    const clearDraft = useCompositionStore((s: any) => s.clearDraft);
    const isSubmittingGlobal = useCompositionStore((s: any) => s.isSubmitting);
    const getLastSavedAt = useCompositionStore((s: any) => s.getLastSavedAt);
    
    const [poolInfo, setPoolInfo] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [timeLeft, setTimeLeft] = useState<number | null>(null);
    const [serverTimeOffset, setServerTimeOffset] = useState(0);
    const [poolStartedAt, setPoolStartedAt] = useState<number>(Date.now());
    const [mediaDraft, setMediaDraft] = useState<{ url: string, type: 'image' | 'video' | 'raw' } | null>(getChallengeDraft(id));
    const [hasSubmitted, setHasSubmitted] = useState(false);

    // Two-stage upload state
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [uploadFileName, setUploadFileName] = useState<string | null>(null);

    // Track last upload URI for retry without re-picking
    const lastUploadAttemptRef = useRef<{ uri: string; type: 'image' | 'video' | 'raw'; fileName: string; mimeType: string } | null>(null);

    // Draft saved indicator
    const [lastSavedDisplay, setLastSavedDisplay] = useState<string | null>(null);

    // AppState ref
    const appStateRef = useRef<AppStateStatus>(AppState.currentState);

    // Handle back button protection
    useEffect(() => {
        const backAction = () => {
            Alert.alert("Hold on!", "Are you sure you want to exit? Your uploaded draft is cached, but the clock will keep ticking.", [
                { text: "Cancel", style: "cancel" },
                { text: "YES, Exit", onPress: () => router.back() }
            ]);
            return true;
        };

        const backHandler = BackHandler.addEventListener("hardwareBackPress", backAction);
        return () => backHandler.remove();
    }, []);

    // Show saved timestamp from store on mount
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
        const initChallenge = async () => {
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
                    Alert.alert('Not Found', 'This challenge could not be found.');
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
                    Alert.alert('Already Submitted', 'You have already submitted your challenge entry.');
                    router.back();
                    return;
                }

            } catch (err: any) {
                console.error('Init Error:', err);
                Alert.alert('Error', 'Failed to load challenge environment.');
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

        initChallenge();
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
        if (deadlineTimestamp === null) return;

        const currentEstimatedServerTime = Date.now() + serverTimeOffset;
        const remainingSeconds = Math.max(0, Math.floor((deadlineTimestamp - currentEstimatedServerTime) / 1000));

        setTimeLeft(remainingSeconds);
    }, [serverTimeOffset, deadlineTimestamp]);

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
    // TWO-STAGE UPLOAD PIPELINE
    // =====================================================================
    const uploadMedia = async (uri: string, type: 'image' | 'video' | 'raw', fileName: string, mimeType: string) => {
        setIsUploading(true);
        setUploadProgress(0);
        setUploadFileName(fileName);
        lastUploadAttemptRef.current = { uri, type, fileName, mimeType };

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
                const draft = { url, type };
                setMediaDraft(draft);
                setChallengeDraft(id, draft);
                setUploadProgress(100);
                // Update saved display
                const now = new Date();
                setLastSavedDisplay(
                    `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`
                );
            }
        } catch (e: any) {
            Alert.alert(
                'Upload Failed', 
                e?.message || 'There was an error uploading your file. Please check your connection and try again.',
                [
                    { text: 'Dismiss', style: 'cancel' },
                    { text: 'Retry', onPress: retryUpload }
                ]
            );
        } finally {
            setIsUploading(false);
        }
    };

    const retryUpload = () => {
        const attempt = lastUploadAttemptRef.current;
        if (attempt) {
            uploadMedia(attempt.uri, attempt.type, attempt.fileName, attempt.mimeType);
        }
    };

    const pickImage = async () => {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') return Alert.alert('Permission needed', 'We need access to your photos to upload media.');
        const result = await ImagePicker.launchImageLibraryAsync({ 
            mediaTypes: ['images', 'videos'],
            quality: 0.8
        });
        if (!result.canceled && result.assets[0]) {
            const asset = result.assets[0];
            const type = asset.type === 'video' ? 'video' : 'image';
            const mimeType = type === 'video' ? 'video/mp4' : 'image/jpeg';
            const fileName = asset.fileName || `media_${Date.now()}.${type === 'video' ? 'mp4' : 'jpg'}`;
            uploadMedia(asset.uri, type, fileName, mimeType);
        }
    };

    const pickDoc = async () => {
        const result = await DocumentPicker.getDocumentAsync({
            type: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
        });
        if (!result.canceled && result.assets[0]) {
            const asset = result.assets[0];
            uploadMedia(asset.uri, 'raw', asset.name || 'document', asset.mimeType || 'application/pdf');
        }
    };

    // =====================================================================
    // SUBMISSION WITH ERROR RECOVERY
    // =====================================================================
    const handleFinalSubmit = async () => {
        if (isSubmittingGlobal || !mediaDraft || hasSubmitted) return;
        
        Alert.alert(
            'Submit Entry',
            'Are you sure you want to finalize your submission? This cannot be undone.',
            [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Submit Now', onPress: executeSubmit }
            ]
        );
    };

    const executeSubmit = async () => {
        if (!mediaDraft) return;

        // Stage 1 is already complete (file is uploaded to Cloudinary)
        // Stage 2: Atomic RPC submission
        setHasSubmitted(true);

        const payload: Record<string, any> = {
            file_url: mediaDraft.url,
            file_type: mediaDraft.type,
            attachment_url: mediaDraft.url,
            submitted_client_time: new Date().toISOString(),
        };

        const result = await submitEvaluation(id, payload);
        
        if (result.success) {
            clearDraft(id);
            Alert.alert('Submitted Successfully!', 'Your challenge entry has been securely locked in for administrative review.', [
                { text: 'OK', onPress: () => router.back() }
            ]);
        } else {
            // DO NOT clear the draft or re-upload — the file is already in Cloudinary
            if (!result.error?.toLowerCase().includes('already')) {
                setHasSubmitted(false);
            }
            Alert.alert(
                'Submission Failed', 
                result.error || 'Please try again. Your uploaded file is still cached.',
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
                    <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>Challenge Engine</Text>
                    <Text style={[styles.subtitle, { color: colors.textMuted }]}>{poolInfo?.title}</Text>
                </View>
                <View style={[styles.timerBadge, { backgroundColor: timeLeft && timeLeft < 60 ? '#ef4444' : '#059669' }]}>
                    <Text style={styles.timerText}>
                        {timeLeft !== null ? formatTime(timeLeft) : '--:--'}
                    </Text>
                </View>
            </View>

            <ScrollView contentContainerStyle={styles.content} bounces={false}>
                <Text style={[styles.instructions, { color: colors.text }]}>
                    {poolInfo?.description || 'Upload your challenge submission (Image, Video, or Document). Files are securely uploaded before final submission.'}
                </Text>

                <View style={styles.uploadRow}>
                    <TouchableOpacity 
                        style={[styles.uploadBtn, { backgroundColor: colors.card, borderColor: colors.border }]} 
                        onPress={pickImage} 
                        disabled={isTimeUp || isSubmittingGlobal || isUploading || hasSubmitted}
                    >
                        <Ionicons name="image-outline" size={32} color="#059669" />
                        <Text style={[styles.uploadBtnText, { color: colors.text }]}>Pick Media</Text>
                    </TouchableOpacity>
                    
                    <TouchableOpacity 
                        style={[styles.uploadBtn, { backgroundColor: colors.card, borderColor: colors.border }]} 
                        onPress={pickDoc} 
                        disabled={isTimeUp || isSubmittingGlobal || isUploading || hasSubmitted}
                    >
                        <Ionicons name="document-text-outline" size={32} color="#059669" />
                        <Text style={[styles.uploadBtnText, { color: colors.text }]}>Pick Document</Text>
                    </TouchableOpacity>
                </View>

                {isUploading && (
                    <View style={styles.uploadProgressContainer}>
                        <View style={styles.uploadProgressHeader}>
                            <ActivityIndicator size="small" color={colors.primary} />
                            <Text style={[styles.uploadProgressLabel, { color: colors.textMuted }]}>
                                Uploading {uploadFileName}...
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

                {mediaDraft && !isUploading && (
                    <View style={[styles.previewCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <View style={styles.previewHeader}>
                            <Ionicons name="checkmark-circle" size={24} color="#10b981" />
                            <Text style={[styles.previewTitle, { color: colors.text }]}>File Uploaded Successfully</Text>
                        </View>
                        <Text style={[styles.previewUrl, { color: colors.textMuted }]} numberOfLines={1}>{uploadFileName || mediaDraft.url}</Text>
                        {lastSavedDisplay && (
                            <View style={styles.draftSavedRow}>
                                <Ionicons name="checkmark-circle" size={14} color="#10b981" />
                                <Text style={[styles.draftSavedText, { color: colors.textMuted }]}>
                                    Draft cached at {lastSavedDisplay}
                                </Text>
                            </View>
                        )}
                        <TouchableOpacity 
                            style={styles.removeBtn} 
                            onPress={() => {
                                setMediaDraft(null);
                                setUploadFileName(null);
                                setUploadProgress(0);
                                clearDraft(id);
                            }}
                            disabled={isTimeUp || isSubmittingGlobal || hasSubmitted}
                        >
                            <Text style={styles.removeText}>Remove File</Text>
                        </TouchableOpacity>
                    </View>
                )}
            </ScrollView>

            <View style={[styles.footer, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
                <View />
                <TouchableOpacity 
                    style={[
                        styles.submitBtn, 
                        { backgroundColor: '#059669' },
                        (!mediaDraft || isTimeUp || isSubmittingGlobal || isUploading || hasSubmitted) && { opacity: 0.5 }
                    ]} 
                    onPress={handleFinalSubmit}
                    disabled={!mediaDraft || isTimeUp || isSubmittingGlobal || isUploading || hasSubmitted}
                >
                    <Text style={styles.submitText}>
                        {isSubmittingGlobal ? 'Submitting...' : hasSubmitted ? 'Submitted' : 'Submit Entry'}
                    </Text>
                </TouchableOpacity>
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
    instructions: {
        fontSize: 14,
        lineHeight: 20,
        marginBottom: 24,
    },
    uploadRow: {
        flexDirection: 'row',
        gap: 12,
        marginBottom: 24,
    },
    uploadBtn: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        borderRadius: 12,
        borderWidth: 1,
        borderStyle: 'dashed',
    },
    uploadBtnText: {
        marginTop: 12,
        fontSize: 14,
        fontWeight: '600',
    },
    uploadProgressContainer: {
        padding: 12,
        marginBottom: 16,
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
    previewCard: {
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
    },
    previewHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    previewTitle: {
        marginLeft: 8,
        fontSize: 16,
        fontWeight: '600',
    },
    previewUrl: {
        fontSize: 12,
        marginBottom: 8,
    },
    draftSavedRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        marginBottom: 12,
    },
    draftSavedText: {
        fontSize: 12,
        fontWeight: '500',
    },
    removeBtn: {
        alignSelf: 'flex-start',
    },
    removeText: {
        color: '#ef4444',
        fontSize: 14,
        fontWeight: '600',
    },
    footer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        borderTopWidth: 1,
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
