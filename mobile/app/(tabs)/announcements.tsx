import React, { useState, useEffect } from 'react';
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity,
    TextInput, SafeAreaView, Platform, ActivityIndicator,
    Image, RefreshControl, Alert, Dimensions,
} from 'react-native';
import { UniversalViewer } from '../../src/components/common/UniversalViewer';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { COLORS } from '../../src/constants/Colors';
import { useAnnouncementStore, useEventStore, useAuthStore } from '../../src/stores';
import { supabase } from '../../src/api/supabase/client';
import { format, formatDistanceToNow } from 'date-fns';
import { useNetworkStore } from '../../src/stores/network.store';
import { getOptimizedCloudinaryUrl } from '../../src/lib/cloudinary';
import { useTheme } from '../../src/stores/theme.store';
import { useSentryScreen } from '../../src/hooks/useSentryScreen';
import { PosterImage } from '../../src/components/PosterImage';
import {  SafeBottomSheet, SafeOverlayContainer } from '../../src/components/common/overlays';
const { width } = Dimensions.get('window');

const CATEGORIES = ['All', 'Academic', 'Social', 'Event', 'General'];

// Per-category visual identity
const CATEGORY_CONFIG: Record<string, {
    label: string; gradient: [string, string]; accent: string;
    bg: string; icon: string; chipBg: string; chipText: string;
}> = {
    academic: { label: 'ACADEMIC', gradient: ['#92400e', '#d97706'], accent: '#fbbf24', bg: '#fffbeb', icon: 'school', chipBg: '#fef3c7', chipText: '#92400e' },
    social:   { label: 'SOCIAL',   gradient: ['#4c1d95', '#7c3aed'], accent: '#c4b5fd', bg: '#faf5ff', icon: 'people', chipBg: '#f3e8ff', chipText: '#6d28d9' },
    event:    { label: 'EVENT',    gradient: ['#1e3a8a', '#2563eb'], accent: '#93c5fd', bg: '#eff6ff', icon: 'calendar', chipBg: '#dbeafe', chipText: '#1d4ed8' },
    general:  { label: 'GENERAL',  gradient: ['#064e3b', '#1B5E20'], accent: '#6ee7b7', bg: '#f0fdf4', icon: 'megaphone', chipBg: '#dcfce7', chipText: '#166534' },
};
const DEFAULT_CAT = CATEGORY_CONFIG.general;

const PRIORITY_CONFIG: Record<string, { color: string; label: string; icon: string }> = {
    urgent: { color: '#dc2626', label: 'URGENT', icon: 'alert-circle' },
    high:   { color: '#f59e0b', label: 'HIGH',   icon: 'warning' },
    normal: { color: 'transparent', label: '', icon: '' },
    low:    { color: 'transparent', label: '', icon: '' },
};

const STATUS_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
    published: { bg: '#dbeafe', text: '#1d4ed8', label: 'PUBLISHED' },
    ongoing:   { bg: '#d1fae5', text: '#065f46', label: 'ONGOING' },
    completed: { bg: '#ede9fe', text: '#5b21b6', label: 'COMPLETED' },
    cancelled: { bg: '#fee2e2', text: '#b91c1c', label: 'CANCELLED' },
    draft:     { bg: '#f1f5f9', text: '#475569', label: 'DRAFT' },
};

export default function AnnouncementsScreen() {
    useSentryScreen('AnnouncementsScreen');
    const announcements = useAnnouncementStore(s => s.announcements);
    const loadingAnnouncements = useAnnouncementStore(s => s.isLoading);
    const events = useEventStore(s => s.events);
    const loadingEvents = useEventStore(s => s.isLoading);
    const user = useAuthStore(s => s.profile);
    const params = useLocalSearchParams();
    const [searchQuery, setSearchQuery] = useState('');
    const [activeCategory, setActiveCategory] = useState(params.tab as string || 'All');
    const [refreshing, setRefreshing] = useState(false);
    const fetchAnnouncements = useAnnouncementStore(s => s.fetchAnnouncements);
    const fetchUpcomingEvents = useEventStore(s => s.fetchUpcomingEvents);
    const { colors, isDark } = useTheme();
    const isOnline = useNetworkStore(s => s.isOnline);

    const [activeApplyPoolId, setActiveApplyPoolId] = useState<string | null>(null);
    const [viewerVisible, setViewerVisible] = useState(false);
    const [viewerFile, setViewerFile] = useState<{ uri: string, type: 'image' | 'video', name: string } | null>(null);

    const loadData = async () => {
        const level = user?.level || undefined;
        await Promise.all([
            fetchAnnouncements(level),
            fetchUpcomingEvents(level),
        ]);
    };

    useEffect(() => { loadData(); }, [user?.level]); // eslint-disable-line
    useEffect(() => { if (params.tab) setActiveCategory(params.tab as string); }, [params.tab]);
    const onRefresh = async () => { setRefreshing(true); try { await loadData(); } finally { setRefreshing(false); } };
    const query = searchQuery.trim().toLowerCase();

    const handleDelete = async (id: string) => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            const { error } = await (supabase as any).from('announcements').delete().eq('id', id);
            if (error) throw error;
            if (user) {
                (supabase as any).from('activity_logs').insert({
                    user_id: user.id,
                    action: 'announcement.delete',
                    entity_id: id,
                    entity_type: 'announcement',
                    description: 'Deleted announcement from mobile',
                }).then(() => {}); // fire-and-forget, non-critical
            }
            await loadData();
        } catch { Alert.alert('Error', 'Failed to remove announcement.'); }
    };

    const filteredAnnouncements = announcements.filter(a => {
        const matchQuery = query.length === 0 || a.title.toLowerCase().includes(query) || (a.content && a.content.toLowerCase().includes(query));
        if (!matchQuery) return false;
        if (activeCategory === 'All') return true;
        if (activeCategory === 'Event') return false;
        return (a.category || 'general').toLowerCase() === activeCategory.toLowerCase();
    });

    const sortedAnnouncements = [...filteredAnnouncements].sort((a, b) => {
        if (a.is_pinned && !b.is_pinned) return -1;
        if (!a.is_pinned && b.is_pinned) return 1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    const filteredEvents = events.filter(e => {
        return query.length === 0 || e.title.toLowerCase().includes(query) || (e.description && e.description.toLowerCase().includes(query));
    });

    const isLoading = (loadingAnnouncements || loadingEvents) && announcements.length === 0 && events.length === 0;

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
            {/* Header */}
            <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
                <View style={styles.headerTextRow}>
                    <View>
                        <Text style={[styles.headerTitle, { color: colors.text }]}>Updates</Text>
                        <Text style={[styles.headerSubtitle, { color: colors.textMuted }]}>News & upcoming events</Text>
                    </View>
                    <View style={styles.headerCountBadge}>
                        <Text style={styles.headerCountText}>
                            {activeCategory === 'Event' ? filteredEvents.length : sortedAnnouncements.length}
                        </Text>
                    </View>
                </View>
            </View>

            {/* Search */}
            <View style={[styles.searchContainer, { backgroundColor: colors.card }]}>
                <View style={[styles.searchBox, { backgroundColor: colors.surface }]}>
                    <Ionicons name='search' size={18} color={colors.textMuted} />
                    <TextInput
                        style={[styles.searchInput, { color: colors.text }]}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        placeholder={activeCategory === 'Event' ? 'Search events...' : 'Search announcements...'}
                        placeholderTextColor={colors.textMuted}
                        keyboardAppearance={isDark ? 'dark' : 'light'}
                    />
                    {searchQuery.length > 0 && (
                        <TouchableOpacity onPress={() => setSearchQuery('')}>
                            <Ionicons name='close-circle' size={18} color={colors.textMuted} />
                        </TouchableOpacity>
                    )}
                </View>
            </View>

            {/* Filter chips */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll} style={[styles.filterRow, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
                {CATEGORIES.map(cat => {
                    const isActive = activeCategory === cat;
                    const cfg = CATEGORY_CONFIG[cat.toLowerCase()];
                    return (
                        <TouchableOpacity key={cat} onPress={() => setActiveCategory(cat)}
                            style={styles.chip}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                                {cat !== 'All' && cfg && (
                                    <Ionicons name={cfg.icon as any} size={13} color={isActive ? colors.primary : colors.textMuted} />
                                )}
                                <Text style={[styles.chipText, { color: isActive ? colors.primary : colors.textMuted }, isActive && { color: colors.primary }]}>{cat}</Text>
                            </View>
                            {isActive && <View style={[styles.chipIndicator, { backgroundColor: colors.primary }]} />}
                        </TouchableOpacity>
                    );
                })}
            </ScrollView>

            {/* Content */}
            <ScrollView
                style={[styles.content, { backgroundColor: colors.background }]}
                contentContainerStyle={styles.contentContainer}
                showsVerticalScrollIndicator={false}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}>
                {isLoading ? (
                    <ActivityIndicator size='large' color={colors.primary} style={{ marginTop: 60 }} />
                ) : activeCategory === 'Event' ? (
                    filteredEvents.length > 0 ? filteredEvents.map(event => (
                        <EventCard 
                            key={event.id} 
                            event={event} 
                            onApply={() => setActiveApplyPoolId(event.pool_id || null)} 
                            onImagePress={(localUri) => {
                                setViewerFile({ uri: localUri || event.cover_image_url || '', type: 'image', name: event.title || '' });
                                setViewerVisible(true);
                            }}
                        />)
                    ) : <EmptyState icon='calendar-outline' text='No upcoming events' />
                ) : (
                    sortedAnnouncements.length > 0 ? sortedAnnouncements.map(ann => (
                        <AnnouncementCard 
                            key={ann.id} 
                            announcement={ann} 
                            user={user} 
                            onDelete={handleDelete} 
                            onApply={() => setActiveApplyPoolId(ann.pool_id)} 
                            onImagePress={(localUri) => {
                                setViewerFile({ uri: localUri || ann.cover_image_url || '', type: 'image', name: ann.title || '' });
                                setViewerVisible(true);
                            }}
                        />)
                    ) : <EmptyState icon='notifications-off-outline' text='No announcements found' />
                )}
            </ScrollView>

            {/* Application Overlay Modal */}
            {activeApplyPoolId && (
                <RegistrationOverlay 
                    poolId={activeApplyPoolId} 
                    user={user} 
                    onClose={() => setActiveApplyPoolId(null)} 
                />
            )}

            {viewerFile && (
                <UniversalViewer
                    isVisible={viewerVisible}
                    onClose={() => {
                        setViewerVisible(false);
                        setTimeout(() => setViewerFile(null), 300);
                    }}
                    fileUri={viewerFile.uri}
                    fileType={viewerFile.type}
                    fileName={viewerFile.name}
                />
            )}
        </SafeAreaView>
    );
}

export function RegistrationOverlay({ poolId, user, onClose }: { poolId: string, user: any, onClose: () => void }) {
    const { colors } = useTheme();
    const [poolData, setPoolData] = useState<any>(null);
    const [appCount, setAppCount] = useState(0);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [serverTime, setServerTime] = useState<Date>(new Date());
    const [existingApp, setExistingApp] = useState<any>(null);

    useEffect(() => {
        const init = async () => {
            setIsLoading(true);
            try {
                // Fetch server time
                const { data: sTime } = await supabase.rpc('get_server_time');
                if (sTime) setServerTime(new Date(sTime));

                // Fetch pool
                const { data: pool } = await (supabase as any).from('event_pools').select('*').eq('id', poolId).single();
                setPoolData(pool);

                // Fetch applicant count
                const { count } = await (supabase as any).from('pool_applications').select('*', { count: 'exact', head: true }).eq('pool_id', poolId);
                setAppCount(count || 0);

                // Check existing app
                if (user?.id) {
                    const { data: app } = await (supabase as any).from('pool_applications').select('*').eq('pool_id', poolId).eq('user_id', user.id).maybeSingle();
                    if (app) setExistingApp(app);
                }
            } catch (e) {
                console.error(e);
            } finally {
                setIsLoading(false);
            }
        };
        init();
    }, [poolId, user]);

    if (isLoading) {
        return (
            <SafeOverlayContainer visible={isLoading} animationType="fade" overlayStyle={{ justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" color={COLORS.primary} />
            </SafeOverlayContainer>
        );
    }

    if (!poolData) return null;

    const constraints = poolData.target_constraints || {};
    const cap = constraints.max_participants || 0;
    const deadlineStr = constraints.application_deadline;
    const isClosedByTime = deadlineStr && new Date(serverTime) > new Date(deadlineStr);
    const isFull = cap > 0 && appCount >= cap;
    
    // Level checking
    const requiredLevels = constraints.levels || [];
    const isLevelMatch = requiredLevels.length === 0 || (user?.level && requiredLevels.includes(user.level));

    const handleSubmit = async () => {
        if (!user) return;
        setIsSubmitting(true);
        try {
            const { error } = await (supabase as any).from('pool_applications').insert({
                pool_id: poolId,
                user_id: user.id,
                status: 'pending'
            });
            if (error) throw error;
            Alert.alert('Success', 'Your application has been submitted and is pending approval.');
            onClose();
        } catch (e: any) {
            Alert.alert('Error', e.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <SafeBottomSheet
            visible={true}
            onClose={onClose}
            contentStyle={[overlayStyles.modalContainer, { backgroundColor: colors.card }]}
        >
                    <View style={overlayStyles.modalHeader}>
                        <Text style={[overlayStyles.modalTitle, { color: colors.text }]}>Apply to Participate</Text>
                        <TouchableOpacity onPress={onClose} style={overlayStyles.closeBtn}>
                            <Ionicons name="close" size={24} color={colors.text} />
                        </TouchableOpacity>
                    </View>

                    <ScrollView contentContainerStyle={{ padding: 20 }}>
                        <Text style={[overlayStyles.eventName, { color: colors.text }]}>{poolData.title}</Text>
                        
                        <View style={overlayStyles.statsRow}>
                            <View style={overlayStyles.statCard}>
                                <Text style={overlayStyles.statLabel}>Applicants</Text>
                                <Text style={[overlayStyles.statValue, { color: colors.text }]}>{appCount} {cap > 0 ? `/ ${cap}` : ''}</Text>
                            </View>
                            {deadlineStr && (
                                <View style={overlayStyles.statCard}>
                                    <Text style={overlayStyles.statLabel}>Deadline</Text>
                                    <Text style={[overlayStyles.statValue, { color: colors.text }]}>{new Date(deadlineStr).toLocaleString()}</Text>
                                </View>
                            )}
                        </View>

                        {existingApp && existingApp.status === 'approved' ? (
                            <View style={{ gap: 16 }}>
                                <View style={overlayStyles.alertBox}>
                                    <Ionicons name="checkmark-circle" size={24} color="#059669" />
                                    <Text style={overlayStyles.alertText}>Your application is <Text style={{fontWeight: 'bold', textTransform: 'capitalize'}}>approved</Text>!</Text>
                                </View>
                                <TouchableOpacity 
                                    style={overlayStyles.submitBtn} 
                                    onPress={() => {
                                        onClose();
                                        router.push(`/event-pool/${poolId}` as any);
                                    }}
                                >
                                    <Text style={overlayStyles.submitBtnText}>Enter Live Room</Text>
                                    <Ionicons name="arrow-forward" size={18} color="#fff" style={{ position: 'absolute', right: 20 }} />
                                </TouchableOpacity>
                            </View>
                        ) : existingApp && existingApp.status === 'pending' ? (
                            <View style={[overlayStyles.alertBox, { backgroundColor: '#fef3c7' }]}>
                                <Ionicons name="time" size={24} color="#d97706" />
                                <Text style={[overlayStyles.alertText, { color: '#d97706' }]}>Your application is pending approval.</Text>
                            </View>
                        ) : poolData.participation_rule === 'open' ? (
                            <TouchableOpacity 
                                style={overlayStyles.submitBtn} 
                                onPress={() => {
                                    onClose();
                                    router.push(`/event-pool/${poolId}` as any);
                                }}
                            >
                                <Text style={overlayStyles.submitBtnText}>Enter Live Room</Text>
                                <Ionicons name="arrow-forward" size={18} color="#fff" style={{ position: 'absolute', right: 20 }} />
                            </TouchableOpacity>
                        ) : isClosedByTime ? (
                            <View style={[overlayStyles.alertBox, { backgroundColor: '#fee2e2' }]}>
                                <Ionicons name="time" size={24} color="#dc2626" />
                                <Text style={[overlayStyles.alertText, { color: '#dc2626' }]}>Applications Closed.</Text>
                            </View>
                        ) : isFull ? (
                            <View style={[overlayStyles.alertBox, { backgroundColor: '#fee2e2' }]}>
                                <Ionicons name="people" size={24} color="#dc2626" />
                                <Text style={[overlayStyles.alertText, { color: '#dc2626' }]}>Registration Full.</Text>
                            </View>
                        ) : !isLevelMatch ? (
                            <View style={[overlayStyles.alertBox, { backgroundColor: '#fef3c7' }]}>
                                <Ionicons name="warning" size={24} color="#d97706" />
                                <Text style={[overlayStyles.alertText, { color: '#d97706' }]}>Your level is not eligible for this event.</Text>
                            </View>
                        ) : (
                            <TouchableOpacity 
                                style={[overlayStyles.submitBtn, isSubmitting && { opacity: 0.7 }]} 
                                onPress={handleSubmit} 
                                disabled={isSubmitting}
                            >
                                <Text style={overlayStyles.submitBtnText}>{isSubmitting ? 'Submitting...' : 'Submit Application'}</Text>
                            </TouchableOpacity>
                        )}
                    </ScrollView>
        </SafeBottomSheet>
    );
}

const overlayStyles = StyleSheet.create({
    overlayBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    modalContainer: { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '80%' },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)' },
    modalTitle: { fontSize: 20, fontWeight: '700' },
    closeBtn: { padding: 4 },
    eventName: { fontSize: 22, fontWeight: '800', marginBottom: 20 },
    statsRow: { flexDirection: 'row', gap: 12, marginBottom: 24 },
    statCard: { flex: 1, backgroundColor: 'rgba(0,0,0,0.03)', padding: 16, borderRadius: 12 },
    statLabel: { fontSize: 13, color: '#64748b', marginBottom: 4, fontWeight: '600' },
    statValue: { fontSize: 16, fontWeight: '700' },
    alertBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#d1fae5', padding: 16, borderRadius: 12, gap: 12 },
    alertText: { flex: 1, fontSize: 15, color: '#065f46', fontWeight: '500' },
    submitBtn: { backgroundColor: COLORS.primary, padding: 18, borderRadius: 16, alignItems: 'center' },
    submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});

function AnnouncementCard({ announcement, user, onDelete, onApply, onImagePress }: { announcement: any, user: any, onDelete: (id: string) => void, onApply?: () => void, onImagePress?: (localUri: string | null) => void }) {
    const cat = CATEGORY_CONFIG[(announcement.category || 'general').toLowerCase()] || DEFAULT_CAT;
    const timeAgo = announcement.created_at
        ? (() => { try { return format(new Date(announcement.created_at), 'MMMM d, yyyy'); } catch { return ''; } })()
        : '';
    const canDelete = user?.role === 'super_admin' || user?.role === 'moderator';
    const { colors, isDark } = useTheme();
    const readIds = useAnnouncementStore(s => s.readIds) || [];
    const isRead = readIds.includes(announcement.id);
    const markAsRead = useAnnouncementStore(s => s.markAsRead);

    return (
        <TouchableOpacity
            style={[styles.posterCard, { borderColor: isDark ? 'rgba(52, 211, 153, 0.15)' : 'rgba(0,0,0,0.05)', backgroundColor: isDark ? '#0f172a' : '#fff' }]}
            onPress={() => {
                markAsRead(announcement.id).catch(() => {});
                router.push({ pathname: '/announcement/[id]', params: { id: announcement.id } } as any);
            }}
            activeOpacity={0.92}
        >
            <PosterImage
                uri={announcement.cover_image_url ? getOptimizedCloudinaryUrl(announcement.cover_image_url, 600, 400) : undefined}
                fallbackUri={announcement.cover_image_url || undefined}
                style={styles.posterImage}
                gradientColors={['#0f172a', '#1e293b']}
                onPress={announcement.cover_image_url ? onImagePress : undefined}
            />
            <LinearGradient colors={['rgba(15,23,42,0.1)', 'rgba(15,23,42,0.95)']} style={styles.posterGradient} />
            <View style={styles.posterContent}>
                <View style={styles.posterTagRow}>
                    <View style={[styles.posterTag, !isRead ? styles.posterTagUnread : styles.posterTagRead]}>
                        <Text style={[styles.posterTagText, !isRead ? { color: '#34d399' } : { color: '#ffffff' }]}>{cat.label}</Text>
                    </View>
                    {canDelete && (
                        <TouchableOpacity 
                            style={{ marginLeft: 'auto', backgroundColor: 'rgba(239, 68, 68, 0.2)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.5)' }}
                            onPress={(e) => {
                                e.stopPropagation();
                                Alert.alert('Delete', 'Remove this announcement?', [
                                    { text: 'Cancel', style: 'cancel' },
                                    { text: 'Delete', style: 'destructive', onPress: () => onDelete(announcement.id) }
                                ]);
                            }}
                        >
                            <Ionicons name='trash-outline' size={14} color='#fca5a5' />
                        </TouchableOpacity>
                    )}
                </View>
                <Text style={styles.posterTitle} numberOfLines={2}>{announcement.title}</Text>
                <View style={styles.posterFooter}>
                    <Text style={styles.posterDate}>{timeAgo}</Text>
                    {announcement.pool_id ? (
                        <TouchableOpacity
                            style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#10b981', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 }}
                            onPress={(e) => {
                                e.stopPropagation();
                                onApply?.();
                            }}
                        >
                            <Ionicons name='clipboard-outline' size={14} color='#fff' />
                            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600', marginLeft: 4 }}>Participate</Text>
                        </TouchableOpacity>
                    ) : (
                        <Text style={[styles.posterSeeMore, !isRead ? { color: '#34d399' } : { color: '#ffffff' }]}>See more →</Text>
                    )}
                </View>
            </View>
        </TouchableOpacity>
    );
}

function EventCard({ event, onApply, onImagePress }: { event: any, onApply?: () => void, onImagePress?: (localUri: string | null) => void }) {
    const status = STATUS_CONFIG[event.status] || STATUS_CONFIG.draft;
    const isOngoing = event.status === 'ongoing';
    const eventGradient: [string, string] = isOngoing ? ['#065f46', '#059669'] : ['#1e3a8a', '#2563eb'];
    const { colors } = useTheme();

    return (
        <TouchableOpacity
            style={styles.eventCard}
            onPress={() => router.push({ pathname: '/event/[id]', params: { id: event.id } } as any)}
            activeOpacity={0.92}
        >
            {/* Hero image or gradient */}
            <View style={styles.eventHero}>
                <PosterImage
                    uri={event.cover_image_url ? getOptimizedCloudinaryUrl(event.cover_image_url, 800) : undefined}
                    fallbackUri={event.cover_image_url || undefined}
                    style={StyleSheet.absoluteFillObject}
                    gradientColors={eventGradient}
                    onPress={event.cover_image_url ? onImagePress : undefined}
                />
                <LinearGradient colors={['transparent', 'rgba(0,0,0,0.8)']} style={styles.eventHeroOverlay} />

                {/* Status + virtual badges */}
                <View style={styles.eventBadgeRow}>
                    <View style={[styles.eventStatusBadge, { backgroundColor: status.bg }]}>
                        <Text style={[styles.eventStatusText, { color: status.text }]}>{status.label}</Text>
                    </View>
                    {event.is_virtual && (
                        <View style={styles.virtualBadge}>
                            <Ionicons name='videocam' size={10} color='#c4b5fd' />
                            <Text style={styles.virtualText}>VIRTUAL</Text>
                        </View>
                    )}
                    {isOngoing && (
                        <View style={styles.liveBadge}>
                            <View style={styles.liveDot} />
                            <Text style={styles.liveText}>LIVE</Text>
                        </View>
                    )}
                </View>

                {/* Date chip */}
                <View style={styles.eventDateChip}>
                    <Text style={styles.eventDateDay}>{event.start_date ? (() => { try { return format(new Date(event.start_date), 'd'); } catch { return '?'; } })() : '?'}</Text>
                    <Text style={styles.eventDateMonth}>{event.start_date ? (() => { try { return format(new Date(event.start_date), 'MMM').toUpperCase(); } catch { return ''; } })() : ''}</Text>
                </View>

                {/* Title at bottom */}
                <View style={styles.eventHeroBottom}>
                    <Text style={styles.eventHeroTitle} numberOfLines={2}>{event.title}</Text>
                </View>
            </View>

            {/* Info strip */}
            <View style={[styles.eventInfoStrip, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
                <View style={styles.eventInfoItem}>
                    <Ionicons name='time-outline' size={14} color={colors.primary} />
                    <Text style={[styles.eventInfoText, { color: colors.textSecondary }]}>
                        {event.start_time ? (event.start_time + (event.end_time ? ' – ' + event.end_time : '')) : 'All Day'}
                    </Text>
                </View>
                <View style={[styles.eventInfoDivider, { backgroundColor: colors.border }]} />
                <View style={styles.eventInfoItem}>
                    <Ionicons name='location-outline' size={14} color={colors.primary} />
                    <Text style={[styles.eventInfoText, { color: colors.textSecondary }]} numberOfLines={1}>
                        {event.is_virtual ? 'Online' : (event.venue || 'Main Campus')}
                    </Text>
                </View>
                {event.max_attendees && (
                    <>
                        <View style={[styles.eventInfoDivider, { backgroundColor: colors.border }]} />
                        <View style={styles.eventInfoItem}>
                            <Ionicons name='people-outline' size={14} color={colors.primary} />
                            <Text style={[styles.eventInfoText, { color: colors.textSecondary }]}>{event.current_attendees ?? 0}/{event.max_attendees}</Text>
                        </View>
                    </>
                )}
            </View>

            {/* Description and Actions */}
            <View style={[styles.eventDescRow, { backgroundColor: colors.card, borderTopColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
                {event.description ? (
                    <Text style={[styles.eventDesc, { color: colors.textSecondary, flex: 1, marginRight: 10 }]} numberOfLines={2}>{event.description}</Text>
                ) : (
                    <Text style={[styles.eventDesc, { color: colors.primary, fontFamily: 'Inter-SemiBold', flex: 1 }]}>View full details</Text>
                )}
                
                {event.pool_id && onApply ? (
                    <TouchableOpacity
                        style={{ backgroundColor: '#10b981', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, flexDirection: 'row', alignItems: 'center' }}
                        onPress={(e) => {
                            e.stopPropagation();
                            onApply();
                        }}
                    >
                        <Ionicons name='clipboard-outline' size={14} color='#fff' />
                        <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600', marginLeft: 4 }}>Go to Pool</Text>
                    </TouchableOpacity>
                ) : (
                    <Ionicons name='chevron-forward' size={18} color={colors.textMuted} />
                )}
            </View>
        </TouchableOpacity>
    );
}

function EmptyState({ icon, text }: { icon: string; text: string }) {
    const { colors } = useTheme();
    return (
        <View style={[styles.empty, { backgroundColor: colors.card }]}>
            <View style={[styles.emptyIconBg, { backgroundColor: colors.surface }]}>
                <Ionicons name={icon as any} size={36} color={colors.textMuted} />
            </View>
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>{text}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f8fafc' },
    header: { paddingTop: Platform.OS === 'android' ? 40 : 10, paddingHorizontal: 20, paddingBottom: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
    headerTextRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    headerTitle: { fontFamily: 'Inter-Bold', fontSize: 28, color: '#0f172a' },
    headerSubtitle: { fontFamily: 'Inter-Medium', fontSize: 13, color: '#64748b', marginTop: 2 },
    headerCountBadge: { backgroundColor: '#dcfce7', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
    headerCountText: { fontFamily: 'Inter-Bold', fontSize: 14, color: '#166534' },
    searchContainer: { paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff' },
    searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f1f5f9', borderRadius: 14, paddingHorizontal: 14, height: 46, gap: 10 },
    searchInput: { flex: 1, fontFamily: 'Inter-Medium', fontSize: 14, color: '#0f172a' },
    filterRow: { flexGrow: 0, flexShrink: 0, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
    filterScroll: { paddingHorizontal: 20, paddingVertical: 0, gap: 0 },
    chip: {
        marginRight: 24,
        paddingBottom: 12,
        paddingTop: 12,
        position: 'relative',
    },
    chipText: {
        fontFamily: 'Inter-SemiBold',
        fontSize: 15,
        color: '#94a3b8',
    },
    chipTextActive: {
        color: COLORS.primary,
    },
    chipIndicator: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: 3,
        backgroundColor: COLORS.primary,
        borderRadius: 1.5,
    },
    offlineBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 10,
        paddingHorizontal: 16,
        gap: 8,
    },
    offlineText: {
        fontSize: 13,
        fontWeight: '600',
    },
    content: { flex: 1, paddingHorizontal: 16 },
    contentContainer: { paddingTop: 16, paddingBottom: 60 },

    // Announcement card
    posterCard: {
        width: '100%', height: 200,
        borderRadius: 16, overflow: 'hidden', backgroundColor: '#FFF',
        borderWidth: 1, borderColor: '#F1F5F9',
        marginBottom: 20,
        elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1, shadowRadius: 10,
    },
    posterImage: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    posterGradient: { position: 'absolute', left: 0, right: 0, bottom: 0, top: 0 },
    posterContent: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        justifyContent: 'flex-end',
        padding: 20,
    },
    posterTagRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8 },
    posterTag: {
        paddingHorizontal: 12, paddingVertical: 6,
        borderRadius: 16, borderWidth: 1,
    },
    posterTagUnread: {
        backgroundColor: 'rgba(52, 211, 153, 0.15)',
        borderColor: 'rgba(52, 211, 153, 0.5)',
    },
    posterTagRead: {
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        borderColor: 'rgba(255, 255, 255, 0.3)',
    },
    posterTagText: { fontFamily: 'Inter-Bold', fontSize: 10, color: '#FFF' },
    posterTitle: {
        fontFamily: 'Inter-Bold', fontSize: 20, color: '#FFF', marginBottom: 4,
        textShadowColor: 'rgba(0,0,0,0.3)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
    },
    posterDate: { fontFamily: 'Inter-Medium', fontSize: 12, color: 'rgba(255,255,255,0.8)' },
    posterFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
    posterSeeMore: { fontFamily: 'Inter-Bold', fontSize: 12, color: 'rgba(255,255,255,0.9)' },

    // Event card
    eventCard: { backgroundColor: '#fff', borderRadius: 20, marginBottom: 20, overflow: 'hidden', shadowColor: '#1e3a8a', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 12, elevation: 4 },
    eventHero: { height: 220, position: 'relative' },
    eventHeroOverlay: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '80%' },
    eventBadgeRow: { position: 'absolute', top: 14, left: 14, flexDirection: 'row', gap: 6 },
    eventStatusBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
    eventStatusText: { fontFamily: 'Inter-Bold', fontSize: 9, letterSpacing: 0.8 },
    virtualBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 12, backgroundColor: 'rgba(109,40,217,0.85)' },
    virtualText: { fontFamily: 'Inter-Bold', fontSize: 9, color: '#c4b5fd', letterSpacing: 0.5 },
    liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 12, backgroundColor: 'rgba(220,38,38,0.85)' },
    liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fca5a5' },
    liveText: { fontFamily: 'Inter-Bold', fontSize: 9, color: '#fca5a5', letterSpacing: 0.5 },
    eventDateChip: { position: 'absolute', top: 14, right: 14, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
    eventDateDay: { fontFamily: 'Inter-Bold', fontSize: 20, color: '#fff', lineHeight: 22 },
    eventDateMonth: { fontFamily: 'Inter-Bold', fontSize: 9, color: 'rgba(255,255,255,0.8)', letterSpacing: 1 },
    eventHeroBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16 },
    eventHeroTitle: { fontFamily: 'Inter-Bold', fontSize: 20, color: '#fff', lineHeight: 26, textShadowColor: 'rgba(0,0,0,0.4)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
    eventInfoStrip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#f8fafc', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
    eventInfoItem: { flexDirection: 'row', alignItems: 'center', gap: 5, flex: 1 },
    eventInfoText: { fontFamily: 'Inter-SemiBold', fontSize: 12, color: '#334155', flex: 1 },
    eventInfoDivider: { width: 1, height: 16, backgroundColor: '#e2e8f0', marginHorizontal: 8 },
    eventDescRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, paddingHorizontal: 16 },
    eventDesc: { fontFamily: 'Inter-Regular', fontSize: 13, color: '#64748b', flex: 1, lineHeight: 19, marginRight: 8 },

    // Empty state
    empty: { alignItems: 'center', justifyContent: 'center', marginTop: 80, gap: 12 },
    emptyIconBg: { width: 72, height: 72, borderRadius: 24, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
    emptyText: { fontFamily: 'Inter-Medium', fontSize: 15, color: '#94a3b8' },
});