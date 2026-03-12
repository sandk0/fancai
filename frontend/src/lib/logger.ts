const isDev = import.meta.env.DEV;

// Production debug mode: activated via ?debug=1 URL parameter
const isDebugMode =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug');

function noop() {}

// In-memory log buffer for production debug overlay
const debugBuffer: string[] = [];
const MAX_BUFFER_SIZE = 500;

function formatArg(a: unknown): string {
  if (a === null) return 'null';
  if (a === undefined) return 'undefined';
  if (typeof a === 'object') {
    try {
      return JSON.stringify(a);
    } catch {
      return String(a);
    }
  }
  return String(a);
}

function bufferedDebug(...args: unknown[]) {
  const timestamp = new Date().toISOString().slice(11, 23);
  const msg = `${timestamp} ${args.map(formatArg).join(' ')}`;
  if (debugBuffer.length >= MAX_BUFFER_SIZE) debugBuffer.shift();
  debugBuffer.push(msg);
  // Also output to real console (visible in chrome://inspect)
  console.log(...args);
}

export const logger = {
  debug: isDev || isDebugMode ? bufferedDebug : noop,
  info: isDev || isDebugMode ? console.info.bind(console) : noop,
  warn: console.warn.bind(console),
  error: console.error.bind(console),
} as const;

/** Get the debug log buffer (read-only) */
export function getDebugBuffer(): readonly string[] {
  return debugBuffer;
}

/** Clear the debug log buffer */
export function clearDebugBuffer(): void {
  debugBuffer.length = 0;
}

/** Check if debug mode is active */
export function isDebugActive(): boolean {
  return isDev || isDebugMode;
}
