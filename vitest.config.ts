import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './frontend/src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    root: './frontend',
    setupFiles: './src/test/setup.ts',
    css: true,
    pool: 'forks',
    dangerouslyIgnoreUnhandledErrors: true,
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    exclude: [
      'node_modules',
      'dist',
      '.idea',
      '.git',
      '.cache',
      'tests/**',
    ],
  },
});
