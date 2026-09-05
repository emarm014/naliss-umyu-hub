import React, { useEffect, useRef } from 'react';
import { AppState, AppStateStatus, Animated, StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { supabase } from '../api/supabase/client';
import { useAuthStore } from '../stores/auth.store';
import { useThemeStore } from '../stores/theme.store';
import { create } from 'zustand';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

type AlertPayload = {
    pool_id: string;
    title: string;
    body: string;
    type: 'status_change' | 'time_extension' | 'winner_published';
};

interface HeartbeatState {
    activeAlert: AlertPayload | null;
    setActiveAlert: (alert: AlertPayload | null) => void;
}

export const useHeartbeatStore = create<HeartbeatState>((set) => ({
    activeAlert: null,
    setActiveAlert: (alert) => set({ activeAlert: alert })
}));

/**
 * useHeartbeat
 * 
 * Implements a 60-second REST heartbeat with random jitter to track user presence 
 * without maintaining continuous WebSocket connections.
 * This prevents server spikes (Thundering Herd problem) when thousands of students
 * are online simultaneously during Event Pools.
 */
export function useHeartbeat() {
    const sessionId = useAuthStore(state => state.session?.access_token);
    const userId = useAuthStore(state => state.user?.id);
    const appState = useRef(AppState.currentState);
    const setActiveAlert = useHeartbeatStore(state => state.setActiveAlert);

    useEffect(() => {
        if (!sessionId || !userId) return;

        let timeoutId: ReturnType<typeof setTimeout> | null = null;

        const stopPing = () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
        };

        const pingPresence = async () => {
            // Only ping if the app is active
            if (appState.current !== 'active') return;

            try {
                // Attempt to call RPC if it exists, otherwise fallback to profiles update
                const { data, error } = await supabase.rpc('update_last_seen');
                
                if (error) {
                    // Fallback to direct table update if RPC doesn't exist
                    await (supabase as any)
                        .from('users')
                        .update({ last_active_at: new Date().toISOString() })
                        .eq('id', userId);
                } else if (data && typeof data === 'object') {
                    if ('active_alert' in data) {
                        const alert = (data as any).active_alert;
                        if (alert) {
                            setActiveAlert(alert as AlertPayload);
                        }
                    }
                    if ('edited_messages' in data) {
                        const edited = (data as any).edited_messages;
                        if (Array.isArray(edited) && edited.length > 0) {
                            const { updateMessage } = require('../stores/message.store').useMessageStore.getState();
                            edited.forEach((msg: any) => {
                                updateMessage(msg.group_id, msg.id, { content: msg.content, edited_at: msg.edited_at });
                            });
                        }
                    }
                }
            } catch (err) {
                console.debug('Heartbeat ping failed, will retry next cycle', err);
            }

            if (appState.current === 'active') {
                // Schedule next ping in 60 seconds + up to 15 seconds of random jitter
                const nextTick = 60000 + Math.random() * 15000;
                timeoutId = setTimeout(pingPresence, nextTick);
            }
        };

        // Track app state to pause heartbeat when backgrounded
        const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
            const wasBackgrounded = appState.current.match(/inactive|background/);
            appState.current = nextAppState;
            
            if (wasBackgrounded && nextAppState === 'active') {
                // App has come to the foreground, trigger an immediate ping
                pingPresence();
            } else if (nextAppState === 'background' || nextAppState === 'inactive') {
                stopPing();
            }
        });

        // Start initial ping
        pingPresence();

        return () => {
            stopPing();
            subscription.remove();
        };
    }, [sessionId, userId, setActiveAlert]);
}

export function HeartbeatBanner() {
    const activeAlert = useHeartbeatStore(state => state.activeAlert);
    const setActiveAlert = useHeartbeatStore(state => state.setActiveAlert);
    const translateY = useRef(new Animated.Value(-150)).current;
    const { colors, isDark } = useThemeStore();

    useEffect(() => {
        if (activeAlert) {
            Animated.spring(translateY, {
                toValue: 0,
                useNativeDriver: true,
                tension: 40,
                friction: 5
            }).start();

            // Auto-hide after 8 seconds
            const t = setTimeout(() => hideBanner(), 8000);
            return () => clearTimeout(t);
        } else {
            Animated.timing(translateY, {
                toValue: -150,
                duration: 300,
                useNativeDriver: true
            }).start();
        }
    }, [activeAlert]);

    const hideBanner = () => {
        Animated.timing(translateY, {
            toValue: -150,
            duration: 300,
            useNativeDriver: true
        }).start(() => setActiveAlert(null));
    };

    const handlePress = () => {
        if (!activeAlert) return;
        hideBanner();
        router.push(`/event-pool/${activeAlert.pool_id}` as any);
    };

    if (!activeAlert) return null;

    return (
        <Animated.View style={[styles.container, { transform: [{ translateY }] }]}>
            <TouchableOpacity 
                style={[styles.banner, { backgroundColor: isDark ? '#064e3b' : '#ecfdf5', borderColor: colors.primary }]} 
                activeOpacity={0.8}
                onPress={handlePress}
            >
                <View style={[styles.iconContainer, { backgroundColor: colors.primary }]}>
                    <Ionicons name="notifications" size={20} color="#fff" />
                </View>
                <View style={styles.textContainer}>
                    <Text style={[styles.title, { color: colors.primary }]}>{activeAlert.title}</Text>
                    <Text style={[styles.body, { color: colors.textSecondary }]} numberOfLines={2}>{activeAlert.body}</Text>
                </View>
                <TouchableOpacity style={styles.closeButton} onPress={hideBanner}>
                    <Ionicons name="close" size={20} color={colors.textMuted} />
                </TouchableOpacity>
            </TouchableOpacity>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        top: 60, // Below status bar
        left: 16,
        right: 16,
        zIndex: 9999,
        elevation: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
    },
    banner: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        borderRadius: 16,
        borderWidth: 1,
    },
    iconContainer: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    textContainer: {
        flex: 1,
        marginRight: 8,
    },
    title: {
        fontSize: 15,
        fontWeight: '700',
        marginBottom: 2,
    },
    body: {
        fontSize: 13,
        lineHeight: 18,
    },
    closeButton: {
        padding: 4,
    }
});
