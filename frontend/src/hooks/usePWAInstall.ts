/**
 * Hook for managing PWA installation
 *
 * Handles the beforeinstallprompt event and provides a unified API
 * for installing the PWA across different platforms.
 *
 * @example
 * ```tsx
 * function InstallButton() {
 *   const { isInstallable, isInstalled, isIOSDevice, install } = usePWAInstall()
 *
 *   if (isInstalled) return <span>Installed</span>
 *   if (isIOSDevice) return <IOSInstallInstructions />
 *   if (!isInstallable) return null
 *
 *   return <button onClick={install}>Install App</button>
 * }
 * ```
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { logger } from '@/lib/logger';

/**
 * Extended Event interface for beforeinstallprompt
 * This event is Chrome/Edge specific and not part of standard DOM types
 */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[]
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed'
    platform: string
  }>
  prompt(): Promise<void>
}

/**
 * Return type for usePWAInstall hook
 */
export interface UsePWAInstallReturn {
  /** Whether the app can be installed (browser prompt available) */
  isInstallable: boolean
  /** Whether the app is already installed (running in standalone mode) */
  isInstalled: boolean
  /** Whether installation is currently in progress */
  isInstalling: boolean
  /** Whether this is an iOS device (requires manual installation instructions) */
  isIOSDevice: boolean
  /** Trigger the installation prompt. Returns true if user accepted */
  install: () => Promise<boolean>
  /** Source of installation capability */
  installSource: 'browser' | 'ios-manual' | null
}

/**
 * Check if the code is running in a browser environment
 */
function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof navigator !== 'undefined'
}

/**
 * Check if the device is running iOS
 * Inline implementation to avoid dependency on iosSupport.ts which may not exist yet
 */
function checkIsIOS(): boolean {
  if (!isBrowser()) return false

  const userAgent = navigator.userAgent || ''

  // Check for iOS devices
  const isIOSDevice = /iPad|iPhone|iPod/.test(userAgent)

  // Also check for iPad on iOS 13+ which reports as Mac
  const isIPadOS =
    navigator.platform === 'MacIntel' &&
    typeof navigator.maxTouchPoints === 'number' &&
    navigator.maxTouchPoints > 1

  return isIOSDevice || isIPadOS
}

/**
 * Check if the app is running in standalone mode (installed PWA)
 */
function checkIsStandalone(): boolean {
  if (!isBrowser()) return false

  // Standard check for display-mode: standalone
  const isStandaloneMedia = window.matchMedia('(display-mode: standalone)').matches

  // iOS Safari specific check
  const isIOSStandalone = (navigator as { standalone?: boolean }).standalone === true

  // Android TWA (Trusted Web Activity) check
  const isTWA = document.referrer.includes('android-app://')

  // Fullscreen mode check (some PWAs use this)
  const isFullscreen = window.matchMedia('(display-mode: fullscreen)').matches

  // Minimal UI check
  const isMinimalUI = window.matchMedia('(display-mode: minimal-ui)').matches

  return isStandaloneMedia || isIOSStandalone || isTWA || isFullscreen || isMinimalUI
}

/**
 * Hook for managing PWA installation
 *
 * Provides a unified API for handling PWA installation across different
 * platforms, including detection of iOS devices which require manual
 * installation instructions.
 */
export function usePWAInstall(): UsePWAInstallReturn {
  // Store the deferred prompt event for later use
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null)

  // State for tracking installation status
  const [isInstallable, setIsInstallable] = useState(false)
  const [isInstalled, setIsInstalled] = useState(() => {
    // Initial check for standalone mode (SSR safe)
    return isBrowser() ? checkIsStandalone() : false
  })
  const [isInstalling, setIsInstalling] = useState(false)

  // Check if this is an iOS device
  const isIOSDevice = isBrowser() ? checkIsIOS() : false

  // Determine install source
  const installSource: UsePWAInstallReturn['installSource'] = isInstalled
    ? null
    : isInstallable
      ? 'browser'
      : isIOSDevice
        ? 'ios-manual'
        : null

  // Handle beforeinstallprompt event
  useEffect(() => {
    if (!isBrowser()) return

    const handleBeforeInstallPrompt = (event: Event) => {
      // Prevent the default browser prompt from showing immediately
      event.preventDefault()

      // Store the event for later use
      deferredPromptRef.current = event as BeforeInstallPromptEvent

      // Update state to indicate installation is available
      setIsInstallable(true)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    }
  }, [])

  // Handle appinstalled event
  useEffect(() => {
    if (!isBrowser()) return

    const handleAppInstalled = () => {
      // Update state to reflect installation
      setIsInstalled(true)
      setIsInstallable(false)
      setIsInstalling(false)

      // Clear the deferred prompt as it's no longer usable
      deferredPromptRef.current = null
    }

    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  // Listen for display mode changes (in case user installs via browser menu)
  useEffect(() => {
    if (!isBrowser()) return

    const mediaQuery = window.matchMedia('(display-mode: standalone)')

    const handleChange = (event: MediaQueryListEvent) => {
      if (event.matches) {
        setIsInstalled(true)
        setIsInstallable(false)
        deferredPromptRef.current = null
      }
    }

    // Modern browsers use addEventListener
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange)
      return () => mediaQuery.removeEventListener('change', handleChange)
    } else {
      // Fallback for older browsers
      mediaQuery.addListener(handleChange)
      return () => mediaQuery.removeListener(handleChange)
    }
  }, [])

  // Install method - triggers the browser installation prompt
  const install = useCallback(async (): Promise<boolean> => {
    // If already installed or no prompt available, return early
    if (isInstalled) {
      return true
    }

    const deferredPrompt = deferredPromptRef.current

    if (!deferredPrompt) {
      // On iOS, we can't programmatically trigger installation
      // The UI should show manual instructions instead
      return false
    }

    try {
      setIsInstalling(true)

      // Show the installation prompt
      await deferredPrompt.prompt()

      // Wait for the user's response
      const choiceResult = await deferredPrompt.userChoice

      // Clear the deferred prompt - it can only be used once
      deferredPromptRef.current = null
      setIsInstallable(false)

      if (choiceResult.outcome === 'accepted') {
        // User accepted - appinstalled event will fire
        return true
      } else {
        // User dismissed the prompt
        setIsInstalling(false)
        return false
      }
    } catch (error) {
      // Handle any errors during the prompt
      logger.error('PWA installation error:', error)
      setIsInstalling(false)

      // Clear the prompt as it may be in an invalid state
      deferredPromptRef.current = null
      setIsInstallable(false)

      return false
    }
  }, [isInstalled])

  return {
    isInstallable,
    isInstalled,
    isInstalling,
    isIOSDevice,
    install,
    installSource,
  }
}

export default usePWAInstall
