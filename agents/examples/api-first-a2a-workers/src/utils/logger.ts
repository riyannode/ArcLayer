const SECRET_PATTERNS = [/sk-[A-Za-z0-9_-]+/g, /0x[a-fA-F0-9]{64}/g];

function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, '[REDACTED]'), value);
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /key|token|secret|private/i.test(key) ? '[REDACTED]' : redact(item)]));
  }
  return value;
}

export const logger = {
  info(message: string, meta?: Record<string, unknown>) {
    console.log(JSON.stringify({ level: 'info', message, ...(meta ? { meta: redact(meta) } : {}) }));
  },
  warn(message: string, meta?: Record<string, unknown>) {
    console.warn(JSON.stringify({ level: 'warn', message, ...(meta ? { meta: redact(meta) } : {}) }));
  },
  error(message: string, meta?: Record<string, unknown>) {
    console.error(JSON.stringify({ level: 'error', message, ...(meta ? { meta: redact(meta) } : {}) }));
  },
};
