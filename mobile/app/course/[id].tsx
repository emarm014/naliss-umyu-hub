import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS } from '../../src/constants/Colors';
import { useResourceStore } from '../../src/stores';
import { Course, Material } from '../../src/types';
import { format } from 'date-fns';
import { FileService } from '../../src/services/file.service';
import * as Linking from 'expo-linking';

export default function CourseDetailScreen() {
    const { id } = useLocalSearchParams();
    const router = useRouter();
    const { courses, materials } = useResourceStore();

    const [course, setCourse] = useState<Course | null>(null);
    const [courseMaterials, setCourseMaterials] = useState<Material[]>([]);
    const [downloadingId, setDownloadingId] = useState<string | null>(null);

    const handleDownload = async (material: Material) => {
        if (!material.file_url) {
            Alert.alert('Unavailable', 'No file attached to this material.');
            return;
        }
        setDownloadingId(material.id);
        try {
            const localUri = await FileService.downloadFile(
                material.file_url,
                material.id,
                material.file_url,
                () => {}
            );
            if (localUri) {
                await FileService.shareFile(localUri);
            } else {
                // Fallback: open in browser
                await Linking.openURL(material.file_url);
            }
        } catch {
            Alert.alert('Download Failed', 'Could not download the file. Please try again.');
        } finally {
            setDownloadingId(null);
        }
    };
    useEffect(() => {
        if (id) {
            const foundCourse = courses.find(c => c.id === id) || null;
            setCourse(foundCourse);

            const foundMaterials = materials.filter(m => m.course_id === id);
            setCourseMaterials(foundMaterials);
        }
    }, [id, courses, materials]);

    if (!course) {
        return (
            <View style={styles.loadingContainer}>
                <Text style={styles.loadingText}>Loading course details...</Text>
                <TouchableOpacity style={styles.backButtonCenter} onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/resources')}>
                    <Text style={styles.backButtonText}>Go Back</Text>
                </TouchableOpacity>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <LinearGradient
                colors={[COLORS.primary, COLORS.secondary]}
                style={styles.header}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0.5 }}
            >
                <View style={styles.headerTopRow}>
                    <TouchableOpacity style={styles.backButton} onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/resources')}>
                        <Ionicons name="chevron-back" size={24} color="#FFF" />
                    </TouchableOpacity>
                    <View style={course.is_core ? styles.coreTag : styles.electiveTag}>
                        <Text style={course.is_core ? styles.coreTagText : styles.electiveTagText}>
                            {course.is_core ? 'Core Course' : 'Elective'}
                        </Text>
                    </View>
                </View>

                <View style={styles.headerContent}>
                    <Text style={styles.courseCode}>{course.code}</Text>
                    <Text style={styles.courseTitle}>{course.title}</Text>

                    <View style={styles.headerMetaRow}>
                        <View style={styles.metaBadge}>
                            <Ionicons name="school" size={12} color="#FFF" opacity={0.8} />
                            <Text style={styles.metaBadgeText}>{course.level}L</Text>
                        </View>
                        <View style={styles.metaBadge}>
                            <Ionicons name="time" size={12} color="#FFF" opacity={0.8} />
                            <Text style={styles.metaBadgeText}>Sem {course.semester}</Text>
                        </View>
                        <View style={styles.metaBadge}>
                            <Ionicons name="star" size={12} color="#FFF" opacity={0.8} />
                            <Text style={styles.metaBadgeText}>{course.credit_units}U</Text>
                        </View>
                    </View>
                </View>
            </LinearGradient>

            <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                <View style={styles.infoCard}>
                    <Text style={styles.sectionTitle}>Course Description</Text>
                    <Text style={styles.descriptionText}>
                        {course.description || 'No description available for this course yet. Please check back later or contact the class representative.'}
                    </Text>

                    <View style={styles.divider} />

                    <Text style={styles.sectionTitle}>Lecturer Information</Text>
                    <View style={styles.lecturerRow}>
                        <View style={styles.lecturerAvatar}>
                            <Ionicons name="person" size={24} color={COLORS.primary} />
                        </View>
                        <View style={styles.lecturerDetails}>
                            <Text style={styles.lecturerName}>{course.lecturer_name || 'Departmental Staff'}</Text>
                            <Text style={styles.lecturerRole}>Course Coordinator</Text>
                        </View>
                    </View>
                </View>

                <View style={styles.materialsSection}>
                    <View style={styles.sectionHeader}>
                        <Text style={styles.sectionTitle}>Course Materials</Text>
                        <View style={styles.countBadge}>
                            <Text style={styles.materialsCount}>{courseMaterials.length}</Text>
                        </View>
                    </View>

                    {courseMaterials.length === 0 ? (
                        <View style={styles.emptyMaterials}>
                            <View style={styles.emptyIconBg}>
                                <Ionicons name="folder-open" size={28} color={COLORS.textMuted} />
                            </View>
                            <Text style={styles.emptyMaterialsText}>No materials uploaded yet</Text>
                        </View>
                    ) : (
                        courseMaterials.map((material) => (
                            <TouchableOpacity
                                key={material.id}
                                style={styles.materialCard}
                                onPress={() => handleDownload(material)}
                                activeOpacity={0.75}
                            >
                                <View style={styles.materialIconBg}>
                                    <Ionicons
                                        name={getIconForType(material.material_type)}
                                        size={22}
                                        color={COLORS.primary}
                                    />
                                </View>
                                <View style={styles.materialInfo}>
                                    <Text style={styles.materialTitle} numberOfLines={1}>{material.title}</Text>
                                    <View style={styles.materialMeta}>
                                        <Text style={styles.materialMetaText}>
                                            {material.created_at ? (() => { try { return format(new Date(material.created_at), 'MMM d'); } catch { return ''; } })() : ''}
                                        </Text>
                                        <Text style={styles.materialMetaDot}>•</Text>
                                        <Text style={styles.materialMetaText}>
                                            {material.download_count || 0} downloads
                                        </Text>
                                    </View>
                                </View>
                                <View style={styles.downloadButton}>
                                    {downloadingId === material.id ? (
                                        <Ionicons name="hourglass-outline" size={24} color={COLORS.textMuted} />
                                    ) : (
                                        <Ionicons name="arrow-down-circle" size={24} color={COLORS.primary} opacity={0.8} />
                                    )}
                                </View>
                            </TouchableOpacity>
                        ))
                    )}
                </View>

            </ScrollView>
        </View>
    );
}

function getIconForType(type: string | null | undefined) {
    switch ((type || '').toLowerCase()) {
        case 'pdf': return 'document-text';
        case 'doc':
        case 'docx': return 'document';
        case 'ppt':
        case 'pptx': return 'easel';
        case 'video': return 'videocam';
        default: return 'document-outline';
    }
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f8fafc',
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#f8fafc',
    },
    loadingText: {
        fontFamily: 'Inter-Medium',
        fontSize: 15,
        color: COLORS.textMuted,
        marginBottom: 16,
    },
    backButtonCenter: {
        paddingHorizontal: 20,
        paddingVertical: 10,
        backgroundColor: COLORS.primary,
        borderRadius: 16,
    },
    backButtonText: {
        color: '#FFF',
        fontFamily: 'Inter-Bold',
        fontSize: 14,
    },
    header: {
        paddingTop: Platform.OS === 'ios' ? 60 : 40,
        paddingBottom: 32,
        borderBottomLeftRadius: 32,
        borderBottomRightRadius: 32,
    },
    headerTopRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        marginBottom: 16,
    },
    backButton: {
        padding: 4,
    },
    headerContent: {
        paddingHorizontal: 20,
    },
    courseCode: {
        fontFamily: 'Inter-Bold',
        fontSize: 30,
        color: '#FFF',
        marginBottom: 2,
    },
    courseTitle: {
        fontFamily: 'Inter-Medium',
        fontSize: 15,
        color: 'rgba(255,255,255,0.75)',
        marginBottom: 20,
        lineHeight: 22,
    },
    headerMetaRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
    },
    metaBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.12)',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 12,
        gap: 6,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
    },
    metaBadgeText: {
        fontFamily: 'Inter-SemiBold',
        fontSize: 11,
        color: '#FFF',
    },
    coreTag: {
        backgroundColor: '#FFF',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 10,
    },
    coreTagText: {
        fontFamily: 'Inter-Bold',
        fontSize: 10,
        color: COLORS.primary,
        textTransform: 'uppercase',
    },
    electiveTag: {
        backgroundColor: 'rgba(255,255,255,0.15)',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.3)',
    },
    electiveTagText: {
        fontFamily: 'Inter-Bold',
        fontSize: 10,
        color: '#FFF',
        textTransform: 'uppercase',
    },
    content: {
        flex: 1,
        padding: 16,
    },
    infoCard: {
        backgroundColor: '#FFF',
        borderRadius: 28,
        padding: 20,
        marginTop: -16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.02,
        shadowRadius: 10,
        elevation: 2,
        marginBottom: 20,
        borderWidth: 1,
        borderColor: '#f1f5f9',
    },
    sectionHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
        paddingHorizontal: 4,
    },
    sectionTitle: {
        fontFamily: 'Inter-Bold',
        fontSize: 17,
        color: COLORS.text,
        marginBottom: 10,
    },
    descriptionText: {
        fontFamily: 'Inter-Regular',
        fontSize: 14,
        lineHeight: 22,
        color: COLORS.textSecondary,
    },
    divider: {
        height: 1,
        backgroundColor: '#f8fafc',
        marginVertical: 18,
    },
    lecturerRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    lecturerAvatar: {
        width: 44,
        height: 44,
        borderRadius: 14,
        backgroundColor: '#f1f5f9',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 14,
    },
    lecturerDetails: {
        flex: 1,
    },
    lecturerName: {
        fontFamily: 'Inter-Bold',
        fontSize: 15,
        color: COLORS.text,
        marginBottom: 2,
    },
    lecturerRole: {
        fontFamily: 'Inter-Medium',
        fontSize: 12,
        color: COLORS.textMuted,
    },
    materialsSection: {
        marginBottom: 32,
    },
    countBadge: {
        backgroundColor: '#eff6ff',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 6,
    },
    materialsCount: {
        fontFamily: 'Inter-Bold',
        fontSize: 11,
        color: COLORS.secondary,
    },
    materialCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFF',
        padding: 14,
        borderRadius: 28,
        marginBottom: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.02,
        shadowRadius: 10,
        elevation: 2,
        borderWidth: 1,
        borderColor: '#f1f5f9',
    },
    materialIconBg: {
        width: 44,
        height: 44,
        borderRadius: 12,
        backgroundColor: '#f8fafc',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 14,
    },
    materialInfo: {
        flex: 1,
    },
    materialTitle: {
        fontFamily: 'Inter-Bold',
        fontSize: 14,
        color: COLORS.text,
        marginBottom: 3,
    },
    materialMeta: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    materialMetaText: {
        fontFamily: 'Inter-Medium',
        fontSize: 11,
        color: COLORS.textMuted,
    },
    materialMetaDot: {
        marginHorizontal: 6,
        color: COLORS.textMuted,
        fontSize: 11,
    },
    downloadButton: {
        marginLeft: 8,
    },
    emptyMaterials: {
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        backgroundColor: '#FFF',
        borderRadius: 28,
        marginTop: 4,
        borderWidth: 1,
        borderColor: '#f1f5f9',
        borderStyle: 'dashed',
    },
    emptyIconBg: {
        width: 56,
        height: 56,
        borderRadius: 20,
        backgroundColor: '#f8fafc',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#f1f5f9',
    },
    emptyMaterialsText: {
        fontFamily: 'Inter-Medium',
        fontSize: 13,
        color: COLORS.textMuted,
        textAlign: 'center',
    },
});
