import React, { useEffect, useRef, useState } from 'react';
import {
    View,
    Modal,
    StyleSheet,
    Animated,
    TouchableWithoutFeedback,
    KeyboardAvoidingView,
    Platform,
    useColorScheme,
    ViewStyle,
    StyleProp,
    ActivityIndicator
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../../../constants/Colors';
import { Ionicons } from '@expo/vector-icons';
import { Text } from 'react-native';
import { TouchableOpacity } from 'react-native';

export type OverlaySize = 'small' | 'medium' | 'large' | 'fullscreen';
export type OverlayAnimation = 'fade' | 'slide-up' | 'scale';

const SIZE_MAP: Record<OverlaySize, any> = {
    small: 300,
    medium: 400,
    large: 600,
    fullscreen: '100%',
};

export interface SafeOverlayProps {
    visible: boolean;
    onClose?: () => void;
    onShow?: () => void;
    children: React.ReactNode;
    animationType?: OverlayAnimation;
    dismissible?: boolean;
    overlayStyle?: StyleProp<ViewStyle>;
}

/**
 * Low-level wrapper providing the dark backdrop, standard animations, and tap-to-dismiss behavior.
 * Wraps everything in a React Native Modal for declarative use, but can also be used globally.
 */
export const SafeOverlayContainer = ({
    visible,
    onClose,
    onShow,
    children,
    animationType = 'fade',
    dismissible = true,
    overlayStyle
}: SafeOverlayProps) => {
    const opacity = useRef(new Animated.Value(0)).current;
    const translateY = useRef(new Animated.Value(100)).current;
    const scale = useRef(new Animated.Value(0.9)).current;

    const [isRendered, setIsRendered] = useState(visible);

    useEffect(() => {
        if (visible) {
            setIsRendered(true);
            Animated.parallel([
                Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
                Animated.timing(translateY, { toValue: 0, duration: 250, useNativeDriver: true }),
                Animated.spring(scale, { toValue: 1, friction: 8, tension: 100, useNativeDriver: true })
            ]).start();
        } else {
            Animated.parallel([
                Animated.timing(opacity, { toValue: 0, duration: 150, useNativeDriver: true }),
                Animated.timing(translateY, { toValue: 100, duration: 200, useNativeDriver: true }),
                Animated.timing(scale, { toValue: 0.9, duration: 150, useNativeDriver: true })
            ]).start(() => {
                setIsRendered(false);
            });
        }
    }, [visible]);

    if (!isRendered && !visible) return null;

    const getAnimatedStyle = () => {
        switch (animationType) {
            case 'slide-up': return { opacity, transform: [{ translateY }] };
            case 'scale': return { opacity, transform: [{ scale }] };
            case 'fade':
            default: return { opacity };
        }
    };

    return (
        <Modal
            transparent
            visible={isRendered}
            onShow={onShow}
            onRequestClose={() => {
                if (dismissible && onClose) onClose();
            }}
            animationType="none"
        >
            <View style={styles.container} accessibilityViewIsModal>
                <TouchableWithoutFeedback onPress={() => { if (dismissible && onClose) onClose(); }}>
                    <Animated.View style={[styles.backdrop, { opacity }]} />
                </TouchableWithoutFeedback>
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    style={[styles.keyboardView, overlayStyle]}
                    pointerEvents="box-none"
                >
                    <Animated.View style={[styles.contentWrapper, getAnimatedStyle()]} pointerEvents="box-none">
                        {children}
                    </Animated.View>
                </KeyboardAvoidingView>
            </View>
        </Modal>
    );
};

export interface SafeModalProps extends SafeOverlayProps {
    size?: OverlaySize;
    contentStyle?: StyleProp<ViewStyle>;
}

/**
 * Centered modal, handles tablet sizing with standard presets, keyboard avoidance.
 */
export const SafeModal = ({ size = 'medium', contentStyle, children, ...props }: SafeModalProps) => {
    const isDark = useColorScheme() === 'dark';
    const maxWidth = SIZE_MAP[size];

    return (
        <SafeOverlayContainer {...props} animationType={props.animationType || 'scale'} overlayStyle={{ justifyContent: 'center' }}>
            <View style={[
                styles.modalContent,
                { backgroundColor: isDark ? '#1e293b' : '#ffffff', width: '100%', maxWidth, alignSelf: 'center' },
                contentStyle
            ]}>
                {children}
            </View>
        </SafeOverlayContainer>
    );
};

/**
 * Bottom anchored sheet, dynamic bottom padding based on safe area.
 */
export const SafeBottomSheet = ({ size = 'fullscreen', contentStyle, children, ...props }: SafeModalProps) => {
    const isDark = useColorScheme() === 'dark';
    const insets = useSafeAreaInsets();
    const maxWidth = SIZE_MAP[size];

    return (
        <SafeOverlayContainer {...props} animationType={props.animationType || 'slide-up'} overlayStyle={{ justifyContent: 'flex-end' }}>
            <View style={[
                styles.sheetContent,
                { 
                    backgroundColor: isDark ? '#1e293b' : '#ffffff',
                    width: '100%',
                    maxWidth,
                    alignSelf: 'center',
                    paddingBottom: Math.max(insets.bottom, 16)
                },
                contentStyle
            ]}>
                {children}
            </View>
        </SafeOverlayContainer>
    );
};

export interface SafeDialogProps extends SafeModalProps {
    title: string;
    message?: string;
    type?: 'confirm' | 'warning' | 'success' | 'permission';
    confirmText?: string;
    cancelText?: string;
    onConfirm: () => void;
    onCancel?: () => void;
}

/**
 * Highly constrained variant of SafeModal specifically designed for Dialogs.
 */
export const SafeDialog = ({ 
    title, message, type = 'confirm', 
    confirmText = 'Confirm', cancelText = 'Cancel', 
    onConfirm, onCancel, ...props 
}: SafeDialogProps) => {
    const isDark = useColorScheme() === 'dark';
    const getIcon = () => {
        switch(type) {
            case 'warning': return <Ionicons name="warning" size={32} color="#f59e0b" />;
            case 'success': return <Ionicons name="checkmark-circle" size={32} color="#10b981" />;
            case 'permission': return <Ionicons name="shield-checkmark" size={32} color="#3b82f6" />;
            case 'confirm':
            default: return <Ionicons name="help-circle" size={32} color={COLORS.primary} />;
        }
    };

    return (
        <SafeModal {...props} size="small" onClose={onCancel}>
            <View style={{ padding: 24, alignItems: 'center' }}>
                <View style={{ marginBottom: 16 }}>{getIcon()}</View>
                <Text style={{ fontSize: 18, fontFamily: 'Inter-Bold', color: isDark ? '#fff' : '#0f172a', textAlign: 'center', marginBottom: 8 }}>
                    {title}
                </Text>
                {message && (
                    <Text style={{ fontSize: 14, fontFamily: 'Inter-Regular', color: isDark ? '#94a3b8' : '#64748b', textAlign: 'center', marginBottom: 24 }}>
                        {message}
                    </Text>
                )}
                
                <View style={{ flexDirection: 'row', gap: 12, width: '100%' }}>
                    {(onCancel || props.dismissible !== false) && (
                        <TouchableOpacity 
                            style={{ flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: isDark ? '#334155' : '#f1f5f9', alignItems: 'center' }} 
                            onPress={onCancel || props.onClose}
                        >
                            <Text style={{ fontFamily: 'Inter-SemiBold', color: isDark ? '#fff' : '#475569' }}>{cancelText}</Text>
                        </TouchableOpacity>
                    )}
                    <TouchableOpacity 
                        style={{ flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: type === 'warning' ? '#ef4444' : COLORS.primary, alignItems: 'center' }} 
                        onPress={onConfirm}
                    >
                        <Text style={{ fontFamily: 'Inter-SemiBold', color: '#fff' }}>{confirmText}</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </SafeModal>
    );
};

export interface SafeAsyncContentProps {
    isLoading: boolean;
    error: Error | string | null;
    isSuccess?: boolean;
    successMessage?: string;
    onRetry?: () => void;
    onClose?: () => void;
    children: React.ReactNode;
}

/**
 * Standardized container to handle async loading, error reporting (with retry), and success feedback in overlays.
 */
export const SafeAsyncContent = ({
    isLoading,
    error,
    isSuccess,
    successMessage = 'Operation Completed Successfully!',
    onRetry,
    onClose,
    children
}: SafeAsyncContentProps) => {
    const isDark = useColorScheme() === 'dark';
    
    if (isLoading) {
        return (
            <View style={{ padding: 32, alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator size="large" color={COLORS.primary} />
                <Text style={{ marginTop: 16, fontFamily: 'Inter-Medium', color: isDark ? '#94a3b8' : '#64748b' }}>
                    Processing request...
                </Text>
            </View>
        );
    }

    if (error) {
        return (
            <View style={{ padding: 24, alignItems: 'center' }}>
                <Ionicons name="alert-circle" size={48} color="#ef4444" style={{ marginBottom: 16 }} />
                <Text style={{ fontSize: 16, fontFamily: 'Inter-Bold', color: isDark ? '#fff' : '#0f172a', textAlign: 'center', marginBottom: 8 }}>
                    Operation Failed
                </Text>
                <Text style={{ fontSize: 14, fontFamily: 'Inter-Regular', color: isDark ? '#94a3b8' : '#64748b', textAlign: 'center', marginBottom: 24 }}>
                    {typeof error === 'string' ? error : error.message}
                </Text>
                <View style={{ flexDirection: 'row', gap: 12, width: '100%' }}>
                    {onClose && (
                        <TouchableOpacity 
                            style={{ flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: isDark ? '#334155' : '#f1f5f9', alignItems: 'center' }} 
                            onPress={onClose}
                        >
                            <Text style={{ fontFamily: 'Inter-SemiBold', color: isDark ? '#fff' : '#475569' }}>Close</Text>
                        </TouchableOpacity>
                    )}
                    {onRetry && (
                        <TouchableOpacity 
                            style={{ flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: COLORS.primary, alignItems: 'center' }} 
                            onPress={onRetry}
                        >
                            <Text style={{ fontFamily: 'Inter-SemiBold', color: '#fff' }}>Retry</Text>
                        </TouchableOpacity>
                    )}
                </View>
            </View>
        );
    }

    if (isSuccess) {
        return (
            <View style={{ padding: 24, alignItems: 'center' }}>
                <Ionicons name="checkmark-circle" size={48} color="#10b981" style={{ marginBottom: 16 }} />
                <Text style={{ fontSize: 16, fontFamily: 'Inter-Bold', color: isDark ? '#fff' : '#0f172a', textAlign: 'center', marginBottom: 8 }}>
                    Success
                </Text>
                <Text style={{ fontSize: 14, fontFamily: 'Inter-Regular', color: isDark ? '#94a3b8' : '#64748b', textAlign: 'center', marginBottom: 24 }}>
                    {successMessage}
                </Text>
                {onClose && (
                    <TouchableOpacity 
                        style={{ width: '100%', paddingVertical: 12, borderRadius: 8, backgroundColor: COLORS.primary, alignItems: 'center' }} 
                        onPress={onClose}
                    >
                        <Text style={{ fontFamily: 'Inter-SemiBold', color: '#fff' }}>Continue</Text>
                    </TouchableOpacity>
                )}
            </View>
        );
    }

    return <>{children}</>;
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
    },
    keyboardView: {
        flex: 1,
    },
    contentWrapper: {
        width: '100%',
        maxHeight: '100%',
    },
    modalContent: {
        borderRadius: 16,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.1,
        shadowRadius: 20,
        elevation: 10,
        margin: 20,
    },
    sheetContent: {
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -5 },
        shadowOpacity: 0.1,
        shadowRadius: 10,
        elevation: 10,
    }
});
