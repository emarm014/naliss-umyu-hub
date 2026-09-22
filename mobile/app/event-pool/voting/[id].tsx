import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Modal, Image } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../src/api/supabase/client';
import { useTheme } from '../../../src/stores/theme.store';
import { useAuthStore } from '../../../src/stores';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { mmkvStorage } from '../../../src/stores/mmkv.storage';
import * as Haptics from 'expo-haptics';
import { normalizeError } from '../../../src/utils/sentry';

interface Candidate {
  id: string;
  display_name: string;
  position_title: string;
  bio: string | null;
  photo_url: string | null;
  vote_count: number | null;
  is_winner: boolean;
  podium_rank: string | null;
}

export default function VotingEngineScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, isDark } = useTheme();
  const user = useAuthStore((s: any) => s.profile);
  const insets = useSafeAreaInsets();

  const [poolInfo, setPoolInfo] = useState<any>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [isSealed, setIsSealed] = useState(true);
  const [totalVotes, setTotalVotes] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  
  const [selectedBallot, setSelectedBallot] = useState<Record<string, string>>({});
  const [viewingCandidate, setViewingCandidate] = useState<Candidate | null>(null);
  const [ballotReceipt, setBallotReceipt] = useState<{ receiptCode: string; votedAt: string; poolId: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const receiptKey = `vote_receipt_${id}_${user?.id}`;

  useEffect(() => {
    const initVoting = async () => {
      if (!id || !user) return;
      setIsLoading(true);
      try {
        const { data: poolData, error: poolError } = await (supabase as any)
          .from('event_pools')
          .select('*')
          .eq('id', id)
          .maybeSingle();

        if (poolError) throw normalizeError(poolError);
        if (!poolData) {
          Alert.alert('Not Found', 'This voting pool could not be found.');
          router.back();
          return;
        }
        setPoolInfo(poolData);

        const receiptStr = await mmkvStorage.getItem(receiptKey);
        if (receiptStr) {
          setBallotReceipt(JSON.parse(receiptStr));
        }

        const { data, error } = await supabase.rpc('get_voting_candidates', { p_pool_id: id });
        if (error) throw normalizeError(error);
        
        const typedData = data as any;
        if (typedData) {
          setCandidates(typedData.candidates || []);
          setIsSealed(typedData.is_sealed);
          setTotalVotes(typedData.total_votes || 0);
        }
      } catch (err: any) {
        Alert.alert('Error', 'Failed to load voting room.');
        router.back();
      } finally {
        setIsLoading(false);
      }
    };
    initVoting();
  }, [id, user]);

  const isLive = useMemo(() => {
    if (!poolInfo) return false;
    if (poolInfo.status === 'live') return true;
    if (poolInfo.status === 'scheduled' && poolInfo.start_time) {
      const now = new Date();
      const start = new Date(poolInfo.start_time);
      return now >= start;
    }
    return false;
  }, [poolInfo]);

  const groupedCandidates = useMemo(() => {
    return candidates.reduce((acc: Record<string, Candidate[]>, cand) => {
      acc[cand.position_title] = acc[cand.position_title] || [];
      acc[cand.position_title].push(cand);
      return acc;
    }, {});
  }, [candidates]);

  const handleCastBallot = async () => {
    const selections = Object.entries(selectedBallot).map(([position_title, candidate_id]) => ({
      position_title,
      candidate_id
    }));

    if (selections.length === 0) {
      Alert.alert('Incomplete Ballot', 'You must select at least one candidate.');
      return;
    }

    Alert.alert(
      'Cast Ballot?',
      'Are you sure you want to seal and cast your ballot? This action is irreversible.',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Cast Ballot', 
          style: 'default',
          onPress: async () => {
            setIsSubmitting(true);
            try {
              const { data, error } = await supabase.rpc('cast_multi_post_ballot', { p_pool_id: id, p_selections: selections });
              if (error) throw normalizeError(error);
              
              const receiptCode = `NALISS-VOTE-${Math.random().toString(36).substring(2, 6).toUpperCase()}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
              const receipt = { receiptCode, votedAt: new Date().toISOString(), poolId: id as string };
              
              await mmkvStorage.setItem(receiptKey, JSON.stringify(receipt));
              setBallotReceipt(receipt);
              
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              
              const { data: refreshData } = await supabase.rpc('get_voting_candidates', { p_pool_id: id });
              const typedRefresh = refreshData as any;
              if (typedRefresh) {
                setCandidates(typedRefresh.candidates || []);
                setIsSealed(typedRefresh.is_sealed);
                setTotalVotes(typedRefresh.total_votes || 0);
              }
            } catch (err: any) {
              if (err.message?.includes('already voted')) {
                  Alert.alert('Error', 'You have already voted in this election.');
              } else {
                  Alert.alert('Failed to Cast Ballot', err.message || 'Unknown error');
              }
            } finally {
              setIsSubmitting(false);
            }
          }
        }
      ]
    );
  };

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  const officesCount = Object.keys(groupedCandidates).length;
  const selectionsCount = Object.keys(selectedBallot).length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 8 }}>
          <Ionicons name="close" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>{poolInfo?.title}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
        
        {/* BALLOT RECEIPT */}
        {ballotReceipt && (
          <View style={[styles.receiptCard, { backgroundColor: isDark ? '#064e3b' : '#ecfdf5', borderColor: '#34d399' }]}>
            <Ionicons name="checkmark-circle" size={32} color="#10b981" />
            <Text style={styles.receiptTitle}>Your Ballot Has Been Recorded Anonymously</Text>
            <View style={styles.receiptPill}>
              <Text style={styles.receiptPillText}>Receipt Ref: {ballotReceipt.receiptCode}</Text>
            </View>
            <Text style={styles.receiptSub}>Your vote is sealed in the decentralized ledger. Take a screenshot for your personal election audit.</Text>
          </View>
        )}

        {/* TURNOUT & LEADERBOARD */}
        <View style={[styles.turnoutHeader, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.turnoutText, { color: colors.primary }]}>Verified Turnout: {totalVotes} Ballots Cast</Text>
          {isSealed ? (
            <Text style={[styles.sealedText, { color: colors.textMuted }]}>🔒 Ballot Box Sealed • Standings will be revealed after voting concludes</Text>
          ) : (
            <Text style={[styles.unsealedText, { color: '#059669' }]}>🟢 Live Results Unsealed</Text>
          )}
        </View>

        {!isSealed && (
            <View style={{ marginTop: 24 }}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Election Results</Text>
              {Object.entries(groupedCandidates).map(([office, cands]) => (
                <View key={`res-${office}`} style={{ marginBottom: 20 }}>
                  <Text style={[styles.officeTitle, { color: colors.textMuted }]}>{office}</Text>
                  {cands.map((c, i) => {
                    const pct = totalVotes > 0 && c.vote_count ? (c.vote_count / totalVotes) * 100 : 0;
                    return (
                      <View key={`res-cand-${c.id}`} style={[styles.resultRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                          <Text style={{ color: colors.text, fontWeight: 'bold', flex: 1 }} numberOfLines={1}>
                            {(c.is_winner || c.podium_rank === '1st') && <Ionicons name="trophy" size={14} color="#eab308" /> } {c.display_name}
                          </Text>
                          <Text style={{ color: colors.textMuted, fontWeight: 'bold' }}>{c.vote_count} ({pct.toFixed(1)}%)</Text>
                        </View>
                        <View style={{ height: 6, backgroundColor: isDark ? '#334155' : '#e2e8f0', borderRadius: 3, overflow: 'hidden' }}>
                          <View style={{ height: '100%', width: `${pct}%`, backgroundColor: (c.is_winner || c.podium_rank === '1st') ? '#eab308' : colors.primary }} />
                        </View>
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
        )}

        {/* BALLOT SELECTION (Only if not voted and live) */}
        {!ballotReceipt && isLive && (
          <View style={{ marginTop: 24 }}>
             {Object.entries(groupedCandidates).map(([office, cands]) => (
                <View key={`vote-${office}`} style={{ marginBottom: 24 }}>
                  <Text style={[styles.officeHeader, { color: colors.text, backgroundColor: colors.card, borderColor: colors.border }]}>{office}</Text>
                  {cands.map(c => {
                    const isSelected = selectedBallot[office] === c.id;
                    return (
                      <TouchableOpacity 
                        key={`vote-cand-${c.id}`}
                        onPress={() => setSelectedBallot(prev => ({...prev, [office]: c.id}))}
                        style={[styles.candidateCard, { backgroundColor: colors.card, borderColor: isSelected ? colors.primary : colors.border }, isSelected && { borderWidth: 2 }]}
                      >
                        {c.photo_url ? (
                           <Image source={{uri: c.photo_url}} style={styles.candAvatar} />
                        ) : (
                           <View style={[styles.candAvatar, { backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' }]}>
                             <Ionicons name="person" size={20} color={colors.textMuted} />
                           </View>
                        )}
                        <View style={{ flex: 1, marginLeft: 12 }}>
                          <Text style={[styles.candName, { color: colors.text }]}>{c.display_name}</Text>
                          <TouchableOpacity onPress={() => setViewingCandidate(c)}>
                            <Text style={{ color: colors.primary, fontSize: 12, marginTop: 4 }}>Read Manifesto</Text>
                          </TouchableOpacity>
                        </View>
                        <View style={[styles.radioCircle, { borderColor: isSelected ? colors.primary : colors.textMuted }]}>
                          {isSelected && <View style={[styles.radioFill, { backgroundColor: colors.primary }]} />}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
             ))}
          </View>
        )}
      </ScrollView>

      {!ballotReceipt && isLive && (
        <View style={[styles.bottomBar, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
          <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: 'bold', marginBottom: 8, textAlign: 'center' }}>
            {selectionsCount} of {officesCount} offices selected
          </Text>
          <TouchableOpacity 
            disabled={selectionsCount === 0 || isSubmitting}
            onPress={handleCastBallot}
            style={[styles.castBtn, { backgroundColor: selectionsCount === 0 ? colors.border : colors.primary }]}
          >
            {isSubmitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.castBtnText}>Review & Cast Complete Ballot</Text>}
          </TouchableOpacity>
        </View>
      )}

      {/* Candidate Profile Modal */}
      <Modal visible={!!viewingCandidate} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setViewingCandidate(null)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
          <View style={[styles.header, { borderBottomColor: colors.border, justifyContent: 'flex-end' }]}>
            <TouchableOpacity onPress={() => setViewingCandidate(null)} style={{ padding: 8 }}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 24, alignItems: 'center' }}>
            {viewingCandidate?.photo_url ? (
              <Image source={{ uri: viewingCandidate.photo_url }} style={styles.modalAvatar} />
            ) : (
              <View style={[styles.modalAvatar, { backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' }]}>
                <Ionicons name="person" size={64} color={colors.textMuted} />
              </View>
            )}
            <Text style={[styles.modalName, { color: colors.text }]}>{viewingCandidate?.display_name}</Text>
            <View style={{ backgroundColor: colors.primary + '20', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, marginTop: 8 }}>
              <Text style={{ color: colors.primary, fontWeight: 'bold', fontSize: 12 }}>{viewingCandidate?.position_title}</Text>
            </View>
            <Text style={[styles.modalBio, { color: colors.text }]}>
              {viewingCandidate?.bio || 'No manifesto provided.'}
            </Text>
          </ScrollView>
          <View style={{ padding: 24 }}>
            {!ballotReceipt && isLive ? (
              <TouchableOpacity 
                style={[styles.castBtn, { backgroundColor: colors.primary }]}
                onPress={() => {
                  setSelectedBallot(prev => ({ ...prev, [viewingCandidate!.position_title]: viewingCandidate!.id }));
                  setViewingCandidate(null);
                }}
              >
                <Text style={styles.castBtnText}>Select for {viewingCandidate?.position_title}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[styles.castBtn, { backgroundColor: colors.border }]} onPress={() => setViewingCandidate(null)}>
                <Text style={[styles.castBtnText, { color: colors.text }]}>Close</Text>
              </TouchableOpacity>
            )}
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  title: { fontSize: 18, fontWeight: 'bold', marginLeft: 12 },
  receiptCard: { borderWidth: 2, borderRadius: 16, padding: 20, alignItems: 'center', marginBottom: 24 },
  receiptTitle: { fontSize: 16, fontWeight: 'bold', color: '#065f46', textAlign: 'center', marginTop: 12, marginBottom: 8 },
  receiptPill: { backgroundColor: '#10b981', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, marginBottom: 12 },
  receiptPillText: { color: '#fff', fontWeight: 'bold', fontSize: 12, fontFamily: 'monospace' },
  receiptSub: { fontSize: 12, color: '#047857', textAlign: 'center' },
  turnoutHeader: { borderWidth: 1, borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 8 },
  turnoutText: { fontSize: 16, fontWeight: 'bold', marginBottom: 4 },
  sealedText: { fontSize: 12, fontWeight: 'bold' },
  unsealedText: { fontSize: 12, fontWeight: 'bold' },
  sectionTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 16 },
  officeTitle: { fontSize: 14, fontWeight: 'bold', marginBottom: 8, textTransform: 'uppercase' },
  resultRow: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 8 },
  officeHeader: { padding: 12, fontSize: 14, fontWeight: 'bold', textTransform: 'uppercase', borderWidth: 1, borderRadius: 8, marginBottom: 12, overflow: 'hidden' },
  candidateCard: { flexDirection: 'row', alignItems: 'center', padding: 12, borderWidth: 1, borderRadius: 12, marginBottom: 12 },
  candAvatar: { width: 48, height: 48, borderRadius: 24 },
  candName: { fontSize: 16, fontWeight: 'bold' },
  radioCircle: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioFill: { width: 12, height: 12, borderRadius: 6 },
  bottomBar: { padding: 16, borderTopWidth: 1 },
  castBtn: { padding: 16, borderRadius: 12, alignItems: 'center' },
  castBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  modalAvatar: { width: 120, height: 120, borderRadius: 60, marginBottom: 16 },
  modalName: { fontSize: 24, fontWeight: 'bold' },
  modalBio: { fontSize: 16, marginTop: 24, lineHeight: 24, textAlign: 'center' }
});
