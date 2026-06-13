import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { createClient } from '@supabase/supabase-js';
import type { User, UserRole, AccountStatus, AcademicLevel } from '../types';
import { ROLE_LABELS, STATUS_LABELS, LEVEL_LABELS } from '../types';
import {
  Users,
  Search,
  UserPlus,
  Ban,
  Eye,
  Edit,
  ChevronLeft,
  ChevronRight,
  X,

  UserCheck,
  UserX,
  GraduationCap,
  Shield,
  Activity,

  CheckCircle2,
  Clock,
  ShieldAlert,

} from 'lucide-react';

import ModeratorPermissionsModal from '../components/ModeratorPermissionsModal';
import FileUpload from '../lib/FileUpload';

import { useAdminDataStore } from '../store/adminData.store';
import { useAuthStore } from '../store/auth.store';

interface UserWithDepartment extends User {
  departments?: { name: string; code: string } | null;
}

const ITEMS_PER_PAGE = 10;

const levelOptions: AcademicLevel[] = ['100', '200', '300', '400'];
const statusOptions: AccountStatus[] = ['active', 'suspended', 'banned', 'pending_verification'];
const roleOptions: UserRole[] = ['moderator', 'moderator', 'super_admin'];

// Live countdown component for suspension expiry
function SuspensionCountdown({ until }: { until: Date }) {
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    const tick = () => {
      const diff = until.getTime() - Date.now();
      if (diff <= 0) { setTimeLeft('Expired'); return; }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeLeft(d > 0 ? `${d}d ${h}h ${m}m ${s}s` : `${h}h ${m}m ${s}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [until]);

  return (
    <p className="text-[11px] font-black text-amber-600 mt-1 font-mono tracking-tight">
      ⏱ {timeLeft} remaining
    </p>
  );
}

export default function ModeratorsPage() {

  const { students: allStudents, isSyncing, lastSync, syncAll, error, refreshAnalytics } = useAdminDataStore();
  const { profile, permissions } = useAuthStore();

  useEffect(() => {
    syncAll();
  }, [syncAll]);

  // Moderators are locked to their assigned level — they cannot see other levels
  const assignedLevel = profile?.role === 'moderator' ? (permissions?.assigned_level || null) : null;
  
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<AccountStatus | 'all'>('all');
  // Moderators start with their level pre-selected and cannot change it
  const [levelFilter, setLevelFilter] = useState<AcademicLevel | 'all'>(assignedLevel as AcademicLevel || 'all');
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedUser, setSelectedUser] = useState<UserWithDepartment | null>(null);
  const [showModal, setShowModal] = useState<'view' | 'edit' | 'add' | 'confirm' | 'permissions' | null>(null);
  const [confirmAction, setConfirmAction] = useState<'ban' | 'suspend' | 'activate' | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [suspendDuration, setSuspendDuration] = useState<'24h' | '7d' | '30d' | 'permanent'>('7d');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const showSuccess = (message: string) => {
    setSuccessMessage(message);
    setTimeout(() => setSuccessMessage(null), 5000);
  };
  // Page UI depends on global sync
  // Client-side filtering
  const filteredUsers = useMemo(() => {
    let result = [...(allStudents as UserWithDepartment[])].filter(u => ['moderator', 'super_admin'].includes(u.role));

    // Moderators are hard-locked to their assigned level — enforced here regardless of filter state
    if (assignedLevel) {
      result = result.filter(u => u.level === assignedLevel);
    } else if (levelFilter !== 'all') {
      result = result.filter(u => u.level === levelFilter);
    }

    if (statusFilter !== 'all') {
      result = result.filter(u => u.status === statusFilter);
    }
    if (roleFilter !== 'all') {
      result = result.filter(u => u.role === roleFilter);
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(u => 
        u.full_name?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q) ||
        u.username?.toLowerCase().includes(q) ||
        u.registration_number?.toLowerCase().includes(q) ||
        u.id.toLowerCase().includes(q)
      );
    }

    return result;
  }, [allStudents, assignedLevel, statusFilter, levelFilter, roleFilter, searchQuery]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, levelFilter, roleFilter, searchQuery]);

  const totalCount = filteredUsers.length;
  const from = (currentPage - 1) * ITEMS_PER_PAGE;
  const to = from + ITEMS_PER_PAGE;
  const users = filteredUsers.slice(from, to);

  const stats = {
    total: (allStudents as UserWithDepartment[]).filter(u => u.role === 'moderator').length,
    active: (allStudents as UserWithDepartment[]).filter(u => u.status === 'active' && u.role === 'moderator').length,
    pending: (allStudents as UserWithDepartment[]).filter(u => u.status === 'pending_verification' && u.role === 'moderator').length,
    risk: (allStudents as UserWithDepartment[]).filter(u => ['suspended', 'banned'].includes(u.status) && u.role === 'moderator').length
  };

  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);

  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleStatusChange = async () => {
    if (!selectedUser || !confirmAction || isSubmittingAction) return;
    setIsSubmittingAction(true);
    setActionError(null);

    try {
      const currentAdmin = (await supabase.auth.getUser()).data.user;
      const updateData: Record<string, unknown> = {
        status: confirmAction === 'ban' ? 'banned' : confirmAction === 'suspend' ? 'suspended' : 'active',
        updated_at: new Date().toISOString(),
      };

      if (confirmAction === 'ban') {
        updateData.banned_at = new Date().toISOString();
        updateData.banned_reason = actionReason || 'Violation of platform rules';
        updateData.banned_by = currentAdmin?.id || null;
        // Clear any previous suspension
        updateData.suspended_until = null;
        updateData.suspension_reason = null;
      } else if (confirmAction === 'suspend') {
        const now = new Date();
        let until: Date | null = null;
        if (suspendDuration === '24h') until = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        else if (suspendDuration === '7d') until = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        else if (suspendDuration === '30d') until = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        updateData.suspended_until = until ? until.toISOString() : null;
        updateData.suspension_reason = actionReason || 'Suspended by administrator';
        // Clear any previous ban
        updateData.banned_at = null;
        updateData.banned_reason = null;
        updateData.banned_by = null;
      } else if (confirmAction === 'activate') {
        updateData.banned_at = null;
        updateData.banned_reason = null;
        updateData.banned_by = null;
        updateData.suspended_until = null;
        updateData.suspension_reason = null;
      }

      const { error } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', selectedUser.id);

      if (error) throw error;

      // Update store immediately — no waiting for realtime
      useAdminDataStore.getState().updateStudent({ ...selectedUser, ...updateData } as any);

      // Log the action
      await supabase.from('activity_logs').insert({
        user_id: currentAdmin?.id,
        action: `user.${confirmAction}`,
        entity_id: selectedUser.id,
        entity_type: 'user',
        description: `${confirmAction === 'activate' ? 'Restored' : confirmAction === 'ban' ? 'Banned' : 'Suspended'} moderator: ${selectedUser.full_name}`,
        metadata: { reason: actionReason, duration: confirmAction === 'suspend' ? suspendDuration : undefined }
      });

      showSuccess(`User ${confirmAction === 'activate' ? 'restored' : confirmAction === 'ban' ? 'banned' : 'suspended'} successfully. Mobile app will respond immediately.`);
      setShowModal(null);
      setConfirmAction(null);
      setSelectedUser(null);
      setActionReason('');
      setSuspendDuration('7d');
    } catch (err: unknown) {
      setActionError((err as any)?.message || 'Action failed. Please try again.');
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleDeleteUser = async (user: UserWithDepartment) => {
    if (isSubmittingAction) return;
    setIsSubmittingAction(true);
    setActionError(null);
    try {
      const currentAdmin = (await supabase.auth.getUser()).data.user;
      // Step 1: Ban first — triggers realtime kick-out on mobile immediately
      // so the user loses access even before the row is deleted
      await supabase.from('users').update({ status: 'banned', banned_reason: 'Account deleted by administrator' }).eq('id', user.id);
      // Step 2: Remove from all group memberships
      await supabase.from('group_members').delete().eq('user_id', user.id);
      // Step 3: Delete the public profile row
      const { error } = await supabase.from('users').delete().eq('id', user.id);
      if (error) throw error;
      // Note: auth.users record requires Supabase dashboard or service-role key to delete.
      // The ban in step 1 ensures the user cannot log in even if the auth record persists.
      await supabase.from('activity_logs').insert({
        user_id: currentAdmin?.id,
        action: 'user.delete',
        entity_id: user.id,
        entity_type: 'user',
        description: `Deleted moderator account: ${user.full_name} (${user.email})`,
      });
      showSuccess(`${user.full_name}'s account permanently deleted.`);
      setShowModal(null);
      setSelectedUser(null);
      refreshAnalytics();
    } catch (err: unknown) {
      setActionError((err as any)?.message || 'Delete failed. Please try again.');
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleVerify = async (userId: string) => {
    if (isSubmittingAction) return;
    setIsSubmittingAction(true);
    setActionError(null);

    try {
      const currentAdmin = (await supabase.auth.getUser()).data.user;
      const { error } = await supabase
        .from('users')
        .update({
          status: 'active',
          registration_verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);

      if (error) throw error;

      // Update store immediately — find the user object by id and patch it
      const existingUser = useAdminDataStore.getState().students.find(u => u.id === userId);
      if (existingUser) {
        useAdminDataStore.getState().updateStudent({ ...existingUser, status: 'active', registration_verified_at: new Date().toISOString() } as any);
      }

      await supabase.from('activity_logs').insert({
        user_id: currentAdmin?.id,
        action: 'user.verify',
        entity_id: userId,
        entity_type: 'user',
        description: `Verified and activated moderator account`,
      });

      showSuccess('User verified and activated successfully.');
    } catch (err: unknown) {
      setActionError((err as any)?.message || 'Verification failed. Please try again.');
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleRoleChange = async (user: UserWithDepartment, newRole: 'moderator' | 'student') => {
    if (isSubmittingAction) return;
    setIsSubmittingAction(true);
    // Optimistic update
    useAdminDataStore.getState().updateStudent({ ...user, role: newRole } as any);
    try {
      const currentAdmin = (await supabase.auth.getUser()).data.user;

      // ── Enforce max 5 moderators per level when promoting ─────────────────
      if (newRole === 'moderator' && user.level) {
        const { count } = await supabase
          .from('users')
          .select('id', { count: 'exact', head: true })
          .eq('role', 'moderator')
          .eq('level', user.level);

        if ((count ?? 0) >= 5) {
          useAdminDataStore.getState().updateStudent(user as any); // revert optimistic
          setActionError(
            `Level ${user.level} already has ${count} moderator${count === 1 ? '' : 's'}. Maximum is 5 per level.`
          );
          setIsSubmittingAction(false);
          return;
        }
      }

      const { error } = await supabase.from('users').update({ role: newRole, updated_at: new Date().toISOString() }).eq('id', user.id);
      if (error) throw error;

      if (newRole === 'moderator') {
        // Enable all content permissions and set assigned_level from the moderator's own level
        await supabase.from('moderator_permissions').upsert(
          {
            user_id: user.id,
            can_manage_announcements: true,
            can_manage_materials: true,
            can_manage_lecturers: false,
            can_manage_executives: false,
            can_manage_moderators: true,
            assigned_level: user.level || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );

        // Auto-assign as moderator of their level group (if one exists and slot is empty)
        if (user.level) {
          const { data: levelGroup } = await supabase
            .from('groups')
            .select('id')
            .eq('group_type', 'level')
            .eq('level', user.level)
            .eq('is_active', true)
            .maybeSingle();

          if (levelGroup) {
            // Only set moderator_id if the slot is currently empty
            await supabase.from('groups')
              .update({ moderator_id: user.id, updated_at: new Date().toISOString() })
              .eq('id', levelGroup.id)
              .is('moderator_id', null);

            // Ensure they are a member with moderator role in the group
            await supabase.from('group_members').upsert(
              { group_id: levelGroup.id, user_id: user.id, role: 'moderator' },
              { onConflict: 'group_id,user_id' }
            );
          }
        }
      } else {
        // Demoting back to student — clean up permissions and group moderator role
        await supabase.from('moderator_permissions').delete().eq('user_id', user.id);

        // Reset their role in any groups they moderate
        await supabase.from('group_members')
          .update({ role: 'member' })
          .eq('user_id', user.id)
          .eq('role', 'moderator');

        // Clear moderator_id from any groups they were assigned to
        await supabase.from('groups')
          .update({ moderator_id: null, updated_at: new Date().toISOString() })
          .eq('moderator_id', user.id);
      }

      await supabase.from('activity_logs').insert({
        user_id: currentAdmin?.id,
        action: `user.role_change`,
        entity_id: user.id,
        entity_type: 'user',
        description: `Changed ${user.full_name}'s role from ${user.role} to ${newRole}`,
        metadata: { assigned_level: user.level, new_role: newRole },
      });

      showSuccess(
        newRole === 'moderator'
          ? `${user.full_name} promoted to Moderator for Level ${user.level}. All permissions enabled.`
          : `${user.full_name} demoted back to student.`
      );
    } catch (err: unknown) {
      // Revert optimistic update
      useAdminDataStore.getState().updateStudent(user as any);
      setActionError((err as any)?.message || 'Role change failed. Please try again.');
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const openConfirmModal = (user: UserWithDepartment, action: 'ban' | 'suspend' | 'activate') => {
    setSelectedUser(user);
    setConfirmAction(action);
    setActionError(null);
    setShowModal('confirm');
  };

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-12 animate-in fade-in duration-500">
      {/* Global Progress Feedback */}
      {successMessage && (
        <div className="fixed bottom-12 right-12 z-[100] bg-primary-950 border border-primary-800 text-white px-8 py-5 rounded-[2rem] shadow-2xl flex items-center gap-6 animate-in slide-in-from-bottom-12 duration-500">
          <div className="w-12 h-12 bg-primary-800 rounded-full flex items-center justify-center flex-shrink-0 border border-primary-700 shadow-inner">
            <CheckCircle2 className="w-6 h-6 text-green-400" />
          </div>
          <div>
            <p className="text-[10px] font-black tracking-[0.25em] text-primary-400 italic">SUCCESS</p>
            <p className="text-sm font-bold tracking-tight">{successMessage}</p>
          </div>
        </div>
      )}
      {/* Ecosystem Dashboard */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all group border-b-4 border-b-primary-950">
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-primary-50 rounded-xl flex items-center justify-center text-primary-600 group-hover:scale-110 transition-transform">
              <Users className="w-6 h-6" />
            </div>
            <span className="text-[10px] font-black text-primary-600 bg-primary-50 px-2 py-1 rounded-lg tracking-wider italic">TOTAL</span>
          </div>
          <h3 className="text-3xl font-black text-gray-900 leading-none">{stats.total}</h3>
          <p className="text-gray-500 text-sm mt-2 font-medium">Total Moderators</p>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all group border-b-4 border-b-amber-500">
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-amber-50 rounded-xl flex items-center justify-center text-amber-600 group-hover:scale-110 transition-transform">
              <Clock className="w-6 h-6" />
            </div>
            <span className="text-[10px] font-black text-amber-600 bg-amber-50 px-2 py-1 rounded-lg tracking-wider italic">PENDING</span>
          </div>
          <h3 className="text-3xl font-black text-gray-900 leading-none">{stats.pending}</h3>
          <p className="text-gray-500 text-sm mt-2 font-medium">Pending Verification</p>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all group border-b-4 border-b-green-500">
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-green-50 rounded-xl flex items-center justify-center text-green-600 group-hover:scale-110 transition-transform">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <span className="text-[10px] font-black text-green-600 bg-green-50 px-2 py-1 rounded-lg tracking-wider italic">VERIFIED</span>
          </div>
          <h3 className="text-3xl font-black text-gray-900 leading-none">{stats.active}</h3>
          <p className="text-gray-500 text-sm mt-2 font-medium">Verified Moderators</p>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all group border-b-4 border-b-red-500">
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center text-red-600 group-hover:scale-110 transition-transform">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <span className="text-[10px] font-black text-red-600 bg-red-50 px-2 py-1 rounded-lg tracking-wider italic">RESTRICTED</span>
          </div>
          <h3 className="text-3xl font-black text-gray-900 leading-none">{stats.risk}</h3>
          <p className="text-gray-500 text-sm mt-2 font-medium">Restricted Accounts</p>
        </div>
      </div>

      {/* Section Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 bg-white p-8 rounded-3xl border border-gray-100 shadow-sm">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-1.5 h-8 bg-primary-950 rounded-full" />
            <h1 className="text-3xl font-black text-gray-900 tracking-tight uppercase">Moderator Manager</h1>
          </div>
          <p className="text-gray-500 font-medium">Manage moderator accounts, verify registrations, and handle moderation.</p>
        </div>

        <div className="flex items-center flex-wrap gap-4">
           <button
             onClick={() => window.location.reload()}
             className="p-3 text-gray-400 hover:text-primary-950 hover:bg-gray-50 rounded-xl transition-all"
             title="Refresh Data"
           >
             <Activity className="w-5 h-5" />
           </button>
           {profile?.role === 'super_admin' && (
             <button
               onClick={() => setShowModal('add')}
               className="inline-flex items-center justify-center px-8 py-3.5 bg-primary-950 text-white text-sm font-bold rounded-2xl hover:bg-primary-800 active:scale-95 transition-all shadow-xl shadow-primary-950/20"
             >
               <UserPlus className="w-5 h-5 mr-2" />
               Add Moderator
             </button>
           )}
        </div>
      </div>

      {/* Filters & Search */}
      <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex flex-col xl:flex-row gap-6">
        <div className="relative flex-1 group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 group-focus-within:text-primary-950 transition-colors" />
          <input
            type="text"
            placeholder="Search by name, unique ID, email or registration number..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-12 pr-4 py-4 bg-gray-50 border-none rounded-xl text-sm font-semibold focus:ring-2 focus:ring-primary-900 transition-all shadow-inner placeholder:text-gray-400"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center px-4 py-2 bg-gray-50 rounded-xl border border-gray-100">
            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest mr-3">Status</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as AccountStatus | 'all')}
              className="bg-transparent border-none p-0 text-sm font-bold text-gray-900 focus:ring-0 cursor-pointer"
            >
              <option value="all">ALL USERS</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status].toUpperCase()}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center px-4 py-2 bg-gray-50 rounded-xl border border-gray-100">
            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest mr-3">Academic</span>
            {assignedLevel ? (
              <span className="text-sm font-black text-primary-950">LEVEL {assignedLevel}</span>
            ) : (
              <select
                value={levelFilter}
                onChange={(e) => setLevelFilter(e.target.value as AcademicLevel | 'all')}
                className="bg-transparent border-none p-0 text-sm font-bold text-gray-900 focus:ring-0 cursor-pointer"
              >
                <option value="all">ALL LEVELS</option>
                {levelOptions.map((level) => (
                  <option key={level} value={level}>
                    {LEVEL_LABELS[level].toUpperCase()}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex items-center px-4 py-2 bg-gray-50 rounded-xl border border-gray-100">
            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest mr-3">Responsibility</span>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as UserRole | 'all')}
              className="bg-transparent border-none p-0 text-sm font-bold text-gray-900 focus:ring-0 cursor-pointer"
            >
              <option value="all">ALL ROLES</option>
              {roleOptions.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role].toUpperCase()}
                </option>
              ))}
            </select>
          </div>

          <div className="h-10 w-px bg-gray-200 mx-2 hidden xl:block" />

          <button
            onClick={() => {
              setSearchQuery('');
              setStatusFilter('all');
              setLevelFilter('all');
              setRoleFilter('all');
              setCurrentPage(1);
            }}
            className="px-4 py-2 text-xs font-black text-primary-950 uppercase tracking-widest hover:bg-primary-50 rounded-xl transition-all"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Results Count & Primary Table */}
      <div className="bg-white rounded-3xl border border-gray-100 shadow-xl shadow-gray-200/50 overflow-hidden">
        <div className="px-8 py-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <div className="flex items-center gap-3">
             <div className="w-2 h-2 bg-primary-950 rounded-full animate-pulse" />
             <span className="text-sm font-black text-gray-900 uppercase tracking-widest">Moderator List</span>
             <span className="px-2.5 py-0.5 bg-gray-100 text-gray-500 text-[10px] font-black rounded-lg">{totalCount} RECORDS</span>
          </div>
          <div className="text-xs text-gray-400 font-bold uppercase tracking-tighter">
            Showing {users.length} unique profiles
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50/50 border-b border-gray-100">
                <th className="px-8 py-4 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">Full Name</th>
                <th className="px-8 py-4 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">Username</th>
                <th className="px-8 py-4 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">Reg Number</th>
                <th className="px-8 py-4 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">Level / Role</th>
                <th className="px-8 py-4 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">Status</th>
                <th className="px-8 py-4 text-right text-[10px] font-black text-gray-400 uppercase tracking-widest">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
            {allStudents.length === 0 && isSyncing && !lastSync ? (
                <tr>
                  <td colSpan={6} className="px-8 py-32 text-center">
                    <div className="flex flex-col items-center justify-center">
                      <div className="w-12 h-12 border-4 border-primary-100 border-t-primary-950 rounded-full animate-spin mb-4" />
                      <p className="text-xs font-black text-gray-400 uppercase tracking-widest">Loading Moderators...</p>
                    </div>
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={6} className="px-8 py-24">
                     <div className="flex flex-col items-center justify-center text-center">
                        <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center text-red-500 mb-4">
                           <ShieldAlert className="w-8 h-8" />
                        </div>
                        <h3 className="text-lg font-black text-gray-900">Data Sync Required</h3>
                        <p className="text-gray-500 text-sm max-w-xs mx-auto mt-1 mb-6">Failed to retrieve moderator data. Check your admin connection and retry.</p>
                        <button onClick={() => syncAll(true)} className="px-6 py-2 bg-primary-950 text-white text-xs font-black rounded-xl hover:bg-primary-800 transition-all">Retry Link</button>
                     </div>
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-8 py-32 text-center">
                    <div className="flex flex-col items-center justify-center opacity-40">
                       <Search className="w-16 h-16 text-gray-300 mb-4" />
                       <p className="text-sm font-black text-gray-400 uppercase tracking-widest">No matching moderator profiles</p>
                    </div>
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id} className="hover:bg-primary-50/30 transition-colors group">
                    <td className="px-8 py-5">
                      <div className="flex items-center gap-4">
                        <div className="relative">
                           <div className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center overflow-hidden border-2 border-white shadow-sm group-hover:scale-105 transition-transform">
                             {user.avatar_url ? (
                               <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
                             ) : (
                               <span className="text-lg font-black text-gray-400">
                                 {user.full_name?.charAt(0).toUpperCase()}
                               </span>
                             )}
                           </div>
                           <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white ${user.status === 'active' ? 'bg-green-500' : 'bg-gray-300'}`} />
                        </div>
                        <div>
                          <p className="text-sm font-black text-gray-900">{user.full_name}</p>
                          <p className="text-[11px] text-gray-400 font-medium lowercase tracking-tight">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-5">
                       <div className="flex flex-col">
                          <span className="text-[11px] font-black text-primary-600 font-mono tracking-tight">@{user.username || 'not_set'}</span>
                       </div>
                    </td>
                    <td className="px-8 py-5">
                       <div className="flex items-center gap-2">
                          <code className="text-[11px] font-mono font-bold bg-gray-100 px-2 py-0.5 rounded text-gray-600">{user.registration_number || 'PENDING'}</code>
                       </div>
                    </td>
                    <td className="px-8 py-5">
                       <div className="flex flex-col gap-1">
                          <span className="text-[10px] font-black text-gray-950 italic tracking-tighter">LEVEL {user.level || '?' }</span>
                          <span className={`inline-flex w-fit px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-tighter ${
                            user.role === 'super_admin' ? 'bg-purple-100 text-purple-700' :
                            user.role === 'moderator' ? 'bg-amber-100 text-amber-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>
                            {ROLE_LABELS[user.role]}
                          </span>
                       </div>
                    </td>
                    <td className="px-8 py-5">
                       <div className="flex flex-col gap-1">
                         <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter ${
                           user.status === 'active' ? 'bg-green-50 text-green-700' :
                           user.status === 'pending_verification' ? 'bg-amber-50 text-amber-700' :
                           user.status === 'banned' ? 'bg-red-50 text-red-700' :
                           'bg-orange-50 text-orange-700'
                         }`}>
                           <div className={`w-1.5 h-1.5 rounded-full ${
                             user.status === 'active' ? 'bg-green-500' :
                             user.status === 'pending_verification' ? 'bg-amber-500 animate-pulse' :
                             user.status === 'banned' ? 'bg-red-500' :
                             'bg-orange-500 animate-pulse'
                           }`} />
                           {STATUS_LABELS[user.status]}
                         </span>
                         {user.status === 'suspended' && user.suspended_until && new Date(user.suspended_until) > new Date() && (
                           <SuspensionCountdown until={new Date(user.suspended_until)} />
                         )}
                       </div>
                    </td>
                    <td className="px-8 py-5 text-right">
                       <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => { setSelectedUser(user); setShowModal('view'); }}
                            className="p-2 text-primary-950 bg-primary-50 hover:bg-primary-100 border border-primary-200 rounded-xl shadow-sm transition-all"
                            title="View Profile"
                          >
                            <Eye className="w-5 h-5" />
                          </button>
                          
                          {user.role === 'moderator' && (
                            <button
                              onClick={() => { setSelectedUser(user); setShowModal('permissions'); }}
                              className="p-2 text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl shadow-sm transition-all"
                              title="Permissions"
                            >
                              <Shield className="w-5 h-5" />
                            </button>
                          )}
 
                          <button
                            onClick={() => { setSelectedUser(user); setShowModal('edit'); }}
                            className="p-2 text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-xl shadow-sm transition-all"
                            title="Edit Moderator"
                          >
                            <Edit className="w-5 h-5" />
                          </button>
 
                          <div className="w-px h-6 bg-gray-200 mx-1" />
 
                          {user.status === 'pending_verification' ? (
                            <button
                              onClick={() => handleVerify(user.id)}
                              className="inline-flex items-center px-4 py-2 bg-green-600 text-white text-[10px] font-black rounded-xl hover:bg-green-700 transition-all shadow-md shadow-green-500/20"
                            >
                              VERIFY
                            </button>
                          ) : user.status === 'active' ? (
                            <div className="flex items-center gap-1.5">
                               <button
                                 onClick={() => openConfirmModal(user, 'suspend')}
                                 className="p-2 text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl transition-all"
                                 title="Suspend User"
                               >
                                 <UserX className="w-5 h-5" />
                               </button>
                               <button
                                 onClick={() => openConfirmModal(user, 'ban')}
                                 className="p-2 text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl transition-all"
                               >
                                 <Ban className="w-5 h-5" />
                               </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => openConfirmModal(user, 'activate')}
                              className="inline-flex items-center px-4 py-2 bg-primary-950 text-white text-[10px] font-black rounded-xl hover:bg-primary-800 transition-all"
                            >
                              RESTORE
                            </button>
                          )}
 
                          {/* Role toggle — promote/demote moderator — super_admin only */}
                          {profile?.role === 'super_admin' && user.role !== 'super_admin' && user.status === 'active' && (
                            <button
                              onClick={() => handleRoleChange(user, user.role === 'moderator' ? 'student' : 'moderator')}
                              disabled={isSubmittingAction}
                              className={`p-2 rounded-xl border transition-all disabled:opacity-50 ${
                                user.role === 'moderator'
                                  ? 'text-amber-700 bg-amber-100 border-amber-300 hover:bg-amber-200'
                                  : 'text-gray-500 bg-gray-50 border-gray-200 hover:text-amber-700 hover:bg-amber-50 hover:border-amber-200'
                              }`}
                              title={
                                user.role === 'moderator'
                                  ? 'Demote to Student'
                                  : `Promote to Moderator (Level ${user.level} — max 5 per level)`
                              }
                            >
                              <Shield className="w-5 h-5" />
                            </button>
                          )}
                       </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Console */}
        {totalPages > 1 && (
          <div className="px-8 py-6 bg-gray-50/50 border-t border-gray-100 flex items-center justify-between">
            <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
              Page {currentPage} of {totalPages}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="flex items-center px-5 py-2 text-xs font-black text-gray-500 bg-white border border-gray-100 rounded-xl hover:text-primary-950 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-sm"
              >
                <ChevronLeft className="h-4 w-4 mr-2" />
                BACK
              </button>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="flex items-center px-5 py-2 text-xs font-black text-gray-500 bg-white border border-gray-100 rounded-xl hover:text-primary-950 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-sm"
              >
                NEXT
                <ChevronRight className="h-4 w-4 ml-2" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Moderator Profile Modal */}
      {showModal === 'view' && selectedUser && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-primary-950/40 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-4xl rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 border border-white/20">
            {/* Modal Header */}
            <div className="relative h-32 bg-primary-950">
              <div className="absolute inset-0 bg-gradient-to-r from-primary-900 to-transparent opacity-50" />
              <button
                onClick={() => setShowModal(null)}
                className="absolute top-6 right-6 p-2 bg-white/10 hover:bg-white/20 text-white rounded-full transition-all"
              >
                <X className="w-5 h-5" />
              </button>
              
              {/* Profile Header Image Overlap */}
              <div className="absolute -bottom-12 left-10 flex items-end gap-6">
                <div className="w-24 h-24 rounded-3xl bg-white p-1.5 shadow-xl">
                  <div className="w-full h-full rounded-2xl bg-gray-100 flex items-center justify-center overflow-hidden border border-gray-100">
                    {selectedUser!.avatar_url ? (
                      <img src={selectedUser!.avatar_url ?? undefined} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-3xl font-black text-gray-400">
                        {selectedUser!.full_name?.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                </div>
                <div className="pb-2">
                  <h2 className="text-2xl font-black text-white">{selectedUser!.full_name}</h2>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="px-2 py-0.5 bg-white/20 text-white text-[10px] font-black rounded-lg uppercase tracking-widest backdrop-blur-md">
                      {ROLE_LABELS[selectedUser!.role]}
                    </span>
                    <span className={`px-2 py-0.5 text-[10px] font-black rounded-lg uppercase tracking-widest backdrop-blur-md ${
                      selectedUser!.status === 'active' ? 'bg-green-500/20 text-green-300' :
                      selectedUser!.status === 'pending_verification' ? 'bg-amber-500/20 text-amber-300' :
                      'bg-red-500/20 text-red-300'
                    }`}>
                      {STATUS_LABELS[selectedUser!.status]}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-20 pb-10 px-10">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                {/* Academic Information */}
                <div className="space-y-8">
                  <div>
                    <h3 className="text-[10px] font-black text-primary-950/40 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                      <GraduationCap className="w-4 h-4" />
                      Academic Information
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-4 bg-gray-100/50 rounded-2xl border border-gray-100">
                         <p className="text-[10px] font-bold text-primary-600 uppercase mb-1">Username (@handle)</p>
                         <p className="text-sm font-black text-primary-950 font-mono tracking-wider">@{selectedUser!.username || 'not_set'}</p>
                      </div>
                      <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                         <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Registration Number</p>
                         <p className="text-sm font-black text-gray-900 font-mono tracking-wider">{selectedUser!.registration_number || 'NOT ISSUED'}</p>
                      </div>
                      <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                         <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Current Level</p>
                         <p className="text-sm font-black text-gray-900 tracking-wider">LEVEL {selectedUser!.level || '?'}</p>
                      </div>
                      <div className="col-span-2 p-4 bg-gray-50 rounded-2xl border border-gray-100">
                         <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Department / Faculty</p>
                         <p className="text-sm font-black text-gray-900 truncate">{selectedUser!.departments?.name || 'NOT ASSIGNED'}</p>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-[10px] font-black text-primary-950/40 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                      <Search className="w-4 h-4" />
                      Contact Information
                    </h3>
                    <div className="space-y-4">
                       <div className="flex items-center gap-4 p-4 bg-primary-50/50 rounded-2xl border border-primary-100">
                          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-primary-900 shadow-sm">
                             <Activity className="w-5 h-5" />
                          </div>
                          <div>
                             <p className="text-[10px] font-bold text-primary-950/60 uppercase leading-none mb-1">Moderator Email</p>
                             <p className="text-sm font-black text-primary-950 lowercase">{selectedUser!.email}</p>
                          </div>
                       </div>
                    </div>
                  </div>
                </div>

                {/* Account Details */}
                <div className="space-y-8">
                   <div>
                    <h3 className="text-[10px] font-black text-primary-950/40 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                      <Activity className="w-4 h-4" />
                      Account Details
                    </h3>
                    <div className="p-6 bg-gray-900 rounded-3xl text-white shadow-xl">
                       <div className="flex justify-between items-center mb-4">
                          <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Enrollment Date</span>
                          <span className="text-sm font-bold">{new Date(selectedUser!.created_at).toLocaleDateString(undefined, { dateStyle: 'long' })}</span>
                       </div>
                       <div className="h-px bg-white/10 w-full mb-4" />
                       <div className="flex flex-wrap gap-2">
                          <span className="px-2.5 py-1 bg-white/10 text-[10px] font-black rounded-lg uppercase tracking-tight">UID: {selectedUser!.id.substring(0, 8)}</span>
                          <span className="px-2.5 py-1 bg-white/10 text-[10px] font-black rounded-lg uppercase tracking-tight">SEM: 1ST</span>
                       </div>
                    </div>
                  </div>

                  {/* Ban / Suspension Details */}
                  {selectedUser!.status === 'banned' && (
                    <div className="animate-in slide-in-from-bottom-2 duration-300">
                      <h3 className="text-[10px] font-black text-red-500 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                        <Ban className="w-4 h-4" />
                        Ban Record
                      </h3>
                      <div className="p-5 bg-red-50 rounded-2xl border border-red-100 border-l-4 border-l-red-500 space-y-3">
                        {selectedUser!.banned_at && (
                          <div>
                            <p className="text-[10px] font-black text-red-400 uppercase tracking-widest mb-0.5">Banned On</p>
                            <p className="text-sm font-bold text-red-900">{new Date(selectedUser!.banned_at).toLocaleString()}</p>
                          </div>
                        )}
                        {selectedUser!.banned_reason && (
                          <div>
                            <p className="text-[10px] font-black text-red-400 uppercase tracking-widest mb-0.5">Reason</p>
                            <p className="text-sm font-semibold text-red-900">{selectedUser!.banned_reason}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {selectedUser!.status === 'suspended' && (
                    <div className="animate-in slide-in-from-bottom-2 duration-300">
                      <h3 className="text-[10px] font-black text-amber-500 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                        <UserX className="w-4 h-4" />
                        Suspension Record
                      </h3>
                      <div className="p-5 bg-amber-50 rounded-2xl border border-amber-100 border-l-4 border-l-amber-500 space-y-3">
                        {selectedUser!.suspended_until ? (
                          <div>
                            <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest mb-0.5">Suspended Until</p>
                            <p className="text-sm font-bold text-amber-900">{new Date(selectedUser!.suspended_until).toLocaleString()}</p>
                            {new Date(selectedUser!.suspended_until) > new Date() ? (
                              <SuspensionCountdown until={new Date(selectedUser!.suspended_until)} />
                            ) : (
                              <p className="text-[10px] font-black text-green-600 mt-1">EXPIRED — will auto-lift on next login</p>
                            )}
                          </div>
                        ) : (
                          <p className="text-sm font-bold text-amber-900">Permanent suspension (manual review required)</p>
                        )}
                        {(selectedUser! as any).suspension_reason && (
                          <div>
                            <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest mb-0.5">Reason</p>
                            <p className="text-sm font-semibold text-amber-900">{(selectedUser! as any).suspension_reason}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                   {selectedUser!.level === '400' && (
                    <div className="animate-in slide-in-from-bottom-2 duration-500">
                      <h3 className="text-[10px] font-black text-amber-500 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                        <GraduationCap className="w-4 h-4" />
                        Senior Profile
                      </h3>
                      <div className="p-6 bg-amber-50 rounded-3xl border border-amber-100 border-l-4 border-l-amber-500">
                         <p className="text-xs font-bold text-amber-900 mb-2 leading-relaxed italic">
                           "{selectedUser!.motivational_advice || 'No senior advice shared yet.'}"
                         </p>
                         <div className="h-0.5 w-8 bg-amber-200 mb-2" />
                         <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest">Senior Advice</p>
                      </div>
                    </div>
                  )}

                  {/* Operational Controls */}
                  <div className="flex gap-3">
                     {selectedUser!.status === 'pending_verification' ? (
                       <button
                         onClick={() => { handleVerify(selectedUser!.id); setShowModal(null); }}
                         className="flex-1 py-4 bg-green-600 text-white text-xs font-black rounded-2xl hover:bg-green-700 transition-all shadow-xl shadow-green-600/20 uppercase tracking-widest"
                       >
                         Verify Moderator
                       </button>
                     ) : (
                        <button
                          onClick={() => { setShowModal('edit'); }}
                          className="flex-1 py-4 bg-primary-950 text-white text-xs font-black rounded-2xl hover:bg-primary-800 transition-all shadow-xl shadow-primary-950/20 uppercase tracking-widest"
                        >
                          Edit Profile
                        </button>
                     )}
                     {profile?.role === 'super_admin' && (
                     <button
                       onClick={() => {
                         if (window.confirm(`Permanently delete ${selectedUser!.full_name}'s account? This cannot be undone.`)) {
                           handleDeleteUser(selectedUser!);
                         }
                       }}
                       disabled={isSubmittingAction}
                       className="px-6 py-4 bg-red-50 text-red-600 border border-red-100 text-xs font-black rounded-2xl hover:bg-red-100 transition-all uppercase tracking-widest disabled:opacity-50"
                     >
                       Delete
                     </button>
                     )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal (Ban/Suspend/Activate) */}
      {confirmAction && selectedUser && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-red-950/40 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden border border-red-100 animate-in zoom-in-95 duration-300">
            <div className={`p-8 text-center ${
              confirmAction === 'activate' ? 'bg-green-50' : 'bg-red-50'
            }`}>
              <div className={`w-20 h-20 mx-auto rounded-3xl flex items-center justify-center mb-6 shadow-xl ${
                confirmAction === 'activate' ? 'bg-green-600 text-white shadow-green-600/20' : 'bg-red-600 text-white shadow-red-600/20'
              }`}>
                {confirmAction === 'activate' ? <UserCheck className="w-10 h-10" /> : <ShieldAlert className="w-10 h-10" />}
              </div>
              <h2 className="text-2xl font-black text-gray-900 uppercase tracking-tight">
                Account {confirmAction === 'activate' ? 'Restoration' : 'Restriction'}
              </h2>
              <p className="text-gray-500 text-sm mt-2 font-medium">
                You are about to {confirmAction} access for <span className="font-black text-gray-900">{selectedUser!.full_name}</span>.
              </p>
            </div>

            <div className="p-8 space-y-6">
              {confirmAction !== 'activate' && (
                <div className="space-y-4 animate-in slide-in-from-top-2 duration-300">
                  {confirmAction === 'suspend' && (
                    <div className="flex gap-2">
                       {(['24h', '7d', '30d', 'permanent'] as const).map((duration) => (
                         <button
                           key={duration}
                           onClick={() => setSuspendDuration(duration)}
                           className={`flex-1 py-2 text-[10px] font-black rounded-xl transition-all border ${
                             suspendDuration === duration 
                             ? 'bg-primary-950 text-white border-primary-950' 
                             : 'bg-white text-gray-400 border-gray-100 hover:border-gray-200'
                           }`}
                         >
                           {duration === 'permanent' ? 'PERM' : duration.toUpperCase()}
                         </button>
                       ))}
                    </div>
                  )}
                  <textarea
                    placeholder="Provide official reason for this action..."
                    value={actionReason}
                    onChange={(e) => setActionReason(e.target.value)}
                    className="w-full p-4 bg-gray-50 border-none rounded-2xl text-sm font-semibold focus:ring-2 focus:ring-red-600 h-24 shadow-inner"
                  />
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => { setConfirmAction(null); setActionReason(''); setActionError(null); }}
                  className="flex-1 py-4 bg-gray-50 text-gray-400 text-xs font-black rounded-2xl hover:bg-gray-100 transition-all uppercase tracking-widest"
                >
                  Cancel
                </button>
                <button
                  onClick={handleStatusChange}
                  disabled={isSubmittingAction}
                  className={`flex-[2] py-4 text-white text-xs font-black rounded-2xl transition-all shadow-xl uppercase tracking-widest disabled:opacity-50 flex items-center justify-center gap-2 ${
                    confirmAction === 'activate' 
                    ? 'bg-green-600 hover:bg-green-700 shadow-green-600/20' 
                    : 'bg-red-600 hover:bg-red-700 shadow-red-600/20'
                  }`}
                >
                  {isSubmittingAction && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  {confirmAction === 'activate' ? 'Restore Access' : 'Apply Restriction'}
                </button>
              </div>
              {actionError && (
                <div className="flex items-center gap-3 p-3 bg-red-50 border border-red-100 rounded-xl">
                  <ShieldAlert className="w-4 h-4 text-red-500 shrink-0" />
                  <p className="text-xs font-bold text-red-700">{actionError}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add User Modal */}
      {showModal === 'add' && (
        <AddUserModal
          onClose={() => setShowModal(null)}
          onSave={() => {
            setShowModal(null);
            refreshAnalytics();
          }}
        />
      )}

      {/* Edit User Modal */}
      {showModal === 'edit' && selectedUser && (
        <EditUserModal
          user={selectedUser!}
          onClose={() => setShowModal(null)}
          onSave={() => {
            setShowModal(null);
            setSelectedUser(null);
            refreshAnalytics();
            showSuccess('Moderator profile updated successfully. Changes are reflected immediately.');
          }}
        />
      )}

      {/* Permissions Modal */}
      {showModal === 'permissions' && selectedUser && (
        <ModeratorPermissionsModal
          user={selectedUser!}
          onClose={() => setShowModal(null)}
          onSave={(message) => {
            setShowModal(null);
            refreshAnalytics();
            if (message) showSuccess(message);
          }}
        />
      )}
    </div>
  );

}

// Edit User Modal Component
function EditUserModal({ user, onClose, onSave }: { user: UserWithDepartment; onClose: () => void; onSave: () => void }) {
  const [formData, setFormData] = useState({
    full_name: user.full_name,
    username: user.username || '',
    display_name: user.display_name || '',
    registration_number: user.registration_number || '',
    phone: user.phone || '',
    bio: user.bio || '',
    role: user.role,
    level: user.level || '',
    status: user.status,
    senior_photo_url: user.senior_photo_url || '',
    motivational_advice: user.motivational_advice || '',
    senior_bio: user.senior_bio || '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const isLevel400 = formData.level === '400';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveError(null);

    try {
      const updateData = {
        full_name: formData.full_name,
        username: formData.username || null,
        display_name: formData.display_name || null,
        registration_number: formData.registration_number,
        phone: formData.phone || null,
        bio: formData.bio || null,
        role: formData.role,
        level: formData.level || null,
        status: formData.status,
        senior_photo_url: formData.level === '400' ? (formData.senior_photo_url || null) : null,
        motivational_advice: formData.level === '400' ? (formData.motivational_advice || null) : null,
        senior_bio: formData.level === '400' ? (formData.senior_bio || null) : null,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', user.id);

      if (error) throw error;

      // Handle moderator_permissions side-effects on role change
      if (formData.role === 'moderator' && user.role !== 'moderator') {
        // Promoted to moderator — ensure a default permissions row exists
        await supabase
          .from('moderator_permissions')
          .upsert({
            user_id: user.id,
            can_manage_announcements: false,
            can_manage_materials: false,
            can_manage_lecturers: false,
            can_manage_executives: false,
            can_manage_moderators: false,
            assigned_level: null,
            updated_at: new Date().toISOString(),
          });
      } else if (formData.role !== 'moderator' && user.role === 'moderator') {
        // Demoted from moderator — clean up permissions row
        await supabase
          .from('moderator_permissions')
          .delete()
          .eq('user_id', user.id);
      }

      // Update store immediately for instant UI reflection
      useAdminDataStore.getState().updateStudent({ ...user, ...updateData } as any);

      // Log the action
      const currentAdmin = (await supabase.auth.getUser()).data.user;
      await supabase.from('activity_logs').insert({
        user_id: currentAdmin?.id,
        action: 'user.update',
        entity_id: user.id,
        entity_type: 'user',
        description: `Updated moderator profile: ${formData.full_name}`,
      });

      onSave();
    } catch (err: unknown) {
      setSaveError((err as any)?.message || 'Failed to save. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-primary-950/40 backdrop-blur-md animate-in fade-in duration-300">
      <div className="bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 border border-white/20">
        <div className="px-10 py-8 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <div>
            <h2 className="text-2xl font-black text-gray-900 uppercase tracking-tight">Edit Moderator Profile</h2>
            <p className="text-gray-500 text-xs font-medium mt-1 uppercase tracking-widest">User ID: {user.id.substring(0, 8)}</p>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-primary-950 hover:bg-white rounded-xl transition-all">
            <X className="w-6 h-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-10 space-y-8 max-h-[70vh] overflow-y-auto custom-scrollbar">
          {/* Identity Section */}
          <div className="space-y-6">
            <h3 className="text-[10px] font-black text-primary-950/40 uppercase tracking-[0.2em] flex items-center gap-2">
              <Users className="w-4 h-4" />
              Core Identity
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-400 uppercase ml-1">Full Name</label>
                <input
                  type="text"
                  value={formData.full_name}
                  onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                  className="w-full px-5 py-3.5 bg-gray-50 border-none rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary-950 shadow-inner"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-400 uppercase ml-1">Username (Chat Handle)</label>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value.toLowerCase().replace(/\s+/g, '') })}
                  placeholder="@handle"
                  className="w-full px-5 py-3.5 bg-gray-50 border-none rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary-950 shadow-inner"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-400 uppercase ml-1">Reg Number</label>
                <input
                  type="text"
                  value={formData.registration_number}
                  onChange={(e) => setFormData({ ...formData, registration_number: e.target.value })}
                  className="w-full px-5 py-3.5 bg-gray-50 border-none rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary-950 shadow-inner"
                />
              </div>
            </div>
          </div>

          {/* Academic Placement */}
          <div className="space-y-6">
            <h3 className="text-[10px] font-black text-primary-950/40 uppercase tracking-[0.2em] flex items-center gap-2">
              <GraduationCap className="w-4 h-4" />
              Academic Level
            </h3>
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-400 uppercase ml-1">System Role</label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value as UserRole })}
                  className="w-full px-5 py-3.5 bg-gray-50 border-none rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary-950 shadow-inner"
                >
                  {roleOptions.map((role) => (
                    <option key={role} value={role}>{ROLE_LABELS[role].toUpperCase()}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-400 uppercase ml-1">Academic Level</label>
                <select
                  value={formData.level}
                  onChange={(e) => setFormData({ ...formData, level: e.target.value })}
                  className="w-full px-5 py-3.5 bg-gray-50 border-none rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary-950 shadow-inner"
                >
                  <option value="">DEFERRED</option>
                  {levelOptions.map((level) => (
                    <option key={level} value={level}>{LEVEL_LABELS[level].toUpperCase()}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Senior Profile Archiving */}
          {isLevel400 && (
            <div className="space-y-6 p-8 bg-amber-50 rounded-[2rem] border border-amber-100 animate-in slide-in-from-bottom-4 duration-500">
               <h3 className="text-[10px] font-black text-amber-600 uppercase tracking-[0.2em] flex items-center gap-2">
                <Shield className="w-4 h-4" />
                Senior Legacy Archiving
              </h3>
              <div className="space-y-4">
                 <FileUpload
                   accept="image/*"
                   isImage={true}
                   folder="seniors"
                   onUploadComplete={(url) => setFormData({ ...formData, senior_photo_url: url })}
                   currentFileUrl={formData.senior_photo_url}
                   label="Senior Photo"
                   description="Upload a photo for the senior list."
                 />
                 <div className="space-y-2">
                    <label className="text-[10px] font-black text-amber-700 uppercase ml-1">Senior Advice</label>
                    <textarea
                      value={formData.motivational_advice}
                      onChange={(e) => setFormData({ ...formData, motivational_advice: e.target.value })}
                      placeholder="Leave a message for other moderators..."
                      className="w-full px-5 py-4 bg-white border-amber-200 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-amber-500 h-24"
                    />
                 </div>
              </div>
            </div>
          )}

          <div className="pt-6 flex gap-4 border-t border-slate-100">
             <button
                type="button"
                onClick={onClose}
                className="flex-1 py-4 border-2 border-slate-200 text-slate-700 rounded-2xl text-sm font-black uppercase tracking-widest hover:bg-slate-50 transition-colors"
              >
                Discard
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="flex-[2] py-4 bg-primary-950 text-white rounded-2xl text-sm font-black uppercase tracking-widest hover:bg-slate-900 disabled:opacity-50 transition-colors shadow-xl shadow-primary-900/20"
              >
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
          </div>
          {saveError && (
            <div className="mx-6 mb-4 flex items-center gap-3 p-3 bg-red-50 border border-red-100 rounded-xl">
              <p className="text-xs font-bold text-red-700">{saveError}</p>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

// Add User Modal Component
function AddUserModal({ onClose, onSave }: { onClose: () => void; onSave: () => void }) {
  const [formData, setFormData] = useState({
    full_name: '',
    username: '',
    email: '',
    registration_number: '',
    role: 'moderator' as UserRole,
    level: '' as any,
    password: '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);

    try {
      // Use the secure Edge Function to create the user directly
      // Use standard signUp with a temporary client to avoid signing out the Admin
      // and to bypass the Edge Function entirely since Docker isn't available.
      const tempClient = createClient(
        import.meta.env.VITE_SUPABASE_URL,
        import.meta.env.VITE_SUPABASE_ANON_KEY,
        { auth: { persistSession: false, autoRefreshToken: false } }
      );

      const { data, error } = await tempClient.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: {
          data: {
            full_name: formData.full_name,
            username: formData.username.toLowerCase().replace(/\s+/g, ''),
            reg_number: formData.registration_number, // The SQL trigger expects reg_number
            level: formData.level,
            role: 'moderator',
            admin_created: true // Bypasses the 'check_registration_allowed' trigger!
          }
        }
      });

      if (error) {
        throw new Error(`Auth Error: ${error.message}`);
      }

      // If signUp successful, the SQL handle_new_user() trigger automatically inserts into public.users.
      // But we need to update the role since the trigger defaults to moderator if it doesn't read role.
      // We will do a manual update just in case using the main admin client
      if (data.user) {
        await supabase.from('users').update({ role: formData.role, is_verified: true }).eq('id', data.user.id);
      }

      onSave();
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to add user');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md animate-in fade-in duration-300">
      <div className="bg-white w-full max-w-xl rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 border border-white">
        <div className="px-8 py-6 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900 uppercase tracking-tight">Add New Moderator</h2>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Create a new moderator account.</p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all">
            <X className="w-6 h-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          {error && (
            <div className="p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-700 text-xs font-bold animate-in slide-in-from-top-2">
              <ShieldAlert className="h-5 w-5" />
              {error}
            </div>
          )}

          <div className="space-y-4">
             <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                   <label className="text-[10px] font-black text-gray-400 uppercase ml-1">Full Name</label>
                   <input
                     type="text"
                     required
                     value={formData.full_name}
                     onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                     className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:ring-2 focus:ring-primary-950/10 focus:border-primary-950 transition-all placeholder:text-slate-400"
                     placeholder="e.g., Abubakar Yusuf"
                   />
                </div>
                <div className="space-y-2">
                   <label className="text-[10px] font-black text-gray-400 uppercase ml-1">Username (@handle)</label>
                   <input
                     type="text"
                     required={formData.role !== 'moderator'}
                     value={formData.username}
                     onChange={(e) => setFormData({ ...formData, username: e.target.value.toLowerCase().replace(/\s+/g, '') })}
                     className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:ring-2 focus:ring-primary-950/10 focus:border-primary-950 transition-all placeholder:text-slate-400"
                     placeholder={formData.role === 'moderator' ? "Optional for moderators" : "abuyusuf"}
                   />
                </div>
             </div>

             <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                   <label className="text-[10px] font-black text-gray-400 uppercase ml-1">Email Address</label>
                   <input
                     type="email"
                     required
                     value={formData.email}
                     onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                     className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:ring-2 focus:ring-primary-950/10 focus:border-primary-950 transition-all placeholder:text-slate-400"
                     placeholder="moderator@naliss.edu"
                   />
                </div>
                <div className="space-y-2">
                   <label className="text-[10px] font-black text-gray-400 uppercase ml-1">Reg Number</label>
                   <input
                     type="text"
                     required={formData.role !== 'moderator'}
                     value={formData.registration_number}
                     onChange={(e) => setFormData({ ...formData, registration_number: e.target.value })}
                     className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:ring-2 focus:ring-primary-950/10 focus:border-primary-950 transition-all placeholder:text-slate-400"
                     placeholder={formData.role === 'moderator' ? "Optional for moderators" : "U1/23/BLIS/0000"}
                   />
                </div>
             </div>

             <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                   <label className="text-[10px] font-black text-gray-400 uppercase ml-1">
                     {formData.role === 'moderator' ? 'Assigned Level' : 'Current Level'}
                   </label>
                   <select
                     value={formData.level}
                     required
                     onChange={(e) => setFormData({ ...formData, level: e.target.value as any })}
                     className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:ring-2 focus:ring-primary-950/10 focus:border-primary-950 appearance-none transition-all"
                   >
                     <option value="" disabled>Select Level</option>
                     {['100', '200', '300', '400'].map(level => (
                       <option key={level} value={level}>LEVEL {level}</option>
                     ))}
                   </select>
                </div>
                <div className="space-y-2">
                   <label className="text-[10px] font-black text-gray-400 uppercase ml-1">User Role</label>
                   <select
                     value={formData.role}
                     onChange={(e) => setFormData({ ...formData, role: e.target.value as UserRole })}
                     className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:ring-2 focus:ring-primary-950/10 focus:border-primary-950 appearance-none transition-all"
                   >
                     {['moderator', 'moderator'].map(role => (
                       <option key={role} value={role}>{role.toUpperCase()}</option>
                     ))}
                   </select>
                </div>
             </div>
          </div>

          {/* Password field — admin must set a real temporary password */}
          <div className="space-y-2">
            <label className="text-[10px] font-black text-gray-400 uppercase ml-1">Temporary Password *</label>
            <input
              type="password"
              required
              minLength={8}
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:ring-2 focus:ring-primary-950/10 focus:border-primary-950 transition-all"
              placeholder="Min 8 characters — moderator must change on first login"
            />
            <p className="text-[10px] text-amber-600 font-bold ml-1">⚠️ Share this password securely with the moderator. They should change it immediately.</p>
          </div>

          <div className="pt-6 flex gap-4 border-t border-slate-100">
             <button
                type="button"
                onClick={onClose}
                className="flex-1 py-4 border-2 border-slate-200 text-slate-700 rounded-2xl text-sm font-black uppercase tracking-widest hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="flex-[2] py-4 bg-primary-950 text-white rounded-2xl text-sm font-bold uppercase tracking-widest hover:bg-slate-900 disabled:opacity-50 transition-all shadow-xl shadow-primary-900/20"
              >
                {isSaving ? 'Processing...' : 'Add Moderator'}
              </button>
          </div>
        </form>
      </div>
    </div>
  );
}
