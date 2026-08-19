import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

export default function PrivacyPolicyScreen() {
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
        <Text style={styles.headerTitle}>Privacy Policy</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.lastUpdated}>Last Updated: August 2026</Text>
        
        <Text style={styles.intro}>
          Welcome to the NALISS UMYU Hub! Your privacy is incredibly important to us. This Privacy Policy explains how the Department of Library and Information Science (LIS) at Umaru Musa Yar'adua University (UMYU) collects, uses, and protects your information.
        </Text>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="shield-checkmark" size={22} color="#0a7e51" />
            <Text style={styles.sectionTitle}>1. Information We Collect</Text>
          </View>
          <Text style={styles.paragraph}>
            We collect information you provide directly to us when you create an account, such as your institutional email address, full name, registration number, and department level. We also securely store the media and study materials you upload to the Cloud Archive.
          </Text>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="construct" size={22} color="#0a7e51" />
            <Text style={styles.sectionTitle}>2. How We Use Your Information</Text>
          </View>
          <Text style={styles.paragraph}>
            Your information is used strictly for academic and departmental purposes:
          </Text>
          <View style={styles.bulletList}>
            <Text style={styles.bulletItem}>• To verify your identity as an enrolled student.</Text>
            <Text style={styles.bulletItem}>• To personalize your academic resources and news feed.</Text>
            <Text style={styles.bulletItem}>• To allow participation in departmental elections.</Text>
            <Text style={styles.bulletItem}>• To display your profile in the student directory and featured student lists.</Text>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="lock-closed" size={22} color="#0a7e51" />
            <Text style={styles.sectionTitle}>3. Data Protection & Security</Text>
          </View>
          <Text style={styles.paragraph}>
            We implement robust security measures to maintain the safety of your personal information. Your passwords are encrypted, and your cloud data is stored securely using industry-standard infrastructure. We do not sell or trade your data to outside parties.
          </Text>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="trash" size={22} color="#0a7e51" />
            <Text style={styles.sectionTitle}>4. Data Deletion & Alumni</Text>
          </View>
          <Text style={styles.paragraph}>
            When you graduate, your account status will be updated to 'Alumni'. You may request the complete deletion of your account and uploaded data at any time by contacting the departmental administration.
          </Text>
        </View>

        <View style={styles.footer}>
          <Ionicons name="information-circle-outline" size={18} color="#6b7280" />
          <Text style={styles.footerText}>
            For privacy inquiries, please visit the LIS Department office.
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
  },
  footerText: {
    fontSize: 13,
    fontFamily: 'Inter-Medium',
    color: '#6b7280',
    textAlign: 'center',
  },
});
