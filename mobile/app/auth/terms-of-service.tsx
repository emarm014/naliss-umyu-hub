import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

export default function TermsOfServiceScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={24} color="#1f2937" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Terms of Service</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.lastUpdated}>Effective Date: August 2026</Text>
        
        <Text style={styles.intro}>
          By accessing and using the NALISS UMYU Hub, you agree to comply with the following Terms of Service. This platform is provided by the LIS Department to facilitate academic excellence and student connectivity.
        </Text>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="school" size={22} color="#0a7e51" />
            <Text style={styles.sectionTitle}>1. Eligibility & Access</Text>
          </View>
          <Text style={styles.paragraph}>
            Access to this platform is strictly limited to verified, enrolled students of the Department of Library and Information Science at Umaru Musa Yar'adua University. Attempting to bypass registration controls or use unauthorized institutional emails is prohibited.
          </Text>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="warning" size={22} color="#0a7e51" />
            <Text style={styles.sectionTitle}>2. Acceptable Use</Text>
          </View>
          <Text style={styles.paragraph}>
            Users are expected to maintain academic integrity and professional conduct:
          </Text>
          <View style={styles.bulletList}>
            <Text style={styles.bulletItem}>• Do not upload malicious files to the Cloud Archive.</Text>
            <Text style={styles.bulletItem}>• Respect fellow students, administrators, and moderators in all interactions.</Text>
            <Text style={styles.bulletItem}>• Do not share your account credentials with external parties.</Text>
            <Text style={styles.bulletItem}>• Report any bugs or vulnerabilities to the administration.</Text>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="cloud-done" size={22} color="#0a7e51" />
            <Text style={styles.sectionTitle}>3. Content & Cloud Archive</Text>
          </View>
          <Text style={styles.paragraph}>
            Materials uploaded to the Cloud Archive are intended for educational sharing. The Department reserves the right to remove any content that violates academic guidelines, copyright laws, or storage quotas without prior notice.
          </Text>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="close-circle" size={22} color="#0a7e51" />
            <Text style={styles.sectionTitle}>4. Account Termination</Text>
          </View>
          <Text style={styles.paragraph}>
            The LIS Department reserves the right to suspend or terminate accounts that engage in fraudulent activities, election manipulation, or severe violations of the University's code of conduct.
          </Text>
        </View>

        <View style={styles.footer}>
          <Ionicons name="checkmark-circle" size={18} color="#0a7e51" />
          <Text style={styles.footerText}>
            By creating an account, you acknowledge and accept these terms.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f4f6',
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: 'Inter-Bold',
    color: '#1f2937',
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 40,
  },
  lastUpdated: {
    fontSize: 13,
    fontFamily: 'Inter-SemiBold',
    color: '#0a7e51',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 16,
  },
  intro: {
    fontSize: 15,
    fontFamily: 'Inter-Regular',
    color: '#4b5563',
    lineHeight: 24,
    marginBottom: 32,
  },
  section: {
    backgroundColor: '#ffffff',
    padding: 20,
    borderRadius: 16,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#0a7e51',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: 'Inter-Bold',
    color: '#1f2937',
  },
  paragraph: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    color: '#4b5563',
    lineHeight: 22,
  },
  bulletList: {
    marginTop: 10,
    gap: 6,
  },
  bulletItem: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    color: '#4b5563',
    lineHeight: 22,
    paddingLeft: 4,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 32,
    gap: 8,
    paddingHorizontal: 20,
    backgroundColor: '#ecfdf5',
    padding: 16,
    borderRadius: 12,
  },
  footerText: {
    fontSize: 13,
    fontFamily: 'Inter-Medium',
    color: '#065f46',
    textAlign: 'center',
    flex: 1,
  },
});
