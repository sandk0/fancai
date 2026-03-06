import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { visualizer } from 'rollup-plugin-visualizer';
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    // Bundle analyzer - generates stats.html
    visualizer({
      filename: './dist/stats.html',
      open: false,
      gzipSize: true,
      brotliSize: true,
    }) as any,
    // PWA - Service Worker generation via Workbox injectManifest
    // Custom SW at src/sw.ts for more flexible caching control
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt', // User decides when to update
      injectRegister: false, // We register manually in main.tsx

      // Static assets to include in precache
      includeAssets: ['icon-192.png', 'manifest.json'],

      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,woff}'],
        // Exclude large files and sourcemaps from precache
        globIgnores: ['**/stats.html', '**/*.map'],
      },

      // Workbox options for production
      workbox: {
        // SPA fallback for navigation requests
        navigateFallback: '/index.html',
        // Exclude API routes from navigation fallback
        navigateFallbackDenylist: [/^\/api\//],
        // Clean old caches
        cleanupOutdatedCaches: true,
        // Client claims for immediate control
        clientsClaim: true,
      },

      manifest: false, // Use existing public/manifest.json

      devOptions: {
        enabled: true,
        type: 'module',
        navigateFallback: 'index.html',
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ['localhost', '127.0.0.1', 'fancai.ru'],
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      '/ws': {
        target: 'ws://localhost:8000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    // SECURITY: Disable source maps in production to prevent code exposure
    // Use 'hidden' if you need source maps for error tracking (Sentry) without exposing them
    sourcemap: process.env.NODE_ENV !== 'production',

    // Target modern browsers (smaller bundle size)
    target: 'es2020',

    // Chunk size warning threshold
    chunkSizeWarningLimit: 600,

    // CSS code splitting
    cssCodeSplit: true,

    // Minification (esbuild is faster than terser)
    minify: 'esbuild',

    rollupOptions: {
      output: {
        manualChunks: {
          // Core React framework
          'vendor-react': ['react', 'react-dom'],

          // Router (separate chunk)
          'vendor-router': ['react-router-dom'],

          // Data fetching & state management
          'vendor-data': ['@tanstack/react-query', 'axios', 'zustand'],

          // UI libraries (heavy animations)
          'vendor-ui': ['motion', 'lucide-react'],

          // Form & validation
          'vendor-forms': ['react-hook-form', '@hookform/resolvers', 'zod'],

          // Radix UI components (many deps)
          'vendor-radix': [
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-popover',
            '@radix-ui/react-progress',
            '@radix-ui/react-separator',
            '@radix-ui/react-slider',
            '@radix-ui/react-slot',
            '@radix-ui/react-tooltip',
          ],

          // EPUB.js and reader dependencies (HEAVY - lazy load candidate)
          // Note: These are NOT in manualChunks because we'll lazy load them
          // 'vendor-epub': ['epubjs', 'react-reader'],

          // Other utilities
          'vendor-utils': [
            'clsx',
            'tailwind-merge',
            'class-variance-authority',
            'dompurify',
            'sonner',
          ],
        },

        // Asset file names (organized by type)
        assetFileNames: (assetInfo) => {
          const info = assetInfo.name.split('.');
          const ext = info[info.length - 1];
          if (/png|jpe?g|svg|gif|tiff|bmp|ico/i.test(ext)) {
            return 'assets/images/[name]-[hash][extname]';
          } else if (/woff2?|ttf|otf|eot/i.test(ext)) {
            return 'assets/fonts/[name]-[hash][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        },

        // Chunk file names (for code splitting)
        chunkFileNames: 'assets/js/[name]-[hash].js',
        entryFileNames: 'assets/js/[name]-[hash].js',
      },
    },
  },
  // Enable optimizeDeps for faster dev server
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      '@tanstack/react-query',
      'axios',
      'zustand',
      // ✅ FIX: Include epubjs for proper CommonJS → ESM conversion
      'epubjs',
      '@xmldom/xmldom', // Explicitly include CommonJS dependency
    ],
    // ✅ FIX: Removed exclude - allow Vite to pre-bundle all dependencies
    // This fixes the DOMParser import error from @xmldom/xmldom
  },
});
