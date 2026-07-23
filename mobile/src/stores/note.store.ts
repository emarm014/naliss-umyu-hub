import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from './mmkv.storage';
import { supabase } from '../api/supabase/client';
import { Logger } from '../utils/logger';

export interface LocalNote {
    id: string;
    subject?: string;
    courseCode?: string;
    courseLevel?: string;
    content: string;
    mediaPaths: string[];
    linkedMaterials?: string[];
    createdAt: string;
    updatedAt: string;
}

interface NoteState {
    notes: LocalNote[];

    addNote: (note: Omit<LocalNote, 'id' | 'createdAt' | 'updatedAt'>) => void;
    updateNote: (id: string, updates: Partial<LocalNote>) => void;
    deleteNote: (id: string) => void;
    clearAllNotes: () => void;

    syncNotesToCloud: () => Promise<void>;
    fetchCloudNotes: () => Promise<void>;
}

const syncNoteToSupabase = async (note: LocalNote) => {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        await (supabase as any).from('user_notes').upsert({
            id: note.id,
            user_id: user.id,
            subject: note.subject || null,
            course_code: note.courseCode || null,
            course_level: note.courseLevel || null,
            content: note.content,
            media_paths: JSON.stringify(note.mediaPaths),
            linked_materials: JSON.stringify(note.linkedMaterials || []),
            created_at: note.createdAt,
            updated_at: note.updatedAt,
        }, { onConflict: 'id,user_id' });
    } catch {
        // Fire-and-forget sync
    }
};

const deleteNoteFromSupabase = async (noteId: string) => {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        await (supabase as any).from('user_notes')
            .delete()
            .eq('id', noteId)
            .eq('user_id', user.id);
    } catch {
        // Fire-and-forget
    }
};

export const useNoteStore = create<NoteState>()(
    persist(
        (set, get) => ({
            notes: [],

            addNote: (notePayload) => {
                const newNote: LocalNote = {
                    ...notePayload,
                    id: `note-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                };
                set({ notes: [newNote, ...get().notes] });
                syncNoteToSupabase(newNote);
            },

            updateNote: (id, updates) => {
                set((state) => {
                    const updated = state.notes.map(note =>
                        note.id === id
                            ? { ...note, ...updates, updatedAt: new Date().toISOString() }
                            : note
                    );
                    const changed = updated.find(n => n.id === id);
                    if (changed) syncNoteToSupabase(changed);
                    return { notes: updated };
                });
            },

            deleteNote: (id) => {
                set((state) => ({
                    notes: state.notes.filter(note => note.id !== id)
                }));
                deleteNoteFromSupabase(id);
            },

            clearAllNotes: () => {
                const current = get().notes;
                set({ notes: [] });
                current.forEach(n => deleteNoteFromSupabase(n.id));
            },

            syncNotesToCloud: async () => {
                const notes = get().notes;
                await Promise.allSettled(notes.map(n => syncNoteToSupabase(n)));
            },

            fetchCloudNotes: async () => {
                const localNotes = get().notes;
                // Only restore if local is empty (new device)
                if (localNotes.length > 0) return;

                try {
                    const { data: { user } } = await supabase.auth.getUser();
                    if (!user) return;

                    const { data, error } = await (supabase as any)
                        .from('user_notes')
                        .select('*')
                        .eq('user_id', user.id)
                        .order('created_at', { ascending: false });

                    if (error) throw error;
                    if (!data || data.length === 0) return;

                    const restored: LocalNote[] = data.map((row: any) => ({
                        id: row.id,
                        subject: row.subject || undefined,
                        courseCode: row.course_code || undefined,
                        courseLevel: row.course_level || undefined,
                        content: row.content,
                        mediaPaths: typeof row.media_paths === 'string' ? JSON.parse(row.media_paths) : (row.media_paths || []),
                        linkedMaterials: typeof row.linked_materials === 'string' ? JSON.parse(row.linked_materials) : (row.linked_materials || []),
                        createdAt: row.created_at,
                        updatedAt: row.updated_at || row.created_at,
                    }));

                    set({ notes: restored });
                    Logger.info('note.store', `Restored ${restored.length} notes from cloud`);
                } catch (err) {
                    Logger.warn('note.store', 'Failed to fetch cloud notes', { error: String(err) });
                }
            },
        }),
        {
            name: 'naliss-notepad-storage',
            storage: createJSONStorage(() => mmkvStorage),
        }
    )
);
