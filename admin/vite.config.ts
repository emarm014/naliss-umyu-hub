import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      // Auto-update: service worker updates silently in background,
      // new version activates on next page load — no stale cache ever
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        // Never cache Supabase API calls — always fetch fresh data
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/rest\//, /^\/auth\//, /^\/realtime\//],
        runtimeCaching: [
          {
            // Cache Google Fonts
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Cache Cloudinary images (admin avatars, group photos)
            urlPattern: /^https:\/\/res\.cloudinary\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'cloudinary-cache',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      includeAssets: ['naliss-logo.png', 'pwa-icon-192.png', 'pwa-icon-512.png', 'favicon.png'],
      manifest: {
        name: 'Naliss Admin',
        short_name: 'Naliss Admin',
        description: 'Administrative control panel for NALISS UMYU Hub — Library & Information Science Department, UMYU Katsina.',
        theme_color: '#064e3b',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait-primary',
        scope: '/',
        start_url: '/',
        categories: ['education', 'productivity'],
        icons: [
          {
            src: '/pwa-icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        shortcuts: [
          {
            name: 'Students',
            short_name: 'Students',
            description: 'Manage student accounts',
            url: '/students',
            icons: [{ src: '/pwa-icon-192.png', sizes: '96x96' }],
          },
          {
            name: 'Groups',
            short_name: 'Groups',
            description: 'Manage chat groups',
            url: '/groups',
            icons: [{ src: '/pwa-icon-192.png', sizes: '96x96' }],
          },
          {
            name: 'Announcements',
            short_name: 'Announce',
            description: 'Post announcements',
            url: '/announcements',
            icons: [{ src: '/pwa-icon-192.png', sizes: '96x96' }],
          },
        ],
      },
      devOptions: {
        // Enable PWA in dev mode for testing
        enabled: false,
      },
    }),
  ],
})

