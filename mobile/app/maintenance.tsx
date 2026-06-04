import React from 'react';
import { StyleSheet, View, Text, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NalissLogo } from '../src/components/NalissLogo';
import { COLORS } from '../src/constants/Colors';
import { Ionicons } from '@expo/vector-icons';

const { width } = Dimensions.get('window');

export default function MaintenanceScreen({ message, estimatedEnd }: { message?: string, estimatedEnd?: string }) {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <View style={styles.iconCircle}>
            <Ionicons name="construct" size={48} color={COLORS.primary} />
          </View>
          <View style={[styles.pulseCircle, { transform: [{ scale: 1.2 }] }]} />
        </View>

        <NalissLogo size={80} />
        
        <Text style={styles.title}>Under Maintenance</Text>
        
        <View style={styles.card}>
          <Text style={styles.message}>
            {message || "The NALISS UMYU Hub is currently undergoing scheduled maintenance. We'll be back shortly!"}
          </Text>
          
          {estimatedEnd ? (
            <View style={styles.estimateContainer}>
              <Text style={styles.estimateLabel}>Estimated Completion:</Text>
              <Text style={styles.estimateValue}>{estimatedEnd}</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.footer}>Thank you for your patience.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  iconContainer: {
    marginBottom: 40,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  pulseCircle: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: COLORS.primary + '20',
    zIndex: 1,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#1E293B',
    marginTop: 24,
    marginBottom: 16,
  },
  card: {
    width: '100%',
    backgroundColor: '#F8FAFC',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
  },
  message: {
    fontSize: 16,
    color: '#475569',
    textAlign: 'center',
    lineHeight: 24,
  },
  estimateContainer: {
    marginTop: 20,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    width: '100%',
    alignItems: 'center',
  },
  estimateLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94A3B8',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  estimateValue: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.primary,
  },
  footer: {
    marginTop: 40,
    fontSize: 14,
    color: '#94A3B8',
    fontStyle: 'italic',
  },
});
