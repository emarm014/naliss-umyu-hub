import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../src/constants/Colors';
import { router } from 'expo-router';

import { downloadFile } from '../src/utils';
import { useAnnouncementStore, useResourceStore, useEventStore } from '../src/stores';
import { format } from 'date-fns';

const TABS = ['All Results', 'Announcements', 'Events', 'Resources', 'Past Questions'];

export default function SearchScreen() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('All Results');

  const { announcements, fetchAnnouncements } = useAnnouncementStore();
  const { materials, pastQuestions, fetchMaterials, fetchPastQuestions, incrementDownloadCount } = useResourceStore();
  const { events, fetchUpcomingEvents } = useEventStore();

  React.useEffect(() => {
    // Ensure we have data to search through when the screen opens
    if (announcements.length === 0) fetchAnnouncements();
    if (materials.length === 0) fetchMaterials();
    if (pastQuestions.length === 0) fetchPastQuestions();
    if (events.length === 0) fetchUpcomingEvents();
  }, []);

  const query = searchQuery.trim().toLowerCase();

  const filteredAnnouncements = query.length === 0 ? [] : announcements.filter(a => 
    a.title.toLowerCase().includes(query) || (a.content && a.content.toLowerCase().includes(query))
  );

  const filteredEvents = query.length === 0 ? [] : events.filter(e => 
    e.title.toLowerCase().includes(query) || ((e as any).description && (e as any).description.toLowerCase().includes(query))
  );

  const filteredResources = query.length === 0 ? [] : materials.filter(m => 
    (m.title.toLowerCase().includes(query) || (m.description && m.description.toLowerCase().includes(query)))
  );

  const filteredPastQuestions = query.length === 0 ? [] : pastQuestions.filter(pq => 
    (pq.title.toLowerCase().includes(query) || (pq.description && pq.description.toLowerCase().includes(query)))
  );

  const handleDownload = async (material: any) => {
    if (!material.file_url) return;
    try {
      const fileName = material.file_name || material.file_url.split('/').pop() || 'material.pdf';
      await downloadFile(material.file_url, material.id, fileName);
      if (incrementDownloadCount) {
        const type = (material as any).material_type ? 'material' : 'past_question';
        await incrementDownloadCount(material.id, type);
      }
    } catch {
      // silent — download/view count is telemetry
    }
  };

  const renderAnnouncementCard = (item: any) => (
    <TouchableOpacity key={item.id} style={styles.card} onPress={() => router.push({ pathname: '/announcement/[id]', params: { id: item.id } } as any)}>
      <View style={[styles.iconBox, { backgroundColor: COLORS.actionOrange }]}>
        <Ionicons name="megaphone" size={24} color="#F59E0B" />
      </View>
      <View style={styles.cardContent}>
        <Text style={styles.cardTitle}>{item.title}</Text>
        <Text style={styles.cardSubtitle} numberOfLines={1}>{item.content}</Text>
        <View style={styles.metaRow}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{item.target_department_id === null ? 'NALISS Executives' : 'Departmental Office'}</Text>
          </View>
          <Text style={styles.metaText}>{item.created_at ? format(new Date(item.created_at), 'MMM d, yyyy') : ''}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  const renderEventCard = (item: any) => (
    <TouchableOpacity key={item.id} style={styles.card} onPress={() => router.push({ pathname: '/event/[id]', params: { id: item.id } } as any)}>
      <View style={[styles.iconBox, { backgroundColor: COLORS.actionBlue }]}>
        <Ionicons name="calendar" size={24} color="#3B82F6" />
      </View>
      <View style={styles.cardContent}>
        <Text style={styles.cardTitle}>{item.title}</Text>
        <Text style={styles.cardSubtitle} numberOfLines={1}>{item.description}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.metaText}>{format(new Date(item.start_date || item.created_at || new Date()), 'MMM d, yyyy')} • {item.venue}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  const renderResourceCard = (item: any) => {
    const isPdf = item.material_type === 'pdf' || (item.file_name && item.file_name.toLowerCase().endsWith('.pdf'));
    return (
      <TouchableOpacity key={item.id} style={styles.card} onPress={() => handleDownload(item)}>
        <View style={[styles.iconBox, { backgroundColor: isPdf ? COLORS.actionRed : COLORS.actionBlue }]}>
          <Ionicons name="document-text" size={24} color={isPdf ? '#EF4444' : '#3B82F6'} />
        </View>
        <View style={styles.cardContent}>
          <Text style={styles.cardTitle}>{item.title}</Text>
          <Text style={styles.metaText}>
            {item.material_type.toUpperCase()} • {item.file_size ? `${(item.file_size / 1024 / 1024).toFixed(1)} MB` : 'PDF'}
          </Text>
        </View>
        <View style={styles.actionIcon}>
          <Ionicons name="download-outline" size={20} color={COLORS.text} />
        </View>
      </TouchableOpacity>
    );
  };

  const renderPastQuestionCard = (item: any, index: number) => {
    const isDark = index % 2 === 0;
    return (
      <TouchableOpacity key={item.id} style={[styles.pqCard, isDark && styles.pqCardDark]} onPress={() => handleDownload(item)}>
        <View style={[styles.pqIconBox, isDark ? styles.pqIconBoxDark : styles.pqIconBoxLight]}>
           <Ionicons name={isDark ? "document-text" : "document-attach"} size={24} color={isDark ? "#FFFFFF" : COLORS.textSecondary} />
        </View>
        <View style={styles.cardContent}>
          <Text style={[styles.cardTitle, isDark && { color: '#FFFFFF' }]}>{item.title}</Text>
          <Text style={[styles.metaText, isDark && { color: '#94A3B8' }]}>
            {item.description || 'Verified past question'}
          </Text>
        </View>
        <View style={styles.actionIcon}>
          <Ionicons name={isDark ? "chevron-forward" : "eye"} size={20} color={isDark ? "#FFFFFF" : COLORS.text} />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Search Results</Text>
        <TouchableOpacity style={styles.optionsButton}>
          <Ionicons name="ellipsis-vertical" size={24} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      {/* Search Input Area */}
      <View style={styles.searchContainer}>
        <View style={styles.searchInputBox}>
          <Ionicons name="search" size={20} color={COLORS.textSecondary} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search..."
            placeholderTextColor={COLORS.textMuted}
            autoFocus={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearButton}>
              <Ionicons name="close-circle" size={20} color={COLORS.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabsContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsScroll}>
          {TABS.map((tab) => {
            const isActive = activeTab === tab;
            return (
              <TouchableOpacity
                key={tab}
                style={[styles.tab, isActive && styles.activeTab]}
                onPress={() => setActiveTab(tab)}
              >
                <Text style={[styles.tabText, isActive && styles.activeTabText]}>{tab}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Results Content */}
      <ScrollView style={styles.contentContainer} showsVerticalScrollIndicator={false}>
        
        {(activeTab === 'All Results' || activeTab === 'Announcements') && filteredAnnouncements.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>ANNOUNCEMENTS</Text>
              <Text style={styles.resultCount}>{filteredAnnouncements.length} results</Text>
            </View>
            {filteredAnnouncements.map(renderAnnouncementCard)}
          </View>
        )}

        {(activeTab === 'All Results' || activeTab === 'Events') && filteredEvents.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>UPCOMING EVENTS</Text>
              <Text style={styles.resultCount}>{filteredEvents.length} results</Text>
            </View>
            {filteredEvents.map(renderEventCard)}
          </View>
        )}

        {(activeTab === 'All Results' || activeTab === 'Resources') && filteredResources.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>ACADEMIC RESOURCES</Text>
              <Text style={styles.resultCount}>{filteredResources.length} results</Text>
            </View>
            {filteredResources.map(renderResourceCard)}
          </View>
        )}

        {(activeTab === 'All Results' || activeTab === 'Past Questions') && filteredPastQuestions.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>PAST QUESTIONS</Text>
              <Text style={styles.resultCount}>{filteredPastQuestions.length} results</Text>
            </View>
            {filteredPastQuestions.map((item, index) => renderPastQuestionCard(item, index))}
          </View>
        )}

        {query.length > 0 && 
         filteredAnnouncements.length === 0 && 
         filteredEvents.length === 0 &&
         filteredResources.length === 0 && 
         filteredPastQuestions.length === 0 && (
          <View style={{ alignItems: 'center', marginTop: 100 }}>
            <Ionicons name="search-outline" size={48} color={COLORS.textMuted} />
            <Text style={{ fontFamily: 'Inter-Medium', color: COLORS.textMuted, marginTop: 16 }}>No results found for "{searchQuery}"</Text>
          </View>
        )}

        {query.length === 0 && (
          <View style={{ alignItems: 'center', marginTop: 100 }}>
             <Ionicons name="search" size={48} color={COLORS.textMuted} opacity={0.5} />
             <Text style={{ fontFamily: 'Inter-Medium', color: COLORS.textMuted, marginTop: 16 }}>Type above to search the hub</Text>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 40 : 10,
    paddingBottom: 15,
  },
  backButton: {
    padding: 5,
  },
  headerTitle: {
    fontFamily: 'Inter-Bold',
    fontSize: 18,
    color: COLORS.text,
  },
  optionsButton: {
    padding: 5,
  },
  searchContainer: {
    paddingHorizontal: 20,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  searchInputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 48,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontFamily: 'Inter-Medium',
    fontSize: 16,
    color: COLORS.text,
  },
  clearButton: {
    padding: 5,
  },
  tabsContainer: {
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  tabsScroll: {
    paddingHorizontal: 20,
  },
  tab: {
    paddingVertical: 16,
    marginRight: 24,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeTab: {
    borderBottomColor: COLORS.black,
  },
  tabText: {
    fontFamily: 'Inter-Medium',
    fontSize: 14,
    color: '#64748B',
  },
  activeTabText: {
    color: COLORS.black,
    fontFamily: 'Inter-SemiBold',
  },
  contentContainer: {
    flex: 1,
    backgroundColor: '#F8FAFC', // slightly off-white bg for content area matching the image closely
  },
  section: {
    marginTop: 24,
    paddingHorizontal: 20,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontFamily: 'Inter-Bold',
    fontSize: 13,
    letterSpacing: 0.5,
    color: COLORS.text,
  },
  resultCount: {
    fontFamily: 'Inter-Medium',
    fontSize: 12,
    color: '#94A3B8',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 15,
    color: COLORS.text,
    marginBottom: 4,
  },
  cardSubtitle: {
    fontFamily: 'Inter-Regular',
    fontSize: 14,
    color: '#475569',
    lineHeight: 20,
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  badge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginRight: 12,
  },
  badgeText: {
    fontFamily: 'Inter-Bold',
    fontSize: 10,
    color: COLORS.text,
  },
  metaText: {
    fontFamily: 'Inter-Medium',
    fontSize: 12,
    color: '#64748B',
  },
  actionIcon: {
    padding: 8,
  },
  pqCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  pqCardDark: {
    backgroundColor: '#1E293B', // dark slate
    borderColor: 'transparent',
  },
  pqIconBox: {
    width: 48,
    height: 48,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  pqIconBoxLight: {
    backgroundColor: '#F1F5F9',
  },
  pqIconBoxDark: {
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
});
