import React from 'react';
import { create } from 'zustand';

export type OverlayPriority = 'Low' | 'Normal' | 'High' | 'Critical';
export type OverlayResult = 'Confirm' | 'Cancel' | 'Dismiss' | 'Submit';

export interface OverlayConfig {
    id: string;
    priority: OverlayPriority;
    component: React.ReactNode;
    onResult?: (result: OverlayResult, data?: any) => void;
}

interface OverlayState {
    overlays: OverlayConfig[];
    
    // Actions
    showOverlay: (config: Omit<OverlayConfig, 'id'> & { id?: string }) => string;
    hideOverlay: (id: string, result?: OverlayResult, data?: any) => void;
    clearAll: () => void;
}

const PRIORITY_WEIGHTS: Record<OverlayPriority, number> = {
    'Low': 0,
    'Normal': 1,
    'High': 2,
    'Critical': 3,
};

export const useOverlayStore = create<OverlayState>((set, get) => ({
    overlays: [],

    showOverlay: (config) => {
        const id = config.id || `overlay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const newOverlay: OverlayConfig = { ...config, id };

        set((state) => {
            const filtered = state.overlays.filter(o => o.id !== id);
            filtered.push(newOverlay);
            filtered.sort((a, b) => PRIORITY_WEIGHTS[a.priority] - PRIORITY_WEIGHTS[b.priority]);
            return { overlays: filtered };
        });

        return id;
    },

    hideOverlay: (id, result = 'Dismiss', data) => {
        set((state) => {
            const overlay = state.overlays.find(o => o.id === id);
            if (overlay && overlay.onResult) {
                setTimeout(() => overlay.onResult!(result, data), 0);
            }
            return { overlays: state.overlays.filter(o => o.id !== id) };
        });
    },

    clearAll: () => set({ overlays: [] })
}));
