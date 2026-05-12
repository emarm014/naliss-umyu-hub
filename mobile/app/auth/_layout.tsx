import { useEffect, useRef, useState } from 'react';
import { Stack } from 'expo-router';
import { View, Text, Animated, Easing, LayoutChangeEvent } from 'react-native';
import { useNetworkStore } from '../../src/stores/network.store';

function AuthOfflineBanner() {
  const { isOnline } = useNetworkStore();
  const [bannerHeight, setBannerHeight] = useState(44);
  const slideAnim = useRef(new Animated.Value(-44)).current;
  const hasAnimated = useRef(false);

  const onLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > 0) setBannerHeight(h);
  };

  useEffect(() => {
    // Don't animate on first render if online
    if (!hasAnimated.current && isOnline) {
      hasAnimated.current = true;
      return;
    }
    hasAnimated.current = true;

    Animated.timing(slideAnim, {
      toValue: isOnline ? -bannerHeight : 0,
      duration: 300,
      useNativeDriver: true,
      easing: Easing.out(Easing.ease),
    }).start();
  }, [isOnline, bannerHeight]);

  return (
    <Animated.View
      onLayout={onLayout}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        transform: [{ translateY: slideAnim }],
        backgroundColor: '#dc2626',
        paddingVertical: 10,
        paddingHorizontal: 20,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        zIndex: 9999,
      }}
      pointerEvents="none"
    >
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#fca5a5' }} />
      <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>
        No internet — login requires a connection
      </Text>
    </Animated.View>
  );
}

export default function AuthLayout() {
  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
        <Stack.Screen name="login" />
        <Stack.Screen name="eligibility" />
        <Stack.Screen name="register-options" />
        <Stack.Screen name="register-email" />
        <Stack.Screen name="register-otp" />
        <Stack.Screen name="register-password" />
        <Stack.Screen name="identity" />
        <Stack.Screen name="level" />
        <Stack.Screen name="reset-password" />
        <Stack.Screen name="update-password" />
      </Stack>
      <AuthOfflineBanner />
    </View>
  );
}
