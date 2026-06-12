import { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth.store';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import ErrorState from '../components/ui/ErrorState';
import Modal from '../components/ui/Modal';
import {
  ShieldCheck,
  KeyRound,
  History,
  Smartphone,
  Laptop,
  Globe,
  Trash2,
  AlertTriangle,
  CheckCircle,
  Eye,
  EyeOff,
  Mail,
} from 'lucide-react';

interface UserSession {
  id: string;
  user_id: string;
  device_id: string;
  device_name: string;
  os: string;
  ip_address: string;
  is_active: boolean;
  created_at: string;
  last_active_at: string;
  users?: {
    full_name: string;
    email: string;
    role: string;
  };
}

export default function SecurityPage() {
  const { profile } = useAuthStore();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState<string>('');

  // Email Change state
  const [newEmail, setNewEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [isAwaitingEmailOtp, setIsAwaitingEmailOtp] = useState(false);
  const [isUpdatingEmail, setIsUpdatingEmail] = useState(false);
  const [emailSuccess, setEmailSuccess] = useState('');
  const [emailError, setEmailError] = useState('');

  // Password Change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [passwordError, setPasswordError] = useState('');

  // Session Termination state
  const [sessionToTerminate, setSessionToTerminate] = useState<UserSession | null>(null);
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isVerifyingPassword, setIsVerifyingPassword] = useState(false);
  const [terminateError, setTerminateError] = useState('');

  // Flash timer refs
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearMessages = () => {
    setPasswordSuccess('');
    setPasswordError('');
    setEmailSuccess('');
    setEmailError('');
    if (flashTimer.current) clearTimeout(flashTimer.current);
  };

  const showPasswordSuccess = (msg: string) => {
    setPasswordError('');
    setPasswordSuccess(msg);
    flashTimer.current = setTimeout(() => setPasswordSuccess(''), 4000);
  };

  const showPasswordError = (msg: string) => {
    setPasswordSuccess('');
    setPasswordError(msg);
    flashTimer.current = setTimeout(() => setPasswordError(''), 6000);
  };

  // ── Fetch Sessions ─────────────────────────────────────────────────────────
  const fetchSessions = async (silent = false) => {
    if (!profile) return;
    if (!silent) setIsLoading(true);
    try {
      const storedDeviceId = localStorage.getItem('naliss_admin_device_id') || '';
      setCurrentDeviceId(storedDeviceId);

      let query = supabase
        .from('user_sessions')
        .select('*, users(full_name, email, role)')
        .order('last_active_at', { ascending: false });

      if (profile.role !== 'super_admin') {
        query = query.eq('user_id', profile.id);
      }

      const { data, error: fetchErr } = await query;
      if (fetchErr) throw fetchErr;

      // Filter to only show admin/moderator sessions
      const list = (data as UserSession[]) || [];
      const filteredList = list.filter(
        (s) =>
          s.users && (s.users.role === 'super_admin' || s.users.role === 'moderator')
      );

      setSessions(filteredList);
    } catch (err: any) {
      console.error('Failed to fetch sessions:', err);
      if (!silent) setError('Failed to load device logs.');
    } finally {
      if (!silent) setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();

    // Realtime changes listener to update logs on the fly
    const channel = supabase
      .channel('admin_sessions_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_sessions' },
        () => {
          fetchSessions(true);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, [profile]);

  // ── Email Update Handlers ──────────────────────────────────────────────────
  const handleEmailChangeRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError('');
    setEmailSuccess('');

    if (!newEmail || newEmail === profile?.email) {
      setEmailError('Please enter a new valid email address.');
      return;
    }

    setIsUpdatingEmail(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({
        email: newEmail,
      });

      if (updateError) throw updateError;

      setIsAwaitingEmailOtp(true);
      setEmailSuccess(`An OTP has been sent to ${newEmail}. Please enter it below.`);
    } catch (err: any) {
      console.error('Failed to request email change:', err);
      setEmailError(err.message || 'Failed to initiate email change.');
    } finally {
      setIsUpdatingEmail(false);
    }
  };

  const handleOtpVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError('');
    setEmailSuccess('');

    if (!otpCode || otpCode.length !== 6) {
      setEmailError('Please enter a valid 6-digit OTP code.');
      return;
    }

    setIsUpdatingEmail(true);
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: newEmail,
        token: otpCode,
        type: 'email_change',
      });

      if (verifyError) throw verifyError;

      // Update public.users
      if (profile?.id) {
        await supabase.from('users').update({ email: newEmail }).eq('id', profile.id);
        useAuthStore.getState().updateProfile({ email: newEmail });
      }

      setEmailSuccess('Email address updated successfully!');
      setIsAwaitingEmailOtp(false);
      setNewEmail('');
      setOtpCode('');
    } catch (err: any) {
      console.error('Failed to verify OTP:', err);
      setEmailError(err.message || 'Invalid or expired OTP.');
    } finally {
      setIsUpdatingEmail(false);
    }
  };

  // ── Password Update Handler ────────────────────────────────────────────────
  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();

    if (!currentPassword) {
      showPasswordError('Current password is required.');
      return;
    }
    if (newPassword.length < 8) {
      showPasswordError('New password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      showPasswordError('New passwords do not match.');
      return;
    }

    setIsUpdatingPassword(true);
    try {
      // 1. Re-authenticate first to verify current password
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: profile?.email || '',
        password: currentPassword,
      });

      if (authError) {
        showPasswordError('Incorrect current password.');
        setIsUpdatingPassword(false);
        return;
      }

      // 2. Perform the update
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) throw updateError;

      showPasswordSuccess('Password updated successfully!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (err: any) {
      console.error('Failed to update password:', err);
      showPasswordError(err.message || 'Failed to update password. Try again.');
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  // ── Terminate Session Handlers ─────────────────────────────────────────────
  const initiateTermination = (session: UserSession) => {
    setSessionToTerminate(session);
    setConfirmPasswordInput('');
    setTerminateError('');
    setShowConfirmModal(true);
  };

  const handleTerminateSession = async () => {
    if (!sessionToTerminate || !profile) return;
    if (!confirmPasswordInput) {
      setTerminateError('Please enter your password.');
      return;
    }

    setIsVerifyingPassword(true);
    setTerminateError('');

    try {
      // 1. Re-authenticate the executing user using their own password
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: profile.email,
        password: confirmPasswordInput,
      });

      if (authError) {
        setTerminateError('Incorrect password. Please try again.');
        setIsVerifyingPassword(false);
        return;
      }

      // 2. Update session status in DB
      const { error: updateError } = await supabase
        .from('user_sessions')
        .update({ is_active: false })
        .eq('id', sessionToTerminate.id);

      if (updateError) throw updateError;

      // 3. If terminating current device, force logout
      if (sessionToTerminate.device_id === currentDeviceId && sessionToTerminate.user_id === profile.id) {
        setShowConfirmModal(false);
        await supabase.auth.signOut();
        useAuthStore.getState().signOut();
        return;
      }

      setShowConfirmModal(false);
      setSessionToTerminate(null);
      setConfirmPasswordInput('');
      fetchSessions(true);
    } catch (err: any) {
      console.error('Failed to terminate session:', err);
      setTerminateError(err.message || 'Failed to terminate session.');
    } finally {
      setIsVerifyingPassword(false);
    }
  };

  const getDeviceIcon = (os: string) => {
    const lower = (os || '').toLowerCase();
    if (lower.includes('android')) return <Smartphone className="w-6 h-6 text-green-500" />;
    if (lower.includes('ios') || lower.includes('mac') || lower.includes('apple')) return <Laptop className="w-6 h-6 text-slate-800" />;
    if (lower.includes('windows')) return <Laptop className="w-6 h-6 text-blue-500" />;
    return <Globe className="w-6 h-6 text-gray-500" />;
  };

  const formatSessionTime = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' at ' + date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    } catch {
      return dateStr;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-20">
        <ErrorState onRetry={() => fetchSessions()} message={error} />
      </div>
    );
  }

  return (
    <div className="space-y-12 pb-20 animate-in fade-in duration-700">
      {/* Header */}
      <div className="bg-primary-950 rounded-[3rem] p-10 lg:p-14 text-white shadow-2xl relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-primary-400/5 rounded-full blur-[140px] -mr-48 -mt-48 transition-all duration-1000 group-hover:bg-primary-400/10" />
        <div className="relative z-10">
          <div className="flex flex-wrap items-center gap-4 mb-4">
            <div className="px-4 py-1.5 bg-primary-400/20 border border-primary-300/30 rounded-xl flex items-center gap-2.5">
              <ShieldCheck className="w-4 h-4 text-primary-400" />
              <span className="text-[10px] font-black uppercase tracking-[0.25em] text-primary-300 italic">Security Guard</span>
            </div>
          </div>
          <h1 className="text-4xl lg:text-5xl font-black leading-[1.1] tracking-tight">
            Security Settings <br/>
            <span className="text-primary-400">Identity & Device Management.</span>
          </h1>
          <p className="text-primary-100/50 mt-8 text-lg font-medium max-w-xl">
            Secure your administrator account, manage passwords, and view or terminate active sessions.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* ── Settings Column ── */}
        <div className="lg:col-span-5 flex flex-col gap-8">
          
          {/* ── Email Change Card ── */}
          <div className="bg-white rounded-[2.5rem] shadow-sm border border-gray-100 overflow-hidden flex flex-col group/card hover:shadow-xl transition-all duration-500">
            <div className="px-8 py-8 bg-blue-50/50 border-b border-blue-100 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-black text-gray-900 flex items-center gap-3">
                  <div className="p-2 bg-blue-100 rounded-xl">
                    <Mail className="w-5 h-5 text-blue-600" />
                  </div>
                  Change Email
                </h2>
                <p className="text-xs font-bold text-gray-400 mt-1 uppercase tracking-widest italic group-hover/card:text-blue-600 transition-colors">Identity Update</p>
              </div>
            </div>

            <div className="p-8 space-y-6 flex-1">
              {emailSuccess && (
                <div className="p-4 bg-green-50 border border-green-100 text-green-700 rounded-2xl flex items-center gap-3 text-sm font-bold animate-in zoom-in duration-300">
                  <CheckCircle className="w-5 h-5 shrink-0" />
                  <span>{emailSuccess}</span>
                </div>
              )}

              {emailError && (
                <div className="p-4 bg-red-50 border border-red-100 text-red-700 rounded-2xl flex items-center gap-3 text-sm font-bold animate-in zoom-in duration-300">
                  <AlertTriangle className="w-5 h-5 shrink-0" />
                  <span>{emailError}</span>
                </div>
              )}

              {!isAwaitingEmailOtp ? (
                <form onSubmit={handleEmailChangeRequest} className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Current Email</label>
                    <input
                      type="text"
                      value={profile?.email || ''}
                      disabled
                      className="w-full px-5 py-4 bg-gray-100 border-none rounded-2xl text-sm font-semibold text-gray-500 cursor-not-allowed"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">New Email</label>
                    <input
                      type="email"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      className="w-full px-5 py-4 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-blue-600 text-sm font-semibold text-gray-800"
                      placeholder="admin@example.com"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isUpdatingEmail}
                    className="w-full flex items-center justify-center gap-3 px-8 py-5 bg-blue-600 text-white rounded-[1.5rem] text-[10px] font-black uppercase tracking-[0.3em] hover:bg-blue-700 disabled:opacity-50 transition-all shadow-xl shadow-blue-600/20 active:scale-95 mt-4"
                  >
                    {isUpdatingEmail ? 'Requesting...' : 'Request Email Change'}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleOtpVerification} className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Verification Code (OTP)</label>
                    <input
                      type="text"
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value)}
                      className="w-full px-5 py-4 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-blue-600 text-sm font-semibold text-gray-800 tracking-widest text-center text-lg"
                      placeholder="000000"
                      maxLength={6}
                      required
                    />
                  </div>
                  <div className="flex gap-4">
                    <button
                      type="button"
                      onClick={() => { setIsAwaitingEmailOtp(false); setEmailError(''); setEmailSuccess(''); }}
                      className="flex-1 py-5 bg-gray-50 text-gray-400 rounded-[1.5rem] text-[10px] font-black uppercase tracking-widest hover:bg-gray-100 transition-all border border-gray-100"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isUpdatingEmail}
                      className="flex-1 py-5 bg-blue-600 text-white rounded-[1.5rem] text-[10px] font-black uppercase tracking-[0.3em] hover:bg-blue-700 disabled:opacity-50 transition-all shadow-xl shadow-blue-600/20"
                    >
                      {isUpdatingEmail ? 'Verifying...' : 'Verify OTP'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>

          {/* ── Password Change Card ── */}
          <div className="bg-white rounded-[2.5rem] shadow-sm border border-gray-100 overflow-hidden flex flex-col group/card hover:shadow-xl transition-all duration-500">
          <div className="px-8 py-8 bg-primary-50/50 border-b border-primary-100 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-black text-gray-900 flex items-center gap-3">
                <div className="p-2 bg-primary-100 rounded-xl">
                  <KeyRound className="w-5 h-5 text-primary-600" />
                </div>
                Change Password
              </h2>
              <p className="text-xs font-bold text-gray-400 mt-1 uppercase tracking-widest italic group-hover/card:text-primary-600 transition-colors">Credentials Update</p>
            </div>
          </div>

          <form onSubmit={handlePasswordChange} className="p-8 space-y-6 flex-1">
            {passwordSuccess && (
              <div className="p-4 bg-green-50 border border-green-100 text-green-700 rounded-2xl flex items-center gap-3 text-sm font-bold animate-in zoom-in duration-300">
                <CheckCircle className="w-5 h-5 shrink-0" />
                <span>{passwordSuccess}</span>
              </div>
            )}

            {passwordError && (
              <div className="p-4 bg-red-50 border border-red-100 text-red-700 rounded-2xl flex items-center gap-3 text-sm font-bold animate-in zoom-in duration-300">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <span>{passwordError}</span>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Current Password</label>
              <div className="relative">
                <input
                  type={showCurrentPassword ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full px-5 py-4 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-primary-950 text-sm font-semibold text-gray-800"
                  placeholder="••••••••"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  className="absolute right-5 top-4 text-gray-400 hover:text-gray-600"
                >
                  {showCurrentPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">New Password</label>
              <div className="relative">
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-5 py-4 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-primary-950 text-sm font-semibold text-gray-800"
                  placeholder="At least 8 characters"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-5 top-4 text-gray-400 hover:text-gray-600"
                >
                  {showNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Confirm New Password</label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  className="w-full px-5 py-4 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-primary-950 text-sm font-semibold text-gray-800"
                  placeholder="Repeat new password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-5 top-4 text-gray-400 hover:text-gray-600"
                >
                  {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isUpdatingPassword}
              className="w-full flex items-center justify-center gap-3 px-8 py-5 bg-primary-950 text-white rounded-[1.5rem] text-[10px] font-black uppercase tracking-[0.3em] hover:bg-primary-900 disabled:opacity-50 transition-all shadow-xl active:scale-95 mt-4"
            >
              {isUpdatingPassword ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        </div>
        </div>

        {/* ── Device Sessions Card ── */}
        <div className="lg:col-span-7 bg-white rounded-[2.5rem] shadow-sm border border-gray-100 overflow-hidden flex flex-col group/card hover:shadow-xl transition-all duration-500">
          <div className="px-8 py-8 bg-primary-50/50 border-b border-primary-100 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-black text-gray-900 flex items-center gap-3">
                <div className="p-2 bg-primary-100 rounded-xl">
                  <History className="w-5 h-5 text-primary-600" />
                </div>
                Active Device Logs
              </h2>
              <p className="text-xs font-bold text-gray-400 mt-1 uppercase tracking-widest italic group-hover/card:text-primary-600 transition-colors">
                {profile?.role === 'super_admin' ? 'All Portal Admins & Moderators' : 'Your Sessions'}
              </p>
            </div>
          </div>

          <div className="p-8 flex-1 overflow-x-auto">
            {sessions.length === 0 ? (
              <div className="py-12 text-center">
                <div className="p-4 bg-gray-50 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4 border border-gray-100">
                  <ShieldCheck className="w-8 h-8 text-gray-300" />
                </div>
                <p className="text-xs font-black text-gray-400 uppercase tracking-widest italic">No active sessions logs found</p>
              </div>
            ) : (
              <div className="min-w-[500px]">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="pb-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Device</th>
                      {profile?.role === 'super_admin' && (
                        <th className="pb-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">User / Role</th>
                      )}
                      <th className="pb-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">IP Address</th>
                      <th className="pb-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Last Active</th>
                      <th className="pb-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {sessions.map((s) => {
                      const isCurrent = s.device_id === currentDeviceId && s.user_id === profile?.id;
                      return (
                        <tr key={s.id} className={`hover:bg-gray-50/50 transition-colors ${!s.is_active ? 'opacity-50' : ''}`}>
                          <td className="py-4 pr-3 flex items-center gap-3">
                            <div className="p-2.5 bg-gray-50 rounded-xl border border-gray-100 shadow-sm shrink-0">
                              {getDeviceIcon(s.os)}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-gray-900">{s.device_name}</span>
                                {isCurrent && (
                                  <span className="px-2 py-0.5 text-[9px] font-extrabold uppercase bg-green-100 text-green-800 rounded-md tracking-wider">
                                    Current
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">{s.os}</span>
                            </div>
                          </td>

                          {profile?.role === 'super_admin' && (
                            <td className="py-4 pr-3">
                              <div className="text-sm font-bold text-gray-800">{s.users?.full_name || 'Admin User'}</div>
                              <div className="text-[10px] text-gray-400 font-semibold flex items-center gap-1.5 mt-0.5">
                                <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase ${
                                  s.users?.role === 'super_admin' 
                                    ? 'bg-red-50 text-red-700 border border-red-100' 
                                    : 'bg-primary-50 text-primary-800 border border-primary-100'
                                }`}>
                                  {s.users?.role === 'super_admin' ? 'Super Admin' : 'Moderator'}
                                </span>
                              </div>
                            </td>
                          )}

                          <td className="py-4 pr-3">
                            <span className="text-xs font-semibold text-gray-600">{s.ip_address || 'Unknown'}</span>
                          </td>

                          <td className="py-4 pr-3">
                            <span className="text-xs font-semibold text-gray-500">
                              {s.is_active ? (
                                isCurrent ? 'Active now' : formatSessionTime(s.last_active_at)
                              ) : (
                                'Terminated'
                              )}
                            </span>
                          </td>

                          <td className="py-4 text-right">
                            {s.is_active ? (
                              <button
                                onClick={() => initiateTermination(s)}
                                className="inline-flex items-center justify-center p-2 rounded-xl text-gray-400 hover:text-red-600 hover:bg-red-50 transition-all border border-transparent hover:border-red-100"
                                title="Terminate session"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            ) : (
                              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest italic pr-2">Ended</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      <Modal
        isOpen={showConfirmModal}
        onClose={() => !isVerifyingPassword && setShowConfirmModal(false)}
        title="Confirm Session Termination"
      >
        <div className="space-y-6">
          <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 flex gap-4">
            <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0" />
            <div>
              <h4 className="text-sm font-bold text-amber-800 uppercase tracking-tight">Warning</h4>
              <p className="text-xs text-amber-700 leading-relaxed mt-1">
                You are about to terminate the active session on <strong>{sessionToTerminate?.device_name}</strong>
                {sessionToTerminate?.users && ` associated with ${sessionToTerminate.users.full_name} (${sessionToTerminate.users.email})`}.
                {sessionToTerminate?.device_id === currentDeviceId && sessionToTerminate.user_id === profile?.id && (
                  <span className="font-extrabold block mt-2 text-red-700 uppercase">
                    ⚠️ Since this is your current device, you will be logged out of the portal immediately.
                  </span>
                )}
              </p>
            </div>
          </div>

          {terminateError && (
            <div className="p-4 bg-red-50 border border-red-100 text-red-700 rounded-2xl flex items-center gap-3 text-sm font-bold animate-in zoom-in duration-300">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span>{terminateError}</span>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Confirm with Your Password</label>
            <input
              type="password"
              value={confirmPasswordInput}
              onChange={(e) => setConfirmPasswordInput(e.target.value)}
              className="w-full px-5 py-4 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-primary-950 text-sm font-semibold text-gray-800"
              placeholder="Enter your administrator password"
              required
            />
          </div>

          <div className="flex gap-4 pt-2">
            <button
              onClick={() => setShowConfirmModal(false)}
              disabled={isVerifyingPassword}
              className="flex-1 py-4 bg-gray-50 text-gray-400 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-gray-100 transition-all border border-gray-100"
            >
              Cancel
            </button>
            <button
              onClick={handleTerminateSession}
              disabled={isVerifyingPassword}
              className="flex-1 py-4 bg-red-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-red-700 transition-all shadow-lg shadow-red-600/10 flex items-center justify-center gap-2"
            >
              {isVerifyingPassword ? 'Verifying...' : 'Terminate Session'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
