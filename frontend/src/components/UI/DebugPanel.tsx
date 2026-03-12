/**
 * DebugPanel - Floating production debug log viewer
 *
 * Activated via ?debug=1 URL parameter. Shows a floating bug button
 * that opens a scrollable log panel capturing all logger.debug output.
 *
 * Features: auto-scroll, copy to clipboard, clear buffer, log count.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { getDebugBuffer, clearDebugBuffer, isDebugActive } from '@/lib/logger';

export function DebugPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [logs, setLogs] = useState<readonly string[]>([]);
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

  const handleCopy = useCallback(() => {
    const text = getDebugBuffer().join('\n');
    navigator.clipboard.writeText(text).catch(() => {
      // Fallback: select text for manual copy
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    });
  }, []);

  const handleClear = useCallback(() => {
    clearDebugBuffer();
    setLogs([]);
  }, []);

  if (!isDebugActive()) return null;

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
          {/* Header */}
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
            }}
          >
            <span style={{ color: '#94a3b8' }}>Debug Log ({logs.length})</span>
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

          {/* Logs */}
          {logs.length === 0 ? (
            <div style={{ color: '#64748b', padding: '8px 0' }}>
              No logs yet. Interact with the reader...
            </div>
          ) : (
            logs.map((log, i) => (
              <div
                key={i}
                style={{
                  padding: '1px 0',
                  borderBottom: '1px solid #1e293b',
                  wordBreak: 'break-all',
                  lineHeight: 1.4,
                }}
              >
                {log}
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      )}
    </>
  );
}
