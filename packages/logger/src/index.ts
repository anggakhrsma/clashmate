import pino from 'pino';

const acceptedLogLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const;

type LogLevel = (typeof acceptedLogLevels)[number];

function isLogLevel(level: string): level is LogLevel {
  return acceptedLogLevels.some((acceptedLevel) => acceptedLevel === level);
}

function validateLoggerName(name: string): string {
  if (typeof name !== 'string') {
    throw new Error('Logger name must be a non-empty string');
  }

  const trimmedName = name.trim();

  if (trimmedName.length === 0) {
    throw new Error('Logger name must be a non-empty string');
  }

  return trimmedName;
}

function validateLogLevel(level: string): LogLevel {
  if (typeof level !== 'string') {
    throw new Error('Logger level must be one of: trace, debug, info, warn, error, fatal, silent');
  }

  const trimmedLevel = level.trim();

  if (!isLogLevel(trimmedLevel)) {
    throw new Error('Logger level must be one of: trace, debug, info, warn, error, fatal, silent');
  }

  return trimmedLevel;
}

export function createLogger(name: string, level = 'info') {
  return pino({
    level: validateLogLevel(level),
    name: validateLoggerName(name),
  });
}

export type Logger = ReturnType<typeof createLogger>;
