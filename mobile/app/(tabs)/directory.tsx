import React, { useEffect, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    TextInput,
    Image,
    ActivityIndicator,
    RefreshControl,
    Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useDirectoryStore } from '../../src/stores';
import { COLORS } from '../../src/constants/Colors';
import { Lecturer } from '../../src/types';
import { UniversalViewer } from '../../src/components/common/UniversalViewer';

const { width } = Dimensions.get('window');

type DirectoryTab = 'staff' | 'executives';

export default function DirectoryScreen() {
    const [activeTab, setActiveTab] = useState<DirectoryTab>('staff');
    const [searchQuery, setSearchQuery] = useState('');
    const [viewerVisible, setViewerVisible] = useState(false);
    const [viewerFile, setViewerFile] = useState({ uri: '', name: '' });
    const [refreshing, setRefreshing] = useState(false);

    const {
        lecturers,
        executives,
        isLoading,
        fetchLecturers,
        fetchExecutives
    } = useDirectoryStore();

    useEffect(() => {
        loadData();
    }, [activeTab]);

    const loadData = async () => {
        if (activeTab === 'staff') {
            await fetchLecturers();
        } else {
            await fetchExecutives();
        }
    };
    const onRefresh = async () => {
        setRefreshing(true);
        try {
            await loadData();
        } finally {
            setRefreshing(false);
        }
    };
    const filteredStaff = lecturers.filter(item =>
        item.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.position?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.specialization?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const filteredExecutives = executives.filter(item => {
        const fullName = item.full_name || 'Executive';
        return (
            fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.position.toLowerCase().includes(searchQuery.toLowerCase())
        );
    });

    return (
        <View style={styles.container}>
            {/* Header */}
            <LinearGradient
                colors={[COLORS.primary, COLORS.secondary]}
                style={styles.header}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
            >
                <View style={styles.headerContent}>
                    <Text style={styles.headerTitle}>Directory</Text>
                    <Text style={styles.headerSubtitle}>Staff & Student Leadership</Text>

                    <View style={styles.searchContainer}>
                        <Ionicons name="search" size={20} color={COLORS.textSecondary} />
                        <TextInput
                            style={styles.searchInput}
                            placeholder={`Search ${activeTab === 'staff' ? 'staff' : 'executives'}...`}
                            placeholderTextColor={COLORS.textMuted}
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                        />
                        {searchQuery.length > 0 && (
                            <TouchableOpacity onPress={() => setSearchQuery('')}>
                                <Ionicons name="close-circle" size={20} color={COLORS.textSecondary} />
                            </TouchableOpacity>
                        )}
                    </View>
                </View>
            </LinearGradient>

            {/* Tabs */}
            <View style={styles.tabsContainer}>
                <TouchableOpacity
                    style={[styles.tab, activeTab === 'staff' && styles.activeTab]}
                    onPress={() => setActiveTab('staff')}
                >
                    <Ionicons
                        name="people"
                        size={20}
                        color={activeTab === 'staff' ? COLORS.primary : COLORS.textSecondary}
                    />
                    <Text style={[styles.tabText, activeTab === 'staff' && styles.activeTabText]}>
                        Departmental Staff
                    </Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.tab, activeTab === 'executives' && styles.activeTab]}
                    onPress={() => setActiveTab('executives')}
                >
                    <Ionicons
                        name="ribbon"
                        size={20}
                        color={activeTab === 'executives' ? COLORS.primary : COLORS.textSecondary}
                    />
                    <Text style={[styles.tabText, activeTab === 'executives' && styles.activeTabText]}>
                        Executives
                    </Text>
                </TouchableOpacity>
            </View>

            <ScrollView
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />
                }
            >
                {isLoading && !refreshing ? (
                    <View style={styles.loadingContainer}>
                        <ActivityIndicator size="large" color={COLORS.primary} />
                        <Text style={styles.loadingText}>Loading directory...</Text>
                    </View>
                ) : (
                    <>
                        {activeTab === 'staff' ? (
                            filteredStaff.length > 0 ? (
                                filteredStaff.map((staff) => (
                                    <StaffCard 
                                        key={staff.id} 
                                        staff={staff} 
                                        onPressAvatar={(uri, name) => {
                                            setViewerFile({ uri, name });
                                            setViewerVisible(true);
                                        }}
                                    />
                                ))
                            ) : (
                                <EmptyState message="No staff members found." />
                            )
                        ) : (
                            filteredExecutives.length > 0 ? (
                                filteredExecutives.map((exec) => (
                                    <ExecutiveCard 
                                        key={exec.id} 
                                        executive={exec} 
                                        onPressAvatar={(uri, name) => {
                                            setViewerFile({ uri, name });
                                            setViewerVisible(true);
                                        }}
                                    />
                                ))
                            ) : (
                                <EmptyState message="No executives found for this session." />
                            )
                        )}
                    </>
                )}
            </ScrollView>

            <UniversalViewer 
                isVisible={viewerVisible}
                onClose={() => setViewerVisible(false)}
                fileUri={viewerFile.uri}
                fileType="image"
                fileName={viewerFile.name}
                showDownload={false} // Requirement: Institutional profiles are restricted
                showShare={false}
                isHalfScreen={true}
            />
        </View>
    );
}

import { getCleanAvatarUrl } from '../../src/utils';
import { useOfflineImage } from '../../src/hooks/useOfflineImage';
import { CachedImage } from '../../src/components/common/CachedImage';

function StaffCard({ staff, onPressAvatar }: { staff: Lecturer, onPressAvatar: (uri: string, name: string) => void }) {
    const cleanAvatar = getCleanAvatarUrl(staff.avatar_url);
    const effectiveAvatar = cleanAvatar || `https://api.dicebear.com/9.x/fun-emoji/png?seed=${encodeURIComponent(staff.full_name)}&size=200`;
    const cachedUri = useOfflineImage(cleanAvatar);
    const initials = staff.full_name.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase();

    return (
        <View style={styles.card}>
            <View style={styles.cardHeader}>
                <TouchableOpacity 
                    style={styles.avatarContainer}
                    onPress={() => onPressAvatar(cachedUri || effectiveAvatar, staff.full_name)}
                    activeOpacity={0.8}
                >
                    <CachedImage
                        entityId={staff.id}
                        remoteUrl={effectiveAvatar}
                        assetType="lecturer"
                        style={styles.avatar}
                        fallbackName={staff.full_name}
                        fallbackInitials={initials}
                    />
                </TouchableOpacity>
                <View style={styles.staffInfo}>
                    <Text style={styles.staffName}>{staff.full_name}</Text>
                    <Text style={styles.staffTitle}>{staff.title || 'Departmental Staff'}</Text>
                    <View style={styles.positionBadge}>
                        <Text style={styles.positionText}>{staff.position || 'Lecturer'}</Text>
                    </View>
                </View>
            </View>

            <View style={styles.cardDivider} />

            <View style={styles.cardFooter}>
                <View style={styles.infoRow}>
                    <Ionicons name="school-outline" size={16} color={COLORS.primary} />
                    <Text style={styles.infoDetail}>{staff.specialization || 'Academic Excellence'}</Text>
                </View>
                <View style={styles.infoRow}>
                    <Ionicons name="location-outline" size={16} color={COLORS.primary} />
                    <Text style={styles.infoDetail}>{staff.office_location || 'Main Office'}</Text>
                </View>
                <View style={styles.actions}>
                    {staff.email && (
                        <TouchableOpacity style={styles.actionIcon}>
                            <Ionicons name="mail-outline" size={20} color={COLORS.primary} />
                        </TouchableOpacity>
                    )}
                    {staff.phone && (
                        <TouchableOpacity style={styles.actionIcon}>
                            <Ionicons name="call-outline" size={20} color={COLORS.primary} />
                        </TouchableOpacity>
                    )}
                </View>
            </View>
        </View>
    );
}

function ExecutiveCard({ executive, onPressAvatar }: { executive: any, onPressAvatar: (uri: string, name: string) => void }) {
    const fullName = executive.full_name || executive.user?.full_name || 'NALISS Executive';
    const rawAvatarUrl = executive.avatar_url || executive.user?.avatar_url;
    const cleanAvatar = getCleanAvatarUrl(rawAvatarUrl);
    const effectiveAvatar = cleanAvatar || `https://api.dicebear.com/9.x/fun-emoji/png?seed=${encodeURIComponent(fullName)}&size=200`;
    const cachedUri = useOfflineImage(cleanAvatar);
    const initials = fullName.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase();

    return (
        <View style={styles.card}>
            <View style={styles.cardHeader}>
                <TouchableOpacity 
                    style={styles.avatarContainer}
                    onPress={() => onPressAvatar(cachedUri || effectiveAvatar, fullName)}
                    activeOpacity={0.8}
                >
                    <CachedImage
                        entityId={executive.id}
                        remoteUrl={effectiveAvatar}
                        assetType="executive"
                        style={styles.avatar}
                        fallbackName={fullName}
                        fallbackInitials={initials}
                    />
                </TouchableOpacity>
                <View style={styles.staffInfo}>
                    <Text style={styles.staffName}>{fullName}</Text>
                    <Text style={styles.staffTitle}>{executive.academic_session} Session</Text>
                    <LinearGradient
                        colors={[COLORS.secondary, COLORS.primary]}
                        style={styles.execBadge}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                    >
                        <Text style={styles.execBadgeText}>{executive.position || 'Executive'}</Text>
                    </LinearGradient>
                </View>
            </View>
        </View>
    );
}

function EmptyState({ message }: { message: string }) {
    return (
        <View style={styles.emptyContainer}>
            <Ionicons name="search-outline" size={64} color={COLORS.textMuted} />
            <Text style={styles.emptyText}>{message}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: COLORS.background,
    },
    header: {
        paddingTop: 60,
        paddingBottom: 24,
        borderBottomLeftRadius: 32,
        borderBottomRightRadius: 32,
    },
    headerContent: {
        paddingHorizontal: 20,
    },
    headerTitle: {
        fontFamily: 'Inter-Bold',
        fontSize: 28,
        color: '#FFF',
    },
    headerSubtitle: {
        fontFamily: 'Inter-Medium',
        fontSize: 14,
        color: 'rgba(255,255,255,0.8)',
        marginTop: 4,
    },
    searchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFF',
        borderRadius: 16,
        paddingHorizontal: 12,
        paddingVertical: 10,
        marginTop: 20,
    },
    searchInput: {
        flex: 1,
        fontFamily: 'Inter-Medium',
        fontSize: 15,
        color: COLORS.text,
        marginLeft: 8,
    },
    tabsContainer: {
        flexDirection: 'row',
        padding: 16,
        gap: 12,
    },
    tab: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#FFF',
        paddingVertical: 12,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        gap: 8,
    },
    activeTab: {
        borderColor: COLORS.primary,
        backgroundColor: COLORS.primary + '08',
    },
    tabText: {
        fontFamily: 'Inter-SemiBold',
        fontSize: 13,
        color: COLORS.textSecondary,
    },
    activeTabText: {
        color: COLORS.primary,
    },
    scrollContent: {
        padding: 16,
        paddingBottom: 40,
    },
    loadingContainer: {
        marginTop: 100,
        alignItems: 'center',
    },
    loadingText: {
        fontFamily: 'Inter-Medium',
        fontSize: 15,
        color: COLORS.textSecondary,
        marginTop: 12,
    },
    card: {
        backgroundColor: '#FFF',
        borderRadius: 24,
        padding: 16,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#F3F4F6',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.05,
        shadowRadius: 10,
        elevation: 2,
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    avatarContainer: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 4,
    },
    avatar: {
        width: 64,
        height: 64,
        borderRadius: 20,
    },
    placeholderAvatar: {
        backgroundColor: COLORS.primary + '20',
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatarPlaceholderText: {
        fontFamily: 'Inter-Bold',
        fontSize: 24,
        color: COLORS.primary,
    },
    staffInfo: {
        flex: 1,
        marginLeft: 16,
    },
    staffName: {
        fontFamily: 'Inter-Bold',
        fontSize: 18,
        color: COLORS.text,
    },
    staffTitle: {
        fontFamily: 'Inter-Medium',
        fontSize: 13,
        color: COLORS.textSecondary,
        marginTop: 2,
    },
    positionBadge: {
        backgroundColor: '#F3F4F6',
        alignSelf: 'flex-start',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 8,
        marginTop: 6,
    },
    positionText: {
        fontFamily: 'Inter-SemiBold',
        fontSize: 11,
        color: COLORS.textSecondary,
        textTransform: 'uppercase',
    },
    execBadge: {
        alignSelf: 'flex-start',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 8,
        marginTop: 6,
    },
    execBadgeText: {
        fontFamily: 'Inter-Bold',
        fontSize: 11,
        color: '#FFF',
        textTransform: 'uppercase',
    },
    cardDivider: {
        height: 1,
        backgroundColor: '#F3F4F6',
        marginVertical: 16,
    },
    cardFooter: {
        gap: 8,
    },
    infoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    infoDetail: {
        fontFamily: 'Inter-Medium',
        fontSize: 13,
        color: COLORS.textSecondary,
        flex: 1,
    },
    actions: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 16,
        marginTop: 4,
    },
    actionIcon: {
        width: 36,
        height: 36,
        borderRadius: 12,
        backgroundColor: COLORS.primary + '10',
        alignItems: 'center',
        justifyContent: 'center',
    },
    emptyContainer: {
        marginTop: 100,
        alignItems: 'center',
    },
    emptyText: {
        fontFamily: 'Inter-Medium',
        fontSize: 15,
        color: COLORS.textMuted,
        marginTop: 16,
        textAlign: 'center',
    },
});
