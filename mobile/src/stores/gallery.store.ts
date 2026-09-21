import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from './mmkv.storage';
import { supabase } from '../api/supabase/client';
import { useNetworkStore } from './network.store';

export type GalleryTopic = {
    id: string;
    title: string;
    description: string | null;
    cover_image: string | null;
    created_at: string;
    total_items?: number;
};

export type GalleryMedia = {
    id: string;
    topic_id: string;
    media_url: string;
    media_type: 'image' | 'video';
    caption: string | null;
    sort_order: number;
    created_at: string;
};

interface GalleryState {
  topics: GalleryTopic[];
  isLoadingTopics: boolean;
  lastFetchTopics: number | null;

  topicDetails: Record<string, GalleryTopic>;
  
  mediaByTopic: Record<string, GalleryMedia[]>;
  isLoadingMedia: Record<string, boolean>;

  fetchTopics: (force?: boolean) => Promise<void>;
  fetchTopicDetails: (topicId: string) => Promise<GalleryTopic | null>;
  fetchMedia: (topicId: string, force?: boolean) => Promise<void>;
  clearCache: () => void;
  clearUserData: () => void;
  clearContentCache: () => void;
}

export const useGalleryStore = create<GalleryState>()(
  persist(
    (set, get) => ({
      topics: [],
      isLoadingTopics: false,
      lastFetchTopics: null,

      topicDetails: {},

      mediaByTopic: {},
      isLoadingMedia: {},

      clearCache: () => set({ topics: [], lastFetchTopics: null, topicDetails: {}, mediaByTopic: {}, isLoadingMedia: {} }),
      clearUserData: () => set({}), // No user data in gallery
      clearContentCache: () => set({ lastFetchTopics: null }),

      fetchTopics: async (force = false) => {
        const { topics } = get();

        // LOCAL-FIRST: read from SQLite cache immediately (always works — even on new device)
        if (!force && topics.length === 0) {
          try {
            const { getCachedEntityList } = require('../lib/database');
            const cached = await getCachedEntityList('gallery_topics');
            if (cached.length > 0) {
              set({ topics: cached as any[], isLoadingTopics: false });
            }
          } catch { /* fall through to server fetch */ }
        }

        if (!useNetworkStore.getState().isOnline) {
          set({ isLoadingTopics: false });
          return;
        }

        if (get().topics.length === 0) set({ isLoadingTopics: true });

        try {
          const { data, error } = await supabase
            .from('gallery_topics')
            .select('*')
            .order('created_at', { ascending: false });

          if (error) throw error;

          const items = (data || []) as unknown as GalleryTopic[];
          if (items.length > 0) {
            const { cacheEntityList } = require('../lib/database');
            cacheEntityList('gallery_topics', items, '').catch(() => {});

            // Background prefetch covers for offline
            const { getOptimizedCloudinaryUrl } = require('../lib/cloudinary');
            const { prefetchAsset } = require('../utils/prefetchAsset');
            items.forEach((topic: any) => {
                if (topic.cover_image) {
                    const homeUrl = getOptimizedCloudinaryUrl(topic.cover_image, 600, 400);
                    const posterEntityId = 'poster_' + homeUrl.replace(/[^a-zA-Z0-9]/g, '_').slice(-60);
                    prefetchAsset(posterEntityId, homeUrl, 'poster');
                }
            });
          }
          
          set({ 
            topics: items, 
            isLoadingTopics: false, 
            lastFetchTopics: Date.now() 
          });
        } catch (err) {
          set({ isLoadingTopics: false });
        }
      },

      fetchTopicDetails: async (topicId: string) => {
        // Find in topics list first
        const existing = get().topics.find(t => t.id === topicId) || get().topicDetails[topicId];
        if (existing && !useNetworkStore.getState().isOnline) {
            return existing;
        }

        try {
            const { data, error } = await supabase
                .from('gallery_topics')
                .select('*')
                .eq('id' as any, topicId as any)
                .maybeSingle();
                
            if (error) throw error;
            if (!data) return existing || null;
            
            const topic = data as unknown as GalleryTopic;
            set(state => ({
                topicDetails: { ...state.topicDetails, [topicId]: topic }
            }));
            return topic;
        } catch (err) {
            return existing || null;
        }
      },

      fetchMedia: async (topicId: string, force = false) => {
        const currentMedia = get().mediaByTopic[topicId] || [];
        if (!useNetworkStore.getState().isOnline) {
          set(state => ({ isLoadingMedia: { ...state.isLoadingMedia, [topicId]: false } }));
          return;
        }

        if (currentMedia.length === 0) {
            set(state => ({ isLoadingMedia: { ...state.isLoadingMedia, [topicId]: true } }));
        }

        try {
          const { data, error } = await supabase
            .from('gallery_media')
            .select('*')
            .eq('topic_id' as any, topicId as any)
            .order('sort_order', { ascending: true })
            .order('created_at', { ascending: true });

          if (error) throw error;
          const items = (data || []) as unknown as GalleryMedia[];
          
          if (items.length > 0) {
            // Background prefetch media for offline
            const { prefetchAsset } = require('../utils/prefetchAsset');
            items.forEach((m: any) => {
                if (m.media_url && m.media_type === 'image') {
                    const posterEntityId = 'poster_' + m.media_url.replace(/[^a-zA-Z0-9]/g, '_').slice(-60);
                    prefetchAsset(posterEntityId, m.media_url, 'poster');
                }
            });
          }

          set(state => ({ 
            mediaByTopic: { ...state.mediaByTopic, [topicId]: items },
            isLoadingMedia: { ...state.isLoadingMedia, [topicId]: false }
          }));
        } catch (err) {
          set(state => ({ isLoadingMedia: { ...state.isLoadingMedia, [topicId]: false } }));
        }
      },
    }),
    {
      name: 'gallery-storage',
      storage: createJSONStorage(() => mmkvStorage),
      partialize: (state) => ({
        topics: state.topics,
        topicDetails: state.topicDetails,
        mediaByTopic: state.mediaByTopic,
        lastFetchTopics: state.lastFetchTopics,
      })
    }
  )
);
