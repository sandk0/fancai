import { useState, useEffect, useCallback } from 'react';
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
  const [shouldShow, setShouldShow] = useState(false);

  useEffect(() => {
    setShouldShow(shouldShowIOSInstallPrompt());
  }, []);

  const dismiss = useCallback(() => {
    dismissIOSInstallPrompt();
    setShouldShow(false);
  }, []);

  return { shouldShow, dismiss };
}

export function useIsIOSPWA() {
  const [isIOSPWA, setIsIOSPWA] = useState(false);

  useEffect(() => {
    setIsIOSPWA(isIOSSafari() && isStandalone());
  }, []);

  return isIOSPWA;
}

export function useIOSPushReadiness() {
  const [state, setState] = useState({
    needsGuidance: false,
    isIOSSafariDevice: false,
    isStandaloneMode: false,
    canReceivePush: false,
    iosVersion: null as number | null,
  });

  useEffect(() => {
    const isiOSSafari = isIOSSafari();
    const inStandalone = isStandalone();
    const version = getIOSVersion();
    const supportsWebPush = version !== null && version >= IOS_MIN_PUSH_VERSION;

    setState({
      needsGuidance: isiOSSafari && !inStandalone,
      isIOSSafariDevice: isiOSSafari,
      isStandaloneMode: inStandalone,
      canReceivePush: isIOS() ? (supportsWebPush && inStandalone) : true,
      iosVersion: version,
    });
  }, []);

  return state;
}
