import { useEffect, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { LazyMotion, domAnimation } from 'motion/react';
import { Toaster } from 'sonner';
import { HelmetProvider } from 'react-helmet-async';

// Shared queryClient for cache management
import { queryClient } from '@/lib/queryClient';

// Store initialization
import { initializeStores, cleanupStores } from '@/stores';

// Layout components (always loaded)
import Layout from '@/components/Layout/Layout';
import AuthGuard from '@/components/Auth/AuthGuard';
import { OfflineBanner } from '@/components/UI/OfflineBanner';
import { PWAUpdatePrompt } from '@/components/UI/PWAUpdatePrompt';
import { ChunkLoadErrorBoundary } from '@/components/ErrorBoundary/ChunkLoadErrorBoundary';
import { ScrollToTop } from '@/components/ScrollToTop';

// Core pages (eagerly loaded - small and frequently accessed)
import HomePage from '@/pages/HomePage';
import LoginPage from '@/pages/LoginPage';
import RegisterPage from '@/pages/RegisterPage';
import LibraryPage from '@/pages/LibraryPage';
import NotFoundPage from '@/pages/NotFoundPage';

// Lazy-loaded pages (heavy or less frequently accessed)
// These will be code-split into separate chunks
const BookPage = lazy(() => import('@/pages/BookPage'));
const BookImagesPage = lazy(() => import('@/pages/BookImagesPage'));
const ImagesGalleryPage = lazy(() => import('@/pages/ImagesGalleryPage'));
const StatsPage = lazy(() => import('@/pages/StatsPage'));
const ProfilePage = lazy(() => import('@/pages/ProfilePage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));

// Heavy pages with large dependencies (CRITICAL for bundle size)
// BookReaderPage includes EpubReader which loads epub.js (~300KB)
const BookReaderPage = lazy(() => import('@/pages/BookReaderPage'));
const BookGalleryPage = lazy(() => import('@/pages/BookGalleryPage'));

// Admin dashboard (large component, admin-only)
const AdminDashboard = lazy(() => import('@/pages/AdminDashboardEnhanced'));

// Global styles with theme support
import '@/styles/globals.css';

import { logger } from '@/lib/logger';

/**
 * Loading fallback component
 * Shown while lazy-loaded chunks are being fetched
 */
const PageLoadingFallback = () => (
  <div className="flex items-center justify-center min-h-screen bg-background text-foreground">
    <div className="text-center">
      <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4"></div>
      <p className="text-muted-foreground">Загрузка...</p>
    </div>
  </div>
);

function App() {
  useEffect(() => {
    logger.debug('[App] Starting, initializing stores...');
    try {
      initializeStores();
      logger.debug('[App] Stores initialized successfully');
    } catch (error) {
      logger.warn('[App] Failed to initialize stores:', error);
    }

    // TD-FRONT-131: Cleanup intervals on unmount to prevent memory leaks
    return () => {
      logger.debug('[App] Unmounting, cleaning up stores...');
      cleanupStores();
    };
  }, []);

  return (
    <HelmetProvider>
    <QueryClientProvider client={queryClient}>
      <LazyMotion features={domAnimation}>
        <Router>
          <ScrollToTop />
          <div className="App min-h-screen transition-colors bg-background text-foreground">
            <Routes>
              {/* Public routes */}
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />

              {/* Fullscreen reader route (no layout) */}
              <Route
                path="/book/:bookId/read"
                element={
                  <AuthGuard>
                    <ChunkLoadErrorBoundary>
                      <Suspense fallback={<PageLoadingFallback />}>
                        <BookReaderPage />
                      </Suspense>
                    </ChunkLoadErrorBoundary>
                  </AuthGuard>
                }
              />

              {/* Protected routes with layout */}
              <Route
                path="/*"
                element={
                  <AuthGuard>
                    <Layout>
                      <ChunkLoadErrorBoundary>
                        <Suspense fallback={<PageLoadingFallback />}>
                          <Routes>
                            <Route path="/" element={<HomePage />} />
                            <Route path="/library" element={<LibraryPage />} />
                            <Route path="/book/:bookId" element={<BookPage />} />
                            <Route path="/book/:bookId/images" element={<BookImagesPage />} />
                            <Route path="/book/:bookId/gallery" element={<BookGalleryPage />} />
                            <Route path="/images" element={<ImagesGalleryPage />} />
                            <Route path="/stats" element={<StatsPage />} />
                            <Route path="/profile" element={<ProfilePage />} />
                            <Route path="/settings" element={<SettingsPage />} />
                            <Route path="/admin" element={<AdminDashboard />} />
                            <Route path="*" element={<NotFoundPage />} />
                          </Routes>
                        </Suspense>
                      </ChunkLoadErrorBoundary>
                    </Layout>
                  </AuthGuard>
                }
              />
            </Routes>

            {/* Offline status banner */}
            <OfflineBanner />

            {/* PWA update prompt */}
            <PWAUpdatePrompt />

            {/* Global notifications */}
            <Toaster
              position="top-center"
              richColors
              closeButton
              toastOptions={{
                className: 'font-sans',
              }}
            />
          </div>
        </Router>
      </LazyMotion>
    </QueryClientProvider>
    </HelmetProvider>
  );
}

export default App;