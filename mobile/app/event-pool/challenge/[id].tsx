import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, SafeAreaView, ActivityIndicator, Alert, BackHandler } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../src/api/supabase/client';
import { useTheme } from '../../../src/stores/theme.store';
import { useAuthStore } from '../../../src/stores';
import { useCompositionStore } from '../../../src/stores/composition.store';
import { useSentryScreen } from '../../../src/hooks/useSentryScreen';
import { differenceInSeconds } from 'date-fns';
import * as DocumentPicker from 'expo-document-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { uploadLocalFileToCloudinary } from '../../../src/lib/cloudinary';

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
    
    const [poolInfo, setPoolInfo] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isUploading, setIsUploading] = useState(false);
    const [timeLeft, setTimeLeft] = useState<number | null>(null);
    const [serverTimeOffset, setServerTimeOffset] = useState(0);
    const [poolStartedAt, setPoolStartedAt] = useState<number>(Date.now());
    const [mediaDraft, setMediaDraft] = useState<{ url: string, type: 'image' | 'video' | 'raw' } | null>(getChallengeDraft(id));

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

    useEffect(() => {
        const initChallenge = async () => {
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

        initChallenge();
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
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [poolInfo, serverTimeOffset, isLoading, poolStartedAt]);

    const uploadMedia = async (uri: string, type: 'image' | 'video' | 'raw') => {
        setIsUploading(true);
        try {
            const url = await uploadLocalFileToCloudinary(uri, type, 'event_pools');
            if (url) {
                const draft = { url, type };
                setMediaDraft(draft);
                setChallengeDraft(id, draft);
            }
        } catch (e) {
            Alert.alert('Upload Failed', 'There was an error uploading your file. Please check your connection and try again.');
        } finally {
            setIsUploading(false);
        }
    };

    const pickImage = async () => {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') return Alert.alert('Permission needed', 'We need access to your photos to upload media.');
        const result = await ImagePicker.launchImageLibraryAsync({ 
            mediaTypes: ImagePicker.MediaTypeOptions.All,
            quality: 0.8
        });
        if (!result.canceled && result.assets[0]) {
            const type = result.assets[0].type === 'video' ? 'video' : 'image';
            uploadMedia(result.assets[0].uri, type);
        }
    };

    const pickDoc = async () => {
        const result = await DocumentPicker.getDocumentAsync({
            type: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
        });
        if (!result.canceled && result.assets[0]) {
            uploadMedia(result.assets[0].uri, 'raw');
        }
    };

    const handleFinalSubmit = async () => {
        if (isSubmittingGlobal || !mediaDraft) return;
        
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
        const result = await submitEvaluation(id, mediaDraft);
        
        if (result.success) {
            clearDraft(id);
            Alert.alert('Submitted Successfully!', 'Your challenge entry has been securely locked in for administrative review.', [
                { text: 'OK', onPress: () => router.back() }
            ]);
        } else {
            Alert.alert('Submission Failed', result.error || 'Please try again. Your uploaded draft is cached.');
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
                    {poolInfo?.description || 'Upload your challenge submission (Image, Video, or Document). Files are securely cached to Cloudinary before final submission.'}
                </Text>

                <View style={styles.uploadRow}>
                    <TouchableOpacity 
                        style={[styles.uploadBtn, { backgroundColor: colors.card, borderColor: colors.border }]} 
                        onPress={pickImage} 
                        disabled={isTimeUp || isSubmittingGlobal || isUploading}
                    >
                        <Ionicons name="image-outline" size={32} color="#059669" />
                        <Text style={[styles.uploadBtnText, { color: colors.text }]}>Pick Media</Text>
                    </TouchableOpacity>
                    
                    <TouchableOpacity 
                        style={[styles.uploadBtn, { backgroundColor: colors.card, borderColor: colors.border }]} 
                        onPress={pickDoc} 
                        disabled={isTimeUp || isSubmittingGlobal || isUploading}
                    >
                        <Ionicons name="document-text-outline" size={32} color="#059669" />
                        <Text style={[styles.uploadBtnText, { color: colors.text }]}>Pick Document</Text>
                    </TouchableOpacity>
                </View>

                {isUploading && (
                    <View style={styles.uploadingContainer}>
                        <ActivityIndicator size="small" color={colors.primary} />
                        <Text style={[styles.uploadingText, { color: colors.textMuted }]}>Uploading securely to Cloudinary...</Text>
                    </View>
                )}

                {mediaDraft && !isUploading && (
                    <View style={[styles.previewCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <View style={styles.previewHeader}>
                            <Ionicons name="checkmark-circle" size={24} color="#10b981" />
                            <Text style={[styles.previewTitle, { color: colors.text }]}>File Uploaded Successfully</Text>
                        </View>
                        <Text style={[styles.previewUrl, { color: colors.textMuted }]} numberOfLines={1}>{mediaDraft.url}</Text>
                        <TouchableOpacity 
                            style={styles.removeBtn} 
                            onPress={() => {
                                setMediaDraft(null);
                                clearDraft(id);
                            }}
                            disabled={isTimeUp || isSubmittingGlobal}
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
                        (!mediaDraft || isTimeUp || isSubmittingGlobal || isUploading) && { opacity: 0.5 }
                    ]} 
                    onPress={handleFinalSubmit}
                    disabled={!mediaDraft || isTimeUp || isSubmittingGlobal || isUploading}
                >
                    <Text style={styles.submitText}>
                        {isSubmittingGlobal ? 'Submitting...' : 'Submit Entry'}
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
    uploadingContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
    },
    uploadingText: {
        marginLeft: 8,
        fontSize: 14,
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
        marginBottom: 16,
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
