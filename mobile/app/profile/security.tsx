import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Alert, Switch, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/stores/theme.store';
import { useAuthStore } from '../../src/stores';
import { COLORS } from '../../src/constants/Colors';
import { supabase } from '../../src/api/supabase/client';
import { captureUIError } from '../../src/utils/sentry';
import { showToast } from '../../src/components/common/overlays';

export default function SecuritySettingsScreen() {
    const router = useRouter();
    const { colors, isDark } = useTheme();
    const storeProfile = useAuthStore(s => s.profile);

    // Password State
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPasswordVisible, setShowPasswordVisible] = useState(false);
    const [isChangingPassword, setIsChangingPassword] = useState(false);

    // Sessions State
    const [deviceSessions, setDeviceSessions] = useState<any[]>([]);
    const [isLoadingSessions, setIsLoadingSessions] = useState(false);
    const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
    const [includeCurrentDevice, setIncludeCurrentDevice] = useState(false);
    const [isRevokingSessions, setIsRevokingSessions] = useState(false);
    const [sessionToTerminate, setSessionToTerminate] = useState<any | null>(null);
    const [confirmPasswordInput, setConfirmPasswordInput] = useState('');
    const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
    const [showConfirmPasswordVisible, setShowConfirmPasswordVisible] = useState(false);
    const [isVerifyingPassword, setIsVerifyingPassword] = useState(false);

    useEffect(() => {
        const init = async () => {
            try {
                const { getOrCreateDeviceId } = require('../../src/utils/device');
                const id = await getOrCreateDeviceId();
                setCurrentDeviceId(id);
                fetchDeviceSessions(id);
            } catch (err) {
                console.error('Failed to load device ID in security:', err);
            }
        };
        init();
    }, []);

    const fetchDeviceSessions = async (deviceId?: string) => {
        setIsLoadingSessions(true);
        try {
            const { data, error } = await (supabase
                .from('user_sessions')
                .select('device_id, device_name, os, ip_address, is_active, last_active_at') as any)
                .eq('is_active', true)
                .order('last_active_at', { ascending: false });
            
            if (error) throw error;
            if (data) {
                // Map the data to add 'is_current' flag based on the deviceId
                const mappedSessions = data.map((session: any) => ({
                    ...session,
                    is_current: session.device_id === (deviceId || currentDeviceId)
                }));
                setDeviceSessions(mappedSessions);
            }
        } catch (err) {
            console.error('Failed to fetch sessions:', err);
        } finally {
            setIsLoadingSessions(false);
        }
    };

    // --- PASSWORD LOGIC ---
    const handleUpdatePassword = async () => {
        if (!newPassword || newPassword.length < 6) {
            Alert.alert('Invalid Password', 'Password must be at least 6 characters long.');
            return;
        }
        if (newPassword !== confirmPassword) {
            Alert.alert('Mismatch', 'New password and confirm password do not match.');
            return;
        }

        setIsChangingPassword(true);
        try {
            const { error } = await supabase.auth.updateUser({
                password: newPassword,
            });

            if (error) throw error;

            Alert.alert('Success', 'Your password has been successfully updated.');
            setNewPassword('');
            setConfirmPassword('');
        } catch (err: any) {
            const rawMsg = err?.message || err?.value || err?.msg || err?.error_description || '';
            const msg = rawMsg.toLowerCase();
            if (msg.includes('same password') || msg.includes('different from')) {
                showToast('New password should be different from the old password.');
            } else if (msg.includes('weak') || msg.includes('strength')) {
                showToast('Please choose a stronger password.');
            } else if (msg.includes('session') || msg.includes('expired') || msg.includes('jwt')) {
                Alert.alert('Session Expired', 'Your session has expired. Please sign out and sign in again.');
            } else if (msg.includes('fetch') || msg.includes('network') || msg.includes('connection')) {
                showToast('Could not reach the server. Please check your connection.');
            } else {
                showToast(`Could not update password: ${rawMsg || 'Please try again.'}`);
            }
        } finally {
            setIsChangingPassword(false);
        }
    };

    // --- SESSIONS LOGIC ---
    const handleRevokeAllSessions = async () => {
        Alert.alert('Confirm Logout', 'Do you want to log out of all active sessions?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Logout All', style: 'destructive', onPress: async () => {
                    setIsRevokingSessions(true);
                    try {
                        if (!storeProfile?.id) return;
                        if (includeCurrentDevice) {
                            await (supabase.from('user_sessions').delete() as any).eq('user_id', storeProfile.id);
                            await supabase.auth.signOut({ scope: 'global' } as any).catch(() => supabase.auth.signOut());
                            useAuthStore.getState().setSession(null);
                            useAuthStore.getState().setUser(null);
                            useAuthStore.getState().setIsProfileComplete(null);
                            useAuthStore.getState().setProfile(null);
                            router.replace('/auth/login' as any);
                        } else {
                            await (supabase.from('user_sessions') as any).update({ is_active: false }).eq('user_id', storeProfile.id).neq('device_id', currentDeviceId as string);
                        }
                        fetchDeviceSessions();
                        // Note: Assuming showToast implementation or replace with Alert
                        Alert.alert('Success', 'Sessions revoked successfully.');
                    } catch (err: any) {
                        captureUIError('SecurityScreen.handleRevokeAllSessions', err);
                        Alert.alert('Error', 'Failed to revoke sessions. Please try again.');
                    } finally {
                        setIsRevokingSessions(false);
                    }
                }
            }
        ]);
    };

    const handleRevokeSingleSession = async () => {
        if (!sessionToTerminate) return;
        if (sessionToTerminate.is_current) {
            Alert.alert('Error', 'Cannot revoke current session this way. Use the main log out option.');
            return;
        }

        try {
            if (!storeProfile?.id) return;
            await (supabase.from('user_sessions') as any).update({ is_active: false }).eq('device_id', sessionToTerminate.device_id).eq('user_id', storeProfile.id);
            setDeviceSessions(prev => prev.filter(s => s.device_id !== sessionToTerminate.device_id));
            setSessionToTerminate(null);
            Alert.alert('Success', 'Session revoked successfully.');
        } catch (err) {
            console.error('Failed to revoke single session:', err);
            Alert.alert('Error', 'Failed to revoke session. Please try again.');
        }
    };

    const handleConfirmTerminateSession = async () => {
        if (!sessionToTerminate) return;
        if (!confirmPasswordInput) {
            Alert.alert('Required', 'Please enter your password to confirm.');
            return;
        }

        setIsVerifyingPassword(true);
        try {
            const { verifyPassword } = require('../../src/utils/device');
            const isValid = await verifyPassword(confirmPasswordInput);
            if (!isValid) {
                Alert.alert('Authentication Failed', 'The password you entered is incorrect.');
                return;
            }

            if (isValid) {
                // Terminating specific session manually is not natively supported via Supabase Auth client SDK without a custom table
                // We will just fall through and simulate it for the current device if matched
            }

            if (sessionToTerminate.device_id === currentDeviceId) {
                setConfirmPasswordVisible(false);
                await supabase.auth.signOut();
                useAuthStore.getState().setSession(null);
                useAuthStore.getState().setUser(null);
                useAuthStore.getState().setIsProfileComplete(null);
                useAuthStore.getState().setProfile(null);
                router.replace('/auth/login');
                Alert.alert('Logged Out', 'This device session has been terminated.');
            } else {
                await (supabase.from('user_sessions') as any).update({ is_active: false })
                    .eq('device_id', sessionToTerminate.device_id)
                    .eq('user_id', storeProfile?.id);
                setDeviceSessions(prev => prev.filter(s => s.device_id !== sessionToTerminate.device_id));
                setSessionToTerminate(null);
                setConfirmPasswordVisible(false);
                setConfirmPasswordInput('');
                Alert.alert('Device Removed', 'That device has been signed out remotely.');
            }
        } catch (err: any) {
            Alert.alert('Error', err.message || 'Failed to terminate session. Please try again.');
        } finally {
            setIsVerifyingPassword(false);
        }
    };

    const formatSessionTime = (dateStr: string) => {
        try {
            const date = new Date(dateStr);
            return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' at ' + date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        } catch {
            return dateStr;
        }
    };

    const getDeviceIcon = (os: string) => {
        const lower = (os || '').toLowerCase();
        if (lower.includes('android')) return 'logo-android';
        if (lower.includes('ios') || lower.includes('apple') || lower.includes('mac')) return 'logo-apple';
        return 'desktop-outline';
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
            <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
                <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                    <Ionicons name="arrow-back" size={24} color={colors.text} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: colors.text }]}>Security</Text>
                <View style={{ width: 32 }} />
            </View>

            <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
                <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                    
                    {/* Password Section */}
                    <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>CHANGE PASSWORD</Text>
                    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <View style={{ padding: 16 }}>
                            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>New Password</Text>
                            <View style={{ position: 'relative', marginBottom: 12 }}>
                                <TextInput
                                    style={[styles.textInput, { backgroundColor: isDark ? '#1e293b' : '#f8fafc', color: colors.text, borderColor: colors.border, paddingRight: 48 }]}
                                    value={newPassword}
                                    onChangeText={setNewPassword}
                                    placeholder="At least 6 characters"
                                    placeholderTextColor={colors.textMuted}
                                    secureTextEntry={!showPasswordVisible}
                                    autoCapitalize="none"
                                />
                                <TouchableOpacity onPress={() => setShowPasswordVisible(v => !v)} style={{ position: 'absolute', right: 14, top: 0, bottom: 0, justifyContent: 'center' }}>
                                    <Ionicons name={showPasswordVisible ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textMuted} />
                                </TouchableOpacity>
                            </View>

                            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Confirm New Password</Text>
                            <View style={{ position: 'relative', marginBottom: 16 }}>
                                <TextInput
                                    style={[styles.textInput, { backgroundColor: isDark ? '#1e293b' : '#f8fafc', color: colors.text, borderColor: confirmPassword.length > 0 ? (confirmPassword === newPassword ? '#16a34a' : '#ef4444') : colors.border, paddingRight: 48 }]}
                                    value={confirmPassword}
                                    onChangeText={setConfirmPassword}
                                    placeholder="Re-enter your password"
                                    placeholderTextColor={colors.textMuted}
                                    secureTextEntry={!showPasswordVisible}
                                    autoCapitalize="none"
                                />
                                {confirmPassword.length > 0 && (
                                    <View style={{ position: 'absolute', right: 14, top: 0, bottom: 0, justifyContent: 'center' }}>
                                        <Ionicons name={confirmPassword === newPassword ? 'checkmark-circle' : 'close-circle'} size={20} color={confirmPassword === newPassword ? '#16a34a' : '#ef4444'} />
                                    </View>
                                )}
                            </View>
                            <TouchableOpacity style={styles.saveButton} onPress={handleUpdatePassword} disabled={isChangingPassword}>
                                {isChangingPassword ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveButtonText}>Update Password</Text>}
                            </TouchableOpacity>
                        </View>
                    </View>

                    {/* Sessions Section */}
                    <Text style={[styles.sectionTitle, { color: colors.textMuted, marginTop: 24 }]}>DEVICE SESSIONS</Text>
                    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, padding: 16 }]}>
                        {isLoadingSessions ? (
                            <ActivityIndicator size="small" color={COLORS.primary} style={{ marginVertical: 20 }} />
                        ) : deviceSessions.length === 0 ? (
                            <Text style={{ textAlign: 'center', color: colors.textMuted, marginVertical: 20 }}>No active sessions.</Text>
                        ) : (
                            deviceSessions.map((sessionItem, index) => {
                                const isCurrent = sessionItem.device_id === currentDeviceId;
                                const isActive = sessionItem.is_active;
                                return (
                                    <View key={sessionItem.id} style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 }, index < deviceSessions.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.divider }]}>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                                            <View style={[styles.sessionIconBg, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#f1f5f9' }]}>
                                                <Ionicons name={getDeviceIcon(sessionItem.os)} size={22} color={isDark ? '#cbd5e1' : '#475569'} />
                                            </View>
                                            <View style={{ flex: 1, marginLeft: 12, marginRight: 12 }}>
                                                <Text style={{ fontFamily: 'Inter-SemiBold', color: colors.text, fontSize: 14 }} numberOfLines={1}>{sessionItem.device_name}</Text>
                                                <Text style={{ fontFamily: 'Inter-Regular', color: colors.textMuted, fontSize: 12, marginTop: 2 }}>{formatSessionTime(sessionItem.last_active_at)}</Text>
                                                {isCurrent && (
                                                    <View style={{ alignSelf: 'flex-start', marginTop: 4, backgroundColor: 'rgba(5, 150, 105, 0.15)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                                                        <Text style={{ fontSize: 10, fontFamily: 'Inter-Medium', color: '#059669' }}>This Device</Text>
                                                    </View>
                                                )}
                                            </View>
                                        </View>
                                        {isActive && (
                                            <TouchableOpacity onPress={() => { setSessionToTerminate(sessionItem); setConfirmPasswordInput(''); setConfirmPasswordVisible(true); }} style={{ padding: 8 }}>
                                                <Ionicons name="trash-outline" size={20} color="#ef4444" />
                                            </TouchableOpacity>
                                        )}
                                    </View>
                                );
                            })
                        )}
                        <TouchableOpacity style={{ marginTop: 16, backgroundColor: '#fef2f2', padding: 12, borderRadius: 8, alignItems: 'center' }} onPress={handleRevokeAllSessions} disabled={isRevokingSessions}>
                            {isRevokingSessions ? <ActivityIndicator size="small" color="#ef4444" /> : <Text style={{ fontFamily: 'Inter-SemiBold', color: '#ef4444', fontSize: 14 }}>Log Out of All Devices</Text>}
                        </TouchableOpacity>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
                            <Text style={{ fontFamily: 'Inter-Medium', color: colors.textSecondary, fontSize: 13 }}>Include this device</Text>
                            <Switch value={includeCurrentDevice} onValueChange={setIncludeCurrentDevice} trackColor={{ false: '#94a3b8', true: '#ef4444' }} />
                        </View>
                    </View>
                    
                    <View style={{ marginTop: 32, marginBottom: 20 }}>
                        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>DANGER ZONE</Text>
                        <View style={[styles.card, { borderColor: '#fef2f2', backgroundColor: isDark ? 'rgba(239, 68, 68, 0.05)' : '#fff5f5' }]}>
                            <TouchableOpacity style={{ padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }} onPress={() => router.push('/profile/delete-account' as any)}>
                                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                    <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(239, 68, 68, 0.1)', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                                        <Ionicons name="warning-outline" size={18} color="#ef4444" />
                                    </View>
                                    <Text style={{ fontFamily: 'Inter-SemiBold', color: '#ef4444', fontSize: 15 }}>Delete Account</Text>
                                </View>
                                <Ionicons name="chevron-forward" size={20} color="#ef4444" />
                            </TouchableOpacity>
                        </View>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>

            {/* Password Confirm for Revoke specific session */}
            {confirmPasswordVisible && (
                <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 }]}>
                    <View style={{ backgroundColor: colors.card, borderRadius: 16, width: '100%', padding: 20, borderWidth: 1, borderColor: colors.border }}>
                        <Text style={{ fontFamily: 'Inter-Bold', fontSize: 18, color: colors.text, marginBottom: 12 }}>Confirm Session Logout</Text>
                        <Text style={{ fontFamily: 'Inter-Regular', fontSize: 14, color: colors.textSecondary, marginBottom: 16 }}>Please enter your password to confirm session termination for {sessionToTerminate?.device_name}.</Text>
                        
                        <View style={{ position: 'relative', marginBottom: 20 }}>
                            <TextInput
                                style={[styles.textInput, { backgroundColor: isDark ? '#1e293b' : '#f8fafc', color: colors.text, borderColor: colors.border, paddingRight: 48 }]}
                                value={confirmPasswordInput}
                                onChangeText={setConfirmPasswordInput}
                                placeholder="Enter password"
                                placeholderTextColor={colors.textMuted}
                                secureTextEntry={!showConfirmPasswordVisible}
                                autoCapitalize="none"
                            />
                            <TouchableOpacity onPress={() => setShowConfirmPasswordVisible(v => !v)} style={{ position: 'absolute', right: 14, top: 0, bottom: 0, justifyContent: 'center' }}>
                                <Ionicons name={showConfirmPasswordVisible ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textMuted} />
                            </TouchableOpacity>
                        </View>
                        
                        <View style={{ flexDirection: 'row', gap: 12 }}>
                            <TouchableOpacity style={{ flex: 1, padding: 12, borderRadius: 10, backgroundColor: colors.surface, alignItems: 'center' }} onPress={() => setConfirmPasswordVisible(false)}>
                                <Text style={{ fontFamily: 'Inter-Medium', color: colors.text }}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={{ flex: 1, padding: 12, borderRadius: 10, backgroundColor: COLORS.error, alignItems: 'center' }} onPress={handleConfirmTerminateSession} disabled={isVerifyingPassword}>
                                {isVerifyingPassword ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={{ fontFamily: 'Inter-SemiBold', color: '#FFF' }}>Confirm</Text>}
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
    backButton: { padding: 4 },
    headerTitle: { fontSize: 18, fontWeight: 'bold' },
    scrollContent: { padding: 16, paddingBottom: 40 },
    sectionTitle: { fontFamily: 'Inter-Bold', fontSize: 12, letterSpacing: 0.8, marginBottom: 12, marginLeft: 4, marginTop: 8 },
    card: { borderRadius: 20, borderWidth: 1, overflow: 'hidden' },
    securityInfoCard: { flexDirection: 'row', backgroundColor: 'rgba(5, 150, 105, 0.1)', padding: 12, borderRadius: 12, alignItems: 'center', marginBottom: 16 },
    securityInfoText: { flex: 1, marginLeft: 12, fontFamily: 'Inter-Medium', fontSize: 13, lineHeight: 18 },
    saveButton: { backgroundColor: COLORS.primary, paddingVertical: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    saveButtonText: { color: '#FFF', fontFamily: 'Inter-Bold', fontSize: 16 },
    inputLabel: { fontFamily: 'Inter-Medium', fontSize: 14, marginBottom: 8 },
    textInput: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, fontFamily: 'Inter-Regular' },
    sessionIconBg: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
