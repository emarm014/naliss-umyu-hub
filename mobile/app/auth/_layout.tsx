import { Stack } from 'expo-router';
import { View } from 'react-native';

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
        <Stack.Screen name="data-restore" options={{ gestureEnabled: false }} />
      </Stack>
    </View>
  );
}
