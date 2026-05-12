import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  ActivityIndicator,
  Image,
  Dimensions,
  Platform,
  Modal,
  Alert,
  Linking,
  KeyboardAvoidingView,
} from 'react-native';
import { useResourceStore, useDirectoryStore, useAuthStore } from '../../src/stores';
import { downloadFile, extractFileNameFromUrl } from '../../src/utils/download';
import { NalissLogo } from '../../src/components/NalissLogo';
import { getOptimizedCloudinaryUrl } from '../../src/lib/cloudinary';
import { Material, Course, Lecturer, Executive, AcademicLevel } from '../../src/types';
import { UniversalViewer } from '../../src/components/common/UniversalViewer';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../src/constants/Colors';
import { router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as WebBrowser from 'expo-web-browser';
import * as FileSystem from 'expo-file-system';
import { useTheme } from '../../src/stores/theme.store';
import * as Sharing from 'expo-sharing';

const { width } = Dimensions.get('window');

type MainTab = 'materials' | 'courses' | 'past_q' | 'directory';
type DirectoryTab = 'staff' | 'executives';

const LEVELS: { key: AcademicLevel | 'all'; label: string }[] = [
  { key: 'all', label: 'All Levels' },
  { key: '100', label: '100L' },
  { key: '200', label: '200L' },
  { key: '300', label: '300L' },
  { key: '400', label: '400L' },
];

export default function ResourcesScreen() {
  const params = useLocalSearchParams();
  const { colors, isDark } = useTheme();
  const { 
    materials,
    pastQuestions,
    courses, 
    downloadedIds,
    isLoading: resourcesLoading, 
    fetchMaterials,
    fetchPastQuestions,
    fetchCourses, 
    incrementDownloadCount,
    incrementViewCount,
    refreshDownloadedStatus,
    deleteResource,
  } = useResourceStore();
  const { lecturers, executives, isLoading: directoryLoading, fetchLecturers, fetchExecutives } = useDirectoryStore();

  const { profile: user } = useAuthStore();
  const [activeMainTab, setActiveMainTab] = useState<MainTab>((params.tab as MainTab) || 'materials');
  const [activeDirectoryTab, setActiveDirectoryTab] = useState<DirectoryTab>('staff');
  const [selectedLevel, setSelectedLevel] = useState<AcademicLevel | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    if (params.tab) {
      setActiveMainTab(params.tab as MainTab);
    }
  }, [params.tab]);
  
  // Selection for details
  const [selectedStaff, setSelectedStaff] = useState<Lecturer | null>(null);
  const [selectedExec, setSelectedExec] = useState<any | null>(null);

  const [readerVisible, setReaderVisible] = useState(false);
  const [readerUrl, setReaderUrl] = useState<string>('');
  const [readerFileType, setReaderFileType] = useState<'image' | 'video' | 'pdf' | 'audio' | 'document'>('document');
  const [readerTitle, setReaderTitle] = useState('');
  const [readerId, setReaderId] = useState<string | undefined>(undefined);

  const isAdmin = user?.role === 'super_admin' || user?.role === ('system_owner' as any);

  const isLoading = (resourcesLoading || directoryLoading) && 
                    materials.length === 0 && 
                    courses.length === 0 && 
                    lecturers.length === 0;

  const loadData = useCallback(async (silent = false) => {
    // Always fetch ALL levels — filtering is done client-side from the cache.
    // force=true ensures we always get all levels, not a cached subset.
    const tasks = [];
    if (activeMainTab === 'materials') tasks.push(fetchMaterials({}, true));
    if (activeMainTab === 'past_q') tasks.push(fetchPastQuestions({}, true));
    if (activeMainTab === 'courses') tasks.push(fetchCourses(undefined, true));
    if (activeMainTab === 'directory') {
      if (activeDirectoryTab === 'staff') tasks.push(fetchLecturers());
      else tasks.push(fetchExecutives());
    }

    await Promise.all(tasks);
  }, [activeMainTab, activeDirectoryTab, fetchMaterials, fetchPastQuestions, fetchCourses, fetchLecturers, fetchExecutives]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await loadData();
    setIsRefreshing(false);
  };

  const handleRead = async (material: Material) => {
    if (!material.file_url) return;
    try {
      let fileType: 'image' | 'video' | 'pdf' | 'audio' | 'document' = 'document';
      const mType = (material as any).material_type?.toLowerCase() || '';
      const mime = ((material as any).file_mime_type || '').toLowerCase();
      const url = material.file_url.toLowerCase();
      const fileName = (material.file_name || material.file_url).toLowerCase();

      // Priority 1: File extension (most reliable — from actual filename)
      if (fileName.match(/\.(mp4|mov|avi|webm|mkv|m4v)$/)) {
        fileType = 'video';
      } else if (fileName.match(/\.(mp3|wav|ogg|aac|m4a|flac)$/)) {
        fileType = 'audio';
      } else if (fileName.match(/\.(pdf)$/)) {
        fileType = 'pdf';
      } else if (fileName.match(/\.(jpg|jpeg|png|gif|webp|svg|bmp|tiff|heic)$/)) {
        fileType = 'image';
      } else if (fileName.match(/\.(doc|docx|ppt|pptx|xls|xlsx|txt|csv)$/)) {
        fileType = 'document';
      }
      // Priority 2: MIME type from database
      else if (mime.includes('video/')) {
        fileType = 'video';
      } else if (mime.includes('audio/')) {
        fileType = 'audio';
      } else if (mime.includes('pdf')) {
        fileType = 'pdf';
      } else if (mime.includes('image/')) {
        fileType = 'image';
      } else if (mime.includes('word') || mime.includes('presentation') || mime.includes('spreadsheet') || mime.includes('text/')) {
        fileType = 'document';
      }
      // Priority 3: material_type field set by admin
      else if (mType === 'video') {
        fileType = 'video';
      } else if (mType === 'image') {
        fileType = 'image';
      } else if (mType === 'pdf' || mType === 'note' || mType === 'assignment') {
        fileType = 'pdf';
      } else if (mType === 'word' || mType === 'ppt' || mType === 'document') {
        fileType = 'document';
      }
      // Priority 4: Cloudinary path (least reliable — PDFs end up under /image/upload/)
      else if (url.includes('/video/upload/')) {
        fileType = 'video';
      } else if (url.includes('/raw/upload/')) {
        fileType = 'pdf'; // raw = non-image/video = document/pdf
      } else if (url.includes('/image/upload/')) {
        fileType = 'image'; // /image/upload/ with no extension = image (Cloudinary default)
      }
      // Default: document (safest fallback — viewer handles unknown formats)

      const displayName = material.file_name || extractFileNameFromUrl(material.file_url, material.title);

      // Use local vault file if already downloaded — works offline, faster
      let fileUri = material.file_url;
      try {
        const { getVaultFilePath, checkFileExists } = require('../../src/utils/download');
        const safeName = displayName.replace(/[^a-z0-9._-]/gi, '_').toLowerCase();
        const vaultFileName = `${material.id}_${safeName}`;
        const isInVault = await checkFileExists(vaultFileName);
        if (isInVault) {
          fileUri = getVaultFilePath(material.id, displayName);
        }
      } catch {
        // Vault check failed — fall back to Cloudinary URL (requires internet)
      }

      setReaderUrl(fileUri);
      setReaderFileType(fileType);
      setReaderTitle(displayName);
      setReaderId(material.id);
      setReaderVisible(true);

      const type = (material as any).material_type ? 'material' : 'past_question';
      await incrementViewCount(material.id, type);
    } catch {
      Alert.alert('Error', 'Could not open the viewer.');
    }
  };

  const handleDownload = async (material: Material) => {
    if (!material.file_url) return;
    try {
      const displayName = material.file_name || extractFileNameFromUrl(material.file_url, material.title);
      const resultUri = await downloadFile(material.file_url, material.id, displayName);
      if (resultUri) {
        // Only count and refresh if download actually succeeded
        const type = (material as any).material_type ? 'material' : 'past_question';
        await incrementDownloadCount(material.id, type);
        await refreshDownloadedStatus();
      }
    } catch {
      // downloadFile already shows alert
    }
  };

  const handleDelete = async (id: string, type: 'materials' | 'past_questions') => {
    try {
        await deleteResource(id, type);
        Alert.alert('Success', 'Resource removed from library.');
    } catch {
        Alert.alert('Error', 'Failed to remove this resource. Please try again.');
    }
  };

  const filteredMaterials = useMemo(() => {
    let list = activeMainTab === 'past_q' ? (pastQuestions as any[]) : (materials as any[]);

    // Level filter — 'all' shows everything, specific level shows only that level
    // Items with null level are global (apply to all levels) — always included
    if (selectedLevel !== 'all') {
      list = list.filter(m => !m.level || m.level === selectedLevel);
    }

    // Search filter
    return list.filter(m =>
      m.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (m.description?.toLowerCase() || '').includes(searchQuery.toLowerCase())
    );
  }, [materials, pastQuestions, activeMainTab, searchQuery, selectedLevel]);

  const materialsBySemester = useMemo(() => {
    return {
      first: filteredMaterials.filter(m => m.semester === 'first'),
      second: filteredMaterials.filter(m => m.semester === 'second'),
      unassigned: filteredMaterials.filter(m => !m.semester),
    };
  }, [filteredMaterials]);

  const filteredCourses = useMemo(() => {
    let list = courses as any[];

    // Level filter — same logic as materials
    if (selectedLevel !== 'all') {
      list = list.filter(c => !c.level || c.level === selectedLevel);
    }

    return list.filter(c =>
      c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.code.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [courses, searchQuery, selectedLevel]);

  const coursesBySemester = useMemo(() => {
    return {
        first: filteredCourses.filter(c => c.semester === 'first'),
        second: filteredCourses.filter(c => c.semester === 'second'),
    };
  }, [filteredCourses]);

  const filteredLecturers = useMemo(() => {
    return lecturers.filter(l =>
      l.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (l.position?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
      (l.title?.toLowerCase() || '').includes(searchQuery.toLowerCase())
    );
  }, [lecturers, searchQuery]);

  const filteredExecutives = useMemo(() => {
    return executives.filter(e => {
      const name = e.user?.full_name || e.full_name || 'Executive';
      const position = e.position || '';
      return name.toLowerCase().includes(searchQuery.toLowerCase()) ||
             position.toLowerCase().includes(searchQuery.toLowerCase());
    });
  }, [executives, searchQuery]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Premium Header */}
      <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <View style={styles.headerTop}>
          <View style={styles.headerLogoContainer}>
            <View style={[styles.logoCircle, { backgroundColor: colors.surface }]}>
                <NalissLogo size={30} />
            </View>
            <View>
              <Text style={[styles.headerTitle, { color: colors.text }]}>Academic Library</Text>
              <Text style={[styles.headerSubtitle, { color: colors.textMuted }]}>NALISS UMYU HUB</Text>
            </View>
          </View>
        </View>

        <View style={[styles.searchBar, { backgroundColor: colors.surface }]}>
          <Ionicons name="search" size={20} color={colors.textMuted} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder={`Search ${activeMainTab === 'directory' ? 'staff or executives' : 'LIS codes or titles'}...`}
            placeholderTextColor={colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery !== '' && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <Ionicons name="close-circle" size={18} color={colors.textMuted} />
              </TouchableOpacity>
          )}
        </View>

        <View style={[styles.mainTabs, { borderBottomColor: colors.border }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20 }}>
            {(['materials', 'courses', 'past_q', 'directory'] as MainTab[]).map(tab => (
              <TouchableOpacity 
                key={tab} 
                onPress={() => setActiveMainTab(tab)}
                style={styles.mainTab}
              >
                <Text style={[styles.mainTabText, { color: activeMainTab === tab ? COLORS.primary : colors.textMuted }, activeMainTab === tab && styles.activeMainTabText]}>
                  {tab === 'past_q' ? 'Past Q' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                </Text>
                {activeMainTab === tab && <View style={styles.tabIndicator} />}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>

      {/* Level Filters - Hidden for Directory */}
      {activeMainTab !== 'directory' && (
        <View style={[styles.levelFilterSection, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.levelScroll}>
            {LEVELS.map(level => (
              <TouchableOpacity
                key={level.key}
                onPress={() => setSelectedLevel(level.key)}
                style={[styles.levelChip, selectedLevel === level.key && styles.activeLevelChip, { backgroundColor: selectedLevel === level.key ? COLORS.primary : colors.surface }]}
              >
                <Text style={[styles.levelChipText, { color: selectedLevel === level.key ? '#fff' : colors.textSecondary }]}>
                  {level.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      <ScrollView 
        style={[styles.content, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.scrollPadding}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
      >
        {activeMainTab === 'materials' || activeMainTab === 'past_q' ? (
          <MaterialsTabContent 
            loading={isLoading} 
            materialsBySemester={materialsBySemester} 
            downloadedIds={downloadedIds}
            handleDownload={handleDownload}
            handleRead={handleRead}
            handleDelete={handleDelete}
            type={activeMainTab}
            searchQuery={searchQuery}
          />
        ) : activeMainTab === 'courses' ? (
          <CoursesTabContent loading={isLoading} coursesBySemester={coursesBySemester} searchQuery={searchQuery} />
        ) : (
          <DirectoryTabContent 
            activeTab={activeDirectoryTab} 
            setActiveTab={setActiveDirectoryTab}
            lecturers={filteredLecturers}
            executives={filteredExecutives}
            loading={isLoading}
            onStaffPress={(l: Lecturer) => router.push({ pathname: '/directory/lecturer/[id]', params: { id: l.id } } as any)}
            onExecPress={(e: any) => router.push({ pathname: '/directory/executive/[id]', params: { id: e.id } } as any)}
            searchQuery={searchQuery}
          />
        )}
      </ScrollView>

      {/* Secure In-App Universal Media Viewer */}
      <UniversalViewer
        isVisible={readerVisible}
        onClose={() => setReaderVisible(false)}
        fileUri={readerUrl}
        fileType={readerFileType}
        fileName={readerTitle}
        fileId={readerId}
      />
    </View>
  );
}

// Sub-components

function MaterialsTabContent({ loading, materialsBySemester, downloadedIds, handleDownload, handleRead, handleDelete, type, searchQuery }: any) {
  if (loading && materialsBySemester.first.length === 0 && materialsBySemester.second.length === 0) {
    return <ActivityIndicator style={{ marginTop: 40 }} color={COLORS.primary} />;
  }

  const titlePrefix = type === 'past_q' ? 'PAST QUESTIONS' : 'STUDY MATERIALS';
  const totalCount = materialsBySemester.first.length + materialsBySemester.second.length + materialsBySemester.unassigned.length;

  if (totalCount === 0 && !loading) {
      return <EmptySection query={searchQuery} />;
  }

  return (
    <View style={styles.tabContent}>
      {materialsBySemester.first.length > 0 && (
          <>
            <SectionHead title={`1ST SEMESTER ${titlePrefix}`} count={materialsBySemester.first.length} />
            {materialsBySemester.first.map((m: Material) => (
              <ResourceCard 
                key={m.id} 
                material={m} 
                isDownloaded={downloadedIds.includes(m.id)}
                onDownload={() => handleDownload(m)} 
                onRead={() => handleRead(m)}
                onDelete={() => handleDelete(m.id, type === 'past_q' ? 'past_questions' : 'materials')}
              />
            ))}
          </>
      )}

      {materialsBySemester.second.length > 0 && (
          <>
            <SectionHead title={`2ND SEMESTER ${titlePrefix}`} count={materialsBySemester.second.length} />
            {materialsBySemester.second.map((m: Material) => (
              <ResourceCard 
                key={m.id} 
                material={m} 
                isDownloaded={downloadedIds.includes(m.id)}
                onDownload={() => handleDownload(m)} 
                onRead={() => handleRead(m)}
                onDelete={() => handleDelete(m.id, type === 'past_q' ? 'past_questions' : 'materials')}
              />
            ))}
          </>
      )}

      {materialsBySemester.unassigned.length > 0 && (
          <>
            <SectionHead title="GENERAL MATERIALS" count={materialsBySemester.unassigned.length} />
            {materialsBySemester.unassigned.map((m: Material) => (
                <ResourceCard 
                    key={m.id} 
                    material={m} 
                    isDownloaded={downloadedIds.includes(m.id)}
                    onDownload={() => handleDownload(m)} 
                    onRead={() => handleRead(m)}
                    onDelete={() => handleDelete(m.id, type === 'past_q' ? 'past_questions' : 'materials')}
                />
            ))}
          </>
      )}
    </View>
  );
}


function CoursesTabContent({ loading, coursesBySemester, searchQuery }: any) {
  if (loading && coursesBySemester.first.length === 0 && coursesBySemester.second.length === 0) {
    return <ActivityIndicator style={{ marginTop: 40 }} color={COLORS.primary} />;
  }

  const totalCount = coursesBySemester.first.length + coursesBySemester.second.length;
  if (totalCount === 0 && !loading) {
      return <EmptySection query={searchQuery} />;
  }

  return (
    <View style={styles.tabContent}>
      {coursesBySemester.first.length > 0 && (
          <>
            <SectionHead title="1ST SEMESTER COURSES" count={coursesBySemester.first.length} />
            {coursesBySemester.first.map((c: Course) => (
              <CourseTile key={c.id} course={c} />
            ))}
          </>
      )}

      {coursesBySemester.second.length > 0 && (
          <>
            <SectionHead title="2ND SEMESTER COURSES" count={coursesBySemester.second.length} />
            {coursesBySemester.second.map((c: Course) => (
              <CourseTile key={c.id} course={c} />
            ))}
          </>
      )}
    </View>
  );
}

function DirectoryTabContent({ activeTab, setActiveTab, lecturers, executives, loading, onStaffPress, onExecPress, searchQuery }: any) {
  if (loading && lecturers.length === 0 && executives.length === 0) {
      return <ActivityIndicator color={COLORS.primary} style={{ marginTop: 20 }} />;
  }

  const currentListSize = activeTab === 'staff' ? lecturers.length : executives.length;

  return (
    <View style={styles.tabContent}>
      {/* Tab switcher */}
      <View style={styles.directoryTabs}>
        <TouchableOpacity
          style={[styles.dirTab, activeTab === 'staff' && styles.activeDirTab]}
          onPress={() => setActiveTab('staff')}
        >
          <Ionicons name="school" size={14} color={activeTab === 'staff' ? '#fff' : '#64748b'} />
          <Text style={[styles.dirTabText, activeTab === 'staff' && styles.activeDirTabText]}>Lecturers</Text>
          {lecturers.length > 0 && (
            <View style={[styles.dirTabBadge, activeTab === 'staff' && { backgroundColor: 'rgba(255,255,255,0.25)' }]}>
              <Text style={[styles.dirTabBadgeText, activeTab === 'staff' && { color: '#fff' }]}>{lecturers.length}</Text>
            </View>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.dirTab, activeTab === 'executives' && styles.activeDirTabExec]}
          onPress={() => setActiveTab('executives')}
        >
          <Ionicons name="star" size={14} color={activeTab === 'executives' ? '#fff' : '#64748b'} />
          <Text style={[styles.dirTabText, activeTab === 'executives' && styles.activeDirTabText]}>Executives</Text>
          {executives.length > 0 && (
            <View style={[styles.dirTabBadge, activeTab === 'executives' && { backgroundColor: 'rgba(255,255,255,0.25)' }]}>
              <Text style={[styles.dirTabBadgeText, activeTab === 'executives' && { color: '#fff' }]}>{executives.length}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {currentListSize === 0 && !loading ? (
          <EmptySection query={searchQuery} />
      ) : activeTab === 'staff' ? (
        // Lecturers — single column, official card layout
        lecturers.map((l: Lecturer) => (
          <StaffTile key={l.id} lecturer={l} onPress={() => onStaffPress(l)} />
        ))
      ) : (
        // Executives — single column, same layout as lecturers
        executives.map((e: any) => (
          <ExecTile key={e.id} executive={e} onPress={() => onExecPress(e)} />
        ))
      )}
    </View>
  );
}

function ResourceCard({ material, isDownloaded, onDownload, onRead, onDelete }: { material: Material, isDownloaded: boolean, onDownload: () => void, onRead: () => void, onDelete: () => void }) {
  const url = (material.file_url || '').toLowerCase();
  const mime = (material.file_mime_type || '').toLowerCase();
  const [downloadProgress, setDownloadProgress] = React.useState<number | null>(null);
  const [localDownloaded, setLocalDownloaded] = React.useState(isDownloaded);
  const { profile } = useAuthStore();
  const isMountedRef = React.useRef(true);

  React.useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // Sync with parent's downloadedIds
  React.useEffect(() => { setLocalDownloaded(isDownloaded); }, [isDownloaded]);

  // Detect file type
  const isPdf = mime.includes('pdf') || url.endsWith('.pdf');
  const isImage = mime.includes('image') || url.match(/\.(jpg|jpeg|png|webp|gif|svg)$/) !== null;
  const isVideo = mime.includes('video') || url.match(/\.(mp4|mov|avi|webm)$/) !== null;
  const isWord = mime.includes('word') || url.match(/\.(doc|docx)$/) !== null;
  const isPpt = mime.includes('presentation') || url.match(/\.(ppt|pptx)$/) !== null;

  const fileTypeConfig = isPdf
    ? { label: 'PDF', bg: '#FEE2E2', color: '#EF4444', icon: 'document-text' }
    : isImage
    ? { label: 'IMG', bg: '#FEF3C7', color: '#D97706', icon: 'image' }
    : isVideo
    ? { label: 'VID', bg: '#F3E8FF', color: '#9333EA', icon: 'film' }
    : isWord
    ? { label: 'DOC', bg: '#DBEAFE', color: '#2563EB', icon: 'document' }
    : isPpt
    ? { label: 'PPT', bg: '#FFF7ED', color: '#EA580C', icon: 'easel' }
    : { label: 'FILE', bg: '#F1F5F9', color: '#64748B', icon: 'attach' };

  const fileSizeMB = ((material.file_size || 0) / 1024 / 1024).toFixed(1);

  const handleDownloadPress = async () => {
    if (localDownloaded) {
      // Already downloaded — open directly
      onRead();
      return;
    }
    if (downloadProgress !== null) return; // Already downloading

    setDownloadProgress(1); // show bar immediately
    try {
      const { downloadFile: dl } = require('../../src/utils/download');
      const displayName = material.file_name || extractFileNameFromUrl(material.file_url!, material.id);

      const resultUri = await dl(
        material.file_url!,
        material.id,
        displayName,
        (p: number) => {
          // p is 0-1 from downloadFile — show real progress 1-100%
          const pct = Math.round(p * 100);
          setDownloadProgress(Math.max(pct, 1));
        }
      );

      if (resultUri) {
        // Real file downloaded and validated — show 100% briefly then mark done
        setDownloadProgress(100);
        setTimeout(() => {
          if (!isMountedRef.current) return; // guard against unmounted component
          setLocalDownloaded(true);
          setDownloadProgress(null);
          onDownload();
        }, 400);
      } else {
        // null = download failed — downloadFile already showed the error alert
        if (isMountedRef.current) setDownloadProgress(null);
      }
    } catch {
      if (isMountedRef.current) setDownloadProgress(null);
    }
  };

  return (
    <View style={[
      styles.resourceCard,
      localDownloaded && styles.resourceCardDownloaded,
    ]}>
      {/* Left: file type icon */}
      <View style={[styles.resIconBox, { backgroundColor: fileTypeConfig.bg }]}>
        <Ionicons name={fileTypeConfig.icon as any} size={22} color={fileTypeConfig.color} />
        <View style={[styles.resTypeBadge, { backgroundColor: fileTypeConfig.color }]}>
          <Text style={styles.resTypeBadgeText}>{fileTypeConfig.label}</Text>
        </View>
      </View>

      {/* Center: info */}
      <View style={styles.resInfo}>
        <Text style={styles.resTitle} numberOfLines={2}>{material.title}</Text>
        <View style={styles.resMetaRow}>
          <Text style={styles.resMeta}>{fileSizeMB} MB</Text>
          {localDownloaded && (
            <View style={styles.offlinePill}>
              <Ionicons name="checkmark-circle" size={11} color="#166534" />
              <Text style={styles.offlinePillText}>Saved offline</Text>
            </View>
          )}
        </View>

        {/* Download progress bar */}
        {downloadProgress !== null && (
          <View style={styles.progressBarOuter}>
            <View style={[styles.progressBarInner, { width: `${downloadProgress}%` as any }]} />
            <Text style={styles.progressText}>{downloadProgress}%</Text>
          </View>
        )}
      </View>

      {/* Right: actions */}
      <View style={styles.resActions}>
        {/* Delete button — super_admin only, never shown to students or moderators */}
        {profile?.role === 'super_admin' && (
          <TouchableOpacity
            onPress={() => Alert.alert('Delete Resource', 'Permanently remove this item?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: onDelete },
            ])}
            style={[styles.resActionBtn, { backgroundColor: '#FEF2F2' }]}
          >
            <Ionicons name="trash-outline" size={18} color="#EF4444" />
          </TouchableOpacity>
        )}

        {/* Read/Open button */}
        <TouchableOpacity
          onPress={onRead}
          style={[styles.resActionBtn, { backgroundColor: localDownloaded ? '#f0fdf4' : COLORS.actionBlue }]}
        >
          <Ionicons
            name={localDownloaded ? 'book' : 'eye-outline'}
            size={18}
            color={localDownloaded ? '#166534' : COLORS.primary}
          />
        </TouchableOpacity>

        {/* Download / Saved button */}
        <TouchableOpacity
          onPress={handleDownloadPress}
          disabled={downloadProgress !== null}
          style={[
            styles.resDownloadBtn,
            localDownloaded && styles.resDownloadBtnDone,
            downloadProgress !== null && styles.resDownloadBtnActive,
          ]}
        >
          {downloadProgress !== null ? (
            <View style={styles.downloadCircle}>
              <Text style={styles.downloadCircleText}>{downloadProgress}%</Text>
            </View>
          ) : localDownloaded ? (
            <Ionicons name="checkmark-circle" size={20} color="#166534" />
          ) : (
            <Ionicons name="cloud-download-outline" size={20} color="#fff" />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function CourseTile({ course }: { course: Course }) {
  const code = course.code?.toUpperCase() || '';
  const creditNum = course.credit_units || 0;
  const level = String(course.level || '100');

  // Per-level palette — brand green base + level accent touch from dashboard themes
  const LEVEL_PALETTE: Record<string, { grad: [string, string]; accent: string; bg: string; text: string }> = {
    '100': { grad: ['#064e3b', '#059669'], accent: '#fbbf24', bg: '#f0fdf4', text: '#166534' },   // green + gold accent
    '200': { grad: ['#14532d', '#15803d'], accent: '#34d399', bg: '#ecfdf5', text: '#047857' },   // mid green + emerald
    '300': { grad: ['#1B5E20', '#2d6a4f'], accent: '#6ee7b7', bg: '#f0fdf4', text: '#065f46' },   // forest green + teal
    '400': { grad: ['#1c1917', '#1B5E20'], accent: '#f59e0b', bg: '#fefce8', text: '#92400e' },   // dark green + amber
  };

  const palette = LEVEL_PALETTE[level] || LEVEL_PALETTE['100'];

  const semLabel = course.semester === 'first' ? '1st Sem' : course.semester === 'second' ? '2nd Sem' : '';
  const lecturerName = (course as any).lecturer?.full_name || (course as any).lecturer_name || null;

  return (
    <View style={styles.courseCard}>
      {/* Gradient strip — left side */}
      <LinearGradient colors={palette.grad} style={styles.courseStrip} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}>
        <Text style={styles.courseStripCode} numberOfLines={2}>{code}</Text>
        <View style={styles.courseStripUnits}>
          <Text style={styles.courseStripUnitsNum}>{creditNum}</Text>
          <Text style={styles.courseStripUnitsLabel}>CR</Text>
        </View>
      </LinearGradient>

      {/* Content */}
      <View style={styles.courseContent}>
        <Text style={styles.courseTitleNew} numberOfLines={2}>{course.title}</Text>

        {/* Info pills row */}
        <View style={styles.coursePillRow}>
          {semLabel ? (
            <View style={[styles.coursePill, { backgroundColor: palette.bg }]}>
              <Ionicons name="calendar-outline" size={9} color={palette.text} />
              <Text style={[styles.coursePillText, { color: palette.text }]}>{semLabel}</Text>
            </View>
          ) : null}
          <View style={[styles.coursePill, { backgroundColor: palette.bg }]}>
            <Ionicons name="school-outline" size={9} color={palette.text} />
            <Text style={[styles.coursePillText, { color: palette.text }]}>Level {course.level}</Text>
          </View>
          {course.is_core && (
            <View style={[styles.coursePill, { backgroundColor: '#fef3c7' }]}>
              <Ionicons name="star" size={9} color="#d97706" />
              <Text style={[styles.coursePillText, { color: '#92400e' }]}>Core</Text>
            </View>
          )}
        </View>

        {/* Lecturer */}
        <View style={styles.courseLecturerRow}>
          <Ionicons name="person-circle-outline" size={13} color={COLORS.textMuted} />
          <Text style={styles.courseLecturerText} numberOfLines={1}>
            {lecturerName || 'Staff Not Assigned'}
          </Text>
        </View>
      </View>
    </View>
  );
}

function StaffTile({ lecturer, onPress }: { lecturer: Lecturer, onPress: () => void }) {
  const hasPhoto = !!lecturer.avatar_url;
  const initials = lecturer.full_name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  const title = lecturer.title || 'Lecturer';
  const position = lecturer.position || 'Departmental Staff';

  return (
    <TouchableOpacity style={styles.lecturerCard} onPress={onPress} activeOpacity={0.92}>
      {/* Gradient header strip */}
      <LinearGradient
        colors={['#064e3b', '#1B5E20', '#2E7D32']}
        style={styles.lecturerHeader}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
      >
        {/* Avatar */}
        <View style={styles.lecturerAvatarRing}>
          {hasPhoto ? (
            <Image source={{ uri: getOptimizedCloudinaryUrl(lecturer.avatar_url!, 200, 200) }} style={styles.lecturerAvatar} />
          ) : (
            <View style={styles.lecturerAvatarPlaceholder}>
              <Text style={styles.lecturerInitials}>{initials}</Text>
            </View>
          )}
        </View>

        {/* Title badge */}
        <View style={styles.lecturerTitleBadge}>
          <Ionicons name="school" size={10} color="#fbbf24" />
          <Text style={styles.lecturerTitleText}>{title.toUpperCase()}</Text>
        </View>
      </LinearGradient>

      {/* Body */}
      <View style={styles.lecturerBody}>
        <Text style={styles.lecturerName} numberOfLines={1}>{lecturer.full_name}</Text>
        <Text style={styles.lecturerPosition} numberOfLines={1}>{position}</Text>

        {/* Specialization pill */}
        {lecturer.specialization && (
          <View style={styles.lecturerSpecPill}>
            <Ionicons name="ribbon-outline" size={10} color="#166534" />
            <Text style={styles.lecturerSpecText} numberOfLines={1}>{lecturer.specialization}</Text>
          </View>
        )}

        {/* Contact row */}
        <View style={styles.lecturerContactRow}>
          {lecturer.email && (
            <View style={styles.lecturerContactChip}>
              <Ionicons name="mail-outline" size={11} color="#64748b" />
            </View>
          )}
          {lecturer.phone && (
            <View style={styles.lecturerContactChip}>
              <Ionicons name="call-outline" size={11} color="#64748b" />
            </View>
          )}
          <View style={{ flex: 1 }} />
          <Ionicons name="chevron-forward" size={16} color="#cbd5e1" />
        </View>
      </View>
    </TouchableOpacity>
  );
}

function ExecTile({ executive, onPress }: { executive: any, onPress: () => void }) {
  const name = executive.user?.full_name || executive.full_name || 'Executive';
  const avatar = executive.user?.avatar_url || executive.avatar_url;
  const hasPhoto = !!avatar;
  const initials = name.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase();
  const position = executive.position || 'Student Representative';
  const session = executive.academic_session || 'Current';

  return (
    <TouchableOpacity style={styles.execCard} onPress={onPress} activeOpacity={0.92}>
      {/* Green gradient header — same style as lecturer card */}
      <LinearGradient
        colors={['#064e3b', '#1B5E20', '#2d6a4f']}
        style={styles.execHeader}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        {/* Avatar — left aligned */}
        <View style={styles.execAvatarRing}>
          {hasPhoto ? (
            <Image source={{ uri: getOptimizedCloudinaryUrl(avatar, 200, 200) }} style={styles.execAvatar} />
          ) : (
            <View style={styles.execAvatarPlaceholder}>
              <Text style={styles.execInitials}>{initials}</Text>
            </View>
          )}
        </View>

        {/* Session badge — top right */}
        <View style={styles.execSessionBadge}>
          <Ionicons name="calendar" size={9} color="#fbbf24" />
          <Text style={styles.execSessionText}>{session}</Text>
        </View>
      </LinearGradient>

      {/* Body — full width, left aligned like lecturer */}
      <View style={styles.execBody}>
        <Text style={styles.execName} numberOfLines={1}>{name}</Text>
        <View style={styles.execPositionPill}>
          <Ionicons name="star" size={10} color="#059669" />
          <Text style={styles.execPositionText} numberOfLines={1}>{position}</Text>
        </View>

        <View style={styles.execContactRow}>
          {(executive.user?.email || executive.email) && (
            <View style={styles.execContactChip}>
              <Ionicons name="mail-outline" size={11} color="#64748b" />
            </View>
          )}
          <View style={{ flex: 1 }} />
          <Ionicons name="chevron-forward" size={16} color="#cbd5e1" />
        </View>
      </View>
    </TouchableOpacity>
  );
}

function SectionHead({ title, count }: { title: string, count: number }) {
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBadge}>
          <Text style={styles.sectionCountText}>{count}</Text>
      </View>
    </View>
  );
}

function EmptySection({ query }: { query?: string }) {
  return (
    <View style={styles.emptyCard}>
      <Ionicons name="search-outline" size={40} color={COLORS.textMuted} style={{ marginBottom: 16 }} />
      <Text style={styles.emptyTitle}>No results found</Text>
      <Text style={styles.emptyText}>
        {query ? `We couldn't find anything matching "${query}"` : 'No items found in this category.'}
      </Text>
    </View>
  );
}

function DetailModal({ visible, onClose, title, subtitle, image, details, isExec }: any) {
    const gradColors: [string, string] = isExec
        ? ['#4c1d95', '#7c3aed']
        : ['#064e3b', '#1B5E20'];
    const initials = title.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase();

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <View style={styles.modalOverlay}>
                <View style={styles.modalContent}>
                    {/* Gradient header */}
                    <LinearGradient colors={gradColors} style={styles.modalGradientHeader} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
                        <TouchableOpacity style={styles.modalCloseBtn} onPress={onClose}>
                            <Ionicons name="close" size={20} color="#fff" />
                        </TouchableOpacity>
                        <View style={styles.modalAvatarRing}>
                            {image ? (
                                <Image source={{ uri: getOptimizedCloudinaryUrl(image, 300, 300) }} style={styles.modalAvatar} />
                            ) : (
                                <View style={styles.modalAvatarPlaceholder}>
                                    <Text style={styles.modalAvatarInitials}>{initials}</Text>
                                </View>
                            )}
                        </View>
                        <Text style={styles.modalName}>{title}</Text>
                        <Text style={styles.modalRole}>{subtitle}</Text>
                    </LinearGradient>

                    {/* Details */}
                    <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
                        {details.map((item: any, idx: number) => {
                            if (!item.value) return null;
                            return (
                                <TouchableOpacity
                                    key={idx}
                                    style={styles.detailRow}
                                    onPress={item.onAction}
                                    disabled={!item.onAction}
                                    activeOpacity={item.onAction ? 0.7 : 1}
                                >
                                    <View style={[styles.detailIconBg, isExec && { backgroundColor: '#faf5ff' }]}>
                                        <Ionicons name={item.icon} size={18} color={isExec ? '#7c3aed' : COLORS.primary} />
                                    </View>
                                    <View style={styles.detailTextContainer}>
                                        <Text style={styles.detailLabel}>{item.label}</Text>
                                        <Text style={styles.detailValue}>{item.value}</Text>
                                    </View>
                                    {item.onAction && (
                                        <View style={[styles.detailAction, isExec && { backgroundColor: '#faf5ff' }]}>
                                            <Ionicons name="open-outline" size={16} color={isExec ? '#7c3aed' : COLORS.primary} />
                                        </View>
                                    )}
                                </TouchableOpacity>
                            );
                        })}
                        <View style={{ height: 32 }} />
                    </ScrollView>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    backgroundColor: '#FFF',
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
    zIndex: 10,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  headerLogoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoCircle: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.actionBlue,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  headerTitle: {
    fontFamily: 'Inter-Bold',
    fontSize: 20,
    color: COLORS.primary,
  },
  headerSubtitle: {
    fontFamily: 'Inter-Medium',
    fontSize: 12,
    color: COLORS.textMuted,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    marginHorizontal: 20,
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 48,
    marginBottom: 20,
  },
  searchInput: {
    flex: 1,
    fontFamily: 'Inter-Regular',
    fontSize: 14,
    color: COLORS.text,
    marginLeft: 10,
  },
  mainTabs: {
    flexDirection: 'row',
  },
  mainTab: {
    marginRight: 24,
    paddingBottom: 12,
    position: 'relative',
  },
  mainTabText: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 15,
    color: COLORS.textMuted,
  },
  activeMainTabText: {
    color: COLORS.primary,
  },
  tabIndicator: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: COLORS.primary,
    borderRadius: 1.5,
  },
  levelFilterSection: {
    backgroundColor: '#FFF',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: '#F1F5F9',
  },
  levelScroll: {
    paddingHorizontal: 20,
  },
  levelChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
    marginRight: 8,
  },
  activeLevelChip: {
    backgroundColor: COLORS.primary,
  },
  levelChipText: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  activeLevelChipText: {
    color: '#FFF',
  },
  content: {
    flex: 1,
  },
  scrollPadding: {
    paddingBottom: 40,
  },
  tabContent: {
    padding: 20,
  },
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    marginTop: 8,
    paddingLeft: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#1B5E20',
  },
  sectionTitle: {
    fontFamily: 'Inter-Bold',
    fontSize: 13,
    color: COLORS.primary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  sectionBadge: {
    backgroundColor: '#dcfce7',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  sectionCountText: {
    fontFamily: 'Inter-Bold',
    fontSize: 10,
    color: '#1B5E20',
  },
  resourceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    padding: 12,
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    shadowColor: '#1B5E20',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  resourceCardDownloaded: {
    borderColor: '#bbf7d0',
    borderLeftWidth: 4,
    borderLeftColor: '#16a34a',
    backgroundColor: '#f9fffe',
  },
  resIconBox: {
    width: 52, height: 52, borderRadius: 14,
    justifyContent: 'center', alignItems: 'center',
    marginRight: 12, position: 'relative',
  },
  resTypeBadge: {
    position: 'absolute', bottom: -4, right: -4,
    paddingHorizontal: 5, paddingVertical: 2,
    borderRadius: 6, borderWidth: 1.5, borderColor: '#fff',
  },
  resTypeBadgeText: { fontFamily: 'Inter-Bold', fontSize: 7, color: '#fff', letterSpacing: 0.3 },
  resInfo: { flex: 1, marginRight: 8 },
  resTitle: { fontFamily: 'Inter-SemiBold', fontSize: 13, color: COLORS.text, lineHeight: 18, marginBottom: 4 },
  resMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  resMeta: { fontFamily: 'Inter-Medium', fontSize: 11, color: COLORS.textMuted },
  offlinePill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#dcfce7', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8,
  },
  offlinePillText: { fontFamily: 'Inter-Bold', fontSize: 9, color: '#166534', letterSpacing: 0.3 },
  progressBarOuter: {
    height: 4, backgroundColor: '#e2e8f0', borderRadius: 2,
    marginTop: 6, overflow: 'hidden', position: 'relative',
  },
  progressBarInner: { height: '100%', backgroundColor: '#1B5E20', borderRadius: 2 },
  progressText: { position: 'absolute', right: 0, top: -14, fontFamily: 'Inter-Bold', fontSize: 9, color: '#1B5E20' },
  resActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  resActionBtn: {
    width: 34, height: 34, borderRadius: 10,
    justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.actionBlue,
  },
  resDownloadBtn: {
    width: 38, height: 38, borderRadius: 12,
    justifyContent: 'center', alignItems: 'center',
    backgroundColor: '#1B5E20',
    shadowColor: '#1B5E20', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3, shadowRadius: 4, elevation: 3,
  },
  resDownloadBtnDone: { backgroundColor: '#dcfce7', shadowOpacity: 0, elevation: 0 },
  resDownloadBtnActive: { backgroundColor: '#f0fdf4', shadowOpacity: 0, elevation: 0 },
  downloadCircle: {
    width: 32, height: 32, borderRadius: 16,
    borderWidth: 2, borderColor: '#1B5E20',
    alignItems: 'center', justifyContent: 'center',
  },
  downloadCircleText: { fontFamily: 'Inter-Bold', fontSize: 8, color: '#1B5E20' },
  readBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.actionBlue, justifyContent: 'center', alignItems: 'center', marginRight: 8 },
  downloadBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F8FAFC', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#F1F5F9' },
  offlineText: { color: COLORS.primary, fontFamily: 'Inter-Bold' },
  downloadedBadge: { position: 'absolute', top: -4, right: -4, backgroundColor: '#FFF', borderRadius: 10 },
  resIconText: { fontFamily: 'Inter-Bold', fontSize: 12 },
    courseCard: {
    flexDirection: 'row',
    backgroundColor: '#FFF',
    borderRadius: 14,
    marginBottom: 10,
    overflow: 'hidden',
    shadowColor: '#1B5E20',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  courseStrip: {
    width: 64,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  courseStripCode: {
    fontFamily: 'Inter-Bold',
    fontSize: 10,
    color: 'rgba(255,255,255,0.9)',
    textAlign: 'center',
    letterSpacing: 0.3,
    lineHeight: 13,
  },
  courseStripUnits: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  courseStripUnitsNum: {
    fontFamily: 'Inter-Bold',
    fontSize: 14,
    color: '#fff',
    lineHeight: 16,
  },
  courseStripUnitsLabel: {
    fontFamily: 'Inter-Bold',
    fontSize: 7,
    color: 'rgba(255,255,255,0.75)',
    letterSpacing: 0.5,
  },
  courseContent: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: 'center',
  },
  courseTitleNew: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 12,
    color: '#0f172a',
    lineHeight: 17,
    marginBottom: 6,
  },
  coursePillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginBottom: 6,
  },
  coursePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
  },
  coursePillText: {
    fontFamily: 'Inter-Bold',
    fontSize: 9,
    letterSpacing: 0.3,
  },
  courseLecturerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  courseLecturerText: {
    fontFamily: 'Inter-Medium',
    fontSize: 11,
    color: COLORS.textMuted,
    flex: 1,
  },
  directoryTabs: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderRadius: 16,
    padding: 4,
    marginBottom: 20,
    gap: 4,
  },
  dirTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    borderRadius: 12,
    gap: 6,
  },
  activeDirTab: {
    backgroundColor: '#1B5E20',
    shadowColor: '#1B5E20',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
  },
  dirTabText: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 13,
    color: '#64748b',
  },
  activeDirTabText: {
    color: '#fff',
    fontFamily: 'Inter-Bold',
  },
  staffTile: { display: 'none' },
  staffImg: { display: 'none' },
  staffPlaceholder: { display: 'none' },
  staffDetails: { display: 'none' },
  staffName: { display: 'none' },
  staffSub: { display: 'none' },
  staffPos: { display: 'none' },
  staffChevron: { display: 'none' },

  // ── Lecturer card ──────────────────────────────────────────────────────────
  lecturerCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    marginBottom: 14,
    overflow: 'hidden',
    shadowColor: '#064e3b',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
    borderWidth: 1,
    borderColor: '#f0fdf4',
  },
  lecturerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  lecturerAvatarRing: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2.5,
    borderColor: 'rgba(255,255,255,0.5)',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 5,
  },
  lecturerAvatar: { width: '100%', height: '100%' },
  lecturerAvatarPlaceholder: {
    width: '100%', height: '100%',
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  lecturerInitials: {
    fontFamily: 'Inter-Bold', fontSize: 20, color: '#fff',
  },
  lecturerTitleBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.25)',
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  lecturerTitleText: {
    fontFamily: 'Inter-Bold', fontSize: 9, color: '#fbbf24', letterSpacing: 1,
  },
  lecturerBody: {
    paddingHorizontal: 16, paddingVertical: 12,
  },
  lecturerName: {
    fontFamily: 'Inter-Bold', fontSize: 16, color: '#0f172a', marginBottom: 2,
  },
  lecturerPosition: {
    fontFamily: 'Inter-Medium', fontSize: 12, color: '#64748b', marginBottom: 8,
  },
  lecturerSpecPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#f0fdf4', paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 10, alignSelf: 'flex-start', marginBottom: 10,
    borderWidth: 1, borderColor: '#dcfce7',
  },
  lecturerSpecText: {
    fontFamily: 'Inter-SemiBold', fontSize: 11, color: '#166534',
  },
  lecturerContactRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  lecturerContactChip: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center',
  },

  // ── Executive card (single column, matches lecturer layout) ───────────────
  execGrid: {
    gap: 0,
  },
  execCard: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 20,
    marginBottom: 14,
    overflow: 'hidden',
    shadowColor: '#064e3b',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  execHeader: {
    height: 110,
    paddingHorizontal: 16, paddingVertical: 14,
    alignItems: 'flex-start', gap: 8,
  },
  execAvatarRing: {
    width: 72, height: 72, borderRadius: 36,
    borderWidth: 2.5, borderColor: 'rgba(255,255,255,0.5)',
    overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2, shadowRadius: 6, elevation: 4,
  },
  execAvatar: { width: '100%', height: '100%' },
  execAvatarPlaceholder: {
    width: '100%', height: '100%',
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  execInitials: {
    fontFamily: 'Inter-Bold', fontSize: 26, color: '#fff',
  },
  execSessionBadge: {
    position: 'absolute', top: 12, right: 12,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.25)',
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  execSessionText: {
    fontFamily: 'Inter-Bold', fontSize: 8, color: '#fbbf24', letterSpacing: 0.5,
  },
  execBody: {
    paddingHorizontal: 16, paddingVertical: 12,
  },
  execName: {
    fontFamily: 'Inter-Bold', fontSize: 16, color: '#0f172a', marginBottom: 6, textAlign: 'left',
  },
  execPositionPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#f0fdf4', paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: '#bbf7d0',
    alignSelf: 'flex-start',
  },
  execPositionText: {
    fontFamily: 'Inter-SemiBold', fontSize: 12, color: '#166534',
  },
  execContactRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  execContactChip: {
    width: 24, height: 24, borderRadius: 7,
    backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center',
  },

  // ── Directory tab switcher ─────────────────────────────────────────────────
  dirTabBadge: {
    backgroundColor: '#e2e8f0', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8,
  },
  dirTabBadgeText: {
    fontFamily: 'Inter-Bold', fontSize: 9, color: '#64748b',
  },
  activeDirTabExec: {
    backgroundColor: '#7c3aed',
    shadowColor: '#7c3aed', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3, shadowRadius: 6, elevation: 3,
  },
  emptyCard: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    marginTop: 20,
  },
  emptyTitle: {
    fontFamily: 'Inter-Bold',
    fontSize: 16,
    color: COLORS.text,
    marginBottom: 8,
  },
  emptyText: {
    fontFamily: 'Inter-Medium',
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  // Modal Styles
  modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.6)',
      justifyContent: 'flex-end',
  },
  modalContent: {
      backgroundColor: '#fff',
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      overflow: 'hidden',
      maxHeight: '85%',
  },
  modalGradientHeader: {
      alignItems: 'center',
      paddingTop: 20,
      paddingBottom: 24,
      paddingHorizontal: 20,
      gap: 8,
  },
  modalCloseBtn: {
      position: 'absolute',
      top: 16,
      right: 16,
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: 'rgba(0,0,0,0.3)',
      alignItems: 'center',
      justifyContent: 'center',
  },
  modalAvatarRing: {
      width: 88,
      height: 88,
      borderRadius: 44,
      borderWidth: 3,
      borderColor: 'rgba(255,255,255,0.5)',
      overflow: 'hidden',
      marginTop: 8,
  },
  modalAvatar: { width: '100%', height: '100%' },
  modalAvatarPlaceholder: {
      width: '100%', height: '100%',
      backgroundColor: 'rgba(255,255,255,0.2)',
      alignItems: 'center', justifyContent: 'center',
  },
  modalAvatarInitials: {
      fontFamily: 'Inter-Bold', fontSize: 28, color: '#fff',
  },
  modalName: {
      fontFamily: 'Inter-Bold', fontSize: 20, color: '#fff', textAlign: 'center',
  },
  modalRole: {
      fontFamily: 'Inter-Medium', fontSize: 13, color: 'rgba(255,255,255,0.75)', textAlign: 'center',
  },
  modalBody: {
      paddingHorizontal: 20,
      paddingTop: 16,
  },
  detailRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: '#f8fafc',
      padding: 14,
      borderRadius: 14,
      marginBottom: 10,
  },
  detailIconBg: {
      width: 38,
      height: 38,
      borderRadius: 10,
      backgroundColor: '#f0fdf4',
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 14,
  },
  detailTextContainer: {
      flex: 1,
  },
  detailLabel: {
      fontFamily: 'Inter-Medium',
      fontSize: 10,
      color: COLORS.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
  },
  detailValue: {
      fontFamily: 'Inter-SemiBold',
      fontSize: 14,
      color: COLORS.text,
      marginTop: 2,
  },
  detailAction: {
      width: 32, height: 32, borderRadius: 10,
      backgroundColor: '#f0fdf4',
      alignItems: 'center', justifyContent: 'center',
  },
});
