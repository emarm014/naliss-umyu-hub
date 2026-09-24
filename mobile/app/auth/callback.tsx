import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../src/stores/auth.store';
import { useSignupStore } from '../../src/stores/signup.store';

export default function AuthCallback() {
  const router = useRouter();

  useEffect(() => {
    // Safety watchdog: only triggers if handleOAuthRedirect fails to navigate within 4s
    const timeout = setTimeout(() => {
      const { session, isProfileComplete } = useAuthStore.getState();
      if (!session) {
        router.replace('/auth/login');
      } else if (isProfileComplete === true) {
        router.replace('/(tabs)');
      } else {
        router.replace('/auth/identity');
      }
    }, 4000);

    return () => clearTimeout(timeout);
  }, [router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator color="#064e3b" size="large"/>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
});
