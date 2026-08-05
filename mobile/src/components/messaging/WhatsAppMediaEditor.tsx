import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, TextInput, Image, Dimensions, KeyboardAvoidingView, Platform, FlatList, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/Colors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Video, ResizeMode } from 'expo-av';
import { CustomVideoPlayer } from '../common/CustomVideoPlayer';

const { width, height } = Dimensions.get('window');

export interface MediaAsset {
    uri: string;
    width: number;
    height: number;
    type?: 'image' | 'video' | 'audio' | 'application/pdf' | string;
    fileName?: string | null;
    mimeType?: string;
    fileSize?: number;
}

export interface FinalizedMedia extends MediaAsset {
    caption?: string;
}

interface WhatsAppMediaEditorProps {
    visible: boolean;
    assets: MediaAsset[];
    onSend: (finalizedAssets: FinalizedMedia[]) => void;
    onCancel: () => void;
    onAddMore?: () => void;
}

export const WhatsAppMediaEditor: React.FC<WhatsAppMediaEditorProps> = ({ visible, assets, onSend, onCancel, onAddMore }) => {
    const insets = useSafeAreaInsets();
    const [finalizedAssets, setFinalizedAssets] = useState<FinalizedMedia[]>([]);
    const [activeIndex, setActiveIndex] = useState(0);
    const [isProcessing, setIsProcessing] = useState(false);
    
    const [playingVideoIndex, setPlayingVideoIndex] = useState<number | null>(null);
    
    // For flatlist scroll sync
    const mainListRef = React.useRef<FlatList>(null);

    const handleViewableItemsChanged = React.useRef(({ viewableItems }: any) => {
        if (viewableItems.length > 0) {
            setActiveIndex(viewableItems[0].index);
            setPlayingVideoIndex(null);
        }
    }).current;

    const viewabilityConfig = React.useRef({ itemVisiblePercentThreshold: 50 }).current;

    useEffect(() => {
        if (!visible) {
            setFinalizedAssets([]);
            setActiveIndex(0);
            setPlayingVideoIndex(null);
            return;
        }
        if (visible && assets.length > 0) {
            setFinalizedAssets(prev => {
                if (prev.length === 0) return assets.map(asset => ({ ...asset, caption: '' }));
                const existingUris = prev.map(p => p.uri);
                const newAssets = assets.filter(a => !existingUris.includes(a.uri)).map(a => ({ ...a, caption: '' }));
                return [...prev, ...newAssets];
            });
        }
    }, [visible, assets]);

    if (!visible || finalizedAssets.length === 0) return null;

    const activeAsset = finalizedAssets[activeIndex];

    const isVideoAsset = (asset: MediaAsset) => {
        return asset.type === 'video' || asset.mimeType?.startsWith('video/') || (asset.uri && asset.uri.match(/\.(mp4|mov|avi|webm|mkv|m4v)$/i) !== null);
    };

    const handleCaptionChange = (text: string) => {
        const newAssets = [...finalizedAssets];
        newAssets[activeIndex].caption = text;
        setFinalizedAssets(newAssets);
    };

    const handleCropSquare = async () => {
        if (!activeAsset || isVideoAsset(activeAsset)) return;
        setIsProcessing(true);
        try {
            const side = Math.min(activeAsset.width || 1080, activeAsset.height || 1080);
            const originX = Math.max(0, Math.floor(((activeAsset.width || side) - side) / 2));
            const originY = Math.max(0, Math.floor(((activeAsset.height || side) - side) / 2));
            
            const result = await manipulateAsync(
                activeAsset.uri,
                [{ crop: { originX, originY, width: side, height: side } }],
                { compress: 0.9, format: SaveFormat.JPEG }
            );
            
            setFinalizedAssets(prev => prev.map((asset, i) => i === activeIndex ? { ...asset, uri: result.uri, width: result.width, height: result.height } : asset));
        } catch (e) {
            console.warn('Failed to crop image', e);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleRotate = async () => {
        if (!activeAsset || isVideoAsset(activeAsset)) return;
        setIsProcessing(true);
        try {
            const result = await manipulateAsync(
                activeAsset.uri,
                [{ rotate: 90 }],
                { compress: 0.9, format: SaveFormat.JPEG }
            );
            
            const newAssets = [...finalizedAssets];
            newAssets[activeIndex] = {
                ...newAssets[activeIndex],
                uri: result.uri,
                width: result.width,
                height: result.height,
            };
            setFinalizedAssets(newAssets);
        } catch (e) {
            console.warn('Failed to rotate image', e);
        } finally {
            setIsProcessing(false);
        }
    };

    const renderThumbnail = ({ item, index }: { item: FinalizedMedia, index: number }) => {
        const isActive = index === activeIndex;
        const isVid = isVideoAsset(item);
        return (
            <TouchableOpacity 
                style={[styles.thumbnailWrapper, isActive && styles.thumbnailActive]} 
                onPress={() => {
                    setActiveIndex(index);
                    setPlayingVideoIndex(null);
                    mainListRef.current?.scrollToIndex({ index, animated: true });
                }}
            >
                <Image source={{ uri: item.uri }} style={styles.thumbnail} />
                {isVid && (
                    <View style={styles.thumbVideoBadge}>
                        <Ionicons name="play" size={14} color="#ffffff" />
                    </View>
                )}
            </TouchableOpacity>
        );
    };

    return (
        <Modal visible={visible} transparent={false} animationType="slide">
            <KeyboardAvoidingView 
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={[styles.container, { paddingTop: Math.max(insets.top, 20), paddingBottom: Math.max(insets.bottom, 20) }]}
            >
                {/* Top Header */}
                <View style={styles.header}>
                    <TouchableOpacity onPress={onCancel} style={styles.iconButton}>
                        <Ionicons name="close" size={28} color="#fff" />
                    </TouchableOpacity>
                    
                    <View style={styles.headerActions}>
                        {!isVideoAsset(activeAsset) && (
                            <>
                                <TouchableOpacity onPress={handleCropSquare} style={styles.iconButton} disabled={isProcessing}>
                                    <Ionicons name="crop" size={24} color="#fff" />
                                </TouchableOpacity>
                                <TouchableOpacity onPress={handleRotate} style={styles.iconButton} disabled={isProcessing}>
                                    <Ionicons name="refresh" size={24} color="#fff" />
                                </TouchableOpacity>
                            </>
                        )}
                        <TouchableOpacity onPress={() => {
                            // Delete current image
                            const newAssets = finalizedAssets.filter((_, i) => i !== activeIndex);
                            if (newAssets.length === 0) onCancel();
                            else setFinalizedAssets(newAssets);
                        }} style={styles.iconButton}>
                            <Ionicons name="trash" size={24} color="#fff" />
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Main Preview */}
                <View style={styles.mainPreview}>
                    {isProcessing && (
                        <View style={styles.processingOverlay}>
                            <ActivityIndicator size="large" color={COLORS.primary} />
                        </View>
                    )}
                    <FlatList
                        ref={mainListRef}
                        data={finalizedAssets}
                        horizontal
                        pagingEnabled
                        snapToInterval={width}
                        snapToAlignment="center"
                        decelerationRate="fast"
                        showsHorizontalScrollIndicator={false}
                        keyExtractor={(item, index) => `main-${item.uri}-${index}`}
                        onViewableItemsChanged={handleViewableItemsChanged}
                        viewabilityConfig={viewabilityConfig}
                        renderItem={({ item, index }) => {
                            const isVid = isVideoAsset(item);
                            return (
                                <View style={{ width, flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                                    {isVid && playingVideoIndex === index ? (
                                        <View style={{ width: width * 0.95, height: height * 0.55, borderRadius: 12, overflow: 'hidden' }}>
                                            <CustomVideoPlayer
                                                source={{ uri: item.uri }}
                                                resizeMode={ResizeMode.CONTAIN}
                                                autoPlay={true}
                                                showControls={true}
                                                onPlaybackStatusUpdate={(status: any) => {
                                                    if (status.isLoaded && status.didJustFinish) setPlayingVideoIndex(null);
                                                }}
                                            />
                                        </View>
                                    ) : (
                                        <TouchableOpacity 
                                            activeOpacity={isVid ? 0.85 : 1}
                                            onPress={() => isVid && setPlayingVideoIndex(index)}
                                            style={{ width, flex: 1, justifyContent: 'center', alignItems: 'center' }}
                                        >
                                            <Image 
                                                source={{ uri: item.uri }} 
                                                style={styles.previewImage} 
                                                resizeMode="contain" 
                                            />
                                            {isVid && (
                                                <View style={styles.editorPlayOverlay}>
                                                    <View style={styles.editorPlayCircle}>
                                                        <Ionicons name="play" size={42} color="#ffffff" style={{ marginLeft: 4 }} />
                                                    </View>
                                                    <Text style={styles.editorPlayText}>Tap to preview video</Text>
                                                </View>
                                            )}
                                        </TouchableOpacity>
                                    )}
                                </View>
                            );
                        }}
                        getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
                    />
                </View>

                {/* Bottom Controls */}
                <View style={styles.bottomControls}>
                    {/* Caption Input */}
                    <View style={styles.captionContainer}>
                        <TouchableOpacity onPress={onAddMore} style={{ padding: 8, marginHorizontal: 4 }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                            <Ionicons name="add-circle-outline" size={28} color="#fff" />
                        </TouchableOpacity>
                        <TextInput
                            style={styles.captionInput}
                            placeholder="Add a caption..."
                            placeholderTextColor="#999"
                            value={activeAsset.caption}
                            onChangeText={handleCaptionChange}
                            multiline
                            maxLength={1024}
                        />
                    </View>

                    {/* Thumbnail Carousel */}
                    {finalizedAssets.length > 1 && (
                        <View style={styles.carouselContainer}>
                            <FlatList
                                data={finalizedAssets}
                                keyExtractor={(item, index) => `${item.uri}-${index}`}
                                renderItem={renderThumbnail}
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                contentContainerStyle={styles.carouselContent}
                            />
                        </View>
                    )}

                    {/* Send Button */}
                    <View style={styles.footerRow}>
                        <View style={styles.selectedCountBadge}>
                            <Text style={styles.selectedCountText}>{finalizedAssets.length} selected</Text>
                        </View>
                        <TouchableOpacity 
                            style={styles.sendButton} 
                            onPress={() => onSend(finalizedAssets)}
                            disabled={isProcessing}
                        >
                            <Ionicons name="send" size={20} color="#fff" />
                        </TouchableOpacity>
                    </View>
                </View>
            </KeyboardAvoidingView>
        </Modal>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000', // WhatsApp uses pitch black
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        height: 56,
        zIndex: 10,
    },
    headerActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
    },
    iconButton: {
        padding: 4,
    },
    mainPreview: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        position: 'relative',
    },
    previewImage: {
        width: '100%',
        height: '100%',
    },
    processingOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 2,
    },
    bottomControls: {
        backgroundColor: 'rgba(0,0,0,0.6)',
        paddingTop: 10,
    },
    captionContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#2A2A2A',
        marginHorizontal: 16,
        borderRadius: 24,
        paddingHorizontal: 12,
        paddingVertical: 8,
        minHeight: 48,
        marginBottom: 16,
    },
    addIcon: {
        marginRight: 10,
    },
    captionInput: {
        flex: 1,
        color: '#fff',
        fontSize: 16,
        maxHeight: 100,
    },
    carouselContainer: {
        height: 60,
        marginBottom: 16,
    },
    carouselContent: {
        paddingHorizontal: 16,
        gap: 8,
    },
    thumbnailWrapper: {
        width: 50,
        height: 50,
        borderRadius: 8,
        overflow: 'hidden',
        borderWidth: 2,
        borderColor: 'transparent',
    },
    thumbnailActive: {
        borderColor: COLORS.primary,
    },
    thumbnail: {
        width: '100%',
        height: '100%',
        resizeMode: 'cover',
    },
    footerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingBottom: 8,
    },
    selectedCountBadge: {
        backgroundColor: '#2A2A2A',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
    },
    selectedCountText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: 'bold',
    },
    sendButton: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: COLORS.primary,
        justifyContent: 'center',
        alignItems: 'center',
        elevation: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
    },
    editorPlayOverlay: {
        position: 'absolute',
        alignItems: 'center',
        justifyContent: 'center',
    },
    editorPlayCircle: {
        width: 76,
        height: 76,
        borderRadius: 38,
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 2.5,
        borderColor: '#ffffff',
        elevation: 6,
    },
    editorPlayText: {
        color: '#ffffff',
        fontSize: 14,
        fontWeight: '600',
        marginTop: 8,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        paddingHorizontal: 12,
        paddingVertical: 4,
        borderRadius: 12,
    },
    thumbVideoBadge: {
        position: 'absolute',
        top: 2,
        right: 2,
        backgroundColor: 'rgba(0,0,0,0.6)',
        borderRadius: 10,
        padding: 2,
    },
});
