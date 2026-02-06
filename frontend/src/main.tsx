import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import './lib/i18n'
import './styles/globals.css'

// Service Worker registration is handled by PWAUpdatePrompt component
// using useRegisterSW hook from vite-plugin-pwa/react
// This prevents duplicate SW registration

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary level="app">
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)