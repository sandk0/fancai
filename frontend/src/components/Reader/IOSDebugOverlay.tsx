/**
 * IOSDebugOverlay - Visual debug overlay for iOS navigation debugging
 *
 * Shows real-time debug information on screen since console.log
 * is hard to access on iOS devices.
 *
 * DELETE THIS FILE after fixing the iOS navigation bug!
 */

import { useEffect, useState, useCallback } from 'react';

interface DebugData {
  timestamp: string;
  event: string;
  scrollBefore?: number;
  scrollAfter?: number;
  scrollUnit?: number;
  layoutDelta?: number;
  layoutDivisor?: number;
  viewportWidth?: number;
  scrollWidth?: number;
  pagesScrolled?: number;
  blocked?: string;
  /** Source of scroll unit measurement (css-column-width, first-block-width, scroll-ratio, layout-delta, viewport-fallback) */
  measureSource?: string;
}

// Global debug log - accessible from anywhere
const debugLog: DebugData[] = [];
const MAX_LOG_ENTRIES = 10;

// Global function to add debug entry
(window as any).__iosDebug = (data: Partial<DebugData>) => {
  const entry: DebugData = {
    timestamp: new Date().toISOString().substr(11, 12),
    event: 'unknown',
    ...data,
  };
  debugLog.unshift(entry);
  if (debugLog.length > MAX_LOG_ENTRIES) {
    debugLog.pop();
  }
  // Trigger update
  window.dispatchEvent(new CustomEvent('ios-debug-update'));
};

// Check if iOS
const isIOS = (): boolean => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }
  const ua = navigator.userAgent;
  const isIOSDevice = /iPad|iPhone|iPod/.test(ua);
  const isIPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return isIOSDevice || isIPadOS;
};

// Measure safe-area-inset-bottom
const getSafeAreaBottom = (): number => {
  if (typeof window === 'undefined') return 0;
  try {
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;bottom:0;padding-bottom:env(safe-area-inset-bottom);visibility:hidden;';
    document.body.appendChild(div);
    const computed = window.getComputedStyle(div);
    const value = parseFloat(computed.paddingBottom) || 0;
    document.body.removeChild(div);
    return value;
  } catch {
    return 0;
  }
};

export const IOSDebugOverlay: React.FC = () => {
  const [entries, setEntries] = useState<DebugData[]>([]);
  const [visible, setVisible] = useState(true);
  const [iosDetected, setIosDetected] = useState<boolean | null>(null);
  const [safeAreaBottom, setSafeAreaBottom] = useState<number>(0);

  const updateEntries = useCallback(() => {
    setEntries([...debugLog]);
  }, []);

  useEffect(() => {
    // Check iOS on mount
    setIosDetected(isIOS());
    // Measure safe-area
    setSafeAreaBottom(getSafeAreaBottom());

    // Always listen for updates (for debugging)
    window.addEventListener('ios-debug-update', updateEntries);
    return () => {
      window.removeEventListener('ios-debug-update', updateEntries);
    };
  }, [updateEntries]);

  // ALWAYS show overlay for debugging (remove iOS check)
  return (
    <div
      style={{
        position: 'fixed',
        top: 60,
        left: 0,
        right: 0,
        zIndex: 99999,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        color: '#0f0',
        fontFamily: 'monospace',
        fontSize: '10px',
        padding: '4px',
        maxHeight: visible ? '40vh' : '20px',
        overflow: 'auto',
        transition: 'max-height 0.2s',
      }}
      onClick={() => setVisible(!visible)}
    >
      <div style={{ color: '#ff0', marginBottom: '4px' }}>
        DEBUG | iOS:{iosDetected === null ? '?' : iosDetected ? 'YES' : 'NO'} | SAB:{safeAreaBottom}px | UA:{typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 25) : 'N/A'}
      </div>

      {visible && entries.map((entry, i) => (
        <div
          key={i}
          style={{
            borderBottom: '1px solid #333',
            padding: '2px 0',
            color: entry.blocked ? '#f00' : '#0f0',
          }}
        >
          <div><b>{entry.timestamp}</b> {entry.event}</div>
          {entry.layoutDelta !== undefined && (
            <div>delta:{entry.layoutDelta} div:{entry.layoutDivisor} vw:{entry.viewportWidth}</div>
          )}
          {entry.scrollUnit !== undefined && (
            <div>
              unit:{entry.scrollUnit} sw:{entry.scrollWidth}
              {entry.measureSource && <span style={{ color: '#0ff' }}> [{entry.measureSource}]</span>}
            </div>
          )}
          {entry.scrollBefore !== undefined && (
            <div>
              scroll:{entry.scrollBefore}→{entry.scrollAfter}
              pages:{entry.pagesScrolled}
            </div>
          )}
          {entry.blocked && (
            <div style={{ color: '#f00' }}>BLOCKED: {entry.blocked}</div>
          )}
        </div>
      ))}

      {visible && entries.length === 0 && (
        <div style={{ color: '#888' }}>No events yet. Swipe to navigate.</div>
      )}
    </div>
  );
};

export default IOSDebugOverlay;
