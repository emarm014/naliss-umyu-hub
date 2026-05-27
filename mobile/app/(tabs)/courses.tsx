import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { useResourceStore } from '../../src/stores';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../src/constants/Colors';

const { width } = Dimensions.get('window');
const LEVELS = ['100', '200', '300', '400'];
const SEMESTERS = [
  { key: 'first', label: '1st Semester' },
  { key: 'second', label: '2nd Semester' },
];

export default function CoursesScreen() {
  const { courses, isLoading, fetchCourses, error } = useResourceStore();
  const [activeLevel, setActiveLevel] = useState('100');
  const [activeSemester, setActiveSemester] = useState<'first' | 'second'>('first');
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();

  const loadCourses = useCallback(async () => {
    await fetchCourses(activeLevel as any);
  }, [activeLevel, fetchCourses]);

  useEffect(() => {
    loadCourses();
  }, [loadCourses]);
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await loadCourses();
    } finally {
      setRefreshing(false);
    }
  };
  const filteredCourses = courses.filter(c => c.semester === activeSemester);

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[COLORS.primary, COLORS.secondary]}
        style={styles.header}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0.5 }}
      >
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle}>Courses</Text>
          <Text style={styles.headerSubtitle}>LIS Curriculum Overview</Text>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.levelSelector}
          >
            {LEVELS.map((level) => (
              <TouchableOpacity
                key={level}
                style={[
                  styles.levelChip,
                  activeLevel === level && styles.levelChipActive,
                ]}
                onPress={() => setActiveLevel(level)}
              >
                <Text
                  style={[
                    styles.levelChipText,
                    activeLevel === level && styles.levelChipTextActive,
                  ]}
                >
                  {level}L
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </LinearGradient>

      <View style={styles.semesterTabs}>
        {SEMESTERS.map((sem) => (
          <TouchableOpacity
            key={sem.key}
            style={[
              styles.semesterTab,
              activeSemester === sem.key && styles.semesterTabActive,
            ]}
            onPress={() => setActiveSemester(sem.key as any)}
          >
            <Text
              style={[
                styles.semesterTabText,
                activeSemester === sem.key && styles.semesterTabTextActive,
              ]}
            >
              {sem.label}
            </Text>
            {activeSemester === sem.key && <View style={styles.activeIndicator} />}
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.scrollPadding}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />
        }
      >
        {isLoading && courses.length === 0 ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.loadingText}>Fetching courses...</Text>
          </View>
        ) : error ? (
          <View style={styles.centerContainer}>
            <Ionicons name="cloud-offline-outline" size={48} color={COLORS.textMuted} />
            <Text style={[styles.loadingText, { marginTop: 12 }]}>Could not load courses</Text>
            <TouchableOpacity onPress={loadCourses} style={{ marginTop: 16, paddingHorizontal: 24, paddingVertical: 10, backgroundColor: COLORS.primary, borderRadius: 12 }}>
              <Text style={{ color: '#fff', fontFamily: 'Inter-Bold', fontSize: 14 }}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.coursesList}>
            {filteredCourses.length === 0 ? (
              <View style={styles.emptyState}>
                <View style={styles.emptyIconBg}>
                  <Ionicons name="book" size={32} color={COLORS.textMuted} />
                </View>
                <Text style={styles.emptyStateTitle}>No courses found</Text>
                <Text style={styles.emptyStateText}>
                  No courses listed for {activeLevel}L {activeSemester} semester.
                </Text>
              </View>
            ) : (
              filteredCourses.map((course) => (
                <TouchableOpacity
                  key={course.id}
                  style={styles.courseCard}
                  onPress={() => router.push(`/course/${course.id}` as any)}
                >
                  <View style={styles.courseTop}>
                    <View style={styles.codeBadge}>
                      <Text style={styles.codeText}>{course.code}</Text>
                    </View>
                    <View style={styles.unitsBadge}>
                      <Ionicons name="star" size={10} color="#d97706" />
                      <Text style={styles.unitsText}>{course.credit_units}U</Text>
                    </View>
                  </View>

                  <Text style={styles.courseTitle}>{course.title}</Text>

                  {course.description && (
                    <Text style={styles.courseDescription} numberOfLines={2}>
                      {course.description}
                    </Text>
                  )}

                  <View style={styles.courseDivider} />

                  <View style={styles.courseBottom}>
                    <View style={styles.lecturerInfo}>
                      <Ionicons name="person" size={12} color={COLORS.textMuted} />
                      <Text style={styles.lecturerName} numberOfLines={1}>
                        {course.lecturer_name || 'Departmental'}
                      </Text>
                    </View>
                    {course.is_core ? (
                      <View style={styles.coreTag}>
                        <Text style={styles.coreTagText}>Core</Text>
                      </View>
                    ) : (
                      <View style={styles.electiveTag}>
                        <Text style={styles.electiveTagText}>Elective</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              ))
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    paddingTop: 64,
    paddingBottom: 24,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  headerContent: {
    paddingHorizontal: 16,
  },
  headerTitle: {
    fontFamily: 'Inter-Bold',
    fontSize: 26,
    color: '#FFF',
    marginBottom: 2,
  },
  headerSubtitle: {
    fontFamily: 'Inter-Medium',
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
    marginBottom: 24,
  },
  levelSelector: {
    paddingBottom: 4,
  },
  levelChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginRight: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  levelChipActive: {
    backgroundColor: '#FFF',
    borderColor: '#FFF',
  },
  levelChipText: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
  },
  levelChipTextActive: {
    color: COLORS.primary,
  },
  semesterTabs: {
    flexDirection: 'row',
    backgroundColor: '#FFF',
    marginTop: -16,
    marginHorizontal: 16,
    borderRadius: 16,
    padding: 4,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 4,
    zIndex: 20,
    borderWidth: 1,
    borderColor: 'rgba(5, 150, 105, 0.05)',
  },
  semesterTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    position: 'relative',
  },
  semesterTabActive: {
  },
  semesterTabText: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 13,
    color: COLORS.textMuted,
  },
  semesterTabTextActive: {
    color: COLORS.primary,
  },
  activeIndicator: {
    position: 'absolute',
    bottom: 4,
    width: 16,
    height: 3,
    borderRadius: 2,
    backgroundColor: COLORS.primary,
  },
  content: {
    flex: 1,
  },
  scrollPadding: {
    paddingBottom: 32,
    paddingHorizontal: 16,
  },
  centerContainer: {
    paddingVertical: 80,
    alignItems: 'center',
  },
  loadingText: {
    fontFamily: 'Inter-Medium',
    fontSize: 14,
    color: COLORS.textMuted,
    marginTop: 12,
  },
  coursesList: {
    paddingTop: 12,
  },
  courseCard: {
    backgroundColor: '#FFF',
    borderRadius: 24,
    padding: 18,
    marginBottom: 12,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
    borderWidth: 1,
    borderColor: 'rgba(5, 150, 105, 0.05)',
  },
  courseTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  codeBadge: {
    backgroundColor: COLORS.actionMint,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  codeText: {
    fontFamily: 'Inter-Bold',
    fontSize: 11,
    color: COLORS.primary,
  },
  unitsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fffbeb',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  unitsText: {
    fontFamily: 'Inter-Bold',
    fontSize: 10,
    color: '#d97706',
    marginLeft: 3,
  },
  courseTitle: {
    fontFamily: 'Inter-Bold',
    fontSize: 16,
    color: COLORS.text,
    marginBottom: 6,
  },
  courseDescription: {
    fontFamily: 'Inter-Regular',
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 18,
    marginBottom: 14,
  },
  courseDivider: {
    height: 1,
    backgroundColor: '#f8fafc',
    marginBottom: 12,
  },
  courseBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lecturerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  lecturerName: {
    fontFamily: 'Inter-Medium',
    fontSize: 12,
    color: COLORS.textMuted,
    marginLeft: 6,
  },
  coreTag: {
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  coreTagText: {
    fontFamily: 'Inter-Bold',
    fontSize: 10,
    color: '#059669',
  },
  electiveTag: {
    backgroundColor: '#f9fafb',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  electiveTagText: {
    fontFamily: 'Inter-Bold',
    fontSize: 10,
    color: '#64748b',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    marginTop: 32,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    borderStyle: 'dashed',
    borderRadius: 32,
  },
  emptyIconBg: {
    width: 64,
    height: 64,
    borderRadius: 24,
    backgroundColor: COLORS.actionMint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(5, 150, 105, 0.05)',
  },
  emptyStateTitle: {
    fontFamily: 'Inter-Bold',
    fontSize: 18,
    color: COLORS.text,
    marginBottom: 4,
  },
  emptyStateText: {
    fontFamily: 'Inter-Medium',
    fontSize: 14,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
});
