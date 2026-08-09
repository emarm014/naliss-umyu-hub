import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme, useThemeStore } from '../../src/stores/theme.store';
import { COLORS } from '../../src/constants/Colors';

export default function DisplaySettingsScreen() {
    const router = useRouter();
    const { colors, isDark } = useTheme();
    const { toggleTheme } = useThemeStore();

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
            <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
                <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                    <Ionicons name="arrow-back" size={24} color={colors.text} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: colors.text }]}>Display Settings</Text>
                <View style={{ width: 32 }} /> {/* Empty view for flex alignment */}
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent}>
                <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
                    THEME
                </Text>
                <View style={[styles.menuCard, { backgroundColor: isDark ? colors.surfaceVariant : '#f8fafc', borderColor: colors.border }]}>
                    {/* Light Mode option */}
                    <TouchableOpacity
                        style={[styles.menuItem, { borderBottomColor: colors.divider }]}
                        onPress={() => { if (isDark) toggleTheme(); }}
                    >
                        <View style={[styles.menuIconBg, { backgroundColor: '#fffbeb' }]}>
                            <Ionicons name="sunny" size={18} color="#f59e0b" />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.menuLabel, { color: colors.text }]}>Light</Text>
                            <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter-Regular', marginTop: 1 }}>
                                Bright and clean interface
                            </Text>
                        </View>
                        <View style={[styles.radioCircle, { borderColor: !isDark ? COLORS.primary : colors.border }]}>
                            {!isDark && (
                                <View style={[styles.radioInner, { backgroundColor: COLORS.primary }]} />
                            )}
                        </View>
                    </TouchableOpacity>

                    {/* Dark Mode option */}
                    <TouchableOpacity
                        style={[styles.menuItem, { borderBottomWidth: 0 }]}
                        onPress={() => { if (!isDark) toggleTheme(); }}
                    >
                        <View style={[styles.menuIconBg, { backgroundColor: '#1e293b' }]}>
                            <Ionicons name="moon" size={18} color="#94a3b8" />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.menuLabel, { color: colors.text }]}>Dark</Text>
                            <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter-Regular', marginTop: 1 }}>
                                Easy on the eyes at night
                            </Text>
                        </View>
                        <View style={[styles.radioCircle, { borderColor: isDark ? COLORS.primary : colors.border }]}>
                            {isDark && (
                                <View style={[styles.radioInner, { backgroundColor: COLORS.primary }]} />
                            )}
                        </View>
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
    },
    backButton: {
        padding: 4,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
    },
    scrollContent: {
        padding: 16,
        paddingBottom: 40,
    },
    sectionTitle: {
        fontFamily: 'Inter-Bold',
        fontSize: 12,
        letterSpacing: 0.8,
        marginBottom: 12,
        marginLeft: 4,
    },
    menuCard: {
        borderRadius: 20,
        overflow: 'hidden',
        borderWidth: 1,
    },
    menuItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: 1,
    },
    menuIconBg: {
        width: 36,
        height: 36,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    menuLabel: {
        fontFamily: 'Inter-Medium',
        fontSize: 15,
    },
    radioCircle: {
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 2,
        alignItems: 'center',
        justifyContent: 'center',
    },
    radioInner: {
        width: 12,
        height: 12,
        borderRadius: 6,
    },
});
