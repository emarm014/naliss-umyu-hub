import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ActivityIndicator,
  Animated,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Slider } from '@miblanchard/react-native-slider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface CustomVideoPlayerProps {
  source: { uri: string };
  style?: StyleProp<ViewStyle>;
  resizeMode?: ResizeMode;
  shouldPlay?: boolean;
  isMuted?: boolean;
  onPlaybackStatusUpdate?: (status: AVPlaybackStatus) => void;
  showControls?: boolean;
  autoPlay?: boolean;
  onSingleTap?: () => void;
  bottomOffset?: number;
}

function formatTime(millis: number): string {
  if (!millis || isNaN(millis) || millis < 0) return '00:00';
  const totalSeconds = Math.floor(millis / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (num: number) => num.toString().padStart(2, '0');

  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

const RATES = [1.0, 1.25, 1.5, 2.0, 0.5];

export const CustomVideoPlayer: React.FC<CustomVideoPlayerProps> = ({
  source,
  style,
  resizeMode = ResizeMode.CONTAIN,
  shouldPlay = false,
  isMuted = false,
  onPlaybackStatusUpdate,
  showControls = true,
  autoPlay = false,
  onSingleTap,
  bottomOffset,
}) => {
  const videoRef = useRef<Video>(null);
  const hideControlsTimer = useRef<any>(null);

  const insets = useSafeAreaInsets();
  const safeBottomInset = Math.max(insets.bottom, 16);

  const [status, setStatus] = useState<AVPlaybackStatus | null>(null);
  const [isPlaying, setIsPlaying] = useState(autoPlay || shouldPlay);
  const [positionMillis, setPositionMillis] = useState(0);
  const [durationMillis, setDurationMillis] = useState(0);
  const [isBuffering, setIsBuffering] = useState(false);
  const [muted, setMuted] = useState(isMuted);
  const [rateIndex, setRateIndex] = useState(0);

  // Control overlay visibility state & animation
  const [controlsVisible, setControlsVisible] = useState(true);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  // Scrubbing / Seeking state
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekPosition, setSeekPosition] = useState(0);

  useEffect(() => {
    resetHideTimer();
    return () => {
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    };
  }, [isPlaying, controlsVisible]);

  const resetHideTimer = () => {
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    if (isPlaying && controlsVisible && !isSeeking) {
      hideControlsTimer.current = setTimeout(() => {
        hideControls();
      }, 3500);
    }
  };

  const showControlsOverlay = () => {
    setControlsVisible(true);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
    resetHideTimer();
  };

  const hideControls = () => {
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 250,
      useNativeDriver: true,
    }).start(() => {
      setControlsVisible(false);
    });
  };

  const toggleControls = () => {
    if (controlsVisible) {
      hideControls();
    } else {
      showControlsOverlay();
    }
    if (onSingleTap) onSingleTap();
  };

  const handleStatusUpdate = (s: AVPlaybackStatus) => {
    setStatus(s);
    if (onPlaybackStatusUpdate) onPlaybackStatusUpdate(s);

    if (s.isLoaded) {
      setIsBuffering(s.isBuffering);
      setIsPlaying(s.isPlaying);
      setPositionMillis(s.positionMillis);
      setDurationMillis(s.durationMillis || 0);

      if (s.didJustFinish) {
        setIsPlaying(false);
        showControlsOverlay();
      }
    }
  };

  const togglePlayPause = async () => {
    if (!videoRef.current) return;
    showControlsOverlay();
    if (isPlaying) {
      await videoRef.current.pauseAsync();
    } else {
      if (status?.isLoaded && status.didJustFinish) {
        await videoRef.current.replayAsync();
      } else {
        await videoRef.current.playAsync();
      }
    }
  };

  const handleRewind = async () => {
    if (!videoRef.current || !durationMillis) return;
    showControlsOverlay();
    const newPos = Math.max(0, positionMillis - 10000);
    await videoRef.current.setPositionAsync(newPos);
  };

  const handleForward = async () => {
    if (!videoRef.current || !durationMillis) return;
    showControlsOverlay();
    const newPos = Math.min(durationMillis, positionMillis + 10000);
    await videoRef.current.setPositionAsync(newPos);
  };

  const toggleMute = async () => {
    if (!videoRef.current) return;
    showControlsOverlay();
    const newMuted = !muted;
    setMuted(newMuted);
    await videoRef.current.setIsMutedAsync(newMuted);
  };

  const cycleRate = async () => {
    if (!videoRef.current) return;
    showControlsOverlay();
    const nextIdx = (rateIndex + 1) % RATES.length;
    setRateIndex(nextIdx);
    await videoRef.current.setRateAsync(RATES[nextIdx], true);
  };

  const handleSliderValueChange = (val: number | number[]) => {
    showControlsOverlay();
    setIsSeeking(true);
    const numVal = Array.isArray(val) ? val[0] : val;
    setSeekPosition(numVal);
  };

  const handleSlidingComplete = async (val: number | number[]) => {
    const numVal = Array.isArray(val) ? val[0] : val;
    setIsSeeking(false);
    if (videoRef.current) {
      await videoRef.current.setPositionAsync(numVal);
    }
    resetHideTimer();
  };

  const currentDisplayTime = isSeeking ? seekPosition : positionMillis;

  return (
    <TouchableWithoutFeedback onPress={toggleControls}>
      <View style={[styles.container, style]}>
        <Video
          ref={videoRef}
          source={source}
          style={StyleSheet.absoluteFill}
          resizeMode={resizeMode}
          shouldPlay={autoPlay || shouldPlay}
          isMuted={muted}
          onPlaybackStatusUpdate={handleStatusUpdate}
          useNativeControls={false}
        />

        {/* Loading / Buffering Indicator */}
        {isBuffering && (
          <View style={styles.bufferingContainer}>
            <ActivityIndicator size="large" color="#10b981" />
          </View>
        )}

        {/* Custom Video Control Overlay */}
        {showControls && (
          <Animated.View
            style={[
              styles.controlsOverlay,
              { opacity: fadeAnim },
              !controlsVisible && { pointerEvents: 'none' },
            ]}
          >
            {/* Top Bar: Timestamp and Options */}
            <View style={styles.topBar}>
              <Text style={styles.timeText}>
                {formatTime(currentDisplayTime)} / {formatTime(durationMillis)}
              </Text>
              <View style={styles.topBarRight}>
                <TouchableOpacity onPress={cycleRate} style={styles.rateBadge}>
                  <Text style={styles.rateText}>{RATES[rateIndex]}x</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={toggleMute} style={styles.iconBtn}>
                  <Ionicons
                    name={muted ? 'volume-mute' : 'volume-high'}
                    size={22}
                    color="#ffffff"
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* Center Controls: Rewind -10s, Play/Pause, Fast-Forward +10s */}
            <View style={styles.centerControls}>
              <TouchableOpacity onPress={handleRewind} style={styles.skipBtn} activeOpacity={0.7}>
                <MaterialIcons name="replay-10" size={36} color="#ffffff" />
              </TouchableOpacity>

              <TouchableOpacity onPress={togglePlayPause} style={styles.playPauseBtn} activeOpacity={0.8}>
                <Ionicons
                  name={isPlaying ? 'pause' : 'play'}
                  size={38}
                  color="#ffffff"
                  style={!isPlaying ? { marginLeft: 4 } : undefined}
                />
              </TouchableOpacity>

              <TouchableOpacity onPress={handleForward} style={styles.skipBtn} activeOpacity={0.7}>
                <MaterialIcons name="forward-10" size={36} color="#ffffff" />
              </TouchableOpacity>
            </View>

            {/* Bottom Timeline Control Bar with Scrubbing Slider */}
            <View style={[styles.bottomBar, { paddingBottom: bottomOffset ?? safeBottomInset }]}>
              <View style={styles.sliderContainer}>
                <Slider
                  value={currentDisplayTime}
                  minimumValue={0}
                  maximumValue={durationMillis > 0 ? durationMillis : 1}
                  onValueChange={handleSliderValueChange}
                  onSlidingComplete={handleSlidingComplete}
                  minimumTrackTintColor="#10b981"
                  maximumTrackTintColor="rgba(255, 255, 255, 0.35)"
                  thumbTintColor="#10b981"
                  containerStyle={styles.slider}
                  trackStyle={styles.sliderTrack}
                  thumbStyle={styles.sliderThumb}
                />
              </View>
              <Text style={styles.bottomDurationText}>
                {formatTime(durationMillis - currentDisplayTime)}
              </Text>
            </View>
          </Animated.View>
        )}
      </View>
    </TouchableWithoutFeedback>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  bufferingContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
    zIndex: 5,
  },
  controlsOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    zIndex: 10,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
  },
  topBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  timeText: {
    color: '#ffffff',
    fontSize: 13,
    fontFamily: 'Inter-Bold',
    letterSpacing: 0.3,
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  rateBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  rateText: {
    color: '#ffffff',
    fontSize: 12,
    fontFamily: 'Inter-Bold',
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
  },
  skipBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  playPauseBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#10b981',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 8,
    gap: 12,
  },
  sliderContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  slider: {
    height: 30,
  },
  sliderTrack: {
    height: 5,
    borderRadius: 3,
  },
  sliderThumb: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 4,
  },
  bottomDurationText: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 12,
    fontFamily: 'Inter-Medium',
    minWidth: 48,
    textAlign: 'right',
  },
});
