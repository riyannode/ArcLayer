const LOG_LEVEL = (process.env.LOG_LEVEL ?? 'info') as 'debug' | 'info' | 'warn' | 'error';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;

function shouldLog(level: keyof typeof LEVELS): boolean {
  return LEVELS[level] >= LEVELS[LOG_LEVEL];
}

type LogMeta = Record<string, unknown>;

function formatLog(level: string, module: string, msg: string, meta?: LogMeta): string {
  const entry = {
    ts: new Date().toISOString(),
    level,
    module,
    msg,
    ...meta,
  };
  return JSON.stringify(entry);
}

export function createLogger(module: string) {
  return {
    debug(msg: string, meta?: LogMeta) {
      if (shouldLog('debug')) console.debug(formatLog('debug', module, msg, meta));
    },
    info(msg: string, meta?: LogMeta) {
      if (shouldLog('info')) console.info(formatLog('info', module, msg, meta));
    },
    warn(msg: string, meta?: LogMeta) {
      if (shouldLog('warn')) console.warn(formatLog('warn', module, msg, meta));
    },
    error(msg: string, meta?: LogMeta) {
      if (shouldLog('error')) console.error(formatLog('error', module, msg, meta));
    },
  };
}
