import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Image, Alert, useColorScheme, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useNoteStore, LocalNote } from '../../src/stores/note.store';
import { useAuthStore } from '../../src/stores/auth.store';
import { ContinuousHandoutCamera } from '../../src/components/ContinuousHandoutCamera';

export default function CreateNoteScreen() {
    const router = useRouter();
    const params = useLocalSearchParams();
    const isDark = useColorScheme() === 'dark';
    
    const { notes, addNote, updateNote, deleteNote } = useNoteStore();
    const profile = useAuthStore((state) => state.profile);
    
    const editingId = params.id as string | undefined;
    const existingNote = editingId ? notes.find(n => n.id === editingId) : null;

    const [subject, setSubject] = useState(existingNote?.subject || '');
    const [courseCode, setCourseCode] = useState(existingNote?.courseCode || '');
    const [courseLevel, setCourseLevel] = useState(existingNote?.courseLevel || profile?.level || '100L');
    const [content, setContent] = useState(existingNote?.content || '');
    const [mediaPaths, setMediaPaths] = useState<string[]>(existingNote?.mediaPaths || []);
    const [showCamera, setShowCamera] = useState(false);

    const levels = ['100L', '200L', '300L', '400L', '500L'];

    useEffect(() => {
        if (editingId && !existingNote) {
            Alert.alert("Error", "Note not found");
            router.back();
        }
    }, [editingId, existingNote]);

    const handlePickImage = async () => {
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true,
            quality: 1,
            allowsMultipleSelection: false,
        });

        if (!result.canceled && result.assets) {
            const newUris = result.assets.map(a => a.uri);
            setMediaPaths(prev => [...prev, ...newUris]);
        }
    };

    const handleTakeCameraPhoto = () => {
        setShowCamera(true);
    };

    const removeMedia = (index: number) => {
        setMediaPaths(prev => prev.filter((_, i) => i !== index));
    };

    const handleJumpToPastQuestions = () => {
        if (!courseCode.trim()) return;
        
        // ⚡ INSTANT JUMP: Navigates straight to your Resources tab, switches to the materials segment, and passes the search term
        router.push({
            pathname: '/(tabs)/resources',
            params: { 
                tab: 'materials', 
                search: courseCode.trim().toUpperCase() 
            }
        });
    };

    const handleSave = () => {
        if (!content.trim() && !subject.trim()) {
            Alert.alert('Empty Note', 'Please add a subject or some content before saving.');
            return;
        }

        if (editingId) {
            updateNote(editingId, {
                subject: subject.trim(),
                courseCode: courseCode.trim().toUpperCase(),
                courseLevel,
                content: content.trim(),
                mediaPaths
            });
        } else {
            addNote({
                subject: subject.trim(),
                courseCode: courseCode.trim().toUpperCase(),
                courseLevel,
                content: content.trim(),
                mediaPaths
            });
        }
        router.back();
    };

    const handleDelete = () => {
        if (!editingId) return;
        Alert.alert(
            "Delete Note",
            "Are you sure you want to delete this note? This cannot be undone.",
            [
                { text: "Cancel", style: "cancel" },
                { 
                    text: "Delete", 
                    style: "destructive", 
                    onPress: () => {
                        deleteNote(editingId);
                        router.back();
                    }
                }
            ]
        );
    };

    const styles = StyleSheet.create({
        container: {
            flex: 1,
            backgroundColor: isDark ? '#121212' : '#F8FAFC',
        },
        header: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 16,
            paddingVertical: 12,
            backgroundColor: isDark ? '#1E1E1E' : '#FFFFFF',
            borderBottomWidth: 1,
            borderBottomColor: isDark ? '#2D2D2D' : '#E2E8F0',
        },
        headerAction: {
            color: '#005A36',
            fontWeight: 'bold',
            fontSize: 16,
        },
        headerTitle: {
            fontSize: 18,
            fontWeight: 'bold',
            color: isDark ? '#FFFFFF' : '#1E293B',
        },
        scrollView: {
            flex: 1,
            padding: 16,
        },
        inputGroup: {
            marginBottom: 16,
        },
        label: {
            fontSize: 14,
            fontWeight: '600',
            color: isDark ? '#A0AEC0' : '#475569',
            marginBottom: 8,
        },
        input: {
            backgroundColor: isDark ? '#1E1E1E' : '#FFFFFF',
            borderWidth: 1,
            borderColor: isDark ? '#2D2D2D' : '#E2E8F0',
            borderRadius: 8,
            padding: 12,
            color: isDark ? '#FFFFFF' : '#1E293B',
            fontSize: 16,
        },
        contentInput: {
            height: 250,
            textAlignVertical: 'top',
        },
        levelSelectorRow: {
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 8,
        },
        levelPill: {
            paddingHorizontal: 16,
            paddingVertical: 8,
            borderRadius: 20,
            backgroundColor: isDark ? '#2D2D2D' : '#E2E8F0',
            borderWidth: 1,
            borderColor: 'transparent',
        },
        levelPillActive: {
            backgroundColor: '#005A36',
            borderColor: '#005A36',
        },
        levelPillText: {
            color: isDark ? '#A0AEC0' : '#475569',
            fontWeight: '600',
        },
        levelPillTextActive: {
            color: '#FFFFFF',
        },
        mediaScroll: {
            marginTop: 8,
            marginBottom: 24,
        },
        mediaItemContainer: {
            marginRight: 12,
            position: 'relative',
        },
        mediaItem: {
            width: 100,
            height: 100,
            borderRadius: 8,
            backgroundColor: isDark ? '#2D2D2D' : '#E2E8F0',
        },
        removeMediaBtn: {
            position: 'absolute',
            top: -8,
            right: -8,
            backgroundColor: '#ef4444',
            borderRadius: 12,
            width: 24,
            height: 24,
            alignItems: 'center',
            justifyContent: 'center',
        },
        toolbar: {
            flexDirection: 'row',
            padding: 12,
            backgroundColor: isDark ? '#1E1E1E' : '#FFFFFF',
            borderTopWidth: 1,
            borderTopColor: isDark ? '#2D2D2D' : '#E2E8F0',
            alignItems: 'center',
        },
        toolbarBtn: {
            padding: 8,
            marginRight: 16,
        },
        pastQLinkBtn: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: '#005A36',
            borderRadius: 20,
            paddingVertical: 10,
            paddingHorizontal: 16,
            marginTop: 10,
            backgroundColor: isDark ? 'rgba(0, 90, 54, 0.1)' : '#F0FDF4',
        },
        pastQLinkText: {
            color: '#005A36',
            fontWeight: '600',
            fontSize: 14,
        }
    });

    return (
        <KeyboardAvoidingView 
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()}>
                    <Text style={[styles.headerAction, { color: isDark ? '#A0AEC0' : '#64748B' }]}>Cancel</Text>
                </TouchableOpacity>
                <Text style={styles.headerTitle}>{editingId ? 'Edit Note' : 'New Note'}</Text>
                <TouchableOpacity onPress={handleSave}>
                    <Text style={styles.headerAction}>Save</Text>
                </TouchableOpacity>
            </View>

            <ScrollView style={styles.scrollView} keyboardShouldPersistTaps="handled">
                <View style={styles.inputGroup}>
                    <Text style={styles.label}>Subject</Text>
                    <TextInput
                        style={styles.input}
                        placeholder="E.g. Database Normalization"
                        placeholderTextColor={isDark ? '#718096' : '#94A3B8'}
                        value={subject}
                        onChangeText={setSubject}
                    />
                </View>

                <View style={styles.inputGroup}>
                    <Text style={styles.label}>Course Code (Optional)</Text>
                    <TextInput
                        style={styles.input}
                        placeholder="E.g. LIS 201"
                        placeholderTextColor={isDark ? '#718096' : '#94A3B8'}
                        value={courseCode}
                        onChangeText={setCourseCode}
                        autoCapitalize="characters"
                    />
                    {courseCode.trim().length > 0 && (
                        <TouchableOpacity onPress={handleJumpToPastQuestions} style={styles.pastQLinkBtn}>
                            <Text style={styles.pastQLinkText}>
                                📖 View Linked Past Questions for {courseCode.trim().toUpperCase()}
                            </Text>
                        </TouchableOpacity>
                    )}
                </View>

                <View style={styles.inputGroup}>
                    <Text style={styles.label}>Course Level</Text>
                    <View style={styles.levelSelectorRow}>
                        {levels.map(level => (
                            <TouchableOpacity 
                                key={level}
                                style={[styles.levelPill, courseLevel === level && styles.levelPillActive]}
                                onPress={() => setCourseLevel(level)}
                            >
                                <Text style={[styles.levelPillText, courseLevel === level && styles.levelPillTextActive]}>
                                    {level}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>

                <View style={styles.inputGroup}>
                    <Text style={styles.label}>Note Content</Text>
                    <TextInput
                        style={[styles.input, styles.contentInput]}
                        placeholder="Start typing your notes here..."
                        placeholderTextColor={isDark ? '#718096' : '#94A3B8'}
                        value={content}
                        onChangeText={setContent}
                        multiline
                    />
                </View>

                {mediaPaths.length > 0 && (
                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Attachments ({mediaPaths.length})</Text>
                        <ScrollView horizontal style={styles.mediaScroll} showsHorizontalScrollIndicator={false}>
                            {mediaPaths.map((uri, idx) => (
                                <View key={idx} style={styles.mediaItemContainer}>
                                    <Image source={{ uri }} style={styles.mediaItem} />
                                    <TouchableOpacity style={styles.removeMediaBtn} onPress={() => removeMedia(idx)}>
                                        <Ionicons name="close" size={16} color="#FFFFFF" />
                                    </TouchableOpacity>
                                </View>
                            ))}
                        </ScrollView>
                    </View>
                )}
            </ScrollView>

            <View style={styles.toolbar}>
                <TouchableOpacity style={styles.toolbarBtn} onPress={handleTakeCameraPhoto}>
                    <Ionicons name="camera-outline" size={24} color="#005A36" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.toolbarBtn} onPress={handlePickImage}>
                    <Ionicons name="image-outline" size={24} color="#005A36" />
                </TouchableOpacity>
                <View style={{ flex: 1 }} />
                {editingId && (
                    <TouchableOpacity style={styles.toolbarBtn} onPress={handleDelete}>
                        <Ionicons name="trash-outline" size={24} color="#ef4444" />
                    </TouchableOpacity>
                )}
            </View>

            {showCamera && (
                <ContinuousHandoutCamera 
                    onClose={() => setShowCamera(false)}
                    onFinishCapture={(uris) => {
                        if (uris.length > 0) {
                            setMediaPaths(prev => [...prev, ...uris]);
                        }
                        setShowCamera(false);
                    }}
                />
            )}
        </KeyboardAvoidingView>
    );
}
