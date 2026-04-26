import pino from 'pino';

export function createLogger(name: string, level = 'info') {
  return pino({
    level,
    name,
  });
}

export type Logger = ReturnType<typeof createLogger>;
