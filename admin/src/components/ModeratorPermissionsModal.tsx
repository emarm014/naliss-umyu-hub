import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { X, Shield, Save, Loader2, CheckCircle2, AlertTriangle, Lock, Unlock } from 'lucide-react';
import type { User, AcademicLevel } from '../types';
import { LEVEL_LABELS } from '../types';

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
    assigned_level: AcademicLevel | null;
}

const levelOptions: AcademicLevel[] = ['100', '200', '300', '400'];

const PERMISSION_ITEMS = [
    {
        key: 'can_manage_announcements' as const,
        label: 'Post Announcements',
        description: 'Create, edit, publish and pin announcements & events',
        color: 'blue',
    },
    {
        key: 'can_manage_materials' as const,
        label: 'Manage Academic Content',
        description: 'Upload materials, past questions, and manage courses',
        color: 'green',
    },
    {
        key: 'can_manage_lecturers' as const,
        label: 'Manage Lecturers',
        description: 'Add, edit, and deactivate lecturer directory entries',
        color: 'purple',
    },
    {
        key: 'can_manage_executives' as const,
        label: 'Manage Executives',
        description: 'Add, edit, and manage student executive positions',
        color: 'amber',
    },
    {
        key: 'can_manage_students' as const,
        label: 'Manage Students',
        description: 'View student profiles and verify registrations',
        color: 'red',
    },
];

const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    green: 'bg-green-50 border-green-200 text-green-700',
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
        assigned_level: null,
    });
    const [originalPermissions, setOriginalPermissions] = useState<ModeratorPermissions | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

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
                    const loaded: ModeratorPermissions = {
                        can_manage_announcements: data.can_manage_announcements ?? false,
                        can_manage_materials: data.can_manage_materials ?? false,
                        can_manage_lecturers: data.can_manage_lecturers ?? false,
                        can_manage_executives: data.can_manage_executives ?? false,
                        can_manage_students: data.can_manage_students ?? false,
                        assigned_level: data.assigned_level as AcademicLevel | null,
                    };
                    setPermissions(loaded);
                    setOriginalPermissions(loaded);
                } else {
                    // No row yet — defaults are all false
                    const defaults: ModeratorPermissions = {
                        can_manage_announcements: false,
                        can_manage_materials: false,
                        can_manage_lecturers: false,
                        can_manage_executives: false,
                        can_manage_students: false,
                        assigned_level: null,
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
    }, [user.id]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleSubmit = async (e?: React.FormEvent | React.MouseEvent) => {
        e?.preventDefault();
        setIsSaving(true);
        setError(null);

        try {
            const { error: upsertError } = await supabase
                .from('moderator_permissions')
                .upsert({
                    user_id: user.id,
                    ...permissions,
                    updated_at: new Date().toISOString(),
                });

            if (upsertError) throw upsertError;

            // Log the permission change to activity_logs
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
                    assigned_level: permissions.assigned_level,
                    previous_level: originalPermissions?.assigned_level,
                },
            });

            onSave('Moderator permissions updated successfully');
        } catch (err: unknown) {
            setError((err as Error).message || 'Failed to save permissions. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    const togglePermission = (key: keyof Omit<ModeratorPermissions, 'assigned_level'>) => {
        setPermissions(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const grantAll = () => {
        setPermissions(prev => ({
            ...prev,
            can_manage_announcements: true,
            can_manage_materials: true,
            can_manage_lecturers: true,
            can_manage_executives: true,
            can_manage_students: true,
        }));
    };

    const revokeAll = () => {
        setPermissions(prev => ({
            ...prev,
            can_manage_announcements: false,
            can_manage_materials: false,
            can_manage_lecturers: false,
            can_manage_executives: false,
            can_manage_students: false,
        }));
    };

    const activeCount = PERMISSION_ITEMS.filter(p => permissions[p.key]).length;
    const hasChanges = JSON.stringify(permissions) !== JSON.stringify(originalPermissions);

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
            <div className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 border border-white/20">

                {/* Header */}
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

                    {/* Permission summary bar */}
                    <div className="mt-5 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="flex gap-1">
                                {PERMISSION_ITEMS.map((p) => (
                                    <div
                                        key={p.key}
                                        className={`w-2 h-2 rounded-full transition-all ${permissions[p.key] ? 'bg-amber-400' : 'bg-white/20'}`}
                                    />
                                ))}
                            </div>
                            <span className="text-[10px] font-black text-white/50 uppercase tracking-widest">
                                {activeCount} / {PERMISSION_ITEMS.length} Active
                            </span>
                        </div>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={grantAll}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/20 hover:bg-green-500/30 text-green-300 text-[10px] font-black rounded-lg transition-all border border-green-500/20"
                            >
                                <Unlock className="w-3 h-3" />
                                GRANT ALL
                            </button>
                            <button
                                type="button"
                                onClick={revokeAll}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-300 text-[10px] font-black rounded-lg transition-all border border-red-500/20"
                            >
                                <Lock className="w-3 h-3" />
                                REVOKE ALL
                            </button>
                        </div>
                    </div>
                </div>

                <form id="moderator-permissions-form" onSubmit={handleSubmit} className="p-8 space-y-6 max-h-[60vh] overflow-y-auto">
                    {error && (
                        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-100 rounded-2xl text-red-700 text-sm font-semibold animate-in slide-in-from-top-2">
                            <AlertTriangle className="w-5 h-5 shrink-0" />
                            {error}
                        </div>
                    )}

                    {/* Permission Toggles */}
                    <div className="space-y-3">
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Access Controls</p>
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
                                        {isActive
                                            ? <CheckCircle2 className="w-5 h-5" />
                                            : <Lock className="w-5 h-5 text-gray-300" />
                                        }
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className={`text-sm font-black tracking-tight ${isActive ? '' : 'text-gray-500'}`}>
                                            {item.label}
                                        </p>
                                        <p className={`text-[11px] font-medium mt-0.5 ${isActive ? 'opacity-70' : 'text-gray-400'}`}>
                                            {item.description}
                                        </p>
                                    </div>
                                    <div className={`w-5 h-5 rounded-full border-2 shrink-0 transition-all ${
                                        isActive ? 'bg-current border-current' : 'border-gray-200'
                                    }`} />
                                </button>
                            );
                        })}
                    </div>

                    {/* Level Restriction */}
                    <div className="space-y-3 pt-2">
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Level Restriction</p>
                        <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                            <p className="text-xs font-semibold text-gray-500 mb-3">
                                Restrict this moderator to a specific academic level. Applies to materials, announcements, and courses.
                            </p>
                            <div className="grid grid-cols-5 gap-2">
                                <button
                                    type="button"
                                    onClick={() => setPermissions({ ...permissions, assigned_level: null })}
                                    className={`py-2.5 text-[10px] font-black rounded-xl transition-all border ${
                                        !permissions.assigned_level
                                            ? 'bg-primary-950 text-white border-primary-950'
                                            : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'
                                    }`}
                                >
                                    ALL
                                </button>
                                {levelOptions.map((level) => (
                                    <button
                                        key={level}
                                        type="button"
                                        onClick={() => setPermissions({ ...permissions, assigned_level: level })}
                                        className={`py-2.5 text-[10px] font-black rounded-xl transition-all border ${
                                            permissions.assigned_level === level
                                                ? 'bg-primary-950 text-white border-primary-950'
                                                : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'
                                        }`}
                                    >
                                        {level}
                                    </button>
                                ))}
                            </div>
                            {permissions.assigned_level && (
                                <p className="text-[10px] font-bold text-amber-600 mt-2 flex items-center gap-1">
                                    <AlertTriangle className="w-3 h-3" />
                                    Restricted to {LEVEL_LABELS[permissions.assigned_level]} only
                                </p>
                            )}
                        </div>
                    </div>
                </form>

                {/* Footer */}
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
