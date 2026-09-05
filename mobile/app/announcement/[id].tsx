import { SafeAreaView } from 'react-native-safe-area-context';
import React, { useEffect, useState, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    Image,
    Platform } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../src/constants/Colors';
import { useAnnouncementStore } from '../../src/stores';
import { useNotificationStore } from '../../src/stores/notification.store';
import { format } from 'date-fns';
import { UniversalViewer } from '../../src/components/common/UniversalViewer';
import { supabase } from '../../src/api/supabase/client';
import { getOptimizedCloudinaryUrl } from '../../src/lib/cloudinary';
import { ScreenErrorBoundary } from '../../src/components/ScreenErrorBoundary';

// Category → theme mapping using ACTUAL db field (not keyword guessing)
import { LinearGradient } from 'expo-linear-gradient';

// Robust hero image — never blank, falls back to raw URL, auto-retries on error
function HeroImage({ uri, fallbackUri, style }: { uri: string; fallbackUri: string; style: any }) {
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

    return (
        <View style={[style, { overflow: 'hidden', backgroundColor: '#0c4a6e' }]}>
            {currentUri ? (
                <Image
                    key={`${currentUri}-${retryKey}`}
                    source={{ uri: currentUri, cache: 'force-cache' }}
                    style={[StyleSheet.absoluteFill, { opacity: status === 'loaded' ? 1 : 0 }]}
                    resizeMode="cover"
                    onLoad={() => setStatus('loaded')}
                    onError={handleError}
                    fadeDuration={200}
                />
            ) : null}
        </View>
    );
}

// Category → theme mapping using ACTUAL db field (not keyword guessing)
const CATEGORY_THEMES: Record<string, { label: string; bg: string; color: string }> = {
    academic: { label: 'ACADEMIC', bg: '#FEF3C7', color: '#D97706' },
    social:   { label: 'SOCIAL',   bg: '#F3E8FF', color: '#9333EA' },
    event:    { label: 'EVENT',    bg: '#DBEAFE', color: '#2563EB' },
    general:  { label: 'GENERAL',  bg: '#F1F5F9', color: '#475569' },
};

const PRIORITY_BADGES: Record<string, { label: string; bg: string; color: string }> = {
    urgent: { label: '🔴 URGENT', bg: '#FEE2E2', color: '#DC2626' },
    high:   { label: '🟠 HIGH',   bg: '#FEF3C7', color: '#D97706' },
    normal: { label: 'NORMAL',    bg: '#F1F5F9', color: '#64748B' },
    low:    { label: 'LOW',       bg: '#F0FDF4', color: '#16A34A' },
};

export default function AnnouncementDetailsScreen() {
    return (
        <ScreenErrorBoundary>
            <AnnouncementDetailsContent />
        </ScreenErrorBoundary>
    );
}

function AnnouncementDetailsContent() {
    const { id } = useLocalSearchParams();
    const announcements = useAnnouncementStore(s => s.announcements);
    const markAsRead = useAnnouncementStore(s => s.markAsRead);
    const [viewerVisible, setViewerVisible] = React.useState(false);

    const announcement = announcements.find(a => a.id === id);

    // Increment view count and mark as read via institutional persistence engine
    useEffect(() => {
        if (!announcement) return;
        
        const announcementId = announcement.id;
        
        async function updateAnnouncementStats() {
            try {
                await (supabase as any).rpc('increment_announcement_view_count' as any, { 
                    announcement_id: announcementId 
                });
            } catch (error) {
                // Ignore silent analytics errors
            }
            
            // Mark as Read in persistence store and notification store
            if (typeof markAsRead === 'function') {
                markAsRead(announcementId);
            }
            useNotificationStore.getState().markEntityAsRead('announcement', announcementId);
        }

        updateAnnouncementStats();
    }, [announcement?.id, markAsRead]);

    if (!announcement) {
        return (
            <SafeAreaView style={styles.container}>
                <View style={styles.header}>
                    <TouchableOpacity
                        onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/announcements')}
                        style={styles.backButton}
                    >
                        <Ionicons name="arrow-back" size={24} color={COLORS.text} />
                    </TouchableOpacity>
                </View>
                <View style={styles.empty}>
                    <Ionicons name="document-outline" size={48} color={COLORS.textMuted} />
                    <Text style={styles.emptyText}>Announcement not found.</Text>
                </View>
            </SafeAreaView>
        );
    }

    const theme = CATEGORY_THEMES[announcement.category] || CATEGORY_THEMES.general;

    return (
        <View style={styles.container}>
            <View style={styles.heroContainer}>
                {/* Immersive Hero Header */}
                {announcement.cover_image_url ? (
                    <TouchableOpacity onPress={() => setViewerVisible(true)} activeOpacity={0.9} style={styles.heroPressable}>
                        <HeroImage
                            uri={getOptimizedCloudinaryUrl(announcement.cover_image_url, 1000)}
                            fallbackUri={announcement.cover_image_url}
                            style={styles.heroImage}
                        />
                         <LinearGradient
                            colors={['rgba(0,0,0,0.4)', 'transparent', 'rgba(0,0,0,0.8)']}
                            style={StyleSheet.absoluteFill}
                        />
                    </TouchableOpacity>
                ) : (
                    <View style={styles.heroPlaceholder}>
                        <Ionicons name="megaphone" size={48} color={COLORS.primary} opacity={0.2} />
                    </View>
                )}

                {/* Floating Back Button */}
                <SafeAreaView style={styles.safeHeader}>
                    <TouchableOpacity
                        onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/announcements')}
                        style={styles.glassBackButton}
                    >
                        <Ionicons name="chevron-back" size={24} color="#FFF" />
                    </TouchableOpacity>
                </SafeAreaView>

                {/* Hero Content Overlay */}
                <View style={styles.heroContent}>
                    <View style={styles.heroBadgeRow}>
                        <View style={[styles.immersiveBadge, { backgroundColor: theme.bg }]}>
                            <Text style={[styles.immersiveBadgeText, { color: theme.color }]}>{theme.label}</Text>
                        </View>
                        {announcement.priority !== 'normal' && announcement.priority && (
                            <View style={[styles.immersiveBadge, { backgroundColor: '#ef4444' }]}>
                                <Text style={[styles.immersiveBadgeText, { color: '#FFF' }]}>
                                    {(announcement.priority || '').toUpperCase()}
                                </Text>
                            </View>
                        )}
                    </View>
                    <Text style={styles.heroTitle}>{announcement.title}</Text>
                </View>
            </View>

            <ScrollView 
                style={styles.content} 
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.scrollPadding}
            >
                <View style={styles.body}>
                    <View style={styles.metadataCard}>
                        <View style={styles.metaItem}>
                            <Ionicons name="calendar-outline" size={16} color={COLORS.textMuted} />
                            <Text style={styles.metaLabel}>Published</Text>
                            <Text style={styles.metaValue}>
                                {announcement.created_at
                                    ? format(new Date(announcement.created_at), 'MMM d, yyyy')
                                    : '—'}
                            </Text>
                        </View>
                        <View style={styles.metaDivider} />
                        <View style={styles.metaItem}>
                            <Ionicons name="eye-outline" size={16} color={COLORS.textMuted} />
                            <Text style={styles.metaLabel}>Views</Text>
                            <Text style={styles.metaValue}>{(announcement.view_count || 0) + 1}</Text>
                        </View>
                    </View>

                    {/* ─── Full Content ─── */}
                    <Text style={styles.bodyText}>{announcement.content}</Text>

                    {/* ─── Institutional Signature ─── */}
                    <View style={styles.institutionalSignature}>
                        <View style={styles.sigLine} />
                        <Text style={styles.sigText}>Released by NALISS Public Relations</Text>
                        <Text style={styles.sigSub}>Umaru Musa Yar'adua University (UMYUK)</Text>
                    </View>
                </View>
            </ScrollView>

            {/* In-App Restricted Viewer */}
            {announcement.cover_image_url && (
                <UniversalViewer 
                    isVisible={viewerVisible}
                    onClose={() => setViewerVisible(false)}
                    fileUri={announcement.cover_image_url}
                    fileType="image"
                    fileName={announcement.title}
                    showDownload={true}
                    showShare={false}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#FFFFFF',
    },
    heroContainer: {
        height: 380,
        backgroundColor: '#064E3B',
        position: 'relative',
    },
    heroPressable: {
        width: '100%',
        height: '100%',
    },
    heroImage: {
        width: '100%',
        height: '100%',
    },
    heroPlaceholder: {
        width: '100%',
        height: '100%',
        backgroundColor: '#F8FAFC',
        alignItems: 'center',
        justifyContent: 'center',
    },
    safeHeader: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 10,
    },
    glassBackButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 20,
        marginTop: Platform.OS === 'android' ? 10 : 0,
    },
    heroContent: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        padding: 24,
        paddingBottom: 32,
    },
    heroBadgeRow: {
        flexDirection: 'row',
        gap: 8,
        marginBottom: 12,
    },
    immersiveBadge: {
        paddingHorizontal: 12,
        paddingVertical: 4,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.2)',
    },
    immersiveBadgeText: {
        fontFamily: 'Inter-Bold',
        fontSize: 10,
        letterSpacing: 0.5,
    },
    heroTitle: {
        fontFamily: 'Inter-Bold',
        fontSize: 30,
        color: '#FFFFFF',
        lineHeight: 38,
        textShadowColor: 'rgba(0, 0, 0, 0.3)',
        textShadowOffset: { width: 0, height: 2 },
        textShadowRadius: 6,
    },
    content: {
        flex: 1,
        marginTop: -20,
        backgroundColor: '#FFFFFF',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
    },
    scrollPadding: {
        paddingTop: 12,
    },
    body: {
        padding: 24,
    },
    metadataCard: {
        flexDirection: 'row',
        backgroundColor: '#F8FAFC',
        borderRadius: 16,
        padding: 16,
        marginBottom: 24,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#F1F5F9',
    },
    metaItem: {
        flex: 1,
        alignItems: 'center',
    },
    metaDivider: {
        width: 1,
        height: 24,
        backgroundColor: '#E2E8F0',
    },
    metaLabel: {
        fontFamily: 'Inter-Medium',
        fontSize: 11,
        color: '#94A3B8',
        marginTop: 4,
    },
    metaValue: {
        fontFamily: 'Inter-Bold',
        fontSize: 13,
        color: '#1E293B',
        marginTop: 2,
    },
    bodyText: {
        fontFamily: 'Inter-Regular',
        fontSize: 17,
        color: '#334155',
        lineHeight: 28,
        marginBottom: 32,
    },
    institutionalSignature: {
        marginTop: 16,
        alignItems: 'center',
    },
    sigLine: {
        width: 40,
        height: 3,
        backgroundColor: '#059669',
        borderRadius: 2,
        marginBottom: 12,
    },
    sigText: {
        fontFamily: 'Inter-Bold',
        fontSize: 14,
        color: '#0F172A',
    },
    sigSub: {
        fontFamily: 'Inter-Medium',
        fontSize: 12,
        color: '#64748B',
        marginTop: 2,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#F1F5F9',
    },
    backButton: {
        padding: 5,
    },
    empty: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
    },
    emptyText: {
        fontFamily: 'Inter-Medium',
        fontSize: 16,
        color: '#94A3B8',
    },
});
