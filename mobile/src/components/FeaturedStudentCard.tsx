import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useTheme } from '../stores/theme.store';
import { getOptimizedCloudinaryUrl } from '../lib/cloudinary';
import { CachedImage } from './common/CachedImage';
import { UniversalViewer } from './common/UniversalViewer';

interface FeaturedStudentCardProps {
    item: {
        id: string;
        user_id: string;
        type: 'event_winner' | 'student_of_the_week' | 'legend_of_the_month';
        title: string;
        subtitle?: string | null;
        description?: string | null;
        custom_image_url?: string | null;
        total_congratulations?: number;
        users?: {
            full_name?: string;
            username?: string;
            avatar_url?: string | null;
            level?: string | null;
        };
    };
}

export function FeaturedStudentCard({ item }: FeaturedStudentCardProps) {
    const { colors, isDark } = useTheme();
    const [viewerVisible, setViewerVisible] = useState(false);

    const bgImage = item.custom_image_url || item.users?.avatar_url;
    const studentName = item.users?.full_name || 'Featured Student';
    const totalCongrats = item.total_congratulations || 0;

    const getBadgeConfig = () => {
        switch (item.type) {
            case 'legend_of_the_month':
                return {
                    gradient: ['#005A36', '#059669'] as [string, string],
                    badgeBg: '#059669',
                    icon: 'medal',
                    badgeText: '👑 LEGEND OF THE MONTH',
                    ribbonText: 'NALISS HALL OF FAME',
                };
            case 'event_winner':
                return {
                    gradient: ['#047857', '#10b981'] as [string, string],
                    badgeBg: '#10b981',
                    icon: 'trophy',
                    badgeText: '🏆 EVENT WINNER',
                    ribbonText: 'CHAMPIONSHIP HONORS',
                };
            case 'student_of_the_week':
            default:
                return {
                    gradient: ['#059669', '#d97706'] as [string, string],
                    badgeBg: '#d97706',
                    icon: 'star',
                    badgeText: '✨ STUDENT OF THE WEEK',
                    ribbonText: 'ACADEMIC EXCELLENCE',
                };
        }
    };

    const config = getBadgeConfig();

    return (
        <>
            <TouchableOpacity
                style={styles.cardContainer}
                onPress={() => {
                    if (bgImage) setViewerVisible(true);
                    else router.push('/fyb' as any);
                }}
                activeOpacity={0.9}
            >
                {/* Background Image with Cloudinary Optimization */}
                {bgImage ? (
                    <CachedImage
                        remoteUrl={getOptimizedCloudinaryUrl(bgImage, 800, 500)}
                        style={styles.bgImage}
                        entityId={`featured_card_${item.id}`}
                        assetType="fyb_poster"
                        resizeMode="cover"
                    />
                ) : (
                    <View style={[styles.bgImage, { backgroundColor: '#005A36' }]} />
                )}

                {/* Multi-stop Dark Gradient Overlay */}
                <LinearGradient
                    colors={['rgba(0,0,0,0.3)', 'rgba(0,0,0,0.5)', 'rgba(0,0,0,0.92)']}
                    locations={[0, 0.45, 1]}
                    style={styles.gradientOverlay}
                />

                {/* Top Luxury Ribbon Banner */}
                <LinearGradient
                    colors={config.gradient}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.ribbonBanner}
                >
                    <View style={styles.ribbonRow}>
                        <Ionicons name="sparkles" size={12} color="#FFF" />
                        <Text style={styles.ribbonText}>{config.ribbonText}</Text>
                        <Ionicons name="sparkles" size={12} color="#FFF" />
                    </View>

                    {/* Red Heart Count Badge */}
                    <View style={styles.heartCountBadge}>
                        <Ionicons name="heart" size={13} color="#ef4444" />
                        <Text style={styles.heartCountText}>{totalCongrats}</Text>
                    </View>
                </LinearGradient>

                {/* Card Content Footer */}
                <View style={styles.contentContainer}>
                    <View style={styles.badgeRow}>
                        <View style={[styles.badge, { backgroundColor: config.badgeBg }]}>
                            <Ionicons name={config.icon as any} size={12} color="#FFF" />
                            <Text style={styles.badgeText}>{config.badgeText}</Text>
                        </View>
                    </View>

                    <Text style={styles.title} numberOfLines={2}>
                        {item.title}
                    </Text>

                    <View style={styles.studentMetaRow}>
                        <View style={styles.avatarWrapper}>
                            <CachedImage
                                remoteUrl={item.users?.avatar_url}
                                style={styles.avatar}
                                entityId={`featured_card_avatar_${item.id}`}
                                assetType="user"
                            />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.studentName} numberOfLines={1}>
                                {studentName}
                            </Text>
                            <Text style={styles.studentSub} numberOfLines={1}>
                                {item.users?.level ? `Level ${item.users.level}` : 'LIS Department'} • Tap to view image & details
                            </Text>
                        </View>

                        <View style={styles.viewBadge}>
                            <Ionicons name="expand-outline" size={14} color="#FFF" />
                        </View>
                    </View>
                </View>
            </TouchableOpacity>

            {/* Universal Media Viewer with Save/Share restrictions for FYB */}
            {bgImage && (
                <UniversalViewer
                    isVisible={viewerVisible}
                    onClose={() => setViewerVisible(false)}
                    fileUri={bgImage}
                    fileType="image"
                    fileName={studentName}
                    showDownload={false}
                    showShare={false}
                />
            )}
        </>
    );
}

const styles = StyleSheet.create({
    cardContainer: {
        width: '100%',
        height: 220,
        borderRadius: 24,
        overflow: 'hidden',
        position: 'relative',
        marginBottom: 16,
        borderWidth: 1.5,
        borderColor: 'rgba(255, 255, 255, 0.2)',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.25,
        shadowRadius: 12,
        elevation: 8,
        backgroundColor: '#0f172a',
    },
    bgImage: {
        ...StyleSheet.absoluteFillObject,
        width: '100%',
        height: '100%',
    },
    gradientOverlay: {
        ...StyleSheet.absoluteFillObject,
    },
    ribbonBanner: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 14,
        paddingVertical: 7,
    },
    ribbonRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    ribbonText: {
        color: '#FFFFFF',
        fontSize: 10,
        fontWeight: '900',
        letterSpacing: 1,
        textTransform: 'uppercase',
    },
    heartCountBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        paddingHorizontal: 9,
        paddingVertical: 3,
        borderRadius: 12,
        gap: 4,
    },
    heartCountText: {
        fontSize: 12,
        fontWeight: '900',
        color: '#ef4444',
    },
    contentContainer: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        padding: 16,
    },
    badgeRow: {
        flexDirection: 'row',
        marginBottom: 6,
    },
    badge: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 14,
        gap: 5,
    },
    badgeText: {
        color: '#FFFFFF',
        fontSize: 10,
        fontWeight: '900',
        letterSpacing: 0.5,
    },
    title: {
        color: '#FFFFFF',
        fontSize: 18,
        fontWeight: '900',
        lineHeight: 22,
        marginBottom: 10,
        textShadowColor: 'rgba(0, 0, 0, 0.7)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 4,
    },
    studentMetaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    avatarWrapper: {
        width: 34,
        height: 34,
        borderRadius: 17,
        borderWidth: 2,
        borderColor: '#fbbf24',
        overflow: 'hidden',
    },
    avatar: {
        width: '100%',
        height: '100%',
    },
    studentName: {
        color: '#FFFFFF',
        fontSize: 13,
        fontWeight: '800',
    },
    studentSub: {
        color: 'rgba(255, 255, 255, 0.75)',
        fontSize: 11,
        fontWeight: '500',
    },
    viewBadge: {
        width: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: 'rgba(255, 255, 255, 0.25)',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.4)',
    },
});
