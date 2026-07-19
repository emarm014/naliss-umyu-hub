import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../../stores/theme.store';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface HeaderProps {
  title?: string;
  showBack?: boolean;
  rightComponent?: React.ReactNode;
}

export function Header({ title, showBack = false, rightComponent }: HeaderProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.headerContainer, { backgroundColor: colors.card, paddingTop: Platform.OS === 'android' ? insets.top : 0 }]}>
      <View style={styles.leftContainer}>
        {showBack && (
          <TouchableOpacity 
            style={styles.backButton} 
            onPress={() => router.back()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
        )}
      </View>
      
      <View style={styles.titleContainer}>
        {title && (
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            {title}
          </Text>
        )}
      </View>

      <View style={styles.rightContainer}>
        {rightComponent}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: Platform.OS === 'android' ? 60 + 24 : 60, // approximate height
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.1)',
    zIndex: 10,
  },
  leftContainer: {
    flex: 1,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  titleContainer: {
    flex: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rightContainer: {
    flex: 1,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  backButton: {
    padding: 4,
  },
  title: {
    fontSize: 18,
    fontFamily: 'Inter-SemiBold',
  },
});
