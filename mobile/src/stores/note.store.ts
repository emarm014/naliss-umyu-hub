import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from './mmkv.storage';

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
    
    // Actions
    addNote: (note: Omit<LocalNote, 'id' | 'createdAt' | 'updatedAt'>) => void;
    updateNote: (id: string, updates: Partial<LocalNote>) => void;
    deleteNote: (id: string) => void;
    clearAllNotes: () => void;
}

export const useNoteStore = create<NoteState>()(
    persist(
        (set) => ({
            notes: [],

            addNote: (notePayload) => set((state) => {
                const newNote: LocalNote = {
                    ...notePayload,
                    id: `note-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                };
                return { notes: [newNote, ...state.notes] };
            }),

            updateNote: (id, updates) => set((state) => ({
                notes: state.notes.map(note => 
                    note.id === id 
                        ? { ...note, ...updates, updatedAt: new Date().toISOString() }
                        : note
                )
            })),

            deleteNote: (id) => set((state) => ({
                notes: state.notes.filter(note => note.id !== id)
            })),

            clearAllNotes: () => set({ notes: [] })
        }),
        {
            name: 'naliss-notepad-storage',
            storage: createJSONStorage(() => mmkvStorage),
        }
    )
);
