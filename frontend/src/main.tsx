import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/react'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import { config } from './config/env'
import './lib/i18n'
import './styles/globals.css'

// Initialize Sentry (must be before React render)
if (config.sentry.dsn && config.sentry.enabled) {
  Sentry.init({
    dsn: config.sentry.dsn,
    environment: config.app.environment,
    release: `fancai-frontend@${config.app.version}`,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({ maskAllText: false, blockAllMedia: false }),
    ],
    tracesSampleRate: config.env.isProduction ? 0.2 : 1.0,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    sendDefaultPii: false,
  })
}

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