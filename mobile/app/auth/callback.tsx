import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSignupStore } from '../../src/stores/signup.store';

export default function AuthCallback() {
  const router = useRouter();

  useEffect(() => {
    // Give handleOAuthRedirect time to process session and state
    const timeout = setTimeout(() => {
      const state = useSignupStore.getState() as any;
      const step = state.step ?? state.currentStep ?? 0;
      if (step >= 2) {
        router.replace('/auth/identity');
      }
    }, 500);

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
