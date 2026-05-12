import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth.store';
import { useAdminDataStore } from '../store/adminData.store';
import type { AcademicLevel, Group, GroupMember, User } from '../types';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import ErrorState from '../components/ui/ErrorState';
import FileUpload from '../lib/FileUpload';
import {
  Users, Search, Crown, UserMinus, UserPlus, Plus, X,
  ChevronRight, GraduationCap, Building, Pencil, Trash2,
  CheckCircle2, Shield, MessageSquare, Image as ImageIcon,
  AlertTriangle, RefreshCw, Layers, ToggleLeft, ToggleRight,
  Info,
} from 'lucide-react';

interface GroupWithDetails extends Group {
  members?: (GroupMember & { user?: User })[];
}

const LEVEL_OPTIONS: AcademicLevel[] = ['100', '200', '300', '400'];

export default function GroupsPage() {
  const { groups: storeGroups, students: storeStudents, isSyncing, syncAll, error: syncError, fetchGroups, refreshAnalytics } = useAdminDataStore();
  const { profile, permissions } = useAuthStore();

  // Moderators only see the group they are assigned to moderate
  const isModerator = profile?.role === 'moderator';
  const assignedLevel = isModerator ? (permissions?.assigned_level || null) : null;

  // ── UI state ──────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'level' | 'department'>('all');
  const [selectedGroup, setSelectedGroup] = useState<GroupWithDetails | null>(null);
  const [activeModal, setActiveModal] = useState<
    'members' | 'addMember' | 'assignModerator' | 'create' | 'edit' | 'confirmDelete' | null
  >(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [groupFormError, setGroupFormError] = useState<string | null>(null);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [addMemberLevelFilter, setAddMemberLevelFilter] = useState<AcademicLevel | 'all'>('all');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [groupToDelete, setGroupToDelete] = useState<GroupWithDetails | null>(null);

  // ── Form state ────────────────────────────────────────────────────────────
  const [createForm, setCreateForm] = useState({
    name: '', description: '', group_type: 'department' as 'level' | 'department',
    level: '' as string, avatar_url: '', is_official: false, chat_enabled: true,
  });
  const [editForm, setEditForm] = useState<GroupWithDetails | null>(null);

  const showSuccess = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 5000);
  };

  const closeModal = () => {
    setActiveModal(null);
    setMemberSearchQuery('');
    setAddMemberLevelFilter('all');
  };

  // ── Initial load + realtime refresh ──────────────────────────────────────
  useEffect(() => {
    fetchGroups();
    // Re-fetch on realtime changes via store subscription (already wired globally)
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Filtered groups ───────────────────────────────────────────────────────
  const filteredGroups = useMemo(() => {
    return storeGroups.filter(g => {
      // Moderators only see the group they are assigned to moderate
      if (isModerator) {
        if (assignedLevel) {
          // Show only the level group matching their assigned level
          return g.group_type === 'level' && g.level === assignedLevel;
        }
        // If no assigned level, show only groups where they are the moderator
        return g.moderator_id === profile?.id;
      }
      if (typeFilter !== 'all' && g.group_type !== typeFilter) return false;
      if (searchQuery && !g.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    });
  }, [storeGroups, isModerator, assignedLevel, profile?.id, typeFilter, searchQuery]);

  // ── Open members modal — fetch fresh members ──────────────────────────────
  const openMembersModal = async (group: GroupWithDetails) => {
    try {
      const { data, error } = await supabase
        .from('group_members')
        .select('*, user:fk_group_members_user(id, full_name, email, avatar_url, level, role, status)')
        .eq('group_id', group.id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setSelectedGroup({ ...group, members: data || [] });
      setActiveModal('members');
    } catch (err: unknown) {
      setMemberError((err as any)?.message || 'Failed to load members.');
      setSelectedGroup({ ...group, members: [] });
      setActiveModal('members');
    }
  };

  // ── Refresh members in place ──────────────────────────────────────────────
  const refreshMembers = async (groupId: string) => {
    const { data } = await supabase
      .from('group_members')
      .select('*, user:fk_group_members_user(id, full_name, email, avatar_url, level, role, status)')
      .eq('group_id', groupId)
      .order('created_at', { ascending: true });
    if (data && selectedGroup) {
      setSelectedGroup(prev => prev ? { ...prev, members: data } : prev);
    }
  };

  // ── Add single member ─────────────────────────────────────────────────────
  const handleAddMember = async (userId: string) => {
    if (!selectedGroup) return;
    setIsSubmitting(true);
    setMemberError(null);
    try {
      const { error } = await supabase.from('group_members').upsert(
        { group_id: selectedGroup.id, user_id: userId, role: 'member' },
        { onConflict: 'group_id,user_id', ignoreDuplicates: true }
      );
      if (error) throw error;
      await refreshMembers(selectedGroup.id);
      refreshAnalytics();
    } catch (err: unknown) {
      setMemberError((err as any)?.message || 'Failed to add member.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Remove member ─────────────────────────────────────────────────────────
  const handleRemoveMember = async (memberId: string) => {
    if (!selectedGroup) return;
    try {
      const { error } = await supabase.from('group_members').delete().eq('id', memberId);
      if (error) throw error;
      await refreshMembers(selectedGroup.id);
      refreshAnalytics();
      showSuccess('Member removed.');
    } catch (err: unknown) {
      setMemberError((err as any)?.message || 'Failed to remove member.');
    }
  };

  // ── Assign moderator ──────────────────────────────────────────────────────
  const handleAssignModerator = async (userId: string) => {
    if (!selectedGroup) return;
    setIsSubmitting(true);
    try {
      const { error: gErr } = await supabase.from('groups').update({ moderator_id: userId }).eq('id', selectedGroup.id);
      if (gErr) throw gErr;

      await supabase.from('group_members').upsert(
        { group_id: selectedGroup.id, user_id: userId, role: 'moderator' },
        { onConflict: 'group_id,user_id' }
      );
      // Promote user to moderator role if they're a student
      await supabase.from('users').update({ role: 'moderator', updated_at: new Date().toISOString() }).eq('id', userId).eq('role', 'student');
      // Create default permissions — ignoreDuplicates so existing permissions are preserved
      await supabase.from('moderator_permissions').upsert(
        { user_id: userId, can_manage_announcements: true, can_manage_materials: true,
          can_manage_lecturers: false, can_manage_executives: false, can_manage_students: false },
        { onConflict: 'user_id', ignoreDuplicates: true }
      );

      // Audit log
      await supabase.from('activity_logs').insert({
        user_id: profile?.id,
        action: 'group.assign_moderator',
        entity_id: selectedGroup.id,
        entity_type: 'group',
        description: `Assigned moderator to group "${selectedGroup.name}"`,
        metadata: { group_id: selectedGroup.id, assigned_user_id: userId },
      });

      // Update local state immediately — don't wait for full sync
      const assignedUser = (storeStudents as User[]).find(s => s.id === userId);
      setSelectedGroup(prev => prev ? {
        ...prev,
        moderator_id: userId,
        moderator: assignedUser ?? (prev.moderator as User | null | undefined),
      } as GroupWithDetails : prev);

      closeModal();
      refreshAnalytics();
      showSuccess(`${assignedUser?.full_name || 'User'} assigned as moderator. They now have moderator access.`);
    } catch (err: unknown) {
      setGroupFormError((err as any)?.message || 'Failed to assign moderator.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Remove moderator ──────────────────────────────────────────────────────
  const handleRemoveModerator = async () => {
    if (!selectedGroup?.moderator_id) return;
    setIsSubmitting(true);
    try {
      const removedUserId = selectedGroup.moderator_id;
      const { error } = await supabase.from('groups').update({ moderator_id: null }).eq('id', selectedGroup.id);
      if (error) throw error;

      // Reset their group_members role back to member
      await supabase.from('group_members')
        .update({ role: 'member' })
        .eq('group_id', selectedGroup.id)
        .eq('user_id', removedUserId);

      // Check if they moderate any other group — if not, demote to student
      const { data: otherGroups } = await supabase
        .from('groups')
        .select('id')
        .eq('moderator_id', removedUserId)
        .neq('id', selectedGroup.id);

      if (!otherGroups || otherGroups.length === 0) {
        await supabase.from('users').update({ role: 'student', updated_at: new Date().toISOString() }).eq('id', removedUserId).eq('role', 'moderator');
        await supabase.from('moderator_permissions').delete().eq('user_id', removedUserId);
      }

      // Audit log
      await supabase.from('activity_logs').insert({
        user_id: profile?.id,
        action: 'group.remove_moderator',
        entity_id: selectedGroup.id,
        entity_type: 'group',
        description: `Removed moderator from group "${selectedGroup.name}"`,
        metadata: { group_id: selectedGroup.id, removed_user_id: removedUserId },
      });

      // Update local state immediately
      setSelectedGroup(prev => prev ? { ...prev, moderator: null, moderator_id: null } : prev);
      refreshAnalytics();
      showSuccess('Moderator removed. User demoted to student.');
    } catch (err: unknown) {
      setGroupFormError((err as any)?.message || 'Failed to remove moderator.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Create group ──────────────────────────────────────────────────────────
  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.name.trim()) return;
    setIsSubmitting(true);
    try {
      const { data, error } = await supabase.from('groups').insert({
        name: createForm.name.trim(),
        description: createForm.description || null,
        group_type: createForm.group_type,
        level: createForm.group_type === 'level' ? createForm.level || null : null,
        avatar_url: createForm.avatar_url || null,
        is_official: createForm.is_official,
        chat_enabled: createForm.chat_enabled,
        created_by: profile?.id,
        is_active: true,
      }).select().single();
      if (error) throw error;

      // Add to store immediately
      if (data) useAdminDataStore.getState().fetchGroups();

      if (createForm.group_type === 'level' && createForm.level && data) {
        const targets = storeStudents.filter(
          (s: User) => s.level === createForm.level && s.status === 'active' && s.role !== 'super_admin'
        );
        if (targets.length > 0) {
          const rows = targets.map(s => ({ group_id: data.id, user_id: s.id, role: 'member' }));
          await supabase.from('group_members').upsert(rows, { onConflict: 'group_id,user_id', ignoreDuplicates: true });
        }
      }

      closeModal();
      setCreateForm({ name: '', description: '', group_type: 'department', level: '', avatar_url: '', is_official: false, chat_enabled: true });
      showSuccess(`Group "${createForm.name}" created successfully.`);
    } catch (err: unknown) {
      setGroupFormError((err as any)?.message || 'Failed to create group. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Update group ──────────────────────────────────────────────────────────
  const handleUpdateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editForm) return;
    setIsSubmitting(true);
    try {
      const updateData = {
        name: editForm.name.trim(),
        description: editForm.description || null,
        group_type: editForm.group_type,
        level: editForm.group_type === 'level' ? editForm.level : null,
        avatar_url: editForm.avatar_url || null,
        is_official: editForm.is_official,
        chat_enabled: editForm.chat_enabled,
        updated_at: new Date().toISOString(),
      };
      const { data: updated, error } = await supabase.from('groups').update(updateData).eq('id', editForm.id).select().single();
      if (error) throw error;
      if (updated) useAdminDataStore.getState().updateGroup(updated as any);
      closeModal();
      setEditForm(null);
      showSuccess('Group updated successfully.');
    } catch (err: unknown) {
      setGroupFormError((err as any)?.message || 'Failed to update group. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Delete group ──────────────────────────────────────────────────────────
  const handleDeleteGroup = async () => {
    if (!groupToDelete) return;
    setIsSubmitting(true);
    try {
      const { error } = await supabase.from('groups').delete().eq('id', groupToDelete.id);
      if (error) throw error;
      setGroupToDelete(null);
      setActiveModal(null);
      refreshAnalytics();
      showSuccess(`Group "${groupToDelete.name}" deleted.`);
    } catch (err: unknown) {
      setGroupFormError((err as any)?.message || 'Failed to delete group.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Toggle chat ───────────────────────────────────────────────────────────
  const handleToggleChat = async (group: GroupWithDetails) => {
    const newVal = !group.chat_enabled;
    // Optimistic update
    useAdminDataStore.getState().updateGroup({ ...group, chat_enabled: newVal } as any);
    try {
      const { error } = await supabase.from('groups').update({ chat_enabled: newVal }).eq('id', group.id);
      if (error) throw error;
      showSuccess(`Chat ${newVal ? 'enabled' : 'disabled'} for "${group.name}".`);
    } catch (err: unknown) {
      // Revert
      useAdminDataStore.getState().updateGroup(group as any);
      setGroupFormError('Failed to toggle chat: ' + ((err as any)?.message || 'Unknown error'));
    }
  };

  // ── Clear chat history ────────────────────────────────────────────────────
  const handleClearHistory = async (group: GroupWithDetails) => {
    if (!window.confirm(`Delete ALL message history for "${group.name}"? This cannot be undone.`)) return;
    try {
      const { error } = await supabase.from('messages').delete().eq('group_id', group.id);
      if (error) throw error;
      showSuccess('Chat history cleared.');
    } catch (err: unknown) {
      showSuccess('Failed to clear history: ' + ((err as Error)?.message || 'Unknown error'));
    }
  };

  // ── Level progression ─────────────────────────────────────────────────────
  const handleLevelProgression = async () => {
    const level400Students = (storeStudents as User[]).filter(
      s => s.level === '400' && s.status === 'active'
    );

    if (!window.confirm(
      `Run full academic year level progression?\n\n` +
      `This will:\n` +
      `• Auto-graduate ${level400Students.length} Level 400 student(s) — accounts deactivated immediately, moved to Alumni\n` +
      `• All Level 400 moderators will be demoted and their permissions removed\n` +
      `• Delete the current Level 400 group\n` +
      `• Promote all other active students one level (100→200, 200→300, 300→400)\n` +
      `• Rename remaining groups to match new levels\n\n` +
      `Level 400 students will lose access to the platform immediately and permanently.\n\n` +
      `This cannot be undone. Continue?`
    )) return;
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const currentAdmin = (await supabase.auth.getUser()).data.user;

      // Step 1: Graduate all active Level 400 students
      // status='graduated' triggers realtime kick-out on mobile immediately
      await supabase
        .from('users')
        .update({ status: 'graduated', updated_at: new Date().toISOString() })
        .eq('level', '400')
        .eq('status', 'active');

      // Step 2: Strip moderator role from any Level 400 moderators
      const { data: level400Mods } = await supabase
        .from('users')
        .select('id')
        .eq('level', '400')
        .eq('status', 'graduated')
        .eq('role', 'moderator');

      if (level400Mods && level400Mods.length > 0) {
        const modIds = level400Mods.map((m: any) => m.id);
        await supabase.from('moderator_permissions').delete().in('user_id', modIds);
        await supabase.from('users').update({ role: 'student', updated_at: new Date().toISOString() }).in('id', modIds);
      }

      // Step 3: Remove Level 400 students from all group memberships
      const { data: level400Users } = await supabase
        .from('users')
        .select('id, full_name, registration_number, email, phone, avatar_url')
        .eq('level', '400')
        .eq('status', 'graduated');

      if (level400Users && level400Users.length > 0) {
        const userIds = level400Users.map((u: any) => u.id);
        await supabase.from('group_members').delete().in('user_id', userIds);

        // Step 4: Create alumni records (skip duplicates)
        const currentYear = new Date().getFullYear();
        const alumniRows = level400Users.map((u: any) => ({
          user_id: u.id,
          full_name: u.full_name,
          registration_number: u.registration_number,
          email: u.email,
          phone: u.phone || null,
          graduation_year: currentYear,
          avatar_url: u.avatar_url || null,
          is_private: true,
        }));
        await supabase.from('graduates').upsert(alumniRows, { onConflict: 'user_id', ignoreDuplicates: true });
      }

      // Step 5: Audit log
      await supabase.from('activity_logs').insert({
        user_id: currentAdmin?.id,
        action: 'level_progression',
        entity_type: 'system',
        description: `Academic level progression run. ${level400Students.length} Level 400 student(s) graduated. All other students promoted one level.`,
        metadata: { graduated_count: level400Students.length },
      });

      // Step 6: Delete the current Level 400 official group
      await supabase
        .from('groups')
        .delete()
        .eq('group_type', 'level')
        .eq('level', '400')
        .eq('is_official', true)
        .eq('is_active', true);

      // Step 7: Rename official level groups — descending order prevents conflicts
      const groupRenames: Array<{ fromLevel: string; toLevel: string; toName: string }> = [
        { fromLevel: '300', toLevel: '400', toName: 'Level 400 Hub' },
        { fromLevel: '200', toLevel: '300', toName: 'Level 300 Hub' },
        { fromLevel: '100', toLevel: '200', toName: 'Level 200 Hub' },
      ];
      for (const { fromLevel, toLevel, toName } of groupRenames) {
        await supabase
          .from('groups')
          .update({ name: toName, level: toLevel, updated_at: new Date().toISOString() })
          .eq('group_type', 'level')
          .eq('level', fromLevel)
          .eq('is_official', true)
          .eq('is_active', true);
      }

      // Step 8: Promote remaining active students — descending prevents double-promotion
      const levelMap: Array<[string, string]> = [['300', '400'], ['200', '300'], ['100', '200']];
      for (const [from, to] of levelMap) {
        await supabase.from('users').update({ level: to, updated_at: new Date().toISOString() }).eq('level', from).eq('status', 'active');
      }

      await fetchGroups();
      refreshAnalytics();
      showSuccess(
        `Level progression complete. ${level400Students.length} Level 400 student(s) graduated and moved to Alumni. All other students promoted one level.`
      );
    } catch (err: unknown) {
      setGroupFormError('Level progression failed: ' + ((err as any)?.message || 'Unknown error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Derived: students not yet in selected group ───────────────────────────
  const memberIds = useMemo(
    () => new Set((selectedGroup?.members || []).map(m => m.user_id)),
    [selectedGroup?.members]
  );

  const availableStudents = useMemo(() => {
    return (storeStudents as User[]).filter(s => {
      if (s.role === 'super_admin') return false;
      if (s.status !== 'active') return false;
      // Only show students NOT already in the group
      if (memberIds.has(s.id)) return false;
      // Moderators can only add students from their assigned level
      if (isModerator && assignedLevel && s.level !== assignedLevel) return false;
      if (!isModerator && addMemberLevelFilter !== 'all' && s.level !== addMemberLevelFilter) return false;
      if (memberSearchQuery) {
        const q = memberSearchQuery.toLowerCase();
        const matchesName = s.full_name.toLowerCase().includes(q);
        const matchesEmail = s.email.toLowerCase().includes(q);
        const matchesMatric = (s as any).registration_number?.toLowerCase().includes(q);
        if (!matchesName && !matchesEmail && !matchesMatric) return false;
      }
      return true;
    });
  }, [storeStudents, isModerator, assignedLevel, addMemberLevelFilter, memberSearchQuery, memberIds]);

  const eligibleModerators = useMemo(() => {
    return (storeStudents as User[]).filter(s => {
      if (s.role === 'super_admin') return false;
      if (s.status !== 'active') return false;
      if (selectedGroup?.group_type === 'level' && selectedGroup.level) {
        return s.level === selectedGroup.level;
      }
      return true;
    });
  }, [storeStudents, selectedGroup]);

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total: storeGroups.length,
    level: storeGroups.filter(g => g.group_type === 'level').length,
    department: storeGroups.filter(g => g.group_type === 'department').length,
    withModerator: storeGroups.filter(g => g.moderator_id).length,
  }), [storeGroups]);

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-12 animate-in fade-in duration-500">

      {/* Success toast */}
      {successMessage && (
        <div className="fixed bottom-10 right-10 z-[200] bg-primary-950 border border-primary-800 text-white px-8 py-5 rounded-[2rem] shadow-2xl flex items-center gap-5 animate-in slide-in-from-bottom-8 duration-400">
          <CheckCircle2 className="w-6 h-6 text-green-400 shrink-0" />
          <div>
            <p className="text-[10px] font-black tracking-[0.25em] text-primary-400 uppercase">Success</p>
            <p className="text-sm font-bold">{successMessage}</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 bg-white p-8 rounded-3xl border border-gray-100 shadow-sm">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-1.5 h-8 bg-primary-950 rounded-full" />
            <h1 className="text-3xl font-black text-gray-900 tracking-tight uppercase">Groups Manager</h1>
          </div>
          <p className="text-gray-500 font-medium">Create groups, manage members, assign moderators, and control access.</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {!isModerator && (
            <button
              onClick={handleLevelProgression}
              disabled={isSubmitting}
              className="flex items-center gap-2 px-5 py-3 bg-amber-50 text-amber-700 border border-amber-200 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-amber-100 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isSubmitting ? 'animate-spin' : ''}`} />
              Level Progression
            </button>
          )}
          <button
            onClick={() => setActiveModal('create')}
            className="flex items-center gap-2 px-6 py-3 bg-primary-950 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-primary-800 transition-all shadow-xl shadow-primary-950/20"
          >
            <Plus className="w-4 h-4" />
            Create Group
          </button>
        </div>
      </div>

      {/* Stats — hidden for moderators */}
      {!isModerator && (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Groups', value: stats.total, color: 'border-b-primary-950', icon: Layers },
          { label: 'Level Groups', value: stats.level, color: 'border-b-blue-500', icon: GraduationCap },
          { label: 'Dept / Custom', value: stats.department, color: 'border-b-green-500', icon: Building },
          { label: 'With Moderator', value: stats.withModerator, color: 'border-b-amber-500', icon: Crown },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className={`bg-white p-6 rounded-2xl border border-gray-100 shadow-sm border-b-4 ${color}`}>
            <div className="flex items-center justify-between mb-3">
              <Icon className="w-5 h-5 text-gray-400" />
              <span className="text-2xl font-black text-gray-900">{value}</span>
            </div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">{label}</p>
          </div>
        ))}
      </div>
      )}

      {/* Filters — hidden for moderators since they only see their assigned group */}
      {!isModerator && (
      <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col md:flex-row gap-4 items-center">
        <div className="flex gap-2">
          {(['all', 'level', 'department'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                typeFilter === t ? 'bg-primary-950 text-white shadow-lg' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'
              }`}
            >
              {t === 'all' ? 'All' : t === 'level' ? 'Level Groups' : 'Dept / Custom'}
            </button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
          <input
            type="text"
            placeholder="Search groups..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-11 pr-4 py-3 bg-gray-50 border-none rounded-xl text-sm font-semibold focus:ring-2 focus:ring-primary-950 shadow-inner"
          />
        </div>
      </div>
      )}

      {/* Groups grid */}
      {isSyncing && storeGroups.length === 0 ? (
        <div className="flex items-center justify-center h-64"><LoadingSpinner size="lg" /></div>
      ) : syncError ? (
        <ErrorState onRetry={syncAll} message={syncError} />
      ) : filteredGroups.length === 0 ? (
        <div className="bg-white rounded-3xl p-20 text-center border-2 border-dashed border-gray-100">
          <Users className="w-14 h-14 text-gray-200 mx-auto mb-4" />
          <h3 className="text-lg font-black text-gray-900">No groups found</h3>
          <p className="text-gray-400 text-sm mt-1">Create a group to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredGroups.map(group => (
            <div key={group.id} className="bg-white rounded-3xl border border-gray-100 shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden group">
              {/* Avatar banner */}
              <div className={`h-2 w-full ${group.group_type === 'level' ? 'bg-blue-500' : 'bg-emerald-500'}`} />
              <div className="p-6">
                <div className="flex items-start gap-4 mb-4">
                  <div className="relative shrink-0">
                    <div className="w-14 h-14 rounded-2xl bg-gray-100 overflow-hidden border-2 border-white shadow-md flex items-center justify-center">
                      {group.avatar_url ? (
                        <img src={group.avatar_url} alt="" className="w-full h-full object-cover" />
                      ) : group.group_type === 'level' ? (
                        <GraduationCap className="w-7 h-7 text-blue-400" />
                      ) : (
                        <Building className="w-7 h-7 text-emerald-400" />
                      )}
                    </div>
                    {group.is_official && (
                      <div className="absolute -top-1 -right-1 w-5 h-5 bg-amber-400 rounded-full flex items-center justify-center border-2 border-white">
                        <Shield className="w-2.5 h-2.5 text-white" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-black text-gray-900 truncate">{group.name}</h3>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-widest ${
                        group.group_type === 'level' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {group.group_type === 'level' ? `Level ${group.level}` : 'Custom'}
                      </span>
                      {!group.chat_enabled && (
                        <span className="px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-widest bg-red-100 text-red-600">
                          Chat Off
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {!isModerator && (
                      <button
                        onClick={() => { setEditForm({ ...group }); setActiveModal('edit'); }}
                        className="p-2 text-gray-400 hover:text-primary-950 hover:bg-primary-50 rounded-xl transition-all"
                        title="Edit"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    )}
                    {!isModerator && (
                      <button
                        onClick={() => { setGroupToDelete(group); setActiveModal('confirmDelete'); }}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>                </div>

                {group.description && (
                  <p className="text-xs text-gray-500 line-clamp-2 mb-4">{group.description}</p>
                )}

                <div className="flex items-center justify-between text-xs font-bold text-gray-400 mb-4">
                  <span className="flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5" />
                    {group.member_count ?? 0} members
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Crown className="w-3.5 h-3.5 text-amber-400" />
                    {group.moderator ? group.moderator.full_name : 'No moderator'}
                  </span>
                </div>

                {/* Action buttons */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => openMembersModal(group)}
                    className="flex items-center justify-center gap-1.5 py-2.5 bg-gray-50 hover:bg-primary-50 hover:text-primary-950 text-gray-600 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                  >
                    <Users className="w-3.5 h-3.5" /> Members
                  </button>
                  {!isModerator && (
                    <button
                      onClick={() => { setSelectedGroup(group); setActiveModal('assignModerator'); }}
                      className="flex items-center justify-center gap-1.5 py-2.5 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                    >
                      <Crown className="w-3.5 h-3.5" /> Moderator
                    </button>
                  )}
                  {!isModerator && (
                    <button
                      onClick={() => handleToggleChat(group)}
                      className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                        group.chat_enabled
                          ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700'
                          : 'bg-red-50 hover:bg-red-100 text-red-600'
                      }`}
                    >
                      {group.chat_enabled ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
                      {group.chat_enabled ? 'Chat On' : 'Chat Off'}
                    </button>
                  )}
                  {!isModerator && (
                    <button
                      onClick={() => handleClearHistory(group)}
                      className="flex items-center justify-center gap-1.5 py-2.5 bg-gray-50 hover:bg-red-50 hover:text-red-600 text-gray-400 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                    >
                      <MessageSquare className="w-3.5 h-3.5" /> Clear Chat
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── MEMBERS MODAL ─────────────────────────────────────────────────── */}
      {activeModal === 'members' && selectedGroup && (
        <div className="fixed inset-0 bg-primary-950/40 backdrop-blur-md flex items-center justify-center z-[100] p-4 animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-300">
            <div className="px-8 py-6 border-b border-gray-100 flex items-center justify-between bg-gray-50">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-gray-100 overflow-hidden flex items-center justify-center">
                  {selectedGroup.avatar_url
                    ? <img src={selectedGroup.avatar_url} alt="" className="w-full h-full object-cover" />
                    : <Users className="w-6 h-6 text-gray-400" />}
                </div>
                <div>
                  <h2 className="text-xl font-black text-gray-900">{selectedGroup.name}</h2>
                  <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">
                    {selectedGroup.members?.length ?? 0} members
                  </p>
                </div>
              </div>
              <button onClick={closeModal} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-all">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Actions bar — just Add Individual */}
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-end">
              <button
                onClick={() => setActiveModal('addMember')}
                className="flex items-center gap-1.5 px-4 py-2 bg-primary-950 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-primary-800 transition-all"
              >
                <UserPlus className="w-3.5 h-3.5" /> Add Member
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {memberError && (
                <div className="flex items-center gap-3 p-3 bg-red-50 border border-red-100 rounded-xl mb-2">
                  <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                  <p className="text-xs font-bold text-red-700">{memberError}</p>
                  <button onClick={() => setMemberError(null)} className="ml-auto text-red-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></button>
                </div>
              )}
              {!selectedGroup.members || selectedGroup.members.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <Users className="w-12 h-12 mx-auto mb-3 text-gray-200" />
                  <p className="font-bold text-sm">No members yet</p>
                  <p className="text-xs mt-1">Use the bulk add buttons above to add students.</p>
                </div>
              ) : (
                selectedGroup.members.map(member => (
                  <div key={member.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-2xl hover:bg-gray-100 transition-all">
                    <div className="w-10 h-10 rounded-xl bg-gray-200 overflow-hidden flex items-center justify-center shrink-0">
                      {member.user?.avatar_url
                        ? <img src={member.user.avatar_url} alt="" className="w-full h-full object-cover" />
                        : <span className="text-sm font-black text-gray-500">
                            {member.user?.full_name?.charAt(0).toUpperCase()}
                          </span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-black text-sm text-gray-900 truncate">{member.user?.full_name}</p>
                      <p className="text-[10px] text-gray-400 truncate">{member.user?.email}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {member.user?.level && (
                        <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded-lg text-[9px] font-black uppercase">
                          L{member.user.level}
                        </span>
                      )}
                      {member.role === 'moderator' && (
                        <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-lg text-[9px] font-black uppercase flex items-center gap-1">
                          <Crown className="w-2.5 h-2.5" /> Mod
                        </span>
                      )}
                      <button
                        onClick={() => handleRemoveMember(member.id)}
                        className="p-1.5 text-gray-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                        title="Remove from group"
                      >
                        <UserMinus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── ADD INDIVIDUAL MEMBER MODAL ───────────────────────────────────── */}
      {activeModal === 'addMember' && selectedGroup && (
        <div className="fixed inset-0 bg-primary-950/40 backdrop-blur-md flex items-center justify-center z-[110] p-4 animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-300">
            <div className="px-8 py-6 border-b border-gray-100 flex items-center justify-between bg-gray-50">
              <div>
                <h2 className="text-xl font-black text-gray-900">Add Member</h2>
                <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mt-0.5">{selectedGroup.name}</p>
              </div>
              <button onClick={() => setActiveModal('members')} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-all">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-4 border-b border-gray-100 space-y-3">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
                <input
                  type="text"
                  placeholder="Search by name, email or matric no..."
                  value={memberSearchQuery}
                  onChange={e => setMemberSearchQuery(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 bg-gray-50 border-none rounded-xl text-sm font-semibold focus:ring-2 focus:ring-primary-950 shadow-inner"
                />
              </div>
              <div className="flex gap-2 flex-wrap">
                {!isModerator && (
                  <button
                    onClick={() => setAddMemberLevelFilter('all')}
                    className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${addMemberLevelFilter === 'all' ? 'bg-primary-950 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                  >
                    All Levels
                  </button>
                )}
                {!isModerator && LEVEL_OPTIONS.map(lvl => (
                  <button
                    key={lvl}
                    onClick={() => setAddMemberLevelFilter(lvl)}
                    className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${addMemberLevelFilter === lvl ? 'bg-primary-950 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                  >
                    Level {lvl}
                  </button>
                ))}
                {isModerator && assignedLevel && (
                  <span className="px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest bg-primary-950 text-white">
                    Level {assignedLevel} Students Only
                  </span>
                )}
              </div>
              <p className="text-[10px] font-bold text-gray-400 px-1">
                {availableStudents.length} student{availableStudents.length !== 1 ? 's' : ''} not yet in this group
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {availableStudents.length === 0 ? (
                <div className="text-center py-10 text-gray-400">
                  <Users className="w-10 h-10 mx-auto mb-2 text-gray-200" />
                  <p className="text-sm font-bold">
                    {memberSearchQuery || addMemberLevelFilter !== 'all'
                      ? 'No students match your search'
                      : 'All registered students are already members'}
                  </p>
                </div>
              ) : (
                availableStudents.slice(0, 100).map(student => {
                  return (
                    <button
                      key={student.id}
                      onClick={() => handleAddMember(student.id)}
                      disabled={isSubmitting}
                      className="w-full flex items-center gap-3 p-3 rounded-2xl transition-all text-left hover:bg-primary-50 hover:text-primary-950 disabled:opacity-50"
                    >
                      <div className="w-9 h-9 rounded-xl bg-gray-100 overflow-hidden flex items-center justify-center shrink-0">
                        {student.avatar_url
                          ? <img src={student.avatar_url} alt="" className="w-full h-full object-cover" />
                          : <span className="text-xs font-black text-gray-500">{student.full_name.charAt(0).toUpperCase()}</span>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-black text-sm text-gray-900 truncate">{student.full_name}</p>
                        <p className="text-[10px] text-gray-400 truncate">
                          {(student as any).registration_number || student.email}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {student.level && (
                          <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded-lg text-[9px] font-black">L{student.level}</span>
                        )}
                        <UserPlus className="w-4 h-4 text-primary-400" />
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── ASSIGN MODERATOR MODAL ────────────────────────────────────────── */}
      {activeModal === 'assignModerator' && selectedGroup && (
        <div className="fixed inset-0 bg-primary-950/40 backdrop-blur-md flex items-center justify-center z-[100] p-4 animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-300">
            <div className="px-8 py-6 border-b border-gray-100 flex items-center justify-between bg-gray-50">
              <div>
                <h2 className="text-xl font-black text-gray-900">Assign Moderator</h2>
                <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mt-0.5">{selectedGroup.name}</p>
              </div>
              <button onClick={closeModal} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-all">
                <X className="w-5 h-5" />
              </button>
            </div>

            {selectedGroup.moderator && (
              <div className="px-6 py-4 bg-amber-50 border-b border-amber-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Crown className="w-4 h-4 text-amber-500" />
                  <div>
                    <p className="text-xs font-black text-amber-700 uppercase tracking-widest">Current Moderator</p>
                    <p className="text-sm font-bold text-gray-900">{selectedGroup.moderator.full_name}</p>
                  </div>
                </div>
                <button
                  onClick={handleRemoveModerator}
                  disabled={isSubmitting}
                  className="px-3 py-1.5 bg-red-50 text-red-600 border border-red-100 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-red-100 transition-all disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-3 py-2">
                {selectedGroup.group_type === 'level'
                  ? `Select a Level ${selectedGroup.level} student`
                  : 'Select any active student'}
              </p>
              {eligibleModerators.length === 0 ? (
                <div className="text-center py-10 text-gray-400">
                  <Users className="w-10 h-10 mx-auto mb-2 text-gray-200" />
                  <p className="text-sm font-bold">No eligible students</p>
                </div>
              ) : (
                eligibleModerators.map(student => (
                  <button
                    key={student.id}
                    onClick={() => handleAssignModerator(student.id)}
                    disabled={isSubmitting}
                    className="w-full flex items-center gap-3 p-3 rounded-2xl hover:bg-amber-50 transition-all text-left disabled:opacity-50"
                  >
                    <div className="w-9 h-9 rounded-xl bg-gray-100 overflow-hidden flex items-center justify-center shrink-0">
                      {student.avatar_url
                        ? <img src={student.avatar_url} alt="" className="w-full h-full object-cover" />
                        : <span className="text-xs font-black text-gray-500">{student.full_name.charAt(0).toUpperCase()}</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-black text-sm text-gray-900 truncate">{student.full_name}</p>
                      <p className="text-[10px] text-gray-400 truncate">{student.email}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {student.role === 'moderator' && (
                        <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-lg text-[9px] font-black">Mod</span>
                      )}
                      <ChevronRight className="w-4 h-4 text-gray-300" />
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── CREATE GROUP MODAL ────────────────────────────────────────────── */}
      {activeModal === 'create' && (
        <div className="fixed inset-0 bg-primary-950/40 backdrop-blur-md flex items-center justify-center z-[100] p-4 animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="px-8 py-6 border-b border-gray-100 flex items-center justify-between bg-gray-50">
              <h2 className="text-xl font-black text-gray-900">Create New Group</h2>
              <button onClick={closeModal} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-all">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateGroup} className="p-8 space-y-5 max-h-[75vh] overflow-y-auto">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Group Name *</label>
                <input
                  type="text" required
                  value={createForm.name}
                  onChange={e => setCreateForm({ ...createForm, name: e.target.value })}
                  className="w-full px-5 py-3.5 bg-gray-50 border-none rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary-950 shadow-inner"
                  placeholder="e.g. Chess Club, Study Group..."
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Description</label>
                <textarea
                  value={createForm.description}
                  onChange={e => setCreateForm({ ...createForm, description: e.target.value })}
                  rows={2}
                  className="w-full px-5 py-3.5 bg-gray-50 border-none rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary-950 shadow-inner resize-none"
                  placeholder="What is this group about?"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Group Type *</label>
                  <select
                    value={createForm.group_type}
                    onChange={e => setCreateForm({ ...createForm, group_type: e.target.value as 'level' | 'department', level: '' })}
                    disabled={isModerator}
                    className="w-full px-5 py-3.5 bg-gray-50 border-none rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary-950 shadow-inner appearance-none disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <option value="department">Custom / Department</option>
                    {!isModerator && <option value="level">Academic Level</option>}
                  </select>
                  {isModerator && (
                    <p className="text-[10px] text-amber-600 font-bold ml-1">Moderators can only create custom groups</p>
                  )}
                </div>
                {createForm.group_type === 'level' && !isModerator && (
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Level *</label>
                    <select
                      required
                      value={createForm.level}
                      onChange={e => setCreateForm({ ...createForm, level: e.target.value })}
                      className="w-full px-5 py-3.5 bg-gray-50 border-none rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary-950 shadow-inner appearance-none"
                    >
                      <option value="">Select Level</option>
                      {LEVEL_OPTIONS.map(l => <option key={l} value={l}>Level {l}</option>)}
                    </select>
                  </div>
                )}
              </div>

              {/* Group DP */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                  <ImageIcon className="w-3.5 h-3.5" /> Group Photo (DP)
                </label>
                <FileUpload
                  accept="image/*"
                  isImage
                  folder="groups"
                  label="Upload group photo"
                  description="Square image recommended"
                  onUploadComplete={url => setCreateForm({ ...createForm, avatar_url: url })}
                  currentFileUrl={createForm.avatar_url}
                />
              </div>

              {/* Toggles */}
              <div className="flex gap-4 flex-wrap">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={createForm.is_official}
                    onChange={e => setCreateForm({ ...createForm, is_official: e.target.checked })}
                    className="w-4 h-4 rounded text-primary-950 focus:ring-primary-950"
                  />
                  <span className="text-xs font-black text-gray-600 uppercase tracking-widest">Official Group</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={createForm.chat_enabled}
                    onChange={e => setCreateForm({ ...createForm, chat_enabled: e.target.checked })}
                    className="w-4 h-4 rounded text-primary-950 focus:ring-primary-950"
                  />
                  <span className="text-xs font-black text-gray-600 uppercase tracking-widest">Enable Chat</span>
                </label>
              </div>

              {createForm.group_type === 'level' && createForm.level && (
                <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-100 rounded-2xl text-blue-700 text-xs font-semibold">
                  <Info className="w-4 h-4 shrink-0 mt-0.5" />
                  All active Level {createForm.level} students will be automatically added to this group.
                </div>
              )}

              <div className="flex flex-col gap-3 pt-2">
                {groupFormError && activeModal === 'create' && (
                  <div className="flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-100 rounded-xl">
                    <p className="text-sm font-medium text-red-700">{groupFormError}</p>
                  </div>
                )}
                <div className="flex gap-3">
                <button type="button" onClick={closeModal} className="flex-1 py-4 bg-gray-50 text-gray-400 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-gray-100 transition-all">
                  Cancel
                </button>
                <button type="submit" disabled={isSubmitting} className="flex-[2] py-4 bg-primary-950 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-primary-800 disabled:opacity-50 transition-all shadow-xl">
                  {isSubmitting ? 'Creating...' : 'Create Group'}
                </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── EDIT GROUP MODAL ──────────────────────────────────────────────── */}
      {activeModal === 'edit' && editForm && (
        <div className="fixed inset-0 bg-primary-950/40 backdrop-blur-md flex items-center justify-center z-[100] p-4 animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="px-8 py-6 border-b border-gray-100 flex items-center justify-between bg-gray-50">
              <h2 className="text-xl font-black text-gray-900">Edit Group</h2>
              <button onClick={() => { closeModal(); setEditForm(null); }} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-all">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleUpdateGroup} className="p-8 space-y-5 max-h-[75vh] overflow-y-auto">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Group Name *</label>
                <input
                  type="text" required
                  value={editForm.name}
                  onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full px-5 py-3.5 bg-gray-50 border-none rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary-950 shadow-inner"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Description</label>
                <textarea
                  value={editForm.description || ''}
                  onChange={e => setEditForm({ ...editForm, description: e.target.value })}
                  rows={2}
                  className="w-full px-5 py-3.5 bg-gray-50 border-none rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary-950 shadow-inner resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Group Type</label>
                  <select
                    value={editForm.group_type}
                    onChange={e => setEditForm({ ...editForm, group_type: e.target.value as 'level' | 'department' })}
                    className="w-full px-5 py-3.5 bg-gray-50 border-none rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary-950 shadow-inner appearance-none"
                  >
                    <option value="department">Custom / Department</option>
                    <option value="level">Academic Level</option>
                  </select>
                </div>
                {editForm.group_type === 'level' && (
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Level</label>
                    <select
                      value={editForm.level || ''}
                      onChange={e => setEditForm({ ...editForm, level: e.target.value as AcademicLevel })}
                      className="w-full px-5 py-3.5 bg-gray-50 border-none rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary-950 shadow-inner appearance-none"
                    >
                      <option value="">Select Level</option>
                      {LEVEL_OPTIONS.map(l => <option key={l} value={l}>Level {l}</option>)}
                    </select>
                  </div>
                )}
              </div>

              {/* Group DP */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                  <ImageIcon className="w-3.5 h-3.5" /> Group Photo (DP)
                </label>
                <FileUpload
                  accept="image/*"
                  isImage
                  folder="groups"
                  label="Change group photo"
                  description="Square image recommended"
                  onUploadComplete={url => setEditForm({ ...editForm, avatar_url: url })}
                  currentFileUrl={editForm.avatar_url || ''}
                />
              </div>

              <div className="flex gap-4 flex-wrap">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editForm.is_official}
                    onChange={e => setEditForm({ ...editForm, is_official: e.target.checked })}
                    className="w-4 h-4 rounded text-primary-950 focus:ring-primary-950"
                  />
                  <span className="text-xs font-black text-gray-600 uppercase tracking-widest">Official Group</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editForm.chat_enabled}
                    onChange={e => setEditForm({ ...editForm, chat_enabled: e.target.checked })}
                    className="w-4 h-4 rounded text-primary-950 focus:ring-primary-950"
                  />
                  <span className="text-xs font-black text-gray-600 uppercase tracking-widest">Enable Chat</span>
                </label>
              </div>

              <div className="flex flex-col gap-3 pt-2">
                {groupFormError && activeModal === 'edit' && (
                  <div className="flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-100 rounded-xl">
                    <p className="text-sm font-medium text-red-700">{groupFormError}</p>
                  </div>
                )}
                <div className="flex gap-3">
                <button type="button" onClick={() => { closeModal(); setEditForm(null); }} className="flex-1 py-4 bg-gray-50 text-gray-400 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-gray-100 transition-all">
                  Cancel
                </button>
                <button type="submit" disabled={isSubmitting} className="flex-[2] py-4 bg-primary-950 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-primary-800 disabled:opacity-50 transition-all shadow-xl">
                  {isSubmitting ? 'Saving...' : 'Save Changes'}
                </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── DELETE CONFIRMATION ───────────────────────────────────────────── */}
      {activeModal === 'confirmDelete' && groupToDelete && (
        <div className="fixed inset-0 bg-red-950/40 backdrop-blur-md flex items-center justify-center z-[100] p-4 animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-sm rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-8 text-center bg-red-50">
              <div className="w-16 h-16 bg-red-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-xl shadow-red-600/20">
                <AlertTriangle className="w-8 h-8 text-white" />
              </div>
              <h2 className="text-xl font-black text-gray-900">Delete Group?</h2>
              <p className="text-sm text-gray-500 mt-2">
                <span className="font-black text-gray-900">"{groupToDelete.name}"</span> and all its memberships will be permanently deleted.
              </p>
            </div>
            <div className="p-6 flex gap-3">
              <button
                onClick={() => { setGroupToDelete(null); setActiveModal(null); }}
                className="flex-1 py-3.5 bg-gray-50 text-gray-400 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-gray-100 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteGroup}
                disabled={isSubmitting}
                className="flex-[2] py-3.5 bg-red-600 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-red-700 disabled:opacity-50 transition-all shadow-xl shadow-red-600/20"
              >
                {isSubmitting ? 'Deleting...' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
