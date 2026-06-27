import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, Platform } from 'react-native';
import { useOverlayStore } from '../../../stores/overlay.store';
import { useThemeStore } from '../../../stores/theme.store';

interface GlobalToastProps {
    id: string;
    message: string;
}

export function GlobalToast({ id, message }: GlobalToastProps) {
    const opacity = useRef(new Animated.Value(0)).current;
    const hideOverlay = useOverlayStore(s => s.hideOverlay);
    const { isDark } = useThemeStore();

    useEffect(() => {
        // Fade in
        Animated.timing(opacity, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
        }).start();

        // Auto-dismiss after 2 seconds
        const timer = setTimeout(() => {
            Animated.timing(opacity, {
                toValue: 0,
                duration: 200,
                useNativeDriver: true,
            }).start(() => {
                hideOverlay(id);
            });
        }, 2000);

        return () => clearTimeout(timer);
    }, [id, opacity, hideOverlay]);

    return (
        <Animated.View style={[
            styles.container,
            { 
                backgroundColor: isDark ? 'rgba(30, 41, 59, 0.95)' : 'rgba(15, 23, 42, 0.95)',
                opacity 
            }
        ]}>
            <Text style={styles.text}>{message}</Text>
        </Animated.View>
    );
}

export function showToast(message: string) {
    const id = `toast_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    useOverlayStore.getState().showOverlay({
        id,
        priority: 'Low',
        component: <GlobalToast id={id} message={message} />
    });
}

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        bottom: Platform.OS === 'ios' ? 100 : 70,
        alignSelf: 'center',
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 24,
        zIndex: 99999,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 6,
        elevation: 6,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        maxWidth: '85%',
    },
    text: {
        color: '#ffffff',
        fontWeight: '600',
        fontSize: 14,
        textAlign: 'center',
    },
});
