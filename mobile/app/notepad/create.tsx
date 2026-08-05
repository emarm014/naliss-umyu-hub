import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Image, Alert, useColorScheme, KeyboardAvoidingView, Platform, Dimensions, FlatList } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNoteStore } from '../../src/stores/note.store';
import { useAuthStore } from '../../src/stores/auth.store';
import { useResourceStore } from '../../src/stores/resource.store';
import { SafeOverlayContainer } from '../../src/components/common/overlays';
import { CachedImage } from '../../src/components/common/CachedImage';

export default function CreateNoteScreen() {
    const router = useRouter();
    const params = useLocalSearchParams();
    const isDark = useColorScheme() === 'dark';
    const { top, bottom } = useSafeAreaInsets();
    
    const { notes, addNote, updateNote, deleteNote } = useNoteStore();
    const profile = useAuthStore((state) => state.profile);
    
    const editingId = params.id as string | undefined;
    const existingNote = editingId ? notes.find(n => n.id === editingId) : null;

    const [subject, setSubject] = useState(existingNote?.subject || '');
    const [courseCode, setCourseCode] = useState(existingNote?.courseCode || '');
    const [courseLevel] = useState(existingNote?.courseLevel || profile?.level || '100L');
    const [content, setContent] = useState(existingNote?.content || '');
    const [mediaPaths, setMediaPaths] = useState<string[]>(existingNote?.mediaPaths || []);

    const { courses, materials } = useResourceStore();
    const [isManualCourse, setIsManualCourse] = useState(false);
    const [showCourseDropdown, setShowCourseDropdown] = useState(false);
    const [linkedMaterials, setLinkedMaterials] = useState<string[]>(existingNote?.linkedMaterials || []);

    // Camera Custom UI State
    const [showCamera, setShowCamera] = useState(false);
    const [queuedImages, setQueuedImages] = useState<string[]>([]);
    const [isQueuePreviewVisible, setIsQueuePreviewVisible] = useState(false);
    const [cameraPermission, requestCameraPermission] = useCameraPermissions();
    const cameraRef = useRef<CameraView>(null);
    const [queuePreviewIndex, setQueuePreviewIndex] = useState(0);

    // General Image Slider Modal State (for saved images)
    const [selectedImageIndex, setSelectedImageIndex] = useState(0);
    const [isImageModalVisible, setIsImageModalVisible] = useState(false);
    const { width: windowWidth } = Dimensions.get('window');

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
            mediaTypes: ['images'],
            allowsEditing: true,
            quality: 1,
            allowsMultipleSelection: false,
        });

        if (!result.canceled && result.assets) {
            const newUris = result.assets.map(a => a.uri);
            setMediaPaths(prev => [...prev, ...newUris]);
        }
    };

    // Custom Camera Methods
    const openCamera = async () => {
        if (!cameraPermission?.granted) {
            const result = await requestCameraPermission();
            if (!result.granted) {
                Alert.alert("Permission Required", "You need to allow camera access to take pictures.");
                return;
            }
        }
        setQueuedImages([]);
        setShowCamera(true);
    };

    const takePicture = async () => {
        if (cameraRef.current) {
            try {
                const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
                if (photo?.uri) {
                    setQueuedImages(prev => [...prev, photo.uri]);
                }
            } catch (err) {
                console.error("Failed to take picture:", err);
            }
        }
    };

    const finishCameraSession = () => {
        setMediaPaths(prev => [...prev, ...queuedImages]);
        setShowCamera(false);
        setQueuedImages([]);
        setIsQueuePreviewVisible(false);
    };

    const cancelCameraSession = () => {
        setShowCamera(false);
        setQueuedImages([]);
        setIsQueuePreviewVisible(false);
    };

    const removeQueuedImage = (index: number) => {
        setQueuedImages(prev => {
            const updated = prev.filter((_, i) => i !== index);
            if (updated.length === 0) {
                setIsQueuePreviewVisible(false);
            }
            return updated;
        });
    };

    const handleViewableQueueItemsChanged = useCallback(({ viewableItems }: any) => {
        if (viewableItems && viewableItems.length > 0) {
            setQueuePreviewIndex(viewableItems[0].index);
        }
    }, []);
    const viewabilityConfig = { itemVisiblePercentThreshold: 50 };

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
            paddingTop: 12,
            paddingHorizontal: 16,
            paddingBottom: Math.max(bottom + 8, 16),
            backgroundColor: isDark ? '#1E1E1E' : '#FFFFFF',
            borderTopWidth: 1,
            borderTopColor: isDark ? '#2D2D2D' : '#E2E8F0',
            alignItems: 'center',
        },
        toolbarBtn: {
            padding: 8,
            marginRight: 16,
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
        },
        modalDeleteBtn: {
            position: 'absolute',
            top: top > 0 ? top + 16 : 40,
            left: 20,
            zIndex: 10,
            padding: 8,
            backgroundColor: 'rgba(239, 68, 68, 0.8)',
            borderRadius: 24,
        },
        cameraOverlayTop: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            paddingTop: top > 0 ? top + 10 : 40,
            paddingHorizontal: 20,
        },
        cameraBtn: {
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: 'rgba(0,0,0,0.4)',
            alignItems: 'center',
            justifyContent: 'center',
        },
        cameraOverlayBottom: {
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            paddingTop: 16,
            paddingBottom: Math.max(bottom + 16, 24),
            backgroundColor: 'rgba(0,0,0,0.4)',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-around',
        },
        captureBtnOuter: {
            width: 72,
            height: 72,
            borderRadius: 36,
            borderWidth: 4,
            borderColor: '#FFF',
            alignItems: 'center',
            justifyContent: 'center',
        },
        captureBtnInner: {
            width: 58,
            height: 58,
            borderRadius: 29,
            backgroundColor: '#FFF',
        },
        queueBadgeContainer: {
            position: 'relative',
            width: 60,
            height: 60,
        },
        queueBadgeThumb: {
            width: 60,
            height: 60,
            borderRadius: 8,
            borderWidth: 2,
            borderColor: '#FFF',
        },
        queueBadgeCount: {
            position: 'absolute',
            top: -8,
            right: -8,
            backgroundColor: '#005A36',
            width: 24,
            height: 24,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 2,
            borderColor: '#FFF',
        },
        queueBadgeCountText: {
            color: '#FFF',
            fontSize: 12,
            fontWeight: 'bold',
        },
        cameraDoneBtn: {
            backgroundColor: '#005A36',
            paddingHorizontal: 20,
            paddingVertical: 12,
            borderRadius: 20,
        },
        cameraDoneText: {
            color: '#FFF',
            fontWeight: 'bold',
            fontSize: 16,
        }
    });

    if (showCamera) {
        return (
            <View style={{ flex: 1, backgroundColor: '#000' }}>
                <CameraView 
                    style={{ flex: 1 }} 
                    facing="back"
                    ref={cameraRef}
                >
                    <View style={styles.cameraOverlayTop}>
                        <TouchableOpacity style={styles.cameraBtn} onPress={cancelCameraSession}>
                            <Ionicons name="close" size={28} color="#FFF" />
                        </TouchableOpacity>
                    </View>
                    
                    <View style={styles.cameraOverlayBottom}>
                        {/* Queue Badge */}
                        {queuedImages.length > 0 ? (
                            <TouchableOpacity 
                                style={styles.queueBadgeContainer}
                                onPress={() => setIsQueuePreviewVisible(true)}
                            >
                                <Image source={{ uri: queuedImages[queuedImages.length - 1] }} style={styles.queueBadgeThumb} />
                                <View style={styles.queueBadgeCount}>
                                    <Text style={styles.queueBadgeCountText}>{queuedImages.length}</Text>
                                </View>
                            </TouchableOpacity>
                        ) : <View style={{ width: 60 }} />}
                        
                        {/* Shutter Button */}
                        <TouchableOpacity style={styles.captureBtnOuter} onPress={takePicture}>
                            <View style={styles.captureBtnInner} />
                        </TouchableOpacity>
                        
                        {/* Done Button */}
                        {queuedImages.length > 0 ? (
                            <TouchableOpacity style={styles.cameraDoneBtn} onPress={finishCameraSession}>
                                <Text style={styles.cameraDoneText}>Done</Text>
                            </TouchableOpacity>
                        ) : <View style={{ width: 60 }} />}
                    </View>
                </CameraView>

                {/* Queue Preview Modal (Inside Camera) */}
                <SafeOverlayContainer
                    visible={isQueuePreviewVisible}
                    onClose={() => setIsQueuePreviewVisible(false)}
                    animationType="fade"
                    overlayStyle={styles.modalBackground}
                >
                    <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setIsQueuePreviewVisible(false)} hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}>
                        <Ionicons name="close" size={32} color="#FFFFFF" />
                    </TouchableOpacity>
                    
                    <TouchableOpacity style={styles.modalDeleteBtn} onPress={() => removeQueuedImage(queuePreviewIndex)} hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}>
                        <Ionicons name="trash" size={24} color="#FFFFFF" />
                    </TouchableOpacity>
                    
                    {queuedImages.length > 0 && (
                        <FlatList
                            data={queuedImages}
                            keyExtractor={(_, index) => index.toString()}
                            horizontal
                            pagingEnabled
                            showsHorizontalScrollIndicator={false}
                            onViewableItemsChanged={handleViewableQueueItemsChanged}
                            viewabilityConfig={viewabilityConfig}
                            getItemLayout={(_, index) => ({ length: windowWidth, offset: windowWidth * index, index })}
                            renderItem={({ item }) => (
                                <View style={{ width: windowWidth, height: '100%', justifyContent: 'center', alignItems: 'center' }}>
                                    <Image source={{ uri: item }} style={{ width: '100%', height: '80%', resizeMode: 'contain' }} />
                                </View>
                            )}
                        />
                    )}
                </SafeOverlayContainer>
            </View>
        );
    }

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

                {/* Level Selector Removed - Automatically maps to profile?.level */}

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
                                        <CachedImage remoteUrl={uri} style={styles.mediaItem} entityId={`note_att_${idx}`} assetType="note_image" />
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
                <TouchableOpacity style={styles.toolbarBtn} onPress={openCamera}>
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

            {/* General Media Viewer Modal (for fully saved/attached media) */}
            <SafeOverlayContainer
                visible={isImageModalVisible}
                onClose={() => setIsImageModalVisible(false)}
                animationType="fade"
                overlayStyle={styles.modalBackground}
            >
                <TouchableOpacity style={[styles.modalCloseBtn, { top: Math.max(top + 10, 40) }]} onPress={() => setIsImageModalVisible(false)} hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}>
                    <Ionicons name="close" size={32} color="#FFFFFF" />
                </TouchableOpacity>
                {mediaPaths.length > 0 && (
                    <FlatList
                        data={mediaPaths}
                        keyExtractor={(_, index) => index.toString()}
                        horizontal
                        pagingEnabled
                        showsHorizontalScrollIndicator={false}
                        initialScrollIndex={selectedImageIndex}
                        getItemLayout={(_, index) => ({ length: windowWidth, offset: windowWidth * index, index })}
                        renderItem={({ item, index }) => (
                            <View style={{ width: windowWidth, height: '100%', justifyContent: 'center', alignItems: 'center' }}>
                                <CachedImage remoteUrl={item} style={{ width: '100%', height: '80%', resizeMode: 'contain' }} entityId={`note_modal_${index}`} assetType="note_image" />
                            </View>
                        )}
                    />
                )}
            </SafeOverlayContainer>
        </KeyboardAvoidingView>
    );
}
