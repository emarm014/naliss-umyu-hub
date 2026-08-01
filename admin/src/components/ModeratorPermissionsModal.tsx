import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { X, Shield, Save, Loader2, CheckCircle2, AlertTriangle, Lock, Unlock } from 'lucide-react';
import type { User, AcademicLevel } from '../types';

interface ModeratorPermissionsModalProps {
    user: User;
    onClose: () => void;
    onSave: (message?: string) => void;
}

interface ModeratorPermissions {
    can_manage_announcements: boolean;
    can_manage_materials: boolean;
    can_manage_lecturers: boolean;
    can_manage_executives: boolean;
    can_manage_students: boolean;
    can_manage_groups: boolean;
    can_manage_group_media: boolean;
    can_manage_news: boolean;
    can_manage_archives: boolean;
    can_manage_messaging: boolean;
    can_manage_events: boolean;
    can_manage_past_questions: boolean;
    can_manage_courses: boolean;
    can_manage_cloud_archive: boolean;
    can_manage_graduates: boolean;
    can_manage_analytics: boolean;
    can_manage_logs: boolean;
    can_manage_settings: boolean;
    can_manage_storage: boolean;
    can_manage_security: boolean;
    assigned_level: AcademicLevel | null;
    assigned_levels: AcademicLevel[] | null;
    level_permissions: Record<string, Record<string, boolean>>;
}

const levelOptions: AcademicLevel[] = ['100', '200', '300', '400'];

const PERMISSION_ITEMS = [
    {
        key: 'can_manage_announcements' as const,
        label: 'Announcements',
        description: 'Post and manage official announcements & broadcasts',
        color: 'blue',
    },
    {
        key: 'can_manage_materials' as const,
        label: 'Materials',
        description: 'Upload learning materials and course files',
        color: 'green',
    },
    {
        key: 'can_manage_past_questions' as const,
        label: 'Past Questions',
        description: 'Upload and manage past exam question papers',
        color: 'purple',
    },
    {
        key: 'can_manage_students' as const,
        label: 'Students',
        description: 'View and manage student profiles and status',
        color: 'amber',
    },
    {
        key: 'can_manage_groups' as const,
        label: 'Community Groups',
        description: 'Create and manage department chat groups',
        color: 'blue',
    },
    {
        key: 'can_manage_group_media' as const,
        label: 'Group Media',
        description: 'Moderate media shared in community groups',
        color: 'purple',
    },
    {
        key: 'can_manage_events' as const,
        label: 'Events & Pools',
        description: 'Manage department events and competition pools',
        color: 'green',
    },
    {
        key: 'can_manage_news' as const,
        label: 'News Articles',
        description: 'Publish and edit department news',
        color: 'blue',
    },
    {
        key: 'can_manage_archives' as const,
        label: 'Archives',
        description: 'Access and manage historic departmental archives',
        color: 'amber',
    },
    {
        key: 'can_manage_storage' as const,
        label: 'Storage',
        description: 'Manage file storage usage and limits',
        color: 'green',
    },
];

const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    green: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    purple: 'bg-purple-50 border-purple-200 text-purple-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    red: 'bg-red-50 border-red-200 text-red-700',
};

export default function ModeratorPermissionsModal({ user, onClose, onSave }: ModeratorPermissionsModalProps) {
    const [permissions, setPermissions] = useState<ModeratorPermissions>({
        can_manage_announcements: false,
        can_manage_materials: false,
        can_manage_lecturers: false,
        can_manage_executives: false,
        can_manage_students: false,
        can_manage_groups: false,
        can_manage_group_media: false,
        can_manage_news: false,
        can_manage_archives: false,
        can_manage_messaging: false,
        can_manage_events: false,
        can_manage_past_questions: false,
        can_manage_courses: false,
        can_manage_cloud_archive: false,
        can_manage_graduates: false,
        can_manage_analytics: false,
        can_manage_logs: false,
        can_manage_settings: false,
        can_manage_storage: false,
        can_manage_security: false,
        assigned_level: null,
        assigned_levels: null,
        level_permissions: {},
    });
    const [originalPermissions, setOriginalPermissions] = useState<ModeratorPermissions | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedLevelTab, setSelectedLevelTab] = useState<AcademicLevel | null>(null);

    useEffect(() => {
        async function fetchPermissions() {
            try {
                const { data, error } = await supabase
                    .from('moderator_permissions')
                    .select('*')
                    .eq('user_id', user.id)
                    .single();

                if (error && error.code !== 'PGRST116') throw error;

                if (data) {
                    const loadedLevels: AcademicLevel[] | null = 
                        Array.isArray(data.assigned_levels) && data.assigned_levels.length > 0
                            ? (data.assigned_levels as AcademicLevel[])
                            : data.assigned_level
                                ? [data.assigned_level as AcademicLevel]
                                : null;

                    const loaded: ModeratorPermissions = {
                        can_manage_announcements: data.can_manage_announcements ?? false,
                        can_manage_materials: data.can_manage_materials ?? false,
                        can_manage_lecturers: data.can_manage_lecturers ?? false,
                        can_manage_executives: data.can_manage_executives ?? false,
                        can_manage_students: data.can_manage_students ?? false,
                        can_manage_groups: data.can_manage_groups ?? false,
                        can_manage_group_media: data.can_manage_group_media ?? false,
                        can_manage_news: data.can_manage_news ?? false,
                        can_manage_archives: data.can_manage_archives ?? false,
                        can_manage_messaging: data.can_manage_messaging ?? false,
                        can_manage_events: data.can_manage_events ?? false,
                        can_manage_past_questions: data.can_manage_past_questions ?? false,
                        can_manage_courses: data.can_manage_courses ?? false,
                        can_manage_cloud_archive: data.can_manage_cloud_archive ?? false,
                        can_manage_graduates: data.can_manage_graduates ?? false,
                        can_manage_analytics: data.can_manage_analytics ?? false,
                        can_manage_logs: data.can_manage_logs ?? false,
                        can_manage_settings: data.can_manage_settings ?? false,
                        can_manage_storage: data.can_manage_storage ?? false,
                        can_manage_security: data.can_manage_security ?? false,
                        assigned_level: data.assigned_level as AcademicLevel | null,
                        assigned_levels: loadedLevels,
                        level_permissions: data.level_permissions ?? {},
                    };
                    setPermissions(loaded);
                    setOriginalPermissions(loaded);
                } else {
                    const defaults: ModeratorPermissions = {
                        can_manage_announcements: false,
                        can_manage_materials: false,
                        can_manage_lecturers: false,
                        can_manage_executives: false,
                        can_manage_students: false,
                        can_manage_groups: false,
                        can_manage_group_media: false,
                        can_manage_news: false,
                        can_manage_archives: false,
                        can_manage_messaging: false,
                        can_manage_events: false,
                        can_manage_past_questions: false,
                        can_manage_courses: false,
                        can_manage_cloud_archive: false,
                        can_manage_graduates: false,
                        can_manage_analytics: false,
                        can_manage_logs: false,
                        can_manage_settings: false,
                        can_manage_storage: false,
                        can_manage_security: false,
                        assigned_level: null,
                        assigned_levels: null,
                        level_permissions: {},
                    };
                    setPermissions(defaults);
                    setOriginalPermissions(defaults);
                }
            } catch {
                setError('Failed to load permissions. Please try again.');
            } finally {
                setIsLoading(false);
            }
        }

        fetchPermissions();
    }, [user.id]);

    const handleSubmit = async (e?: React.FormEvent | React.MouseEvent) => {
        e?.preventDefault();
        setIsSaving(true);
        setError(null);

        try {
            const { error: rpcError } = await supabase.rpc('save_moderator_permissions', {
                target_user_id: user.id,
                permissions_data: {
                    ...permissions,
                    assigned_level: permissions.assigned_levels?.[0] || null,
                }
            });
            if (rpcError) throw rpcError;

            const currentAdmin = (await supabase.auth.getUser()).data.user;
            const grantedKeys = PERMISSION_ITEMS
                .filter(p => permissions[p.key] && !originalPermissions?.[p.key])
                .map(p => p.label);
            const revokedKeys = PERMISSION_ITEMS
                .filter(p => !permissions[p.key] && originalPermissions?.[p.key])
                .map(p => p.label);

            await supabase.from('activity_logs').insert({
                user_id: currentAdmin?.id,
                action: 'PERMISSIONS_UPDATE',
                entity_id: user.id,
                entity_type: 'user',
                description: `Updated moderator permissions for ${user.full_name}`,
                metadata: {
                    granted: grantedKeys,
                    revoked: revokedKeys,
                    assigned_levels: permissions.assigned_levels,
                    previous_levels: originalPermissions?.assigned_levels,
                },
            });

            onSave('Moderator permissions updated successfully');
        } catch (err: unknown) {
            setError((err as Error).message || 'Failed to save permissions. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    const togglePermission = (key: keyof Omit<ModeratorPermissions, 'assigned_level' | 'assigned_levels' | 'level_permissions'>) => {
        setPermissions(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const toggleLevelAssignment = (level: AcademicLevel) => {
        setPermissions(prev => {
            const current = prev.assigned_levels;
            if (!current) {
                return { ...prev, assigned_levels: [level], assigned_level: level };
            }
            if (current.includes(level)) {
                const next = current.filter(l => l !== level);
                const nextLevels = next.length > 0 ? next : null;
                return { ...prev, assigned_levels: nextLevels, assigned_level: nextLevels?.[0] || null };
            } else {
                const next = [...current, level].sort();
                return { ...prev, assigned_levels: next, assigned_level: next[0] };
            }
        });
    };

    const setAllLevels = () => {
        setPermissions(prev => ({ ...prev, assigned_levels: null, assigned_level: null }));
    };

    const toggleLevelPermissionOverride = (level: AcademicLevel, key: string) => {
        setPermissions(prev => {
            const levelPerms = prev.level_permissions || {};
            const currentLevelMap = levelPerms[level] || {};
            const defaultGlobal = !!prev[key as keyof ModeratorPermissions];
            const currentOverride = currentLevelMap[key];
            const nextVal = currentOverride !== undefined ? !currentOverride : !defaultGlobal;

            return {
                ...prev,
                level_permissions: {
                    ...levelPerms,
                    [level]: {
                        ...currentLevelMap,
                        [key]: nextVal
                    }
                }
            };
        });
    };

    const grantAll = () => {
        setPermissions(prev => ({
            ...prev,
            can_manage_announcements: true,
            can_manage_materials: true,
            can_manage_lecturers: true,
            can_manage_executives: true,
            can_manage_students: true,
            can_manage_groups: true,
            can_manage_group_media: true,
            can_manage_news: true,
            can_manage_archives: true,
            can_manage_messaging: true,
            can_manage_events: true,
            can_manage_past_questions: true,
            can_manage_courses: true,
            can_manage_cloud_archive: true,
            can_manage_graduates: true,
            can_manage_analytics: true,
            can_manage_logs: true,
            can_manage_settings: true,
            can_manage_storage: true,
            can_manage_security: false,
        }));
    };

    const activeCount = PERMISSION_ITEMS.filter(p => permissions[p.key]).length;
    const hasChanges = JSON.stringify(permissions) !== JSON.stringify(originalPermissions);
    const assignedLevelsList = permissions.assigned_levels || levelOptions;

    if (isLoading) {
        return (
            <div className="fixed inset-0 bg-primary-950/40 backdrop-blur-md flex items-center justify-center z-[110] p-4">
                <div className="bg-white rounded-[2.5rem] shadow-2xl max-w-md w-full p-12 flex flex-col items-center gap-4">
                    <div className="w-16 h-16 bg-amber-50 rounded-2xl flex items-center justify-center">
                        <Loader2 className="h-8 w-8 text-amber-600 animate-spin" />
                    </div>
                    <p className="text-sm font-black text-gray-400 uppercase tracking-widest">Loading Permissions...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 bg-primary-950/40 backdrop-blur-md flex items-center justify-center z-[110] p-4 animate-in fade-in duration-300">
            <div className="bg-white w-full max-w-xl rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 border border-white/20">

                <div className="relative bg-primary-950 px-8 py-6">
                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-2xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
                            <Shield className="w-7 h-7 text-amber-400" />
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-white tracking-tight">Moderator Permissions</h2>
                            <p className="text-sm text-white/50 font-medium">{user.full_name}</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="absolute top-5 right-5 p-2 bg-white/10 hover:bg-white/20 text-white rounded-full transition-all"
                    >
                        <X className="w-5 h-5" />
                    </button>
                    <div className="mt-5 flex items-center justify-between">
                        <span className="text-[10px] font-black text-white/50 uppercase tracking-widest">
                            {activeCount} / {PERMISSION_ITEMS.length} Active
                        </span>
                        <button
                            type="button"
                            onClick={grantAll}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/20 hover:bg-green-500/30 text-green-300 text-[10px] font-black rounded-lg transition-all border border-green-500/20"
                        >
                            <Unlock className="w-3 h-3" />
                            GRANT ALL
                        </button>
                    </div>
                </div>

                <form id="moderator-permissions-form" onSubmit={handleSubmit} className="p-8 space-y-6 max-h-[60vh] overflow-y-auto">
                    {error && (
                        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-100 rounded-2xl text-red-700 text-sm font-semibold animate-in slide-in-from-top-2">
                            <AlertTriangle className="w-5 h-5 shrink-0" />
                            {error}
                        </div>
                    )}

                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Assigned Level(s)</p>
                            <span className="text-[10px] font-bold text-amber-600">
                                {!permissions.assigned_levels ? 'Managing All Levels' : `${permissions.assigned_levels.length} Level(s) Selected`}
                            </span>
                        </div>
                        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80">
                            <p className="text-xs font-semibold text-slate-500 mb-3">
                                Select the academic level(s) this moderator manages. Select multiple levels or choose "All Levels".
                            </p>
                            <div className="grid grid-cols-5 gap-2">
                                <button
                                    type="button"
                                    onClick={setAllLevels}
                                    className={`py-2.5 text-[10px] font-black rounded-xl transition-all border ${
                                        !permissions.assigned_levels
                                            ? 'bg-primary-950 text-white border-primary-950 shadow-md'
                                            : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                                    }`}
                                >
                                    ALL LEVELS
                                </button>
                                {levelOptions.map((lvl) => {
                                    const isSelected = permissions.assigned_levels?.includes(lvl);
                                    return (
                                        <button
                                            key={lvl}
                                            type="button"
                                            onClick={() => toggleLevelAssignment(lvl)}
                                            className={`py-2.5 text-[10px] font-black rounded-xl transition-all border ${
                                                isSelected
                                                    ? 'bg-amber-500 text-white border-amber-500 shadow-md'
                                                    : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                                            }`}
                                        >
                                            LEVEL {lvl}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Global Page Permissions</p>
                        {PERMISSION_ITEMS.map((item) => {
                            const isActive = permissions[item.key];
                            return (
                                <button
                                    key={item.key}
                                    type="button"
                                    onClick={() => togglePermission(item.key)}
                                    className={`w-full flex items-center gap-4 p-4 rounded-2xl border-2 transition-all text-left ${
                                        isActive
                                            ? `${colorMap[item.color]} border-current`
                                            : 'bg-gray-50 border-gray-100 text-gray-400 hover:border-gray-200'
                                    }`}
                                >
                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-all ${
                                        isActive ? 'bg-current/10' : 'bg-gray-100'
                                    }`}>
                                        {isActive ? <CheckCircle2 className="w-5 h-5" /> : <Lock className="w-5 h-5 text-gray-300" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className={`text-sm font-black tracking-tight ${isActive ? '' : 'text-gray-500'}`}>{item.label}</p>
                                        <p className={`text-[11px] font-medium mt-0.5 ${isActive ? 'opacity-70' : 'text-gray-400'}`}>{item.description}</p>
                                    </div>
                                    <div className={`w-5 h-5 rounded-full border-2 shrink-0 transition-all ${isActive ? 'bg-current border-current' : 'border-gray-200'}`} />
                                </button>
                            );
                        })}
                    </div>

                    <div className="space-y-3 pt-2">
                        <div className="flex items-center justify-between">
                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Level-Scoped Action Overrides</p>
                            <span className="text-[10px] font-bold text-slate-400">Optional Fine-Tuning</span>
                        </div>
                        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-4">
                            <p className="text-xs font-semibold text-slate-500">
                                Fine-tune action permissions per level. For example, grant permission for Level 100 while restricting Level 200.
                            </p>
                            
                            <div className="flex gap-2 border-b border-slate-200 pb-2">
                                {assignedLevelsList.map((lvl) => (
                                    <button
                                        key={lvl}
                                        type="button"
                                        onClick={() => setSelectedLevelTab(selectedLevelTab === lvl ? null : lvl)}
                                        className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                                            selectedLevelTab === lvl
                                                ? 'bg-primary-950 text-white'
                                                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                                        }`}
                                    >
                                        Level {lvl} Overrides
                                    </button>
                                ))}
                            </div>

                            {selectedLevelTab && (
                                <div className="space-y-2 pt-1 animate-in fade-in duration-200">
                                    <p className="text-[11px] font-black text-slate-700 uppercase">
                                        Level {selectedLevelTab} Action Toggles:
                                    </p>
                                    <div className="grid grid-cols-2 gap-2">
                                        {PERMISSION_ITEMS.map((item) => {
                                            const globalVal = !!permissions[item.key];
                                            const levelOverride = permissions.level_permissions?.[selectedLevelTab]?.[item.key];
                                            const effectiveVal = levelOverride !== undefined ? levelOverride : globalVal;
                                            const isOverridden = levelOverride !== undefined && levelOverride !== globalVal;

                                            return (
                                                <button
                                                    key={item.key}
                                                    type="button"
                                                    onClick={() => toggleLevelPermissionOverride(selectedLevelTab, item.key)}
                                                    className={`p-3 rounded-xl border text-left flex items-center justify-between transition-all ${
                                                        effectiveVal
                                                            ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                                                            : 'bg-red-50 border-red-200 text-red-900'
                                                    }`}
                                                >
                                                    <div>
                                                        <p className="text-xs font-bold">{item.label}</p>
                                                        <p className="text-[9px] opacity-75">
                                                            {effectiveVal ? 'ALLOWED' : 'RESTRICTED'}
                                                            {isOverridden && ' (Custom)'}
                                                        </p>
                                                    </div>
                                                    <div className={`w-3.5 h-3.5 rounded-full border ${
                                                        effectiveVal ? 'bg-emerald-500 border-emerald-600' : 'bg-red-400 border-red-500'
                                                    }`} />
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </form>

                <div className="px-8 pb-8 flex gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 py-4 bg-gray-50 text-gray-400 text-xs font-black rounded-2xl hover:bg-gray-100 transition-all uppercase tracking-widest"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        form="moderator-permissions-form"
                        disabled={isSaving || !hasChanges}
                        className="flex-[2] py-4 bg-primary-950 text-white text-xs font-black rounded-2xl hover:bg-primary-800 disabled:opacity-40 transition-all shadow-xl shadow-primary-950/20 uppercase tracking-widest flex items-center justify-center gap-2"
                    >
                        {isSaving ? (
                            <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
                        ) : (
                            <><Save className="w-4 h-4" /> {hasChanges ? 'Save Changes' : 'No Changes'}</>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
