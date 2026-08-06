import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from './mmkv.storage';
import { supabase } from '../api/supabase/client';
import { Logger } from '../utils/logger';
import { uploadLocalFileToCloudinary } from '../lib/cloudinary';
import { useMutationQueueStore } from './mutationQueue.store';

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
    syncStatus?: 'synced' | 'pending' | 'failed';
}

interface NoteState {
    notes: LocalNote[];

    addNote: (note: Omit<LocalNote, 'id' | 'createdAt' | 'updatedAt'>) => void;
    updateNote: (id: string, updates: Partial<LocalNote>) => void;
    deleteNote: (id: string) => void;
    clearAllNotes: () => void;

    syncNotesToCloud: () => Promise<void>;
    fetchCloudNotes: () => Promise<void>;
    retryFailedSyncs: () => void;
}

const syncNoteWithImages = async (note: LocalNote, updateLocalNote: (id: string, updates: Partial<LocalNote>) => void) => {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            updateLocalNote(note.id, { syncStatus: 'failed' });
            return;
        }

        let hasUploadError = false;
        const uploadedMediaPaths: string[] = [];

        for (let i = 0; i < (note.mediaPaths || []).length; i++) {
            const uri = note.mediaPaths[i];
            if (uri && (uri.startsWith('file://') || uri.startsWith('content://') || uri.startsWith('ph://') || !uri.startsWith('http'))) {
                try {
                    const uploadName = `note_${note.id}_${Date.now()}_${i}.jpg`;
                    const remoteUrl = await uploadLocalFileToCloudinary(
                        uri,
                        uploadName,
                        'notepad-attachments',
                        'image/jpeg'
                    );
                    uploadedMediaPaths.push(remoteUrl);
                } catch (err) {
                    hasUploadError = true;
                    // Keep original local uri if upload failed
                    uploadedMediaPaths.push(uri);
                }
            } else {
                uploadedMediaPaths.push(uri);
            }
        }

        if (hasUploadError) {
            updateLocalNote(note.id, { syncStatus: 'failed' });
            return; // Abort Supabase upsert so we don't save file:// paths
        }

        // If we got here, all images uploaded successfully.
        updateLocalNote(note.id, { mediaPaths: uploadedMediaPaths, syncStatus: 'synced' });

        useMutationQueueStore.getState().enqueue({
            table: 'user_notes',
            action: 'upsert',
            payload: {
                id: note.id,
                user_id: user.id,
                subject: note.subject || null,
                course_code: note.courseCode || null,
                course_level: note.courseLevel || null,
                content: note.content,
                media_paths: JSON.stringify(uploadedMediaPaths),
                linked_materials: JSON.stringify(note.linkedMaterials || []),
                created_at: note.createdAt,
                updated_at: note.updatedAt,
            }
        });
        // We will also manually trigger queue process if we're online
        useMutationQueueStore.getState().processQueue();

    } catch (err) {
        Logger.warn('note.store', 'Failed to sync note to Supabase', { error: String(err) });
        updateLocalNote(note.id, { syncStatus: 'failed' });
    }
};

const deleteNoteFromSupabase = async (noteId: string) => {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        useMutationQueueStore.getState().enqueue({
            table: 'user_notes',
            action: 'delete',
            payload: {},
            queryConstraints: { eq: { id: noteId, user_id: user.id } }
        });
        useMutationQueueStore.getState().processQueue();
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
                    syncStatus: 'pending'
                };
                set({ notes: [newNote, ...get().notes] });
                
                const updateLocalNote = (id: string, updates: Partial<LocalNote>) => {
                    set(state => ({
                        notes: state.notes.map(n => n.id === id ? { ...n, ...updates } : n)
                    }));
                };
                syncNoteWithImages(newNote, updateLocalNote);
            },

            updateNote: (id, updates) => {
                set((state) => {
                    const updated = state.notes.map(note =>
                        note.id === id
                            ? { ...note, ...updates, updatedAt: new Date().toISOString(), syncStatus: 'pending' as const }
                            : note
                    );
                    const changed = updated.find(n => n.id === id);
                    if (changed) {
                        const updateLocalNote = (noteId: string, upd: Partial<LocalNote>) => {
                            set(st => ({
                                notes: st.notes.map(n => n.id === noteId ? { ...n, ...upd } : n)
                            }));
                        };
                        syncNoteWithImages(changed as LocalNote, updateLocalNote);
                    }
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
                get().retryFailedSyncs();
            },

            fetchCloudNotes: async () => {
                try {
                    const { data: { user } } = await supabase.auth.getUser();
                    if (!user) return;

                    const { data, error } = await (supabase as any)
                        .from('user_notes')
                        .select('*')
                        .eq('user_id', user.id)
                        .order('created_at', { ascending: false });

                    if (error) throw error;
                    if (!data) return;

                    const cloudNotes: LocalNote[] = data.map((row: any) => ({
                        id: row.id,
                        subject: row.subject || undefined,
                        courseCode: row.course_code || undefined,
                        courseLevel: row.course_level || undefined,
                        content: row.content,
                        mediaPaths: typeof row.media_paths === 'string' ? JSON.parse(row.media_paths) : (row.media_paths || []),
                        linkedMaterials: typeof row.linked_materials === 'string' ? JSON.parse(row.linked_materials) : (row.linked_materials || []),
                        createdAt: row.created_at,
                        updatedAt: row.updated_at || row.created_at,
                        syncStatus: 'synced'
                    }));

                    // Smart Merge strategy
                    set(state => {
                        const localNotes = state.notes;
                        const mergedNotes = [...cloudNotes];

                        for (const localNote of localNotes) {
                            const cloudIndex = mergedNotes.findIndex(cn => cn.id === localNote.id);
                            
                            if (cloudIndex >= 0) {
                                // Exists in both. Keep local if it's pending/failed or newer.
                                const cloudNote = mergedNotes[cloudIndex];
                                const localTime = new Date(localNote.updatedAt).getTime();
                                const cloudTime = new Date(cloudNote.updatedAt).getTime();
                                
                                if (localNote.syncStatus === 'pending' || localNote.syncStatus === 'failed' || localTime > cloudTime) {
                                    mergedNotes[cloudIndex] = localNote;
                                }
                            } else {
                                // Exists locally but not in cloud. Keep if it hasn't been synced yet.
                                if (localNote.syncStatus === 'pending' || localNote.syncStatus === 'failed') {
                                    mergedNotes.unshift(localNote);
                                }
                                // If syncStatus === 'synced', it was deleted remotely, so let it be removed locally.
                            }
                        }
                        
                        // Sort descending by creation date
                        return { notes: mergedNotes.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) };
                    });

                    Logger.info('note.store', `Restored and merged ${cloudNotes.length} notes from cloud`);
                } catch (err) {
                    Logger.warn('note.store', 'Failed to fetch cloud notes', { error: String(err) });
                }
            },
            
            retryFailedSyncs: () => {
                const notes = get().notes;
                const failedNotes = notes.filter(n => n.syncStatus === 'failed' || n.syncStatus === 'pending');
                
                if (failedNotes.length === 0) return;
                
                const updateLocalNote = (noteId: string, upd: Partial<LocalNote>) => {
                    set(st => ({
                        notes: st.notes.map(n => n.id === noteId ? { ...n, ...upd } : n)
                    }));
                };
                
                failedNotes.forEach(n => {
                    updateLocalNote(n.id, { syncStatus: 'pending' });
                    syncNoteWithImages({ ...n, syncStatus: 'pending' as const } as LocalNote, updateLocalNote);
                });
            }
        }),
        {
            name: 'note-storage',
            storage: createJSONStorage(() => mmkvStorage),
        }
    )
);
