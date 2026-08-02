import React, { useState, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, FlatList, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { downloadFile, extractFileNameFromUrl } from '../src/utils';
import { useAnnouncementStore, useResourceStore, useEventStore } from '../src/stores';
import { useTheme } from '../src/stores/theme.store';
import { format } from 'date-fns';

const TABS = ['All Results', 'Announcements', 'Events', 'Resources', 'Past Questions', 'Messages'];

export default function SearchScreen() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('All Results');
  const [offlineResults, setOfflineResults] = useState<any[]>([]);

  const { colors, isDark } = useTheme();
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

  React.useEffect(() => {
    if (query.length === 0) {
      setOfflineResults([]);
      return;
    }
    const runSearch = async () => {
      try {
        const { useOfflineSearchStore } = require('../src/stores/offlineSearch.store');
        const res = await useOfflineSearchStore.getState().search(query);
        setOfflineResults(res);
      } catch (_) {}
    };
    const delayDebounce = setTimeout(runSearch, 300);
    return () => clearTimeout(delayDebounce);
  }, [query]);

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

  const filteredMessages = offlineResults.filter(r => r.entity_type === 'message');

  const handleDownload = async (material: any) => {
    if (!material.file_url) return;
    try {
      const fileName = material.file_name || extractFileNameFromUrl(material.file_url, 'material.pdf');
      await downloadFile(material.file_url, fileName, material.title);
      await incrementDownloadCount(material.id, material.material_type ? 'material' : 'past_question');
    } catch (_) {}
  };

  const renderAnnouncementCard = (item: any) => (
    <TouchableOpacity
      key={item.id}
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={() => router.push({ pathname: '/announcement/[id]', params: { id: item.id } } as any)}
    >
      <View style={[styles.iconBox, { backgroundColor: colors.actionOrange }]}>
        <Ionicons name="megaphone" size={24} color={colors.actionOrangeIcon} />
      </View>
      <View style={styles.cardContent}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>{item.title}</Text>
        <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>{item.content}</Text>
        <View style={styles.metaRow}>
          <View style={[styles.badge, { backgroundColor: colors.surface }]}>
            <Text style={[styles.badgeText, { color: colors.textSecondary }]}>
              {item.target_department_id === null ? 'NALISS Executives' : 'Departmental Office'}
            </Text>
          </View>
          <Text style={[styles.metaText, { color: colors.textMuted }]}>
            {item.created_at ? format(new Date(item.created_at), 'MMM d, yyyy') : ''}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  const renderEventCard = (item: any) => (
    <TouchableOpacity
      key={item.id}
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={() => router.push({ pathname: '/event/[id]', params: { id: item.id } } as any)}
    >
      <View style={[styles.iconBox, { backgroundColor: colors.actionBlue }]}>
        <Ionicons name="calendar" size={24} color={colors.actionBlueIcon} />
      </View>
      <View style={styles.cardContent}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>{item.title}</Text>
        <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>{item.description}</Text>
        <View style={styles.metaRow}>
          <Text style={[styles.metaText, { color: colors.textMuted }]}>
            {format(new Date(item.start_date || item.created_at || new Date()), 'MMM d, yyyy')} • {item.venue}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  const renderResourceCard = (item: any) => {
    const isPdf = item.material_type === 'pdf' || (item.file_name && item.file_name.toLowerCase().endsWith('.pdf'));
    return (
      <TouchableOpacity
        key={item.id}
        style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => handleDownload(item)}
      >
        <View style={[styles.iconBox, { backgroundColor: isPdf ? colors.actionRed : colors.actionBlue }]}>
          <Ionicons name="document-text" size={24} color={isPdf ? colors.actionRedIcon : colors.actionBlueIcon} />
        </View>
        <View style={styles.cardContent}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>{item.title}</Text>
          <Text style={[styles.metaText, { color: colors.textMuted }]}>
            {item.material_type.toUpperCase()} • {item.file_size ? `${(item.file_size / 1024 / 1024).toFixed(1)} MB` : 'PDF'}
          </Text>
        </View>
        <View style={styles.actionIcon}>
          <Ionicons name="download-outline" size={20} color={colors.textSecondary} />
        </View>
      </TouchableOpacity>
    );
  };

  const renderPastQuestionCard = (item: any) => {
    return (
      <TouchableOpacity
        key={item.id}
        style={[styles.pqCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => handleDownload(item)}
      >
        <View style={[styles.pqIconBox, { backgroundColor: colors.actionMint }]}>
           <Ionicons name="document-attach" size={24} color={colors.actionMintIcon} />
        </View>
        <View style={styles.cardContent}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>{item.title}</Text>
          <Text style={[styles.metaText, { color: colors.textMuted }]}>
            {item.description || 'Verified past question'}
          </Text>
        </View>
        <View style={styles.actionIcon}>
          <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
        </View>
      </TouchableOpacity>
    );
  };

  const renderMessageCard = (item: any) => (
    <TouchableOpacity 
      key={item.entity_id} 
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]} 
      onPress={() => router.push({ 
        pathname: '/chat/[id]', 
        params: { 
          id: item.group_id, 
          type: 'group',
          name: 'Group Chat'
        } 
      } as any)}
    >
      <View style={[styles.iconBox, { backgroundColor: colors.actionPurple }]}>
        <Ionicons name="chatbubbles" size={24} color={colors.actionPurpleIcon} />
      </View>
      <View style={styles.cardContent}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>{item.sender_name}</Text>
        <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>{item.content}</Text>
        <View style={styles.metaRow}>
          <View style={[styles.badge, { backgroundColor: colors.surface }]}>
            <Text style={[styles.badgeText, { color: colors.primary }]}>OFFLINE MESSAGE</Text>
          </View>
          <Text style={[styles.metaText, { color: colors.textMuted }]}>
            {item.created_at ? format(new Date(item.created_at), 'MMM d, h:mm a') : ''}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  // Build a unified flat array of section headers + items for FlatList virtualization
  type SearchSectionItem =
    | { _type: 'section_header'; _key: string; title: string; count: number }
    | { _type: 'announcement'; _key: string; item: any }
    | { _type: 'event'; _key: string; item: any }
    | { _type: 'resource'; _key: string; item: any }
    | { _type: 'past_question'; _key: string; item: any; index: number }
    | { _type: 'message'; _key: string; item: any };

  const searchSections = useMemo<SearchSectionItem[]>(() => {
    const sections: SearchSectionItem[] = [];

    if ((activeTab === 'All Results' || activeTab === 'Announcements') && filteredAnnouncements.length > 0) {
      sections.push({ _type: 'section_header', _key: 'header_announcements', title: 'ANNOUNCEMENTS', count: filteredAnnouncements.length });
      filteredAnnouncements.forEach(a => sections.push({ _type: 'announcement', _key: `ann_${a.id}`, item: a }));
    }
    if ((activeTab === 'All Results' || activeTab === 'Events') && filteredEvents.length > 0) {
      sections.push({ _type: 'section_header', _key: 'header_events', title: 'UPCOMING EVENTS', count: filteredEvents.length });
      filteredEvents.forEach(e => sections.push({ _type: 'event', _key: `evt_${e.id}`, item: e }));
    }
    if ((activeTab === 'All Results' || activeTab === 'Resources') && filteredResources.length > 0) {
      sections.push({ _type: 'section_header', _key: 'header_resources', title: 'ACADEMIC RESOURCES', count: filteredResources.length });
      filteredResources.forEach(r => sections.push({ _type: 'resource', _key: `res_${r.id}`, item: r }));
    }
    if ((activeTab === 'All Results' || activeTab === 'Past Questions') && filteredPastQuestions.length > 0) {
      sections.push({ _type: 'section_header', _key: 'header_pq', title: 'PAST QUESTIONS', count: filteredPastQuestions.length });
      filteredPastQuestions.forEach((pq, i) => sections.push({ _type: 'past_question', _key: `pq_${pq.id}`, item: pq, index: i }));
    }
    if ((activeTab === 'All Results' || activeTab === 'Messages') && filteredMessages.length > 0) {
      sections.push({ _type: 'section_header', _key: 'header_messages', title: 'OFFLINE MESSAGES', count: filteredMessages.length });
      filteredMessages.forEach(m => sections.push({ _type: 'message', _key: `msg_${m.entity_id}`, item: m }));
    }

    return sections;
  }, [activeTab, filteredAnnouncements, filteredEvents, filteredResources, filteredPastQuestions, filteredMessages]);

  const renderSearchItem = useCallback(({ item: row }: { item: SearchSectionItem }) => {
    if (row._type === 'section_header') {
      return (
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>{row.title}</Text>
            <Text style={[styles.resultCount, { color: colors.textMuted }]}>{row.count} results</Text>
          </View>
        </View>
      );
    }
    switch (row._type) {
      case 'announcement': return renderAnnouncementCard(row.item);
      case 'event': return renderEventCard(row.item);
      case 'resource': return renderResourceCard(row.item);
      case 'past_question': return renderPastQuestionCard(row.item);
      case 'message': return renderMessageCard(row.item);
      default: return null;
    }
  }, [colors]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Search Results</Text>
        <View style={{ width: 24, padding: 5 }} />
      </View>

      {/* Search Input Area */}
      <View style={[styles.searchContainer, { borderBottomColor: colors.border }]}>
        <View style={[styles.searchInputBox, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}>
          <Ionicons name="search" size={20} color={colors.textMuted} style={styles.searchIcon} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search..."
            placeholderTextColor={colors.textMuted}
            autoFocus={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearButton}>
              <Ionicons name="close-circle" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Tabs */}
      <View style={[styles.tabsContainer, { borderBottomColor: colors.border }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsScroll}>
          {TABS.map((tab) => {
            const isActive = activeTab === tab;
            return (
              <TouchableOpacity
                key={tab}
                style={[styles.tab, isActive && { borderBottomColor: colors.primary }]}
                onPress={() => setActiveTab(tab)}
              >
                <Text style={[styles.tabText, { color: isActive ? colors.primary : colors.textMuted }, isActive && styles.activeTabText]}>
                  {tab}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Results Content */}
      <FlatList
        style={[styles.contentContainer, { backgroundColor: colors.background }]}
        showsVerticalScrollIndicator={false}
        data={searchSections}
        keyExtractor={(item) => item._key}
        renderItem={renderSearchItem}
        initialNumToRender={20}
        maxToRenderPerBatch={15}
        windowSize={10}
        removeClippedSubviews={Platform.OS === 'android'}
        ListEmptyComponent={
          query.length > 0 ? (
            <View style={{ alignItems: 'center', marginTop: 100 }}>
              <Ionicons name="search-outline" size={48} color={colors.textMuted} />
              <Text style={{ fontFamily: 'Inter-Medium', color: colors.textMuted, marginTop: 16 }}>No results found for "{searchQuery}"</Text>
            </View>
          ) : (
            <View style={{ alignItems: 'center', marginTop: 100 }}>
               <Ionicons name="search" size={48} color={colors.textMuted} opacity={0.5} />
               <Text style={{ fontFamily: 'Inter-Medium', color: colors.textMuted, marginTop: 16 }}>Type above to search the hub</Text>
            </View>
          )
        }
        ListFooterComponent={<View style={{ height: 40 }} />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
  },
  optionsButton: {
    padding: 5,
  },
  searchContainer: {
    paddingHorizontal: 20,
    paddingBottom: 15,
    borderBottomWidth: 1,
  },
  searchInputBox: {
    flexDirection: 'row',
    alignItems: 'center',
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
  },
  clearButton: {
    padding: 5,
  },
  tabsContainer: {
    borderBottomWidth: 1,
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
  tabText: {
    fontFamily: 'Inter-Medium',
    fontSize: 14,
  },
  activeTabText: {
    fontFamily: 'Inter-SemiBold',
  },
  contentContainer: {
    flex: 1,
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
  },
  resultCount: {
    fontFamily: 'Inter-Medium',
    fontSize: 12,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 20,
    marginBottom: 12,
    borderWidth: 1,
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
    marginBottom: 4,
  },
  cardSubtitle: {
    fontFamily: 'Inter-Regular',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginRight: 12,
  },
  badgeText: {
    fontFamily: 'Inter-Bold',
    fontSize: 10,
  },
  metaText: {
    fontFamily: 'Inter-Medium',
    fontSize: 12,
  },
  actionIcon: {
    padding: 8,
  },
  pqCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 20,
    marginBottom: 12,
    borderWidth: 1,
  },
  pqIconBox: {
    width: 48,
    height: 48,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
});
