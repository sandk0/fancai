import { useState, useCallback } from 'react';
import {
  isIOSSafari,
  isStandalone,
  isIOS,
  shouldShowIOSInstallPrompt,
  dismissIOSInstallPrompt,
  IOS_MIN_PUSH_VERSION,
  getIOSVersion,
} from '@/utils/iosSupport';

export function useIOSInstallPrompt() {
  const [shouldShow, setShouldShow] = useState(() => shouldShowIOSInstallPrompt());

  const dismiss = useCallback(() => {
    dismissIOSInstallPrompt();
    setShouldShow(false);
  }, []);

  return { shouldShow, dismiss };
}

export function useIsIOSPWA() {
  const [isIOSPWA] = useState(() => isIOSSafari() && isStandalone());

  return isIOSPWA;
}

export function useIOSPushReadiness() {
  const [state] = useState(() => {
    const isiOSSafari = isIOSSafari();
    const inStandalone = isStandalone();
    const version = getIOSVersion();
    const supportsWebPush = version !== null && version >= IOS_MIN_PUSH_VERSION;

    return {
      needsGuidance: isiOSSafari && !inStandalone,
      isIOSSafariDevice: isiOSSafari,
      isStandaloneMode: inStandalone,
      canReceivePush: isIOS() ? (supportsWebPush && inStandalone) : true,
      iosVersion: version,
    };
  });

  return state;
}
