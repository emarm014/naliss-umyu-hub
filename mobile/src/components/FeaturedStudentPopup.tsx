import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Modal, Animated, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { supabase } from '../api/supabase/client';
import { useTheme } from '../stores/theme.store';
import { mmkvStorage } from '../stores/mmkv.storage';
import { useAuthStore } from '../stores/auth.store';

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

export function FeaturedStudentPopup() {
    const { colors, isDark } = useTheme();
    const { profile } = useAuthStore();
    
    const [feature, setFeature] = useState<FeaturedStudent | null>(null);
    const [isVisible, setIsVisible] = useState(false);
    const [hasCongratulated, setHasCongratulated] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    
    // Animation value for the popup
    const [scaleAnim] = useState(new Animated.Value(0.9));
    const [opacityAnim] = useState(new Animated.Value(0));

    useEffect(() => {
        // Only run if user is authenticated
        if (!profile) return;
        checkForActiveFeature();
    }, [profile]);

    const checkForActiveFeature = async () => {
        try {
            // Fetch the most recent active featured student
            const { data, error } = await supabase
                .from('featured_students')
                .select(`
                    id, user_id, type, title, subtitle, description, custom_image_url, total_congratulations,
                    users ( full_name, username, avatar_url, department_id )
                `)
                .eq('is_active', true)
                .order('published_at', { ascending: false })
                .limit(1)
                .single();

            if (error || !data) return;

            const currentFeature = data as any as FeaturedStudent;

            // Check if dismissed
            const dismissedKey = `dismissed_featured_${currentFeature.id}`;
            const isDismissed = await mmkvStorage.getItem(dismissedKey);
            
            if (!isDismissed) {
                // Check if already congratulated by this user locally
                const congratsKey = `congratulated_${currentFeature.id}`;
                const didCongratulate = await mmkvStorage.getItem(congratsKey);
                
                if (didCongratulate) setHasCongratulated(true);

                setFeature(currentFeature);
                setIsVisible(true);
                
                // Animate In
                Animated.parallel([
                    Animated.spring(scaleAnim, {
                        toValue: 1,
                        tension: 50,
                        friction: 7,
                        useNativeDriver: true
                    }),
                    Animated.timing(opacityAnim, {
                        toValue: 1,
                        duration: 300,
                        useNativeDriver: true
                    })
                ]).start();
            }
        } catch (e) {
            console.log('No active featured student or error fetching:', e);
        }
    };

    const handleDismiss = async () => {
        if (!feature) return;
        
        // Save dismissal to local storage so it doesn't pop up again
        await mmkvStorage.setItem(`dismissed_featured_${feature.id}`, 'true');
        
        // Animate Out
        Animated.parallel([
            Animated.timing(scaleAnim, {
                toValue: 0.9,
                duration: 200,
                useNativeDriver: true
            }),
            Animated.timing(opacityAnim, {
                toValue: 0,
                duration: 200,
                useNativeDriver: true
            })
        ]).start(() => {
            setIsVisible(false);
        });
    };

    const handleCongratulate = async () => {
        if (!feature || hasCongratulated || isSubmitting) return;
        
        setIsSubmitting(true);
        try {
            // Call Supabase RPC to atomically increment congratulations
            const { error } = await supabase.rpc('congratulate_student', {
                p_featured_id: feature.id
            });
            
            if (error) {
                if (error.message.includes('already congratulated')) {
                    // Unique violation, means they already did it on another device
                } else {
                    throw error;
                }
            }

            // Success
            setHasCongratulated(true);
            await mmkvStorage.setItem(`congratulated_${feature.id}`, 'true');
            
            // Optimistically update the UI count
            setFeature(prev => prev ? { ...prev, total_congratulations: prev.total_congratulations + 1 } : null);

        } catch (error) {
            console.error('Failed to congratulate:', error);
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!isVisible || !feature) return null;

    const bgImage = feature.custom_image_url || feature.users.avatar_url;
    
    // Determine theme colors based on type
    const getBadgeConfig = () => {
        switch (feature.type) {
            case 'legend_of_the_month':
                return { color: '#a855f7', icon: 'medal', text: 'Legend of the Month' };
            case 'event_winner':
                return { color: '#10b981', icon: 'trophy', text: 'Event Winner' };
            case 'student_of_the_week':
            default:
                return { color: '#f59e0b', icon: 'star', text: 'Student of the Week' };
        }
    };
    
    const badge = getBadgeConfig();

    return (
        <Modal transparent visible={isVisible} animationType="none">
            <BlurView intensity={isDark ? 50 : 30} style={styles.overlay} tint={isDark ? 'dark' : 'light'}>
                <Animated.View 
                    style={[
                        styles.popupContainer, 
                        { backgroundColor: colors.card, borderColor: colors.border },
                        { opacity: opacityAnim, transform: [{ scale: scaleAnim }] }
                    ]}
                >
                    {/* Header Image Area */}
                    <View style={styles.imageHeader}>
                        {bgImage ? (
                            <Image source={{ uri: bgImage }} style={styles.coverImage} resizeMode="cover" />
                        ) : (
                            <View style={[styles.coverImage, { backgroundColor: badge.color, opacity: 0.1 }]} />
                        )}
                        
                        <View style={styles.imageOverlay}>
                            <View style={[styles.badge, { backgroundColor: badge.color }]}>
                                <Ionicons name={badge.icon as any} size={14} color="#fff" />
                                <Text style={styles.badgeText}>{badge.text}</Text>
                            </View>
                            
                            {/* Congratulations Count */}
                            <View style={styles.congratsCountBadge}>
                                <Ionicons name="heart" size={14} color="#ef4444" />
                                <Text style={styles.congratsCountText}>{feature.total_congratulations}</Text>
                            </View>
                        </View>
                    </View>

                    {/* Content Area */}
                    <View style={styles.content}>
                        <Text style={[styles.mainTitle, { color: colors.text }]} numberOfLines={2}>
                            {feature.title}
                        </Text>
                        
                        <Text style={[styles.studentName, { color: badge.color }]} numberOfLines={1}>
                            {feature.users.full_name}
                        </Text>

                        {feature.subtitle && (
                            <Text style={[styles.subtitle, { color: colors.textMuted }]} numberOfLines={1}>
                                {feature.subtitle}
                            </Text>
                        )}

                        {feature.description && (
                            <Text style={[styles.description, { color: colors.text }]} numberOfLines={3}>
                                "{feature.description}"
                            </Text>
                        )}
                    </View>

                    {/* Action Area */}
                    <View style={[styles.actions, { borderTopColor: colors.border }]}>
                        <TouchableOpacity 
                            style={[
                                styles.congratulateBtn, 
                                hasCongratulated ? styles.congratulateBtnDone : { backgroundColor: badge.color }
                            ]} 
                            onPress={handleCongratulate}
                            disabled={hasCongratulated || isSubmitting}
                        >
                            {isSubmitting ? (
                                <Text style={styles.btnText}>Sending...</Text>
                            ) : (
                                <>
                                    <Ionicons 
                                        name={hasCongratulated ? "heart" : "heart-outline"} 
                                        size={20} 
                                        color={hasCongratulated ? badge.color : "#fff"} 
                                    />
                                    <Text style={[styles.btnText, hasCongratulated && { color: badge.color }]}>
                                        {hasCongratulated ? 'Congratulated! 🎉' : 'Congratulate'}
                                    </Text>
                                </>
                            )}
                        </TouchableOpacity>

                        <TouchableOpacity style={styles.dismissBtn} onPress={handleDismiss}>
                            <Text style={[styles.dismissBtnText, { color: colors.textMuted }]}>
                                Stop seeing this
                            </Text>
                        </TouchableOpacity>
                    </View>
                </Animated.View>
            </BlurView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.4)',
        padding: 24,
    },
    popupContainer: {
        width: '100%',
        maxWidth: 400,
        borderRadius: 24,
        overflow: 'hidden',
        borderWidth: 1,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.25,
        shadowRadius: 20,
        elevation: 10,
    },
    imageHeader: {
        height: 220,
        width: '100%',
        position: 'relative',
        backgroundColor: '#f3f4f6',
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
        backgroundColor: 'rgba(0,0,0,0.1)',
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
        shadowOpacity: 0.2,
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
        alignSelf: 'flex-end',
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.95)',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 20,
        gap: 6,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
    },
    congratsCountText: {
        fontSize: 14,
        fontWeight: '800',
        color: '#ef4444',
    },
    content: {
        padding: 24,
        paddingBottom: 20,
        alignItems: 'center',
    },
    mainTitle: {
        fontSize: 22,
        fontWeight: '800',
        textAlign: 'center',
        marginBottom: 8,
        lineHeight: 28,
    },
    studentName: {
        fontSize: 20,
        fontWeight: '900',
        textAlign: 'center',
        marginBottom: 4,
    },
    subtitle: {
        fontSize: 14,
        fontWeight: '600',
        textAlign: 'center',
        marginBottom: 16,
    },
    description: {
        fontSize: 15,
        textAlign: 'center',
        lineHeight: 22,
        fontStyle: 'italic',
    },
    actions: {
        padding: 24,
        paddingTop: 0,
        gap: 12,
        alignItems: 'center',
    },
    congratulateBtn: {
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 16,
        borderRadius: 16,
        gap: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
    },
    congratulateBtnDone: {
        backgroundColor: 'transparent',
        borderWidth: 2,
        borderColor: 'rgba(0,0,0,0.1)',
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
        fontWeight: '600',
    }
});
