import React, { useEffect, useState, useRef } from 'react';
import { 
    View, Text, StyleSheet, TouchableOpacity, Image, Modal, 
    Animated, Dimensions, Easing, Platform 
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useSegments } from 'expo-router';
import { supabase } from '../api/supabase/client';
import { useTheme } from '../stores/theme.store';
import { mmkvStorage } from '../stores/mmkv.storage';
import { useAuthStore } from '../stores/auth.store';
import { useSignupStore } from '../stores/signup.store';
import { sendPushNotification } from '../utils/notifications';
import { CachedImage } from './common/CachedImage';

const { width, height } = Dimensions.get('window');

type FeaturedStudent = {
    id: string;
    user_id: string;
    type: 'event_winner' | 'student_of_the_week' | 'legend_of_the_month';
    title: string;
    icon?: string;
    color?: string;
    subtitle: string | null;
    description: string | null;
    custom_image_url: string | null;
    total_congratulations: number;
    users: {
        full_name: string;
        username: string;
        avatar_url: string | null;
        department_id: string | null;
    };
};

// NALISS Brand-aligned colors for motion stars and love emojis
const STAR_COLORS = [
    '#059669', // NALISS Emerald Green
    '#005A36', // NALISS Deep Green
    '#10b981', // Bright Emerald
    '#fbbf24', // Royal Gold
    '#f59e0b', // Amber Accent
    '#f43f5e', // Rose Red
    '#ec4899', // Hot Pink
    '#ffffff', // Pure White
    '#3b82f6', // Sapphire Blue
];

const STAR_SYMBOLS = ['★', '✨', '⭐', '🌟', '💫', '✦', '💖', '❤️', '💙', '💕'];

interface FloatingParticle {
    id: number;
    x: number;
    size: number;
    color: string;
    symbol: string;
    duration: number;
    delay: number;
    drift: number;
    anim: Animated.Value;
}

interface BurstParticle {
    id: number;
    angle: number;
    distance: number;
    size: number;
    color: string;
    symbol: string;
    anim: Animated.Value;
}

interface RevealParticle {
    id: number;
    angle: number;
    distanceX: number;
    peakY: number;
    size: number;
    color: string;
    symbol: string;
    anim: Animated.Value;
}

export function FeaturedStudentPopup() {
    const { colors, isDark } = useTheme();
    const { profile, isProfileComplete } = useAuthStore();
    const signupEmail = useSignupStore(s => s.email);
    const signupStep = useSignupStore(s => s.currentStep);
    const segments = useSegments();
    
    const [feature, setFeature] = useState<FeaturedStudent | null>(null);
    const [isVisible, setIsVisible] = useState(false);
    const [hasCongratulated, setHasCongratulated] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Realtime incoming congratulation toast state
    const [incomingToastVisible, setIncomingToastVisible] = useState(false);
    const [incomingCongratulator, setIncomingCongratulator] = useState<any>(null);
    const [hasAppreciated, setHasAppreciated] = useState(false);
    
    // Animation value for the popup entrance/exit
    const [scaleAnim] = useState(new Animated.Value(0.85));
    const [opacityAnim] = useState(new Animated.Value(0));

    // Particle arrays
    const particlesRef = useRef<FloatingParticle[]>([]);
    const burstParticlesRef = useRef<BurstParticle[]>([]);
    const revealParticlesRef = useRef<RevealParticle[]>([]);
    
    const [isBursting, setIsBursting] = useState(false);
    const [isRevealing, setIsRevealing] = useState(false);
    
    const isShowingRef = useRef(false);
    const sessionSuppressedIdsRef = useRef<Set<string>>(new Set());
    const initialCheckDoneRef = useRef(false);

    useEffect(() => {
        sessionSuppressedIdsRef.current.clear();
        initialCheckDoneRef.current = false;
    }, [profile?.id]);

    // Initialize 42 continuous tiny floating motion particles
    if (particlesRef.current.length === 0) {
        const particles: FloatingParticle[] = [];
        for (let i = 0; i < 42; i++) {
            particles.push({
                id: i,
                x: Math.random() * (width - 20),
                size: Math.floor(Math.random() * 9) + 9,
                color: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)],
                symbol: STAR_SYMBOLS[Math.floor(Math.random() * STAR_SYMBOLS.length)],
                duration: 4500 + Math.random() * 3500,
                delay: Math.random() * 4000,
                drift: (Math.random() - 0.5) * 50,
                anim: new Animated.Value(0),
            });
        }
        particlesRef.current = particles;
    }

    // Initialize 24 burst particles for celebration tap
    if (burstParticlesRef.current.length === 0) {
        const burst: BurstParticle[] = [];
        for (let i = 0; i < 24; i++) {
            burst.push({
                id: i,
                angle: (i / 24) * 2 * Math.PI,
                distance: 80 + Math.random() * 100,
                size: Math.floor(Math.random() * 8) + 12,
                color: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)],
                symbol: STAR_SYMBOLS[Math.floor(Math.random() * STAR_SYMBOLS.length)],
                anim: new Animated.Value(0),
            });
        }
        burstParticlesRef.current = burst;
    }

    // Initialize 35 grand reveal particles for a trophy-win opening
    if (revealParticlesRef.current.length === 0) {
        const reveal: RevealParticle[] = [];
        for (let i = 0; i < 35; i++) {
            const angle = -Math.PI + Math.random() * Math.PI; // Top half hemisphere
            const distanceX = Math.cos(angle) * (80 + Math.random() * 220);
            const peakY = Math.sin(angle) * (150 + Math.random() * 200);
            reveal.push({
                id: i,
                angle,
                distanceX,
                peakY,
                size: Math.floor(Math.random() * 24) + 16, // Extra large for grand reveal
                color: Math.random() > 0.5 ? '#fbbf24' : STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)], // Bias towards gold
                symbol: STAR_SYMBOLS[Math.floor(Math.random() * STAR_SYMBOLS.length)],
                anim: new Animated.Value(0),
            });
        }
        revealParticlesRef.current = reveal;
    }

    useEffect(() => {
        // Only show the popup when the user has FULLY completed registration.
        // Prevents the popup from appearing on auth/signup screens (level, identity, etc.) or login screen
        const isInSignupFlow = !!signupEmail || (signupStep != null && signupStep > 0);
        const isNotOnTabs = segments[0] !== '(tabs)';
        if (!profile || isProfileComplete !== true || isInSignupFlow || isNotOnTabs) return;

        // 10-second grace period after successful login/sign-up to allow background sync to complete uninterrupted
        let timer: any = null;
        if (!initialCheckDoneRef.current) {
            initialCheckDoneRef.current = true;
            timer = setTimeout(() => {
                checkForActiveFeature();
            }, 10000);
        }

        // Realtime listener for INSTANT popup when Admin adds a featured student
        const channel = supabase
            .channel(`global_featured_students_listener_${Date.now()}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'featured_students',
                },
                (payload) => {
                    const newRow = payload.new as any;
                    const oldRow = payload.old as any;
                    
                    // Admin deactivated or deleted a featured student
                    if (payload.eventType === 'DELETE' || (newRow && newRow.is_active === false)) {
                        const affectedId = payload.eventType === 'DELETE' ? oldRow?.id : newRow?.id;
                        if (affectedId && feature?.id === affectedId) {
                            // Instantly hide without saving to user dismissals
                            Animated.parallel([
                                Animated.timing(scaleAnim, { toValue: 0.85, duration: 200, useNativeDriver: true }),
                                Animated.timing(opacityAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
                            ]).start(() => {
                                setIsVisible(false);
                                setFeature(null);
                                isShowingRef.current = false;
                            });
                        }
                    } else if (newRow && newRow.is_active === true) {
                        // Admin published a new active featured student
                        checkForActiveFeature();
                    }
                }
            )
            .subscribe();

        return () => {
            if (timer) clearTimeout(timer);
            supabase.removeChannel(channel);
        };
    }, [profile?.id, isProfileComplete, signupEmail, signupStep, segments[0], feature?.id, scaleAnim, opacityAnim]);

    // Realtime listener for incoming congratulations on featured student device
    useEffect(() => {
        if (!feature || feature.user_id !== profile?.id) return;

          const channel = supabase
            .channel(`featured_realtime_toast_${feature.id}_${Date.now()}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'student_congratulations',
                    filter: `featured_student_id=eq.${feature.id}`,
                },
                async (payload) => {
                    const newUserId = payload.new.user_id;
                    if (newUserId === profile?.id) return;

                    const { data: userData } = await supabase
                        .from('users')
                        .select('id, full_name, username, avatar_url, level')
                        .eq('id' as any, newUserId)
                        .single();

                    if (userData) {
                        setIncomingCongratulator(userData);
                        setHasAppreciated(false);
                        setIncomingToastVisible(true);
                        setFeature((prev) => (prev ? { ...prev, total_congratulations: prev.total_congratulations + 1 } : null));
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [feature?.id, profile?.id]);

    // Start continuous particle motion loop when modal is visible
    useEffect(() => {
        if (isVisible) {
            particlesRef.current.forEach((p) => {
                p.anim.setValue(0);
                Animated.loop(
                    Animated.sequence([
                        Animated.delay(p.delay),
                        Animated.timing(p.anim, {
                            toValue: 1,
                            duration: p.duration,
                            easing: Easing.linear,
                            useNativeDriver: true,
                        }),
                    ])
                ).start();
            });
        }
    }, [isVisible]);

    const checkForActiveFeature = async () => {
        if (isShowingRef.current || !profile?.id) return;
        try {
            const { data, error } = await supabase
                .from('featured_students')
                .select(`
                    id, user_id, type, title, subtitle, description, custom_image_url, total_congratulations,
                    users!featured_students_user_id_fkey ( full_name, username, avatar_url, department_id )
                `)
                .eq('is_active' as any, true as any)
                .order('published_at', { ascending: false });

            if (error || !data || data.length === 0) return;

            // Fetch user's remote dismissals and congratulations
            const { data: dismissals } = await (supabase as any)
                .from('featured_student_dismissals')
                .select('featured_student_id')
                .eq('user_id', profile.id);
                
            const { data: congratulations } = await (supabase as any)
                .from('student_congratulations')
                .select('featured_student_id')
                .eq('user_id', profile.id);

            const dismissedIds = new Set(dismissals?.map((d: any) => d.featured_student_id) || []);
            const congratulatedIds = new Set(congratulations?.map((c: any) => c.featured_student_id) || []);

            let nextFeature = null;
            for (const item of (data as any[])) {
                const userId = profile.id;
                const dismissedKey = `dismissed_featured_${userId}_${item.id}`;
                const isDismissedLocal = await mmkvStorage.getItem(dismissedKey);
                const congratsKey = `congratulated_${userId}_${item.id}`;
                const didCongratulateLocal = await mmkvStorage.getItem(congratsKey);

                const isDismissed = isDismissedLocal || dismissedIds.has(item.id);
                const isCongratulated = didCongratulateLocal || congratulatedIds.has(item.id);
                const isSuppressedThisSession = sessionSuppressedIdsRef.current.has(item.id);

                if (!isDismissed && !isCongratulated && !isSuppressedThisSession) {
                    nextFeature = item;
                    break;
                }
            }

            if (!nextFeature) return;

            isShowingRef.current = true;
            const currentFeature = nextFeature as any as FeaturedStudent;

            // It's not congratulated (otherwise we wouldn't show it), but we set state safely
            setHasCongratulated(false);

            setFeature(currentFeature);
            setIsVisible(true);
            
            Animated.parallel([
                Animated.spring(scaleAnim, {
                    toValue: 1,
                        tension: 60,
                        friction: 8,
                        useNativeDriver: true,
                    }),
                    Animated.timing(opacityAnim, {
                        toValue: 1,
                        duration: 350,
                        useNativeDriver: true,
                    }),
                ]).start();

                // Start Grand Reveal
                setIsRevealing(true);
                revealParticlesRef.current.forEach((p) => {
                    p.anim.setValue(0);
                    Animated.timing(p.anim, {
                        toValue: 1,
                        duration: 2500 + Math.random() * 1500,
                        easing: Easing.out(Easing.cubic),
                        useNativeDriver: true,
                    }).start();
                });
                
                // Hide reveal after it finishes
                setTimeout(() => setIsRevealing(false), 4500);
        } catch (e) {
            console.log('No active featured student or error fetching:', e);
        }
    };

    const handleDismiss = async () => {
        if (!feature || !profile?.id) return;
        
        const userId = profile.id;
        await mmkvStorage.setItem(`dismissed_featured_${userId}_${feature.id}`, 'true');
        sessionSuppressedIdsRef.current.add(feature.id);
        
        // Persist to database to sync across devices
        if (profile?.id) {
            (supabase as any).from('featured_student_dismissals').insert({
                featured_student_id: feature.id,
                user_id: profile.id
            }).then();
        }
        
        Animated.parallel([
            Animated.timing(scaleAnim, {
                toValue: 0.85,
                duration: 200,
                useNativeDriver: true,
            }),
            Animated.timing(opacityAnim, {
                toValue: 0,
                duration: 200,
                useNativeDriver: true,
            }),
        ]).start(() => {
            setIsVisible(false);
            setFeature(null);
            isShowingRef.current = false;
        });
    };

    const handleCongratulate = async () => {
        if (!feature || !profile?.id || hasCongratulated || isSubmitting) return;
        
        setIsSubmitting(true);
        setIsBursting(true);

        burstParticlesRef.current.forEach((b) => {
            b.anim.setValue(0);
            Animated.timing(b.anim, {
                toValue: 1,
                duration: 900,
                easing: Easing.out(Easing.back(1.5)),
                useNativeDriver: true,
            }).start();
        });

        try {
            const { error } = await supabase.rpc('congratulate_student', {
                p_featured_student_id: feature.id,
            });
            
            if (error && !error.message.includes('already congratulated')) {
                throw error;
            }

            setHasCongratulated(true);
            const userId = profile.id;
            await mmkvStorage.setItem(`congratulated_${userId}_${feature.id}`, 'true');
            setFeature((prev) => (prev ? { ...prev, total_congratulations: prev.total_congratulations + 1 } : null));

            // Send Push Notification to the Featured Student
            if (feature.user_id !== profile?.id) {
                sendPushNotification({
                    targetUserIds: [feature.user_id],
                    title: '❤️ New Congratulation!',
                    body: `${profile?.full_name || 'A student'} congratulated you on being Featured Student!`,
                    data: {
                        type: 'fyb_congratulation',
                        featured_student_id: feature.id,
                        congratulator_id: profile?.id,
                        congratulator_name: profile?.full_name || 'A student',
                    },
                });
            }

        } catch (error) {
            console.error('Failed to congratulate:', error);
        } finally {
            setIsSubmitting(false);
            setTimeout(() => setIsBursting(false), 1000);
        }
    };

    if (!isVisible || !feature) return null;

    const isSelf = feature.user_id === profile?.id;
    const bgImage = feature.custom_image_url || feature.users?.avatar_url;
    
    const getBadgeConfig = (): {
        gradient: [string, string];
        color: string;
        icon: string;
        text: string;
        bannerText: string;
    } => {
        const customColor = feature.color || '#059669';
        const customIcon = feature.icon || 'star';
        const customTitle = feature.title || 'Featured Student';
        
        // Map Admin Lucide icon names to Ionicons names for mobile
        const iconMap: Record<string, string> = {
            'star': 'star',
            'crown': 'ribbon', // Ionicons doesn't have a crown, ribbon is a good substitute
            'trophy': 'trophy',
            'award': 'ribbon',
            'medal': 'medal',
            'sparkles': 'sparkles',
            'heart': 'heart',
            'zap': 'flash',
            'flame': 'flame',
            'shield': 'shield',
            'rocket': 'rocket',
            'diamond': 'diamond',
            'graduation-cap': 'school',
        };

        const ioniconName = iconMap[customIcon] || 'star';
        
        return { 
            gradient: [customColor, '#022c22'], 
            color: customColor, 
            icon: ioniconName as any, 
            text: `✨ ${customTitle}`,
            bannerText: isSelf ? `🌟 YOU ARE THE ${customTitle.toUpperCase()}!` : `${customTitle.toUpperCase()}`
        };
    };
    
    const badge = getBadgeConfig();

    return (
        <>
            <Modal transparent visible={isVisible} animationType="none" statusBarTranslucent>
                <View style={styles.overlay}>
                    <BlurView intensity={isDark ? 65 : 45} style={StyleSheet.absoluteFillObject} tint={isDark ? 'dark' : 'light'} />
                    
                    {/* CONTINUOUS FLOATING MOTION STARS & LOVE EMOJIS */}
                    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
                        {/* GRAND REVEAL PARTICLES ON OPEN */}
                        {isRevealing && revealParticlesRef.current.map((r) => {
                            const translateX = r.anim.interpolate({
                                inputRange: [0, 1],
                                outputRange: [0, r.distanceX],
                            });
                            const translateY = r.anim.interpolate({
                                inputRange: [0, 0.4, 1],
                                outputRange: [0, r.peakY, height / 2], 
                            });
                            const rotation = r.anim.interpolate({
                                inputRange: [0, 1],
                                outputRange: ['0deg', `${r.distanceX > 0 ? 720 : -720}deg`],
                            });
                            const opacity = r.anim.interpolate({
                                inputRange: [0, 0.8, 1],
                                outputRange: [1, 1, 0],
                            });
                            const scale = r.anim.interpolate({
                                inputRange: [0, 0.1, 0.8, 1],
                                outputRange: [0, 1.5, 1, 0.5],
                            });

                            return (
                                <Animated.Text
                                    key={`reveal-p-${r.id}`}
                                    style={[
                                        styles.revealParticle,
                                        {
                                            left: width / 2 - 10,
                                            top: height / 2 - 50,
                                            fontSize: r.size,
                                            color: r.color,
                                            opacity,
                                            transform: [{ translateX }, { translateY }, { rotate: rotation }, { scale }],
                                        },
                                    ]}
                                >
                                    {r.symbol}
                                </Animated.Text>
                            );
                        })}

                        {particlesRef.current.map((p) => {
                            const translateY = p.anim.interpolate({
                                inputRange: [0, 1],
                                outputRange: [height + 30, -70],
                            });
                            const translateX = p.anim.interpolate({
                                inputRange: [0, 0.25, 0.5, 0.75, 1],
                                outputRange: [0, p.drift, -p.drift, p.drift, 0],
                            });
                            const scale = p.anim.interpolate({
                                inputRange: [0, 0.15, 0.5, 0.85, 1],
                                outputRange: [0.3, 1.25, 0.9, 1.15, 0.4],
                            });
                            const rotate = p.anim.interpolate({
                                inputRange: [0, 1],
                                outputRange: ['0deg', `${p.drift > 0 ? 360 : -360}deg`],
                            });
                            const opacity = p.anim.interpolate({
                                inputRange: [0, 0.12, 0.82, 1],
                                outputRange: [0, 0.95, 0.95, 0],
                            });

                            return (
                                <Animated.Text
                                    key={`star-p-${p.id}`}
                                    style={[
                                        styles.floatingParticle,
                                        {
                                            left: p.x,
                                            fontSize: p.size,
                                            color: p.color,
                                            opacity,
                                            transform: [{ translateY }, { translateX }, { scale }, { rotate }],
                                        },
                                    ]}
                                >
                                    {p.symbol}
                                </Animated.Text>
                            );
                        })}

                        {/* BURST CELEBRATION PARTICLES WHEN CONGRATULATED */}
                        {isBursting && burstParticlesRef.current.map((b) => {
                            const translateX = b.anim.interpolate({
                                inputRange: [0, 1],
                                outputRange: [0, Math.cos(b.angle) * b.distance],
                            });
                            const translateY = b.anim.interpolate({
                                inputRange: [0, 1],
                                outputRange: [0, Math.sin(b.angle) * b.distance],
                            });
                            const scale = b.anim.interpolate({
                                inputRange: [0, 0.3, 1],
                                outputRange: [0.2, 1.4, 0],
                            });
                            const opacity = b.anim.interpolate({
                                inputRange: [0, 0.2, 0.8, 1],
                                outputRange: [0, 1, 1, 0],
                            });

                            return (
                                <Animated.Text
                                    key={`burst-p-${b.id}`}
                                    style={[
                                        styles.burstParticle,
                                        {
                                            left: width / 2 - 10,
                                            top: height / 2 + 100,
                                            fontSize: b.size,
                                            color: b.color,
                                            opacity,
                                            transform: [{ translateX }, { translateY }, { scale }],
                                        },
                                    ]}
                                >
                                    {b.symbol}
                                </Animated.Text>
                            );
                        })}
                    </View>

                    {/* ═══════════════════════════════════════════════════════════ */}
                    {/* SELECTED STUDENT'S OWN AWARD POPUP — Personal celebration */}
                    {/* ═══════════════════════════════════════════════════════════ */}
                    {isSelf ? (
                        <Animated.View 
                            style={[
                                styles.popupContainer, 
                                { backgroundColor: colors.card, borderColor: badge.color },
                                { opacity: opacityAnim, transform: [{ scale: scaleAnim }] }
                            ]}
                        >
                            {/* Golden Award Banner */}
                            <LinearGradient colors={['#fbbf24', '#f59e0b', '#d97706']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.selfAwardBanner}>
                                <Ionicons name="trophy" size={18} color="#fff" />
                                <Text style={styles.selfAwardBannerText}>🏆 YOU HAVE BEEN SELECTED! 🏆</Text>
                                <Ionicons name="trophy" size={18} color="#fff" />
                            </LinearGradient>

                            {/* Your Photo */}
                            <View style={styles.selfAwardImageWrap}>
                                {bgImage ? (
                                    <CachedImage 
                                        remoteUrl={bgImage} 
                                        style={styles.selfAwardImage as any} 
                                        resizeMode="cover" 
                                        entityId={feature.id} 
                                        assetType="featured_student"
                                    />
                                ) : (
                                    <View style={[styles.selfAwardImage, { backgroundColor: badge.color, opacity: 0.15 }]} />
                                )}
                                <LinearGradient colors={['transparent', 'rgba(0,0,0,0.9)']} style={styles.selfAwardImageOverlay}>
                                    <Text style={styles.selfAwardYourName} numberOfLines={1}>
                                        {feature.users?.full_name || 'You'}
                                    </Text>
                                </LinearGradient>
                            </View>

                            {/* Award Title & Description */}
                            <View style={styles.selfAwardContent}>
                                <View style={[styles.selfAwardBadge, { backgroundColor: badge.color }]}>
                                    <Ionicons name={badge.icon as any} size={16} color="#fff" />
                                    <Text style={styles.selfAwardBadgeText}>{badge.text}</Text>
                                </View>

                                <Text style={[styles.selfAwardTitle, { color: badge.color }]}>
                                    You have been featured as{'\n'}{badge.text.replace(/[^a-zA-Z ]/g, '').trim()}!
                                </Text>

                                <Text style={[styles.selfAwardSubtitle, { color: colors.textMuted }]}>
                                    Your outstanding performance and contributions in the Department of Library and Information Science have been recognized. Fellow students can now celebrate this achievement with you! 🎉
                                </Text>

                                {feature.subtitle && (
                                    <Text style={[styles.subtitle, { color: badge.color }]} numberOfLines={1}>
                                        {feature.subtitle}
                                    </Text>
                                )}

                                {feature.description && (
                                    <View style={[styles.quoteBox, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)' }]}>
                                        <Text style={[styles.description, { color: colors.text }]} numberOfLines={4}>
                                            "{feature.description}"
                                        </Text>
                                    </View>
                                )}
                            </View>

                            {/* Congrats Counter + Dismiss */}
                            <View style={[styles.selfAwardFooter, { borderTopColor: colors.border }]}>
                                <View style={styles.selfCongratsCard}>
                                    <Ionicons name="heart" size={22} color="#ef4444" />
                                    <Text style={styles.selfCongratsCardText}>
                                        {feature.total_congratulations}
                                    </Text>
                                </View>

                                <TouchableOpacity style={styles.dismissBtn} onPress={handleDismiss} activeOpacity={0.7}>
                                    <Text style={[styles.dismissBtnText, { color: colors.textMuted }]}>
                                        Dismiss
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        </Animated.View>
                    ) : (
                        /* ═══════════════════════════════════════════════════════════ */
                        /* OTHER USERS' CONGRATULATE POPUP — Social engagement        */
                        /* ═══════════════════════════════════════════════════════════ */
                        <Animated.View 
                            style={[
                                styles.popupContainer, 
                                { backgroundColor: colors.card, borderColor: colors.border },
                                { opacity: opacityAnim, transform: [{ scale: scaleAnim }] }
                            ]}
                        >
                            {/* Glowing Top Banner */}
                            <LinearGradient colors={badge.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.topHonorBanner}>
                                <Ionicons name="sparkles" size={14} color="#FFF" />
                                <Text style={styles.topHonorText}>{badge.bannerText}</Text>
                                <Ionicons name="sparkles" size={14} color="#FFF" />
                            </LinearGradient>

                            {/* Badge and Stats Row */}
                            <View style={[styles.statsRow, { backgroundColor: isDark ? '#111827' : '#f8fafc' }]}>
                                <View style={[styles.badge, { backgroundColor: badge.color }]}>
                                    <Ionicons name={badge.icon as any} size={14} color="#fff" />
                                    <Text style={styles.badgeText}>{badge.text}</Text>
                                </View>
                                
                                {/* Congratulations Heart Count in RED */}
                                <View style={styles.congratsCountBadge}>
                                    <Ionicons name="heart" size={15} color="#ef4444" />
                                    <Text style={styles.congratsCountText}>{feature.total_congratulations}</Text>
                                </View>
                            </View>

                            {/* Header Image Area */}
                            <View style={styles.imageHeader}>
                                {bgImage ? (
                                    <CachedImage 
                                        remoteUrl={bgImage} 
                                        style={styles.coverImage as any} 
                                        resizeMode="cover" 
                                        entityId={feature.id} 
                                        assetType="featured_student"
                                    />
                                ) : (
                                    <View style={[styles.coverImage, { backgroundColor: badge.color, opacity: 0.15 }]} />
                                )}
                                
                                <LinearGradient colors={['transparent', 'rgba(0,0,0,0.85)']} style={styles.imageOverlay}>
                                    <View style={styles.overlayBottomRow}>
                                        <Text style={styles.studentNameOverlay} numberOfLines={1}>
                                            {feature.users?.full_name || 'Featured Student'}
                                        </Text>
                                    </View>
                                </LinearGradient>
                            </View>

                            {/* Content Area */}
                            <View style={styles.content}>
                                <Text style={[styles.classicMainTitle, { color: isDark ? '#34d399' : '#059669' }]}>
                                    Congratulations to {feature.users?.full_name || 'this student'} for being featured as our {badge.text.replace(/[^a-zA-Z ]/g, '').trim().toLowerCase()}! 🎉
                                </Text>
                                
                                {feature.subtitle && (
                                    <Text style={[styles.subtitle, { color: badge.color }]} numberOfLines={1}>
                                        {feature.subtitle}
                                    </Text>
                                )}

                                {feature.description && (
                                    <View style={[styles.quoteBox, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)' }]}>
                                        <Text style={[styles.description, { color: colors.text }]} numberOfLines={4}>
                                            "{feature.description}"
                                        </Text>
                                    </View>
                                )}
                            </View>

                            {/* Action Area — Congratulate Button */}
                            <View style={[styles.actions, { borderTopColor: colors.border }]}>
                                <TouchableOpacity 
                                    style={[
                                        styles.congratulateBtn, 
                                        hasCongratulated ? styles.congratulateBtnDone : { backgroundColor: badge.color }
                                    ]} 
                                    onPress={handleCongratulate}
                                    disabled={hasCongratulated || isSubmitting}
                                    activeOpacity={0.8}
                                >
                                    {isSubmitting ? (
                                        <Text style={styles.btnText}>Sending Love...</Text>
                                    ) : (
                                        <>
                                            <Ionicons 
                                                name={hasCongratulated ? "heart" : "heart-outline"} 
                                                size={22} 
                                                color={hasCongratulated ? badge.color : "#fff"} 
                                            />
                                            <Text style={[styles.btnText, hasCongratulated && { color: badge.color }]}>
                                                {hasCongratulated ? 'Congratulated! 🎉💖' : 'Congratulate Student 💖'}
                                            </Text>
                                        </>
                                    )}
                                </TouchableOpacity>

                                <TouchableOpacity style={styles.dismissBtn} onPress={handleDismiss} activeOpacity={0.7}>
                                    <Text style={[styles.dismissBtnText, { color: colors.textMuted }]}>
                                        Stop seeing this
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        </Animated.View>
                    )}
                </View>
            </Modal>

            {/* REALTIME INCOMING CONGRATULATION TOAST MODAL FOR FEATURED STUDENT */}
            <Modal transparent visible={incomingToastVisible} animationType="fade">
                <BlurView intensity={70} style={styles.overlay} tint={isDark ? 'dark' : 'light'}>
                    <View style={[styles.toastContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <LinearGradient colors={['#059669', '#005A36']} style={styles.toastHeaderGradient}>
                            <Ionicons name="heart" size={22} color="#ef4444" />
                            <Text style={styles.toastHeaderTitle}>NEW CONGRATULATION RECEIVED!</Text>
                        </LinearGradient>

                        <View style={styles.toastBody}>
                            <CachedImage 
                                remoteUrl={incomingCongratulator?.avatar_url} 
                                style={styles.toastAvatar} 
                                entityId={incomingCongratulator?.id || ''} 
                                assetType="user" 
                            />
                            <Text style={[styles.toastUserText, { color: colors.text }]}>
                                {incomingCongratulator?.full_name || 'A student'}
                            </Text>
                            <Text style={[styles.toastMetaText, { color: colors.textMuted }]}>
                                @{incomingCongratulator?.username || 'user'} • {incomingCongratulator?.level ? `Level ${incomingCongratulator.level}` : 'LIS Dept'}
                            </Text>
                            <Text style={[styles.toastDescText, { color: colors.text }]}>
                                Just sent you love and congratulated you on being Featured Student! 🎉💖
                            </Text>

                            <TouchableOpacity 
                                style={[styles.toastAppreciateBtn, hasAppreciated && styles.toastAppreciatedBtn]}
                                onPress={() => {
                                    if (incomingCongratulator?.id) {
                                        sendPushNotification({
                                            targetUserIds: [incomingCongratulator.id],
                                            title: '💕 Appreciation Received!',
                                            body: `${profile?.full_name || 'The Featured Student'} sent you appreciation: "Thank you so much for the love! 💕"`,
                                            data: { type: 'fyb_appreciation' },
                                        });
                                        setHasAppreciated(true);
                                    }
                                }}
                                disabled={hasAppreciated}
                            >
                                <Ionicons name="heart" size={18} color="#fff" />
                                <Text style={styles.toastAppreciateBtnText}>
                                    {hasAppreciated ? 'Appreciation Sent 💕' : 'Send Appreciation 💕'}
                                </Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[styles.toastProfileBtn, { borderColor: colors.border }]}
                                onPress={() => {
                                    setIncomingToastVisible(false);
                                    if (incomingCongratulator?.id) {
                                        router.push(`/chat/user_profile?id=${incomingCongratulator.id}` as any);
                                    }
                                }}
                            >
                                <Ionicons name="person-outline" size={16} color={colors.text} />
                                <Text style={[styles.toastProfileBtnText, { color: colors.text }]}>View Student Profile</Text>
                            </TouchableOpacity>

                            <TouchableOpacity style={{ marginTop: 8 }} onPress={() => setIncomingToastVisible(false)}>
                                <Text style={{ color: colors.textMuted, fontWeight: '700', fontSize: 13 }}>Dismiss</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </BlurView>
            </Modal>
        </>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.5)',
        padding: 20,
    },
    revealParticle: {
        position: 'absolute',
        fontWeight: 'bold',
        textShadowColor: 'rgba(255, 215, 0, 0.6)',
        textShadowOffset: { width: 0, height: 0 },
        textShadowRadius: 10,
        zIndex: 10,
    },
    floatingParticle: {
        position: 'absolute',
        fontWeight: 'bold',
        textShadowColor: 'rgba(0,0,0,0.4)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 3,
    },
    burstParticle: {
        position: 'absolute',
        fontWeight: 'bold',
        textShadowColor: 'rgba(255,255,255,0.8)',
        textShadowOffset: { width: 0, height: 0 },
        textShadowRadius: 6,
    },
    // ── Selected Student Award Popup Styles ──
    selfAwardBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        paddingHorizontal: 16,
        gap: 8,
    },
    selfAwardBannerText: {
        color: '#FFFFFF',
        fontSize: 13,
        fontWeight: '900',
        letterSpacing: 1.5,
        textTransform: 'uppercase',
        textShadowColor: 'rgba(0,0,0,0.3)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 2,
    },
    selfAwardImageWrap: {
        height: 160,
        width: '100%',
        position: 'relative',
        backgroundColor: '#1f2937',
    },
    selfAwardImage: {
        width: '100%',
        height: '100%',
    },
    selfAwardImageOverlay: {
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        justifyContent: 'flex-end',
        padding: 16,
    },
    selfAwardYourName: {
        color: '#FFFFFF',
        fontSize: 20,
        fontWeight: '900',
        textShadowColor: 'rgba(0, 0, 0, 0.8)',
        textShadowOffset: { width: 0, height: 2 },
        textShadowRadius: 6,
    },
    selfAwardContent: {
        padding: 16,
        paddingBottom: 12,
        alignItems: 'center',
    },
    selfAwardBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        gap: 4,
        marginBottom: 10,
    },
    selfAwardBadgeText: {
        color: '#fff',
        fontSize: 11,
        fontWeight: '800',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    selfAwardTitle: {
        fontSize: 17,
        fontWeight: '900',
        textAlign: 'center',
        marginBottom: 6,
        lineHeight: 24,
    },
    selfAwardSubtitle: {
        fontSize: 13,
        textAlign: 'center',
        lineHeight: 18,
        marginBottom: 10,
    },
    selfAwardFooter: {
        padding: 16,
        paddingTop: 12,
        gap: 10,
        alignItems: 'center',
        borderTopWidth: 1,
    },

    // ── Other Users Congratulate Popup Styles ──
    popupContainer: {
        width: '100%',
        borderRadius: 24,
        overflow: 'hidden',
        borderWidth: 1.5,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.15,
        shadowRadius: 24,
        elevation: 24,
    },
    topHonorBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 8,
        paddingHorizontal: 16,
        gap: 8,
    },
    topHonorText: {
        color: '#FFFFFF',
        fontSize: 11,
        fontWeight: '900',
        letterSpacing: 1.2,
        textTransform: 'uppercase',
    },
    imageHeader: {
        height: 160,
        width: '100%',
        position: 'relative',
        backgroundColor: '#1f2937',
    },
    coverImage: {
        width: '100%',
        height: '100%',
    },
    imageOverlay: {
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        justifyContent: 'space-between',
        padding: 12,
        paddingHorizontal: 16,
    },
    overlayTopRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    overlayBottomRow: {
        paddingTop: 0,
    },
    studentNameOverlay: {
        color: '#fbbf24', // Golden color
        fontSize: 19,
        fontWeight: '900',
        textShadowColor: 'rgba(0, 0, 0, 0.85)',
        textShadowOffset: { width: 0, height: 2 },
        textShadowRadius: 8,
    },
    badge: {
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 16,
        gap: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
    },
    badgeText: {
        color: '#fff',
        fontSize: 11,
        fontWeight: '800',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    congratsCountBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.95)',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 16,
        gap: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
    },
    congratsCountText: {
        fontSize: 13,
        fontWeight: '900',
        color: '#ef4444',
    },
    content: {
        padding: 16,
        paddingBottom: 12,
        alignItems: 'center',
    },
    classicMainTitle: {
        fontSize: 17,
        fontWeight: '800',
        textAlign: 'center',
        marginBottom: 6,
        lineHeight: 24,
        letterSpacing: 0.2,
    },
    statsRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(0,0,0,0.05)',
    },
    mainTitle: {
        fontSize: 20,
        fontWeight: '800',
        textAlign: 'center',
        marginBottom: 6,
        lineHeight: 26,
    },
    subtitle: {
        fontSize: 13,
        fontWeight: '700',
        textAlign: 'center',
        marginBottom: 10,
    },
    quoteBox: {
        width: '100%',
        padding: 10,
        borderRadius: 12,
        marginTop: 4,
    },
    description: {
        fontSize: 13,
        textAlign: 'center',
        lineHeight: 18,
        fontStyle: 'italic',
    },
    actions: {
        padding: 16,
        paddingTop: 0,
        gap: 10,
        alignItems: 'center',
    },
    selfCongratsCard: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 8,
        paddingHorizontal: 20,
        borderRadius: 24,
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        borderWidth: 1.5,
        borderColor: 'rgba(239, 68, 68, 0.3)',
        gap: 6,
        alignSelf: 'center',
    },
    selfCongratsCardText: {
        fontSize: 16,
        fontWeight: '900',
        color: '#ef4444',
        textAlign: 'center',
    },
    congratulateBtn: {
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        borderRadius: 14,
        gap: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius: 8,
        elevation: 4,
    },
    congratulateBtnDone: {
        backgroundColor: 'transparent',
        borderWidth: 2,
        borderColor: 'rgba(0,0,0,0.15)',
        shadowOpacity: 0,
        elevation: 0,
    },
    btnText: {
        color: '#fff',
        fontSize: 15,
        fontWeight: '800',
    },
    dismissBtn: {
        paddingVertical: 8,
        paddingHorizontal: 16,
    },
    dismissBtnText: {
        fontSize: 13,
        fontWeight: '700',
    },

    // Toast modal styles
    toastContainer: {
        width: '100%',
        maxWidth: 360,
        borderRadius: 24,
        overflow: 'hidden',
        borderWidth: 1.5,
        alignItems: 'center',
    },
    toastHeaderGradient: {
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        paddingHorizontal: 16,
        gap: 8,
    },
    toastHeaderTitle: {
        color: '#FFFFFF',
        fontSize: 12,
        fontWeight: '900',
        letterSpacing: 0.8,
    },
    toastBody: {
        padding: 20,
        alignItems: 'center',
        width: '100%',
    },
    toastAvatar: {
        width: 64,
        height: 64,
        borderRadius: 32,
        marginBottom: 8,
        borderWidth: 2,
        borderColor: '#059669',
    },
    toastUserText: {
        fontSize: 18,
        fontWeight: '800',
        textAlign: 'center',
    },
    toastMetaText: {
        fontSize: 13,
        fontWeight: '600',
        marginBottom: 8,
    },
    toastDescText: {
        fontSize: 14,
        textAlign: 'center',
        lineHeight: 20,
        marginBottom: 16,
    },
    toastAppreciateBtn: {
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        borderRadius: 14,
        backgroundColor: '#059669',
        gap: 6,
        marginBottom: 8,
    },
    toastAppreciatedBtn: {
        backgroundColor: 'rgba(0,0,0,0.1)',
    },
    toastAppreciateBtnText: {
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: '800',
    },
    toastProfileBtn: {
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 10,
        borderRadius: 14,
        borderWidth: 1,
        gap: 6,
        marginBottom: 4,
    },
    toastProfileBtnText: {
        fontSize: 13,
        fontWeight: '700',
    },
});
