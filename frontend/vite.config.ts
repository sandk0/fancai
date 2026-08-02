import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { visualizer } from 'rollup-plugin-visualizer';
import { VitePWA } from 'vite-plugin-pwa';

/** Прокси на локальный backend — общий для dev-сервера и `vite preview`. */
const backendProxy = {
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
};

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
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
      // Только в сборке: epub.js тянет полноценный XML-парсер, который
      // в браузере не исполняется ни на одной ветке (см. src/shims/xmldom.ts).
      // В dev алиас не ставим — он заставляет оптимизатор зависимостей
      // затягивать файл из `src/` в пре-бандл `epubjs` и перегенерировать
      // его на каждое изменение исходников («Outdated Optimize Dep», 504).
      ...(command === 'build'
        ? { '@xmldom/xmldom': path.resolve(__dirname, './src/shims/xmldom.ts') }
        : {}),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ['localhost', '127.0.0.1', 'fancai.ru'],
    proxy: backendProxy,
  },
  // Тот же прокси для `vite preview`: без него собранный SPA нечем проверить
  // локально — статику он отдаёт, а /api уходит в никуда.
  preview: {
    port: 4173,
    proxy: backendProxy,
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

    // Minification (Vite 8 uses Oxc by default — no explicit setting needed)

    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react-dom/') || id.includes('node_modules/react/')) return 'vendor-react';
          if (id.includes('node_modules/react-router/')) return 'vendor-router';
          if (id.includes('node_modules/@tanstack/react-query/') || id.includes('node_modules/axios/') || id.includes('node_modules/zustand/')) return 'vendor-data';
          if (id.includes('node_modules/motion/') || id.includes('node_modules/lucide-react/')) return 'vendor-ui';
          if (id.includes('node_modules/react-hook-form/') || id.includes('node_modules/@hookform/') || id.includes('node_modules/zod/')) return 'vendor-forms';
          if (id.includes('node_modules/@radix-ui/')) return 'vendor-radix';
          if (id.includes('node_modules/clsx/') || id.includes('node_modules/tailwind-merge/') || id.includes('node_modules/class-variance-authority/') || id.includes('node_modules/sonner/')) return 'vendor-utils';
        },

        // Asset file names (organized by type)
        assetFileNames: (assetInfo) => {
          const name = assetInfo.name ?? assetInfo.names?.[0] ?? 'asset';
          const info = name.split('.');
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
      'react-router',
      '@tanstack/react-query',
      'axios',
      'zustand',
      // ✅ FIX: Include epubjs for proper CommonJS → ESM conversion
      'epubjs',
      // В dev пакет реальный и пре-бандлится как обычно; в сборке его
      // подменяет алиас выше, и до оптимизатора он не доходит.
      ...(command === 'build' ? [] : ['@xmldom/xmldom']),
    ],
    // ✅ FIX: Removed exclude - allow Vite to pre-bundle all dependencies
    // This fixes the DOMParser import error from @xmldom/xmldom
  },
}));
