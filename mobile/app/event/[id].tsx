import { SafeAreaView } from 'react-native-safe-area-context';
import React, { useEffect, useState, useCallback } from 'react';
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Linking, Platform, Alert, Dimensions } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS } from '../../src/constants/Colors';
import { useEventStore } from '../../src/stores';
import { useNotificationStore } from '../../src/stores/notification.store';
import { format } from 'date-fns';
import { supabase } from '../../src/api/supabase/client';
import { getOptimizedCloudinaryUrl } from '../../src/lib/cloudinary';
import { UniversalViewer } from '../../src/components/common/UniversalViewer';
import { useAuthStore } from '../../src/stores';
import { RegistrationOverlay } from './../(tabs)/announcements';

import { ScreenErrorBoundary } from '../../src/components/ScreenErrorBoundary';

const { width, height } = Dimensions.get('window');

// Robust hero image — never blank, falls back to raw URL, auto-retries on error
function HeroImage({ uri, fallbackUri }: { uri: string; fallbackUri: string }) {
    const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
    const [currentUri, setCurrentUri] = useState(uri);
    const [retryKey, setRetryKey] = useState(0);

    useEffect(() => {
        if (uri !== currentUri) { setCurrentUri(uri); setStatus('loading'); }
    }, [uri]);

    useEffect(() => {
        if (status !== 'error') return;
        const t = setTimeout(() => { setStatus('loading'); setRetryKey(k => k + 1); }, 3000);
        return () => clearTimeout(t);
    }, [status]);

    const handleError = useCallback(() => {
        if (currentUri !== fallbackUri) { setCurrentUri(fallbackUri); setStatus('loading'); }
        else setStatus('error');
    }, [currentUri, fallbackUri]);

    return currentUri ? (
        <Image
            key={`${currentUri}-${retryKey}`}
            source={{ uri: currentUri, cache: 'force-cache' }}
            style={[StyleSheet.absoluteFillObject, { opacity: status === 'loaded' ? 1 : 0 }]}
            resizeMode="cover"
            onLoad={() => setStatus('loaded')}
            onError={handleError}
            fadeDuration={200}
        />
    ) : null;
}

const STATUS_CONFIG: Record<string, { bg: string; text: string; label: string; gradient: [string, string] }> = {
    published: { bg: '#dbeafe', text: '#1d4ed8', label: 'PUBLISHED', gradient: ['#1e3a8a', '#2563eb'] },
    ongoing:   { bg: '#d1fae5', text: '#065f46', label: 'LIVE NOW',  gradient: ['#064e3b', '#059669'] },
    completed: { bg: '#ede9fe', text: '#5b21b6', label: 'COMPLETED', gradient: ['#4c1d95', '#7c3aed'] },
    cancelled: { bg: '#fee2e2', text: '#b91c1c', label: 'CANCELLED', gradient: ['#7f1d1d', '#dc2626'] },
    draft:     { bg: '#f1f5f9', text: '#475569', label: 'DRAFT',     gradient: ['#334155', '#64748b'] },
};

export default function EventDetailsScreen() {
    return (
        <ScreenErrorBoundary>
            <EventDetailsContent />
        </ScreenErrorBoundary>
    );
}

function EventDetailsContent() {
    const { id } = useLocalSearchParams();
    const { events } = useEventStore();
    const event = events.find(e => e.id === id);
    const [viewerVisible, setViewerVisible] = useState(false);
    const user = useAuthStore(s => s.profile);
    const [activeApplyPoolId, setActiveApplyPoolId] = useState<string | null>(null);

    useEffect(() => {
        if (!event) return;
        ((supabase as any).rpc('increment_event_view_count' as any, { event_id: event.id }) as any).then(() => {});
        useNotificationStore.getState().markEntityAsRead('event', event.id);
    }, [event?.id]);

    if (!event) {
        return (
            <SafeAreaView style={styles.container}>
                <TouchableOpacity style={styles.backBtnFloat} onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/announcements')}>
                    <Ionicons name='arrow-back' size={22} color='#0f172a' />
                </TouchableOpacity>
                <View style={styles.empty}>
                    <Ionicons name='calendar-outline' size={56} color={COLORS.textMuted} />
                    <Text style={styles.emptyText}>Event not found</Text>
                </View>
            </SafeAreaView>
        );
    }

    const status = STATUS_CONFIG[event.status] || STATUS_CONFIG.draft;
    const hasCover = !!event.cover_image_url;
    const isOngoing = event.status === 'ongoing';

    const handleJoinVirtual = async () => {
        if (!event.virtual_link) return;
        try {
            const ok = await Linking.canOpenURL(event.virtual_link);
            if (ok) await Linking.openURL(event.virtual_link);
            else Alert.alert('Cannot Open', 'The virtual link could not be opened.');
        } catch { Alert.alert('Error', 'Failed to open virtual link.'); }
    };

    return (
        <View style={styles.container}>
            <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>

                {/*  Hero Section  */}
                <View style={styles.hero}>
                    {hasCover ? (
                        <TouchableOpacity onPress={() => setViewerVisible(true)} activeOpacity={0.9} style={StyleSheet.absoluteFillObject}>
                            <HeroImage
                                uri={getOptimizedCloudinaryUrl(event.cover_image_url!, 1000)}
                                fallbackUri={event.cover_image_url!}
                            />
                        </TouchableOpacity>
                    ) : (
                        <LinearGradient colors={status.gradient} style={StyleSheet.absoluteFillObject} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
                    )}
                    {/* Gradient overlay */}
                    <LinearGradient colors={['rgba(0,0,0,0.15)', 'rgba(0,0,0,0.75)']} style={StyleSheet.absoluteFillObject} />

                    {/* Back button */}
                    <SafeAreaView style={styles.heroNav}>
                        <TouchableOpacity style={styles.backBtn} onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/announcements')}>
                            <Ionicons name='arrow-back' size={20} color='#fff' />
                        </TouchableOpacity>
                        <View style={styles.heroNavRight}>
                            {isOngoing && (
                                <View style={styles.livePill}>
                                    <View style={styles.liveDot} />
                                    <Text style={styles.liveText}>LIVE</Text>
                                </View>
                            )}
                        </View>
                    </SafeAreaView>

                    {/* Hero bottom content */}
                    <View style={styles.heroBottom}>
                        <View style={styles.heroBadgeRow}>
                            <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
                                <Text style={[styles.statusText, { color: status.text }]}>{status.label}</Text>
                            </View>
                            {event.is_virtual && (
                                <View style={styles.virtualBadge}>
                                    <Ionicons name='videocam' size={10} color='#c4b5fd' />
                                    <Text style={styles.virtualText}>VIRTUAL</Text>
                                </View>
                            )}
                        </View>
                        <Text style={styles.heroTitle}>{event.title}</Text>
                        <Text style={styles.heroDate}>{event.start_date ? format(new Date(event.start_date), 'EEEE, MMMM d, yyyy') : ''}</Text>
                    </View>
                </View>

                {/*  Info Cards Row  */}
                <View style={styles.infoRow}>
                    <InfoChip icon='time-outline' label='Time'
                        value={event.start_time ? (event.start_time + (event.end_time ? '  –  ' + event.end_time : '')) : 'All Day'} />
                    <InfoChip icon='location-outline' label='Venue'
                        value={event.is_virtual ? 'Online' : (event.venue || 'Main Campus')} />
                    {event.max_attendees != null && (
                        <InfoChip icon='people-outline' label='Capacity'
                            value={`${event.current_attendees ?? 0} / ${event.max_attendees}`} />
                    )}
                </View>

                {/*  Virtual Join Button  */}
                {event.is_virtual && event.virtual_link && (
                    <TouchableOpacity style={styles.joinBtn} onPress={handleJoinVirtual} activeOpacity={0.85}>
                        <LinearGradient colors={['#4c1d95', '#7c3aed']} style={styles.joinBtnGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                            <Ionicons name='videocam' size={20} color='#fff' />
                            <Text style={styles.joinBtnText}>Join Virtual Event</Text>
                            <Ionicons name='arrow-forward' size={18} color='rgba(255,255,255,0.7)' />
                        </LinearGradient>
                    </TouchableOpacity>
                )}

                {/* Participate in Pool Button */}
                {event.pool_id && (
                    <TouchableOpacity style={[styles.joinBtn, { marginTop: event.is_virtual && event.virtual_link ? 8 : 0 }]} onPress={() => setActiveApplyPoolId(event.pool_id || null)} activeOpacity={0.85}>
                        <LinearGradient colors={['#059669', '#10b981']} style={styles.joinBtnGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                            <Ionicons name='clipboard-outline' size={20} color='#fff' />
                            <Text style={styles.joinBtnText}>Participate in Pool</Text>
                            <Ionicons name='arrow-forward' size={18} color='rgba(255,255,255,0.7)' />
                        </LinearGradient>
                    </TouchableOpacity>
                )}

                {/*  About Section  */}
                <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                        <View style={styles.sectionAccent} />
                        <Text style={styles.sectionTitle}>About this Event</Text>
                    </View>
                    <Text style={styles.bodyText}>{event.description || 'No additional details provided.'}</Text>
                </View>

                <View style={{ height: 60 }} />
            </ScrollView>

            {event.cover_image_url && (
                <UniversalViewer 
                    isVisible={viewerVisible}
                    onClose={() => setViewerVisible(false)}
                    fileUri={event.cover_image_url}
                    fileType="image"
                    fileName={event.title}
                    showDownload={true}
                    showShare={false}
                />
            )}

            {activeApplyPoolId && (
                <RegistrationOverlay 
                    poolId={activeApplyPoolId} 
                    user={user} 
                    onClose={() => setActiveApplyPoolId(null)} 
                />
            )}
        </View>
    );
}

function InfoChip({ icon, label, value }: { icon: string; label: string; value: string }) {
    return (
        <View style={styles.infoChip}>
            <View style={styles.infoChipIcon}>
                <Ionicons name={icon as any} size={18} color={COLORS.primary} />
            </View>
            <Text style={styles.infoChipLabel}>{label.toUpperCase()}</Text>
            <Text style={styles.infoChipValue} numberOfLines={2}>{value}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f8fafc' },
    scroll: { flex: 1 },
    hero: { height: height * 0.42, position: 'relative', justifyContent: 'space-between' },
    heroNav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: Platform.OS === 'android' ? 12 : 0 },
    backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
    backBtnFloat: { position: 'absolute', top: Platform.OS === 'android' ? 40 : 60, left: 16, zIndex: 10, width: 40, height: 40, borderRadius: 20, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
    heroNavRight: { flexDirection: 'row', gap: 8 },
    livePill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(220,38,38,0.85)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
    liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#fca5a5' },
    liveText: { fontFamily: 'Inter-Bold', fontSize: 10, color: '#fca5a5', letterSpacing: 1 },
    heroBottom: { padding: 20, paddingBottom: 24 },
    heroBadgeRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
    statusBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
    statusText: { fontFamily: 'Inter-Bold', fontSize: 9, letterSpacing: 0.8 },
    virtualBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, backgroundColor: 'rgba(109,40,217,0.8)' },
    virtualText: { fontFamily: 'Inter-Bold', fontSize: 9, color: '#c4b5fd', letterSpacing: 0.5 },
    heroTitle: { fontFamily: 'Inter-Bold', fontSize: 26, color: '#fff', lineHeight: 32, marginBottom: 6, textShadowColor: 'rgba(0,0,0,0.4)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 },
    heroDate: { fontFamily: 'Inter-SemiBold', fontSize: 13, color: 'rgba(255,255,255,0.8)' },
    infoRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 16 },
    infoChip: { flex: 1, backgroundColor: '#fff', borderRadius: 16, padding: 14, alignItems: 'center', shadowColor: '#1B5E20', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 2 },
    infoChipIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#f0fdf4', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
    infoChipLabel: { fontFamily: 'Inter-Bold', fontSize: 8, color: '#94a3b8', letterSpacing: 1, marginBottom: 4 },
    infoChipValue: { fontFamily: 'Inter-SemiBold', fontSize: 12, color: '#1e293b', textAlign: 'center', lineHeight: 16 },
    joinBtn: { marginHorizontal: 16, marginBottom: 8, borderRadius: 16, overflow: 'hidden', shadowColor: '#7c3aed', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 6 },
    joinBtnGradient: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 16 },
    joinBtnText: { fontFamily: 'Inter-Bold', fontSize: 15, color: '#fff', flex: 1, textAlign: 'center' },
    section: { marginHorizontal: 16, marginTop: 8, backgroundColor: '#fff', borderRadius: 20, padding: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
    sectionAccent: { width: 4, height: 20, borderRadius: 2, backgroundColor: '#1B5E20' },
    sectionTitle: { fontFamily: 'Inter-Bold', fontSize: 16, color: '#0f172a' },
    bodyText: { fontFamily: 'Inter-Regular', fontSize: 15, color: '#334155', lineHeight: 26 },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 120 },
    emptyText: { fontFamily: 'Inter-Medium', fontSize: 16, color: '#94a3b8' },
});