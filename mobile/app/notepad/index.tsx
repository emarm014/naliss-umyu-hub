import React, { useState, useMemo } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, useColorScheme, StyleSheet, StatusBar } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useNoteStore, LocalNote } from '../../src/stores/note.store';
import { useAuthStore } from '../../src/stores/auth.store';
import { format } from 'date-fns';

export default function NotepadDashboard() {
    const router = useRouter();
    const isDark = useColorScheme() === 'dark';
    const notes = useNoteStore((state) => state.notes);
    
    // Auth Store Level for Smart Filtering
    const profile = useAuthStore((state) => state.profile);
    const userLevel = profile?.level || 'All';

    const [searchQuery, setSearchQuery] = useState('');

    // O(1) performance lookup mapping (Memoized)
    const filteredNotes = useMemo(() => {
        if (!searchQuery.trim()) return notes;
        
        return notes.filter(note => {
            return note.subject?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                   note.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
                   note.courseCode?.toLowerCase().includes(searchQuery.toLowerCase());
        });
    }, [notes, searchQuery]);

    const styles = StyleSheet.create({
        container: {
            flex: 1,
            backgroundColor: isDark ? '#121212' : '#F8FAFC',
        },
        headerBox: {
            backgroundColor: isDark ? '#1E1E1E' : '#FFFFFF',
            padding: 16,
            borderBottomWidth: 1,
            borderBottomColor: isDark ? '#2D2D2D' : '#E2E8F0',
        },
        searchInput: {
            backgroundColor: isDark ? '#1E1E1E' : '#F1F5F9',
            color: isDark ? '#FFFFFF' : '#1E293B',
            borderRadius: 8,
            borderWidth: 1,
            borderColor: isDark ? '#2D2D2D' : 'transparent',
            height: 44,
            paddingHorizontal: 16,
        },
        levelSelectorContainer: {
            flexDirection: 'row',
            paddingHorizontal: 16,
            paddingVertical: 12,
        },
        levelPill: {
            paddingHorizontal: 16,
            paddingVertical: 6,
            borderRadius: 16,
            backgroundColor: isDark ? '#1E1E1E' : '#E2E8F0',
            borderWidth: 1,
            borderColor: isDark ? '#2D2D2D' : 'transparent',
            marginRight: 8,
        },
        levelPillActive: {
            backgroundColor: '#005A36',
        },
        levelPillText: {
            color: isDark ? '#A0AEC0' : '#475569',
            fontWeight: '600',
        },
        levelPillTextActive: {
            color: '#FFFFFF',
        },
        emptyContainer: {
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            padding: 32,
        },
        emptyText: {
            color: isDark ? '#A0AEC0' : '#64748B',
            fontSize: 16,
            textAlign: 'center',
            marginTop: 16,
            lineHeight: 24,
        },
        listContent: {
            paddingTop: 20,
            paddingHorizontal: 16,
            paddingBottom: 100,
        },
        noteCard: {
            backgroundColor: isDark ? '#1E1E1E' : '#FFFFFF',
            borderRadius: 12,
            padding: 16,
            marginBottom: 16,
            borderLeftWidth: 4,
            borderLeftColor: '#005A36',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: isDark ? 0.3 : 0.05,
            shadowRadius: 3,
            elevation: 2,
        },
        courseCode: {
            color: '#005A36',
            fontWeight: 'bold',
            fontSize: 12,
            marginBottom: 4,
            letterSpacing: 0.5,
        },
        subject: {
            color: isDark ? '#FFFFFF' : '#1E293B',
            fontWeight: 'bold',
            fontSize: 16,
            marginBottom: 4,
        },
        contentPreview: {
            color: isDark ? '#A0AEC0' : '#64748B',
            fontSize: 14,
            lineHeight: 20,
            marginTop: 4,
        },
        metaContainer: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 12,
            paddingTop: 12,
            borderTopWidth: 1,
            borderTopColor: isDark ? '#2D2D2D' : '#F1F5F9',
        },
        attachmentsContainer: {
            flexDirection: 'row',
            alignItems: 'center',
        },
        attachmentsText: {
            color: isDark ? '#A0AEC0' : '#64748B',
            fontSize: 12,
            marginLeft: 4,
        },
        dateText: {
            color: isDark ? '#718096' : '#94A3B8',
            fontSize: 12,
        },
        fab: {
            position: 'absolute',
            bottom: 24,
            right: 24,
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: '#005A36',
            justifyContent: 'center',
            alignItems: 'center',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.3,
            shadowRadius: 4.65,
            elevation: 8,
        }
    });

    return (
        <View style={styles.container}>
            <StatusBar barStyle="light-content" />
            <View style={styles.headerBox}>
                <TextInput
                    style={styles.searchInput}
                    placeholder="Search notes or course codes..."
                    placeholderTextColor={isDark ? '#718096' : '#94A3B8'}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                />
            </View>



            {filteredNotes.length === 0 ? (
                <View style={styles.emptyContainer}>
                    <Ionicons name="document-text-outline" size={64} color="#005A36" style={{ opacity: 0.5 }} />
                    <Text style={styles.emptyText}>
                        {searchQuery 
                            ? "No notes found matching your search." 
                            : "No notes saved yet. Tap '+' to create your first study note."}
                    </Text>
                </View>
            ) : (
                <FlatList
                    data={filteredNotes}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={styles.listContent}
                    renderItem={({ item }) => (
                        <TouchableOpacity 
                            style={styles.noteCard}
                            onPress={() => router.push({ pathname: '/notepad/create', params: { id: item.id } })}
                        >
                            {item.courseCode && (
                                <Text style={styles.courseCode}>{item.courseCode} • {item.courseLevel}</Text>
                            )}
                            <Text style={styles.subject}>{item.subject || 'Untitled Note'}</Text>
                            <Text style={styles.contentPreview} numberOfLines={2}>{item.content}</Text>
                            
                            <View style={styles.metaContainer}>
                                {item.mediaPaths?.length > 0 ? (
                                    <View style={styles.attachmentsContainer}>
                                        <Ionicons name="images" size={14} color={isDark ? '#A0AEC0' : '#64748B'} />
                                        <Text style={styles.attachmentsText}>{item.mediaPaths.length}</Text>
                                    </View>
                                ) : <View />}
                                
                                <Text style={styles.dateText}>
                                    {format(new Date(item.updatedAt), 'MMM d, yyyy')}
                                </Text>
                            </View>
                        </TouchableOpacity>
                    )}
                />
            )}

            <TouchableOpacity 
                style={styles.fab}
                onPress={() => router.push('/notepad/create')}
            >
                <Ionicons name="add" size={32} color="#FFFFFF" />
            </TouchableOpacity>
        </View>
    );
}
