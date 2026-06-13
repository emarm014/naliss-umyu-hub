import { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import ErrorState from '../components/ui/ErrorState';
import { 
  Wrench, 
  AlertTriangle, 
  CheckCircle, 
  Clock, 
  Users, 
  Save, 
  ShieldCheck, 
  ArrowRight,
  RefreshCw,
  Activity,
  Zap,
} from 'lucide-react';
import Modal from '../components/ui/Modal';

interface SettingRow {
  key: string;
  value: string;
}

interface FormData {
  maintenance_mode: boolean;
  maintenance_message: string;
  maintenance_estimated_end: string;
  read_only_mode: boolean;
  allow_registration: boolean;
  restrict_moderators: boolean;
  current_academic_year: string;
}

const SETTING_KEYS = [
  'maintenance_mode',
  'maintenance_message',
  'maintenance_estimated_end',
  'read_only_mode',
  'allow_registration',
  'restrict_moderators',
  'current_academic_year',
] as const;

function parseSettings(rows: SettingRow[]): FormData {
  const map: Record<string, string> = {};
  rows.forEach(r => { map[r.key] = r.value; });
  return {
    maintenance_mode: map.maintenance_mode === 'true',
    maintenance_message: map.maintenance_message ?? '',
    maintenance_estimated_end: map.maintenance_estimated_end ?? '',
    read_only_mode: map.read_only_mode === 'true',
    allow_registration: map.allow_registration !== 'false',
    restrict_moderators: map.restrict_moderators === 'true',
    current_academic_year: map.current_academic_year ?? '2025/2026',
  };
}

export default function SettingsPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [showTransitionModal, setShowTransitionModal] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const [formData, setFormData] = useState<FormData>({
    maintenance_mode: false,
    maintenance_message: '',
    maintenance_estimated_end: '',
    read_only_mode: false,
    allow_registration: true,
    restrict_moderators: false,
    current_academic_year: '2025/2026',
  });

  // Keep a ref to formData so async callbacks always read the latest value
  const formDataRef = useRef(formData);
  useEffect(() => { formDataRef.current = formData; }, [formData]);

  // Track submitting state in a ref to avoid stale closures in realtime listener
  const isSubmittingRef = useRef(isSubmitting);
  useEffect(() => { isSubmittingRef.current = isSubmitting; }, [isSubmitting]);

  // ── Fetch from DB ────────────────────────────────────────────────────────────
  const fetchSettings = async (silent = false) => {
    if (!silent) { setIsLoading(true); setError(null); }
    try {
      const { data, error: fetchError } = await supabase
        .from('system_settings')
        .select('key, value')
        .in('key', [...SETTING_KEYS]);

      if (fetchError) throw fetchError;
      if (data && data.length > 0) {
        setFormData(parseSettings(data as SettingRow[]));
      }
    } catch {
      if (!silent) setError('Failed to load settings.');
    } finally {
      if (!silent) setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();

    // Realtime subscription — updates UI instantly when DB changes.
    const channel = supabase
      .channel('admin_settings_live')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'system_settings' },
        (payload) => {
          const record = payload.new as any;
          if (!record?.key) return;
          const { key, value } = record;

          // If we are currently saving changes, ignore realtime updates to prevent race conditions
          if (isSubmittingRef.current) return;

          setFormData(prev => {
            if (key === 'maintenance_mode') return { ...prev, maintenance_mode: value === 'true' };
            if (key === 'read_only_mode') return { ...prev, read_only_mode: value === 'true' };
            if (key === 'allow_registration') return { ...prev, allow_registration: value !== 'false' };
            if (key === 'restrict_moderators') return { ...prev, restrict_moderators: value === 'true' };
            if (key === 'maintenance_message') return { ...prev, maintenance_message: value ?? '' };
            if (key === 'maintenance_estimated_end') return { ...prev, maintenance_estimated_end: value ?? '' };
            if (key === 'current_academic_year') return { ...prev, current_academic_year: value ?? '' };
            return prev;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // ── Save a single key to DB ──────────────────────────────────────────────────
  const saveSetting = async (key: string, value: string): Promise<void> => {
    const { error } = await supabase
      .from('system_settings')
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw error;
  };

  // ── Toggle handler — updates state locally, saved on button click ───────────
  const handleToggle = (key: 'maintenance_mode' | 'read_only_mode' | 'allow_registration' | 'restrict_moderators') => {
    setFormData(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // ── Flash helpers ────────────────────────────────────────────────────────────
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearMessages = () => {
    setSuccessMsg('');
    setErrorMsg('');
    if (flashTimer.current) clearTimeout(flashTimer.current);
  };

  const showSuccess = (msg: string) => {
    setErrorMsg('');
    setSuccessMsg(msg);
    flashTimer.current = setTimeout(() => setSuccessMsg(''), 4000);
  };

  const showError = (msg: string) => {
    setSuccessMsg('');
    setErrorMsg(msg);
    flashTimer.current = setTimeout(() => setErrorMsg(''), 6000);
  };

  // ── Academic year transition ─────────────────────────────────────────────────
  const handleAcademicTransition = async () => {
    setIsTransitioning(true);
    try {
      const { error } = await supabase.rpc('perform_academic_year_transition');
      if (error) throw error;
      showSuccess('Academic Year Transition completed successfully!');
      setShowTransitionModal(false);
      fetchSettings();
    } catch (err: unknown) {
      showError((err as any)?.message || 'Transition failed. Check database permissions.');
    } finally {
      setIsTransitioning(false);
    }
  };

  // ── Save all settings and toggles ───────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    clearMessages();

    try {
      await Promise.all([
        saveSetting('maintenance_mode', String(formData.maintenance_mode)),
        saveSetting('maintenance_message', formData.maintenance_message),
        saveSetting('maintenance_estimated_end', formData.maintenance_estimated_end),
        saveSetting('read_only_mode', String(formData.read_only_mode)),
        saveSetting('allow_registration', String(formData.allow_registration)),
        saveSetting('restrict_moderators', String(formData.restrict_moderators)),
        saveSetting('current_academic_year', formData.current_academic_year),
      ]);
      showSuccess('Settings saved successfully!');
      fetchSettings(true); // silent re-fetch to confirm
    } catch {
      showError('Failed to save settings. Please ensure you have administrative permissions.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────
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
        <ErrorState onRetry={() => fetchSettings()} message={error} />
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
              <span className="text-[10px] font-black uppercase tracking-[0.25em] text-primary-300 italic">System Core</span>
            </div>
          </div>
          <h1 className="text-4xl lg:text-5xl font-black leading-[1.1] tracking-tight">
            System Settings <br/>
            <span className="text-primary-400">Controls & Infrastructure.</span>
          </h1>
          <p className="text-primary-100/50 mt-8 text-lg font-medium max-w-xl">
            Manage system maintenance, student registration, and academic year transitions.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

          {/* ── Maintenance Mode ── */}
          <div className="bg-white rounded-[2.5rem] shadow-sm border border-gray-100 overflow-hidden flex flex-col group/card hover:shadow-xl transition-all duration-500">
            <div className="px-8 py-8 bg-amber-50/50 border-b border-amber-100 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-black text-gray-900 flex items-center gap-3">
                  <div className="p-2 bg-amber-100 rounded-xl">
                    <Wrench className="w-5 h-5 text-amber-600" />
                  </div>
                  Maintenance Mode
                </h2>
                <p className="text-xs font-bold text-gray-400 mt-1 uppercase tracking-widest italic group-hover/card:text-amber-600 transition-colors">System Access Control</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleToggle('maintenance_mode')}
                  aria-pressed={formData.maintenance_mode}
                  className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors shadow-inner ${
                    formData.maintenance_mode ? 'bg-amber-600' : 'bg-gray-200'
                  }`}
                >
                  <span className={`h-6 w-6 transform rounded-full bg-white shadow-md transition-transform duration-200 ${formData.maintenance_mode ? 'translate-x-7' : 'translate-x-1'}`} />
                </button>
              </div>
            </div>

            <div className="p-8 space-y-6 flex-1">
              {formData.maintenance_mode ? (
                <div className="space-y-6 animate-in slide-in-from-top-4 duration-500">
                  <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200 flex gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-xs font-bold text-amber-800 leading-relaxed uppercase tracking-tight">Students are currently blocked from using the app. Proceed with caution.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Broadcast Message</label>
                    <textarea
                      value={formData.maintenance_message}
                      onChange={(e) => setFormData(prev => ({ ...prev, maintenance_message: e.target.value }))}
                      rows={3}
                      className="w-full px-5 py-4 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-amber-500 text-sm font-bold text-gray-800 placeholder:text-gray-300"
                      placeholder="Maintenance explanation..."
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Estimated Completion</label>
                    <div className="relative">
                      <input
                        type="text"
                        value={formData.maintenance_estimated_end}
                        onChange={(e) => setFormData(prev => ({ ...prev, maintenance_estimated_end: e.target.value }))}
                        className="w-full px-5 py-4 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-amber-500 text-sm font-bold text-gray-800 italic"
                        placeholder="e.g., 2 hours, 6:00 PM"
                      />
                      <Clock className="absolute right-5 top-4 w-5 h-5 text-gray-300" />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="py-12 text-center">
                  <div className="p-4 bg-gray-50 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4 border border-gray-100">
                    <CheckCircle className="w-8 h-8 text-gray-300" />
                  </div>
                  <p className="text-xs font-black text-gray-400 uppercase tracking-widest italic">All systems operational</p>
                </div>
              )}

              <div className="pt-6 border-t border-gray-100 mt-auto flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-black text-red-600 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-red-600" />
                    Restrict Moderators
                  </h3>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tight">Block all moderator access globally</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleToggle('restrict_moderators')}
                    aria-pressed={formData.restrict_moderators}
                    className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors shadow-inner ${
                      formData.restrict_moderators ? 'bg-red-600' : 'bg-gray-200'
                    }`}
                  >
                    <span className={`h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-200 ${formData.restrict_moderators ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ── Registration & Read-Only ── */}
          <div className="bg-white rounded-[2.5rem] shadow-sm border border-gray-100 overflow-hidden flex flex-col group/card hover:shadow-xl transition-all duration-500">
            <div className="px-8 py-8 bg-primary-50/50 border-b border-primary-100 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-black text-gray-900 flex items-center gap-3">
                  <div className="p-2 bg-primary-100 rounded-xl">
                    <Users className="w-5 h-5 text-primary-600" />
                  </div>
                  Registration Settings
                </h2>
                <p className="text-xs font-bold text-gray-400 mt-1 uppercase tracking-widest italic group-hover/card:text-primary-600 transition-colors">New Student Access</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleToggle('allow_registration')}
                  aria-pressed={formData.allow_registration}
                  className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors shadow-inner ${
                    formData.allow_registration ? 'bg-primary-950' : 'bg-gray-200'
                  }`}
                >
                  <span className={`h-6 w-6 transform rounded-full bg-white shadow-md transition-transform duration-200 ${formData.allow_registration ? 'translate-x-7' : 'translate-x-1'}`} />
                </button>
              </div>
            </div>

            <div className="p-8 space-y-6 flex-1">
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Current Academic Year</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={formData.current_academic_year}
                      onChange={(e) => setFormData(prev => ({ ...prev, current_academic_year: e.target.value }))}
                      className="w-full px-5 py-4 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-primary-950 text-sm font-black text-gray-900 italic"
                      placeholder="e.g., 2025/2026"
                    />
                    <Clock className="absolute right-5 top-4 w-5 h-5 text-gray-300" />
                  </div>
                  <p className="text-[10px] font-bold text-gray-400 italic px-1 uppercase tracking-tight">Set this before starting the academic year transition.</p>
                </div>

                <div className="pt-6 border-t border-gray-100 mt-6 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-black text-gray-900 flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-primary-600" />
                      Read-Only Mode
                    </h3>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tight">Block all posts and uploads</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleToggle('read_only_mode')}
                      aria-pressed={formData.read_only_mode}
                      className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors shadow-inner ${
                        formData.read_only_mode ? 'bg-primary-950' : 'bg-gray-200'
                      }`}
                    >
                      <span className={`h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-200 ${formData.read_only_mode ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Academic Transition */}
        <div className="bg-primary-950 rounded-[2.5rem] p-10 flex flex-col md:flex-row items-center justify-between gap-8 border border-primary-900 relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-r from-primary-400/5 to-transparent pointer-events-none" />
          <div className="flex items-center gap-6">
            <div className="p-5 bg-white/10 rounded-[1.5rem] border border-white/10 group-hover:rotate-12 transition-transform duration-700">
              <RefreshCw className="w-8 h-8 text-primary-400" />
            </div>
            <div>
              <h3 className="text-xl font-black text-white italic tracking-tight">Academic Year Transition</h3>
              <p className="text-primary-300/60 text-xs font-bold uppercase tracking-widest mt-1">Increment levels & archive graduates</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowTransitionModal(true)}
            className="flex items-center gap-3 px-8 py-5 bg-white text-primary-950 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] hover:bg-primary-400 transition-all hover:scale-105 active:scale-95 shadow-xl shadow-black/20"
          >
            Initialize Transition
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {/* Footer */}
        <div className="flex flex-col sm:flex-row items-center justify-between p-8 bg-gray-50/50 rounded-[2.5rem] border border-gray-100 gap-4">
          {successMsg ? (
            <div className="flex items-center gap-3 px-6 py-3 bg-green-50 text-green-600 rounded-2xl border border-green-100 animate-in zoom-in duration-300">
              <CheckCircle className="w-5 h-5" />
              <span className="text-[10px] font-black uppercase tracking-widest">{successMsg}</span>
            </div>
          ) : errorMsg ? (
            <div className="flex items-center gap-3 px-6 py-3 bg-red-50 text-red-600 rounded-2xl border border-red-100">
              <AlertTriangle className="w-5 h-5" />
              <span className="text-[10px] font-black uppercase tracking-widest">{errorMsg}</span>
            </div>
          ) : (
            <div className="flex items-center gap-3 px-2">
              <Zap className="w-4 h-4 text-green-500" />
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest italic">
                Review your changes above before clicking Save.
              </p>
            </div>
          )}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full sm:w-auto flex items-center justify-center gap-3 px-10 py-5 bg-primary-950 text-white rounded-[1.5rem] text-[10px] font-black uppercase tracking-[0.3em] hover:bg-primary-900 disabled:opacity-50 transition-all shadow-2xl shadow-primary-950/20 active:scale-95"
          >
            <Save className="w-5 h-5" />
            {isSubmitting ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>

      {/* Transition Modal */}
      <Modal
        isOpen={showTransitionModal}
        onClose={() => !isTransitioning && setShowTransitionModal(false)}
        title="Academic Year Transition"
      >
        <div className="p-10 text-center space-y-8">
          <div className="mx-auto flex items-center justify-center w-20 h-20 rounded-full bg-amber-50 border border-amber-100 text-amber-600">
            <RefreshCw className={`w-10 h-10 ${isTransitioning ? 'animate-spin' : ''}`} />
          </div>
          <div className="space-y-3">
            <h3 className="text-2xl font-black text-gray-950 italic tracking-tight">Start Academic Year Transition?</h3>
            <p className="text-sm font-bold text-gray-500 leading-relaxed uppercase tracking-tight">
              Executing this protocol will: graduate Level 400 students, permanently delete the Level 400 group, rename all remaining groups (300→400, 200→300, 100→200) preserving all chat history, promote all active students' levels, and create a fresh Level 100 group for incoming freshmen.
            </p>
          </div>
          <div className="p-4 bg-red-50 rounded-2xl border border-red-100 flex gap-4">
            <AlertTriangle className="w-6 h-6 text-red-500 shrink-0" />
            <p className="text-[10px] font-black text-red-700 text-left uppercase leading-relaxed tracking-tight">
              WARNING: This action is destructive and cannot be auto-reversed. Ensure the "Active Academic Year" setting is synchronized before proceeding.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-4">
            <button
              onClick={() => setShowTransitionModal(false)}
              disabled={isTransitioning}
              className="flex-1 py-5 bg-gray-50 text-gray-400 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-gray-100 transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleAcademicTransition}
              disabled={isTransitioning}
              className="flex-1 py-5 bg-primary-950 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-primary-900 transition-all shadow-xl shadow-primary-950/20 flex items-center justify-center gap-3"
            >
              {isTransitioning ? (
                <>
                  <Activity className="w-4 h-4 animate-spin" />
                  Processing...
                </>
              ) : 'Confirm Transition'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
