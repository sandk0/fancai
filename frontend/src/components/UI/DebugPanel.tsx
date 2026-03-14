/**
 * DebugPanel - Floating production debug log viewer with touch diagnostics
 *
 * Activated via ?debug=1 URL parameter. Shows a floating bug button
 * that opens a scrollable log panel with three tabs:
 * - Logs: all logger.debug output (original behavior)
 * - Touch: filtered touch-diag events with color coding
 * - CSS: computed touch-action values for key reader elements
 *
 * Features: auto-scroll, copy to clipboard, clear buffer, tab switching.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getDebugBuffer, clearDebugBuffer, isDebugActive } from '@/lib/logger';

type TabId = 'logs' | 'touch' | 'css';

interface DebugPanelProps {
  /** Callback to get CSS touch-action info on demand */
  onRequestCSSInfo?: () => Record<string, string>;
}

/** Color for touch event type */
function getTouchEventColor(log: string): string {
  if (log.includes('touchstart') || log.includes('pointerdown')) return '#22c55e';
  if (log.includes('touchend') || log.includes('pointerup')) return '#ef4444';
  if (log.includes('touchmove') || log.includes('pointermove')) return '#94a3b8';
  return '#22c55e';
}

/** Read computed touch-action from DOM elements directly */
function readTouchActionFromDOM(): Record<string, string> {
  const result: Record<string, string> = {};

  const viewer = document.getElementById('epub-viewer');
  if (viewer) {
    result['#epub-viewer'] = getComputedStyle(viewer).touchAction;
  }

  const overlay = document.getElementById('gesture-controller-ios-overlay');
  if (overlay) {
    result['iOS overlay'] = getComputedStyle(overlay).touchAction;
  }

  const iframe = viewer?.querySelector('iframe') as HTMLIFrameElement | null;
  if (iframe) {
    result['iframe (element)'] = getComputedStyle(iframe).touchAction;
    try {
      const iframeDoc = iframe.contentDocument;
      if (iframeDoc?.body) {
        result['iframe body'] = getComputedStyle(iframeDoc.body).touchAction;
      }
      if (iframeDoc?.documentElement) {
        result['iframe html'] = getComputedStyle(iframeDoc.documentElement).touchAction;
      }
    } catch {
      result['iframe (cross-origin)'] = 'ACCESS DENIED';
    }
  }

  return result;
}

export function DebugPanel({ onRequestCSSInfo }: DebugPanelProps = {}) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('logs');
  const [logs, setLogs] = useState<readonly string[]>([]);
  const [cssInfo, setCssInfo] = useState<Record<string, string>>({});
  const logEndRef = useRef<HTMLDivElement>(null);

  // Poll buffer when panel is open
  useEffect(() => {
    if (!isOpen) return;
    const update = () => setLogs([...getDebugBuffer()]);
    update();
    const interval = setInterval(update, 300);
    return () => clearInterval(interval);
  }, [isOpen]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (isOpen && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, isOpen]);

  // Refresh CSS info when switching to CSS tab
  useEffect(() => {
    if (activeTab === 'css') {
      const info = onRequestCSSInfo ? onRequestCSSInfo() : readTouchActionFromDOM();
      setCssInfo(info);
    }
  }, [activeTab, onRequestCSSInfo]);

  // Filtered logs for Touch tab
  const touchLogs = useMemo(() => logs.filter((log) => log.includes('[touch-diag]')), [logs]);

  const displayedLogs = activeTab === 'touch' ? touchLogs : logs;

  const handleCopy = useCallback(() => {
    let text: string;
    if (activeTab === 'css') {
      text = Object.entries(cssInfo)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n');
    } else if (activeTab === 'touch') {
      text = getDebugBuffer()
        .filter((l) => l.includes('[touch-diag]'))
        .join('\n');
    } else {
      text = getDebugBuffer().join('\n');
    }
    navigator.clipboard.writeText(text).catch(() => {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    });
  }, [activeTab, cssInfo]);

  const handleClear = useCallback(() => {
    clearDebugBuffer();
    setLogs([]);
    setCssInfo({});
  }, []);

  if (!isDebugActive()) return null;

  const tabButtonStyle = (tab: TabId) => ({
    color: activeTab === tab ? '#0f172a' : '#94a3b8',
    background: activeTab === tab ? '#22c55e' : 'none',
    border: `1px solid ${activeTab === tab ? '#22c55e' : '#475569'}`,
    borderRadius: 4,
    padding: '2px 6px',
    fontSize: 10,
    cursor: 'pointer' as const,
    marginRight: 2,
    fontWeight: activeTab === tab ? 700 : 400,
  });

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        style={{
          position: 'fixed',
          bottom: 12,
          right: 12,
          zIndex: 99999,
          width: 44,
          height: 44,
          borderRadius: '50%',
          background: isOpen ? '#dc2626' : '#1e293b',
          color: '#22c55e',
          border: '2px solid #22c55e',
          fontSize: 20,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          touchAction: 'manipulation',
        }}
        aria-label="Toggle debug panel"
      >
        {isOpen ? 'X' : 'D'}
      </button>

      {/* Log panel */}
      {isOpen && (
        <div
          style={{
            position: 'fixed',
            bottom: 64,
            left: 8,
            right: 8,
            maxHeight: '50vh',
            zIndex: 99998,
            background: '#0f172a',
            color: '#22c55e',
            fontSize: 10,
            fontFamily: 'ui-monospace, monospace',
            overflow: 'auto',
            padding: 8,
            borderRadius: 8,
            border: '1px solid #334155',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {/* Header with tabs */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 6,
              paddingBottom: 4,
              borderBottom: '1px solid #334155',
              position: 'sticky',
              top: 0,
              background: '#0f172a',
              flexWrap: 'wrap',
              gap: 4,
            }}
          >
            {/* Tab buttons */}
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <button onClick={() => setActiveTab('logs')} style={tabButtonStyle('logs')}>
                Logs ({logs.length})
              </button>
              <button onClick={() => setActiveTab('touch')} style={tabButtonStyle('touch')}>
                Touch ({touchLogs.length})
              </button>
              <button onClick={() => setActiveTab('css')} style={tabButtonStyle('css')}>
                CSS
              </button>
            </div>

            {/* Action buttons */}
            <div>
              <button
                onClick={handleCopy}
                style={{
                  color: '#22c55e',
                  background: 'none',
                  border: '1px solid #22c55e',
                  borderRadius: 4,
                  padding: '2px 8px',
                  marginRight: 4,
                  fontSize: 10,
                  cursor: 'pointer',
                }}
              >
                Copy
              </button>
              <button
                onClick={handleClear}
                style={{
                  color: '#ef4444',
                  background: 'none',
                  border: '1px solid #ef4444',
                  borderRadius: 4,
                  padding: '2px 8px',
                  fontSize: 10,
                  cursor: 'pointer',
                }}
              >
                Clear
              </button>
            </div>
          </div>

          {/* Tab content */}
          {activeTab === 'css' ? (
            /* CSS touch-action table */
            <div>
              {Object.keys(cssInfo).length === 0 ? (
                <div style={{ color: '#64748b', padding: '8px 0' }}>
                  No CSS data. Open a book and switch to this tab.
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #334155' }}>
                      <th style={{ textAlign: 'left', padding: '4px 8px', color: '#94a3b8' }}>
                        Element
                      </th>
                      <th style={{ textAlign: 'left', padding: '4px 8px', color: '#94a3b8' }}>
                        touch-action
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(cssInfo).map(([selector, value]) => (
                      <tr key={selector} style={{ borderBottom: '1px solid #1e293b' }}>
                        <td style={{ padding: '4px 8px', color: '#e2e8f0' }}>{selector}</td>
                        <td
                          style={{
                            padding: '4px 8px',
                            color: value === 'auto' ? '#ef4444' : '#22c55e',
                            fontWeight: value === 'auto' ? 700 : 400,
                          }}
                        >
                          {value}
                          {value === 'auto' && ' (WARNING)'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : (
            /* Logs / Touch tab */
            <>
              {displayedLogs.length === 0 ? (
                <div style={{ color: '#64748b', padding: '8px 0' }}>
                  {activeTab === 'touch'
                    ? 'No touch events yet. Touch the screen...'
                    : 'No logs yet. Interact with the reader...'}
                </div>
              ) : (
                displayedLogs.map((log, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '1px 0',
                      borderBottom: '1px solid #1e293b',
                      wordBreak: 'break-all',
                      lineHeight: 1.4,
                      color: activeTab === 'touch' ? getTouchEventColor(log) : '#22c55e',
                    }}
                  >
                    {log}
                  </div>
                ))
              )}
            </>
          )}
          <div ref={logEndRef} />
        </div>
      )}
    </>
  );
}
