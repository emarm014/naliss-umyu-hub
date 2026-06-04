                                              import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Image,
  Alert,
  Dimensions,
  ActivityIndicator,
  Switch,
  Platform,
  Linking,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useResourceStore, useAuthStore } from '../../src/stores';
import { AcademicLevel } from '../../src/types';

import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../src/constants/Colors';
import { Material } from '../../src/types';
import { supabase } from '../../src/api/supabase/client';
import { Modal, TextInput } from 'react-native';
import { uploadLocalFileToCloudinary, uploadToCloudinary } from '../../src/lib/cloudinary';
import { useRouter, useFocusEffect } from 'expo-router';
import { useTheme, useThemeStore } from '../../src/stores/theme.store';
import { useSentryScreen } from '../../src/hooks/useSentryScreen';
import { trackFeature, captureUIError } from '../../src/utils/sentry';

const { width } = Dimensions.get('window');

const calculateUserPoints = (materials: Material[]) => {
  return materials.reduce((total, material) => {
    return total + 10 + (material.download_count || 0);
  }, 0);
};

const getUserRank = (points: number) => {
  if (points >= 1000) return 'Legend';
  if (points >= 500) return 'Expert';
  if (points >= 100) return 'Senior';
  if (points >= 50) return 'Contributor';
  return 'Novice';
};

export default function ProfileScreen() {
  useSentryScreen('ProfileScreen');
  const router = useRouter();
  const storeProfile = useAuthStore(s => s.profile);
  const updateProfile = useAuthStore(s => s.updateProfile);
  const updatePreferences = useAuthStore(s => s.updatePreferences);
  const fetchProfile = useAuthStore(s => s.fetchProfile);
  const lastFetch = useAuthStore(s => s.lastFetch);
  const lastLocalProfileUpdateAt = useAuthStore(s => s.lastLocalProfileUpdateAt);
  const confirmedAvatarUrl = useAuthStore(s => s.confirmedAvatarUrl);
  const materials = useResourceStore(s => s.materials);
  const { colors, isDark } = useTheme();
  const { toggleTheme } = useThemeStore();
  // Keep local fields in sync with store profile — so any update via updateProfile
  // (from this screen or anywhere else) reflects immediately in the edit form
  React.useEffect(() => {
    if (storeProfile) {
      // Keep editData in sync so the edit form always shows latest saved values
      setEditData(prev => ({
        ...prev,
        full_name: storeProfile.full_name || prev.full_name,
        username: (storeProfile as any).username || prev.username,
        registration_number: (storeProfile as any).registration_number || prev.registration_number,
        motivation: (storeProfile as any).motivation ?? prev.motivation,
        hobbies: (storeProfile as any).hobbies ?? prev.hobbies,
        biography: (storeProfile as any).biography ?? prev.biography,
      }));
      // Sync notifSettings from store profile to keep toggles in sync
      setNotifSettings(prev => ({
        notif_announcements: (storeProfile as any)?.notif_announcements ?? prev.notif_announcements,
        notif_events: (storeProfile as any)?.notif_events ?? prev.notif_events,
        notif_messages: (storeProfile as any)?.notif_messages ?? prev.notif_messages,
        notif_materials: (storeProfile as any)?.notif_materials ?? prev.notif_materials,
      }));
    }
  }, [storeProfile]);
  const [isLoading, setIsLoading] = useState(!storeProfile); // skip spinner if store already has profile
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSavingNotifs, setIsSavingNotifs] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isUpdatingAvatar, setIsUpdatingAvatar] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showSecurity, setShowSecurity] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showDisplay, setShowDisplay] = useState(false);
  const [notifSettings, setNotifSettings] = useState({
    notif_announcements: (storeProfile as any)?.notif_announcements ?? true,
    notif_events: (storeProfile as any)?.notif_events ?? true,
    notif_messages: (storeProfile as any)?.notif_messages ?? true,
    notif_materials: (storeProfile as any)?.notif_materials ?? true,
  });

  const closeNotificationsModal = () => {
    if (storeProfile) {
      setNotifSettings({
        notif_announcements: (storeProfile as any)?.notif_announcements ?? true,
        notif_events: (storeProfile as any)?.notif_events ?? true,
        notif_messages: (storeProfile as any)?.notif_messages ?? true,
        notif_materials: (storeProfile as any)?.notif_materials ?? true,
      });
    }
    setShowNotifications(false);
  };

  const [passwordData, setPasswordData] = useState({
    newPassword: '',
    confirmPassword: '',
  });
  const [editData, setEditData] = useState({
    full_name: storeProfile?.full_name || '',
    username: storeProfile?.username || '',
    registration_number: storeProfile?.registration_number || '',
    motivation: (storeProfile as any)?.motivation || '',
    hobbies: (storeProfile as any)?.hobbies || '',
    biography: (storeProfile as any)?.biography || '',
  });
  const [tempAvatarUri, setTempAvatarUri] = useState<string | null>(null);
  const [showAvatarConfirm, setShowAvatarConfirm] = useState(false);
  const [showPasswordVisible, setShowPasswordVisible] = useState(false);

  const fetchUserProfile = async () => {
    // Don't show spinner if we already have a profile cached
    if (!storeProfile) setIsLoading(true);
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) { setIsLoading(false); return; }

      const { data: profile, error } = await (supabase
        .from('users').select('*').eq('id', authUser.id).single() as any);

      if (error && error.code === 'PGRST116') { setIsLoading(false); return; }
      else if (error) throw error;

      // Only update store if the fetched profile is newer than
      // what we have — prevents overwriting a just-saved avatar_url with stale data
      const currentLastFetch = lastFetch || 0;
      const fetchedAt = Date.now();
      // If store was updated in the last 30 seconds (e.g. just after avatar upload),
      // skip overwriting — the store already has the correct fresh data.
      // 30s matches the avatar protection window in auth.store fetchProfile.
      const storeIsVeryFresh = fetchedAt - currentLastFetch < 30000;
      if (!storeIsVeryFresh) {
        useAuthStore.setState({ profile: profile as any, lastFetch: fetchedAt });
      } else {
        // Store is fresh — only update non-avatar fields so a stale DB row
        // never overwrites a just-uploaded avatar_url
        const currentProfile = useAuthStore.getState().profile;
        useAuthStore.setState({
          profile: {
            ...(profile as any),
            // Always keep the in-memory avatar_url — it's the most recent
            avatar_url: currentProfile?.avatar_url ?? (profile as any).avatar_url,
          } as any,
          lastFetch: fetchedAt,
        });
      }

      setEditData({
        full_name: (profile as any).full_name || '',
        username: (profile as any).username || '',
        registration_number: (profile as any).registration_number || '',
        motivation: (profile as any).motivation || '',
        hobbies: (profile as any).hobbies || '',
        biography: (profile as any).biography || '',
      });
      setNotifSettings({
        notif_announcements: (profile as any).notif_announcements ?? true,
        notif_events: (profile as any).notif_events ?? true,
        notif_messages: (profile as any).notif_messages ?? true,
        notif_materials: (profile as any).notif_materials ?? true,
      });
    } catch {
      // silent — keep cached profile on network failure
    } finally {
      setIsLoading(false);
    }
  };

  useFocusEffect(
    React.useCallback(() => {
      fetchUserProfile();
    }, [])
  );

  // ── Realtime: reflect role changes (promoted/demoted) immediately ─────────
  // Subscribes to the user's own row. When admin promotes to moderator or
  // demotes back to student, the badge and profile update instantly.
  React.useEffect(() => {
    const userId = storeProfile?.id;
    if (!userId) return;

    const channel = supabase
      .channel(`profile-role-watch-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'users',
          filter: `id=eq.${userId}`,
        },
        (payload: any) => {
          const updated = payload.new;
          if (!updated) return;
          // Merge realtime update into store — but NEVER overwrite confirmedAvatarUrl
          const currentState = useAuthStore.getState();
          useAuthStore.setState({
            profile: {
              ...currentState.profile,
              ...updated,
              // Iron rule: confirmed avatar always wins over realtime DB push
              avatar_url: currentState.confirmedAvatarUrl || updated.avatar_url || currentState.profile?.avatar_url,
            } as any,
          });
          // Force-fetch only non-avatar fields — skip if it would overwrite avatar
          fetchProfile(true);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [storeProfile?.id]);

  const handleUpdateProfile = async () => {
    if (!storeProfile?.id) return;

    // Validate username — only lowercase letters, numbers, underscores
    const trimmedUsername = editData.username.trim();
    if (trimmedUsername && !/^[a-z0-9_]{3,30}$/.test(trimmedUsername)) {
      Alert.alert('Invalid Username', 'Username must be 3–30 characters and can only contain lowercase letters, numbers, and underscores.');
      return;
    }

    setIsSavingProfile(true);
    try {
      const editableUpdates = {
        username: trimmedUsername,
        motivation: editData.motivation.trim(),
        hobbies: editData.hobbies.trim(),
        biography: editData.biography.trim(),
      };

      // Sync to DB + store + message cache
      // updateProfile does optimistic store update first, then DB
      // On real DB error it reverts the optimistic update and throws
      await updateProfile(editableUpdates);

      // Only close modal AFTER DB confirms
      setIsEditing(false);
      Alert.alert('Success', 'Profile updated successfully');
    } catch (err: any) {
      captureUIError('ProfileScreen.saveProfile', err);
      // Show the actual error — most common is username already taken
      const msg = err?.message || '';
      if (msg.includes('unique') || msg.includes('duplicate') || msg.includes('users_username_key')) {
        Alert.alert('Username Taken', `"${editData.username}" is already in use. Please choose a different username.`);
      } else if (msg.includes('fetch') || msg.includes('network') || msg.includes('connection')) {
        // Network error — optimistic update already applied, will sync later
        setIsEditing(false);
        Alert.alert('Saved Locally', 'Your changes have been saved on this device and will sync when your connection is restored.');
      } else {
        Alert.alert('Error', `Failed to save: ${msg || 'Please try again.'}`);
      }
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleLogout = async () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: () => {
          // Add a 300ms delay to allow the Alert modal to fully dismiss.
          // If we navigate synchronously, React Navigation can silently drop
          // the route change because the view hierarchy is locked during dismiss.
          setTimeout(async () => {
            await useAuthStore.getState().signOut();
          }, 300);
        },
      },
    ]);
  };


  const handleAvatarPress = () => {
    Alert.alert('Update Profile Picture', 'How would you like to update your avatar?', [
      { text: 'Pick from Gallery', onPress: pickImage },
      { text: 'Generate Random Sticker', onPress: generateSticker },
      { text: 'Cancel', style: 'cancel' }
    ], { cancelable: true });
  };

  const generateSticker = async () => {
    if (!storeProfile?.id) return;
    trackFeature('profile', 'generate_sticker', { userId: storeProfile.id });
    setIsUpdatingAvatar(true);
    try {
      const randomSeed = Math.random().toString(36).substring(7);
      // Use SVG format — smaller, faster, always works
      const stickerUrl = `https://api.dicebear.com/9.x/fun-emoji/png?seed=${randomSeed}&size=200`;

      // Fetch with timeout — don't hang forever if DiceBear is slow
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
      let response: Response;
      try {
        response = await fetch(stickerUrl, { signal: controller.signal });
        clearTimeout(timeoutId);
      } catch (fetchErr: any) {
        clearTimeout(timeoutId);
        if (fetchErr?.name === 'AbortError') {
          throw new Error('Request timed out. Please check your connection and try again.');
        }
        throw fetchErr;
      }

      if (!response.ok) throw new Error(`Failed to fetch sticker (${response.status})`);
      const blob = await response.blob();

      const hostedUrl = await uploadToCloudinary(blob, 'avatars');

      // Sync to DB + auth metadata + store (optimistic — never reverts on network error)
      await updateProfile({ avatar_url: hostedUrl });

      Alert.alert('Done!', 'Your profile picture has been updated.');
    } catch (err: any) {
      captureUIError('ProfileScreen.generateSticker', err, { userId: storeProfile?.id });
      const isNetwork = err?.message?.includes('fetch') ||
        err?.message?.includes('network') ||
        err?.message?.includes('timed out') ||
        err?.name === 'AbortError';
      if (isNetwork) {
        Alert.alert('Connection Error', 'Could not generate sticker. Please check your internet connection and try again.');
      } else {
        Alert.alert('Error', err?.message || 'Failed to generate sticker. Please try again.');
      }
    } finally {
      setIsUpdatingAvatar(false);
    }
  };

  const pickImage = async () => {
    if (!storeProfile?.id) return;

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please grant photo library access to change your avatar.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });

    if (!result.canceled && result.assets[0].uri) {
      setTempAvatarUri(result.assets[0].uri);
      setShowAvatarConfirm(true);
    }
  };

  const confirmAndUploadAvatar = async () => {
    if (!tempAvatarUri || !storeProfile?.id) return;

    // Capture URI immediately before any state changes
    const uri = tempAvatarUri;
    const fileName = `${storeProfile.id}-avatar-${Date.now()}.jpg`;

    setIsUpdatingAvatar(true);
    setShowAvatarConfirm(false);
    setTempAvatarUri(null);

    try {
      // Upload to Cloudinary
      const avatarUrl = await uploadLocalFileToCloudinary(uri, fileName, 'avatars', 'image/jpeg');

      // Sync to DB + auth metadata + store
      await updateProfile({ avatar_url: avatarUrl });

      Alert.alert('Success', 'Profile photo updated successfully!');
    } catch (err: any) {
      captureUIError('ProfileScreen.confirmAndUploadAvatar', err, { userId: storeProfile?.id });
      const isNetworkError = err?.message?.includes('fetch') ||
        err?.message?.includes('network') ||
        err?.message?.includes('timed out') ||
        err?.message?.includes('connection') ||
        err?.name === 'AbortError';

      if (isNetworkError) {
        // Upload may have reached Cloudinary — don't alarm the user
        Alert.alert('Slow Connection', 'Your photo was sent but the connection is slow. It may take a moment to appear.');
      } else {
        Alert.alert('Error', `Failed to upload profile photo: ${err?.message || 'Please try again.'}`);
      }
    } finally {
      setIsUpdatingAvatar(false);
    }
  };

  const handleChangePassword = async () => {
    const { newPassword, confirmPassword } = passwordData;

    if (!newPassword || !confirmPassword) {
      Alert.alert('Required', 'Please fill in both password fields.');
      return;
    }
    if (newPassword.length < 8) {
      Alert.alert('Too Short', 'Password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Mismatch', 'Passwords do not match. Please check and try again.');
      return;
    }

    setIsChangingPassword(true);
    try {
      // Add a 15-second timeout to prevent the UI from hanging endlessly 
      // if the Supabase network request gets stuck.
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Request timed out. Please check your connection and try again.')), 15000);
      });

      const updatePromise = supabase.auth.updateUser({
        password: newPassword,
      });

      const { data, error } = await Promise.race([updatePromise, timeoutPromise]) as any;

      if (error) throw error;

      setPasswordData({ newPassword: '', confirmPassword: '' });
      setShowSecurity(false);
      Alert.alert('Password Changed', 'Your password has been updated successfully. Use it next time you sign in.');
    } catch (err: any) {
      captureUIError('ProfileScreen.handleChangePassword', err);
      const msg = err?.message || '';
      if (msg.includes('same password') || msg.includes('different from')) {
        Alert.alert('Same Password', 'Your new password must be different from your current password.');
      } else if (msg.includes('weak') || msg.includes('strength')) {
        Alert.alert('Weak Password', 'Please choose a stronger password with a mix of letters, numbers, and symbols.');
      } else if (msg.includes('session') || msg.includes('expired') || msg.includes('JWT')) {
        Alert.alert('Session Expired', 'Your session has expired. Please sign out and sign in again, then try changing your password.');
      } else if (msg.includes('fetch') || msg.includes('network') || msg.includes('connection')) {
        Alert.alert('No Connection', 'Could not reach the server. Please check your internet connection and try again.');
      } else {
        Alert.alert('Failed', `Could not change password: ${msg || 'Please try again.'}`);
      }
    } finally {
      setIsChangingPassword(false);
    }
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'system_owner':
        return ['#7c3aed', '#4c1d95']; // Violet
      case 'super_admin':
        return ['#dc2626', '#991b1b']; // Red
      case 'moderator':
        return ['#d97706', '#92400e']; // Amber
      default:
        return [COLORS.primary, COLORS.secondary];
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'system_owner':
        return 'System Owner';
      case 'super_admin':
        return 'Super Admin';
      case 'moderator':
        return 'Moderator';
      default:
        return 'Student';
    }
  };

  if (isLoading && !storeProfile) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (!storeProfile) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: colors.background }]}>
        <Ionicons name="person-outline" size={64} color={colors.textMuted} />
        <Text style={{ marginTop: 20, fontSize: 18, fontFamily: 'Inter-SemiBold', color: colors.textSecondary }}>Profile Not Found</Text>
        <Text style={{ textAlign: 'center', marginTop: 10, color: colors.textMuted }}>Please ensure you are logged in correctly.</Text>
        <TouchableOpacity style={[styles.saveButton, { width: '100%', marginTop: 30 }]} onPress={handleLogout}>
          <Text style={styles.saveButtonText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]} showsVerticalScrollIndicator={false}>
      <LinearGradient
        colors={[COLORS.primary, COLORS.secondary]}
        style={styles.header}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0.5 }}
      >
        <TouchableOpacity
          style={styles.avatarContainer}
          onPress={handleAvatarPress}
          disabled={isLoading || isUpdatingAvatar}
        >
          {/* Always show an avatar — confirmedAvatarUrl is the iron-clad source,
              falls back to profile.avatar_url, then DiceBear sticker. Never blank. */}
          {(() => {
            const avatarUri = confirmedAvatarUrl
              || storeProfile?.avatar_url
              || (storeProfile?.id ? `https://api.dicebear.com/9.x/fun-emoji/png?seed=${storeProfile.id}&size=200` : null);
            return avatarUri ? (
              <Image
                key={`${avatarUri}-${lastLocalProfileUpdateAt || 0}`}
                source={{ uri: avatarUri, cache: 'force-cache' }}
                style={styles.avatar}
              />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarText}>
                  {(storeProfile?.full_name || '?').charAt(0).toUpperCase()}
                </Text>
              </View>
            );
          })()}
          {isUpdatingAvatar ? (
            <View style={[styles.editBadge, { backgroundColor: '#059669' }]}>
              <ActivityIndicator size="small" color="#FFF" />
            </View>
          ) : (
            <View style={styles.editBadge}>
              <Ionicons name="camera" size={14} color="#FFF" />
            </View>
          )}
        </TouchableOpacity>

        <Text style={styles.userName}>{storeProfile?.full_name}</Text>
        {storeProfile?.username && (
          <Text style={styles.userUsername}>@{storeProfile.username}</Text>
        )}
        <Text style={styles.userEmail}>{storeProfile?.email}</Text>

        {storeProfile?.motivation && (
          <View style={styles.motivationContainer}>
            <Ionicons name="chatbubble-ellipses-outline" size={12} color="rgba(255,255,255,0.6)" />
            <Text style={styles.motivationText} numberOfLines={2}>
              {storeProfile.motivation}
            </Text>
          </View>
        )}

        <View style={styles.roleContainer}>
          <LinearGradient
            colors={getRoleBadgeColor(storeProfile?.role || 'student') as any}
            style={styles.roleBadge}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            <Text style={styles.roleText}>{getRoleLabel(storeProfile?.role || 'student')}</Text>
          </LinearGradient>
        </View>
      </LinearGradient>

      {/* Stats Row - Compact & Premium */}
      <View style={[styles.statsContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: colors.text }]}>{calculateUserPoints(materials)}</Text>
          <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Points</Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.divider }]} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: colors.text }]}>{storeProfile?.level || '100'}</Text>
          <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Level</Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.divider }]} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: colors.text }]}>{getUserRank(calculateUserPoints(materials))}</Text>
          <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Rank</Text>
        </View>
      </View>

      <View style={[styles.content, { backgroundColor: colors.background }]}>
        {/* New Biography Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>Biography</Text>
          <View style={[styles.menuCard, { backgroundColor: colors.card }]}>
            <View style={styles.descriptionPadding}>
              <Text style={[styles.descriptionText, { color: colors.textSecondary }]}>
                {storeProfile?.biography || 'No biography provided yet. Tell us about yourself!'}
              </Text>
            </View>
          </View>
        </View>

        {/* New Hobbies Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>Hobbies & Interests</Text>
          <View style={[styles.menuCard, { backgroundColor: colors.card }]}>
            <View style={styles.descriptionPadding}>
              <Text style={[styles.descriptionText, { color: colors.textSecondary }]}>
                {storeProfile?.hobbies || 'Share your hobbies with the community!'}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>Account Details</Text>

          <View style={[styles.menuCard, { backgroundColor: colors.card }]}>
            <InfoItem
              icon="person"
              label="Full Name"
              value={storeProfile?.full_name || 'Not available'}
              colors={colors}
            />
            <InfoItem
              icon="at"
              label="Username"
              value={storeProfile?.username ? `@${storeProfile.username}` : 'Not set'}
              colors={colors}
            />
            <InfoItem
              icon="mail"
              label="Email"
              value={storeProfile?.email || 'Not available'}
              colors={colors}
            />
            <InfoItem
              icon="card"
              label="Registration No."
              value={storeProfile?.registration_number || 'Not available'}
              colors={colors}
            />
            <InfoItem
              icon="school"
              label="Academic Level"
              value={`${storeProfile?.level || '100'} Level`}
              isLast
              colors={colors}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>Settings</Text>

          <View style={[styles.menuCard, { backgroundColor: colors.card }]}>
            <MenuItem 
              icon="create" 
              iconColor="#0284c7" 
              iconBg={COLORS.actionBlue} 
              label="Edit Profile" 
              onPress={() => setIsEditing(true)}
              colors={colors}
            />
            <MenuItem 
              icon="color-palette" 
              iconColor="#7c3aed" 
              iconBg={COLORS.actionPurple} 
              label="Display" 
              onPress={() => setShowDisplay(true)}
              colors={colors}
            />
            <MenuItem 
              icon="lock-closed" 
              iconColor="#0284c7" 
              iconBg={COLORS.actionBlue} 
              label="Security" 
              onPress={() => setShowSecurity(true)}
              colors={colors}
            />
            <MenuItem 
              icon="notifications" 
              iconColor="#ea580c" 
              iconBg={COLORS.actionOrange} 
              label="Notification Preferences" 
              onPress={() => {
                if (storeProfile) {
                  setNotifSettings({
                    notif_announcements: (storeProfile as any)?.notif_announcements ?? true,
                    notif_events: (storeProfile as any)?.notif_events ?? true,
                    notif_messages: (storeProfile as any)?.notif_messages ?? true,
                    notif_materials: (storeProfile as any)?.notif_materials ?? true,
                  });
                }
                setShowNotifications(true);
              }}
              rightContent={<Ionicons name="chevron-forward" size={20} color={colors.textMuted} />}
              colors={colors}
            />
            <MenuItem 
              icon="help-circle" 
              iconColor="#059669" 
              iconBg={COLORS.actionMint} 
              label="Help & Support" 
              onPress={() => Alert.alert(
                'Help & Support', 
                'For assistance, contact us at:\n\nnalissumyuk@gmail.com\n\nOr visit the NALISS office at the Department of Library and Information Science, UMYU.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Send Email', onPress: () => Linking.openURL('mailto:nalissumyuk@gmail.com') }
                ]
              )}
              colors={colors}
            />
            <MenuItem 
              icon="log-out" 
              iconColor={COLORS.error} 
              iconBg={COLORS.actionRed} 
              label="Sign Out" 
              onPress={handleLogout} 
              isLast
              colors={colors}
            />
          </View>
        </View>

        {/* Edit Profile Modal */}
        <Modal
            visible={isEditing}
            animationType="slide"
            transparent={true}
            onRequestClose={() => setIsEditing(false)}
        >
            <View style={styles.modalOverlay}>
                <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
                    <View style={styles.modalHeader}>
                        <Text style={[styles.modalTitle, { color: colors.text }]}>Edit Profile</Text>
                        <TouchableOpacity onPress={() => setIsEditing(false)}>
                            <Ionicons name="close" size={24} color={colors.text} />
                        </TouchableOpacity>
                    </View>

                    <ScrollView style={styles.modalForm}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Full Name</Text>
                            <Ionicons name="lock-closed" size={12} color={colors.textMuted} style={{ marginLeft: 4, marginBottom: 8 }} />
                        </View>
                        <TextInput
                            style={[styles.textInput, { backgroundColor: isDark ? '#1e293b' : '#f1f5f9', color: colors.textMuted, borderColor: colors.border }]}
                            value={editData.full_name}
                            editable={false}
                            placeholder="Full Name"
                            placeholderTextColor={colors.textMuted}
                            keyboardAppearance={isDark ? 'dark' : 'light'}
                        />
                        <Text style={[styles.inputSubtext, { marginBottom: 16, color: colors.textMuted }]}>Official name cannot be changed. Contact Admin for corrections.</Text>

                        <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Username</Text>
                        <TextInput
                            style={[styles.textInput, { backgroundColor: isDark ? '#1e293b' : '#f8fafc', color: colors.text, borderColor: colors.border }]}
                            value={editData.username}
                            onChangeText={(text) => setEditData({ ...editData, username: text.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
                            placeholder="username (e.g. nura_abd)"
                            placeholderTextColor={colors.textMuted}
                            autoCapitalize="none"
                            keyboardAppearance={isDark ? 'dark' : 'light'}
                        />

                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Registration Number (Matric No.)</Text>
                            <Ionicons name="lock-closed" size={12} color={colors.textMuted} style={{ marginLeft: 4, marginBottom: 8 }} />
                        </View>
                        <TextInput
                            style={[styles.textInput, { backgroundColor: isDark ? '#1e293b' : '#f1f5f9', color: colors.textMuted, borderColor: colors.border }]}
                            value={editData.registration_number}
                            editable={false}
                            placeholder="UMYU/LIS/XX/XXXX"
                            placeholderTextColor={colors.textMuted}
                            keyboardAppearance={isDark ? 'dark' : 'light'}
                        />
                        <Text style={[styles.inputSubtext, { marginBottom: 16, color: colors.textMuted }]}>Registration number is fixed after sign-up.</Text>

                        <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Motivation Quote</Text>
                        <TextInput
                            style={[styles.textInput, styles.textArea, { backgroundColor: isDark ? '#1e293b' : '#f8fafc', color: colors.text, borderColor: colors.border }]}
                            value={editData.motivation}
                            onChangeText={(text) => setEditData({ ...editData, motivation: text })}
                            placeholder="Your motivation..."
                            placeholderTextColor={colors.textMuted}
                            multiline
                            numberOfLines={2}
                            keyboardAppearance={isDark ? 'dark' : 'light'}
                        />

                        <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Biography</Text>
                        <TextInput
                            style={[styles.textInput, styles.textArea, { backgroundColor: isDark ? '#1e293b' : '#f8fafc', color: colors.text, borderColor: colors.border }]}
                            value={editData.biography}
                            onChangeText={(text) => setEditData({ ...editData, biography: text })}
                            placeholder="About you..."
                            placeholderTextColor={colors.textMuted}
                            multiline
                            numberOfLines={4}
                            keyboardAppearance={isDark ? 'dark' : 'light'}
                        />

                        <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Hobbies</Text>
                        <TextInput
                            style={[styles.textInput, styles.textArea, { backgroundColor: isDark ? '#1e293b' : '#f8fafc', color: colors.text, borderColor: colors.border }]}
                            value={editData.hobbies}
                            onChangeText={(text) => setEditData({ ...editData, hobbies: text })}
                            placeholder="Your hobbies (comma separated)..."
                            placeholderTextColor={colors.textMuted}
                            multiline
                            numberOfLines={3}
                            keyboardAppearance={isDark ? 'dark' : 'light'}
                        />

                        <TouchableOpacity
                            style={styles.saveButton}
                            onPress={handleUpdateProfile}
                            disabled={isSavingProfile}
                        >
                            {isSavingProfile ? (
                                <ActivityIndicator color="#FFF" />
                            ) : (
                                <Text style={styles.saveButtonText}>Save Changes</Text>
                            )}
                        </TouchableOpacity>
                        <View style={{ height: 40 }} />
                    </ScrollView>
                </View>
            </View>
        </Modal>

        {/* Security / Password Change Modal */}
        <Modal
            visible={showSecurity}
            animationType="slide"
            transparent={true}
            onRequestClose={() => { setShowSecurity(false); setPasswordData({ newPassword: '', confirmPassword: '' }); }}
        >
            <View style={styles.modalOverlay}>
                <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
                    <View style={styles.modalHeader}>
                        <Text style={[styles.modalTitle, { color: colors.text }]}>Change Password</Text>
                        <TouchableOpacity onPress={() => { setShowSecurity(false); setPasswordData({ newPassword: '', confirmPassword: '' }); }}>
                            <Ionicons name="close" size={24} color={colors.text} />
                        </TouchableOpacity>
                    </View>

                    <ScrollView style={styles.modalForm}>
                        <View style={styles.securityInfoCard}>
                            <Ionicons name="shield-checkmark" size={24} color="#059669" />
                            <Text style={styles.securityInfoText}>
                              Use a strong password with at least 8 characters. Mix letters, numbers, and symbols for best security.
                            </Text>
                        </View>

                        <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>New Password</Text>
                        <View style={{ position: 'relative' }}>
                          <TextInput
                              style={[styles.textInput, { backgroundColor: isDark ? '#1e293b' : '#f8fafc', color: colors.text, borderColor: colors.border, paddingRight: 48 }]}
                              value={passwordData.newPassword}
                              onChangeText={(text) => setPasswordData({ ...passwordData, newPassword: text })}
                              placeholder="At least 8 characters"
                              placeholderTextColor={colors.textMuted}
                              secureTextEntry={!showPasswordVisible}
                              autoCapitalize="none"
                              autoCorrect={false}
                              keyboardAppearance={isDark ? 'dark' : 'light'}
                          />
                          <TouchableOpacity
                              onPress={() => setShowPasswordVisible(v => !v)}
                              style={{ position: 'absolute', right: 14, top: 0, bottom: 0, justifyContent: 'center' }}
                          >
                              <Ionicons name={showPasswordVisible ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textMuted} />
                          </TouchableOpacity>
                        </View>
                        {/* Password strength indicator */}
                        {passwordData.newPassword.length > 0 && (() => {
                          const len = passwordData.newPassword.length;
                          const strength = len < 8 ? 1 : len < 12 ? 2 : 3;
                          const colors2 = ['#ef4444', '#f59e0b', '#16a34a'];
                          const labels = ['Weak', 'Fair', 'Strong'];
                          return (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, marginBottom: 4 }}>
                              {[1,2,3].map(s => (
                                <View key={s} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: strength >= s ? colors2[strength - 1] : (isDark ? '#334155' : '#e2e8f0') }} />
                              ))}
                              <Text style={{ fontSize: 11, fontFamily: 'Inter-SemiBold', color: colors2[strength - 1], width: 44, textAlign: 'right' }}>{labels[strength - 1]}</Text>
                            </View>
                          );
                        })()}

                        <Text style={[styles.inputLabel, { color: colors.textSecondary, marginTop: 8 }]}>Confirm New Password</Text>
                        <View style={{ position: 'relative' }}>
                          <TextInput
                              style={[styles.textInput, {
                                backgroundColor: isDark ? '#1e293b' : '#f8fafc',
                                color: colors.text,
                                borderColor: passwordData.confirmPassword.length > 0
                                  ? (passwordData.confirmPassword === passwordData.newPassword ? '#16a34a' : '#ef4444')
                                  : colors.border,
                                paddingRight: 48,
                              }]}
                              value={passwordData.confirmPassword}
                              onChangeText={(text) => setPasswordData({ ...passwordData, confirmPassword: text })}
                              placeholder="Re-enter your password"
                              placeholderTextColor={colors.textMuted}
                              secureTextEntry={!showPasswordVisible}
                              autoCapitalize="none"
                              autoCorrect={false}
                              keyboardAppearance={isDark ? 'dark' : 'light'}
                          />
                          {passwordData.confirmPassword.length > 0 && (
                            <View style={{ position: 'absolute', right: 14, top: 0, bottom: 0, justifyContent: 'center' }}>
                              <Ionicons
                                name={passwordData.confirmPassword === passwordData.newPassword ? 'checkmark-circle' : 'close-circle'}
                                size={20}
                                color={passwordData.confirmPassword === passwordData.newPassword ? '#16a34a' : '#ef4444'}
                              />
                            </View>
                          )}
                        </View>

                        <TouchableOpacity
                            style={[styles.saveButton, { marginTop: 20 }]}
                            onPress={handleChangePassword}
                            disabled={isChangingPassword}
                        >
                            {isChangingPassword ? (
                                <ActivityIndicator color="#FFF" />
                            ) : (
                                <Text style={styles.saveButtonText}>Change Password</Text>
                            )}
                        </TouchableOpacity>
                        <View style={{ height: 40 }} />
                    </ScrollView>
                </View>
            </View>
        </Modal>

        {/* Notifications Settings Modal */}
        <Modal
            visible={showNotifications}
            animationType="slide"
            transparent={true}
            onRequestClose={closeNotificationsModal}
        >
            <View style={styles.modalOverlay}>
                <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
                    <View style={styles.modalHeader}>
                        <Text style={[styles.modalTitle, { color: colors.text }]}>Notifications</Text>
                        <TouchableOpacity onPress={closeNotificationsModal}>
                            <Ionicons name="close" size={24} color={colors.text} />
                        </TouchableOpacity>
                    </View>

                    <ScrollView style={styles.modalForm}>
                        <NotifToggle
                            icon="megaphone"
                            label="Announcements"
                            description="Receive notifications for new announcements"
                            value={notifSettings.notif_announcements}
                            onToggle={(val) => setNotifSettings(prev => ({ ...prev, notif_announcements: val }))}
                        />
                        <NotifToggle
                            icon="calendar"
                            label="Events"
                            description="Get reminded about upcoming events"
                            value={notifSettings.notif_events}
                            onToggle={(val) => setNotifSettings(prev => ({ ...prev, notif_events: val }))}
                        />
                        <NotifToggle
                            icon="chatbubble-ellipses"
                            label="Messages"
                            description="Notifications for group chat messages"
                            value={notifSettings.notif_messages}
                            onToggle={(val) => setNotifSettings(prev => ({ ...prev, notif_messages: val }))}
                        />
                        <NotifToggle
                            icon="folder"
                            label="New Materials"
                            description="Alert when new study materials are uploaded"
                            value={notifSettings.notif_materials}
                            onToggle={(val) => setNotifSettings(prev => ({ ...prev, notif_materials: val }))}
                        />

                        <TouchableOpacity
                            style={[styles.saveButton, { marginTop: 24 }]}
                            onPress={async () => {
                                setIsSavingNotifs(true);
                                try {
                                    // A manual timeout to prevent endless hanging if network is silently dropping
                                    const savePromise = updatePreferences(notifSettings);
                                    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000));
                                    await Promise.race([savePromise, timeoutPromise]);
                                    setShowNotifications(false);
                                    Alert.alert('Saved', 'Notification preferences updated.');
                                } catch (e: any) {
                                    if (e.message === 'timeout') {
                                        Alert.alert('Network Error', 'The request timed out. Please check your internet connection.');
                                    } else {
                                        Alert.alert('Error', 'Failed to save preferences. Please try again.');
                                    }
                                } finally {
                                    setIsSavingNotifs(false);
                                }
                            }}
                            disabled={isSavingNotifs}
                        >
                            {isSavingNotifs ? (
                                <ActivityIndicator color="#FFF" />
                            ) : (
                                <Text style={styles.saveButtonText}>Save Changes</Text>
                            )}
                        </TouchableOpacity>
                        <View style={{ height: 40 }} />
                    </ScrollView>
                </View>
            </View>
        </Modal>

        {/* Display / Theme Settings Modal */}
        <Modal
            visible={showDisplay}
            animationType="slide"
            transparent={true}
            onRequestClose={() => setShowDisplay(false)}
        >
            <View style={styles.modalOverlay}>
                <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
                    <View style={styles.modalHeader}>
                        <Text style={[styles.modalTitle, { color: colors.text }]}>Display</Text>
                        <TouchableOpacity onPress={() => setShowDisplay(false)}>
                            <Ionicons name="close" size={24} color={colors.text} />
                        </TouchableOpacity>
                    </View>

                    <ScrollView style={styles.modalForm}>
                        {/* Theme section */}
                        <View style={{ marginBottom: 8 }}>
                            <Text style={[styles.sectionTitle, { color: colors.textMuted, marginBottom: 12 }]}>
                                THEME
                            </Text>
                            <View style={[styles.menuCard, { backgroundColor: isDark ? colors.surfaceVariant : '#f8fafc' }]}>
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
                                    <View style={[{
                                        width: 22, height: 22, borderRadius: 11,
                                        borderWidth: 2,
                                        borderColor: !isDark ? COLORS.primary : colors.border,
                                        alignItems: 'center', justifyContent: 'center',
                                    }]}>
                                        {!isDark && (
                                            <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: COLORS.primary }} />
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
                                    <View style={[{
                                        width: 22, height: 22, borderRadius: 11,
                                        borderWidth: 2,
                                        borderColor: isDark ? COLORS.primary : colors.border,
                                        alignItems: 'center', justifyContent: 'center',
                                    }]}>
                                        {isDark && (
                                            <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: COLORS.primary }} />
                                        )}
                                    </View>
                                </TouchableOpacity>
                            </View>
                        </View>

                        {/* Info note */}
                        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 16, backgroundColor: isDark ? '#0f2a1a' : '#f0fdf4', borderRadius: 16, marginTop: 8 }}>
                            <Ionicons name="information-circle-outline" size={18} color={COLORS.primary} style={{ marginTop: 1 }} />
                            <Text style={{ flex: 1, fontSize: 13, color: colors.textSecondary, fontFamily: 'Inter-Regular', lineHeight: 20 }}>
                                Your display preference is saved on this device and works offline.
                            </Text>
                        </View>

                        <View style={{ height: 40 }} />
                    </ScrollView>
                </View>
            </View>
        </Modal>

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.textMuted }]}>NALISS UMYU HUB v1.0.0</Text>
          <Text style={[styles.footerSubtext, { color: colors.textMuted }]}>© 2026 NALISS Department, UMYU</Text>
        </View>
      </View>
      {/* Avatar Confirmation Modal — inline JSX, NOT a nested component (prevents shaking) */}
      <Modal
        visible={showAvatarConfirm}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowAvatarConfirm(false)}
      >
        <View style={styles.avatarModalOverlay}>
          <View style={[styles.avatarModalContent, { backgroundColor: colors.card }]}>
            <View style={styles.avatarModalHeader}>
              <Text style={[styles.avatarModalTitle, { color: colors.text }]}>Confirm New Photo</Text>
              <TouchableOpacity onPress={() => setShowAvatarConfirm(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.previewContainer}>
              {tempAvatarUri && (
                <Image source={{ uri: tempAvatarUri }} style={styles.avatarPreview} />
              )}
            </View>

            <Text style={[styles.modalDescription, { color: colors.textMuted }]}>
              This will be visible to everyone in the NALISS community.
            </Text>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={[styles.cancelButton, { flex: 1, borderColor: colors.border, backgroundColor: colors.surface }]}
                onPress={() => setShowAvatarConfirm(false)}
                disabled={isUpdatingAvatar}
              >
                <Text style={[styles.cancelButtonText, { color: colors.textSecondary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveButton, { flex: 1, marginLeft: 0, marginTop: 0, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10 }]}
                onPress={confirmAndUploadAvatar}
                disabled={isUpdatingAvatar}
              >
                {isUpdatingAvatar ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={[styles.saveButtonText, { fontSize: 13 }]}>SAVE AND UPLOAD</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function InfoItem({ icon, label, value, isLast, colors }: { icon: keyof typeof Ionicons.glyphMap, label: string, value: string, isLast?: boolean, colors: any }) {
  return (
    <View style={[styles.infoItem, isLast && { borderBottomWidth: 0 }, { borderBottomColor: colors.divider }]}>
      <View style={[styles.infoIconBg, { backgroundColor: COLORS.actionMint }]}>
        <Ionicons name={icon} size={18} color={COLORS.primary} />
      </View>
      <View style={styles.infoContent}>
        <Text style={[styles.infoLabel, { color: colors.textMuted }]}>{label}</Text>
        <Text style={[styles.infoValue, { color: colors.text }]}>{value}</Text>
      </View>
    </View>
  );
}
function MenuItem({ icon, label, onPress, isLast, iconColor = COLORS.textSecondary, iconBg = '#f8fafc', colors, rightContent }: { icon: keyof typeof Ionicons.glyphMap, label: string, onPress: () => void, isLast?: boolean, iconColor?: string, iconBg?: string, colors?: any, rightContent?: React.ReactNode }) {
  const themeColors = colors || COLORS;
  return (
    <TouchableOpacity style={[styles.menuItem, isLast && { borderBottomWidth: 0 }, { borderBottomColor: themeColors.divider }]} onPress={onPress}>
      <View style={[styles.menuIconBg, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={18} color={iconColor} />
      </View>
      <Text style={[styles.menuLabel, { color: iconColor === COLORS.error ? COLORS.error : themeColors.text }]}>{label}</Text>
      {rightContent !== undefined ? rightContent : <Ionicons name="chevron-forward" size={16} color={themeColors.textMuted} />}
    </TouchableOpacity>
  );
}
function NotifToggle({ icon, label, description, value, onToggle }: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  description: string;
  value: boolean;
  onToggle: (val: boolean) => void;
}) {
  return (
    <View style={styles.notifToggleItem}>
      <View style={styles.notifToggleLeft}>
        <View style={[styles.notifToggleIconBg, { backgroundColor: COLORS.actionMint }]}>
          <Ionicons name={icon} size={18} color={COLORS.primary} />
        </View>
        <View style={styles.notifToggleText}>
          <Text style={styles.notifToggleLabel}>{label}</Text>
          <Text style={styles.notifToggleDesc}>{description}</Text>
        </View>
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: '#e2e8f0', true: '#a7f3d0' }}
        thumbColor={value ? COLORS.primary : '#94a3b8'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    paddingTop: 80,
    paddingBottom: 40,
    alignItems: 'center',
    borderBottomLeftRadius: 40,
    borderBottomRightRadius: 40,
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 10,
  },
  avatar: {
    width: 110,
    height: 110,
    borderRadius: 36,
    backgroundColor: '#FFF',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  avatarPlaceholder: {
    width: 110,
    height: 110,
    borderRadius: 36,
    backgroundColor: '#FFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  avatarText: {
    fontFamily: 'Inter-Bold',
    fontSize: 44,
    color: COLORS.primary,
  },
  editBadge: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    width: 32,
    height: 32,
    borderRadius: 12,
    backgroundColor: COLORS.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFF',
  },
  userName: {
    fontFamily: 'Inter-Bold',
    fontSize: 24,
    color: '#FFF',
    marginBottom: 2,
  },
  userEmail: {
    fontFamily: 'Inter-Medium',
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    marginBottom: 20,
  },
  roleContainer: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  roleBadge: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 12,
  },
  roleText: {
    fontFamily: 'Inter-Bold',
    fontSize: 11,
    color: '#FFF',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  statsContainer: {
    flexDirection: 'row',
    backgroundColor: '#FFF',
    marginHorizontal: 24,
    marginTop: -28,
    borderRadius: 24,
    paddingVertical: 20,
    paddingHorizontal: 20,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 4,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(5, 150, 105, 0.1)',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontFamily: 'Inter-Bold',
    fontSize: 18,
    color: COLORS.text,
  },
  statLabel: {
    fontFamily: 'Inter-Medium',
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statDivider: {
    width: 1,
    height: 32,
    backgroundColor: '#f1f5f9',
  },
  content: {
    padding: 16,
    marginTop: 12,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontFamily: 'Inter-Bold',
    fontSize: 13,
    color: COLORS.textMuted,
    marginBottom: 12,
    marginLeft: 4,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  menuCard: {
    backgroundColor: '#FFF',
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
    borderWidth: 1,
    borderColor: 'rgba(5, 150, 105, 0.05)',
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f8fafc',
  },
  infoIconBg: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  infoContent: {
    flex: 1,
  },
  infoLabel: {
    fontFamily: 'Inter-Medium',
    fontSize: 11,
    color: COLORS.textMuted,
    marginBottom: 2,
  },
  infoValue: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 15,
    color: COLORS.text,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f8fafc',
  },
  menuIconBg: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  menuLabel: {
    flex: 1,
    fontFamily: 'Inter-Medium',
    fontSize: 15,
    color: COLORS.text,
  },
  footer: {
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 40,
  },
  footerText: {
    fontFamily: 'Inter-Bold',
    fontSize: 11,
    color: COLORS.textMuted,
    letterSpacing: 1,
  },
  footerSubtext: {
    fontFamily: 'Inter-Medium',
    fontSize: 10,
    color: COLORS.textMuted,
    marginTop: 4,
    opacity: 0.7,
  },
  motivationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    marginTop: 12,
    maxWidth: width * 0.8,
  },
  motivationText: {
    fontFamily: 'Inter-Medium',
    fontSize: 12,
    color: '#FFF',
    marginLeft: 6,
    fontStyle: 'italic',
  },
  descriptionPadding: {
    padding: 16,
  },
  descriptionText: {
    fontFamily: 'Inter-Regular',
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    height: '85%',
    padding: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontFamily: 'Inter-Bold',
    fontSize: 20,
    color: COLORS.text,
  },
  modalForm: {
    flex: 1,
  },
  inputLabel: {
    fontSize: 14,
    fontFamily: 'Inter-Medium',
    color: COLORS.textSecondary,
    marginBottom: 8,
    marginTop: 16,
  },
  inputSubtext: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    color: COLORS.textMuted,
    marginTop: -8,
  },
  textInput: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 12,
    fontFamily: 'Inter-Regular',
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  saveButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    marginTop: 32,
  },
  saveButtonText: {
    fontFamily: 'Inter-Bold',
    fontSize: 16,
    color: '#FFF',
  },
  userUsername: {
    fontFamily: 'Inter-Medium',
    fontSize: 14,
    color: 'rgba(255,255,255,0.85)',
    marginBottom: 4,
  },
  securityInfoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0fdf4',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#d1fae5',
    gap: 12,
  },
  securityInfoText: {
    flex: 1,
    fontFamily: 'Inter-Regular',
    fontSize: 13,
    color: '#064e3b',
    lineHeight: 20,
  },
  notifToggleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  notifToggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  notifToggleIconBg: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  notifToggleText: {
    flex: 1,
  },
  notifToggleLabel: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 15,
    color: COLORS.text,
  },
  notifToggleDesc: {
    fontFamily: 'Inter-Regular',
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  avatarModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  avatarModalContent: {
    backgroundColor: '#FFF',
    borderRadius: 24,
    width: '100%',
    maxWidth: 400,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 10,
  },
  avatarModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  avatarModalTitle: {
    fontSize: 20,
    fontFamily: 'Inter-Bold',
    color: COLORS.text,
  },
  previewContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  avatarPreview: {
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 3,
    borderColor: COLORS.actionMint,
  },
  modalDescription: {
    textAlign: 'center',
    fontFamily: 'Inter-Regular',
    fontSize: 13,
    color: COLORS.textMuted,
    marginBottom: 16,
    lineHeight: 18,
  },
  modalFooter: {
    flexDirection: 'row',
    gap: 10,
  },
  cancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 13,
    color: COLORS.textSecondary,
  },
});

