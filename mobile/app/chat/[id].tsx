import React, { useState, useEffect, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TextInput,
    TouchableOpacity,
    TouchableWithoutFeedback,
    KeyboardAvoidingView,
    Platform,
    FlatList,
    Image,
    Modal,
    Alert,
    Pressable,
    ScrollView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { ScreenErrorBoundary } from '../../src/components/ScreenErrorBoundary';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS } from '../../src/constants/Colors';
import { NalissLogo } from '../../src/components/NalissLogo';
import { format } from 'date-fns';
import { supabase } from '../../src/api/supabase/client';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { useSettingsStore, useAuthStore, useMessageStore } from '../../src/stores';
import { useGroupStore } from '../../src/stores/group.store';
import { UniversalViewer } from '../../src/components/common/UniversalViewer';
import { FileService } from '../../src/services/file.service';
import { uploadLocalFileToCloudinary } from '../../src/lib/cloudinary';
import { sendChatMessageNotification } from '../../src/utils/notifications';
import { useTheme } from '../../src/stores/theme.store';
import { useSentryScreen } from '../../src/hooks/useSentryScreen';
import { captureUIError, trackFeature, isNetworkError } from '../../src/utils/sentry';

const MAX_CHARS = 500;

const STICKER_LIST = ['😀','😂','😍','🥳','🔥','💯','👍','👏','🎉','❤️','😎','🤔','😢','🙏','✨','💪','😁','🫡','🤝','👋'];

export default function ChatScreen() {
    useSentryScreen('ChatScreen');
    const params = useLocalSearchParams();
    const id = Array.isArray(params.id) ? params.id[0] : params.id as string;
    const type = params.type;
    const initialName = params.name;
    const initialAvatar = params.avatar;
    const router = useRouter();
    const { user: currentUser, profile } = useAuthStore();
    const { readOnlyMode } = useSettingsStore();
    const messageStore = useMessageStore();
    const { colors, isDark } = useTheme();

    // Use profile.role (from DB) — user_metadata.role is unreliable after profile updates
    const isStudent = profile?.role === 'student' || !['super_admin', 'moderator'].includes(profile?.role || '');
    const isChatRestricted = readOnlyMode && isStudent;



    const goBack = () => {
        if (router.canGoBack()) {
            router.back();
        } else {
            router.replace('/(tabs)/messages');
        }
    };

    const [messages, setMessages] = useState<any[]>([]);
    const [group, setGroup] = useState<any>(null);
    
    // Canonical General Hub ID — matches the actual DB group ID
    const GENERAL_HUB_ID = 'a94ece65-c476-4141-b56e-b942cb8558c2';
    const isGeneralGroup = id === GENERAL_HUB_ID || (group?.name && group.name.toLowerCase().includes('general'));
    const [members, setMembers] = useState<any[]>([]);
    // Fix stale closure: keep a ref to members so setupRealtime always sees the latest list
    const membersRef = useRef<any[]>([]);
    const setMembersWithRef = (newMembers: any[]) => {
        membersRef.current = newMembers;
        setMembers(newMembers);
    };
    const [inputText, setInputText] = useState('');
    const [replyingTo, setReplyingTo] = useState<any>(null);
    const [editingMessage, setEditingMessage] = useState<any>(null);
    const [showStickerPicker, setShowStickerPicker] = useState(false);
    const [longPressedMessage, setLongPressedMessage] = useState<any>(null);
    const [viewerVisible, setViewerVisible] = useState(false);
    const [viewerFile, setViewerFile] = useState<{ uri: string, type: any, name: string }>({ uri: '', type: 'document', name: '' });
    const [downloadingIds, setDownloadingIds] = useState<Record<string, number>>({});
    const [uploadingIds, setUploadingIds] = useState<Record<string, number>>({});
    const [downloadedIds, setDownloadedIds] = useState<Record<string, boolean>>({});
    const [showMembersList, setShowMembersList] = useState(false);
    const [viewingProfile, setViewingProfile] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [showSearch, setShowSearch] = useState(false);
    const [searchParams, setSearchParams] = useState({
        username: '',
        body: '',
        date: ''
    });
    const [showGroupMenu, setShowGroupMenu] = useState(false);
    const [isSearching, setIsSearching] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const flatListRef = useRef<FlatList>(null);
    const realtimeChannelRef = useRef<any>(null);
    const isMounted = useRef(true);
    // Refs to latest function versions — prevents stale closures in callbacks
    const setupRealtimeRef = useRef<() => void>(() => {});
    const fetchMissedMessagesRef = useRef<() => Promise<void>>(async () => {});

    // Track whether user is near the bottom — only auto-scroll if they are
    const isNearBottomRef = useRef(true);

    const handleScrollEvent = (event: any) => {
        const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
        const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
        isNearBottomRef.current = distanceFromBottom < 120;
    };

    const { markGroupAsRead } = useGroupStore();

    useEffect(() => {
        // Reset mount flag — required when id changes (navigating between chats)
        isMounted.current = true;

        const initChat = async () => {
            if (id) {
                // 1. INSTANT display — show cached messages with zero loading state
                const cached = messageStore.getMessages(id);
                if (cached.length > 0) {
                    setMessages(cached);
                    setIsLoading(false);
                }

                // 2. Mark group as read immediately
                markGroupAsRead(id);

                // 3. Fetch members FIRST so membersRef is populated before realtime starts
                // This prevents unnecessary extra DB fetches for sender info on first messages
                await fetchMembers();

                // 4. Set up real-time so no messages are missed during fetch
                setupRealtime();

                // 5. Miss-recovery: fetch messages that arrived while offline (fast delta)
                await fetchMissedMessages();

                // 6. Background sync — fetch fresh data without blocking UI
                fetchGroupDetails();
                // Only show loading spinner if cache was empty
                if (cached.length === 0) {
                    await fetchMessages();
                } else {
                    fetchMessages(); // Silent background refresh
                }
            }
        };

        initChat();

        // Presence: mark user as active when they enter the chat
        const markActive = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                await supabase
                    .from('users')
                    .update({ last_active_at: new Date().toISOString() })
                    .eq('id', user.id);
            }
        };

        markActive();
        // Keep presence alive every 30 seconds while in chat (more responsive than 2 min)
        const heartbeat = setInterval(markActive, 30000);

        return () => {
            isMounted.current = false;
            clearInterval(heartbeat);
            // Mark user as inactive when they leave the chat
            supabase.auth.getUser().then(({ data: { user } }) => {
                if (user) {
                    supabase.from('users')
                        .update({ last_active_at: new Date(Date.now() - 400000).toISOString() })
                        .eq('id', user.id)
                        .then(() => {});
                }
            });
            if (realtimeChannelRef.current) {
                supabase.removeChannel(realtimeChannelRef.current);
                realtimeChannelRef.current = null;
            }
        };
    }, [id]);

    // When the current user's profile changes (username/avatar), patch their messages in the live list
    useEffect(() => {
        if (!currentUser?.id || !profile) return;
        setMessages(prev => prev.map(m => {
            if (m.sender_id !== currentUser.id) return m;
            return {
                ...m,
                user: m.user ? {
                    ...m.user,
                    username: profile.username ?? m.user.username,
                    avatar_url: profile.avatar_url ?? m.user.avatar_url,
                    full_name: profile.full_name ?? m.user.full_name,
                } : m.user,
            };
        }));
    }, [profile?.username, profile?.avatar_url, profile?.full_name]); // eslint-disable-line

    // ── Reconnection handler: when network comes back while chat is open ──────
    // The Supabase realtime channel dies when network drops.
    // This re-establishes it and fetches missed messages automatically.
    // Uses refs so the callback always calls the latest function version,
    // preventing stale closures when navigating between chats.
    useEffect(() => {
        const { registerOnlineCallback } = require('../../src/stores/network.store');
        const unregister = registerOnlineCallback(() => {
            // Re-establish the realtime channel for this chat
            setupRealtimeRef.current();
            // Fetch messages that arrived during the offline period
            fetchMissedMessagesRef.current();
        });
        return unregister;
    }, [id]); // eslint-disable-line

    const fetchGroupDetails = async () => {
        try {
            const { data, error } = await supabase
                .from('groups')
                .select('*')
                .eq('id', id)
                .single();
            if (error) throw error;
            setGroup(data);
        } catch {
            // silent — group details cached from store
        }
    };

    const fetchMessages = async (params = searchParams, loadMore = false) => {
        setIsLoading(true);
        try {
            let query = supabase
                .from('messages')
                .select(`
                    *,
                    user:users!messages_sender_id_fkey(id, username, full_name, avatar_url, level),
                    reply_to_message:messages!reply_to_id(id, content, user:users!messages_sender_id_fkey(username))
                `)
                .eq('group_id', id)
                .eq('is_deleted', false)
                .order('created_at', { ascending: false })
                .limit(300);

            // Determine if this is a filtered/search query
            const isFiltered = !!(params.username || params.body || params.date);

            if (params.username) {
                query = (query as any).ilike('user.username', `%${params.username}%`);
            }
            if (params.body) {
                query = query.ilike('content', `%${params.body}%`);
            }
            if (params.date) {
                const startOfDay = `${params.date}T00:00:00Z`;
                const endOfDay = `${params.date}T23:59:59Z`;
                query = query.gte('created_at', startOfDay).lte('created_at', endOfDay);
            }

            const { data, error } = await (query as any);
            if (error) throw error;

            const formattedMessages = (data as any[]).map(msg => ({
                ...msg,
                isEdited: msg.is_edited || false,
                replyTo: msg.reply_to_message ? {
                    id: msg.reply_to_message.id,
                    username: msg.reply_to_message.user?.username,
                    content: msg.reply_to_message.content?.substring(0, 50)
                } : null,
                status: 'sent',
                isOnline: msg.user?.last_active_at ? (new Date().getTime() - new Date(msg.user.last_active_at).getTime() < 60000) : false
            })).reverse(); // Reverse because we fetched descending to get the latest 300

            // CRITICAL: Only update the persistent cache for full (unfiltered) fetches.
            // Filtered/search results must NEVER overwrite the full message cache —
            // that would permanently delete all non-matching messages from offline storage.
            if (isFiltered) {
                // Search mode: only update the UI, leave the cache untouched
                setMessages(formattedMessages);
            } else {
                // Full fetch: update both UI and persistent cache
                setMessages(formattedMessages);
                messageStore.setMessages(id, formattedMessages);
            }
            // Await download state check so UI shows correct state on first render
            await checkDownloadedState(formattedMessages);
        } catch {
            // silent — keep existing messages on error
        } finally {
            setIsLoading(false);
        }
    };

    // Miss-recovery: fetch messages that arrived while the user was offline.
    // Uses lastSeenAt timestamp to only fetch the delta — fast and efficient.
    const fetchMissedMessages = async () => {
        const lastSeen = messageStore.getLastSeenAt(id);
        if (!lastSeen) return; // No prior history — full fetch will handle it

        try {
            const { data, error } = await (supabase
                .from('messages')
                .select(`
                    *,
                    user:users!messages_sender_id_fkey(id, username, full_name, avatar_url, level),
                    reply_to_message:messages!reply_to_id(id, content, user:users!messages_sender_id_fkey(username))
                `)
                .eq('group_id', id)
                .eq('is_deleted', false)
                .gt('created_at', lastSeen) // Only messages AFTER last seen
                .order('created_at', { ascending: true }) as any);

            if (error || !data || data.length === 0) return;

            const formatted = (data as any[]).map(msg => ({
                ...msg,
                isEdited: msg.is_edited || false,
                replyTo: msg.reply_to_message ? {
                    id: msg.reply_to_message.id,
                    username: msg.reply_to_message.user?.username,
                    content: msg.reply_to_message.content?.substring(0, 50)
                } : null,
                status: 'sent',
                isOnline: false,
            }));

            // Merge into existing cache — deduplicates automatically
            messageStore.mergeMissedMessages(id, formatted);
            setMessages(prev => {
                const existingIds = new Set(prev.map(m => m.id));
                const newOnes = formatted.filter(m => !existingIds.has(m.id));
                if (!newOnes.length) return prev;
                return [...prev, ...newOnes].sort((a, b) =>
                    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
                );
            });

            // Scroll to bottom to show new messages
            setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 150);
        } catch {
            // silent — miss recovery is best-effort
        }
    };

    const fetchMembers = async () => {
        try {
            const { data, error } = await (supabase
                .from('group_members')
                .select('*, user:users(*, department:departments(name))')
                .eq('group_id', id) as any);

            if (error) throw error;
            setMembersWithRef((data as any[])?.map(m => m.user) || []);
        } catch {
            // silent
        }
    };

    const setupRealtime = () => {
        // Clean up any existing channel first
        if (realtimeChannelRef.current) {
            supabase.removeChannel(realtimeChannelRef.current);
        }

        const channel = supabase
            .channel(`chat:${id}:${Date.now()}`)
            // ── Messages: new / edit / delete ────────────────────────────────
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'messages', filter: `group_id=eq.${id}` },
                async (payload) => {
                    if (payload.eventType === 'INSERT') {
                        const newMsg = payload.new as any;
                        // Guard against malformed payload
                        if (!newMsg?.id || !newMsg?.group_id) return;

                        // ── DEDUP: find the optimistic temp message this confirms ──
                        // Priority 1: metadata.tempId (set for all our messages)
                        // Priority 2: content + sender match (fallback for text only)
                        // NEVER match by content alone for media (content changes after upload)
                        const findTempMsg = (prev: any[]) => prev.find(m =>
                            m.status === 'sending' &&
                            m.sender_id === newMsg.sender_id && (
                                (newMsg.metadata?.tempId && m.id === newMsg.metadata.tempId)
                            )
                        );

                        setMessages(prev => {
                            // Already have this real message ID — skip (idempotent)
                            if (prev.some(m => m.id === newMsg.id)) return prev;

                            const tempMsg = findTempMsg(prev);

                            if (tempMsg) {
                                // Confirm: swap temp → real, mark sent
                                const confirmed = {
                                    ...tempMsg,
                                    ...newMsg,
                                    id: newMsg.id,
                                    status: 'sent',
                                    isEdited: false,
                                    // Keep local URI for images until Cloudinary URL is loaded
                                    content: newMsg.content || tempMsg.content,
                                };
                                // Side effect outside state updater to avoid double-call issues
                                setTimeout(() => messageStore.updateMessage(id, tempMsg.id, confirmed), 0);
                                return prev.map(m => m.id === tempMsg.id ? confirmed : m);
                            }

                            // Someone else's message — add with member info
                            const memberInfo = membersRef.current.find(m => m.id === newMsg.sender_id);
                            const formatted = {
                                ...newMsg,
                                status: 'sent',
                                isEdited: false,
                                user: memberInfo || newMsg.user || null,
                            };
                            setTimeout(() => messageStore.addMessage(id, formatted), 0);
                            return [...prev, formatted];
                        });

                        // Background: enrich sender profile if not in members list
                        if (!membersRef.current.find(m => m.id === newMsg.sender_id)) {
                            const { data: fullData } = await supabase
                                .from('messages')
                                .select('*, user:users!messages_sender_id_fkey(id, username, full_name, avatar_url, level)')
                                .eq('id', newMsg.id)
                                .single();
                            if (fullData) {
                                const withUser = { ...(fullData as any), status: 'sent', isEdited: false };
                                setMessages(prev => {
                                    const updated = prev.map(m => m.id === newMsg.id ? withUser : m);
                                    setTimeout(() => messageStore.updateMessage(id, newMsg.id, withUser), 0);
                                    return updated;
                                });
                            }
                        }
                    } else if (payload.eventType === 'UPDATE') {
                        if (!payload.new?.id) return;
                        if (payload.new.is_deleted) {
                            setMessages(prev => prev.filter(m => m.id !== payload.new.id));
                            messageStore.removeMessage(id, payload.new.id);
                        } else {
                            const updates = { content: payload.new.content, is_edited: payload.new.is_edited, isEdited: payload.new.is_edited };
                            setMessages(prev => prev.map(m =>
                                m.id === payload.new.id ? { ...m, ...updates } : m
                            ));
                            messageStore.updateMessage(id, payload.new.id, updates);
                        }
                    } else if (payload.eventType === 'DELETE') {
                        setMessages(prev => prev.filter(m => m.id !== payload.old.id));
                        messageStore.removeMessage(id, payload.old.id);
                    }
                }
            )
            // ── Group metadata: name / DP / chat_enabled changes ─────────────
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'groups', filter: `id=eq.${id}` },
                (payload) => {
                    // Instantly update the local group state — header re-renders immediately
                    setGroup((prev: any) => prev ? { ...prev, ...payload.new } : payload.new);
                }
            )
            // ── Group members: someone added or removed ───────────────────────
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'group_members', filter: `group_id=eq.${id}` },
                async (payload) => {
                    if (payload.eventType === 'DELETE') {
                        const removedUserId = (payload.old as any).user_id;
                        setMembersWithRef(membersRef.current.filter(m => m.id !== removedUserId));
                    } else if (payload.eventType === 'INSERT') {
                        // Fetch the new member's profile and add to list
                        const newUserId = (payload.new as any).user_id;
                        const { data: userProfile } = await supabase
                            .from('users')
                            .select('id, username, full_name, avatar_url, level, role')
                            .eq('id', newUserId)
                            .single();
                        if (userProfile) {
                            setMembersWithRef([
                                ...membersRef.current.filter(m => m.id !== newUserId),
                                userProfile,
                            ]);
                        }
                    }
                }
            )
            // ── User presence + profile updates: avatar/username changes ────────
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'users' },
                (payload) => {
                    const updatedUser = payload.new as any;
                    const isNowOnline = updatedUser.last_active_at
                        ? (new Date().getTime() - new Date(updatedUser.last_active_at).getTime() < 60000)
                        : false;

                    // Patch all messages from this user — avatar, username, online status
                    setMessages(prev => prev.map(m =>
                        m.sender_id === updatedUser.id
                            ? {
                                ...m,
                                isOnline: isNowOnline,
                                user: {
                                    ...m.user,
                                    last_active_at: updatedUser.last_active_at,
                                    avatar_url: updatedUser.avatar_url ?? m.user?.avatar_url,
                                    username: updatedUser.username ?? m.user?.username,
                                    full_name: updatedUser.full_name ?? m.user?.full_name,
                                },
                            }
                            : m
                    ));

                    // Also patch the members list so the members modal shows fresh avatar
                    setMembersWithRef(membersRef.current.map(m =>
                        m.id === updatedUser.id
                            ? {
                                ...m,
                                avatar_url: updatedUser.avatar_url ?? m.avatar_url,
                                username: updatedUser.username ?? m.username,
                                full_name: updatedUser.full_name ?? m.full_name,
                                last_active_at: updatedUser.last_active_at,
                            }
                            : m
                    ));

                    // If this user's profile is currently being viewed, update it live
                    setViewingProfile((prev: any) => {
                        if (!prev || prev.id !== updatedUser.id) return prev;
                        return {
                            ...prev,
                            avatar_url: updatedUser.avatar_url ?? prev.avatar_url,
                            username: updatedUser.username ?? prev.username,
                            full_name: updatedUser.full_name ?? prev.full_name,
                            biography: updatedUser.biography ?? prev.biography,
                            motivation: updatedUser.motivation ?? prev.motivation,
                            hobbies: updatedUser.hobbies ?? prev.hobbies,
                            last_active_at: updatedUser.last_active_at,
                        };
                    });
                }
            )
            .subscribe();

        // Store channel ref for proper cleanup
        realtimeChannelRef.current = channel;
    };

    // Keep refs in sync with latest function versions — fixes stale closure in reconnection callback
    setupRealtimeRef.current = setupRealtime;
    fetchMissedMessagesRef.current = fetchMissedMessages;

    // Simulate sending with status transitions
    const handleSend = async () => {
        if (isSending) return; // Prevent spam-clicking duplicate requests
        if (isChatRestricted) {
            Alert.alert('Read-Only Mode', 'The application is currently in read-only mode. You cannot send messages at this time.');
            return;
        }
        if (group && group.chat_enabled === false) {
            Alert.alert('Chat Disabled', 'Messaging has been disabled for this group by an administrator.');
            return;
        }
        if (!inputText.trim() || !currentUser) return;

        setIsSending(true);
        try {
            const tempId = `temp-${Date.now()}`;
            const content = inputText.trim();
            
            if (editingMessage) {
                try {
                    // Optimistic update — show edit immediately
                    setMessages(prev => prev.map(m =>
                        m.id === editingMessage.id
                            ? { ...m, content, is_edited: true, isEdited: true }
                            : m
                    ));
                    messageStore.updateMessage(id, editingMessage.id, { content, is_edited: true, isEdited: true });
                    setEditingMessage(null);
                    setInputText('');

                    const { error } = await supabase
                        .from('messages')
                        .update({ 
                            content, 
                            is_edited: true,
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', editingMessage.id);

                    if (error) {
                        // Revert on failure
                        setMessages(prev => prev.map(m =>
                            m.id === editingMessage.id
                                ? { ...m, content: editingMessage.content, is_edited: editingMessage.is_edited, isEdited: editingMessage.isEdited }
                                : m
                        ));
                        messageStore.updateMessage(id, editingMessage.id, { content: editingMessage.content, is_edited: editingMessage.is_edited, isEdited: editingMessage.isEdited });
                        Alert.alert('Error', 'Failed to edit message');
                    }
                    return;
                } catch (err) {
                    captureUIError('ChatScreen.editMessage', err, { groupId: id });
                    Alert.alert('Error', 'Failed to edit message');
                    return;
                }
            }

            const newMessage = {
                id: tempId,
                content,
                created_at: new Date().toISOString(),
                sender_id: currentUser.id,
                user: { 
                    username: profile?.username || currentUser.user_metadata?.username || 'me', 
                    full_name: profile?.full_name || currentUser.user_metadata?.full_name,
                    level: profile?.level || currentUser.user_metadata?.level, 
                    avatar_url: profile?.avatar_url || currentUser.user_metadata?.avatar_url 
                },
                replyTo: replyingTo ? { 
                    id: replyingTo.id, 
                    username: replyingTo.user?.username || replyingTo.username, 
                    content: (replyingTo.content || '').substring(0, 50) 
                } : null,
                isEdited: false,
                is_edited: false,
                message_type: 'text',
                content_type: 'text',
                status: 'sending' as any,
            };

            setMessages(prev => [...prev, newMessage]);
            messageStore.addMessage(id, newMessage); // Optimistic cache update
            setInputText('');
            setReplyingTo(null);

            setTimeout(() => {
                flatListRef.current?.scrollToEnd({ animated: true });
            }, 100);

            try {
                const { data, error } = await supabase
                    .from('messages')
                    .insert([{
                        content,
                        sender_id: currentUser.id,
                        group_id: id,
                        reply_to_id: replyingTo?.id || null,
                        message_type: 'text',
                        metadata: { tempId }
                    }])
                    .select()
                    .single();

                if (error) throw error;

                // Confirm the temp message — but only if realtime hasn't already done it
                // (realtime may have already swapped tempId → real ID)
                setMessages(prev => {
                    // If tempId still exists as 'sending', confirm it
                    const stillPending = prev.find(m => m.id === tempId && m.status === 'sending');
                    if (stillPending) {
                        messageStore.updateMessage(id, tempId, { id: (data as any).id, status: 'sent' });
                        return prev.map(m => m.id === tempId ? { ...m, id: (data as any).id, status: 'sent' } : m);
                    }
                    // Realtime already confirmed it — nothing to do
                    return prev;
                });

                // Fire push notification to all group members (except sender) — fire and forget
                const senderName = profile?.username || profile?.full_name || 'Someone';
                const groupName = group?.name || 'Group Chat';
                const preview = content.length > 60 ? content.substring(0, 60) + '…' : content;
                sendChatMessageNotification(id, groupName, senderName, preview, currentUser.id);

            } catch (err: any) {
                captureUIError('ChatScreen.sendMessage', err, { groupId: id });
                // Mark temp message as failed
                setMessages(prev => prev.map(m => m.id === tempId ? { ...m, status: 'error' } : m));
                messageStore.updateMessage(id, tempId, { status: 'error' });
            }
        } finally {
            setIsSending(false);
        }
    };

    const handleResend = async (messageId: string) => {
        const msg = messages.find(m => m.id === messageId);
        if (!msg || !currentUser) return;

        const resendTempId = `temp-resend-${Date.now()}`;

        // ── MEDIA that never finished uploading ───────────────────────────────
        // content is still a local URI or temp filename — need to re-upload to Cloudinary first
        if (msg.message_type !== 'text' && msg.message_type !== 'sticker') {
            if (!msg.content?.startsWith('http')) {
                // We have the local URI stored in _localUri — use it to re-upload
                const localUri = msg._localUri || msg.content;

                // If no local URI available (e.g. app was killed mid-upload), can't recover
                if (!localUri || localUri.startsWith('http') === false && !localUri.startsWith('file://') && !localUri.startsWith('/')) {
                    Alert.alert(
                        'Cannot Resend',
                        'The original file is no longer available. Please select it again from your gallery.',
                        [{ text: 'OK' }]
                    );
                    return;
                }

                // Mark as sending with upload progress
                setMessages(prev => prev.map(m =>
                    m.id === messageId ? { ...m, id: resendTempId, status: 'sending' as any } : m
                ));
                messageStore.updateMessage(id, messageId, { id: resendTempId, status: 'sending' });
                setUploadingIds(prev => ({ ...prev, [resendTempId]: 1 }));

                try {
                    const type = msg.message_type as string;
                    const originalName = msg.metadata?.name || `${type}_${Date.now()}`;
                    const uploadName = `${Date.now()}-${originalName}`;
                    const mimeType = type === 'image' ? 'image/jpeg'
                        : type === 'video' ? 'video/mp4'
                        : type === 'audio' ? 'audio/mpeg'
                        : 'application/octet-stream';
                    const folder = type === 'image' ? 'chat-images'
                        : type === 'video' ? 'chat-videos'
                        : type === 'audio' ? 'chat-audios'
                        : 'chat-docs';

                    const fileUrl = await uploadLocalFileToCloudinary(
                        localUri,
                        uploadName,
                        folder,
                        mimeType,
                        (p: number) => setUploadingIds(prev => ({ ...prev, [resendTempId]: Math.min(Math.round(p), 99) }))
                    );

                    setUploadingIds(prev => { const next = { ...prev }; delete next[resendTempId]; return next; });

                    // Now insert to DB with the real Cloudinary URL
                    const { data, error } = await (supabase
                        .from('messages')
                        .insert([{
                            content: fileUrl,
                            sender_id: currentUser.id,
                            group_id: id,
                            message_type: type,
                            metadata: { name: originalName, size: msg.metadata?.size, tempId: resendTempId },
                        }])
                        .select()
                        .single() as any);

                    if (error) throw error;

                    setMessages(prev => prev.map(m =>
                        m.id === resendTempId ? { ...m, id: data.id, content: fileUrl, status: 'sent' } : m
                    ));
                    messageStore.updateMessage(id, resendTempId, { id: data.id, content: fileUrl, status: 'sent' });
                } catch (err: any) {
                    captureUIError('ChatScreen.resendMessage', err, { groupId: id });
                    setUploadingIds(prev => { const next = { ...prev }; delete next[resendTempId]; return next; });
                    setMessages(prev => prev.map(m =>
                        m.id === resendTempId ? { ...m, id: messageId, status: 'failed' } : m
                    ));
                    messageStore.updateMessage(id, resendTempId, { id: messageId, status: 'failed' });
                }
                return;
            }
        }

        // ── TEXT / STICKER or media that already has a Cloudinary URL ────────
        setMessages(prev => prev.map(m =>
            m.id === messageId ? { ...m, id: resendTempId, status: 'sending' as any } : m
        ));
        messageStore.updateMessage(id, messageId, { id: resendTempId, status: 'sending' });

        try {
            const { data, error } = await (supabase
                .from('messages')
                .insert([{
                    content: msg.content,
                    sender_id: currentUser.id,
                    group_id: id,
                    reply_to_id: msg.replyTo?.id || null,
                    message_type: msg.message_type || 'text',
                    metadata: { tempId: resendTempId },
                }])
                .select()
                .single() as any);

            if (error) throw error;
            setMessages(prev => prev.map(m =>
                m.id === resendTempId ? { ...m, id: data.id, status: 'sent' } : m
            ));
            messageStore.updateMessage(id, resendTempId, { id: data.id, status: 'sent' });
        } catch {
            setMessages(prev => prev.map(m =>
                m.id === resendTempId ? { ...m, id: messageId, status: 'failed' } : m
            ));
            messageStore.updateMessage(id, resendTempId, { id: messageId, status: 'failed' });
        }
    };

    const handleSendSticker = async (sticker: string) => {
        if (isChatRestricted) {
            Alert.alert('Read-Only Mode', 'Stickers are disabled in read-only mode.');
            return;
        }
        if (!currentUser) return;
        const tempId = `temp-sticker-${Date.now()}`;
        
        const newMessage = {
            id: tempId,
            content: sticker,
            created_at: new Date().toISOString(),
            sender_id: currentUser.id,
            user: { 
                username: profile?.username || currentUser.user_metadata?.username || 'me', 
                full_name: profile?.full_name || currentUser.user_metadata?.full_name,
                level: profile?.level || currentUser.user_metadata?.level, 
                avatar_url: profile?.avatar_url || currentUser.user_metadata?.avatar_url 
            },
            replyTo: null,
            isEdited: false,
            message_type: 'sticker',
            status: 'sending' as any,
        };

        setMessages(prev => [...prev, newMessage]);
        messageStore.addMessage(id, newMessage);
        setShowStickerPicker(false);

        try {
            const { data, error } = await (supabase
                .from('messages')
                .insert([{
                    content: sticker,
                    sender_id: currentUser.id,
                    group_id: id,
                    message_type: 'sticker',
                    metadata: { tempId },  // ← include tempId so realtime dedup works
                }])
                .select()
                .single() as any);

            if (error) throw error;
            setMessages(prev => prev.map(m => m.id === tempId ? { ...m, id: data.id, status: 'sent' } : m));
            messageStore.updateMessage(id, tempId, { id: data.id, status: 'sent' });
        } catch {
            setMessages(prev => prev.map(m => m.id === tempId ? { ...m, status: 'failed' } : m));
            messageStore.updateMessage(id, tempId, { status: 'failed' });
        }
    };

    const handlePickImage = async () => {
        if (isChatRestricted) {
            Alert.alert('Read-Only Mode', 'Image uploads are disabled in read-only mode.');
            return;
        }
        if (!currentUser) return;
        setShowAttachmentMenu(false);

        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true,
            quality: 0.7,
        });

        if (!result.canceled && result.assets && result.assets.length > 0) {
            const asset = result.assets[0];

            if (asset.fileSize && asset.fileSize > 10 * 1024 * 1024) {
                Alert.alert('File Too Large', 'Please select an image smaller than 10MB.');
                return;
            }

            const tempId = `temp-img-${Date.now()}`;

            // Optimistic UI — show local preview immediately
            const newMessage = {
                id: tempId,
                content: asset.uri,        // local URI for instant preview
                _localUri: asset.uri,       // keep local URI for dedup after upload
                created_at: new Date().toISOString(),
                sender_id: currentUser.id,
                user: {
                    username: profile?.username || currentUser.user_metadata?.username || 'me',
                    full_name: profile?.full_name || currentUser.user_metadata?.full_name,
                    level: profile?.level || currentUser.user_metadata?.level,
                    avatar_url: profile?.avatar_url || currentUser.user_metadata?.avatar_url,
                },
                replyTo: null,
                message_type: 'image',
                content_type: 'image',
                status: 'sending' as any,
            };

            setMessages(prev => {
                // Prevent duplicate if somehow called twice
                if (prev.some(m => m.id === tempId)) return prev;
                return [...prev, newMessage];
            });
            messageStore.addMessage(id, newMessage);
            setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);

            try {
                // Upload to Cloudinary with progress
                const fileName = `${currentUser.id}-${Date.now()}.jpg`;
                const imageUrl = await uploadLocalFileToCloudinary(
                    asset.uri,
                    fileName,
                    'chat-images',
                    'image/jpeg',
                    (p: number) => setUploadingIds(prev => ({ ...prev, [tempId]: Math.min(Math.round(p), 99) }))
                );

                // Insert to DB — include tempId in metadata so realtime can dedup
                const { data, error } = await (supabase
                    .from('messages')
                    .insert([{
                        content: imageUrl,
                        sender_id: currentUser.id,
                        group_id: id,
                        message_type: 'image',
                        content_type: 'image',
                        metadata: { tempId },
                    }])
                    .select()
                    .single() as any);

                if (error) throw error;

                // Confirm: swap temp message with real one
                setUploadingIds(prev => { const next = { ...prev }; delete next[tempId]; return next; });
                setMessages(prev => prev.map(m =>
                    m.id === tempId
                        ? { ...m, id: data.id, content: imageUrl, status: 'sent' }
                        : m
                ));
                messageStore.updateMessage(id, tempId, { id: data.id, content: imageUrl, status: 'sent' });

            } catch (err: any) {
                captureUIError('ChatScreen.sendImageMessage', err, { groupId: id });
                setUploadingIds(prev => { const next = { ...prev }; delete next[tempId]; return next; });
                setMessages(prev => prev.map(m => m.id === tempId ? { ...m, status: 'failed' } : m));
                messageStore.updateMessage(id, tempId, { status: 'failed' });
            }
        }
    };

    const handleDelete = async (messageId: string) => {
        const msg = messages.find(m => m.id === messageId);

        // Failed/unsent messages (temp IDs or status=failed with no Cloudinary URL)
        // — remove locally only, no DB call needed since they were never saved
        const isUnsent = messageId.startsWith('temp-') ||
            (msg?.status === 'failed' && !msg?.content?.startsWith('http'));

        // Optimistic removal — instant UI feedback
        setMessages(prev => prev.filter(m => m.id !== messageId));
        messageStore.removeMessage(id, messageId);

        if (isUnsent) {
            // Never reached the server — nothing to delete in DB
            return;
        }

        try {
            const { error } = await supabase
                .from('messages')
                .update({
                    is_deleted: true,
                    deleted_at: new Date().toISOString(),
                    deleted_by_user_id: currentUser?.id || null,
                })
                .eq('id', messageId);

            if (error) {
                // Revert on failure
                fetchMessages();
            } else {
                // Immediately update the group list preview with the new last message
                // (the deleted message should no longer show as last_message)
                const remainingMessages = messages.filter(m => m.id !== messageId && !m.is_deleted && m.sender_id !== 'system');
                const newLastMsg = remainingMessages.length > 0 ? remainingMessages[remainingMessages.length - 1] : null;

                useGroupStore.setState(state => ({
                    groups: state.groups.map(g => {
                        if (g.id !== id) return g;
                        if (!newLastMsg) {
                            return { ...g, last_message: null, last_message_at: null };
                        }
                        const senderName = newLastMsg.user?.username || newLastMsg.user?.full_name || 'user';
                        const msgType = newLastMsg.content_type || newLastMsg.message_type || 'text';
                        let lastMessageText = `${senderName}: ${newLastMsg.content || ''}`;
                        if (msgType === 'image') lastMessageText = `${senderName}: 📷 Photo`;
                        else if (msgType === 'document') lastMessageText = `${senderName}: 📎 Document`;
                        else if (msgType === 'video') lastMessageText = `${senderName}: 🎥 Video`;
                        else if (msgType === 'audio') lastMessageText = `${senderName}: 🎵 Audio`;
                        else if (msgType === 'sticker') lastMessageText = `${senderName}: 😊 Sticker`;
                        return { ...g, last_message: lastMessageText, last_message_at: newLastMsg.created_at };
                    })
                }));

                // Background re-fetch to confirm from DB
                useGroupStore.getState().fetchGroups(true);
            }
        } catch {
            fetchMessages();
        }
    };

    const handleClearChat = () => {
        Alert.alert(
            'Clear Chat',
            'Are you sure you want to clear all messages in this group? This will remove all messages from your device.',
            [
                { text: 'Cancel', style: 'cancel' },
                { 
                    text: 'Clear', 
                    style: 'destructive', 
                    onPress: () => {
                        // Clear both UI state and persistent cache for this group
                        setMessages([]);
                        messageStore.setMessages(id, []);
                        setShowGroupMenu(false);
                    } 
                },
            ]
        );
    };

    const handleEdit = (message: any) => {
        setEditingMessage(message);
        setInputText(message.content);
        setLongPressedMessage(null);
    };

    const handleReply = (message: any) => {
        setReplyingTo(message);
        setLongPressedMessage(null);
    };

    const cancelReplyOrEdit = () => {
        setReplyingTo(null);
        setEditingMessage(null);
        setInputText('');
    };

    // Open profile by user_id — always fetch fresh data from DB so avatar is current
    const openProfile = async (userId: string) => {
        // Show immediately from cached members while fresh data loads
        const cached = members.find(m => m.id === userId);
        if (cached) setViewingProfile(cached);

        try {
            const { data } = await supabase
                .from('users')
                .select('*, department:departments(name)')
                .eq('id', userId)
                .single();
            if (data) setViewingProfile(data as any);
        } catch {
            // Keep cached version if fetch fails
        }
    };

    // Open profile by username — always fetch fresh data from DB
    const openProfileByUsername = async (username: string) => {
        const clean = username.startsWith('@') ? username.slice(1) : username;
        const cached = members.find(m => m.username === clean);
        if (cached) setViewingProfile(cached);

        try {
            const { data } = await supabase
                .from('users')
                .select('*, department:departments(name)')
                .eq('username', clean)
                .single();
            if (data) setViewingProfile(data as any);
        } catch {
            // Keep cached version if fetch fails
        }
    };

    // Render @mentions as tappable
    const renderMessageContent = (text: string) => {
        const parts = text.split(/(@\w+)/g);
        return parts.map((part, idx) => {
            if (part.startsWith('@')) {
                return (
                    <Text key={idx} style={styles.mentionText} onPress={() => openProfileByUsername(part)}>
                        {part}
                    </Text>
                );
            }
            return <Text key={idx}>{part}</Text>;
        });
    };

    // Delivery status icon
    const StatusIcon = ({ status, uploadProgress }: { status: 'sending' | 'sent' | 'failed', uploadProgress?: number }) => {
        // If uploading media — show WhatsApp-style circular progress
        if (status === 'sending' && uploadProgress !== undefined) {
            const size = 28;
            const strokeWidth = 3;
            const radius = (size - strokeWidth) / 2;
            const circumference = 2 * Math.PI * radius;
            const progress = Math.min(Math.max(uploadProgress, 0), 100);
            const strokeDashoffset = circumference - (progress / 100) * circumference;
            return (
                <View style={styles.uploadCircleContainer}>
                    <View style={styles.uploadCircleBg}>
                        <View style={[styles.uploadCircleTrack, { width: size, height: size, borderRadius: size / 2 }]}>
                            <View style={[
                                styles.uploadCircleFill,
                                {
                                    width: size,
                                    height: size,
                                    borderRadius: size / 2,
                                    borderWidth: strokeWidth,
                                    opacity: progress > 0 ? 1 : 0.3,
                                }
                            ]} />
                        </View>
                        <Text style={styles.uploadCircleText}>{Math.round(progress)}%</Text>
                    </View>
                </View>
            );
        }
        // Sending (no upload) — clock, message not yet on server
        if (status === 'sending') {
            return <Ionicons name="time-outline" size={13} color="#94a3b8" style={{ marginLeft: 4 }} />;
        }
        // Sent — single tick, message reached server
        if (status === 'sent') {
            return <Ionicons name="checkmark-outline" size={13} color="#059669" style={{ marginLeft: 4 }} />;
        }
        // Failed — red alert, tap to retry
        if (status === 'failed') {
            return <Ionicons name="alert-circle-outline" size={13} color="#ef4444" style={{ marginLeft: 4 }} />;
        }
        return null;
    };

    const renderMessage = ({ item }: { item: any }) => {
        const isMe = item.sender_id === currentUser?.id;
        const isSystem = item.sender_id === 'system';

        return (
            <Pressable
                onLongPress={() => setLongPressedMessage(item)}
                delayLongPress={400}
            >
                <View style={[styles.messageWrapper, isMe ? styles.messageWrapperRight : styles.messageWrapperLeft]}>
                    {!isMe && !isSystem && (
                        <TouchableOpacity style={styles.messageAvatarContainer} onPress={() => openProfile(item.sender_id)}>
                            {item.user?.avatar_url ? (
                                <Image source={{ uri: item.user.avatar_url }} style={styles.messageAvatarImage} />
                            ) : (
                                <View style={styles.messageAvatarPlaceholder}>
                                    <Text style={styles.messageAvatarText}>
                                        {item.user?.username?.charAt(1)?.toUpperCase() || 'U'}
                                    </Text>
                                </View>
                            )}
                            {/* Online presence dot — green if active in last 5 min, grey otherwise */}
                            <View style={[
                                styles.presenceDot,
                                { backgroundColor: item.isOnline ? '#10B981' : '#94a3b8' }
                            ]} />
                        </TouchableOpacity>
                    )}

                    <View style={styles.messageContentWrapper}>
                        {!isMe && !isSystem && (
                            <View style={styles.senderInfoCol}>
                                <View style={styles.senderInfoRow}>
                                    <TouchableOpacity onPress={() => openProfile(item.sender_id)}>
                                        <Text style={styles.senderName}>{item.user?.username}</Text>
                                    </TouchableOpacity>
                                    {/* Level badge — shown in General Hub next to every sender name */}
                                    {isGeneralGroup && item.user?.level && (
                                        <View style={styles.levelBadgeInline}>
                                            <Text style={styles.levelBadgeInlineText}>
                                                L{String(item.user.level).replace(/\D/g, '')}
                                            </Text>
                                        </View>
                                    )}
                                </View>
                            </View>
                        )}

                        {item.reply_to_id && item.replyTo && (item.replyTo.content || item.replyTo.username) && (
                            <View style={styles.replyPreview}>
                                <View style={styles.replyBar} />
                                <View style={styles.replyContent}>
                                    <Text style={styles.replyUsername}>{item.replyTo.username}</Text>
                                    <Text style={styles.replyText} numberOfLines={1}>{item.replyTo.content}</Text>
                                </View>
                            </View>
                        )}

                        {item.message_type === 'sticker' ? (
                            <View style={[styles.stickerBubble, isMe ? styles.stickerBubbleMe : [styles.stickerBubbleOther, { backgroundColor: isDark ? '#1e293b' : '#fff' }]]}>
                                <Text style={styles.stickerEmoji}>{item.content}</Text>
                                <View style={styles.stickerTimeRow}>
                                    <Text style={[styles.messageTime, isMe ? styles.messageTimeMe : styles.messageTimeOther]}>
                                        {item.created_at ? format(new Date(item.created_at), 'p') : ''}
                                    </Text>
                                    {isMe && <StatusIcon status={item.status} uploadProgress={uploadingIds[item.id]} />}
                                </View>
                            </View>
                        ) : item.message_type === 'image' ? (
                            // ── IMAGE MESSAGE — WhatsApp style ────────────────────────────
                            <TouchableOpacity
                                activeOpacity={0.92}
                                delayLongPress={400}
                                onLongPress={() => setLongPressedMessage(item)}
                                onPress={() => {
                                    if (isMe) {
                                        // Sender: already has local URI, open directly
                                        const viewUri = item._localUri || item.content;
                                        setViewerFile({ uri: viewUri, type: 'image', name: `image_${item.id}.jpg` });
                                        setViewerVisible(true);
                                        return;
                                    }
                                    if (downloadedIds[item.id]) {
                                        // Already downloaded — open instantly from vault
                                        const localUri = FileService.getLocalUri(item.id, `image_${item.id}.jpg`);
                                        setViewerFile({ uri: localUri, type: 'image', name: `image_${item.id}.jpg` });
                                        setViewerVisible(true);
                                    } else if (downloadingIds[item.id] === undefined) {
                                        // Not downloaded — start download, open when done
                                        handleDownloadAndOpen(item.id, item.content, `image_${item.id}.jpg`, 'image');
                                    }
                                }}
                            >
                                <View style={[styles.imageMessageContainer, isMe ? styles.imageBubbleMe : styles.imageBubbleOther]}>
                                    {/* Blurred thumbnail — always visible from Cloudinary */}
                                    <Image
                                        source={{ uri: item.content }}
                                        style={[styles.messageImage, !isMe && !downloadedIds[item.id] && { opacity: 0.55 }]}
                                        resizeMode="cover"
                                        blurRadius={!isMe && !downloadedIds[item.id] ? 3 : 0}
                                    />

                                    {/* Upload progress — sender while uploading */}
                                    {isMe && uploadingIds[item.id] !== undefined && (
                                        <View style={styles.imageUploadOverlay}>
                                            <View style={styles.imageUploadCircle}>
                                                <Text style={styles.imageUploadPercent}>{Math.min(Math.round(uploadingIds[item.id]), 100)}%</Text>
                                            </View>
                                        </View>
                                    )}

                                    {/* Download overlay — other people's images not yet downloaded */}
                                    {!isMe && !downloadedIds[item.id] && uploadingIds[item.id] === undefined && (
                                        <View style={styles.imageDownloadOverlay}>
                                            {downloadingIds[item.id] !== undefined ? (
                                                // Downloading — circular progress
                                                <View style={styles.mediaCircleProgress}>
                                                    <Text style={styles.mediaCircleProgressText}>{downloadingIds[item.id]}%</Text>
                                                </View>
                                            ) : (
                                                // Not started — download icon
                                                <View style={styles.mediaDownloadBtn}>
                                                    <Ionicons name="cloud-download-outline" size={22} color="#fff" />
                                                </View>
                                            )}
                                        </View>
                                    )}

                                    {/* File size label */}
                                    {item.metadata?.size && (
                                        <View style={styles.mediaSizeLabel}>
                                            <Text style={styles.mediaSizeText}>{formatFileSize(item.metadata.size)}</Text>
                                        </View>
                                    )}

                                    <View style={styles.timeEditRow}>
                                        <Text style={[styles.messageTime, isMe ? styles.messageTimeMe : styles.messageTimeOther]}>
                                            {item.created_at ? format(new Date(item.created_at), 'p') : ''}
                                        </Text>
                                        {isMe && <StatusIcon status={item.status} uploadProgress={uploadingIds[item.id]} />}
                                    </View>
                                </View>
                            </TouchableOpacity>
                        ) : (
                            <View style={[
                                item.message_type === 'video' ? styles.imageMessageContainer : styles.messageBubble,
                                isMe ? (item.message_type === 'video' ? styles.imageBubbleMe : [styles.messageBubbleMe, { backgroundColor: isDark ? '#1a3a2a' : '#dcf8c6' }])
                                     : (item.message_type === 'video' ? styles.imageBubbleOther : [styles.messageBubbleOther, { backgroundColor: isDark ? '#1e293b' : '#FFF' }]),
                                isSystem && styles.messageBubbleSystem
                            ]}>
                                {item.message_type === 'video' ? (
                                    // ── VIDEO — thumbnail preview with play button ────────────
                                    <TouchableOpacity
                                        activeOpacity={0.92}
                                        style={styles.videoThumbContainer}
                                        delayLongPress={400}
                                        onLongPress={() => setLongPressedMessage(item)}
                                        onPress={() => {
                                            if (isMe) {
                                                setViewerFile({ uri: item.content, type: 'video', name: item.metadata?.name || `video_${item.id}.mp4` });
                                                setViewerVisible(true);
                                                return;
                                            }
                                            const fileName = item.metadata?.name || `video_${item.id}.mp4`;
                                            if (downloadedIds[item.id]) {
                                                handleOpenMedia(item.id, fileName, 'video');
                                            } else if (downloadingIds[item.id] === undefined) {
                                                handleDownloadAndOpen(item.id, item.content, fileName, 'video');
                                            }
                                        }}                                    >
                                        {/* Cloudinary video thumbnail — generated automatically */}
                                        {item.content?.startsWith('http') ? (
                                            <Image
                                                source={{ uri: item.content.replace('/video/upload/', '/video/upload/so_0,w_400,h_300,c_fill,f_jpg/') }}
                                                style={styles.videoThumb}
                                                resizeMode="cover"
                                            />
                                        ) : (
                                            <View style={[styles.videoThumb, { backgroundColor: '#1e293b', alignItems: 'center', justifyContent: 'center' }]}>
                                                <Ionicons name="videocam" size={32} color="#64748b" />
                                            </View>
                                        )}

                                        {/* Dark overlay */}
                                        <View style={styles.videoThumbOverlay} />

                                        {/* Play button */}
                                        {downloadingIds[item.id] !== undefined ? (
                                            <View style={styles.videoPlayBtn}>
                                                <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>{Math.min(downloadingIds[item.id], 100)}%</Text>
                                            </View>
                                        ) : uploadingIds[item.id] !== undefined ? (
                                            <View style={styles.videoPlayBtn}>
                                                <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>{Math.min(Math.round(uploadingIds[item.id]), 100)}%</Text>
                                            </View>
                                        ) : (
                                            <View style={styles.videoPlayBtn}>
                                                <Ionicons name="play" size={22} color="#fff" />
                                            </View>
                                        )}

                                        {/* Duration / size label */}
                                        {item.metadata?.size && (
                                            <View style={styles.mediaSizeLabel}>
                                                <Text style={styles.mediaSizeText}>{formatFileSize(item.metadata.size)}</Text>
                                            </View>
                                        )}

                                        {/* Downloaded badge */}
                                        {downloadedIds[item.id] && (
                                            <View style={[styles.mediaSizeLabel, { right: 8, left: 'auto' as any }]}>
                                                <Ionicons name="checkmark-circle" size={14} color="#10b981" />
                                            </View>
                                        )}

                                        <View style={styles.timeEditRow}>
                                            <Text style={[styles.messageTime, isMe ? styles.messageTimeMe : styles.messageTimeOther]}>
                                                {item.created_at ? format(new Date(item.created_at), 'p') : ''}
                                            </Text>
                                            {isMe && <StatusIcon status={item.status} uploadProgress={uploadingIds[item.id]} />}
                                        </View>
                                    </TouchableOpacity>
                                ) : item.message_type === 'document' || item.message_type === 'audio' ? (
                                    // ── DOC / AUDIO — tap to download then open ──────────────
                                    <TouchableOpacity
                                        style={styles.documentActionArea}
                                        activeOpacity={0.8}
                                        delayLongPress={400}
                                        onLongPress={() => setLongPressedMessage(item)}
                                        onPress={() => {
                                            if (isMe) {
                                                const fileName = item.metadata?.name || `document_${item.id}.pdf`;
                                                setViewerFile({ uri: item.content, type: item.message_type, name: fileName });
                                                setViewerVisible(true);
                                                return;
                                            }
                                            const fileName = item.metadata?.name || (
                                                item.message_type === 'audio' ? `audio_${item.id}.mp3` : `document_${item.id}.pdf`
                                            );
                                            if (downloadedIds[item.id]) {
                                                handleOpenMedia(item.id, fileName, item.message_type);
                                            } else if (downloadingIds[item.id] === undefined) {
                                                handleDownloadAndOpen(item.id, item.content, fileName, item.message_type);
                                            }
                                        }}
                                    >
                                        {/* File type icon */}
                                        <View style={[styles.documentIconBox, downloadedIds[item.id] && styles.documentIconBoxDone]}>
                                            {isMe && uploadingIds[item.id] !== undefined ? (
                                                <Text style={styles.mediaCircleProgressText}>{Math.min(Math.round(uploadingIds[item.id]), 100)}%</Text>
                                            ) : downloadingIds[item.id] !== undefined ? (
                                                <Text style={styles.mediaCircleProgressText}>{Math.min(downloadingIds[item.id], 100)}%</Text>
                                            ) : downloadedIds[item.id] ? (
                                                <Ionicons
                                                    name={item.message_type === 'audio' ? 'musical-notes' : 'document-text'}
                                                    size={22} color={COLORS.primary}
                                                />
                                            ) : (
                                                <Ionicons name="cloud-download-outline" size={22} color="#64748b" />
                                            )}
                                        </View>

                                        {/* File info */}
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.documentName} numberOfLines={1}>
                                                {item.metadata?.name || (item.message_type === 'audio' ? 'Audio' : 'Document')}
                                            </Text>
                                            <Text style={styles.documentSize}>
                                                {item.metadata?.size
                                                    ? formatFileSize(item.metadata.size)
                                                    : downloadedIds[item.id] ? 'Saved' : 'Tap to download'}
                                            </Text>
                                        </View>

                                        {/* Status indicator */}
                                        {isMe && uploadingIds[item.id] !== undefined ? (
                                            <View style={styles.mediaCircleProgress}>
                                                <Text style={styles.mediaCircleProgressText}>{Math.min(Math.round(uploadingIds[item.id]), 100)}%</Text>
                                            </View>
                                        ) : downloadingIds[item.id] !== undefined ? (
                                            <View style={styles.mediaCircleProgress}>
                                                <Text style={styles.mediaCircleProgressText}>{Math.min(downloadingIds[item.id], 100)}%</Text>
                                            </View>
                                        ) : downloadedIds[item.id] ? (
                                            <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} />
                                        ) : !isMe ? (
                                            <Ionicons name="arrow-down-circle-outline" size={24} color="#64748b" />
                                        ) : null}
                                    </TouchableOpacity>
                                ) : (
                                    <Text style={[
                                        styles.messageText,
                                        isMe ? [styles.messageTextMe, { color: isDark ? '#e2e8f0' : '#0f172a' }]
                                             : [styles.messageTextOther, { color: colors.text }],
                                        isSystem && styles.messageTextSystem
                                    ]}>
                                        {renderMessageContent(item.content)}
                                    </Text>
                                )}
                                <View style={styles.timeEditRow}>
                                    {item.isEdited && <Text style={styles.editedLabel}>edited</Text>}
                                    <Text style={[
                                        styles.messageTime,
                                        isMe ? styles.messageTimeMe : styles.messageTimeOther
                                    ]}>
                                        {item.created_at ? format(new Date(item.created_at), 'p') : ''}
                                    </Text>
                                    {isMe && <StatusIcon status={item.status} uploadProgress={uploadingIds[item.id]} />}
                                </View>
                            </View>
                        )}

                        {/* Resend button for failed messages */}
                        {isMe && item.status === 'failed' && (
                            <TouchableOpacity style={styles.resendButton} onPress={() => handleResend(item.id)}>
                                <Ionicons name="refresh" size={14} color="#ef4444" />
                                <Text style={styles.resendText}>Tap to resend</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                </View>
            </Pressable>
        );
    };

    const charCount = inputText.length;
    const isOverLimit = charCount > MAX_CHARS;

    const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);

    const handlePickDocument = async () => {
        if (isChatRestricted) {
            Alert.alert('Read-Only Mode', 'Document uploads are disabled in read-only mode.');
            return;
        }
        if (!currentUser) return;
        setShowAttachmentMenu(false);

        // Declare tempId here so the catch block can always reference it
        let tempId = '';

        try {
            const result = await DocumentPicker.getDocumentAsync({
                type: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
                copyToCacheDirectory: true
            });

            if (!result.canceled && result.assets && result.assets.length > 0) {
                const asset = result.assets[0];
                
                if (asset.size && asset.size > 5 * 1024 * 1024) {
                    Alert.alert('File Too Large', 'Please select a file smaller than 5MB.');
                    return;
                }

                tempId = `temp-doc-${Date.now()}`;
                const originalName = asset.name;
                const uploadName = `${Date.now()}-${originalName}`;

                // Optimistic UI
                const newMessage = {
                    id: tempId,
                    content: originalName,
                    created_at: new Date().toISOString(),
                    sender_id: currentUser.id,
                    user: { 
                        username: profile?.username || currentUser.user_metadata?.username || 'me', 
                        avatar_url: profile?.avatar_url || currentUser.user_metadata?.avatar_url 
                    },
                    message_type: 'document',
                    content_type: 'document',
                    status: 'sending' as any,
                    metadata: { name: originalName, size: asset.size }
                };

                setMessages(prev => [...prev, newMessage]);
                messageStore.addMessage(id, newMessage);

                const fileUrl = await uploadLocalFileToCloudinary(asset.uri, uploadName, 'chat-docs', asset.mimeType || 'application/octet-stream', (p: number) => {
                    setUploadingIds(prev => ({ ...prev, [tempId]: Math.min(Math.round(p), 99) }));
                });

                const { data, error } = await supabase
                    .from('messages')
                    .insert([{
                        content: fileUrl,
                        sender_id: currentUser.id,
                        group_id: id,
                        message_type: 'document',
                        metadata: { name: originalName, size: asset.size, tempId }
                    }])
                    .select()
                    .single();

                if (error) throw error;
                setUploadingIds(prev => {
                    const next = { ...prev };
                    delete next[tempId];
                    return next;
                });
                setMessages(prev => prev.map(m => m.id === tempId ? { ...m, id: (data as any).id, content: fileUrl, status: 'sent' } : m));
                messageStore.updateMessage(id, tempId, { id: (data as any).id, content: fileUrl, status: 'sent' });
            }
        } catch (err: any) {
            captureUIError('ChatScreen.sendDocumentMessage', err, { groupId: id });
            // Mark only THIS message as failed — use captured tempId, not prefix match
            setMessages(prev => prev.map(m => m.id === tempId ? { ...m, status: 'failed' } : m));
            setUploadingIds(prev => {
                const next = { ...prev };
                delete next[tempId];
                return next;
            });
            if (!isNetworkError(err)) {
                Alert.alert('Upload Failed', 'Could not upload the document. Please check your connection and try again.');
            }
        }
    };

    const handlePickAudioVideo = async () => {
        if (isChatRestricted) {
            Alert.alert('Read-Only Mode', 'Audio and Video uploads are disabled in read-only mode.');
            return;
        }
        if (!currentUser) return;
        setShowAttachmentMenu(false);

        // Declare tempId here so the catch block can always reference it
        let tempId = '';

        try {
            const result = await DocumentPicker.getDocumentAsync({
                type: ['audio/*', 'video/*'],
                copyToCacheDirectory: true
            });

            if (!result.canceled && result.assets && result.assets.length > 0) {
                const asset = result.assets[0];
                
                const isAudio = asset.mimeType?.startsWith('audio');
                const sizeLimit = isAudio ? 5 * 1024 * 1024 : 20 * 1024 * 1024;
                const sizeLabelMB = isAudio ? '5MB' : '20MB';
                if (asset.size && asset.size > sizeLimit) {
                    Alert.alert('File Too Large', `Please select a ${isAudio ? 'audio' : 'video'} file smaller than ${sizeLabelMB}.`);
                    return;
                }
                const type = isAudio ? 'audio' : 'video';
                tempId = `temp-${type}-${Date.now()}`;
                const originalName = asset.name;
                const uploadName = `${Date.now()}-${originalName}`;

                // Optimistic UI
                const newMessage = {
                    id: tempId,
                    content: originalName,
                    created_at: new Date().toISOString(),
                    sender_id: currentUser.id,
                    user: { 
                        username: profile?.username || currentUser.user_metadata?.username || 'me', 
                        avatar_url: profile?.avatar_url || currentUser.user_metadata?.avatar_url 
                    },
                    message_type: type,
                    content_type: type,
                    status: 'sending' as any,
                    metadata: { name: originalName, size: asset.size }
                };

                setMessages(prev => [...prev, newMessage]);
                messageStore.addMessage(id, newMessage);

                const fileUrl = await uploadLocalFileToCloudinary(asset.uri, uploadName, `chat-${type}s`, asset.mimeType || 'application/octet-stream', (p: number) => {
                    setUploadingIds(prev => ({ ...prev, [tempId]: Math.min(Math.round(p), 99) }));
                });

                const { data, error } = await supabase
                    .from('messages')
                    .insert([{
                        content: fileUrl,
                        sender_id: currentUser.id,
                        group_id: id,
                        message_type: type,
                        metadata: { name: originalName, size: asset.size, tempId }
                    }])
                    .select()
                    .single();

                if (error) throw error;
                setUploadingIds(prev => {
                    const next = { ...prev };
                    delete next[tempId];
                    return next;
                });
                setMessages(prev => prev.map(m => m.id === tempId ? { ...m, id: (data as any).id, content: fileUrl, status: 'sent' } : m));
                messageStore.updateMessage(id, tempId, { id: (data as any).id, content: fileUrl, status: 'sent' });
            }
        } catch (err: any) {
            captureUIError('ChatScreen.sendMediaMessage', err, { groupId: id });
            // Mark only THIS message as failed — use captured tempId, not prefix match
            setMessages(prev => prev.map(m => m.id === tempId ? { ...m, status: 'failed' } : m));
            setUploadingIds(prev => {
                const next = { ...prev };
                delete next[tempId];
                return next;
            });
            if (!isNetworkError(err)) {
                Alert.alert('Upload Failed', 'Could not upload the media file. Please check your connection and try again.');
            }
        }
    };

    const formatFileSize = (bytes?: number) => {
        if (!bytes) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    // Check which media messages are already downloaded on load
    const checkDownloadedState = async (msgs: any[]) => {
        const mediaMessages = msgs.filter(m =>
            ['image', 'video', 'document', 'audio'].includes(m.message_type) &&
            m.content?.startsWith('http')
        );
        const results: Record<string, boolean> = {};
        await Promise.all(mediaMessages.map(async (m) => {
            // Filename must match exactly what handleDownloadAndOpen uses
            let fileName: string;
            if (m.message_type === 'image') {
                fileName = `image_${m.id}.jpg`;
            } else if (m.metadata?.name) {
                fileName = m.metadata.name;
            } else if (m.message_type === 'video') {
                fileName = `video_${m.id}.mp4`;
            } else if (m.message_type === 'audio') {
                fileName = `audio_${m.id}.mp3`;
            } else {
                fileName = `document_${m.id}.pdf`;
            }
            const isLocal = await FileService.isDownloaded(m.id, fileName);
            if (isLocal) results[m.id] = true;
        }));
        if (Object.keys(results).length > 0) {
            setDownloadedIds(prev => ({ ...prev, ...results }));
        }
    };

    // Download media to local vault — real progress, no fake actions
    const handleDownloadMedia = async (messageId: string, url: string, name: string) => {
        if (downloadingIds[messageId] !== undefined) return;
        if (downloadedIds[messageId]) return;

        setDownloadingIds(prev => ({ ...prev, [messageId]: 1 }));
        try {
            const localUri = await FileService.downloadFile(url, messageId, name, (p: number) => {
                const pct = Math.round(p * 100);
                setDownloadingIds(prev => ({ ...prev, [messageId]: Math.max(pct, 1) }));
            });
            if (localUri) {
                setDownloadingIds(prev => ({ ...prev, [messageId]: 100 }));
                setTimeout(() => {
                    if (!isMounted.current) return;
                    setDownloadingIds(prev => { const next = { ...prev }; delete next[messageId]; return next; });
                    setDownloadedIds(prev => ({ ...prev, [messageId]: true }));
                }, 300);
            } else {
                setDownloadingIds(prev => { const next = { ...prev }; delete next[messageId]; return next; });
                setDownloadedIds(prev => { const next = { ...prev }; delete next[messageId]; return next; });
            }
        } catch {
            setDownloadingIds(prev => { const next = { ...prev }; delete next[messageId]; return next; });
            setDownloadedIds(prev => { const next = { ...prev }; delete next[messageId]; return next; });
        }
    };

    // Download then open instantly — tap = download + open, no fake actions
    const handleDownloadAndOpen = async (messageId: string, url: string, name: string, type: string) => {
        if (downloadingIds[messageId] !== undefined) return;
        if (downloadedIds[messageId]) {
            handleOpenMedia(messageId, name, type);
            return;
        }

        setDownloadingIds(prev => ({ ...prev, [messageId]: 1 }));
        try {
            const localUri = await FileService.downloadFile(url, messageId, name, (p: number) => {
                const pct = Math.round(p * 100);
                setDownloadingIds(prev => ({ ...prev, [messageId]: Math.max(pct, 1) }));
            });
            if (localUri) {
                setDownloadingIds(prev => ({ ...prev, [messageId]: 100 }));
                setTimeout(() => {
                    if (!isMounted.current) return;
                    setDownloadingIds(prev => { const next = { ...prev }; delete next[messageId]; return next; });
                    setDownloadedIds(prev => ({ ...prev, [messageId]: true }));
                    const viewerType = type === 'document' ? 'document'
                        : type === 'video' ? 'video'
                        : type === 'audio' ? 'audio'
                        : 'image';
                    setViewerFile({ uri: localUri, type: viewerType, name });
                    setViewerVisible(true);
                }, 300);
            } else {
                setDownloadingIds(prev => { const next = { ...prev }; delete next[messageId]; return next; });
                setDownloadedIds(prev => { const next = { ...prev }; delete next[messageId]; return next; });
            }
        } catch {
            setDownloadingIds(prev => { const next = { ...prev }; delete next[messageId]; return next; });
            setDownloadedIds(prev => { const next = { ...prev }; delete next[messageId]; return next; });
        }
    };

    // Open media — only from local vault, never from remote URL
    const handleOpenMedia = async (messageId: string, name: string, type: any) => {
        const fileName = name || `${type}_${messageId}`;
        const isLocal = await FileService.isDownloaded(messageId, fileName);
        if (!isLocal) return;
        const localUri = FileService.getLocalUri(messageId, fileName);
        const viewerType = type === 'document' ? 'document'
            : type === 'video' ? 'video'
            : type === 'audio' ? 'audio'
            : 'image';
        setViewerFile({ uri: localUri, type: viewerType, name: fileName });
        setViewerVisible(true);
    };

    const [activeVideo, setActiveVideo] = useState<string | null>(null);

    return (
        <ScreenErrorBoundary>
            <KeyboardAvoidingView
                style={[styles.container, { backgroundColor: isDark ? '#0f172a' : '#e8ecf1' }]}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
            >
            {/* Header */}
            <View style={[styles.header, styles.headerLight, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
                <TouchableOpacity style={styles.backButton} onPress={goBack}>
                    <Ionicons name="chevron-back" size={24} color={colors.text} />
                </TouchableOpacity>

                <TouchableOpacity style={styles.headerTitleContainer} onPress={() => setShowMembersList(true)}>
                    <View style={[styles.headerAvatarPlaceholderLight, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                        {group?.avatar_url ? (
                            <Image
                                source={{ uri: group.avatar_url }}
                                style={{ width: 36, height: 36, borderRadius: 10 }}
                            />
                        ) : (
                            <NalissLogo size={30} />
                        )}
                    </View>
                    <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                             <Text style={styles.headerTitleLight} numberOfLines={1}>
                                 {group?.name || (initialName as string) || 'Chat'}
                             </Text>
                             <Ionicons name="people-circle-outline" size={18} color={COLORS.primary} />
                        </View>
                        <Text style={styles.headerSubtitleLight}>
                            {isGeneralGroup ? 'General Hub' : 'Level Hub'} • Tap to see members
                        </Text>
                    </View>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowGroupMenu(true)}>
                    <Ionicons name="ellipsis-vertical" size={24} color={COLORS.text} />
                </TouchableOpacity>
            </View>

            {/* Advanced Search Bar */}
            {showSearch && (
                <View style={[styles.searchBarContainer, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
                    <View style={styles.searchInputRow}>
                        <View style={[styles.searchField, { flex: 1, backgroundColor: colors.surface }]}>
                            <Ionicons name="person-outline" size={16} color={colors.textMuted} />
                            <TextInput
                                style={[styles.searchTextInput, { color: colors.text }]}
                                placeholder="User (@name)"
                                placeholderTextColor={colors.textMuted}
                                value={searchParams.username}
                                onChangeText={(val) => setSearchParams({ ...searchParams, username: val })}
                            />
                        </View>
                        <View style={[styles.searchField, { flex: 1.2, backgroundColor: colors.surface }]}>
                            <Ionicons name="chatbubble-outline" size={16} color={colors.textMuted} />
                            <TextInput
                                style={[styles.searchTextInput, { color: colors.text }]}
                                placeholder="Keyword..."
                                placeholderTextColor={colors.textMuted}
                                value={searchParams.body}
                                onChangeText={(val) => setSearchParams({ ...searchParams, body: val })}
                            />
                        </View>
                    </View>
                    <View style={styles.searchActionsRow}>
                        <View style={[styles.searchField, { flex: 1, height: 32, backgroundColor: colors.surface }]}>
                            <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
                            <TextInput
                                style={[styles.searchTextInput, { fontSize: 12, color: colors.text }]}
                                placeholder="YYYY-MM-DD"
                                placeholderTextColor={colors.textMuted}
                                value={searchParams.date || ''}
                                onChangeText={(val) => setSearchParams({ ...searchParams, date: val })}
                                keyboardType="numeric"
                            />
                        </View>
                        
                        <TouchableOpacity 
                            style={styles.searchExecuteButton}
                            onPress={() => {
                                setIsSearching(true);
                            }}
                        >
                            <Text style={styles.searchExecuteText}>Search</Text>
                        </TouchableOpacity>

                        <TouchableOpacity 
                            style={styles.searchResetButton}
                            onPress={() => {
                                const reset = { username: '', body: '', date: '' };
                                setSearchParams(reset);
                                setIsSearching(false);
                            }}
                        >
                            <Text style={styles.searchResetText}>Reset</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            )}

            {/* Messages List */}
            <FlatList
                ref={flatListRef}
                data={isSearching ? messages.filter(m => {
                    const matchUser = !searchParams.username || (m.user?.username || '').toLowerCase().includes(searchParams.username.toLowerCase().replace('@', ''));
                    const matchBody = !searchParams.body || (m.content || '').toLowerCase().includes(searchParams.body.toLowerCase());
                    const matchDate = !searchParams.date || (m.created_at || '').startsWith(searchParams.date);
                    return matchUser && matchBody && matchDate;
                }) : messages}
                keyExtractor={(item) => item.id}
                renderItem={renderMessage}
                contentContainerStyle={styles.messagesList}
                style={{ flex: 1 }}
                showsVerticalScrollIndicator={false}
                onScroll={handleScrollEvent}
                scrollEventThrottle={100}
                onContentSizeChange={() => {
                    if (isNearBottomRef.current) {
                        flatListRef.current?.scrollToEnd({ animated: false });
                    }
                }}
                initialNumToRender={20}
                maxToRenderPerBatch={10}
                windowSize={10}
                removeClippedSubviews={Platform.OS === 'android'}
            />

            {/* Long-press context menu */}
            {longPressedMessage && (
                <Modal transparent animationType="fade" visible={!!longPressedMessage}>
                    <TouchableWithoutFeedback onPress={() => setLongPressedMessage(null)}>
                        <View style={styles.contextOverlay}>
                            <View style={styles.contextMenu}>
                                <TouchableOpacity style={styles.contextItem} onPress={() => handleReply(longPressedMessage)}>
                                    <Ionicons name="arrow-undo" size={20} color={COLORS.text} />
                                    <Text style={styles.contextItemText}>Reply</Text>
                                </TouchableOpacity>
                                {/* Edit — only for text, only within 1 hour */}
                                {longPressedMessage.sender_id === currentUser?.id && (
                                    <>
                                        {longPressedMessage.message_type === 'text' &&
                                         Date.now() - new Date(longPressedMessage.created_at).getTime() < 60 * 60 * 1000 && (
                                            <TouchableOpacity style={styles.contextItem} onPress={() => handleEdit(longPressedMessage)}>
                                                <Ionicons name="create-outline" size={20} color={COLORS.text} />
                                                <Text style={styles.contextItemText}>Edit</Text>
                                            </TouchableOpacity>
                                        )}
                                        {/* Delete — available for all message types, no time limit */}
                                        <TouchableOpacity style={styles.contextItem} onPress={() => {
                                            handleDelete(longPressedMessage.id);
                                            setLongPressedMessage(null);
                                        }}>
                                            <Ionicons name="trash-outline" size={20} color="#ef4444" />
                                            <Text style={[styles.contextItemText, { color: '#ef4444' }]}>Delete</Text>
                                        </TouchableOpacity>
                                        {longPressedMessage.status === 'failed' && (
                                            <TouchableOpacity style={styles.contextItem} onPress={() => {
                                                handleResend(longPressedMessage.id);
                                                setLongPressedMessage(null);
                                            }}>
                                                <Ionicons name="refresh" size={20} color="#f59e0b" />
                                                <Text style={[styles.contextItemText, { color: '#f59e0b' }]}>Resend</Text>
                                            </TouchableOpacity>
                                        )}
                                    </>
                                )}
                            </View>
                        </View>
                    </TouchableWithoutFeedback>
                </Modal>
            )}

            {/* Video Player Modal */}
            {activeVideo && (
                <Modal visible animationType="fade" transparent>
                    <View style={styles.fullPlayerOverlay}>
                        <TouchableOpacity style={styles.playerClose} onPress={() => setActiveVideo(null)}>
                            <Ionicons name="close-circle" size={40} color="#FFF" />
                        </TouchableOpacity>
                        <View style={styles.videoPlaceholder}>
                            <Ionicons name="play-circle" size={80} color="#FFF" />
                            <Text style={styles.videoPlaceholderText}>Playing: {activeVideo.split('/').pop()}</Text>
                        </View>
                    </View>
                </Modal>
            )}

            {/* Attachment Menu Modal */}
            <Modal visible={showAttachmentMenu} animationType="fade" transparent>
                <TouchableWithoutFeedback onPress={() => setShowAttachmentMenu(false)}>
                    <View style={styles.attachmentOverlay}>
                        <View style={styles.attachmentMenu}>
                            <TouchableOpacity style={styles.attachmentItem} onPress={() => { setShowAttachmentMenu(false); handlePickImage(); }}>
                                <View style={[styles.attachmentIcon, { backgroundColor: '#3b82f6' }]}>
                                    <Ionicons name="image" size={22} color="#FFF" />
                                </View>
                                <Text style={styles.attachmentText}>Photo</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.attachmentItem} onPress={handlePickDocument}>
                                <View style={[styles.attachmentIcon, { backgroundColor: '#10b981' }]}>
                                    <Ionicons name="document" size={22} color="#FFF" />
                                </View>
                                <Text style={styles.attachmentText}>Document</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.attachmentItem} onPress={handlePickAudioVideo}>
                                <View style={[styles.attachmentIcon, { backgroundColor: '#f59e0b' }]}>
                                    <Ionicons name="play" size={22} color="#FFF" />
                                </View>
                                <Text style={styles.attachmentText}>Audio/Video</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>

            {/* ========== MEMBERS LIST MODAL ========== */}
            <Modal visible={showMembersList} animationType="slide" transparent onShow={fetchMembers}>
                <View style={styles.modalOverlay}>
                    <View style={styles.membersModal}>
                        <View style={styles.membersHeader}>
                            <Text style={styles.membersTitle}>Group Members</Text>
                            <TouchableOpacity onPress={() => setShowMembersList(false)}>
                                <Ionicons name="close" size={24} color={COLORS.text} />
                            </TouchableOpacity>
                        </View>
                        <Text style={styles.membersCount}>{
                            // Always count current user as a member even if not in the fetched list
                            (() => {
                                const hasCurrentUser = members.some(m => m.id === currentUser?.id);
                                const total = hasCurrentUser ? members.length : members.length + 1;
                                return `${total} ${total === 1 ? 'member' : 'members'}`;
                            })()
                        }</Text>

                        <ScrollView style={styles.membersList}>
                            {members.map((member) => {
                                const isYou = member.id === currentUser?.id;
                                return (
                                <TouchableOpacity
                                    key={member.id}
                                    style={styles.memberItem}
                                    onPress={() => {
                                        if (isYou) return; // don't open own profile
                                        setShowMembersList(false);
                                        setViewingProfile(member);
                                    }}
                                >
                                    {member.avatar_url ? (
                                        <Image source={{ uri: member.avatar_url }} style={styles.memberAvatar} />
                                    ) : (
                                        <View style={[styles.memberAvatar, { backgroundColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center' }]}>
                                            <Text style={{ fontWeight: 'bold', color: '#64748b' }}>
                                                {member.full_name?.charAt(0)}
                                            </Text>
                                        </View>
                                    )}
                                    <View style={styles.memberInfo}>
                                        <View style={styles.memberNameRow}>
                                            <Text style={styles.memberFullName}>
                                                {isYou ? `${member.full_name} (You)` : member.full_name}
                                            </Text>
                                            {!isYou && (member.last_active_at && (new Date().getTime() - new Date(member.last_active_at).getTime() < 300000)) && (
                                                <View style={styles.memberOnlineDot} />
                                            )}
                                        </View>
                                        <Text style={styles.memberUsername}>@{member.username}</Text>
                                    </View>
                                    <View style={styles.memberLevelBadge}>
                                        <Text style={styles.memberLevelText}>{member.level}</Text>
                                    </View>
                                </TouchableOpacity>
                                );
                            })}
                        </ScrollView>
                    </View>
                </View>
            </Modal>

            {/* ========== PROFILE VIEW MODAL ========== */}
            <Modal visible={!!viewingProfile} animationType="slide" transparent>
                <View style={styles.modalOverlay}>
                    <View style={styles.profileModal}>
                        <TouchableOpacity style={styles.profileClose} onPress={() => setViewingProfile(null)}>
                            <Ionicons name="close" size={24} color={COLORS.text} />
                        </TouchableOpacity>

                        {viewingProfile && (
                            <ScrollView showsVerticalScrollIndicator={false}>
                                <View style={styles.profileHeader}>
                                    {viewingProfile.avatar_url ? (
                                        <Image source={{ uri: viewingProfile.avatar_url }} style={styles.profileAvatar} />
                                    ) : (
                                        <View style={[styles.profileAvatar, { backgroundColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center' }]}>
                                            <Text style={{ fontSize: 32, fontWeight: 'bold', color: '#64748b' }}>
                                                {viewingProfile.full_name?.charAt(0)}
                                            </Text>
                                        </View>
                                    )}
                                    <Text style={styles.profileFullName}>{viewingProfile.full_name}</Text>
                                    <Text style={styles.profileUsername}>@{viewingProfile.username}</Text>
                                    <View style={styles.profileOnlineStatus}>
                                        <View style={[
                                            styles.profileOnlineDot, 
                                            { backgroundColor: (viewingProfile.last_active_at && (new Date().getTime() - new Date(viewingProfile.last_active_at).getTime() < 300000)) ? '#10B981' : '#94a3b8' }
                                        ]} />
                                        <Text style={styles.profileOnlineText}>
                                            {(viewingProfile.last_active_at && (new Date().getTime() - new Date(viewingProfile.last_active_at).getTime() < 300000)) ? 'Online' : 'Offline'}
                                        </Text>
                                    </View>
                                </View>

                                <View style={styles.profileInfoSection}>
                                    <View style={styles.profileInfoCard}>
                                        <View style={styles.profileInfoItem}>
                                            <Ionicons name="school-outline" size={18} color="#059669" />
                                            <View style={styles.profileInfoTextGroup}>
                                                <Text style={styles.profileInfoLabel}>Level</Text>
                                                <Text style={styles.profileInfoValue}>{viewingProfile.level}</Text>
                                            </View>
                                        </View>
                                        <View style={styles.profileInfoDivider} />
                                        <View style={styles.profileInfoItem}>
                                            <Ionicons name="library-outline" size={18} color="#059669" />
                                            <View style={styles.profileInfoTextGroup}>
                                                <Text style={styles.profileInfoLabel}>Department</Text>
                                                <Text style={styles.profileInfoValue}>{viewingProfile.department?.name || 'NALISS Hub'}</Text>
                                            </View>
                                        </View>
                                        <View style={styles.profileInfoDivider} />
                                        <View style={styles.profileInfoItem}>
                                            <Ionicons name="calendar-outline" size={18} color="#059669" />
                                            <View style={styles.profileInfoTextGroup}>
                                                <Text style={styles.profileInfoLabel}>Joined</Text>
                                                <Text style={styles.profileInfoValue}>
                                                    {viewingProfile.created_at ? format(new Date(viewingProfile.created_at), 'MMM yyyy') : 'Recently'}
                                                </Text>
                                            </View>
                                        </View>
                                    </View>
                                </View>

                                <View style={styles.profileBioSection}>
                                    <Text style={styles.profileSectionTitle}>Biography</Text>
                                    <Text style={styles.profileBioText}>
                                        {viewingProfile.biography || viewingProfile.bio || 'No biography provided.'}
                                    </Text>
                                </View>

                                <View style={styles.profileBioSection}>
                                    <Text style={styles.profileSectionTitle}>Motivation / Quote</Text>
                                    <View style={styles.quoteCard}>
                                        <Ionicons name="chatbubble-ellipses-outline" size={18} color="#059669" style={{ marginRight: 10, marginTop: 2 }} />
                                        <Text style={styles.quoteText}>
                                            {viewingProfile.motivation || 'No quote shared yet.'}
                                        </Text>
                                    </View>
                                </View>

                                <View style={[styles.profileBioSection, { paddingBottom: 24 }]}>
                                    <Text style={styles.profileSectionTitle}>Hobbies</Text>
                                    <View style={styles.hobbiesRow}>
                                        {(typeof viewingProfile.hobbies === 'string' ? viewingProfile.hobbies.split(',').map((s: string) => s.trim()) : (viewingProfile.hobbies || [])).map((hobby: string, idx: number) => (
                                            hobby ? (
                                                <View key={idx} style={styles.hobbyChip}>
                                                    <Text style={styles.hobbyChipText}>{hobby}</Text>
                                                </View>
                                            ) : null
                                        ))}
                                    </View>
                                </View>
                            </ScrollView>
                        )}
                    </View>
                </View>
            </Modal>

            {/* ========== GROUP MENU MODAL ========== */}
            <Modal visible={showGroupMenu} animationType="fade" transparent>
                <TouchableWithoutFeedback onPress={() => setShowGroupMenu(false)}>
                    <View style={styles.menuOverlay}>
                        <TouchableWithoutFeedback>
                            <View style={styles.menuContent}>
                                <TouchableOpacity style={styles.menuItem} onPress={() => { setShowGroupMenu(false); setShowSearch(!showSearch); }}>
                                    <Ionicons name="search-outline" size={20} color={COLORS.text} />
                                    <Text style={styles.menuItemText}>Search Messages</Text>
                                </TouchableOpacity>
                                
                                <TouchableOpacity style={styles.menuItem} onPress={() => { setShowGroupMenu(false); setShowMembersList(true); }}>
                                    <Ionicons name="people-outline" size={20} color={COLORS.text} />
                                    <Text style={styles.menuItemText}>Group Members</Text>
                                </TouchableOpacity>

                                <TouchableOpacity style={[styles.menuItem, { borderBottomWidth: 0 }]} onPress={() => { setShowGroupMenu(false); Alert.alert('Group Settings', 'Settings are coming soon.'); }}>
                                    <Ionicons name="settings-outline" size={20} color={COLORS.text} />
                                    <Text style={styles.menuItemText}>Group Settings</Text>
                                </TouchableOpacity>
                            </View>
                        </TouchableWithoutFeedback>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>

            {/* Sticker Picker */}
            {showStickerPicker && (
                <View style={styles.stickerPickerContainer}>
                    <View style={styles.stickerPickerHeader}>
                        <Text style={styles.stickerPickerTitle}>Stickers</Text>
                        <TouchableOpacity onPress={() => setShowStickerPicker(false)}>
                            <Ionicons name="close" size={22} color={COLORS.text} />
                        </TouchableOpacity>
                    </View>
                    <View style={styles.stickerGrid}>
                        {STICKER_LIST.map((sticker, idx) => (
                            <TouchableOpacity key={idx} style={styles.stickerItem} onPress={() => handleSendSticker(sticker)}>
                                <Text style={styles.stickerItemText}>{sticker}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>
            )}

            {/* Reply / Edit banner */}
            {(replyingTo || editingMessage) && (
                <View style={styles.replyBanner}>
                    <View style={styles.replyBannerLeft}>
                        <Ionicons name={editingMessage ? "create-outline" : "arrow-undo"} size={18} color="#059669" />
                        <View style={{ marginLeft: 10, flex: 1 }}>
                            <Text style={styles.replyBannerLabel}>
                                {editingMessage ? 'Editing message' : `Replying to ${replyingTo?.user?.username}`}
                            </Text>
                            <Text style={styles.replyBannerContent} numberOfLines={1}>
                                {editingMessage?.content || replyingTo?.content}
                            </Text>
                        </View>
                    </View>
                    <TouchableOpacity onPress={cancelReplyOrEdit}>
                        <Ionicons name="close" size={22} color="#64748b" />
                    </TouchableOpacity>
                </View>
            )}

            {/* Footer / Input Area */}
            {isChatRestricted ? (
                <View style={[styles.readOnlyContainer, { paddingBottom: Platform.OS === 'ios' ? 32 : 16, backgroundColor: colors.card }]}>
                    <Ionicons name="lock-closed" size={20} color="#64748b" />
                    <Text style={[styles.readOnlyText, { color: colors.textSecondary }]}>Institutional Read-Only Mode Active</Text>
                </View>
            ) : group?.chat_enabled === false ? (
                <View style={[styles.readOnlyContainer, { paddingBottom: Platform.OS === 'ios' ? 32 : 16, backgroundColor: isDark ? '#1a0a0a' : '#fef2f2' }]}>
                    <Ionicons name="chatbubble-ellipses-outline" size={20} color="#ef4444" />
                    <Text style={[styles.readOnlyText, { color: '#ef4444' }]}>Chat has been disabled for this group</Text>
                </View>
            ) : (
                <View style={{ backgroundColor: colors.card }}>
                    <View style={[styles.inputContainer, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
                        <TouchableOpacity 
                            style={styles.stickerButton}
                            onPress={() => setShowAttachmentMenu(true)}
                        >
                            <Ionicons name="add-circle-outline" size={28} color={colors.textMuted} />
                        </TouchableOpacity>

                        <TouchableOpacity 
                            style={styles.stickerButton}
                            onPress={() => setShowStickerPicker(!showStickerPicker)}
                        >
                            <Ionicons name="happy-outline" size={26} color={showStickerPicker ? "#059669" : colors.textMuted} />
                        </TouchableOpacity>

                        <View style={[styles.inputWrapper, { backgroundColor: isDark ? '#1e293b' : '#f1f5f9' }]}>
                            <TextInput
                                style={[styles.input, { color: colors.text }]}
                                placeholder="Type a message..."
                                placeholderTextColor={colors.textMuted}
                                multiline
                                value={inputText}
                                onChangeText={setInputText}
                                maxLength={MAX_CHARS}
                            />
                            {charCount > MAX_CHARS * 0.8 && (
                                <Text style={[styles.charCounter, isOverLimit && styles.charCounterOver]}>
                                    {charCount}/{MAX_CHARS}
                                </Text>
                            )}
                        </View>

                        <TouchableOpacity 
                            style={[
                                styles.sendButton,
                                (!inputText.trim() || isOverLimit) && styles.sendButtonDisabled
                            ]}
                            onPress={handleSend}
                            disabled={!inputText.trim() || isOverLimit}
                        >
                            <Ionicons name="send" size={20} color="#FFF" />
                        </TouchableOpacity>
                    </View>
                </View>
            )}

            {/* Universal In-App Viewer Modal */}
            <UniversalViewer
                isVisible={viewerVisible}
                onClose={() => setViewerVisible(false)}
                fileUri={viewerFile.uri}
                fileType={viewerFile.type}
                fileName={viewerFile.name}
            />
        </KeyboardAvoidingView>
        </ScreenErrorBoundary>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#e8ecf1' },
    header: {
        flexDirection: 'row', alignItems: 'center',
        paddingTop: Platform.OS === 'ios' ? 56 : 40,
        paddingBottom: 16, paddingHorizontal: 16,
    },
    headerLight: { backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
    backButton: { marginRight: 8, padding: 4 },
    headerTitleContainer: { flexDirection: 'row', alignItems: 'center', flex: 1 },
    headerAvatarPlaceholderLight: {
        width: 40, height: 40, borderRadius: 20,
        backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0',
        alignItems: 'center', justifyContent: 'center', marginRight: 12, overflow: 'hidden',
    },
    headerTitleLight: { fontFamily: 'Inter-Bold', fontSize: 18, color: COLORS.text },
    headerSubtitleLight: { fontFamily: 'Inter-Medium', fontSize: 11, color: COLORS.textMuted },
    // Messages
    messagesList: { padding: 16, paddingBottom: 24 },
    messageWrapper: { flexDirection: 'row', marginBottom: 14, alignItems: 'flex-end' },
    messageWrapperLeft: { justifyContent: 'flex-start' },
    messageWrapperRight: { justifyContent: 'flex-end' },
    messageAvatarContainer: { marginRight: 8, position: 'relative' },
    messageAvatarImage: { width: 36, height: 36, borderRadius: 18 },
    messageAvatarPlaceholder: {
        width: 36, height: 36, borderRadius: 18, backgroundColor: '#cbd5e1',
        alignItems: 'center', justifyContent: 'center',
    },
    messageAvatarText: { fontFamily: 'Inter-Bold', fontSize: 14, color: '#FFF' },
    // Online presence dot — shown on avatar bottom-right
    presenceDot: {
        position: 'absolute',
        bottom: 0,
        right: 0,
        width: 10,
        height: 10,
        borderRadius: 5,
        borderWidth: 2,
        borderColor: '#e8ecf1', // matches chat background
    },
    messageContentWrapper: { maxWidth: '80%' },
    senderInfoCol: { flexDirection: 'column', alignItems: 'flex-start', paddingLeft: 4, marginBottom: 2 },
    senderInfoRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    senderName: { fontFamily: 'Inter-Bold', fontSize: 13, color: '#059669' },
    // Level badge shown inline next to sender name in General Hub
    levelBadgeInline: {
        backgroundColor: '#059669',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 6,
    },
    levelBadgeInlineText: { fontFamily: 'Inter-Black', fontSize: 9, color: '#FFF', letterSpacing: 0.5 },
    // Keep old style for backward compat (not used in new render but avoids crash if referenced)
    levelBadgeTop: { 
        backgroundColor: '#059669', 
        paddingHorizontal: 8, 
        paddingVertical: 3, 
        borderRadius: 6,
        marginBottom: 2, 
        alignSelf: 'flex-start' 
    },
    levelBadgeTextTop: { fontFamily: 'Inter-Black', fontSize: 9, color: '#FFF', letterSpacing: 0.8 },
    // Reply preview
    replyPreview: { flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.04)', borderRadius: 10, padding: 8, marginBottom: 4 },
    replyBar: { width: 3, backgroundColor: '#059669', borderRadius: 2, marginRight: 8 },
    replyContent: { flex: 1 },
    replyUsername: { fontFamily: 'Inter-Bold', fontSize: 11, color: '#059669' },
    replyText: { fontFamily: 'Inter-Regular', fontSize: 12, color: '#64748b' },
    // Sticker — circular bubble
    stickerBubble: {
        width: 80, height: 80, borderRadius: 40,
        alignItems: 'center', justifyContent: 'center',
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.10, shadowRadius: 6, elevation: 3,
    },
    stickerBubbleMe: {
        backgroundColor: '#dcf8c6',
        borderBottomRightRadius: 8,
    },
    stickerBubbleOther: {
        backgroundColor: '#fff',
        borderTopLeftRadius: 8,
    },
    stickerEmoji: { fontSize: 40, lineHeight: 46 },
    stickerTimeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 4, gap: 4 },
    stickerStatusRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 2 },
    // Bubbles
    messageBubble: {
        paddingVertical: 8, paddingHorizontal: 12, borderRadius: 18,
        shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05, shadowRadius: 1, elevation: 1,
    },
    messageBubbleMe: { backgroundColor: '#dcf8c6', borderBottomRightRadius: 4 },
    messageBubbleOther: { backgroundColor: '#FFF', borderTopLeftRadius: 4 },
    imageBubbleMe: { backgroundColor: '#dcf8c6', borderBottomRightRadius: 4, padding: 2 },
    imageBubbleOther: { backgroundColor: '#FFF', borderTopLeftRadius: 4, padding: 2 },
    messageBubbleSystem: {
        backgroundColor: '#f1f5f9', alignSelf: 'center', borderRadius: 12,
        maxWidth: '90%', borderColor: 'transparent', paddingVertical: 6, paddingHorizontal: 16,
    },
    messageText: { fontFamily: 'Inter-Regular', fontSize: 15, lineHeight: 20 },
    messageTextMe: { color: '#0f172a' },
    messageTextOther: { color: '#0f172a' },
    messageTextSystem: { color: COLORS.textMuted, fontSize: 12, textAlign: 'center', fontStyle: 'italic' },
    mentionText: { color: '#059669', fontFamily: 'Inter-Bold' },
    timeEditRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 2, gap: 4 },
    editedLabel: { fontFamily: 'Inter-Regular', fontSize: 9, color: '#94a3b8', fontStyle: 'italic' },
    messageTime: { fontFamily: 'Inter-Medium', fontSize: 10 },
    messageTimeMe: { color: '#64748b' },
    messageTimeOther: { color: '#94a3b8' },
    // Resend
    resendButton: {
        flexDirection: 'row', alignItems: 'center', marginTop: 4, paddingLeft: 4
    },
    resendText: { fontFamily: 'Inter-Medium', fontSize: 11, color: '#ef4444', marginLeft: 4 },
    // WhatsApp-style circular upload indicator
    uploadCircleContainer: { flexDirection: 'row', alignItems: 'center', marginLeft: 4 },
    uploadCircleBg: { alignItems: 'center', justifyContent: 'center' },
    uploadCircleTrack: { borderWidth: 2, borderColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center' },
    uploadCircleFill: { borderColor: COLORS.primary },
    uploadCircleText: { fontFamily: 'Inter-Bold', fontSize: 9, color: '#94a3b8', marginTop: 2 },
    // Image upload overlay (WhatsApp style — dark circle over image)
    imageUploadOverlay: {
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', borderRadius: 12,
    },
    imageUploadCircle: {
        width: 52, height: 52, borderRadius: 26,
        backgroundColor: 'rgba(0,0,0,0.6)', borderWidth: 2.5, borderColor: '#fff',
        alignItems: 'center', justifyContent: 'center',
    },
    imageUploadPercent: { fontFamily: 'Inter-Bold', fontSize: 12, color: '#fff' },
    // Doc/video upload circle row
    docUploadCircleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, paddingHorizontal: 4 },
    docUploadCircle: {
        width: 32, height: 32, borderRadius: 16,
        backgroundColor: 'rgba(15,23,42,0.08)', borderWidth: 2, borderColor: COLORS.primary,
        alignItems: 'center', justifyContent: 'center',
    },
    docUploadCircleText: { fontFamily: 'Inter-Bold', fontSize: 9, color: COLORS.primary },
    docUploadLabel: { fontFamily: 'Inter-Medium', fontSize: 11, color: '#94a3b8' },
    // Download overlay on images (shown until downloaded)
    imageDownloadOverlay: {
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.38)', alignItems: 'center', justifyContent: 'center', borderRadius: 12,
    },
    // Open overlay on images (shown after downloaded — small badge bottom-right)
    imageOpenOverlay: {
        position: 'absolute', bottom: 28, right: 6,
    },
    imageOpenBadge: {
        backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 8, padding: 4,
        flexDirection: 'row', alignItems: 'center', gap: 3,
    },
    // File size label on image bubbles
    mediaSizeLabel: {
        position: 'absolute', bottom: 28, left: 8,
        backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 6,
        paddingHorizontal: 6, paddingVertical: 2,
    },
    mediaSizeText: { fontFamily: 'Inter-Bold', fontSize: 9, color: '#fff' },
    // Document icon box — downloaded state
    documentIconBoxDone: { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0', borderWidth: 1 },
    // ── Video thumbnail bubble ────────────────────────────────────────────────
    videoThumbContainer: {
        width: 220, borderRadius: 14, overflow: 'hidden', position: 'relative',
    },
    videoThumb: {
        width: 220, height: 160, backgroundColor: '#0f172a',
    },
    videoThumbOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.25)',
    },
    videoPlayBtn: {
        position: 'absolute',
        top: '50%', left: '50%',
        marginTop: -24, marginLeft: -24,
        width: 48, height: 48, borderRadius: 24,
        backgroundColor: 'rgba(0,0,0,0.65)',
        borderWidth: 2, borderColor: 'rgba(255,255,255,0.8)',
        alignItems: 'center', justifyContent: 'center',
    },
    // Circular progress for media download (images + docs)
    mediaCircleProgress: {
        width: 48, height: 48, borderRadius: 24,
        backgroundColor: 'rgba(0,0,0,0.6)', borderWidth: 2.5, borderColor: '#fff',
        alignItems: 'center', justifyContent: 'center',
    },
    mediaCircleProgressText: { fontFamily: 'Inter-Bold', fontSize: 10, color: '#fff' },
    // Download button on image overlay
    mediaDownloadBtn: {
        width: 48, height: 48, borderRadius: 24,
        backgroundColor: 'rgba(0,0,0,0.6)', borderWidth: 2.5, borderColor: '#fff',
        alignItems: 'center', justifyContent: 'center',
    },
    // Download button on doc/video row (right side)
    mediaDownloadBtnSmall: {
        width: 36, height: 36, borderRadius: 18,
        backgroundColor: 'rgba(15,23,42,0.06)', borderWidth: 1.5, borderColor: COLORS.primary,
        alignItems: 'center', justifyContent: 'center',
    },
    // Open button on doc/video row (right side, after download)
    mediaOpenBtn: {
        width: 36, height: 36, borderRadius: 18,
        alignItems: 'center', justifyContent: 'center',
    },
    // Context menu
    contextOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', alignItems: 'center' },
    contextMenu: {
        backgroundColor: '#FFF', borderRadius: 16, paddingVertical: 8, width: 200,
        shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 20, elevation: 10,
    },
    contextItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 20 },
    contextItemText: { fontFamily: 'Inter-Medium', fontSize: 15, color: COLORS.text, marginLeft: 14 },
    // Sticker picker
    stickerPickerContainer: { backgroundColor: '#FFF', borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingHorizontal: 16, paddingBottom: 8 },
    stickerPickerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
    stickerPickerTitle: { fontFamily: 'Inter-Bold', fontSize: 16, color: COLORS.text },
    stickerGrid: { flexDirection: 'row', flexWrap: 'wrap' },
    stickerItem: { width: '20%', alignItems: 'center', paddingVertical: 10 },
    stickerItemText: { fontSize: 30 },
    // Reply/Edit banner
    replyBanner: {
        flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF',
        borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingHorizontal: 16, paddingVertical: 10,
    },
    replyBannerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
    replyBannerLabel: { fontFamily: 'Inter-Bold', fontSize: 12, color: '#059669' },
    replyBannerContent: { fontFamily: 'Inter-Regular', fontSize: 12, color: '#64748b' },
    // Input
    inputContainer: {
        flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 10,
        paddingVertical: 10, paddingBottom: Platform.OS === 'ios' ? 28 : 12,
        backgroundColor: '#FFF', borderTopWidth: 1, borderTopColor: '#f1f5f9',
    },
    readOnlyContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 16,
        paddingBottom: Platform.OS === 'ios' ? 32 : 16,
        backgroundColor: '#f8fafc',
        borderTopWidth: 1,
        borderTopColor: '#f1f5f9',
        gap: 8,
    },
    readOnlyText: {
        fontFamily: 'Inter-Medium',
        fontSize: 14,
        color: '#64748b',
    },
    stickerButton: { padding: 6, marginBottom: 4 },
    inputWrapper: { flex: 1, position: 'relative', marginHorizontal: 8 },
    input: {
        backgroundColor: '#f1f5f9', borderRadius: 24,
        paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, paddingRight: 60,
        maxHeight: 80, minHeight: 44, fontFamily: 'Inter-Regular', fontSize: 15, color: COLORS.text,
    },
    charCounter: { position: 'absolute', right: 14, bottom: 12, fontFamily: 'Inter-Medium', fontSize: 10, color: '#94a3b8' },
    charCounterOver: { color: '#ef4444' },
    sendButton: {
        width: 44, height: 44, borderRadius: 22, backgroundColor: '#059669',
        alignItems: 'center', justifyContent: 'center',
    },
    sendButtonDisabled: { backgroundColor: '#e2e8f0' },
    // Search Bar
    searchBarContainer: {
        backgroundColor: '#FFF',
        padding: 12,
        paddingTop: 0,
        borderBottomWidth: 1,
        borderBottomColor: '#f1f5f9',
    },
    searchInputRow: {
        flexDirection: 'row',
        gap: 8,
        marginBottom: 8,
    },
    searchField: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#f8fafc',
        borderRadius: 8,
        paddingHorizontal: 10,
        height: 36,
        borderWidth: 1,
        borderColor: '#e2e8f0',
    },
    searchTextInput: {
        flex: 1,
        fontSize: 13,
        marginLeft: 6,
        fontFamily: 'Inter-Regular',
        color: COLORS.text,
    },
    searchExecuteButton: {
        paddingHorizontal: 16,
        height: 32,
        backgroundColor: '#059669',
        borderRadius: 6,
        justifyContent: 'center',
    },
    searchExecuteText: {
        fontSize: 13,
        fontFamily: 'Inter-Bold',
        color: '#FFF',
    },
    searchActionsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    searchDateButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        height: 32,
        backgroundColor: '#f1f5f9',
        borderRadius: 6,
    },
    searchDateText: {
        fontSize: 12,
        fontFamily: 'Inter-Medium',
        color: COLORS.textMuted,
        marginLeft: 6,
    },
    searchResetButton: {
        paddingHorizontal: 12,
        height: 32,
        justifyContent: 'center',
    },
    searchResetText: {
        fontSize: 13,
        fontFamily: 'Inter-Medium',
        color: COLORS.textMuted,
    },
    // Document Preview
    documentActionArea: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        backgroundColor: 'rgba(0,0,0,0.04)',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(0,0,0,0.05)',
        gap: 12,
        marginBottom: 4,
    },
    documentIconBox: {
        width: 44,
        height: 44,
        borderRadius: 10,
        backgroundColor: 'rgba(255,255,255,0.6)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    documentName: {
        fontFamily: 'Inter-Bold',
        fontSize: 14,
        color: COLORS.text,
    },
    documentSize: {
        fontFamily: 'Inter-Medium',
        fontSize: 11,
        color: '#94a3b8',
    },
    searchSubmitButton: {
        paddingHorizontal: 16,
        height: 32,
        backgroundColor: '#059669',
        borderRadius: 6,
        justifyContent: 'center',
    },
    searchSubmitText: {
        fontSize: 13,
        fontFamily: 'Inter-Bold',
        color: '#FFF',
    },
    // ========== Modals ==========
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    // Members List
    membersModal: {
        backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24,
        maxHeight: '80%', paddingBottom: Platform.OS === 'ios' ? 34 : 16,
    },
    // Menu
    menuOverlay: {
        flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
        justifyContent: 'flex-start', alignItems: 'flex-end',
        paddingTop: Platform.OS === 'ios' ? 100 : 80, paddingRight: 10,
    },
    menuContent: {
        backgroundColor: '#FFF', borderRadius: 16, width: 220,
        paddingVertical: 8, shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1,
        shadowRadius: 10, elevation: 5,
    },
    menuItem: {
        flexDirection: 'row', alignItems: 'center',
        paddingVertical: 12, paddingHorizontal: 16,
        borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
    },
    menuItemText: {
        fontFamily: 'Inter-Medium', fontSize: 14,
        color: COLORS.text, marginLeft: 12,
    },
    membersHeader: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8,
    },
    membersTitle: { fontFamily: 'Inter-Bold', fontSize: 20, color: COLORS.text },
    membersCount: { fontFamily: 'Inter-Medium', fontSize: 13, color: COLORS.textMuted, paddingHorizontal: 20, marginBottom: 12 },
    membersList: { paddingHorizontal: 20 },
    memberItem: {
        flexDirection: 'row', alignItems: 'center', paddingVertical: 14,
        borderBottomWidth: 1, borderBottomColor: '#f8fafc',
    },
    memberAvatar: { width: 48, height: 48, borderRadius: 24, marginRight: 14 },
    memberInfo: { flex: 1 },
    memberNameRow: { flexDirection: 'row', alignItems: 'center' },
    memberFullName: { fontFamily: 'Inter-Bold', fontSize: 15, color: COLORS.text },
    memberOnlineDot: {
        width: 8, height: 8, borderRadius: 4, backgroundColor: '#10B981', marginLeft: 8,
    },
    memberUsername: { fontFamily: 'Inter-Medium', fontSize: 13, color: COLORS.textMuted },
    memberLevelBadge: {
        backgroundColor: '#064e3b', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10,
    },
    memberLevelText: { fontFamily: 'Inter-Bold', fontSize: 10, color: '#FFF' },
    // Profile Modal
    profileModal: {
        backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24,
        maxHeight: '85%', paddingBottom: Platform.OS === 'ios' ? 34 : 16,
    },
    profileClose: { alignSelf: 'flex-end', padding: 16 },
    profileHeader: { alignItems: 'center', paddingBottom: 20 },
    profileAvatar: {
        width: 90, height: 90, borderRadius: 45, marginBottom: 14,
        borderWidth: 3, borderColor: '#059669',
    },
    profileFullName: { fontFamily: 'Inter-Bold', fontSize: 22, color: COLORS.text },
    profileUsername: { fontFamily: 'Inter-Medium', fontSize: 14, color: '#059669', marginTop: 2 },
    profileOnlineStatus: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
    profileOnlineDot: { width: 10, height: 10, borderRadius: 5, marginRight: 6 },
    profileOnlineText: { fontFamily: 'Inter-Medium', fontSize: 13, color: COLORS.textMuted },
    profileInfoSection: { paddingHorizontal: 24, marginBottom: 20 },
    profileInfoCard: {
        backgroundColor: '#f8fafc', borderRadius: 16, padding: 16,
        borderWidth: 1, borderColor: '#f1f5f9',
    },
    profileInfoItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
    profileInfoTextGroup: { marginLeft: 14 },
    profileInfoLabel: { fontFamily: 'Inter-Medium', fontSize: 11, color: COLORS.textMuted },
    profileInfoValue: { fontFamily: 'Inter-Bold', fontSize: 14, color: COLORS.text },
    profileInfoDivider: { height: 1, backgroundColor: '#f1f5f9', marginVertical: 2 },
    profileBioSection: { paddingHorizontal: 24, marginBottom: 16 },
    profileSectionTitle: { fontFamily: 'Inter-Bold', fontSize: 16, color: COLORS.text, marginBottom: 8 },
    profileBioText: {
        fontFamily: 'Inter-Regular', fontSize: 14, color: '#475569', lineHeight: 22,
    },
    quoteCard: {
        flexDirection: 'row', backgroundColor: '#f0fdf4', borderRadius: 14,
        padding: 14, borderWidth: 1, borderColor: '#d1fae5',
    },
    quoteText: {
        fontFamily: 'Inter-Medium', fontSize: 14, color: '#064e3b',
        lineHeight: 21, flex: 1, fontStyle: 'italic',
    },
    hobbiesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    hobbyChip: {
        backgroundColor: '#f1f5f9', paddingHorizontal: 14, paddingVertical: 8,
        borderRadius: 20, borderWidth: 1, borderColor: '#e2e8f0',
    },
    hobbyChipText: { fontFamily: 'Inter-Medium', fontSize: 13, color: '#334155' },
    imageMessageContainer: {
        borderRadius: 18,
        padding: 4,
        overflow: 'hidden',
        maxWidth: 240,
    },
    messageImage: {
        width: 232,
        height: 180,
        borderRadius: 14,
        marginBottom: 4,
    },
    // Attachment Menu
    attachmentOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.2)', justifyContent: 'flex-end' },
    attachmentMenu: {
        backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24,
        padding: 24, flexDirection: 'row', justifyContent: 'space-around',
        paddingBottom: Platform.OS === 'ios' ? 44 : 24,
    },
    attachmentItem: { alignItems: 'center', gap: 8 },
    attachmentIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
    attachmentText: { fontFamily: 'Inter-Bold', fontSize: 13, color: COLORS.text },
    // File Bubbles
    fileBubble: {
        flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 16,
        maxWidth: 260, gap: 12,
    },
    fileIconContainer: { width: 48, height: 48, backgroundColor: 'rgba(255,255,255,0.5)', borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    fileInfo: { flex: 1 },
    fileName: { fontFamily: 'Inter-Bold', fontSize: 14, color: '#0f172a' },
    fileSize: { fontFamily: 'Inter-Medium', fontSize: 11, color: '#64748b' },
    // Video Player
    fullPlayerOverlay: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
    playerClose: { position: 'absolute', top: 50, right: 20, zIndex: 10 },
    videoPlaceholder: { alignItems: 'center', gap: 16 },
    videoPlaceholderText: { color: '#FFF', fontFamily: 'Inter-Medium', fontSize: 14 },
    uploadProgressContainer: {
        height: 18,
        backgroundColor: 'rgba(0,0,0,0.05)',
        borderRadius: 9,
        marginTop: 6,
        overflow: 'hidden',
        position: 'relative',
        justifyContent: 'center',
    },
    uploadProgressBar: {
        position: 'absolute',
        top: 0,
        left: 0,
        bottom: 0,
        backgroundColor: '#10b981',
        opacity: 0.2,
    },
    uploadProgressText: {
        fontSize: 10,
        fontFamily: 'Inter-Bold',
        color: '#64748b',
        textAlign: 'center',
    },
});
