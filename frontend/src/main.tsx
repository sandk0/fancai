import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { initHawk } from './config/hawk';
import './lib/i18n';
import './styles/globals.css';

// Инициализация мониторинга ошибок (Hawk Tracker)
// Запускается до рендера приложения для перехвата ошибок с самого старта
initHawk();

// Service Worker registration is handled by PWAUpdatePrompt component
// using useRegisterSW hook from vite-plugin-pwa/react
// This prevents duplicate SW registration

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary level="app">
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
