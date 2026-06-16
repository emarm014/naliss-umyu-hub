import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Image, Alert, useColorScheme, KeyboardAvoidingView, Platform, Modal, Dimensions, FlatList } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNoteStore, LocalNote } from '../../src/stores/note.store';
import { useAuthStore } from '../../src/stores/auth.store';
import { useResourceStore } from '../../src/stores/resource.store';
import { ContinuousHandoutCamera } from '../../src/components/ContinuousHandoutCamera';

export default function CreateNoteScreen() {
    const router = useRouter();
    const params = useLocalSearchParams();
    const isDark = useColorScheme() === 'dark';
    const { top } = useSafeAreaInsets();
    
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

    const { courses, materials } = useResourceStore();
    const [isManualCourse, setIsManualCourse] = useState(false);
    const [showCourseDropdown, setShowCourseDropdown] = useState(false);
    const [linkedMaterials, setLinkedMaterials] = useState<string[]>(existingNote?.linkedMaterials || []);

    // Image Slider Modal State
    const [selectedImageIndex, setSelectedImageIndex] = useState(0);
    const [isImageModalVisible, setIsImageModalVisible] = useState(false);
    const { width: windowWidth } = Dimensions.get('window');

    const levels = ['100L', '200L', '300L', '400L', '500L'];
    const activeLevel = courseLevel.replace('L', '');
    const filteredCourses = courses.filter(c => c.level === activeLevel);
    
    const selectedCourseObj = isManualCourse ? null : courses.find(c => c.code === courseCode);
    const filteredMaterials = selectedCourseObj 
        ? materials.filter(m => m.course_id === selectedCourseObj.id)
        : [];

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

    const handleTakeCameraPhoto = async () => {
        const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
        if (!permissionResult.granted) {
            Alert.alert("Permission Required", "You need to allow camera access to take pictures.");
            return;
        }

        const result = await ImagePicker.launchCameraAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true, // Triggers system crop tool immediately
            quality: 1,
        });

        if (!result.canceled && result.assets) {
            setMediaPaths(prev => [...prev, result.assets[0].uri]);
        }
    };

    const removeMedia = (index: number) => {
        setMediaPaths(prev => prev.filter((_, i) => i !== index));
    };

    const toggleLinkedMaterial = (id: string) => {
        setLinkedMaterials(prev => 
            prev.includes(id) ? prev.filter(mId => mId !== id) : [...prev, id]
        );
    };

    const handleSave = () => {
        if (!content.trim() && !subject.trim()) {
            Alert.alert('Empty Note', 'Please add a subject or some content before saving.');
            return;
        }

        router.back();

        setTimeout(() => {
            if (editingId) {
                updateNote(editingId, {
                    subject: subject.trim(),
                    courseCode: courseCode.trim().toUpperCase(),
                    courseLevel,
                    content: content.trim(),
                    mediaPaths,
                    linkedMaterials
                });
            } else {
                addNote({
                    subject: subject.trim(),
                    courseCode: courseCode.trim().toUpperCase(),
                    courseLevel,
                    content: content.trim(),
                    mediaPaths,
                    linkedMaterials
                });
            }
        }, 0);
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
                        router.back();
                        setTimeout(() => deleteNote(editingId), 0);
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
            paddingBottom: 12,
            backgroundColor: isDark ? '#1E1E1E' : '#FFFFFF',
            borderBottomWidth: 1,
            borderBottomColor: isDark ? '#2D2D2D' : '#E2E8F0',
        },
        headerAction: {
            color: '#005A36',
            fontWeight: '600',
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
            backgroundColor: isDark ? '#1E1E1E' : '#E2E8F0',
            borderWidth: 1,
            borderColor: isDark ? '#2D2D2D' : 'transparent',
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
            backgroundColor: isDark ? '#1E1E1E' : '#E2E8F0',
            borderWidth: 1,
            borderColor: isDark ? '#2D2D2D' : 'transparent',
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
        },
        materialCard: {
            width: 140,
            padding: 12,
            marginRight: 12,
            backgroundColor: isDark ? '#1E1E1E' : '#FFFFFF',
            borderWidth: 1,
            borderColor: isDark ? '#2D2D2D' : '#E2E8F0',
            borderRadius: 8,
            minHeight: 100,
        },
        materialCardActive: {
            borderColor: '#005A36',
            backgroundColor: isDark ? 'rgba(0, 90, 54, 0.2)' : '#F0FDF4',
        },
        modalBackground: {
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.9)',
            justifyContent: 'center',
            alignItems: 'center',
        },
        modalCloseBtn: {
            position: 'absolute',
            top: top > 0 ? top + 16 : 40,
            right: 20,
            zIndex: 10,
            padding: 8,
            backgroundColor: 'rgba(0,0,0,0.5)',
            borderRadius: 24,
        }
    });

    return (
        <KeyboardAvoidingView 
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            <View style={[styles.header, { paddingTop: top > 0 ? top : 12 }]}>
                <TouchableOpacity hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} onPress={() => router.back()}>
                    <Text style={[styles.headerAction, { color: isDark ? '#A0AEC0' : '#64748B' }]}>Cancel</Text>
                </TouchableOpacity>
                <Text style={styles.headerTitle}>{editingId ? 'Edit Note' : 'New Note'}</Text>
                <TouchableOpacity hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} onPress={handleSave}>
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

                <View style={[styles.inputGroup, { zIndex: 50 }]}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <Text style={[styles.label, { marginBottom: 0 }]}>Course</Text>
                        <TouchableOpacity onPress={() => setIsManualCourse(!isManualCourse)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                            <Text style={{ color: '#005A36', fontWeight: '600', fontSize: 12 }}>
                                {isManualCourse ? 'Select from list' : 'Type Manually'}
                            </Text>
                        </TouchableOpacity>
                    </View>

                    {isManualCourse ? (
                        <TextInput
                            style={styles.input}
                            placeholder="E.g. LIS 201"
                            placeholderTextColor={isDark ? '#718096' : '#94A3B8'}
                            value={courseCode}
                            onChangeText={setCourseCode}
                            autoCapitalize="characters"
                        />
                    ) : (
                        <View style={{ position: 'relative' }}>
                            <TouchableOpacity 
                                style={[styles.input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}
                                onPress={() => setShowCourseDropdown(!showCourseDropdown)}
                            >
                                <Text style={{ color: courseCode ? (isDark ? '#FFFFFF' : '#1E293B') : (isDark ? '#718096' : '#94A3B8') }}>
                                    {courseCode || 'Select a course...'}
                                </Text>
                                <Ionicons name={showCourseDropdown ? "chevron-up" : "chevron-down"} size={20} color={isDark ? '#718096' : '#94A3B8'} />
                            </TouchableOpacity>

                            {showCourseDropdown && (
                                <View style={{ position: 'absolute', top: 52, left: 0, right: 0, backgroundColor: isDark ? '#1E1E1E' : '#FFFFFF', borderWidth: 1, borderColor: isDark ? '#2D2D2D' : '#E2E8F0', borderRadius: 8, maxHeight: 200, zIndex: 100 }}>
                                    <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
                                        {filteredCourses.length > 0 ? filteredCourses.map(c => (
                                            <TouchableOpacity 
                                                key={c.id} 
                                                style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: isDark ? '#2D2D2D' : '#E2E8F0' }}
                                                onPress={() => {
                                                    setCourseCode(c.code);
                                                    setShowCourseDropdown(false);
                                                }}
                                            >
                                                <Text style={{ color: isDark ? '#FFFFFF' : '#1E293B', fontWeight: '600' }}>{c.code}</Text>
                                                <Text style={{ color: isDark ? '#A0AEC0' : '#475569', fontSize: 12, marginTop: 2 }}>{c.title}</Text>
                                            </TouchableOpacity>
                                        )) : (
                                            <View style={{ padding: 16, alignItems: 'center' }}>
                                                <Text style={{ color: isDark ? '#A0AEC0' : '#475569' }}>No courses found for this level</Text>
                                            </View>
                                        )}
                                    </ScrollView>
                                </View>
                            )}
                        </View>
                    )}
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
                                    <TouchableOpacity activeOpacity={0.8} onPress={() => { setSelectedImageIndex(idx); setIsImageModalVisible(true); }}>
                                        <Image source={{ uri }} style={styles.mediaItem} />
                                    </TouchableOpacity>
                                    <TouchableOpacity style={styles.removeMediaBtn} onPress={() => removeMedia(idx)}>
                                        <Ionicons name="close" size={16} color="#FFFFFF" />
                                    </TouchableOpacity>
                                </View>
                            ))}
                        </ScrollView>
                    </View>
                )}

                {filteredMaterials.length > 0 && !isManualCourse && (
                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Linked Materials</Text>
                        <ScrollView horizontal style={styles.mediaScroll} showsHorizontalScrollIndicator={false}>
                            {filteredMaterials.map((m, idx) => {
                                const isLinked = linkedMaterials.includes(m.id);
                                return (
                                    <TouchableOpacity 
                                        key={m.id} 
                                        style={[styles.materialCard, isLinked && styles.materialCardActive]}
                                        onPress={() => toggleLinkedMaterial(m.id)}
                                    >
                                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                                            <Ionicons name="document-text" size={20} color={isLinked ? '#005A36' : (isDark ? '#A0AEC0' : '#475569')} />
                                            <Text style={{ marginLeft: 6, fontSize: 12, fontWeight: 'bold', color: isLinked ? '#005A36' : (isDark ? '#A0AEC0' : '#475569') }}>
                                                {m.material_type.toUpperCase()}
                                            </Text>
                                        </View>
                                        <Text numberOfLines={2} style={{ fontSize: 14, fontWeight: '600', color: isLinked ? (isDark ? '#FFFFFF' : '#000000') : (isDark ? '#FFFFFF' : '#1E293B') }}>
                                            {m.title}
                                        </Text>
                                        {isLinked && (
                                            <View style={{ position: 'absolute', top: 8, right: 8, backgroundColor: '#005A36', borderRadius: 12, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}>
                                                <Ionicons name="checkmark" size={12} color="#FFFFFF" />
                                            </View>
                                        )}
                                    </TouchableOpacity>
                                );
                            })}
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

            <Modal
                visible={isImageModalVisible}
                transparent={true}
                animationType="fade"
                onRequestClose={() => setIsImageModalVisible(false)}
            >
                <View style={styles.modalBackground}>
                    <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setIsImageModalVisible(false)} hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}>
                        <Ionicons name="close" size={32} color="#FFFFFF" />
                    </TouchableOpacity>
                    <FlatList
                        data={mediaPaths}
                        keyExtractor={(_, index) => index.toString()}
                        horizontal
                        pagingEnabled
                        showsHorizontalScrollIndicator={false}
                        initialScrollIndex={selectedImageIndex}
                        getItemLayout={(_, index) => ({ length: windowWidth, offset: windowWidth * index, index })}
                        renderItem={({ item }) => (
                            <View style={{ width: windowWidth, height: '100%', justifyContent: 'center', alignItems: 'center' }}>
                                <Image source={{ uri: item }} style={{ width: '100%', height: '80%', resizeMode: 'contain' }} />
                            </View>
                        )}
                    />
                </View>
            </Modal>
        </KeyboardAvoidingView>
    );
}
