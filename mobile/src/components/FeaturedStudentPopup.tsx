import React, { useEffect, useState, useRef } from 'react';
import { 
    View, Text, StyleSheet, TouchableOpacity, Image, Modal, 
    Animated, Dimensions, Easing, Platform 
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
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

export function FeaturedStudentPopup() {
    const { colors, isDark } = useTheme();
    const { profile, isProfileComplete } = useAuthStore();
    const signupEmail = useSignupStore(s => s.email);
    const signupStep = useSignupStore(s => s.currentStep);
    
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
    const [isBursting, setIsBursting] = useState(false);

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

    useEffect(() => {
        // Only show the popup when the user has FULLY completed registration.
        // Prevents the popup from appearing on auth/signup screens (level, identity, etc.)
        const isInSignupFlow = !!signupEmail || (signupStep != null && signupStep > 0);
        if (!profile || isProfileComplete !== true || isInSignupFlow) return;
        
        checkForActiveFeature();

        // Realtime listener for INSTANT popup when Admin adds a featured student
        const channel = supabase
            .channel('global_featured_students_listener')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'featured_students',
                    filter: 'is_active=eq.true',
                },
                () => {
                    // Admin published a new active featured student, fetch and show!
                    checkForActiveFeature();
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [profile, isProfileComplete, signupEmail, signupStep]);

    // Realtime listener for incoming congratulations on featured student device
    useEffect(() => {
        if (!feature || feature.user_id !== profile?.id) return;

        const channel = supabase
            .channel(`featured_realtime_toast_${feature.id}`)
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
                        .eq('id', newUserId)
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
        try {
            const { data, error } = await supabase
                .from('featured_students')
                .select(`
                    id, user_id, type, title, subtitle, description, custom_image_url, total_congratulations,
                    users!featured_students_user_id_fkey ( full_name, username, avatar_url, department_id )
                `)
                .eq('is_active', true as any)
                .order('published_at', { ascending: false })
                .limit(1)
                .single();

            if (error || !data) return;

            const currentFeature = data as any as FeaturedStudent;

            const dismissedKey = `dismissed_featured_${currentFeature.id}`;
            const isDismissed = await mmkvStorage.getItem(dismissedKey);
            
            if (!isDismissed) {
                const congratsKey = `congratulated_${currentFeature.id}`;
                const didCongratulate = await mmkvStorage.getItem(congratsKey);
                
                if (didCongratulate) setHasCongratulated(true);

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
            }
        } catch (e) {
            console.log('No active featured student or error fetching:', e);
        }
    };

    const handleDismiss = async () => {
        if (!feature) return;
        
        await mmkvStorage.setItem(`dismissed_featured_${feature.id}`, 'true');
        
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
        });
    };

    const handleCongratulate = async () => {
        if (!feature || hasCongratulated || isSubmitting) return;
        
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
            await mmkvStorage.setItem(`congratulated_${feature.id}`, 'true');
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
        switch (feature.type) {
            case 'legend_of_the_month':
                return { 
                    gradient: ['#005A36', '#059669'], 
                    color: '#059669', 
                    icon: 'medal', 
                    text: '👑 Legend of the Month',
                    bannerText: isSelf ? '👑 YOU ARE THE FEATURED LEGEND!' : 'HIGH HONOR & RECOGNITION'
                };
            case 'event_winner':
                return { 
                    gradient: ['#047857', '#10b981'], 
                    color: '#10b981', 
                    icon: 'trophy', 
                    text: '🏆 Event Winner',
                    bannerText: isSelf ? '🏆 YOU ARE THE CHAMPION!' : 'CHAMPIONSHIP VICTORY'
                };
            case 'student_of_the_week':
            default:
                return { 
                    gradient: ['#059669', '#d97706'], 
                    color: '#059669', 
                    icon: 'star', 
                    text: '✨ Student of the Week',
                    bannerText: isSelf ? '🌟 YOU ARE THE FEATURED STUDENT!' : 'ACADEMIC EXCELLENCE'
                };
        }
    };
    
    const badge = getBadgeConfig();

    return (
        <>
            <Modal transparent visible={isVisible} animationType="none" statusBarTranslucent>
                <BlurView intensity={isDark ? 65 : 45} style={styles.overlay} tint={isDark ? 'dark' : 'light'}>
                    
                    {/* CONTINUOUS FLOATING MOTION STARS & LOVE EMOJIS */}
                    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
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

                    {/* ELEGANT FEATURED POPUP CONTAINER */}
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

                        {/* Header Image Area */}
                        <View style={styles.imageHeader}>
                            {bgImage ? (
                                <Image source={{ uri: bgImage }} style={styles.coverImage} resizeMode="cover" />
                            ) : (
                                <View style={[styles.coverImage, { backgroundColor: badge.color, opacity: 0.15 }]} />
                            )}
                            
                            <LinearGradient colors={['rgba(0,0,0,0.2)', 'transparent', 'rgba(0,0,0,0.85)']} style={styles.imageOverlay}>
                                <View style={styles.overlayTopRow}>
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

                                <View style={styles.overlayBottomRow}>
                                    <Text style={styles.studentNameOverlay} numberOfLines={1}>
                                        {isSelf ? `${feature.users?.full_name || 'You'} (YOU)` : (feature.users?.full_name || 'Featured Student')}
                                    </Text>
                                </View>
                            </LinearGradient>
                        </View>

                        {/* Content Area */}
                        <View style={styles.content}>
                            <Text style={[styles.mainTitle, { color: colors.text }]} numberOfLines={2}>
                                {isSelf ? `CONGRATULATIONS ${profile?.full_name || profile?.username}! YOU ARE FEATURED!` : feature.title}
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

                        {/* Action Area */}
                        <View style={[styles.actions, { borderTopColor: colors.border }]}>
                            {isSelf ? (
                                <View style={styles.selfCongratsCard}>
                                    <Ionicons name="heart" size={20} color="#ef4444" />
                                    <Text style={styles.selfCongratsCardText}>
                                        You have received {feature.total_congratulations} Congratulations from fellow students! 💕
                                    </Text>
                                </View>
                            ) : (
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
                            )}

                            <TouchableOpacity style={styles.dismissBtn} onPress={handleDismiss} activeOpacity={0.7}>
                                <Text style={[styles.dismissBtnText, { color: colors.textMuted }]}>
                                    Stop seeing this
                                </Text>
                            </TouchableOpacity>
                        </View>
                    </Animated.View>
                </BlurView>
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
    popupContainer: {
        width: '100%',
        maxWidth: 400,
        borderRadius: 28,
        overflow: 'hidden',
        borderWidth: 1.5,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.3,
        shadowRadius: 24,
        elevation: 12,
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
        height: 230,
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
        padding: 16,
    },
    overlayTopRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    overlayBottomRow: {
        paddingTop: 8,
    },
    studentNameOverlay: {
        color: '#FFFFFF',
        fontSize: 22,
        fontWeight: '900',
        textShadowColor: 'rgba(0, 0, 0, 0.8)',
        textShadowOffset: { width: 0, height: 2 },
        textShadowRadius: 6,
    },
    badge: {
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 20,
        gap: 6,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
    },
    badgeText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '800',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    congratsCountBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.95)',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 20,
        gap: 6,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
    },
    congratsCountText: {
        fontSize: 14,
        fontWeight: '900',
        color: '#ef4444',
    },
    content: {
        padding: 20,
        paddingBottom: 16,
        alignItems: 'center',
    },
    mainTitle: {
        fontSize: 20,
        fontWeight: '800',
        textAlign: 'center',
        marginBottom: 6,
        lineHeight: 26,
    },
    subtitle: {
        fontSize: 14,
        fontWeight: '700',
        textAlign: 'center',
        marginBottom: 12,
    },
    quoteBox: {
        width: '100%',
        padding: 12,
        borderRadius: 14,
        marginTop: 4,
    },
    description: {
        fontSize: 14,
        textAlign: 'center',
        lineHeight: 20,
        fontStyle: 'italic',
    },
    actions: {
        padding: 20,
        paddingTop: 0,
        gap: 10,
        alignItems: 'center',
    },
    selfCongratsCard: {
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderRadius: 16,
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        borderWidth: 1.5,
        borderColor: '#ef4444',
        gap: 8,
    },
    selfCongratsCardText: {
        fontSize: 14,
        fontWeight: '800',
        color: '#ef4444',
        textAlign: 'center',
        flex: 1,
    },
    congratulateBtn: {
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 15,
        borderRadius: 16,
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
        fontSize: 16,
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
