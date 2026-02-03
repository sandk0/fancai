const isDev = import.meta.env.DEV;

function noop() {}

export const logger = {
  debug: isDev ? console.log.bind(console) : noop,
  info: isDev ? console.info.bind(console) : noop,
  warn: console.warn.bind(console),
  error: console.error.bind(console),
} as const;
