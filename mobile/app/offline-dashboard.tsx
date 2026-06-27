import React, { useEffect, useState } from 'react';
import { 
    StyleSheet, 
    Text, 
    View, 
    ScrollView, 
    TouchableOpacity, 
    ActivityIndicator, 
    Alert,
    FlatList 
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useOfflineAssetStore } from '../src/stores/offlineAsset.store';
import { getSyncState, updateSyncState, verifyDatabaseIntegrity } from '../src/lib/database';
import { useAuthStore } from '../src/stores/auth.store';
import { useNetworkStore } from '../src/stores/network.store';

export default function OfflineDashboardScreen() {
    const router = useRouter();
    const assetState = useOfflineAssetStore();
    const authUser = useAuthStore(s => s.user);
    const network = useNetworkStore();

    const [syncState, setSyncState] = useState<any>(null);
    const [dbHealth, setDbHealth] = useState<string>('Checking...');
    const [isLoading, setIsLoading] = useState(false);
    const [telemetryLogs, setTelemetryLogs] = useState<any[]>([]);

    const loadData = async () => {
        setIsLoading(true);
        try {
            await assetState.calculateStorageUsage();
            
            if (authUser?.id) {
                const state = await getSyncState(authUser.id);
                setSyncState(state);
            }
            
            const { getDB } = require('../src/lib/database');
            const db = getDB();
            if (db) {
                const logs = await db.getAllAsync(
                    'SELECT * FROM offline_download_telemetry ORDER BY timestamp DESC LIMIT 50'
                );
                setTelemetryLogs(logs || []);
            }

            const health = await verifyDatabaseIntegrity();
            setDbHealth(health.healthy ? 'HEALTHY (WAL MODE)' : `CORRUPTED: ${health.issues.join(', ')}`);
        } catch (e) {
            setDbHealth('Error checking integrity');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadData();
        const timer = setInterval(loadData, 5000);
        return () => clearInterval(timer);
    }, [authUser?.id]);

    const handleForceSync = async () => {
        if (!network.isOnline) {
            Alert.alert('Offline', 'Cannot sync while offline.');
            return;
        }
        setIsLoading(true);
        try {
            const { OfflineSyncService } = require('../src/services/offlineSync.service');
            await OfflineSyncService.syncAll(true);
            await loadData();
            Alert.alert('Success', 'Synchronization cycle triggered successfully.');
        } catch (e) {
            Alert.alert('Error', 'Sync cycle trigger failed.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleResetBootstrap = async () => {
        Alert.alert(
            'Reset Offline Library',
            'Are you sure you want to clear sync states and rebuild the offline library? Local files will NOT be deleted.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Reset & Rebuild',
                    style: 'destructive',
                    onPress: async () => {
                        if (authUser?.id) {
                            setIsLoading(true);
                            try {
                                await updateSyncState(authUser.id, {
                                    last_sync: null,
                                    last_asset_sync: null,
                                    schema_version: 1,
                                    bootstrap_completed: 0
                                });
                                const { OfflineSyncService } = require('../src/services/offlineSync.service');
                                await OfflineSyncService.syncAll(true);
                                await loadData();
                                Alert.alert('Success', 'Bootstrap state reset. Rebuilding library...');
                            } catch (e) {
                                Alert.alert('Error', 'Failed to reset bootstrap.');
                            } finally {
                                setIsLoading(false);
                            }
                        }
                    }
                }
            ]
        );
    };

    const formatBytes = (bytes: number) => {
        if (!bytes) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const formatETA = (seconds: number) => {
        if (!seconds) return 'calculating...';
        if (seconds < 60) return `${seconds}s`;
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}m ${secs}s`;
    };

    return (
        <View style={styles.container}>
            <Stack.Screen options={{ title: 'Offline Asset & Diagnostics', headerBackTitle: 'Profile' }} />
            <ScrollView contentContainerStyle={styles.scrollContent}>
                
                {/* Global Stats */}
                <View style={styles.card}>
                    <Text style={styles.cardTitle}>SYSTEM DIAGNOSTICS</Text>
                    <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Device Signature</Text>
                        <Text style={styles.infoValue} numberOfLines={1} ellipsizeMode="middle">{assetState.deviceId || 'Unassigned'}</Text>
                    </View>
                    <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Network Interface</Text>
                        <Text style={styles.infoValue}>{network.isOnline ? `Online (${network.networkType || 'unknown'})` : 'Offline'}</Text>
                    </View>
                    <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>SQLite Status</Text>
                        <Text style={[styles.infoValue, dbHealth.includes('HEALTHY') ? styles.textSuccess : styles.textDanger]}>{dbHealth}</Text>
                    </View>
                    <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Library Synced</Text>
                        <Text style={styles.infoValue}>{syncState?.bootstrap_completed === 1 ? 'YES' : 'PENDING'}</Text>
                    </View>
                </View>

                {/* Queue Status */}
                <View style={styles.card}>
                    <Text style={styles.cardTitle}>OFFLINE DOWNLOAD QUEUE</Text>
                    {assetState.activeJob ? (
                        <>
                            <View style={styles.infoRow}>
                                <Text style={styles.infoLabel}>Queue Status</Text>
                                <Text style={styles.infoValue}>{assetState.activeJob.status.toUpperCase()}</Text>
                            </View>
                            <View style={styles.infoRow}>
                                <Text style={styles.infoLabel}>Completed / Total</Text>
                                <Text style={styles.infoValue}>{assetState.activeJob.completed} / {assetState.activeJob.total}</Text>
                            </View>
                            <View style={styles.infoRow}>
                                <Text style={styles.infoLabel}>Failed Runs</Text>
                                <Text style={[styles.infoValue, assetState.activeJob.failed > 0 ? styles.textDanger : null]}>{assetState.activeJob.failed}</Text>
                            </View>
                            <View style={styles.infoRow}>
                                <Text style={styles.infoLabel}>Transfer Rate</Text>
                                <Text style={styles.infoValue}>{formatBytes(assetState.activeJob.speedBytesPerSec)}/s</Text>
                            </View>
                            <View style={styles.infoRow}>
                                <Text style={styles.infoLabel}>Est. Time Remaining</Text>
                                <Text style={styles.infoValue}>{formatETA(assetState.activeJob.etaSeconds)}</Text>
                            </View>
                            <View style={styles.infoRow}>
                                <Text style={styles.infoLabel}>Active File</Text>
                                <Text style={styles.infoValue} numberOfLines={1} ellipsizeMode="tail">{assetState.activeJob.currentAsset || 'none'}</Text>
                            </View>
                            
                            <View style={styles.progressContainer}>
                                <View style={styles.progressBarBg}>
                                    <View style={[styles.progressBarFill, { width: `${assetState.activeJob.progress}%` }]} />
                                </View>
                                <Text style={styles.progressText}>{assetState.activeJob.progress}% Complete</Text>
                            </View>
                        </>
                    ) : (
                        <Text style={styles.emptyText}>Offline library is fully synchronized and verified.</Text>
                    )}
                </View>

                {/* Storage usage */}
                <View style={styles.card}>
                    <Text style={styles.cardTitle}>SECURE OFFLINE ARCHIVE</Text>
                    <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Total Allocated</Text>
                        <Text style={styles.infoValue}>{formatBytes(assetState.storageStats?.totalUsed || 0)}</Text>
                    </View>
                    <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Chat Images & Media</Text>
                        <Text style={styles.infoValue}>{formatBytes(assetState.storageStats?.chatMedia || 0)}</Text>
                    </View>
                    <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Lectures & Study Files</Text>
                        <Text style={styles.infoValue}>{formatBytes(assetState.storageStats?.studyMaterials || 0)}</Text>
                    </View>
                    <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Documents (PDFs/Slides)</Text>
                        <Text style={styles.infoValue}>{formatBytes(assetState.storageStats?.documents || 0)}</Text>
                    </View>
                    <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Voice Messages</Text>
                        <Text style={styles.infoValue}>{formatBytes(assetState.storageStats?.voiceNotes || 0)}</Text>
                    </View>
                    <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Videos</Text>
                        <Text style={styles.infoValue}>{formatBytes(assetState.storageStats?.videos || 0)}</Text>
                    </View>
                    <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Avatars & Directories</Text>
                        <Text style={styles.infoValue}>{formatBytes(assetState.storageStats?.avatars || 0)}</Text>
                    </View>
                </View>

                {/* Download Policies */}
                <View style={styles.card}>
                    <Text style={styles.cardTitle}>DOWNLOAD RULE POLICY</Text>
                    <View style={styles.policyRow}>
                        {['everything', 'wifi', 'manual'].map((pol) => (
                            <TouchableOpacity
                                key={pol}
                                style={[
                                    styles.policyBtn,
                                    assetState.downloadPolicy === pol ? styles.policyBtnActive : null
                                ]}
                                onPress={() => assetState.setDownloadPolicy(pol as any)}
                            >
                                <Text style={[
                                    styles.policyBtnText,
                                    assetState.downloadPolicy === pol ? styles.policyBtnTextActive : null
                                ]}>
                                    {pol.toUpperCase()}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                    <Text style={styles.policyDesc}>
                        {assetState.downloadPolicy === 'everything' && 'Download all resources and attachments automatically on cell and Wi-Fi.'}
                        {assetState.downloadPolicy === 'wifi' && 'Only download assets when connected to a Wi-Fi connection.'}
                        {assetState.downloadPolicy === 'manual' && 'Disable background downloads. Users manually click to fetch resources.'}
                    </Text>
                </View>

                 {/* Diagnostics events telemetry */}
                <View style={styles.card}>
                    <Text style={styles.cardTitle}>OFFLINE TELEMETRY LOGS</Text>
                    <ScrollView style={styles.logBox} nestedScrollEnabled={true}>
                        {telemetryLogs.length === 0 ? (
                            <Text style={styles.emptyText}>No logs generated yet.</Text>
                        ) : (
                            telemetryLogs.slice(0, 30).map((log, idx) => (
                                <View key={idx} style={styles.logRow}>
                                    <Text style={styles.logTime}>{new Date(log.timestamp).toLocaleTimeString()}</Text>
                                    <Text style={styles.logEvent}>{log.event_type.toUpperCase()}</Text>
                                    <Text style={styles.logDetails} numberOfLines={1}>
                                        {log.failure_reason || log.hash_result || `Asset: ${log.asset_id}`}
                                    </Text>
                                </View>
                            ))
                        )}
                    </ScrollView>
                </View>

                {/* Actions */}
                <View style={styles.actionContainer}>
                    <TouchableOpacity style={styles.primaryBtn} onPress={handleForceSync} disabled={isLoading}>
                        {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>TRIGGER RE-SYNC</Text>}
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.secondaryBtn} onPress={handleResetBootstrap} disabled={isLoading}>
                        <Text style={styles.btnTextSecondary}>REBUILD OFFLINE LIBRARY</Text>
                    </TouchableOpacity>
                </View>

            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#121214',
    },
    scrollContent: {
        padding: 16,
        paddingBottom: 40,
    },
    card: {
        backgroundColor: '#1A1A1E',
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#26262B',
    },
    cardTitle: {
        color: '#8A8D93',
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 1,
        marginBottom: 14,
    },
    infoRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#232328',
    },
    infoLabel: {
        color: '#E1E3E6',
        fontSize: 14,
    },
    infoValue: {
        color: '#8A8D93',
        fontSize: 14,
        fontWeight: '500',
        maxWidth: '60%',
    },
    emptyText: {
        color: '#8A8D93',
        fontSize: 14,
        textAlign: 'center',
        marginVertical: 10,
    },
    textSuccess: {
        color: '#34D399',
    },
    textDanger: {
        color: '#F87171',
    },
    progressContainer: {
        marginTop: 14,
    },
    progressBarBg: {
        height: 6,
        backgroundColor: '#26262B',
        borderRadius: 3,
        overflow: 'hidden',
    },
    progressBarFill: {
        height: '100%',
        backgroundColor: '#10B981',
        borderRadius: 3,
    },
    progressText: {
        color: '#10B981',
        fontSize: 12,
        fontWeight: '600',
        marginTop: 6,
        textAlign: 'right',
    },
    policyRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 4,
        gap: 8,
    },
    policyBtn: {
        flex: 1,
        backgroundColor: '#232328',
        borderRadius: 8,
        paddingVertical: 10,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#2D2D35',
    },
    policyBtnActive: {
        backgroundColor: 'rgba(16, 185, 129, 0.15)',
        borderColor: '#10B981',
    },
    policyBtnText: {
        color: '#8A8D93',
        fontSize: 11,
        fontWeight: '700',
    },
    policyBtnTextActive: {
        color: '#10B981',
    },
    policyDesc: {
        color: '#8A8D93',
        fontSize: 12,
        marginTop: 10,
        lineHeight: 16,
    },
    logBox: {
        maxHeight: 150,
        backgroundColor: '#151518',
        borderRadius: 6,
        padding: 8,
    },
    logRow: {
        flexDirection: 'row',
        paddingVertical: 4,
        borderBottomWidth: 1,
        borderBottomColor: '#202025',
    },
    logTime: {
        color: '#60A5FA',
        fontSize: 11,
        width: 70,
    },
    logEvent: {
        color: '#E1E3E6',
        fontSize: 11,
        width: 120,
        fontWeight: '600',
    },
    logDetails: {
        color: '#8A8D93',
        fontSize: 10,
        flex: 1,
    },
    actionContainer: {
        marginTop: 10,
        gap: 12,
    },
    primaryBtn: {
        backgroundColor: '#10B981',
        borderRadius: 8,
        paddingVertical: 14,
        alignItems: 'center',
    },
    secondaryBtn: {
        backgroundColor: 'transparent',
        borderRadius: 8,
        paddingVertical: 14,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#EF4444',
    },
    btnText: {
        color: '#fff',
        fontWeight: '700',
        fontSize: 14,
        letterSpacing: 0.5,
    },
    btnTextSecondary: {
        color: '#EF4444',
        fontWeight: '700',
        fontSize: 14,
        letterSpacing: 0.5,
    },
});
