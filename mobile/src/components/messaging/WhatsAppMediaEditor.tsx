import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, TextInput, Image, Dimensions, KeyboardAvoidingView, Platform, FlatList, ActivityIndicator, PanResponder } from 'react-native';
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

interface CropBox { x: number; y: number; w: number; h: number; }

const FreeformCropper = ({ asset, onApply, onCancel }: { asset: FinalizedMedia, onApply: (uri: string, w: number, h: number) => void, onCancel: () => void }) => {
    const { width: winW, height: winH } = Dimensions.get('window');
    const containerW = winW;
    const containerH = winH - 120;

    const [imageLayout, setImageLayout] = useState<{ x: number, y: number, w: number, h: number } | null>(null);
    const [crop, setCrop] = useState<CropBox | null>(null);
    const startCropRef = React.useRef<CropBox | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);

    useEffect(() => {
        if (!asset.width || !asset.height) return;
        const imgRatio = asset.width / asset.height;
        const containerRatio = containerW / containerH;

        let renderW, renderH;
        if (imgRatio > containerRatio) {
            renderW = containerW;
            renderH = containerW / imgRatio;
        } else {
            renderH = containerH;
            renderW = containerH * imgRatio;
        }
        
        setImageLayout({ x: (containerW - renderW) / 2, y: (containerH - renderH) / 2, w: renderW, h: renderH });
        setCrop({ x: 0, y: 0, w: renderW, h: renderH });
    }, [asset, containerW, containerH]);

    const createCornerPan = (corner: 'tl' | 'tr' | 'bl' | 'br') => {
        return PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onPanResponderGrant: () => { startCropRef.current = crop; },
            onPanResponderMove: (_, gestureState) => {
                if (!startCropRef.current || !imageLayout) return;
                const start = startCropRef.current;
                const dx = gestureState.dx;
                const dy = gestureState.dy;
                let { x, y, w, h } = start;

                if (corner === 'tl') {
                    const newX = Math.min(Math.max(0, start.x + dx), start.x + start.w - 50);
                    const newY = Math.min(Math.max(0, start.y + dy), start.y + start.h - 50);
                    w = start.w - (newX - start.x); h = start.h - (newY - start.y); x = newX; y = newY;
                } else if (corner === 'tr') {
                    w = Math.max(50, Math.min(imageLayout.w - start.x, start.w + dx));
                    const newY = Math.min(Math.max(0, start.y + dy), start.y + start.h - 50);
                    h = start.h - (newY - start.y); y = newY;
                } else if (corner === 'bl') {
                    const newX = Math.min(Math.max(0, start.x + dx), start.x + start.w - 50);
                    w = start.w - (newX - start.x); x = newX;
                    h = Math.max(50, Math.min(imageLayout.h - start.y, start.h + dy));
                } else if (corner === 'br') {
                    w = Math.max(50, Math.min(imageLayout.w - start.x, start.w + dx));
                    h = Math.max(50, Math.min(imageLayout.h - start.y, start.h + dy));
                }
                setCrop({ x, y, w, h });
            },
            onPanResponderRelease: () => { startCropRef.current = null; }
        });
    };

    const panBoxResponder = React.useRef(PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => { startCropRef.current = crop; },
        onPanResponderMove: (_, gestureState) => {
            if (!startCropRef.current || !imageLayout) return;
            const start = startCropRef.current;
            let newX = start.x + gestureState.dx;
            let newY = start.y + gestureState.dy;
            newX = Math.max(0, Math.min(imageLayout.w - start.w, newX));
            newY = Math.max(0, Math.min(imageLayout.h - start.h, newY));
            setCrop({ x: newX, y: newY, w: start.w, h: start.h });
        }
    })).current;

    const applyCrop = async () => {
        if (!crop || !imageLayout) return;
        setIsProcessing(true);
        const scaleX = asset.width / imageLayout.w;
        const scaleY = asset.height / imageLayout.h;
        const originX = Math.max(0, Math.floor(crop.x * scaleX));
        const originY = Math.max(0, Math.floor(crop.y * scaleY));
        const cWidth = Math.floor(crop.w * scaleX);
        const cHeight = Math.floor(crop.h * scaleY);
        try {
            const result = await manipulateAsync(asset.uri, [{ crop: { originX, originY, width: cWidth, height: cHeight } }], { compress: 1, format: SaveFormat.JPEG });
            onApply(result.uri, result.width, result.height);
        } catch (e) {
            console.warn(e);
        } finally {
            setIsProcessing(false);
        }
    };

    const cornerStyle: any = { position: 'absolute', width: 24, height: 24, backgroundColor: '#FFF', borderRadius: 12, zIndex: 10, borderWidth: 2, borderColor: '#000' };

    return (
        <View style={StyleSheet.absoluteFill}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 20, paddingTop: Platform.OS === 'ios' ? 50 : 20, backgroundColor: '#000', zIndex: 10 }}>
                <TouchableOpacity onPress={onCancel} style={{ padding: 8 }}><Text style={{ color: '#fff', fontSize: 16 }}>Cancel</Text></TouchableOpacity>
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold', alignSelf: 'center' }}>Crop Image</Text>
                <TouchableOpacity onPress={applyCrop} style={{ padding: 8 }} disabled={isProcessing}>
                    {isProcessing ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: COLORS.primary, fontSize: 16, fontWeight: 'bold' }}>Apply</Text>}
                </TouchableOpacity>
            </View>
            <View style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }}>
                {imageLayout && crop && (
                    <View style={{ width: imageLayout.w, height: imageLayout.h }}>
                        <Image source={{ uri: asset.uri }} style={{ width: '100%', height: '100%' }} />
                        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: crop.y, backgroundColor: 'rgba(0,0,0,0.7)' }} />
                        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: imageLayout.h - (crop.y + crop.h), backgroundColor: 'rgba(0,0,0,0.7)' }} />
                        <View style={{ position: 'absolute', top: crop.y, left: 0, width: crop.x, height: crop.h, backgroundColor: 'rgba(0,0,0,0.7)' }} />
                        <View style={{ position: 'absolute', top: crop.y, right: 0, width: imageLayout.w - (crop.x + crop.w), height: crop.h, backgroundColor: 'rgba(0,0,0,0.7)' }} />
                        <View {...panBoxResponder.panHandlers} style={{ position: 'absolute', left: crop.x, top: crop.y, width: crop.w, height: crop.h, borderWidth: 2, borderColor: '#fff' }}>
                            <View {...createCornerPan('tl').panHandlers} style={[cornerStyle, { top: -12, left: -12 }]} />
                            <View {...createCornerPan('tr').panHandlers} style={[cornerStyle, { top: -12, right: -12 }]} />
                            <View {...createCornerPan('bl').panHandlers} style={[cornerStyle, { bottom: -12, left: -12 }]} />
                            <View {...createCornerPan('br').panHandlers} style={[cornerStyle, { bottom: -12, right: -12 }]} />
                        </View>
                    </View>
                )}
            </View>
        </View>
    );
};

export const WhatsAppMediaEditor: React.FC<WhatsAppMediaEditorProps> = ({ visible, assets, onSend, onCancel, onAddMore }) => {
    const insets = useSafeAreaInsets();
    const [finalizedAssets, setFinalizedAssets] = useState<FinalizedMedia[]>([]);
    const [activeIndex, setActiveIndex] = useState(0);
    const [isProcessing, setIsProcessing] = useState(false);
    
    const [playingVideoIndex, setPlayingVideoIndex] = useState<number | null>(null);
    const [showCropModal, setShowCropModal] = useState(false);
    
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

    const activeAsset = finalizedAssets[activeIndex];

    const isVideoAsset = (asset: MediaAsset) => {
        return asset.type === 'video' || asset.mimeType?.startsWith('video/') || (asset.uri && asset.uri.match(/\.(mp4|mov|avi|webm|mkv|m4v)$/i) !== null);
    };

    const handleCaptionChange = (text: string) => {
        const newAssets = [...finalizedAssets];
        newAssets[activeIndex].caption = text;
        setFinalizedAssets(newAssets);
    };

    const handleCropOpen = () => {
        if (!activeAsset || isVideoAsset(activeAsset)) return;
        setShowCropModal(true);
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
        <Modal visible={visible && finalizedAssets.length > 0} transparent={false} animationType="slide">
            {finalizedAssets.length > 0 && activeAsset && (
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
                                <TouchableOpacity onPress={handleCropOpen} style={styles.iconButton} disabled={isProcessing}>
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

                {/* Crop Modal Overlay */}
                <Modal visible={showCropModal} transparent animationType="fade" onRequestClose={() => setShowCropModal(false)}>
                    {activeAsset && (
                        <FreeformCropper
                            asset={activeAsset}
                            onCancel={() => setShowCropModal(false)}
                            onApply={(uri, w, h) => {
                                setFinalizedAssets(prev => prev.map((asset, i) => i === activeIndex ? { ...asset, uri, width: w, height: h } : asset));
                                setShowCropModal(false);
                            }}
                        />
                    )}
                </Modal>

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
            )}
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
